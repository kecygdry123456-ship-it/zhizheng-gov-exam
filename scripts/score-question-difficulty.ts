import { PrismaClient } from "@prisma/client";
import {
  buildKnowledgeDifficultyContext,
  difficultyLabel,
  scorePaperDifficulty,
  scoreQuestionDifficulty,
} from "../src/lib/difficulty";
import {
  GENERAL_KNOWLEDGE_QUESTION_TYPES,
  POLITICS_QUESTION_TYPES,
} from "../src/lib/exam-templates";

const db = new PrismaClient();

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const knowledgeOnly = process.argv.includes("--knowledge-only");
  const knowledgeAndMaterials = process.argv.includes("--knowledge-and-materials");
  const refreshActiveSessionDifficulty = process.argv.includes("--refresh-active-session-difficulty");
  const questions = await db.question.findMany({
    where: knowledgeOnly
      ? { category: { name: "常识判断" } }
      : knowledgeAndMaterials
        ? { OR: [{ category: { name: "常识判断" } }, { materialId: { not: null } }] }
        : undefined,
    include: {
      category: true,
      material: { select: { content: true } },
      attempts: { select: { correct: true } },
    },
    orderBy: { id: "asc" },
  });

  const knowledgeContext = buildKnowledgeDifficultyContext(
    questions
      .filter((question) => question.category.name === "常识判断")
      .map((question) => ({
        category: question.category.name,
        type: question.type,
        stem: question.stem,
        options: question.options as string[],
      })),
  );
  const buckets = Array.from({ length: 10 }, () => 0);
  const scored = questions.map((question) => ({
    question,
    score: scoreQuestionDifficulty(
      { category: question.category.name, type: question.type, stem: question.stem, options: question.options as string[], material: question.material?.content },
      { total: question.attempts.length, wrong: question.attempts.filter((attempt) => !attempt.correct).length },
      question.category.name === "常识判断" ? knowledgeContext : undefined,
    ),
  }));
  for (const item of scored) {
    buckets[Math.min(9, Math.max(0, Math.ceil(item.score) - 1))] += 1;
  }

  if (!dryRun) {
  for (let start = 0; start < questions.length; start += 100) {
    const batch = scored.slice(start, start + 100);
    await db.$transaction(batch.map(({ question, score }) => {
      return db.question.update({ where: { id: question.id }, data: { difficultyScore: score, difficulty: difficultyLabel(score) } });
    }));
  }
  }
  let refreshedActiveSessions = 0;
  if (!dryRun && refreshActiveSessionDifficulty) {
    const activeSessions = await db.practiceSession.findMany({
      where: { status: "IN_PROGRESS" },
      select: { id: true, questionIds: true },
    });
    const activeQuestionIds = [...new Set(activeSessions.flatMap((session) =>
      Array.isArray(session.questionIds)
        ? session.questionIds.filter((id): id is string => typeof id === "string")
        : [],
    ))];
    const activeQuestions = activeQuestionIds.length
      ? await db.question.findMany({
          where: { id: { in: activeQuestionIds } },
          select: { id: true, difficultyScore: true },
        })
      : [];
    const activeScoreMap = new Map(activeQuestions.map((question) => [question.id, question.difficultyScore]));
    for (const session of activeSessions) {
      const ids = Array.isArray(session.questionIds)
        ? session.questionIds.filter((id): id is string => typeof id === "string")
        : [];
      const scores = ids.flatMap((id) => {
        const score = activeScoreMap.get(id);
        return score === undefined ? [] : [score];
      });
      if (scores.length !== ids.length || !scores.length) continue;
      await db.practiceSession.update({
        where: { id: session.id },
        data: { paperDifficulty: scorePaperDifficulty(scores) },
      });
      refreshedActiveSessions += 1;
    }
  }

  const percentile = (values: number[], ratio: number) => {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))] || 0;
  };
  const summarize = (values: number[]) => ({
    count: values.length,
    mean: values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100 : 0,
    min: values.length ? Math.min(...values) : 0,
    p25: percentile(values, 0.25),
    median: percentile(values, 0.5),
    p75: percentile(values, 0.75),
    max: values.length ? Math.max(...values) : 0,
    distinctScores: new Set(values).size,
    exactlySix: values.filter((value) => value === 6).length,
    under4: values.filter((value) => value < 4).length,
  });
  const politics = new Set(POLITICS_QUESTION_TYPES as readonly string[]);
  const general = new Set(GENERAL_KNOWLEDGE_QUESTION_TYPES as readonly string[]);
  const poolSummary = Object.fromEntries(
    [
      ["政治理论", (type: string) => politics.has(type)],
      ["普通常识", (type: string) => general.has(type)],
    ].map(([name, matches]) => {
      const predicate = matches as (type: string) => boolean;
      const pool = scored.filter(({ question }) => predicate(question.type));
      return [name as string, {
        current: summarize(pool.map(({ question }) => question.difficultyScore)),
        proposed: summarize(pool.map(({ score }) => score)),
      }];
    }),
  );
  const materialGroups = new Map<string, typeof scored>();
  for (const item of scored) {
    if (!item.question.materialId) continue;
    const group = materialGroups.get(item.question.materialId) || [];
    group.push(item);
    materialGroups.set(item.question.materialId, group);
  }
  const completeMaterialGroups = [...materialGroups.values()].filter((group) => group.length > 1);
  const materialSummary = {
    groups: completeMaterialGroups.length,
    uniformCurrent: completeMaterialGroups.filter((group) => new Set(group.map(({ question }) => question.difficultyScore)).size === 1).length,
    uniformProposed: completeMaterialGroups.filter((group) => new Set(group.map(({ score }) => score)).size === 1).length,
  };
  const categorySummary = Object.fromEntries(
    [...new Set(scored.map(({ question }) => question.category.name))]
      .sort((left, right) => left.localeCompare(right, "zh-CN"))
      .map((category) => {
        const items = scored.filter(({ question }) => question.category.name === category);
        return [category, {
          current: summarize(items.map(({ question }) => question.difficultyScore)),
          proposed: summarize(items.map(({ score }) => score)),
        }];
      }),
  );

  console.log(JSON.stringify({
    dryRun,
    scope: knowledgeOnly ? "常识判断" : knowledgeAndMaterials ? "常识判断及材料题" : "全部题库",
    updated: dryRun ? 0 : questions.length,
    evaluated: questions.length,
    refreshedActiveSessions,
    distribution: Object.fromEntries(buckets.map((count, index) => [`${index + 1}分`, count])),
    pools: poolSummary,
    categories: categorySummary,
    materials: materialSummary,
  }, null, 2));
}

main().finally(() => db.$disconnect());

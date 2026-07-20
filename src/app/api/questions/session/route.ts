import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { scorePaperDifficulty } from "@/lib/difficulty";
import { EXAM_TEMPLATES, EXAM_TEMPLATE_IDS, GENERAL_KNOWLEDGE_QUESTION_TYPES, POLITICS_QUESTION_TYPES } from "@/lib/exam-templates";
import { parseQuestionScopesParameter, questionScopesSchema, questionScopesWhere } from "@/lib/question-scope";

const input = z.object({
  count: z.coerce.number().int().min(5).max(150).default(50),
  category: z.string().trim().max(30).optional(),
  scopes: questionScopesSchema.default([]),
  questionPool: z.enum(["POLITICS", "GENERAL_KNOWLEDGE"]).optional(),
  template: z.enum(EXAM_TEMPLATE_IDS).optional(),
  minDifficulty: z.coerce.number().min(1).max(10).default(1),
  maxDifficulty: z.coerce.number().min(1).max(10).default(10),
}).superRefine((value, context) => {
  if (value.minDifficulty > value.maxDifficulty) context.addIssue({ code: "custom", path: ["minDifficulty"], message: "最低难度不能高于最高难度" });
});

const lightweightQuestionSelect = {
  id: true,
  stem: true,
  type: true,
  difficultyScore: true,
  materialId: true,
  materialOrder: true,
  year: true,
  region: true,
  paperTitle: true,
  category: { select: { name: true } },
} satisfies Prisma.QuestionSelect;

const fullQuestionInclude = {
  category: true,
  material: true,
} satisfies Prisma.QuestionInclude;

type FullQuestion = Prisma.QuestionGetPayload<{
  include: typeof fullQuestionInclude;
}>;

async function hydrateQuestions(ids: string[]) {
  if (!ids.length) return [];
  const questions = await prisma.question.findMany({
    where: { id: { in: ids } },
    include: fullQuestionInclude,
  });
  const byId = new Map(questions.map((question) => [question.id, question]));
  return ids
    .map((id) => byId.get(id))
    .filter((question): question is FullQuestion => Boolean(question));
}

function shuffle<T>(items: T[]) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function selectCompleteUnits<T extends { id: string; stem: string; materialId: string | null; materialOrder: number | null }>(
  rows: T[],
  count: number,
  recentIds: Set<string>,
  recentStems: Set<string>,
  recentRank: Map<string, number>,
) {
  const uniqueStandalone = new Map<string, T>();
  for (const row of rows.filter((item) => !item.materialId)) {
    const key = normalizedStem(row.stem);
    if (key && !uniqueStandalone.has(key)) uniqueStandalone.set(key, row);
  }
  const standalone = [...uniqueStandalone.values()].map((row) => [row]);
  const grouped = new Map<string, T[]>();
  for (const row of rows) if (row.materialId) grouped.set(row.materialId, [...(grouped.get(row.materialId) || []), row]);
  const uniqueMaterialUnits = new Map<string, T[]>();
  for (const group of grouped.values()) {
    if (group.length !== 5) continue;
    const ordered = [...group].sort((left, right) => (left.materialOrder || 0) - (right.materialOrder || 0));
    const key = ordered.map((row) => normalizedStem(row.stem)).join("|");
    if (key && !uniqueMaterialUnits.has(key)) uniqueMaterialUnits.set(key, ordered);
  }
  const materialUnits = [...uniqueMaterialUnits.values()];
  const isFresh = (unit: T[]) => unit.every(
    (row) => !recentIds.has(row.id) && !recentStems.has(normalizedStem(row.stem)),
  );
  const orderUnits = (units: T[][]) => [
    ...shuffle(units.filter(isFresh)),
    ...units.filter((unit) => !isFresh(unit)).sort((left, right) => {
      const leftRank = Math.max(...left.map((row) => recentRank.get(row.id) ?? -1));
      const rightRank = Math.max(...right.map((row) => recentRank.get(row.id) ?? -1));
      return rightRank - leftRank;
    }),
  ];
  const orderedMaterials = orderUnits(materialUnits);
  const selected: T[] = [];
  const guaranteedMaterial = count >= 10 && orderedMaterials.length ? orderedMaterials[0] : null;
  const targetBeforeMaterial = count - (guaranteedMaterial?.length || 0);
  const units = orderUnits([...standalone, ...materialUnits.filter((unit) => unit !== guaranteedMaterial)]);
  for (const unit of units) {
    if (selected.length + unit.length > targetBeforeMaterial) continue;
    selected.push(...unit);
    if (selected.length === targetBeforeMaterial) break;
  }
  if (guaranteedMaterial) selected.push(...guaranteedMaterial);
  return selected;
}

function normalizedStem(value: string) {
  return value.replace(/<[^>]*>/g, "").replace(/\s+/g, "").toLowerCase();
}

function sourceTier(row: { year: number | null; region: string | null; paperTitle: string | null }, template: "NATIONAL_PREFECTURE" | "GUANGDONG_PROVINCE") {
  const title = row.paperTitle || "";
  const sameSource = template === "NATIONAL_PREFECTURE" ? /(国家公务员|国考)/.test(title) : row.region === "广东" || /广东/.test(title);
  if (sameSource && (row.year || 0) >= 2021) return 0;
  if (sameSource) return 1;
  return 2;
}

function diverseOrder<T extends { year: number | null; region: string | null; paperTitle: string | null }>(rows: T[], template: "NATIONAL_PREFECTURE" | "GUANGDONG_PROVINCE") {
  const ordered: T[] = [];
  for (const tier of [0, 1, 2]) {
    const buckets = new Map<string, T[]>();
    for (const row of shuffle(rows.filter((item) => sourceTier(item, template) === tier))) {
      const key = row.paperTitle || `unknown-${row.year || 0}-${row.region || ""}`;
      buckets.set(key, [...(buckets.get(key) || []), row]);
    }
    const keys = shuffle([...buckets.keys()]);
    let added = true;
    while (added) {
      added = false;
      for (const key of keys) {
        const next = buckets.get(key)?.shift();
        if (next) { ordered.push(next); added = true; }
      }
    }
  }
  return ordered;
}

function selectTemplateSection<T extends { id: string; stem: string; materialId: string | null; materialOrder: number | null; year: number | null; region: string | null; paperTitle: string | null }>(rows: T[], category: string, count: number, template: "NATIONAL_PREFECTURE" | "GUANGDONG_PROVINCE", recentIds: Set<string>, recentStems: Set<string>) {
  const usableRows = rows.filter((row) => !row.stem.includes("题目正在全力以赴征集"));
  if (category !== "资料分析") {
    const unique = new Map<string, T>();
    for (const row of usableRows.filter((item) => !item.materialId)) {
      const key = normalizedStem(row.stem);
      if (key && !unique.has(key)) unique.set(key, row);
    }
    const values = [...unique.values()];
    const fresh = values.filter((row) => !recentIds.has(row.id) && !recentStems.has(normalizedStem(row.stem)));
    const reused = values.filter((row) => !fresh.includes(row));
    return [...diverseOrder(fresh, template), ...diverseOrder(reused, template)].slice(0, count);
  }
  const groups = new Map<string, T[]>();
  for (const row of usableRows) if (row.materialId) groups.set(row.materialId, [...(groups.get(row.materialId) || []), row]);
  const uniqueGroups = new Map<string, T[]>();
  for (const group of groups.values()) {
    if (group.length !== 5) continue;
    const ordered = [...group].sort((left, right) => (left.materialOrder || 0) - (right.materialOrder || 0));
    const stems = ordered.map((row) => normalizedStem(row.stem));
    if (new Set(stems).size !== 5) continue;
    const key = stems.join("|");
    if (key && !uniqueGroups.has(key)) uniqueGroups.set(key, ordered);
  }
  const selectedGroups: T[][] = [];
  const selectedStems = new Set<string>();
  const groupRows = [...uniqueGroups.values()].map((group) => ({ group, ...group[0] }));
  const freshGroups = groupRows.filter(({ group }) => group.every((row) => !recentIds.has(row.id) && !recentStems.has(normalizedStem(row.stem))));
  const reusedGroups = groupRows.filter((item) => !freshGroups.includes(item));
  const orderedGroups = [
    ...diverseOrder(freshGroups, template),
    ...diverseOrder(reusedGroups, template),
  ].map((item) => item.group);
  for (const group of orderedGroups) {
    const stems = group.map((row) => normalizedStem(row.stem));
    if (stems.some((stem) => selectedStems.has(stem))) continue;
    selectedGroups.push(group);
    stems.forEach((stem) => selectedStems.add(stem));
    if (selectedGroups.length === count / 5) break;
  }
  return selectedGroups.flat();
}

async function recentQuestionHistory(userId: string) {
  const [attempts, practiceSessions, examSessions] = await Promise.all([
    prisma.attempt.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 2000,
      select: { questionId: true },
    }),
    prisma.practiceSession.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 30,
      select: { questionIds: true },
    }),
    prisma.examSession.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 15,
      select: { questionIds: true },
    }),
  ]);
  const orderedIds = [
    ...attempts.map((item) => item.questionId),
    ...practiceSessions.flatMap((item) => Array.isArray(item.questionIds) ? item.questionIds.filter((id): id is string => typeof id === "string") : []),
    ...examSessions.flatMap((item) => Array.isArray(item.questionIds) ? item.questionIds.filter((id): id is string => typeof id === "string") : []),
  ];
  const recentRank = new Map<string, number>();
  orderedIds.forEach((id, index) => {
    if (!recentRank.has(id)) recentRank.set(id, index);
  });
  const recentIds = new Set(recentRank.keys());
  const historicalQuestions = recentIds.size
    ? await prisma.question.findMany({
        where: { id: { in: [...recentIds] } },
        select: { stem: true },
      })
    : [];
  return {
    recentIds,
    recentRank,
    recentStems: new Set(historicalQuestions.map((item) => normalizedStem(item.stem))),
  };
}

function matchesTemplatePool(type: string, stem: string, pool?: "POLITICS" | "GENERAL_KNOWLEDGE") {
  const isPolitics = (POLITICS_QUESTION_TYPES as readonly string[]).includes(type);
  if (pool === "POLITICS") return isPolitics;
  if (pool === "GENERAL_KNOWLEDGE") {
    const allowedType = (GENERAL_KNOWLEDGE_QUESTION_TYPES as readonly string[]).includes(type);
    const politicalTerms = ["习近平", "马克思", "毛泽东", "中国特色社会主义", "中国共产党", "党中央", "党的二十大", "二十届", "全会"];
    return allowedType && !politicalTerms.some((term) => stem.includes(term));
  }
  return true;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.id) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "请先登录", details: null } }, { status: 401 });
  const url = new URL(request.url);
  const parsedScopes = parseQuestionScopesParameter(url.searchParams.get("scopes"));
  if (!parsedScopes.success) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "细分板块参数不正确", details: null } }, { status: 400 });
  const parsed = input.safeParse({
    count: url.searchParams.get("count") ?? undefined,
    category: url.searchParams.get("category") || undefined,
    scopes: parsedScopes.data,
    questionPool: url.searchParams.get("questionPool") || undefined,
    template: url.searchParams.get("template") || undefined,
    minDifficulty: url.searchParams.get("minDifficulty") ?? undefined,
    maxDifficulty: url.searchParams.get("maxDifficulty") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "组题参数不正确", details: parsed.error.flatten() } }, { status: 400 });
  const history = await recentQuestionHistory(String(session.id));

  if (parsed.data.template) {
    const template = EXAM_TEMPLATES[parsed.data.template];
    const rows = await prisma.question.findMany({
      where: { status: "PUBLISHED", category: { name: { in: template.sections.map((section) => section.category) } } },
      select: lightweightQuestionSelect,
    });
    const selected: { question: (typeof rows)[number]; examSection: string; examSubtype: string }[] = [];
    const usedStems = new Set<string>();
    const sectionCounts: { category: string; label: string; requested: number; selected: number }[] = [];
    const subtypeCounts: { section: string; subtype: string; requested: number; selected: number }[] = [];
    for (const section of template.sections) {
      const sectionRows: { question: (typeof rows)[number]; subtype: string }[] = [];
      const subtypePlans = section.subtypes || [{ label: section.label, count: section.count, types: [] as string[] }];
      for (const subtype of subtypePlans) {
        const subtypeRows = selectTemplateSection(
          rows.filter((row) => row.category.name === section.category && matchesTemplatePool(row.type, row.stem, section.pool) && (!subtype.types.length || subtype.types.includes(row.type)) && !usedStems.has(normalizedStem(row.stem))),
          section.category,
          subtype.count,
          template.id,
          history.recentIds,
          history.recentStems,
        );
        subtypeCounts.push({ section: section.label, subtype: subtype.label, requested: subtype.count, selected: subtypeRows.length });
        for (const question of subtypeRows) {
          usedStems.add(normalizedStem(question.stem));
          sectionRows.push({ question, subtype: subtype.label });
        }
      }
      sectionCounts.push({ category: section.category, label: section.label, requested: section.count, selected: sectionRows.length });
      if (sectionRows.length !== section.count) {
        return NextResponse.json({ error: { code: "INSUFFICIENT_QUESTIONS", message: `${section.label}细分题型可用题量不足，无法按${template.name}规范组卷`, details: { sectionCounts, subtypeCounts } } }, { status: 409 });
      }
      selected.push(...sectionRows.map(({ question, subtype }) => ({ question, examSection: section.label, examSubtype: subtype })));
    }
    const hydrated = await hydrateQuestions(selected.map(({ question }) => question.id));
    const hydratedById = new Map(hydrated.map((question) => [question.id, question]));
    const hydratedSelected = selected.flatMap(({ question, examSection, examSubtype }) => {
      const fullQuestion = hydratedById.get(question.id);
      return fullQuestion ? [{ question: fullQuestion, examSection, examSubtype }] : [];
    });
    const items = hydratedSelected.map(({ question, examSection, examSubtype }) => ({
      id: question.id, category: question.category.name, type: question.type, stem: question.stem, options: question.options,
      examSection, examSubtype,
      difficulty: question.difficulty, difficultyScore: question.difficultyScore, materialId: question.materialId,
      materialOrder: question.materialOrder, material: question.material ? { id: question.material.id, title: question.material.title, content: question.material.content, blocks: question.material.blocks } : null,
      source: question.source, paperTitle: question.paperTitle, year: question.year, region: question.region,
    }));
    const freshSelected = hydratedSelected.filter(({ question }) => !history.recentIds.has(question.id) && !history.recentStems.has(normalizedStem(question.stem))).length;
    return NextResponse.json({ data: { total: rows.length, requested: template.questionCount, materialGroups: template.sections.find((section) => section.category === "资料分析")!.count / 5, paperDifficulty: scorePaperDifficulty(hydratedSelected.map(({ question }) => question.difficultyScore)), template: template.id, sectionCounts, subtypeCounts, freshSelected, reusedSelected: hydratedSelected.length - freshSelected, items } });
  }

  const where = {
    status: "PUBLISHED" as const,
    difficultyScore: { gte: parsed.data.minDifficulty, lte: parsed.data.maxDifficulty },
    ...(parsed.data.category ? { category: { name: parsed.data.category } } : {}),
    ...questionScopesWhere(parsed.data.scopes),
    ...(parsed.data.questionPool
      ? {
          type: {
            in:
              parsed.data.questionPool === "POLITICS"
                ? [...POLITICS_QUESTION_TYPES]
                : [...GENERAL_KNOWLEDGE_QUESTION_TYPES],
          },
        }
      : {}),
  };
  const matchingRows = await prisma.question.findMany({ where, select: lightweightQuestionSelect, orderBy: [{ materialId: "asc" }, { materialOrder: "asc" }] });
  const rows = matchingRows.filter((row) =>
    matchesTemplatePool(row.type, row.stem, parsed.data.questionPool),
  );
  const materialCounts = new Map<string, number>(); for (const row of rows) if (row.materialId) materialCounts.set(row.materialId, (materialCounts.get(row.materialId) || 0) + 1);
  const eligibleRows = rows.filter((row) => row.materialId ? materialCounts.get(row.materialId) === 5 : row.category.name !== "资料分析");
  const selectedRows = selectCompleteUnits(
    eligibleRows,
    parsed.data.count,
    history.recentIds,
    history.recentStems,
    history.recentRank,
  );
  const selected = await hydrateQuestions(selectedRows.map((question) => question.id));
  const items = selected.map((question) => ({
    id: question.id,
    category: question.category.name,
    type: question.type,
    stem: question.stem,
    options: question.options,
    difficulty: question.difficulty,
    difficultyScore: question.difficultyScore,
    materialId: question.materialId,
    materialOrder: question.materialOrder,
    material: question.material ? { id: question.material.id, title: question.material.title, content: question.material.content, blocks: question.material.blocks } : null,
    source: question.source,
    paperTitle: question.paperTitle,
    year: question.year,
    region: question.region,
  }));
  const freshSelected = selected.filter((question) => !history.recentIds.has(question.id) && !history.recentStems.has(normalizedStem(question.stem))).length;
  return NextResponse.json({ data: { total: eligibleRows.length, requested: parsed.data.count, materialGroups: new Set(eligibleRows.map((row) => row.materialId).filter(Boolean)).size, paperDifficulty: scorePaperDifficulty(selected.map((question) => question.difficultyScore)), freshSelected, reusedSelected: selected.length - freshSelected, items } });
}

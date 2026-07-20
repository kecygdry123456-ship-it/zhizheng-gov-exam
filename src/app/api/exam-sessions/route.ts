import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { publicQuestionInclude, toPublicQuestion } from "@/lib/public-question";
import {
  EXAM_TEMPLATES,
  GENERAL_KNOWLEDGE_QUESTION_TYPES,
  POLITICS_QUESTION_TYPES,
} from "@/lib/exam-templates";
import {
  buildExamQuestionMeta,
  parseExamQuestionMeta,
} from "@/lib/exam-question-meta";
import { scorePaperDifficulty } from "@/lib/difficulty";
import { sessionDeadlineAt } from "@/lib/session-timing";
import {
  planContextSchema,
  requireProgramStudyPlanTask,
  studyPlanTaskErrorResponse,
  validateExamTaskConfig,
  validatePracticeTaskQuestions,
  taskKeyFor,
} from "@/lib/study-plan-task";

const createInput = z.object({
  questionIds: z.array(z.string().min(1)).min(5).max(150),
  durationMinutes: z.number().int().min(5).max(240),
  paperDifficulty: z.number().min(1).max(10),
  planContext: planContextSchema.optional(),
  config: z.object({
    questionCount: z.number().int().min(5).max(150),
    templateId: z
      .enum(["NATIONAL_PREFECTURE", "GUANGDONG_PROVINCE"])
      .optional(),
    difficultyMode: z.string().max(20).optional(),
    minDifficulty: z.number().min(1).max(10).optional(),
    maxDifficulty: z.number().min(1).max(10).optional(),
  }),
});

function templateQuestionsValid(
  rows: {
    id: string;
    type: string;
    stem: string;
    materialId: string | null;
    category: { name: string };
  }[],
  questionIds: string[],
  templateId: "NATIONAL_PREFECTURE" | "GUANGDONG_PROVINCE",
) {
  const template = EXAM_TEMPLATES[templateId];
  const rowMap = new Map(rows.map((row) => [row.id, row]));
  const ordered = questionIds.map((id) => rowMap.get(id)!);
  const meta = buildExamQuestionMeta(questionIds, templateId);
  const politics = new Set(POLITICS_QUESTION_TYPES as readonly string[]);
  const general = new Set(GENERAL_KNOWLEDGE_QUESTION_TYPES as readonly string[]);
  const politicalTerms = [
    "习近平",
    "马克思",
    "毛泽东",
    "中国特色社会主义",
    "中国共产党",
    "党中央",
    "党的二十大",
    "二十届",
    "全会",
  ];
  for (let index = 0; index < ordered.length; index += 1) {
    const row = ordered[index];
    const itemMeta = meta[index];
    const section = template.sections.find(
      (item) => item.label === itemMeta.section,
    );
    const subtype = section?.subtypes?.find(
      (item) => item.label === itemMeta.subtype,
    );
    if (!section || row.category.name !== section.category) return false;
    if (subtype?.types.length && !subtype.types.includes(row.type)) return false;
    if (section.pool === "POLITICS" && !politics.has(row.type)) return false;
    if (
      section.pool === "GENERAL_KNOWLEDGE" &&
      (!general.has(row.type) || politicalTerms.some((term) => row.stem.includes(term)))
    )
      return false;
  }
  let offset = 0;
  for (const section of template.sections) {
    const sectionRows = ordered.slice(offset, offset + section.count);
    offset += section.count;
    if (section.category !== "资料分析") continue;
    for (let index = 0; index < sectionRows.length; index += 5) {
      const group = sectionRows.slice(index, index + 5);
      if (
        group.length !== 5 ||
        !group[0].materialId ||
        group.some((row) => row.materialId !== group[0].materialId)
      )
        return false;
    }
  }
  return true;
}

export async function GET() {
  const session = await getSession();
  if (!session?.id)
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "请先登录" } },
      { status: 401 },
    );
  const active = await prisma.examSession.findFirst({
    where: { userId: String(session.id), status: "IN_PROGRESS" },
    orderBy: { updatedAt: "desc" },
  });
  if (!active) return NextResponse.json({ data: null });
  const ids = active.questionIds as string[];
  const [rows, plan] = await Promise.all([
    prisma.question.findMany({
      where: { id: { in: ids } },
      include: publicQuestionInclude,
    }),
    active.studyPlanId
      ? prisma.studyPlan.findUnique({
          where: { id: active.studyPlanId },
          select: { tasks: true },
        })
      : null,
  ]);
  const map = new Map(rows.map((row) => [row.id, row]));
  const config =
    active.config &&
    typeof active.config === "object" &&
    !Array.isArray(active.config)
      ? (active.config as Record<string, unknown>)
      : {};
  const metaMap = new Map(
    parseExamQuestionMeta(active.questionMeta, ids, config.templateId).map(
      (item) => [item.id, item],
    ),
  );
  const questions = ids
    .map((id) => map.get(id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .map((row) => {
      const question = toPublicQuestion(row);
      const meta = metaMap.get(question.id);
      return {
        ...question,
        ...(meta?.section ? { examSection: meta.section } : {}),
        ...(meta?.subtype ? { examSubtype: meta.subtype } : {}),
      };
    });
  const deadlineAt = sessionDeadlineAt(active, active.durationMinutes);
  const remainingSeconds = Math.max(
    0,
    Math.ceil((deadlineAt.getTime() - Date.now()) / 1000),
  );
  return NextResponse.json({
    data: {
      id: active.id,
      questions,
      answers: active.answers,
      questionDurations: active.questionDurations,
      config: active.config,
      paperDifficulty: active.paperDifficulty,
      durationMinutes: active.durationMinutes,
      startedAt: active.startedAt,
      paused: Boolean(active.pausedAt),
      pausedAt: active.pausedAt,
      pausedDurationSeconds: active.pausedDurationSeconds,
      deadlineAt,
      remainingSeconds,
      studyPlanId: active.studyPlanId,
      studyPlanTaskKey: active.studyPlanTaskKey,
      planContext: (() => {
        const taskIndex = Array.isArray(plan?.tasks)
          ? plan.tasks.findIndex(
              (task, index) =>
                taskKeyFor(task, index) === active.studyPlanTaskKey,
            )
          : -1;
        return active.studyPlanId && active.studyPlanTaskKey && taskIndex >= 0
          ? {
              planId: active.studyPlanId,
              taskKey: active.studyPlanTaskKey,
              taskIndex,
            }
          : null;
      })(),
    },
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.id)
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "请先登录" } },
      { status: 401 },
    );
  const parsed = createInput.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: "考试会话参数不正确",
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  if (
    new Set(parsed.data.questionIds).size !== parsed.data.questionIds.length ||
    parsed.data.config.questionCount !== parsed.data.questionIds.length
  )
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "试卷题量或题目不正确" } },
      { status: 400 },
    );
  const rows = await prisma.question.findMany({
    where: { id: { in: parsed.data.questionIds }, status: "PUBLISHED" },
    include: { category: true },
  });
  if (rows.length !== parsed.data.questionIds.length)
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "试卷包含不可用题目" } },
      { status: 400 },
    );
  if (parsed.data.config.templateId) {
    const template = EXAM_TEMPLATES[parsed.data.config.templateId];
    if (
      parsed.data.questionIds.length !== template.questionCount ||
      parsed.data.durationMinutes !== template.durationMinutes ||
      !templateQuestionsValid(
        rows,
        parsed.data.questionIds,
        parsed.data.config.templateId,
      )
    )
      return NextResponse.json(
        { error: { code: "INVALID_INPUT", message: "试卷不符合所选正式卷型" } },
        { status: 400 },
      );
  }
  const scoreMap = new Map(rows.map((row) => [row.id, row.difficultyScore]));
  const paperDifficulty = scorePaperDifficulty(
    parsed.data.questionIds.map((id) => scoreMap.get(id) || 5),
  );
  const userId = String(session.id);
  let planTask = null;
  if (parsed.data.planContext) {
    try {
      planTask = await requireProgramStudyPlanTask(
        userId,
        parsed.data.planContext,
        "EXAM",
      );
      validateExamTaskConfig(planTask, {
        questionCount: parsed.data.questionIds.length,
        durationMinutes: parsed.data.durationMinutes,
        templateId: parsed.data.config.templateId,
      });
      validatePracticeTaskQuestions(planTask, rows);
    } catch (reason) {
      const response = studyPlanTaskErrorResponse(reason);
      if (response) return response;
      throw reason;
    }
  }
  try {
    const created = await prisma.$transaction(async (tx) => {
      await tx.examSession.updateMany({
        where: { userId, status: "IN_PROGRESS" },
        data: { status: "ABANDONED" },
      });
      return tx.examSession.create({
        data: {
          userId,
          studyPlanId: planTask?.planId,
          studyPlanTaskKey: planTask?.taskKey,
          questionIds: parsed.data.questionIds,
          answers: {},
          questionDurations: {},
          questionMeta: buildExamQuestionMeta(
            parsed.data.questionIds,
            parsed.data.config.templateId,
          ),
          config: parsed.data.config,
          paperDifficulty,
          durationMinutes: parsed.data.durationMinutes,
        },
      });
    });
    const deadlineAt = sessionDeadlineAt(created, created.durationMinutes);
    return NextResponse.json(
      { data: { id: created.id, startedAt: created.startedAt, deadlineAt, paused: false, pausedAt: null, pausedDurationSeconds: 0 } },
      { status: 201 },
    );
  } catch (reason) {
    if (
      reason instanceof Prisma.PrismaClientKnownRequestError &&
      reason.code === "P2002"
    )
      return NextResponse.json(
        { error: { code: "EXAM_ALREADY_ACTIVE", message: "已有模拟考试正在进行" } },
        { status: 409 },
      );
    throw reason;
  }
}

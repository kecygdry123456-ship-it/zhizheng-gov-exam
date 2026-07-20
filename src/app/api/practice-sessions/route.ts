import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { publicQuestionInclude, toPublicQuestion } from "@/lib/public-question";
import { scorePaperDifficulty } from "@/lib/difficulty";
import { questionMatchesScopes, questionScopesSchema } from "@/lib/question-scope";
import {
  planContextSchema,
  requireProgramStudyPlanTask,
  studyPlanTaskErrorResponse,
  taskKeyFor,
  validatePracticeTaskConfig,
  validatePracticeTaskQuestions,
} from "@/lib/study-plan-task";

const createInput = z.object({
  questionIds: z.array(z.string().min(1)).min(1).max(150),
  replacesSessionId: z.string().min(1).optional(),
  planContext: planContextSchema.optional(),
  config: z.object({
    count: z.number().int().min(1).max(150),
    category: z.string().max(30).optional(),
    scopes: questionScopesSchema.default([]),
    questionPool: z
      .enum(["POLITICS", "GENERAL_KNOWLEDGE"])
      .optional(),
    minDifficulty: z.number().min(1).max(10),
    maxDifficulty: z.number().min(1).max(10),
    availableTotal: z.number().int().nonnegative().max(100_000).optional(),
  }),
});

async function sessionData(active: {
  id: string;
  questionIds: Prisma.JsonValue;
  questionDurations: Prisma.JsonValue;
  config: Prisma.JsonValue;
  paperDifficulty: number;
  currentIndex: number;
  startedAt: Date;
  pausedAt: Date | null;
  pausedDurationSeconds: number;
  studyPlanId: string | null;
  studyPlanTaskKey: string | null;
}) {
  const ids = active.questionIds as string[];
  const [rows, attempts, plan] = await Promise.all([
    prisma.question.findMany({
      where: { id: { in: ids } },
      include: publicQuestionInclude,
    }),
    prisma.attempt.findMany({
      where: { practiceSessionId: active.id },
      select: {
        id: true,
        questionId: true,
        selected: true,
        correct: true,
      },
    }),
    active.studyPlanId
      ? prisma.studyPlan.findUnique({
          where: { id: active.studyPlanId },
          select: { tasks: true },
        })
      : null,
  ]);
  const questionMap = new Map(rows.map((row) => [row.id, row]));
  const questions = ids
    .map((id) => questionMap.get(id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .map(toPublicQuestion);
  const answerStates = Object.fromEntries(
    attempts
      .filter((attempt) => attempt.selected !== null)
      .map((attempt) => [
        attempt.questionId,
        {
          selected: attempt.selected,
          result: {
            attemptId: attempt.id,
            selected: attempt.selected,
          },
        },
      ]),
  );
  return {
    id: active.id,
    questions,
    answerStates,
    questionDurations: active.questionDurations,
    config: active.config,
    paperDifficulty: active.paperDifficulty,
    currentIndex: Math.min(Math.max(0, active.currentIndex), Math.max(0, questions.length - 1)),
    startedAt: active.startedAt,
    paused: Boolean(active.pausedAt),
    pausedAt: active.pausedAt,
    pausedDurationSeconds: active.pausedDurationSeconds,
    studyPlanId: active.studyPlanId,
    studyPlanTaskKey: active.studyPlanTaskKey,
    planContext: (() => {
      const taskIndex = Array.isArray(plan?.tasks)
        ? plan.tasks.findIndex(
            (task, index) => taskKeyFor(task, index) === active.studyPlanTaskKey,
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
  };
}

export async function GET() {
  const session = await getSession();
  if (!session?.id)
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "请先登录" } },
      { status: 401 },
    );
  const active = await prisma.practiceSession.findFirst({
    where: { userId: String(session.id), status: "IN_PROGRESS" },
    orderBy: { updatedAt: "desc" },
  });
  if (!active) return NextResponse.json({ data: null });
  return NextResponse.json({ data: await sessionData(active) });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.id)
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "请先登录" } },
      { status: 401 },
    );
  const input = await request.json().catch(() => null);
  if (
    input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    Array.isArray((input as Record<string, unknown>).questionIds) &&
    ((input as Record<string, unknown>).questionIds as unknown[]).length === 0
  )
    return NextResponse.json(
      {
        error: {
          code: "INSUFFICIENT_QUESTIONS",
          message: "当前条件下没有可用题目，请调整训练设置",
          details: null,
        },
      },
      { status: 409 },
    );
  const parsed = createInput.safeParse(input);
  if (!parsed.success)
    return NextResponse.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: "专项练习会话参数不正确",
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  if (new Set(parsed.data.questionIds).size !== parsed.data.questionIds.length)
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "专项练习包含重复题目" } },
      { status: 400 },
    );
  if (parsed.data.config.minDifficulty > parsed.data.config.maxDifficulty)
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "最低难度不能高于最高难度" } },
      { status: 400 },
    );
  const rows = await prisma.question.findMany({
    where: { id: { in: parsed.data.questionIds }, status: "PUBLISHED" },
    select: {
      id: true,
      type: true,
      stem: true,
      difficultyScore: true,
      materialId: true,
      category: { select: { name: true } },
    },
  });
  if (rows.length !== parsed.data.questionIds.length)
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "专项练习包含不可用题目" } },
      { status: 400 },
    );
  if (
    (parsed.data.config.category && rows.some((row) => row.category.name !== parsed.data.config.category)) ||
    rows.some((row) => !questionMatchesScopes(row, parsed.data.config.scopes)) ||
    rows.some((row) => row.difficultyScore < parsed.data.config.minDifficulty || row.difficultyScore > parsed.data.config.maxDifficulty)
  ) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "专项练习题目与筛选配置不匹配" } },
      { status: 400 },
    );
  }
  const difficultyMap = new Map(rows.map((row) => [row.id, row.difficultyScore]));
  const userId = String(session.id);
  let planTask = null;
  if (parsed.data.planContext) {
    try {
      planTask = await requireProgramStudyPlanTask(
        userId,
        parsed.data.planContext,
        "PRACTICE",
      );
      validatePracticeTaskConfig(planTask, parsed.data.config);
      validatePracticeTaskQuestions(planTask, rows);
    } catch (reason) {
      const response = studyPlanTaskErrorResponse(reason);
      if (response) return response;
      throw reason;
    }
  }
  try {
    const created = await prisma.$transaction(async (tx) => {
      if (parsed.data.replacesSessionId) {
        const replaced = await tx.practiceSession.updateMany({
          where: {
            id: parsed.data.replacesSessionId,
            userId,
            status: "IN_PROGRESS",
          },
          data: { status: "ABANDONED", completedAt: new Date() },
        });
        if (replaced.count !== 1)
          throw new Error("PRACTICE_SESSION_CONFLICT");
      } else {
        const active = await tx.practiceSession.findFirst({
          where: { userId, status: "IN_PROGRESS" },
          select: { id: true },
        });
        if (active) throw new Error("PRACTICE_SESSION_CONFLICT");
      }
      return tx.practiceSession.create({
        data: {
          userId,
          studyPlanId: planTask?.planId,
          studyPlanTaskKey: planTask?.taskKey,
          questionIds: parsed.data.questionIds,
          answers: {},
          questionDurations: {},
          config: parsed.data.config,
          paperDifficulty: scorePaperDifficulty(
            parsed.data.questionIds.map((id) => difficultyMap.get(id) || 5),
          ),
        },
      });
    });
    return NextResponse.json(
      { data: { id: created.id, startedAt: created.startedAt, paused: false, pausedAt: null, pausedDurationSeconds: 0 } },
      { status: 201 },
    );
  } catch (reason) {
    if (
      (reason instanceof Prisma.PrismaClientKnownRequestError &&
        reason.code === "P2002") ||
      (reason instanceof Error &&
        reason.message === "PRACTICE_SESSION_CONFLICT")
    ) {
      return NextResponse.json(
        {
          error: {
            code: "PRACTICE_ALREADY_ACTIVE",
            message: "专项练习状态已变化，正在恢复当前练习",
          },
        },
        { status: 409 },
      );
    }
    throw reason;
  }
}

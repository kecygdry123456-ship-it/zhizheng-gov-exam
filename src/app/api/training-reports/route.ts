import { after, NextResponse } from "next/server";
import { Buffer } from "node:buffer";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import {
  buildTrainingReportSnapshot,
  fitQuestionDurationsToTotal,
} from "@/lib/training-report";
import { evaluateTrainingReport } from "@/lib/training-report-evaluation-service";
import { effectiveElapsedSeconds } from "@/lib/session-timing";
import { withQuestionReviews } from "@/lib/training-report-review";

const practiceReportInput = z.object({
  practiceSessionId: z.string().min(1),
  title: z.string().trim().min(2).max(100).default("专项练习"),
});

const reportListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  cursor: z.string().trim().min(1).max(512).optional(),
});

const reportCursor = z.object({
  completedAt: z.string().datetime(),
  id: z.string().min(1).max(100),
});

type ReportCursor = z.infer<typeof reportCursor>;

function encodeReportCursor(cursor: ReportCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeReportCursor(value: string) {
  try {
    return reportCursor.safeParse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
  } catch {
    return reportCursor.safeParse(null);
  }
}

function scheduleEvaluation(reportId: string, userId: string) {
  if (process.env.DISABLE_BACKGROUND_REPORT_EVALUATION === "1") return;
  after(async () => {
    try {
      await evaluateTrainingReport(reportId, userId);
    } catch {
      // The persisted EVALUATING lease makes this safely retryable from the UI.
    }
  });
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.id)
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "请先登录" } },
      { status: 401 },
    );
  const url = new URL(request.url);
  const parsed = reportListQuery.safeParse({
    limit: url.searchParams.get("limit") || undefined,
    cursor: url.searchParams.get("cursor") || undefined,
  });
  if (!parsed.success)
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "分页参数不正确" } },
      { status: 400 },
    );
  const decodedCursor = parsed.data.cursor
    ? decodeReportCursor(parsed.data.cursor)
    : null;
  if (decodedCursor && !decodedCursor.success)
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "分页游标不正确" } },
      { status: 400 },
    );
  const cursor = decodedCursor?.data;
  const reports = await prisma.trainingReport.findMany({
    where: {
      userId: String(session.id),
      ...(cursor
        ? {
            OR: [
              { completedAt: { lt: new Date(cursor.completedAt) } },
              {
                completedAt: new Date(cursor.completedAt),
                id: { lt: cursor.id },
              },
            ],
          }
        : {}),
    },
    orderBy: [{ completedAt: "desc" }, { id: "desc" }],
    take: parsed.data.limit + 1,
  });
  const hasMore = reports.length > parsed.data.limit;
  const items = hasMore ? reports.slice(0, parsed.data.limit) : reports;
  const lastItem = items.at(-1);
  const nextCursor =
    hasMore && lastItem
      ? encodeReportCursor({
          completedAt: lastItem.completedAt.toISOString(),
          id: lastItem.id,
        })
      : null;
  const userId = String(session.id);
  const enrichedItems = await Promise.all(
    items.map((report) => withQuestionReviews(report, userId)),
  );
  return NextResponse.json({ data: { items: enrichedItems.filter(Boolean), nextCursor } });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.id)
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "请先登录" } },
      { status: 401 },
    );
  const parsed = practiceReportInput.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: "练习总结参数不正确",
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  const userId = String(session.id);
  const existing = await prisma.trainingReport.findFirst({
    where: { practiceSessionId: parsed.data.practiceSessionId, userId },
  });
  if (existing) {
    if (["PENDING", "EVALUATING"].includes(existing.evaluationStatus))
      scheduleEvaluation(existing.id, userId);
    return NextResponse.json({ data: await withQuestionReviews(existing, userId) });
  }
  const active = await prisma.practiceSession.findFirst({
    where: {
      id: parsed.data.practiceSessionId,
      userId,
      status: "IN_PROGRESS",
    },
  });
  if (!active)
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "专项练习会话已经失效" } },
      { status: 400 },
    );
  const completedAt = new Date();
  try {
    const report = await prisma.$transaction(async (tx) => {
      const claimed = await tx.practiceSession.updateMany({
        where: { id: active.id, userId, status: "IN_PROGRESS" },
        data: { status: "SUBMITTED", completedAt },
      });
      if (claimed.count !== 1) throw new Error("PRACTICE_ALREADY_SUBMITTED");
      const claimedSession = await tx.practiceSession.findUniqueOrThrow({
        where: { id: active.id },
      });
      const questionIds = claimedSession.questionIds as string[];
      const [questions, attempts] = await Promise.all([
        tx.question.findMany({
          where: { id: { in: questionIds } },
          include: { category: true },
        }),
        tx.attempt.findMany({
          where: { practiceSessionId: active.id },
          select: { id: true, questionId: true, correct: true },
        }),
      ]);
      if (questions.length !== questionIds.length)
        throw new Error("PRACTICE_QUESTIONS_MISSING");
      if (!attempts.length) throw new Error("PRACTICE_NO_ATTEMPTS");
      const questionMap = new Map(
        questions.map((question) => [question.id, question]),
      );
      const orderedQuestions = questionIds.map((id) => questionMap.get(id)!);
      const storedDurations =
        claimedSession.questionDurations &&
        typeof claimedSession.questionDurations === "object" &&
        !Array.isArray(claimedSession.questionDurations)
          ? (claimedSession.questionDurations as Record<string, number>)
          : {};
      const elapsed = Math.min(
        8 * 60 * 60,
        effectiveElapsedSeconds(claimedSession, completedAt),
      );
      const requestedDuration = Math.min(
        elapsed,
        Object.values(storedDurations).reduce(
          (sum, value) => sum + Math.max(0, Number(value) || 0),
          0,
        ),
      );
      const questionDurations = fitQuestionDurationsToTotal(
        questionIds,
        storedDurations,
        requestedDuration,
      );
      const snapshot = buildTrainingReportSnapshot({
        questions: orderedQuestions.map((question) => ({
          id: question.id,
          category: question.category.name,
          type: question.type,
          difficultyScore: question.difficultyScore,
        })),
        attempts,
        questionDurations,
        durationSeconds: requestedDuration,
      });
      return tx.trainingReport.create({
        data: {
          userId,
          studyPlanId: claimedSession.studyPlanId,
          studyPlanTaskKey: claimedSession.studyPlanTaskKey,
          practiceSessionId: active.id,
          clientKey: `practice:${active.id}`,
          mode: "PRACTICE",
          title: parsed.data.title,
          questionIds,
          attemptIds: attempts.map((attempt) => attempt.id),
          questionDurations: snapshot.questionDurations,
          durationSeconds: snapshot.durationSeconds,
          inactiveDurationSeconds: snapshot.inactiveDurationSeconds,
          total: snapshot.total,
          answered: snapshot.answered,
          correct: snapshot.correct,
          accuracy: snapshot.accuracy,
          difficultyScore: snapshot.difficultyScore,
          sections: snapshot.sections,
          startedAt: claimedSession.startedAt,
          completedAt,
        },
      });
    });
    scheduleEvaluation(report.id, userId);
    return NextResponse.json(
      { data: await withQuestionReviews(report, userId) },
      { status: 201 },
    );
  } catch (reason) {
    if (reason instanceof Error && reason.message === "PRACTICE_ALREADY_SUBMITTED") {
      const report = await prisma.trainingReport.findFirst({
        where: { practiceSessionId: active.id, userId },
      });
      if (report) {
        if (["PENDING", "EVALUATING"].includes(report.evaluationStatus))
          scheduleEvaluation(report.id, userId);
        return NextResponse.json({ data: await withQuestionReviews(report, userId) });
      }
    }
    if (reason instanceof Error && reason.message === "PRACTICE_QUESTIONS_MISSING")
      return NextResponse.json(
        { error: { code: "INVALID_INPUT", message: "专项练习题目已不可用" } },
        { status: 409 },
      );
    if (reason instanceof Error && reason.message === "PRACTICE_NO_ATTEMPTS")
      return NextResponse.json(
        { error: { code: "INVALID_INPUT", message: "至少完成一道题后才能生成练习总结" } },
        { status: 400 },
      );
    throw reason;
  }
}

import { after, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { EXAM_TEMPLATES, isExamTemplateId } from "@/lib/exam-templates";
import { parseExamQuestionMeta } from "@/lib/exam-question-meta";
import {
  buildTrainingReportSnapshot,
  fitQuestionDurationsToTotal,
} from "@/lib/training-report";
import { evaluateTrainingReport } from "@/lib/training-report-evaluation-service";
import { effectiveElapsedSeconds, sessionDeadlineAt } from "@/lib/session-timing";
import { withQuestionReviews } from "@/lib/training-report-review";

const examInput = z
  .object({
    answers: z
      .array(
        z.object({
          questionId: z.string().min(1),
          selected: z.number().int().nonnegative(),
        }),
      )
      .max(200),
    duration: z.number().int().nonnegative().max(8 * 60 * 60).default(0),
    questionDurations: z
      .record(
        z.string().min(1),
        z.number().int().nonnegative().max(8 * 60 * 60),
      )
      .default({}),
    sessionId: z.string().min(1),
  })
  .superRefine((value, context) => {
    const ids = value.answers.map((item) => item.questionId);
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        path: ["answers"],
        message: "同一道题不能重复提交",
      });
  });

function responseData(report: {
  answered: number;
  correct: number;
  attemptIds: unknown;
  submittedAt?: Date | null;
  completedAt: Date;
}) {
  return {
    answered: report.answered,
    correct: report.correct,
    attemptIds: Array.isArray(report.attemptIds) ? report.attemptIds : [],
    submittedAt: (report.submittedAt || report.completedAt).toISOString(),
    report,
  };
}

function scheduleEvaluation(reportId: string, userId: string) {
  if (process.env.DISABLE_BACKGROUND_REPORT_EVALUATION === "1") return;
  after(async () => {
    try {
      await evaluateTrainingReport(reportId, userId);
    } catch {
      // A stale EVALUATING lease is reclaimed when the report is reopened.
    }
  });
}

type LockedExamSession = {
  id: string;
  status: string;
  questionIds: Prisma.JsonValue;
  answers: Prisma.JsonValue;
  questionDurations: Prisma.JsonValue;
  questionMeta: Prisma.JsonValue;
  config: Prisma.JsonValue;
  durationMinutes: number;
  startedAt: Date;
  pausedAt: Date | null;
  pausedDurationSeconds: number;
  studyPlanId: string | null;
  studyPlanTaskKey: string | null;
};

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.id)
    return NextResponse.json(
      {
        error: { code: "UNAUTHORIZED", message: "请先登录", details: null },
      },
      { status: 401 },
    );
  const parsed = examInput.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: "试卷答案不正确",
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  const userId = String(session.id);
  const { answers: submittedAnswers, sessionId } = parsed.data;
  const existingReport = await prisma.trainingReport.findFirst({
    where: { examSessionId: sessionId, userId },
  });
  if (existingReport) {
    if (["PENDING", "EVALUATING"].includes(existingReport.evaluationStatus))
      scheduleEvaluation(existingReport.id, userId);
    const report = await withQuestionReviews(existingReport, userId);
    return NextResponse.json({ data: responseData(report || existingReport) });
  }

  const activeExam = await prisma.examSession.findFirst({
    where: { id: sessionId, userId, status: "IN_PROGRESS" },
  });
  if (!activeExam)
    return NextResponse.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: "考试会话已经失效",
          details: null,
        },
      },
      { status: 400 },
    );
  const sessionQuestionIds = activeExam.questionIds as string[];
  const questionSet = new Set(sessionQuestionIds);
  if (
    submittedAnswers.some((answer) => !questionSet.has(answer.questionId)) ||
    Object.keys(parsed.data.questionDurations).some((id) => !questionSet.has(id))
  )
    return NextResponse.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: "答案或用时包含不属于当前考试的题目",
          details: null,
        },
      },
      { status: 400 },
    );
  const questions = await prisma.question.findMany({
    where: { id: { in: sessionQuestionIds } },
    include: { category: true },
  });
  if (questions.length !== sessionQuestionIds.length)
    return NextResponse.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: "试卷中包含不存在的题目",
          details: null,
        },
      },
      { status: 400 },
    );
  const questionMap = new Map(questions.map((item) => [item.id, item]));

  const completedAt = new Date();
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Row locking makes this read happen after every PATCH that acquired the
      // session first, so submission cannot overwrite a just-saved answer with
      // the stale snapshot read before the transaction.
      const lockedRows = await tx.$queryRaw<LockedExamSession[]>(Prisma.sql`
        SELECT "id", "status", "questionIds", "answers",
               "questionDurations", "questionMeta", "config",
               "durationMinutes", "startedAt", "pausedAt",
               "pausedDurationSeconds", "studyPlanId", "studyPlanTaskKey"
        FROM "ExamSession"
        WHERE "id" = ${sessionId} AND "userId" = ${userId}
        FOR UPDATE
      `);
      const claimedSession = lockedRows[0];
      if (!claimedSession || claimedSession.status !== "IN_PROGRESS")
        throw new Error("EXAM_ALREADY_SUBMITTED");

      const lockedQuestionIds = claimedSession.questionIds as string[];
      if (
        lockedQuestionIds.length !== sessionQuestionIds.length ||
        lockedQuestionIds.some((id, index) => id !== sessionQuestionIds[index])
      )
        throw new Error("EXAM_SESSION_CHANGED");
      const deadlineAt = sessionDeadlineAt(
        claimedSession,
        claimedSession.durationMinutes,
        completedAt,
      );
      const expired = completedAt.getTime() >= deadlineAt.getTime();
      const persistedAnswers =
        claimedSession.answers &&
        typeof claimedSession.answers === "object" &&
        !Array.isArray(claimedSession.answers)
          ? (claimedSession.answers as Record<string, number>)
          : {};
      const effectiveAnswerMap = expired
        ? persistedAnswers
        : {
            ...persistedAnswers,
            ...Object.fromEntries(
              submittedAnswers.map((answer) => [
                answer.questionId,
                answer.selected,
              ]),
            ),
          };
      const answers = Object.entries(effectiveAnswerMap).map(
        ([questionId, selected]) => ({ questionId, selected }),
      );
      for (const answer of answers) {
        const question = questionMap.get(answer.questionId);
        const options = Array.isArray(question?.options) ? question.options : [];
        if (
          !question ||
          !Number.isInteger(answer.selected) ||
          answer.selected < 0 ||
          answer.selected >= options.length
        )
          throw new Error("EXAM_INVALID_STORED_ANSWER");
      }

      const elapsed = effectiveElapsedSeconds(claimedSession, completedAt);
      const durationSeconds = Math.min(
        claimedSession.durationMinutes * 60,
        elapsed,
      );
      const persistedDurations =
        claimedSession.questionDurations &&
        typeof claimedSession.questionDurations === "object" &&
        !Array.isArray(claimedSession.questionDurations)
          ? (claimedSession.questionDurations as Record<string, number>)
          : {};
      const mergedDurations = Object.fromEntries(
        sessionQuestionIds.map((id) => [
          id,
          Math.max(
            persistedDurations[id] || 0,
            // At the deadline answers are frozen, but the submit payload may
            // still carry the current question's final timing segment. It is
            // report-only data and is fitted to the server-derived total below.
            parsed.data.questionDurations[id] || 0,
          ),
        ]),
      );
      const questionDurations = fitQuestionDurationsToTotal(
        sessionQuestionIds,
        mergedDurations,
        durationSeconds,
      );
      const config =
        claimedSession.config &&
        typeof claimedSession.config === "object" &&
        !Array.isArray(claimedSession.config)
          ? (claimedSession.config as Record<string, unknown>)
          : {};
      const metaMap = new Map(
        parseExamQuestionMeta(
          claimedSession.questionMeta,
          sessionQuestionIds,
          config.templateId,
        ).map((item) => [item.id, item]),
      );
      const orderedQuestions = sessionQuestionIds.map(
        (id) => questionMap.get(id)!,
      );
      const answerMap = new Map(
        answers.map((answer) => [answer.questionId, answer]),
      );
      const attemptRecords = answers.map((answer) => {
        const question = questionMap.get(answer.questionId)!;
        return {
          userId,
          questionId: answer.questionId,
          selected: answer.selected,
          correct: answer.selected === question.answer,
          mode: "EXAM" as const,
          duration: questionDurations[answer.questionId] || 0,
        };
      });
      const snapshot = buildTrainingReportSnapshot({
        questions: orderedQuestions.map((question) => {
          const meta = metaMap.get(question.id);
          return {
            id: question.id,
            category: question.category.name,
            type: question.type,
            difficultyScore: question.difficultyScore,
            section: meta?.section,
            subtype: meta?.subtype,
          };
        }),
        attempts: attemptRecords.map((attempt) => ({
          id: attempt.questionId,
          questionId: attempt.questionId,
          correct: attempt.correct,
        })),
        questionDurations,
        durationSeconds,
      });
      const templateId = isExamTemplateId(config.templateId)
        ? config.templateId
        : null;

      await tx.examSession.update({
        where: { id: claimedSession.id },
        data: {
          status: "SUBMITTED",
          submittedAt: completedAt,
          answers: Object.fromEntries(
            sessionQuestionIds
              .filter((id) => answerMap.has(id))
              .map((id) => [id, answerMap.get(id)!.selected]),
          ),
          questionDurations,
        },
      });
      const createdAttempts = await Promise.all(
        attemptRecords.map((record) => tx.attempt.create({ data: record })),
      );
      const report = await tx.trainingReport.create({
        data: {
          userId,
          studyPlanId: claimedSession.studyPlanId,
          studyPlanTaskKey: claimedSession.studyPlanTaskKey,
          examSessionId: claimedSession.id,
          clientKey: `exam:${claimedSession.id}`,
          mode: "EXAM",
          title: templateId
            ? `${EXAM_TEMPLATES[templateId].name}模拟考试`
            : "模拟考试",
          templateId,
          questionIds: sessionQuestionIds,
          attemptIds: createdAttempts.map((item) => item.id),
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
      return { report, createdAttempts };
    });
    scheduleEvaluation(result.report.id, userId);
    const responseReport = {
        ...result.report,
        submittedAt: completedAt,
        attemptIds: result.createdAttempts.map((item) => item.id),
      };
    const enriched = await withQuestionReviews(result.report, userId);
    return NextResponse.json({
      data: responseData(enriched ? { ...enriched, submittedAt: completedAt } : responseReport),
    });
  } catch (reason) {
    if (reason instanceof Error && reason.message === "EXAM_ALREADY_SUBMITTED") {
      const report = await prisma.trainingReport.findFirst({
        where: { examSessionId: activeExam.id, userId },
      });
      if (report) {
        if (["PENDING", "EVALUATING"].includes(report.evaluationStatus))
          scheduleEvaluation(report.id, userId);
        const enriched = await withQuestionReviews(report, userId);
        return NextResponse.json({ data: responseData(enriched || report) });
      }
    }
    if (
      reason instanceof Error &&
      reason.message === "EXAM_INVALID_STORED_ANSWER"
    )
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "试卷中包含无效选项",
            details: null,
          },
        },
        { status: 400 },
      );
    if (reason instanceof Error && reason.message === "EXAM_SESSION_CHANGED")
      return NextResponse.json(
        {
          error: {
            code: "EXAM_SESSION_CHANGED",
            message: "考试会话内容已变化，请重新进入考试",
            details: null,
          },
        },
        { status: 409 },
      );
    throw reason;
  }
}

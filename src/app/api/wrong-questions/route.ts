import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { publicQuestionInclude, toPublicQuestion } from "@/lib/public-question";

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export async function GET() {
  const session = await getSession();
  if (!session?.id)
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "请先登录" } },
      { status: 401 },
    );

  const reports = await prisma.trainingReport.findMany({
    where: { userId: String(session.id), answered: { gt: 0 } },
    select: {
      id: true,
      title: true,
      mode: true,
      total: true,
      answered: true,
      correct: true,
      completedAt: true,
      questionIds: true,
      attemptIds: true,
    },
    orderBy: [{ completedAt: "desc" }, { id: "desc" }],
  });
  const reportsWithWrongAnswers = reports.filter(
    (report) => report.correct < report.answered,
  );
  const attemptIds = [
    ...new Set(
      reportsWithWrongAnswers.flatMap((report) => stringArray(report.attemptIds)),
    ),
  ];
  const attempts = attemptIds.length
    ? await prisma.attempt.findMany({
        where: {
          id: { in: attemptIds },
          userId: String(session.id),
          correct: false,
          question: { status: "PUBLISHED" },
        },
        include: { question: { include: publicQuestionInclude } },
      })
    : [];
  const attemptMap = new Map(attempts.map((attempt) => [attempt.id, attempt]));

  const sets = reportsWithWrongAnswers.flatMap((report) => {
    const reportAttemptIds = new Set(stringArray(report.attemptIds));
    const wrongByQuestionId = new Map(
      attempts
        .filter((attempt) => reportAttemptIds.has(attempt.id))
        .map((attempt) => [attempt.questionId, attempt]),
    );
    const orderedAttempts = stringArray(report.questionIds)
      .map((questionId) => wrongByQuestionId.get(questionId))
      .filter((attempt): attempt is NonNullable<typeof attempt> => Boolean(attempt));
    const orderedAttemptIds = new Set(orderedAttempts.map((attempt) => attempt.id));
    const remainingAttempts = stringArray(report.attemptIds)
      .map((attemptId) => attemptMap.get(attemptId))
      .filter(
        (attempt): attempt is NonNullable<typeof attempt> =>
          Boolean(attempt && !orderedAttemptIds.has(attempt.id)),
      );
    const wrongAttempts = [...orderedAttempts, ...remainingAttempts];
    if (!wrongAttempts.length) return [];
    return [
      {
        id: report.id,
        title: report.title,
        mode: report.mode,
        total: report.total,
        answered: report.answered,
        wrongCount: wrongAttempts.length,
        completedAt: report.completedAt,
        questions: wrongAttempts.map((attempt) => toPublicQuestion(attempt.question)),
      },
    ];
  });

  return NextResponse.json({ data: sets });
}

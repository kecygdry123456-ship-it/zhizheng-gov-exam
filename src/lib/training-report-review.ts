import type { TrainingReport } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function withQuestionReviews<T extends TrainingReport>(
  report: T,
  userId: string,
) {
  if (report.userId !== userId) return null;
  const questionIds = Array.isArray(report.questionIds)
    ? report.questionIds.filter((id): id is string => typeof id === "string")
    : [];
  const attemptIds = Array.isArray(report.attemptIds)
    ? report.attemptIds.filter((id): id is string => typeof id === "string")
    : [];
  const [questions, attempts] = await Promise.all([
    prisma.question.findMany({
      where: { id: { in: questionIds } },
      include: { category: true, material: true },
    }),
    prisma.attempt.findMany({
      where: { id: { in: attemptIds }, userId },
      select: {
        id: true,
        questionId: true,
        selected: true,
        correct: true,
        duration: true,
      },
    }),
  ]);
  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const attemptMap = new Map(attempts.map((attempt) => [attempt.questionId, attempt]));
  const durations = report.questionDurations &&
    typeof report.questionDurations === "object" &&
    !Array.isArray(report.questionDurations)
      ? report.questionDurations as Record<string, number>
      : {};
  const questionReviews = questionIds.flatMap((questionId, index) => {
    const question = questionMap.get(questionId);
    if (!question) return [];
    const attempt = attemptMap.get(questionId);
    return [{
      questionId,
      index: index + 1,
      category: question.category.name,
      type: question.type,
      stem: question.stem,
      options: question.options as string[],
      selected: attempt?.selected ?? null,
      correctAnswer: question.answer,
      correct: Boolean(attempt?.correct),
      explanation: question.explanation,
      durationSeconds: Math.max(0, Number(durations[questionId] ?? attempt?.duration ?? 0) || 0),
      material: question.material
        ? {
            id: question.material.id,
            title: question.material.title,
            content: question.material.content,
            blocks: question.material.blocks,
          }
        : null,
    }];
  });
  return { ...report, questionReviews };
}

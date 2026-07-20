import { prisma } from "@/lib/prisma";
import { getModelRequestTimeoutMs } from "@/lib/model-json-client";
import { consumeTrainingEvaluationModelRequest } from "@/lib/model-usage";
import {
  applyTrainingEvaluation,
  generateTrainingEvaluation,
  type TrainingReportSection,
} from "@/lib/training-report";

export async function evaluateTrainingReport(reportId: string, userId: string) {
  let report = await prisma.trainingReport.findFirst({
    where: { id: reportId, userId },
  });
  if (!report) return null;
  if (["READY", "FALLBACK"].includes(report.evaluationStatus))
    return { report, busy: false };

  // The browser polls for 75 seconds. Keep the crash-recovery lease just above
  // the full model-operation deadline so a dead worker can be reclaimed there.
  const leaseMilliseconds = getModelRequestTimeoutMs() + 10_000;
  const leaseExpiredBefore = new Date(Date.now() - leaseMilliseconds);
  if (
    report.evaluationStatus === "EVALUATING" &&
    report.evaluationClaimedAt &&
    report.evaluationClaimedAt > leaseExpiredBefore
  )
    return { report, busy: true };
  if (report.evaluationStatus === "EVALUATING") {
    await prisma.trainingReport.updateMany({
      where: {
        id: report.id,
        userId,
        evaluationStatus: "EVALUATING",
        OR: [
          { evaluationClaimedAt: null },
          { evaluationClaimedAt: { lte: leaseExpiredBefore } },
        ],
      },
      data: { evaluationStatus: "PENDING", evaluationClaimedAt: null },
    });
    report = await prisma.trainingReport.findUniqueOrThrow({
      where: { id: report.id },
    });
  }

  const claimedAt = new Date();
  const claimed = await prisma.trainingReport.updateMany({
    where: { id: report.id, userId, evaluationStatus: "PENDING" },
    data: { evaluationStatus: "EVALUATING", evaluationClaimedAt: claimedAt },
  });
  if (claimed.count !== 1) {
    const current = await prisma.trainingReport.findUniqueOrThrow({
      where: { id: report.id },
    });
    return { report: current, busy: true };
  }

  const claimedReport = await prisma.trainingReport.findUniqueOrThrow({
    where: { id: report.id },
  });
  const sections = claimedReport.sections as unknown as TrainingReportSection[];
  try {
    const generated = await generateTrainingEvaluation({
      mode: claimedReport.mode,
      total: claimedReport.total,
      answered: claimedReport.answered,
      correct: claimedReport.correct,
      accuracy: claimedReport.accuracy,
      durationSeconds: claimedReport.durationSeconds,
      difficultyScore: claimedReport.difficultyScore,
      sections,
      modelDeadlineAt: claimedAt.getTime() + getModelRequestTimeoutMs(),
      beforeModelRequest: () =>
        consumeTrainingEvaluationModelRequest(userId),
    });
    const finalized = await prisma.trainingReport.updateMany({
      where: {
        id: report.id,
        evaluationStatus: "EVALUATING",
        evaluationClaimedAt: claimedAt,
      },
      data: {
        sections: applyTrainingEvaluation(
          sections,
          generated.sectionEvaluations,
        ),
        overallEvaluation: generated.overallEvaluation,
        evaluationStatus: generated.status,
        evaluationSource: generated.source,
        evaluationClaimedAt: null,
      },
    });
    if (finalized.count !== 1) {
      const current = await prisma.trainingReport.findUniqueOrThrow({
        where: { id: report.id },
      });
      return { report: current, busy: true };
    }
  } catch (reason) {
    await prisma.trainingReport.updateMany({
      where: {
        id: report.id,
        evaluationStatus: "EVALUATING",
        evaluationClaimedAt: claimedAt,
      },
      data: { evaluationStatus: "PENDING", evaluationClaimedAt: null },
    });
    throw reason;
  }
  const updated = await prisma.trainingReport.findUniqueOrThrow({
    where: { id: report.id },
  });
  return { report: updated, busy: false };
}

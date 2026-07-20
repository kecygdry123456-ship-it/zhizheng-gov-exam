import type { TrainingReport } from "./types";

const terminalStatuses = new Set(["READY", "FALLBACK"]);

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function completeTrainingEvaluation(reportId: string) {
  const deadline = Date.now() + 75_000;
  let lastError: Error | null = null;
  let consecutiveErrors = 0;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`/api/training-reports/${reportId}/evaluate`, {
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message || "练习评价生成失败");
      const report = body.data as TrainingReport;
      if (report && terminalStatuses.has(report.evaluationStatus)) return report;
      consecutiveErrors = 0;
      const retryAfter = Number(response.headers.get("Retry-After") || 2);
      await wait(Math.min(5_000, Math.max(500, retryAfter * 1000)));
    } catch (reason) {
      lastError =
        reason instanceof Error ? reason : new Error("练习评价生成失败");
      consecutiveErrors += 1;
      if (consecutiveErrors >= 3) throw lastError;
      await wait(1_500);
    }
  }
  throw lastError || new Error("练习评价生成超时，请稍后重试");
}

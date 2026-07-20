"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import type { LearningAnalysis, Overview, TrainingReport } from "./types";
import { PageTitle } from "./ui";
import {
  formatTrainingDuration,
  TrainingReportView,
} from "./training-report-view";
import { completeTrainingEvaluation } from "./training-report-client";

const REPORT_PAGE_SIZE = 10;
const ANALYSIS_CACHE_KEY = "zhizheng:learning-analysis";

type TrainingReportPage = {
  items: TrainingReport[];
  nextCursor: string | null;
};

export function StatisticsView({ overview }: { overview: Overview }) {
  const [reports, setReports] = useState<TrainingReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<TrainingReport | null>(
    null,
  );
  const [reportError, setReportError] = useState("");
  const [reportsLoading, setReportsLoading] = useState(true);
  const [loadingMoreReports, setLoadingMoreReports] = useState(false);
  const [nextReportCursor, setNextReportCursor] = useState<string | null>(null);
  const [evaluationError, setEvaluationError] = useState("");
  const [analysis, setAnalysis] = useState<LearningAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(true);
  const [analysisError, setAnalysisError] = useState("");
  const evaluationTarget = useRef<string | null>(null);
  const reportsRequestInFlight = useRef(false);
  const analysisRequestInFlight = useRef(false);
  const loadReportPage = useCallback(async (cursor: string | null = null) => {
    await Promise.resolve();
    if (reportsRequestInFlight.current) return;
    reportsRequestInFlight.current = true;
    const loadingMore = Boolean(cursor);
    if (loadingMore) setLoadingMoreReports(true);
    else setReportsLoading(true);
    setReportError("");
    try {
      const params = new URLSearchParams({ limit: String(REPORT_PAGE_SIZE) });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/training-reports?${params}`);
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message || "训练总结加载失败");
      const page = body.data as TrainingReportPage | undefined;
      if (
        !page ||
        !Array.isArray(page.items) ||
        (page.nextCursor !== null && typeof page.nextCursor !== "string")
      )
        throw new Error("训练总结返回格式不正确");
      setReports((current) => {
        if (!loadingMore) return page.items;
        const knownIds = new Set(current.map((item) => item.id));
        return [
          ...current,
          ...page.items.filter((item) => !knownIds.has(item.id)),
        ];
      });
      setNextReportCursor(page.nextCursor);
    } catch (reason) {
      setReportError(
        reason instanceof Error ? reason.message : "训练总结加载失败",
      );
    } finally {
      reportsRequestInFlight.current = false;
      if (loadingMore) setLoadingMoreReports(false);
      else setReportsLoading(false);
    }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(() => loadReportPage());
  }, [loadReportPage]);
  const loadAnalysis = useCallback(
    async (force = false) => {
      await Promise.resolve();
      if (analysisRequestInFlight.current) return;
      const signature = JSON.stringify({
        total: overview.total,
        correct: overview.correct,
        weeklyCompletedTasks: overview.weeklyCompletedTasks,
        categories: overview.categories,
        daily: overview.daily,
      });
      if (!force) {
        try {
          const cached = JSON.parse(
            sessionStorage.getItem(ANALYSIS_CACHE_KEY) || "null",
          ) as { signature?: string; data?: LearningAnalysis } | null;
          if (
            cached?.signature === signature &&
            cached.data?.headline &&
            Array.isArray(cached.data.actions)
          ) {
            setAnalysis(cached.data);
            setAnalysisLoading(false);
            return;
          }
        } catch {}
      }
      analysisRequestInFlight.current = true;
      setAnalysisLoading(true);
      setAnalysisError("");
      try {
        const response = await fetch("/api/statistics/analysis", {
          method: "POST",
        });
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error?.message || "综合学习分析生成失败");
        const next = body.data as LearningAnalysis | undefined;
        if (
          !next?.headline ||
          !next.overall ||
          !Array.isArray(next.actions)
        )
          throw new Error("综合学习分析返回格式不正确");
        setAnalysis(next);
        try {
          sessionStorage.setItem(
            ANALYSIS_CACHE_KEY,
            JSON.stringify({ signature, data: next }),
          );
        } catch {}
      } catch (reason) {
        setAnalysisError(
          reason instanceof Error ? reason.message : "综合学习分析生成失败",
        );
      } finally {
        analysisRequestInFlight.current = false;
        setAnalysisLoading(false);
      }
    },
    [overview],
  );
  useEffect(() => {
    void Promise.resolve().then(() => loadAnalysis());
  }, [loadAnalysis]);
  const openReport = async (report: TrainingReport) => {
    setSelectedReport(report);
    window.scrollTo({ top: 0 });
    setEvaluationError("");
    evaluationTarget.current = report.id;
    if (["READY", "FALLBACK"].includes(report.evaluationStatus)) return;
    try {
      const evaluated = await completeTrainingEvaluation(report.id);
      if (evaluationTarget.current !== report.id) return;
      setSelectedReport(evaluated);
      setReports((current) =>
        current.map((item) => (item.id === evaluated.id ? evaluated : item)),
      );
    } catch (reason) {
      if (evaluationTarget.current === report.id)
        setEvaluationError(
          reason instanceof Error ? reason.message : "练习评价生成失败",
        );
    }
  };
  if (selectedReport)
    return (
      <TrainingReportView
        report={selectedReport}
        title="训练总结详情"
        description={`${selectedReport.mode === "EXAM" ? "模拟考试" : "专项练习"} · ${new Date(selectedReport.completedAt).toLocaleString("zh-CN")}`}
        evaluationError={evaluationError}
        onRetryEvaluation={() => void openReport(selectedReport)}
        actions={
          <button
            onClick={() => {
              evaluationTarget.current = null;
              setEvaluationError("");
              setSelectedReport(null);
              window.scrollTo({ top: 0 });
            }}
            className="btn-ghost"
          >
            返回学习分析
          </button>
        }
      />
    );
  return (
    <div className="fade">
      <PageTitle
        title="学习分析"
        description="所有指标均根据当前账号作答记录计算。"
      />
      <div className="stats-grid grid grid-cols-4 gap-4">
        {[
          ["累计答题", overview.total, "题"],
          ["总体正确率", overview.accuracy, "%"],
          ["今日答题", overview.today, "题"],
          ["本周答题", overview.thisWeek, "题"],
        ].map(([label, value, unit]) => (
          <div className="card relative overflow-hidden p-5" key={String(label)}>
            <span className="text-sm text-slate-500">{label}</span>
            <div className="mt-3 text-3xl font-bold tracking-tight text-slate-900">
              {value}
              <small className="ml-1 text-xs text-slate-400">{unit}</small>
            </div>
          </div>
        ))}
      </div>
      <div className="two-col mt-5 grid grid-cols-[1.4fr_1fr] gap-5">
        <div className="card p-6 sm:p-7">
          <h2 className="font-bold">最近七天答题趋势</h2>
          <div className="mt-8 flex h-56 items-end justify-around border-b border-slate-200 px-2">
            {overview.daily.map((day) => {
              const height = overview.daily.reduce(
                (max, item) => Math.max(max, item.total),
                1,
              );
              return (
                <div
                  key={day.date}
                  className="flex h-full min-w-8 flex-col justify-end text-center"
                >
                  <span className="mb-2 text-[10px] text-slate-400">
                    {day.total}
                  </span>
                  <div
                    className="rounded-t bg-[#315f89]"
                    style={{
                      height: `${Math.max((day.total / height) * 85, day.total ? 8 : 1)}%`,
                    }}
                  />
                  <span className="mt-2 text-[10px] text-slate-400">
                    {day.date.slice(5)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="card p-6 sm:p-7">
          <h2 className="font-bold">模块能力</h2>
          <div className="mt-5 space-y-4">
            {overview.categories.length ? (
              overview.categories.map((item) => (
                <div key={item.name}>
                  <div className="mb-2 flex justify-between text-xs">
                    <span>{item.name}</span>
                    <span className="text-slate-400">
                      {item.accuracy}% · {item.total}题
                    </span>
                  </div>
                  <div className="progress">
                    <i style={{ width: `${item.accuracy}%` }} />
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">完成练习后显示模块数据。</p>
            )}
          </div>
        </div>
      </div>
      <section
        className="card mt-5 overflow-hidden"
        aria-labelledby="learning-analysis-title"
      >
        <header className="flex flex-col gap-3 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600">
              <Sparkles size={19} aria-hidden="true" />
            </span>
            <div>
              <h2 id="learning-analysis-title" className="font-bold text-slate-900">
                综合学习分析
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                {analysis?.source === "MODEL_API"
                  ? "由模型 API 综合累计表现与近期趋势生成"
                  : analysis
                    ? "模型暂不可用，已使用完整规则分析"
                    : "正在汇总作答、用时、难度与验收记录"}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn-ghost min-h-10 gap-2 text-xs"
            disabled={analysisLoading}
            onClick={() => void loadAnalysis(true)}
          >
            <RefreshCw
              size={14}
              className={analysisLoading ? "animate-spin" : ""}
              aria-hidden="true"
            />
            重新分析
          </button>
        </header>
        {analysisLoading && !analysis && (
          <p className="px-5 py-8 text-sm text-slate-500 sm:px-7" role="status">
            正在生成综合学习分析...
          </p>
        )}
        {analysisError && (
          <div className="mx-5 mt-5 flex flex-col gap-2 border-l-2 border-red-400 bg-red-50 px-4 py-3 text-sm text-red-700 sm:mx-7 sm:flex-row sm:items-center sm:justify-between">
            <span>{analysisError}</span>
            <button
              type="button"
              className="btn-ghost shrink-0 border-red-200 text-red-700"
              onClick={() => void loadAnalysis(true)}
            >
              重试
            </button>
          </div>
        )}
        {analysis && (
          <div className="px-5 py-6 sm:px-7 sm:py-7">
            <h3 className="text-lg font-bold text-slate-900">
              {analysis.headline}
            </h3>
            <p className="mt-3 whitespace-pre-line text-sm leading-7 text-slate-600">
              {analysis.overall}
            </p>
            <div className="mt-6 divide-y divide-slate-100 border-y border-slate-100">
              {[
                ["能力结构", analysis.ability],
                ["近期趋势", analysis.trend],
                ["优先级判断", analysis.priorities],
                ["下一阶段训练方案", analysis.trainingPlan],
              ].map(([heading, content]) => (
                <section key={heading} className="py-5">
                  <h3 className="text-sm font-bold text-slate-800">{heading}</h3>
                  <p className="mt-2 whitespace-pre-line text-sm leading-7 text-slate-600">
                    {content}
                  </p>
                </section>
              ))}
            </div>
            <section className="pt-5" aria-labelledby="analysis-actions-title">
              <h3 id="analysis-actions-title" className="text-sm font-bold text-slate-800">
                可执行行动
              </h3>
              <ol className="mt-3 space-y-3">
                {analysis.actions.map((action, index) => (
                  <li key={`${index}-${action}`} className="flex gap-3 text-sm leading-7 text-slate-600">
                    <span className="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-indigo-50 text-[11px] font-bold text-indigo-600">
                      {index + 1}
                    </span>
                    <span>{action}</span>
                  </li>
                ))}
              </ol>
            </section>
            <p className="mt-6 border-l-2 border-slate-200 pl-4 text-xs leading-6 text-slate-400">
              {analysis.caveat}
            </p>
          </div>
        )}
      </section>
      <section className="mt-8" aria-labelledby="recent-training-title">
        <div className="flex items-end justify-between gap-4 border-b border-slate-200 pb-3">
          <div>
            <p className="text-xs font-semibold text-indigo-600">历史记录</p>
            <h2 id="recent-training-title" className="mt-1 text-lg font-bold">
              最近训练总结
            </h2>
          </div>
          <span className="text-xs text-slate-400">按完成时间倒序</span>
        </div>
        {reportError && (
          <p className="mt-4 text-sm text-red-500">{reportError}</p>
        )}
        {reportsLoading && !reports.length && (
          <p className="mt-5 text-sm text-slate-500">正在加载训练总结...</p>
        )}
        {reports.length ? (
          <>
            <div className="mt-4 divide-y divide-slate-100 border-y border-slate-200">
              {reports.map((report) => (
                <button
                  key={report.id}
                  onClick={() => void openReport(report)}
                  className="flex min-h-16 w-full flex-col gap-2 bg-transparent px-1 py-4 text-left transition hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between sm:px-3"
                >
                  <span className="min-w-0">
                    <span className="block font-semibold text-slate-800">
                      {report.title}
                    </span>
                    <span className="mt-1 block text-xs text-slate-400">
                      {new Date(report.completedAt).toLocaleString("zh-CN")} ·{" "}
                      {report.mode === "EXAM" ? "模拟考试" : "专项练习"}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 sm:justify-end">
                    <span>作答 {report.answered}/{report.total}</span>
                    <span>正确率 {report.accuracy}%</span>
                    <span>用时 {formatTrainingDuration(report.durationSeconds)}</span>
                    <span>难度 {report.difficultyScore.toFixed(1)}/10</span>
                  </span>
                </button>
              ))}
            </div>
            {nextReportCursor && (
              <button
                type="button"
                className="btn-ghost mt-4 min-h-11 w-full sm:w-auto"
                disabled={loadingMoreReports}
                onClick={() => void loadReportPage(nextReportCursor)}
              >
                {loadingMoreReports
                  ? "正在加载..."
                  : reportError
                    ? "重试加载更多"
                    : "加载更多训练总结"}
              </button>
            )}
          </>
        ) : (
          !reportsLoading && !reportError && (
            <p className="mt-5 text-sm text-slate-500">
              完成下一次专项练习或模拟考试后，这里会保存完整总结。
            </p>
          )
        )}
        {!reportsLoading && reportError && !reports.length && (
          <button
            type="button"
            className="btn-ghost mt-4 min-h-11"
            onClick={() => void loadReportPage()}
          >
            重新加载训练总结
          </button>
        )}
      </section>
    </div>
  );
}

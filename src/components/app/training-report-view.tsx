"use client";

import type { ReactNode } from "react";
import {
  CheckCircle2,
  Clock3,
  Gauge,
  ListChecks,
  LoaderCircle,
  MessageSquareText,
  Sparkles,
} from "lucide-react";
import type {
  TrainingReport,
  TrainingReportEvaluationStatus,
  TrainingReportSection,
} from "./types";
import { PageTitle } from "./ui";
import { MaterialView } from "./material-view";
import { QuestionContent } from "./question-content";

export type TrainingReportViewProps = {
  report: TrainingReport;
  title?: string;
  description?: string;
  actions?: ReactNode;
  evaluationError?: string;
  onRetryEvaluation?: () => void;
};

export function TrainingReportView({
  report,
  title,
  description,
  actions,
  evaluationError,
  onRetryEvaluation,
}: TrainingReportViewProps) {
  const unanswered = Math.max(0, report.total - report.answered);

  return (
    <div className="fade mx-auto w-full max-w-6xl">
      <PageTitle
        title={title || (report.mode === "EXAM" ? "考试报告" : "专项练习已完成")}
        description={description || report.title}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryMetric
          icon={<Clock3 size={19} aria-hidden="true" />}
          label={report.mode === "EXAM" ? "考试总历时" : "练习时长"}
          value={formatDuration(report.durationSeconds)}
          hint={
            report.mode === "EXAM"
              ? report.inactiveDurationSeconds
                ? `含 ${formatDuration(report.inactiveDurationSeconds)} 未分配停留`
                : "从开考到交卷"
              : "本轮有效学习时间"
          }
          tone="primary"
        />
        <SummaryMetric
          icon={<ListChecks size={19} aria-hidden="true" />}
          label="作答情况"
          value={`${report.answered}/${report.total}`}
          hint={unanswered ? `${unanswered} 题未作答` : "已完成全部题目"}
          tone="slate"
        />
        <SummaryMetric
          icon={<CheckCircle2 size={19} aria-hidden="true" />}
          label="正确率"
          value={formatPercent(report.accuracy)}
          hint={`答对 ${report.correct} 题`}
          tone="success"
        />
        <SummaryMetric
          icon={<Gauge size={19} aria-hidden="true" />}
          label="综合难度"
          value={`${formatDifficulty(report.difficultyScore)}/10`}
          hint="按题目难度综合计算"
          tone="accent"
        />
      </div>

      <section className="card mt-6 overflow-hidden" aria-labelledby="training-breakdown-title">
        <header className="flex items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id="training-breakdown-title" className="font-bold text-slate-900">
              训练情况
            </h2>
            <p className="mt-1 text-xs text-slate-400">大板块汇总与细分题型明细</p>
          </div>
          <span className="pill shrink-0 bg-indigo-50 text-indigo-700">
            {report.mode === "EXAM" ? "模拟考试" : "专项练习"}
          </span>
        </header>

        <div className="border-t border-slate-100 bg-slate-50/80 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-indigo-600">本次汇总</p>
              <p className="mt-1 break-words text-sm font-bold text-slate-900">{report.title}</p>
            </div>
            <ReportMetrics
              items={[
                { label: "共计", value: `${report.total} 题` },
                { label: "答对", value: `${report.correct} 题`, tone: "success" },
                { label: "答错", value: `${Math.max(0, report.answered - report.correct)} 题`, tone: "danger" },
                { label: "未答", value: `${unanswered} 题`, tone: unanswered ? "danger" : "muted" },
                { label: "用时", value: formatDuration(report.durationSeconds) },
              ]}
            />
          </div>
        </div>

        {report.sections.map((section, sectionIndex) => (
          <article
            key={section.key || `${section.name}-${sectionIndex}`}
            className="border-t border-slate-200"
            aria-labelledby={`report-section-${sectionIndex}`}
          >
            <div
              className="flex min-w-0 flex-col gap-3 bg-white px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between"
              data-report-level="section"
            >
              <h3
                id={`report-section-${sectionIndex}`}
                className="min-w-0 break-words text-sm font-bold text-slate-900 sm:text-base"
              >
                {section.name}
              </h3>
              <ReportMetrics
                items={[
                  { label: "总题数", value: `${section.total} 题` },
                  { label: "答对", value: `${section.correct} 题`, tone: "success" },
                  { label: "正确率", value: formatPercent(section.accuracy), tone: "primary" },
                  { label: "用时", value: formatDuration(section.durationSeconds) },
                  { label: "难度", value: `${formatDifficulty(section.difficultyScore)}/10`, tone: "warning" },
                ]}
              />
            </div>

            {section.subtypes.length > 0 && (
              <div className="border-t border-slate-100 bg-slate-50/45 px-4 sm:px-6">
                {section.subtypes.map((subtype, subtypeIndex) => (
                  <div
                    key={subtype.key}
                    className={`flex min-w-0 flex-col gap-3 py-3.5 pl-3 sm:pl-5 lg:flex-row lg:items-center lg:justify-between ${
                      subtypeIndex ? "border-t border-slate-100" : ""
                    }`}
                    data-report-level="subtype"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" aria-hidden="true" />
                      <h4 className="min-w-0 break-words text-sm font-medium text-slate-600">
                        {subtype.name}
                      </h4>
                    </div>
                    <ReportMetrics
                      compact
                      items={[
                        { label: "总题数", value: `${subtype.total} 题` },
                        { label: "答对", value: `${subtype.correct} 题`, tone: "success" },
                        { label: "正确率", value: formatPercent(subtype.accuracy), tone: "primary" },
                        { label: "用时", value: formatDuration(subtype.durationSeconds) },
                        { label: "难度", value: `${formatDifficulty(subtype.difficultyScore)}/10`, tone: "warning" },
                      ]}
                    />
                  </div>
                ))}
              </div>
            )}

            <div
              className="border-t border-indigo-100 bg-indigo-50/35 px-4 py-4 sm:px-6"
              data-report-level="section-evaluation"
            >
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-indigo-700">
                <Sparkles size={14} aria-hidden="true" />
                {section.name}板块解读
              </div>
              <div className="text-sm leading-7 text-slate-600">
                <EvaluationText
                  status={report.evaluationStatus}
                  evaluation={getSectionEvaluation(section)}
                  compact
                />
              </div>
            </div>
          </article>
        ))}
      </section>

      <section className="card mt-6 overflow-hidden" aria-labelledby="question-review-title">
        <header className="px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2 text-slate-900">
            <MessageSquareText size={18} aria-hidden="true" />
            <h2 id="question-review-title" className="font-bold">逐题答案与解析</h2>
          </div>
          <p className="mt-1 text-xs text-slate-400">提交后统一查看本次全部题目的作答结果</p>
        </header>
        <div className="border-t border-slate-100">
          {report.questionReviews?.map((review) => (
            <details key={review.questionId} className="group border-b border-slate-100 last:border-b-0">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 sm:px-6">
                <span className="min-w-0 text-sm font-semibold text-slate-800">
                  第 {review.index} 题 · {review.type}
                </span>
                <span className={`pill shrink-0 ${review.selected === null ? "bg-slate-100 text-slate-500" : review.correct ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                  {review.selected === null ? "未作答" : review.correct ? "正确" : "错误"}
                </span>
              </summary>
              <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-5 sm:px-6">
                {review.material && <MaterialView material={review.material} />}
                <div className="mt-3 text-sm leading-7 text-slate-800">
                  <b className="mr-2">{review.index}.</b>
                  <QuestionContent content={review.stem} />
                </div>
                <div className="mt-4 grid gap-2">
                  {review.options.map((option, optionIndex) => (
                    <div
                      key={`${review.questionId}-${optionIndex}`}
                      className={`rounded-lg border px-3 py-2.5 text-sm ${optionIndex === review.correctAnswer ? "border-emerald-300 bg-emerald-50 text-emerald-800" : optionIndex === review.selected ? "border-red-200 bg-red-50 text-red-700" : "border-slate-200 bg-white text-slate-600"}`}
                    >
                      <span className="mr-2 font-semibold">{String.fromCharCode(65 + optionIndex)}.</span>
                      <QuestionContent content={option} variant="option" />
                    </div>
                  ))}
                </div>
                <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                  <div><dt className="text-xs text-slate-400">你的答案</dt><dd className="mt-1 font-semibold text-slate-700">{review.selected === null ? "未作答" : String.fromCharCode(65 + review.selected)}</dd></div>
                  <div><dt className="text-xs text-slate-400">正确答案</dt><dd className="mt-1 font-semibold text-emerald-700">{String.fromCharCode(65 + review.correctAnswer)}</dd></div>
                  <div><dt className="text-xs text-slate-400">本题用时</dt><dd className="mt-1 font-semibold text-slate-700">{formatDuration(review.durationSeconds)}</dd></div>
                </dl>
                <div className="mt-4 border-l-2 border-indigo-300 pl-4 text-sm leading-7 text-slate-600">
                  <b className="text-slate-800">解析：</b>
                  <QuestionContent content={review.explanation || "暂无解析"} variant="explanation" />
                </div>
              </div>
            </details>
          ))}
          {!report.questionReviews?.length && (
            <p className="px-4 py-6 text-sm text-slate-400 sm:px-6">本次报告暂无可展示的逐题解析。</p>
          )}
        </div>
      </section>

      <section
        className="card mt-6 p-5 sm:p-7"
        aria-labelledby="overall-evaluation-title"
        data-report-level="overall-evaluation"
      >
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600">
            <Sparkles size={19} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="overall-evaluation-title" className="font-bold text-slate-900">
              {report.mode === "EXAM" ? "本次考试整体解读" : "本次练习整体解读"}
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {["PENDING", "EVALUATING"].includes(report.evaluationStatus)
                ? "正在调用已配置的模型 API"
                : report.evaluationSource === "MODEL_API"
                  ? "由模型 API 根据本次全部板块数据生成"
                  : "模型不可用，本次已使用规则评价兜底"}
            </p>
          </div>
        </div>
        <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3.5 text-sm leading-7 text-slate-600 sm:px-5">
          <EvaluationText
            status={report.evaluationStatus}
            evaluation={report.overallEvaluation}
          />
        </div>
        {evaluationError && (
          <div className="mt-3 flex flex-col gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between">
            <span>{evaluationError}</span>
            {onRetryEvaluation && (
              <button
                onClick={onRetryEvaluation}
                className="btn-ghost shrink-0 border-red-200 text-red-700"
              >
                重试评价
              </button>
            )}
          </div>
        )}
      </section>

      {actions && (
        <div className="mt-8 flex flex-col gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:justify-end [&>button]:w-full sm:[&>button]:w-auto">
          {actions}
        </div>
      )}
    </div>
  );
}

function SummaryMetric({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  tone: "primary" | "accent" | "success" | "slate";
}) {
  const tones = {
    primary: "bg-indigo-50 text-indigo-600",
    accent: "bg-orange-50 text-orange-600",
    success: "bg-emerald-50 text-emerald-600",
    slate: "bg-slate-100 text-slate-600",
  };

  return (
    <div className="card min-w-0 p-4 sm:p-5">
      <div className={`grid h-9 w-9 place-items-center rounded-xl ${tones[tone]}`}>{icon}</div>
      <dt className="mt-4 text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-xl font-bold text-slate-900 sm:text-2xl">{value}</dd>
      <p className="mt-1 text-[11px] leading-4 text-slate-400">{hint}</p>
    </div>
  );
}

type ReportMetricTone = "primary" | "success" | "warning" | "danger" | "muted";

function ReportMetrics({
  items,
  compact = false,
}: {
  items: { label: string; value: string; tone?: ReportMetricTone }[];
  compact?: boolean;
}) {
  const tones: Record<ReportMetricTone, string> = {
    primary: "text-indigo-600",
    success: "text-emerald-600",
    warning: "text-amber-600",
    danger: "text-red-500",
    muted: "text-slate-400",
  };

  return (
    <dl className="grid w-full min-w-0 grid-cols-2 gap-x-3 gap-y-2 min-[440px]:grid-cols-3 sm:flex sm:w-auto sm:flex-wrap sm:justify-end sm:gap-x-0">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex min-w-0 items-baseline gap-1 text-xs leading-5 sm:px-3 sm:first:pl-0 sm:last:pr-0 sm:[&:not(:first-child)]:border-l sm:[&:not(:first-child)]:border-slate-200"
        >
          <dt className="shrink-0 text-slate-400">{item.label}</dt>
          <dd
            className={`min-w-0 break-words font-semibold ${
              item.tone ? tones[item.tone] : compact ? "text-slate-500" : "text-slate-700"
            }`}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function getSectionEvaluation(section: TrainingReportSection) {
  if (section.evaluation?.trim()) return section.evaluation.trim();
  const legacyEvaluations = Array.from(
    new Set(
      section.subtypes
        .map((subtype) => subtype.evaluation?.trim())
        .filter((evaluation): evaluation is string => Boolean(evaluation)),
    ),
  );
  if (!legacyEvaluations.length) return null;
  return `历史报告中的细分评价已合并：${legacyEvaluations.join(" ")}`;
}

function EvaluationText({
  status,
  evaluation,
  compact = false,
}: {
  status: TrainingReportEvaluationStatus;
  evaluation: string | null;
  compact?: boolean;
}) {
  if (status === "PENDING" || status === "EVALUATING") {
    return (
      <span className="inline-flex items-center gap-2 text-slate-500" role="status" aria-live="polite">
        <LoaderCircle className="animate-spin text-indigo-500" size={compact ? 15 : 17} aria-hidden="true" />
        {compact ? "正在生成评价…" : "正在生成本次练习评价…"}
      </span>
    );
  }

  return <>{evaluation || "本项暂无足够数据生成评价。"}</>;
}

export function formatTrainingDuration(value: number) {
  return formatDuration(value);
}

function formatDuration(value: number) {
  const total = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}小时${minutes}分${String(seconds).padStart(2, "0")}秒`;
  if (minutes) return `${minutes}分${String(seconds).padStart(2, "0")}秒`;
  return `${seconds}秒`;
}

function formatPercent(value: number | null) {
  if (value === null) return "未作答";
  const normalized = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  const formatted = Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(1);
  return `${formatted}%`;
}

function formatDifficulty(value: number) {
  return (Number.isFinite(value) ? Math.min(10, Math.max(0, value)) : 0).toFixed(1);
}

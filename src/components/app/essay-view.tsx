"use client";

import { useEffect, useState } from "react";
import type { EssayMaterial, StudyPlanLaunchContext } from "./types";
import { EmptyState, LoadingState, PageTitle } from "./ui";

type Feedback = {
  summary: string;
  strengths: string;
  improvements: string;
  matchedPoints: string[];
  missingPoints: string[];
  referenceAnswer: string;
};

export function EssayView({
  planContext,
  onPlanEvidence,
  onOpenPlan,
  onExitPlanTask,
}: {
  planContext?: StudyPlanLaunchContext | null;
  onPlanEvidence?: (evidenceId: string) => void;
  onOpenPlan?: () => void;
  onExitPlanTask?: () => void;
}) {
  const [materials, setMaterials] = useState<EssayMaterial[]>([]);
  const [materialIndex, setMaterialIndex] = useState(0);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    id: string;
    score: number;
    wordCount: number;
    feedback: Feedback;
  } | null>(null);
  useEffect(() => {
    queueMicrotask(async () => {
      try {
        const response = await fetch("/api/essays");
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error?.message || "申论材料加载失败");
        setMaterials(body.data);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "申论材料加载失败");
      } finally {
        setLoading(false);
      }
    });
  }, []);
  if (loading) return <LoadingState text="正在加载申论材料…" />;
  if (!materials.length) return <EmptyState text="暂时没有申论材料" />;
  const material = materials[materialIndex];
  const question = material.questions[questionIndex];
  const wordCount = content.replace(/\s/g, "").length;
  const chooseMaterial = (index: number) => {
    setMaterialIndex(index);
    setQuestionIndex(0);
    setContent("");
    setResult(null);
    setError("");
  };
  const chooseQuestion = (index: number) => {
    setQuestionIndex(index);
    setContent("");
    setResult(null);
    setError("");
  };
  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        `/api/essays/questions/${question.id}/submit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content,
            ...(planContext
              ? {
                  planContext: {
                    planId: planContext.planId,
                    taskKey: planContext.taskKey,
                    taskIndex: planContext.taskIndex,
                  },
                }
              : {}),
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "提交失败");
      setResult(body.data);
      if (body.data?.id) onPlanEvidence?.(body.data.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "提交失败");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="fade">
      {planContext && (
        <div className="mb-4 flex min-w-0 flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 [overflow-wrap:anywhere]">
            <b className="block">计划任务：{planContext.taskTitle}</b>
            <span className="mt-1 block text-xs text-blue-700">
              {result
                ? "申论提交记录已生成，可返回每日任务进行系统验收。"
                : "本次提交将用于该任务的系统验收。"}
            </span>
          </div>
          {result && onOpenPlan ? (
            <button
              type="button"
              className="btn-primary min-h-11 shrink-0"
              onClick={onOpenPlan}
            >
              返回计划验收
            </button>
          ) : onExitPlanTask ? (
            <button
              type="button"
              className="btn-ghost min-h-11 shrink-0"
              onClick={onExitPlanTask}
            >
              退出计划任务
            </button>
          ) : null}
        </div>
      )}
      <PageTitle
        title="申论训练"
        description="阅读材料、限字作答，提交后查看评分点覆盖和参考答案。"
      />
      <div className="mobile-scroll -mx-1 mb-5 flex flex-nowrap gap-2 px-1 sm:flex-wrap">
        {materials.map((item, index) => (
          <button
            key={item.id}
            onClick={() => chooseMaterial(index)}
            className={`${index === materialIndex ? "btn-primary" : "btn-ghost"} shrink-0`}
          >
            {item.title}
          </button>
        ))}
      </div>
      <div className="two-col grid grid-cols-[1.05fr_1fr] gap-5">
        <div className="card p-6 sm:p-7">
          <div className="flex items-center gap-2">
            <span className="pill bg-blue-50 text-blue-700">
              {material.topic}
            </span>
            <span className="text-xs text-slate-400">
              {material.year || "综合材料"}
            </span>
          </div>
          <h2 className="mt-4 text-lg font-bold">{material.title}</h2>
          <div className="mt-5 whitespace-pre-wrap text-sm leading-8 text-slate-600">
            {material.content}
          </div>
        </div>
        <div className="space-y-5">
          <div className="card p-6 sm:p-7">
            <div className="mb-4 flex flex-wrap gap-2">
              {material.questions.map((item, index) => (
                <button
                  key={item.id}
                  onClick={() => chooseQuestion(index)}
                  className={`pill border ${index === questionIndex ? "border-orange-400 bg-orange-50 text-orange-600" : "border-slate-200"}`}
                >
                  {item.type}
                </button>
              ))}
            </div>
            <h3 className="font-semibold leading-7">{question.prompt}</h3>
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
              字数要求：不超过 {question.wordLimit} 字 · 已提交{" "}
              {question.submissionCount} 次
            </div>
            <textarea
              value={content}
              onChange={(event) => {
                setContent(event.target.value);
                setResult(null);
              }}
              rows={10}
              placeholder="请在此输入申论答案，建议分点、分段作答……"
              className="field mt-4 min-h-64 w-full resize-y p-4 text-sm leading-7"
            />
            <div className="mobile-stack mt-2 flex items-center justify-between gap-3">
              <span
                className={`text-xs ${wordCount > question.wordLimit ? "text-red-500" : "text-slate-400"}`}
              >
                {wordCount}/{question.wordLimit} 字
              </span>
              <button
                onClick={submit}
                disabled={saving || wordCount < 20}
                className="btn-primary mobile-full disabled:opacity-40"
              >
                {saving ? "评阅中…" : "提交评阅"}
              </button>
            </div>
            {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
          </div>
          {result && (
            <div className="card p-6 sm:p-7">
              <div className="flex items-center justify-between">
                <h3 className="font-bold">作答反馈</h3>
                <strong className="text-3xl text-orange-600">
                  {result.score}
                </strong>
              </div>
              <p className="mt-4 rounded-lg bg-blue-50 p-4 text-sm leading-7 text-slate-600">
                {result.feedback.summary}
              </p>
              <div className="mt-4 text-sm leading-7">
                <b className="text-green-700">已覆盖要点</b>
                <p className="text-slate-600">{result.feedback.strengths}</p>
                <b className="mt-3 block text-orange-700">改进方向</b>
                <p className="text-slate-600">{result.feedback.improvements}</p>
                <details className="mt-4 rounded-lg bg-slate-50 p-4">
                  <summary className="cursor-pointer font-medium">
                    查看参考答案
                  </summary>
                  <p className="mt-3 text-slate-600">
                    {result.feedback.referenceAnswer}
                  </p>
                </details>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

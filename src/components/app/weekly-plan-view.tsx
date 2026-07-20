"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Target, RotateCcw } from "lucide-react";
import type { WeeklyStudyPlan } from "./types";
import { EmptyState, LoadingState, PageTitle } from "./ui";

function sourceLabel(source: string) {
  return source === "MODEL_API" ? "模型增强规划" : "数据规则规划";
}

export function WeeklyPlanView() {
  const [plan, setPlan] = useState<WeeklyStudyPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const response = await fetch("/api/weekly-plan");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "规划加载失败");
      setPlan(body.data || null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "规划加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { queueMicrotask(() => void load()); }, []);

  const generate = async () => {
    setGenerating(true);
    setError("");
    try {
      const response = await fetch("/api/weekly-plan", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "规划生成失败");
      setPlan(body.data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "规划生成失败");
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return <LoadingState text="正在读取一周阶段规划…" />;
  return (
    <div className="fade">
      <div className="mobile-stack flex items-start justify-between gap-4">
        <PageTitle title="规划" description="只确定未来一周要达成的阶段性目标，不预先安排每天做什么。" />
        <button type="button" onClick={() => void generate()} disabled={generating} className="btn-primary flex shrink-0 items-center justify-center gap-2 disabled:opacity-50">
          <RefreshCw size={16} aria-hidden="true" />
          {generating ? "正在更新…" : plan ? "重新规划" : "生成一周规划"}
        </button>
      </div>
      {error && <div role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>}
      {!plan ? <EmptyState text="生成一份一周阶段规划，明确本周应该达成什么。" /> : (
        <>
          <section className="brand-gradient mt-6 overflow-hidden rounded-2xl p-6 text-white shadow-lg sm:p-8">
            <div className="flex items-center gap-2 text-xs text-blue-200"><Target size={15} aria-hidden="true" />{sourceLabel(plan.source)}</div>
            <h2 className="mt-2 text-xl font-bold">{plan.title}</h2>
            <p className="mt-3 max-w-4xl text-sm leading-7 text-blue-100">{plan.summary}</p>
            <p className="mt-5 border-t border-white/15 pt-4 text-xs text-blue-200">有效期至：{new Date(plan.expiresAt).toLocaleDateString("zh-CN")}</p>
          </section>
          <section className="mt-8" aria-labelledby="weekly-goals-title">
            <div className="border-b border-slate-200 pb-3"><p className="text-xs font-semibold text-indigo-600">阶段目标</p><h2 id="weekly-goals-title" className="mt-1 text-lg font-bold text-slate-900">本周要达成的结果</h2></div>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {plan.goals.map((goal, index) => (
                <article key={`${goal.title}-${index}`} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3"><div><span className="text-xs font-semibold text-indigo-600">目标 {index + 1}</span><h3 className="mt-1 font-bold text-slate-900">{goal.title}</h3></div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{goal.priority === "HIGH" ? "高优先" : goal.priority === "LOW" ? "低优先" : "中优先"}</span></div>
                  <p className="mt-3 text-sm leading-6 text-slate-700">{goal.objective}</p>
                  <div className="mt-4"><p className="text-xs font-semibold text-slate-500">重点细分板块</p><div className="mt-2 flex flex-wrap gap-2">{goal.focusAreas.map((area) => <span key={area} className="rounded-md bg-indigo-50 px-2 py-1 text-xs text-indigo-700">{area}</span>)}</div></div>
                  <div className="mt-4"><p className="text-xs font-semibold text-slate-500">达成标准</p><ul className="mt-2 space-y-1 text-sm leading-6 text-slate-600">{goal.successCriteria.map((item) => <li key={item} className="flex gap-2"><span className="text-emerald-600">✓</span>{item}</li>)}</ul></div>
                  <p className="mt-4 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-500">依据：{goal.rationale}</p>
                </article>
              ))}
            </div>
          </section>
          <section className="mt-8 border-y border-slate-200 py-6" aria-labelledby="weekly-strategy-title">
            <div className="flex items-center gap-2"><RotateCcw size={17} className="text-indigo-600" aria-hidden="true" /><h2 id="weekly-strategy-title" className="font-bold text-slate-900">资源分配与调整原则</h2></div>
            <p className="mt-3 text-sm leading-7 text-slate-700">{plan.strategy.objective}</p>
            <div className="mt-5 grid gap-6 lg:grid-cols-2"><div><p className="text-xs font-semibold text-slate-500">资源分配</p><div className="mt-2 divide-y divide-slate-100 border-y border-slate-100">{plan.strategy.priorities.map((item) => <div key={item.area} className="flex items-center justify-between gap-3 py-3 text-sm"><span>{item.area}<span className="ml-2 text-xs text-slate-500">{item.reason}</span></span>{item.allocationPercent ? <b className="text-indigo-600">{item.allocationPercent}%</b> : null}</div>)}</div></div><div><p className="text-xs font-semibold text-slate-500">动态调整</p><div className="mt-2 space-y-2">{plan.strategy.adjustmentRules.map((rule) => <p key={rule} className="border-l-2 border-indigo-200 pl-3 text-sm leading-6 text-slate-600">{rule}</p>)}</div></div></div>
            <p className="mt-5 text-xs leading-5 text-slate-500">{plan.strategy.rhythm}</p>
          </section>
        </>
      )}
    </div>
  );
}

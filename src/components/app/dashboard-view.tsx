"use client";

import {
  ArrowRight, BarChart3, BookmarkCheck, BookOpenCheck,
  Brain, CircleCheckBig, Clock3, Gauge, Sparkles, Target, Timer, TrendingUp,
} from "lucide-react";
import type { Overview, View } from "./types";
import { PageTitle, StatCard } from "./ui";

const quickLinks: {
  view: View; title: string; description: string;
  icon: typeof Target; bg: string; iconColor: string; accent: string;
}[] = [
  {
    view: "practice",
    title: "专项练习",
    description: "选择模块、难度和题量，进行针对性突破",
    icon: Target,
    bg: "bg-[#eef2ff]", iconColor: "text-[#2f56d6]", accent: "#2f56d6",
  },
  {
    view: "exam",
    title: "模拟考试",
    description: "自定义题量与时长，体验完整考试流程",
    icon: Timer,
    bg: "bg-[#fff3ed]", iconColor: "text-[#e05020]", accent: "#e05020",
  },
  {
    view: "wrong",
    title: "错题复习",
    description: "回顾错误与收藏，让薄弱点不再反复",
    icon: BookmarkCheck,
    bg: "bg-[#fff0f2]", iconColor: "text-rose-600", accent: "#e11d48",
  },
  {
    view: "stats",
    title: "学习分析",
    description: "查看正确率趋势与各模块能力分布",
    icon: BarChart3,
    bg: "bg-[#ecfdf5]", iconColor: "text-[#0d9060]", accent: "#0d9060",
  },
];

export function DashboardView({ overview, onView }: { overview: Overview; onView: (view: View) => void }) {
  const weakest = [...overview.categories].sort((a, b) => a.accuracy - b.accuracy)[0];

  return (
    <div className="fade">
      <PageTitle
        title="继续为目标努力吧"
        description="每一次认真作答，都让你离理想岗位更近一步。"
        action={
          <button onClick={() => onView("plan")} className="btn-ghost text-sm">
            <Sparkles size={15} className="text-indigo-500" />
            生成学习计划
          </button>
        }
      />

      {/* ── Hero banner ── */}
      <section className="dashboard-hero relative overflow-hidden rounded-[26px] bg-[#101d4a] px-7 py-8 text-white shadow-[0_20px_56px_rgba(16,29,74,.28)] sm:px-9 sm:py-9">
        {/* Decorative orbs */}
        <div className="pointer-events-none absolute -right-16 -top-20 h-72 w-72 rounded-full bg-indigo-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 right-24 h-60 w-60 rounded-full bg-blue-400/10 blur-3xl" />
        <div className="pointer-events-none absolute left-1/2 top-0 h-40 w-80 -translate-x-1/2 rounded-full bg-indigo-600/10 blur-2xl" />

        <div className="relative z-[1] max-w-[560px]">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-indigo-300">
            <Brain size={14} aria-hidden="true" />
            今日学习建议
          </div>
          <h2 className="mt-3.5 text-[22px] font-bold leading-tight tracking-[-.03em] sm:text-[28px]">
            保持节奏，比偶尔冲刺更接近上岸
          </h2>
          <p className="mt-3 max-w-md text-sm leading-[1.75] text-indigo-100/65">
            根据你的学习记录安排一组专项训练，完成后系统会更新薄弱模块与推荐难度。
          </p>
          <button
            onClick={() => onView("practice")}
            className="mt-6 inline-flex min-h-11 items-center gap-2.5 rounded-2xl bg-white px-6 text-sm font-bold text-[#1a2f70] shadow-xl shadow-black/10 transition hover:-translate-y-0.5 hover:shadow-2xl"
          >
            开始今日训练
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      </section>

      {/* ── Stats grid ── */}
      <div className="stats-grid mt-5 grid grid-cols-4 gap-4">
        <StatCard label="累计刷题" value={overview.total} unit="道" icon={<BookOpenCheck size={20} />} tone="primary" />
        <StatCard label="练习正确率" value={overview.accuracy} unit="%" icon={<CircleCheckBig size={20} />} tone="success" />
        <StatCard label="今日完成" value={overview.today} unit="道" icon={<Clock3 size={20} />} tone="accent" />
        <StatCard label="本周答题" value={overview.thisWeek} unit="道" icon={<TrendingUp size={20} />} tone="slate" />
      </div>

      {/* ── Quick links + Suggestion ── */}
      <div className="two-col mt-5 grid grid-cols-[1.45fr_.8fr] gap-5">
        {/* Quick links */}
        <section className="card p-5 sm:p-6">
          <div className="mb-5">
            <h2 className="font-bold text-slate-900">快捷学习</h2>
            <p className="mt-0.5 text-xs text-slate-400">选择你现在最想推进的学习任务</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {quickLinks.map(({ view: v, title, description, icon: Icon, bg, iconColor }) => (
              <button
                key={v}
                onClick={() => onView(v)}
                className="soft-card group flex items-start gap-4 p-4 text-left transition sm:p-5"
              >
                <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${bg} ${iconColor} shadow-sm`}>
                  <Icon size={19} aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <b className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                    {title}
                    <ArrowRight
                      size={13}
                      className="opacity-0 transition-[opacity,transform] group-hover:translate-x-0.5 group-hover:opacity-100"
                      aria-hidden="true"
                    />
                  </b>
                  <span className="mt-1.5 block text-xs leading-[1.6] text-slate-500">{description}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* Suggestion */}
        <section className="card p-5 sm:p-6">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-800">
            <Gauge size={16} className="text-indigo-500" aria-hidden="true" />
            当前建议
          </div>

          {weakest ? (
            <div className="mt-5 rounded-2xl border border-orange-100/80 bg-gradient-to-b from-orange-50/70 to-white p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[.1em] text-orange-500">薄弱模块</div>
              <div className="mt-1.5 text-lg font-bold tracking-[-.02em] text-slate-900">{weakest.name}</div>
              <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                <span>当前正确率</span>
                <b className="font-bold text-orange-600">{weakest.accuracy}%</b>
              </div>
              <div className="progress mt-2">
                <i style={{ width: `${weakest.accuracy}%`, background: "linear-gradient(90deg,#f0592c,#f8a87e)" }} />
              </div>
              <p className="mt-4 text-xs leading-[1.65] text-slate-500">
                已作答 {weakest.total} 题，建议今天完成 10 道同类基础题。
              </p>
              <button
                onClick={() => onView("practice")}
                className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-indigo-600 transition hover:gap-2"
              >
                前往强化 <ArrowRight size={12} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-indigo-100/80 bg-gradient-to-b from-indigo-50/60 to-white p-5">
              <Brain size={22} className="text-indigo-500" aria-hidden="true" />
              <p className="mt-3 text-sm leading-[1.7] text-slate-600">
                完成第一组练习后，系统会根据真实作答生成模块建议。
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

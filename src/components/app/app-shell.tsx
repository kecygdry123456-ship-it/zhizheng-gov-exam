"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import {
  BarChart3, Bookmark, BookOpenCheck, CalendarCheck, FileText, ListChecks,
  LayoutDashboard, LogOut, Menu, Route, Settings, Sparkles,
  Target, Timer, UserRound, X,
} from "lucide-react";
import type { Overview, User, View } from "./types";
import { Logo } from "./ui";

const allNav: { id: View; label: string; icon: ComponentType<{ size?: number; strokeWidth?: number }> ; admin?: boolean }[] = [
  { id: "home",     label: "学习首页", icon: LayoutDashboard },
  { id: "practice", label: "专项练习", icon: Target },
  { id: "exam",     label: "模拟考试", icon: Timer },
  { id: "essay",    label: "申论训练", icon: FileText },
  { id: "plan",     label: "每日任务", icon: CalendarCheck },
  { id: "roadmap",  label: "规划",     icon: Route },
  { id: "wrong",    label: "错题集",   icon: BookOpenCheck },
  { id: "favorites",label: "收藏",     icon: Bookmark },
  { id: "stats",    label: "学习分析", icon: BarChart3 },
  { id: "admin",    label: "管理后台", icon: Settings, admin: true },
];

function WeeklyMetrics({ overview }: { overview: Overview }) {
  const metrics = [
    { label: "本周答题", value: overview.thisWeek, unit: "题", icon: BookOpenCheck, tone: "bg-indigo-50 text-indigo-600" },
    { label: "本周签到", value: overview.weeklyCheckIns ?? 0, unit: "次", icon: CalendarCheck, tone: "bg-emerald-50 text-emerald-600" },
    { label: "本周完成", value: overview.weeklyCompletedTasks ?? 0, unit: "个任务", icon: ListChecks, tone: "bg-orange-50 text-orange-600" },
  ] as const;
  return (
    <div className="flex items-center gap-1.5" aria-label="本周学习统计">
      {metrics.map(({ label, value, unit, icon: Icon, tone }) => (
        <div key={label} className={`flex min-w-[78px] items-center gap-1.5 rounded-xl border border-slate-100 px-2.5 py-1.5 ${tone}`}>
          <Icon size={13} aria-hidden="true" />
          <div className="leading-tight">
            <div className="text-[10px] font-medium opacity-70">{label}</div>
            <div className="text-[12px] font-bold tabular-nums">{value}<span className="ml-0.5 text-[10px] font-medium">{unit}</span></div>
          </div>
        </div>
      ))}
    </div>
  );
}

function TodayGoalCard({
  overview,
  checkingIn,
  error,
  onCheckIn,
}: {
  overview: Overview;
  checkingIn: boolean;
  error: string;
  onCheckIn: () => void;
}) {
  const questionGoal = overview.todayQuestionGoal;
  const taskGoal = overview.todayTaskGoal;
  const questionProgress = questionGoal ? Math.min((overview.today / questionGoal) * 100, 100) : 0;
  const taskProgress = taskGoal ? Math.min(((overview.todayCompletedTasks ?? 0) / taskGoal) * 100, 100) : 0;
  return (
    <div className="rounded-2xl border border-white/[.08] bg-white/[.05] px-4 py-3.5" aria-live="polite">
      <div className="flex items-center gap-2 text-xs font-semibold text-white/90">
        <Sparkles size={13} className="text-indigo-300" aria-hidden="true" />
        今日学习目标
      </div>
      {!overview.checkedInToday ? (
        <>
          <p className="mt-2 text-[11px] leading-5 text-white/55">签到后根据你的学习记录生成今日题目和任务目标。</p>
          <button
            type="button"
            onClick={onCheckIn}
            disabled={checkingIn}
            className="mt-2.5 inline-flex min-h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-white/90 px-2 text-[11px] font-semibold text-[#182b6a] transition hover:bg-white disabled:cursor-wait disabled:opacity-60"
          >
            <CalendarCheck size={13} aria-hidden="true" />
            {checkingIn ? "正在生成目标..." : "签到生成目标"}
          </button>
        </>
      ) : (
        <>
          <div className="mt-2.5 text-[11px] font-medium text-white/80">完成 {questionGoal ?? 0} 题和 {taskGoal ?? 0} 个任务</div>
          <div className="mt-2.5 space-y-2.5 text-[10px] text-white/55">
            <div>
              <div className="mb-1 flex justify-between"><span>答题</span><span className="tabular-nums">{Math.min(overview.today, questionGoal ?? 0)}/{questionGoal ?? 0}</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-[#ff9a78] to-[#f0592c] transition-[width_.4s_ease]" style={{ width: `${questionProgress}%` }} /></div>
            </div>
            <div>
              <div className="mb-1 flex justify-between"><span>任务</span><span className="tabular-nums">{Math.min(overview.todayCompletedTasks ?? 0, taskGoal ?? 0)}/{taskGoal ?? 0}</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-[#9ca8ff] to-[#6677ed] transition-[width_.4s_ease]" style={{ width: `${taskProgress}%` }} /></div>
            </div>
          </div>
          {overview.todayGoalSummary && <p className="mt-2 text-[10px] leading-4 text-white/40">{overview.todayGoalSummary}</p>}
        </>
      )}
      {error && <p className="mt-2 text-[10px] leading-4 text-rose-200">{error}</p>}
    </div>
  );
}

export function AppShell({
  user, view, overview, onView, onLogout, onCheckIn, children,
}: {
  user: User; view: View; overview: Overview;
  onView: (view: View) => void; onLogout: () => void; onCheckIn?: () => Promise<void>; children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkInError, setCheckInError] = useState("");
  const nav = allNav.filter((item) => !item.admin || user.role === "ADMIN");
  const choose = (next: View) => { onView(next); setMobileOpen(false); };
  const checkIn = async () => {
    if (checkingIn || overview.checkedInToday || !onCheckIn) return;
    setCheckingIn(true); setCheckInError("");
    try { await onCheckIn(); }
    catch (reason) { setCheckInError(reason instanceof Error ? reason.message : "签到失败，请稍后重试"); }
    finally { setCheckingIn(false); }
  };

  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [mobileOpen]);

  return (
    <div className="min-h-dvh">
      {/* ── Desktop sidebar ── */}
      <aside className="desktop-side brand-gradient fixed inset-y-0 left-0 z-20 flex w-64 flex-col border-r border-white/[.06] px-4 py-5">
        {/* Logo */}
        <div className="px-2"><Logo /></div>

        {/* Section label */}
        <div className="mt-8 px-3 text-[9.5px] font-semibold tracking-[.18em] text-white/30 uppercase">
          学习空间
        </div>

        {/* Nav */}
        <nav className="mt-2.5 space-y-0.5" aria-label="主导航">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <button
                key={item.id}
                onClick={() => choose(item.id)}
                aria-current={active ? "page" : undefined}
                className={`nav-item${active ? " active" : ""}`}
              >
                <Icon size={17} strokeWidth={active ? 2.2 : 1.9} aria-hidden="true" />
                <span className="text-[13.5px]">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Bottom area */}
        <div className="mt-auto space-y-3 pt-4">
          {/* Today goal card */}
          <TodayGoalCard overview={overview} checkingIn={checkingIn} error={checkInError} onCheckIn={() => void checkIn()} />

          {/* User card */}
          <div className="flex items-center gap-3 rounded-2xl border border-white/[.07] bg-white/[.04] px-3 py-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-400/20 text-indigo-200">
              <UserRound size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-white">{user.name}</div>
              <div className="mt-0.5 truncate text-[10px] text-white/40">{user.targetExam || "公考备考"}</div>
            </div>
            <button
              onClick={onLogout}
              className="grid h-9 w-9 place-items-center rounded-xl text-white/35 transition hover:bg-white/10 hover:text-white/80"
              aria-label="退出登录"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Mobile header ── */}
      <header className="mobile-head mobile-safe-header brand-gradient sticky top-0 z-40 hidden items-center justify-between px-4 text-white shadow-lg shadow-black/10">
        <Logo />
        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/[.12] bg-white/[.06] text-white transition"
          aria-label={mobileOpen ? "关闭导航" : "打开导航"}
          aria-expanded={mobileOpen}
          aria-controls="mobile-navigation"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </header>

      {/* Mobile menu */}
      {mobileOpen && (
        <>
          <button
            className="mobile-menu-backdrop fixed inset-x-0 bottom-0 z-20 bg-slate-950/40 backdrop-blur-[3px]"
            onClick={() => setMobileOpen(false)}
            aria-label="关闭导航遮罩"
          />
          <div
            id="mobile-navigation"
            role="dialog"
            aria-label="移动端导航"
            className="mobile-menu-panel brand-gradient fixed inset-x-3 z-30 overflow-y-auto overscroll-contain rounded-2xl border border-white/[.1] p-3 shadow-2xl"
          >
            <div className="mb-3"><WeeklyMetrics overview={overview} /></div>
            <div className="mb-3"><TodayGoalCard overview={overview} checkingIn={checkingIn} error={checkInError} onCheckIn={() => void checkIn()} /></div>
            <nav className="space-y-0.5" aria-label="移动端主导航">
              {nav.map((item) => {
                const Icon = item.icon;
                const active = view === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => choose(item.id)}
                    aria-current={active ? "page" : undefined}
                    className={`nav-item${active ? " active" : ""}`}
                  >
                    <Icon size={17} strokeWidth={active ? 2.2 : 1.9} aria-hidden="true" />
                    <span className="text-[13.5px]">{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <button
              onClick={onLogout}
              className="nav-item mt-2 border-t border-white/[.08] pt-2"
            >
              <LogOut size={17} />退出登录
            </button>
          </div>
        </>
      )}

      {/* ── Main content ── */}
      <main className="main-shell ml-64 min-h-dvh">
        {/* Desktop topbar */}
        <div className="desktop-topbar hide-mobile sticky top-0 z-10 flex h-[68px] items-center justify-between border-b border-slate-200/70 bg-white/85 px-8 backdrop-blur-xl">
          <div>
            <div className="text-[13.5px] font-semibold text-slate-800">公考学习中心</div>
            <div className="mt-0.5 text-[11px] text-slate-400">用数据记录每一步进步</div>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <WeeklyMetrics overview={overview} />
            <span className="h-6 w-px bg-slate-200" />
            <div className="text-right text-[13px]">
              <b className="font-semibold text-slate-800">{user.name}</b>
              <div className="text-[11px] text-slate-400">{user.role === "ADMIN" ? "管理员" : "学员"}</div>
            </div>
            <button onClick={onLogout} className="btn-ghost gap-2 text-xs">
              <LogOut size={13} />退出
            </button>
          </div>
        </div>

        {/* Page content */}
        <div className="page-pad mx-auto max-w-[1320px] p-8 lg:p-10">{children}</div>
      </main>
    </div>
  );
}

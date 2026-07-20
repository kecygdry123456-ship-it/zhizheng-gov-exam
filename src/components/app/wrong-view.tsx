"use client";

import { useState } from "react";
import { BookOpenCheck, CalendarDays } from "lucide-react";
import type { View, WrongQuestionSet } from "./types";
import { EmptyState, PageTitle } from "./ui";

export function WrongView({
  sets,
  onView,
  onStart,
}: {
  sets: WrongQuestionSet[];
  onView: (view: View) => void;
  onStart: (set: WrongQuestionSet) => Promise<void>;
}) {
  const [startingId, setStartingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const start = async (set: WrongQuestionSet) => {
    if (startingId) return;
    setStartingId(set.id);
    setError("");
    try {
      await onStart(set);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "错题集启动失败");
      setStartingId(null);
    }
  };

  return (
    <div className="fade">
      <PageTitle
        title="错题集"
        description="每次练习的错题会保留为一套完整题组，方便按原训练批次集中复练。"
      />
      <div className="mb-6 flex flex-wrap gap-3">
        <span className="pill bg-red-50 text-red-600">错题集 {sets.length}</span>
        <span className="pill bg-slate-100 text-slate-600">
          共 {sets.reduce((sum, set) => sum + set.wrongCount, 0)} 道错题
        </span>
      </div>
      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}
      {sets.length === 0 ? (
        <EmptyState
          text="完成练习后，本次练习的错题会汇总到这里"
          action={() => onView("practice")}
          actionLabel="去练习"
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {sets.map((set) => {
            const categories = [...new Set(set.questions.map((question) => question.category))];
            return (
              <div className="card flex flex-col p-5 sm:p-6" key={set.id}>
                <div className="flex items-start justify-between gap-4">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-red-50 text-red-600">
                    <BookOpenCheck size={20} aria-hidden="true" />
                  </div>
                  <span className="pill bg-slate-100 text-slate-500">
                    {set.mode === "EXAM" ? "模拟考试" : "专项练习"}
                  </span>
                </div>
                <h2 className="mt-4 text-base font-semibold text-slate-900">{set.title}</h2>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <CalendarDays size={14} aria-hidden="true" />
                    {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(set.completedAt))}
                  </span>
                  <span>原练习 {set.total} 题</span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {categories.slice(0, 4).map((category) => (
                    <span key={category} className="pill bg-blue-50 text-blue-700">{category}</span>
                  ))}
                  {categories.length > 4 && <span className="pill bg-slate-100 text-slate-500">另 {categories.length - 4} 个板块</span>}
                </div>
                <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <b className="text-2xl text-red-600">{set.wrongCount}</b>
                    <span className="ml-1 text-sm text-slate-500">道错题</span>
                  </div>
                  <button
                    onClick={() => void start(set)}
                    disabled={startingId !== null}
                    className="btn-primary min-h-11 w-full disabled:opacity-50 sm:w-auto"
                  >
                    {startingId === set.id ? "正在启动…" : "练习本组错题"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

"use client";

import type { PublicQuestion, View } from "./types";
import { EmptyState, PageTitle } from "./ui";
import { plainQuestionText } from "./question-content";

export function FavoritesView({
  favorites,
  onView,
}: {
  favorites: PublicQuestion[];
  onView: (view: View) => void;
}) {
  return (
    <div className="fade">
      <PageTitle
        title="收藏"
        description="集中回顾收藏题目，形成自己的重点题集。"
      />
      <div className="mb-6 flex flex-wrap gap-3">
        <span className="pill bg-amber-50 text-amber-600">
          收藏 {favorites.length}
        </span>
      </div>
      {favorites.length === 0 ? (
        <EmptyState
          text="还没有收藏题目"
          action={() => onView("practice")}
          actionLabel="去练习"
        />
      ) : (
        <div className="space-y-3">
          {favorites.map((question) => (
            <div className="card group flex flex-col items-stretch gap-4 p-5 transition sm:flex-row sm:items-center sm:gap-5 sm:hover:-translate-y-0.5 sm:hover:shadow-lg" key={question.id}>
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-red-50 font-semibold text-red-500">
                复
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex gap-2">
                  <span className="text-xs text-blue-700">
                    {question.category}
                  </span>
                  <span className="text-xs text-slate-400">
                    {question.type}
                  </span>
                </div>
                <p className="truncate text-sm">{plainQuestionText(question.stem)}</p>
              </div>
              <button
                onClick={() => onView("practice")}
                className="btn-ghost w-full text-xs sm:w-auto"
              >
                重新练习
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { ChevronDown, ChevronRight, ListFilter, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  normalizeQuestionScopes,
  questionScopeKey,
  type QuestionScope,
} from "@/lib/question-scope";

export type PracticeCategory = {
  id: string;
  name: string;
  questionCount: number;
  subtypes: { name: string; questionCount: number }[];
};

function ScopeCheckbox({
  checked,
  indeterminate = false,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      aria-label={label}
      onChange={onChange}
      className="h-5 w-5 shrink-0 accent-blue-600"
    />
  );
}

export function PracticeScopeSelector({
  categories,
  value,
  onChange,
}: {
  categories: PracticeCategory[];
  value: QuestionScope[];
  onChange: (value: QuestionScope[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const normalized = useMemo(() => normalizeQuestionScopes(value), [value]);
  const selected = useMemo(
    () => new Set(normalized.map(questionScopeKey)),
    [normalized],
  );
  const allScopes = useMemo(
    () =>
      categories.flatMap((category) =>
        category.subtypes.map((subtype) => ({
          category: category.name,
          type: subtype.name,
        })),
      ),
    [categories],
  );

  const setSelected = (keys: Set<string>) => {
    onChange(
      normalizeQuestionScopes(
        allScopes.filter((scope) => keys.has(questionScopeKey(scope))),
      ),
    );
  };
  const toggleScope = (scope: QuestionScope) => {
    const key = questionScopeKey(scope);
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  };
  const toggleCategory = (category: PracticeCategory) => {
    const keys = category.subtypes.map((subtype) =>
      questionScopeKey({ category: category.name, type: subtype.name }),
    );
    const allSelected = keys.length > 0 && keys.every((key) => selected.has(key));
    const next = new Set(selected);
    for (const key of keys) {
      if (allSelected) next.delete(key);
      else next.add(key);
    }
    setSelected(next);
  };

  return (
    <div className="min-w-0">
      <span className="text-sm">练习细分板块</span>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="practice-scope-options"
        onClick={() => {
          if (!open && !expanded.size && categories[0]) {
            setExpanded(new Set([categories[0].id]));
          }
          setOpen((current) => !current);
        }}
        className="field mt-2 flex min-h-12 w-full items-center gap-2 text-left"
      >
        <ListFilter size={18} className="shrink-0 text-blue-600" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">
          {normalized.length ? `已选 ${normalized.length} 个细分板块` : "全部细分板块"}
        </span>
        {normalized.length ? (
          <span className="text-xs text-slate-400">可多选</span>
        ) : null}
        <ChevronDown
          size={18}
          className={`shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {normalized.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2" aria-label="已选细分板块">
          {normalized.slice(0, 6).map((scope) => (
            <button
              type="button"
              key={questionScopeKey(scope)}
              onClick={() => toggleScope(scope)}
              className="inline-flex min-h-9 items-center gap-1 rounded-md bg-blue-50 px-2.5 text-xs text-blue-700"
              title={`移除${scope.category} / ${scope.type}`}
            >
              <span>{scope.type}</span>
              <X size={13} aria-hidden="true" />
            </button>
          ))}
          {normalized.length > 6 && (
            <span className="inline-flex min-h-9 items-center px-2 text-xs text-slate-400">
              另有 {normalized.length - 6} 项
            </span>
          )}
        </div>
      )}

      {open && (
        <div
          id="practice-scope-options"
          className="mt-3 max-h-[420px] overflow-y-auto rounded-lg border border-slate-200 bg-white"
        >
          <label className="flex min-h-12 cursor-pointer items-center gap-3 border-b border-slate-100 px-4 text-sm font-semibold text-slate-800">
            <ScopeCheckbox
              checked={normalized.length === 0}
              label="全部细分板块"
              onChange={() => onChange([])}
            />
            <span className="flex-1">全部细分板块</span>
            <span className="text-xs font-normal text-slate-400">
              {categories.reduce((sum, category) => sum + category.questionCount, 0)} 题
            </span>
          </label>
          {categories.map((category) => {
            const categoryScopes = category.subtypes.map((subtype) => ({
              category: category.name,
              type: subtype.name,
            }));
            const selectedCount = categoryScopes.filter((scope) =>
              selected.has(questionScopeKey(scope)),
            ).length;
            const isExpanded = expanded.has(category.id);
            return (
              <div key={category.id} className="border-b border-slate-100 last:border-b-0">
                <div className="flex min-h-12 items-center gap-2 px-3">
                  <button
                    type="button"
                    aria-label={`${isExpanded ? "收起" : "展开"}${category.name}`}
                    aria-expanded={isExpanded}
                    onClick={() =>
                      setExpanded((current) => {
                        const next = new Set(current);
                        if (next.has(category.id)) next.delete(category.id);
                        else next.add(category.id);
                        return next;
                      })
                    }
                    className="grid h-10 w-10 shrink-0 place-items-center text-slate-500"
                  >
                    {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  </button>
                  <ScopeCheckbox
                    checked={categoryScopes.length > 0 && selectedCount === categoryScopes.length}
                    indeterminate={selectedCount > 0 && selectedCount < categoryScopes.length}
                    label={`选择${category.name}全部细分板块`}
                    onChange={() => toggleCategory(category)}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((current) => new Set(current).add(category.id))
                    }
                    className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 text-left text-sm font-semibold text-slate-800"
                  >
                    <span className="truncate">{category.name}</span>
                    <span className="shrink-0 text-xs font-normal text-slate-400">
                      {selectedCount ? `已选 ${selectedCount}/${categoryScopes.length}` : `${category.questionCount} 题`}
                    </span>
                  </button>
                </div>
                {isExpanded && (
                  <div className="bg-slate-50/70 px-4 py-2 sm:pl-[76px]">
                    {category.subtypes.map((subtype) => {
                      const scope = { category: category.name, type: subtype.name };
                      return (
                        <label
                          key={subtype.name}
                          className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm text-slate-700 hover:bg-white"
                        >
                          <ScopeCheckbox
                            checked={selected.has(questionScopeKey(scope))}
                            label={`选择${category.name}中的${subtype.name}`}
                            onChange={() => toggleScope(scope)}
                          />
                          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{subtype.name}</span>
                          <span className="shrink-0 text-xs text-slate-400">{subtype.questionCount} 题</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

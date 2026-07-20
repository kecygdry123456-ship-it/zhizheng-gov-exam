"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { AdminQuestion } from "./types";
import { EmptyState, LoadingState, PageTitle } from "./ui";
import { plainQuestionText } from "./question-content";

type FormValue = {
  category: string;
  type: string;
  stem: string;
  options: string[];
  answer: number;
  explanation: string;
  difficulty: "基础" | "进阶" | "困难";
  difficultyScore: number;
  status: "DRAFT" | "PUBLISHED";
};
const emptyForm: FormValue = {
  category: "言语理解",
  type: "单项选择",
  stem: "",
  options: ["", "", "", ""],
  answer: 0,
  explanation: "",
  difficulty: "进阶",
  difficultyScore: 5,
  status: "PUBLISHED",
};

export function AdminView({
  onPublishedChange,
}: {
  onPublishedChange: () => Promise<void>;
}) {
  const [items, setItems] = useState<AdminQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"" | "DRAFT" | "PUBLISHED">("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormValue>(emptyForm);

  useEffect(() => {
    if (!formOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [formOpen]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/questions?page=${page}&pageSize=20&query=${encodeURIComponent(query)}${status ? `&status=${status}` : ""}`,
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "题库加载失败");
      setItems(body.data.items);
      setTotal(body.data.total);
      setTotalPages(Math.max(body.data.totalPages, 1));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "题库加载失败");
    } finally {
      setLoading(false);
    }
  }, [page, query, status]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 200);
    return () => clearTimeout(timer);
  }, [load]);
  const openNew = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
    setError("");
  };
  const openEdit = (item: AdminQuestion) => {
    setEditingId(item.id);
    setForm({
      category: item.category,
      type: item.type,
      stem: item.stem,
      options: [...item.options],
      answer: item.answer,
      explanation: item.explanation,
      difficulty: item.difficulty as FormValue["difficulty"],
      difficultyScore: item.difficultyScore,
      status: item.status,
    });
    setFormOpen(true);
    setError("");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const path = editingId
        ? `/api/admin/questions/${editingId}`
        : "/api/admin/questions";
      const response = await fetch(path, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "保存失败");
      setFormOpen(false);
      await load();
      await onPublishedChange();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };
  const disable = async (id: string) => {
    if (!confirm("确认停用这道题目吗？历史作答记录会保留。")) return;
    const response = await fetch(`/api/admin/questions/${id}`, {
      method: "DELETE",
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error?.message || "停用失败");
      return;
    }
    await load();
    await onPublishedChange();
  };

  return (
    <div className="fade">
      <div className="mobile-stack flex items-start justify-between gap-4">
        <PageTitle
          title="题库管理"
          description="新增、编辑、发布和停用题目，难度采用 10 分制。"
        />
        <button onClick={openNew} className="btn-primary mobile-full shrink-0 shadow-sm">
          ＋ 新增题目
        </button>
      </div>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {error}
        </div>
      )}
      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 p-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(1); }}
              placeholder="搜索题干、题型或分类"
              className="field w-full sm:max-w-md"
            />
            <select value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setPage(1); }} className="field w-full sm:w-40" aria-label="发布状态">
              <option value="">全部状态</option>
              <option value="PUBLISHED">已发布</option>
              <option value="DRAFT">草稿</option>
            </select>
          </div>
        </div>
        {loading ? (
          <LoadingState text="正在加载题库…" />
        ) : items.length === 0 ? (
          <EmptyState text="没有符合条件的题目" />
        ) : (
          <div className="mobile-scroll overflow-x-auto" aria-label="题库表格，可横向滚动">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="p-4">分类</th>
                  <th>题目摘要</th>
                  <th>题型</th>
                  <th>难度</th>
                  <th>状态</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-t border-slate-100 transition hover:bg-slate-50/80">
                    <td className="p-4">{item.category}</td>
                    <td className="max-w-[340px] truncate pr-5">{plainQuestionText(item.stem)}</td>
                    <td>{item.type}</td>
                    <td>
                      <span className="pill bg-blue-50 text-blue-600">
                        {item.difficultyScore.toFixed(1)}/10 · {item.difficulty}
                      </span>
                    </td>
                    <td>
                      <span
                        className={
                          item.status === "PUBLISHED"
                            ? "text-green-600"
                            : "text-slate-400"
                        }
                      >
                        ● {item.status === "PUBLISHED" ? "已发布" : "草稿"}
                      </span>
                    </td>
                    <td className="text-xs text-slate-400">
                      {new Date(item.updatedAt).toLocaleDateString("zh-CN")}
                    </td>
                    <td>
                      <button
                        onClick={() => openEdit(item)}
                        className="text-blue-600"
                      >
                        编辑
                      </button>
                      {item.status === "PUBLISHED" && (
                        <button
                          onClick={() => void disable(item.id)}
                          className="ml-3 text-red-500"
                        >
                          停用
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && total > 0 && <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>共 {total} 道题，第 {page}/{totalPages} 页</span>
          <div className="flex gap-2"><button type="button" className="btn-ghost text-xs" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><button type="button" className="btn-ghost text-xs" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</button></div>
        </div>}
      </div>
      {formOpen && (
        <div className="admin-modal fixed inset-0 z-50 grid items-end bg-slate-950/45 p-2 sm:place-items-center sm:p-4">
          <form
            onSubmit={submit}
            className="safe-bottom max-h-[calc(100dvh-env(safe-area-inset-top)-8px)] w-full max-w-3xl overflow-y-auto overscroll-contain rounded-t-2xl bg-white p-5 shadow-2xl sm:max-h-[92dvh] sm:rounded-2xl sm:p-6"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">
                {editingId ? "编辑题目" : "新增题目"}
              </h2>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="text-2xl text-slate-400"
              >
                ×
              </button>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm">
                分类
                <input
                  value={form.category}
                  onChange={(event) =>
                    setForm({ ...form, category: event.target.value })
                  }
                  className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                题型
                <input
                  value={form.type}
                  onChange={(event) =>
                    setForm({ ...form, type: event.target.value })
                  }
                  className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                难度系数（1-10）
                <input
                  type="number"
                  min={1}
                  max={10}
                  step={0.1}
                  value={form.difficultyScore}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      difficultyScore: Number(event.target.value),
                    })
                  }
                  className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                状态
                <select
                  value={form.status}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      status: event.target.value as FormValue["status"],
                    })
                  }
                  className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  <option value="PUBLISHED">发布</option>
                  <option value="DRAFT">草稿</option>
                </select>
              </label>
            </div>
            <label className="mt-4 block text-sm">
              题干
              <textarea
                value={form.stem}
                onChange={(event) =>
                  setForm({ ...form, stem: event.target.value })
                }
                rows={4}
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2"
              />
            </label>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {form.options.map((option, index) => (
                <label key={index} className="text-sm">
                  选项 {String.fromCharCode(65 + index)}
                  <input
                    value={option}
                    onChange={(event) => {
                      const options = [...form.options];
                      options[index] = event.target.value;
                      setForm({ ...form, options });
                    }}
                    className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2"
                  />
                </label>
              ))}
            </div>
            <label className="mt-4 block text-sm">
              正确答案
              <select
                value={form.answer}
                onChange={(event) =>
                  setForm({ ...form, answer: Number(event.target.value) })
                }
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2"
              >
                {form.options.map((_, index) => (
                  <option key={index} value={index}>
                    {String.fromCharCode(65 + index)}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-4 block text-sm">
              答案解析
              <textarea
                value={form.explanation}
                onChange={(event) =>
                  setForm({ ...form, explanation: event.target.value })
                }
                rows={4}
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2"
              />
            </label>
            {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
            <div className="sticky bottom-0 -mx-5 mt-6 flex justify-end gap-3 border-t border-slate-100 bg-white/95 px-5 py-4 backdrop-blur sm:-mx-6 sm:px-6">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="btn-ghost"
              >
                取消
              </button>
              <button
                disabled={saving}
                className="btn-primary disabled:opacity-50"
              >
                {saving ? "保存中…" : "保存题目"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

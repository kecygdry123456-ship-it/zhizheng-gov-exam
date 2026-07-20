"use client";

import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileText,
  LoaderCircle,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { PageTitle } from "./ui";

type AccountRole = "ADMIN" | "STUDENT";

type ManagedAccount = {
  id: string;
  name: string;
  email: string;
  role: AccountRole;
  targetExam: string | null;
  createdAt: string;
  activity: {
    attempts: number;
    studyPlans: number;
    trainingReports: number;
  };
};

type AccountList = {
  items: ManagedAccount[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  adminCount: number;
  currentUserId: string;
};

const emptyList: AccountList = {
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 1,
  adminCount: 0,
  currentUserId: "",
};

async function readJson(response: Response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || "请求失败，请稍后重试");
  }
  return body;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function ActivityCounts({ account }: { account: ManagedAccount }) {
  const entries = [
    { label: "作答", value: account.activity.attempts, icon: ClipboardCheck },
    { label: "计划", value: account.activity.studyPlans, icon: FileText },
    { label: "报告", value: account.activity.trainingReports, icon: FileText },
  ];

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-500">
      {entries.map(({ label, value, icon: Icon }) => (
        <span key={label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <Icon aria-hidden="true" size={14} />
          {label} {value.toLocaleString("zh-CN")}
        </span>
      ))}
    </div>
  );
}

function RoleBadge({ role }: { role: AccountRole }) {
  return role === "ADMIN" ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
      <ShieldCheck aria-hidden="true" size={13} />管理员
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">
      <UserRound aria-hidden="true" size={13} />学员
    </span>
  );
}

export function AdminUsersView() {
  const [data, setData] = useState<AccountList>(emptyList);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"" | AccountRole>("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ManagedAccount | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      page: String(page),
      pageSize: "20",
    });
    if (query) params.set("query", query);
    if (role) params.set("role", role);

    try {
      const response = await fetch(`/api/admin/users?${params.toString()}`, {
        cache: "no-store",
        signal,
      });
      const body = await readJson(response);
      const next = body.data as AccountList;
      setData(next);
      if (next.page !== page) setPage(next.page);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "账号列表加载失败");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [page, query, role]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  useEffect(() => {
    if (!deleteTarget) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [deleteTarget]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setSuccess("");
    setPage(1);
    setQuery(queryInput.trim());
  };

  const changeRole = (nextRole: "" | AccountRole) => {
    setSuccess("");
    setPage(1);
    setRole(nextRole);
  };

  const openDelete = (account: ManagedAccount) => {
    if (account.id === data.currentUserId) return;
    setDeleteError("");
    setDeleteTarget(account);
  };

  const closeDelete = () => {
    if (deleting) return;
    setDeleteTarget(null);
    setDeleteError("");
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleteTarget.id === data.currentUserId) return;
    setDeleting(true);
    setDeleteError("");
    setSuccess("");
    try {
      const response = await fetch(`/api/admin/users/${deleteTarget.id}`, {
        method: "DELETE",
      });
      await readJson(response);
      const deletedName = deleteTarget.name;
      setDeleteTarget(null);
      setSuccess(`账号“${deletedName}”已删除，关联学习数据已同步清理。`);
      await load();
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : "删除账号失败");
    } finally {
      setDeleting(false);
    }
  };

  const hasFilters = Boolean(query || role);

  return (
    <div className="fade">
      <PageTitle
        title="账号管理"
        description="查看平台注册账号及学习数据，并安全删除不再使用的账号。"
        action={(
          <div className="inline-flex w-fit items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 shadow-sm">
            <ShieldCheck aria-hidden="true" size={15} className="text-amber-600" />
            管理员 {data.adminCount} 人
          </div>
        )}
      />

      <form onSubmit={submitSearch} className="mb-5 grid gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:p-4">
        <label className="min-w-0 text-xs font-semibold text-slate-600">
          搜索账号
          <span className="relative mt-1.5 block">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              className="h-11 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-400 focus:bg-white sm:h-10"
              placeholder="输入姓名或邮箱"
              maxLength={100}
            />
          </span>
        </label>
        <label className="text-xs font-semibold text-slate-600">
          账号角色
          <select
            aria-label="账号角色"
            value={role}
            onChange={(event) => changeRole(event.target.value as "" | AccountRole)}
            className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-400 focus:bg-white sm:h-10"
          >
            <option value="">全部角色</option>
            <option value="STUDENT">学员</option>
            <option value="ADMIN">管理员</option>
          </select>
        </label>
        <button type="submit" className="btn-primary min-h-11 self-end sm:h-10 sm:min-h-0">搜索</button>
      </form>

      {error && <div role="alert" className="mb-4 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {success && <div role="status" className="mb-4 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}

      <section aria-label="账号列表" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 text-sm text-slate-500">
          <span>共 {data.total.toLocaleString("zh-CN")} 个账号</span>
          {hasFilters && <span className="text-xs">当前为筛选结果</span>}
        </div>

        {loading ? (
          <div className="grid min-h-52 place-items-center text-sm text-slate-500">
            <span className="flex items-center gap-3"><LoaderCircle aria-hidden="true" className="spinner text-indigo-600" size={20} />正在加载账号…</span>
          </div>
        ) : data.items.length === 0 ? (
          <div className="grid min-h-64 place-items-center px-6 py-14 text-center">
            <div>
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-xl bg-slate-100 text-slate-400"><UsersRound aria-hidden="true" size={25} /></span>
              <p className="mt-4 text-sm leading-6 text-slate-500">没有找到账号，请调整搜索关键词或角色筛选条件。</p>
            </div>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
                  <tr>
                    <th className="px-4 py-3">账号</th>
                    <th className="px-4 py-3">角色</th>
                    <th className="px-4 py-3">目标考试</th>
                    <th className="px-4 py-3">关联学习数据</th>
                    <th className="px-4 py-3">注册时间</th>
                    <th className="px-4 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((account) => {
                    const isCurrent = account.id === data.currentUserId;
                    return (
                      <tr key={account.id} className="border-t border-slate-100 align-middle hover:bg-slate-50/70">
                        <td className="px-4 py-4">
                          <div className="font-semibold text-slate-900">{account.name}</div>
                          <div className="mt-1 text-xs text-slate-500">{account.email}</div>
                        </td>
                        <td className="px-4 py-4"><RoleBadge role={account.role} />{isCurrent && <span className="ml-2 text-xs text-slate-400">当前账号</span>}</td>
                        <td className="max-w-[190px] truncate px-4 py-4 text-slate-600" title={account.targetExam || "未设置"}>{account.targetExam || "未设置"}</td>
                        <td className="px-4 py-4"><ActivityCounts account={account} /></td>
                        <td className="whitespace-nowrap px-4 py-4 text-slate-500">{formatDate(account.createdAt)}</td>
                        <td className="px-4 py-4 text-right">
                          <button
                            type="button"
                            onClick={() => openDelete(account)}
                            disabled={isCurrent}
                            aria-label={isCurrent ? "当前账号不可删除" : `删除账号 ${account.name}`}
                            title={isCurrent ? "当前登录账号不可删除" : "删除账号"}
                            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                          >
                            <Trash2 aria-hidden="true" size={15} />删除
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-slate-100 md:hidden">
              {data.items.map((account) => {
                const isCurrent = account.id === data.currentUserId;
                return (
                  <article key={account.id} className="p-4">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="break-words text-sm font-bold text-slate-900">{account.name}</h3>
                          <RoleBadge role={account.role} />
                          {isCurrent && <span className="text-xs text-slate-400">当前账号</span>}
                        </div>
                        <p className="mt-1 break-all text-xs text-slate-500">{account.email}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => openDelete(account)}
                        disabled={isCurrent}
                        aria-label={isCurrent ? "当前账号不可删除" : `删除账号 ${account.name}`}
                        title={isCurrent ? "当前登录账号不可删除" : "删除账号"}
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-red-100 text-red-600 disabled:cursor-not-allowed disabled:border-slate-100 disabled:text-slate-300"
                      >
                        <Trash2 aria-hidden="true" size={17} />
                      </button>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-xs">
                      <div className="min-w-0"><dt className="text-slate-400">目标考试</dt><dd className="mt-1 truncate font-medium text-slate-700">{account.targetExam || "未设置"}</dd></div>
                      <div><dt className="text-slate-400">注册时间</dt><dd className="mt-1 font-medium text-slate-700">{formatDate(account.createdAt)}</dd></div>
                    </dl>
                    <div className="mt-3"><ActivityCounts account={account} /></div>
                  </article>
                );
              })}
            </div>
          </>
        )}

        {!loading && data.total > 0 && (
          <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <span>第 {data.page}/{data.totalPages} 页</span>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn-ghost inline-flex min-h-11 items-center justify-center gap-1.5 text-xs sm:min-h-0" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                <ChevronLeft aria-hidden="true" size={15} />上一页
              </button>
              <button type="button" className="btn-ghost inline-flex min-h-11 items-center justify-center gap-1.5 text-xs sm:min-h-0" disabled={page >= data.totalPages} onClick={() => setPage((value) => Math.min(data.totalPages, value + 1))}>
                下一页<ChevronRight aria-hidden="true" size={15} />
              </button>
            </div>
          </div>
        )}
      </section>

      {deleteTarget && (
        <div className="fixed inset-0 z-50 grid items-end bg-slate-950/45 p-2 sm:place-items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDelete(); }}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-title"
            aria-describedby="delete-account-description"
            onKeyDown={(event) => { if (event.key === "Escape") closeDelete(); }}
            className="safe-bottom max-h-[calc(100dvh-1rem)] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-6"
          >
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-50 text-red-600"><AlertTriangle aria-hidden="true" size={20} /></span>
              <div className="min-w-0">
                <h2 id="delete-account-title" className="text-lg font-bold text-slate-900">确认删除账号</h2>
                <p id="delete-account-description" className="mt-2 break-words text-sm leading-6 text-slate-600">
                  将永久删除“{deleteTarget.name}”（{deleteTarget.email}）及其作答、学习计划和训练报告等关联数据，此操作无法撤销。
                </p>
              </div>
            </div>
            {deleteTarget.role === "ADMIN" && (
              <p className="mt-4 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800">
                这是管理员账号。系统必须始终至少保留一名管理员。
              </p>
            )}
            {deleteError && <p role="alert" className="mt-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 text-sm text-red-700">{deleteError}</p>}
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button type="button" autoFocus onClick={closeDelete} disabled={deleting} className="btn-ghost min-h-11 disabled:opacity-50">取消</button>
              <button type="button" onClick={() => void confirmDelete()} disabled={deleting} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50">
                <Trash2 aria-hidden="true" size={16} />{deleting ? "正在删除…" : "确认永久删除"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

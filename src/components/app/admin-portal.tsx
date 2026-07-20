"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, BookOpen, Eye, EyeOff, KeyRound, LockKeyhole, LogOut, Mail, ShieldCheck, UsersRound } from "lucide-react";
import Link from "next/link";
import { AdminView } from "./admin-view";
import { AdminUsersView } from "./admin-users-view";
import { ModelApiSettingsView } from "./model-api-settings-view";
import type { User } from "./types";
import { LoadingState, Logo } from "./ui";
import {
  activateAndroidStudyPlanAccount,
  clearAndroidStudyPlan,
  resetAndroidStudyPlanReminders,
} from "@/lib/android-study-plan-bridge";

async function readUser(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || "请求失败");
  return body.data as User;
}

export function AdminPortal() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [section, setSection] = useState<"questions" | "users" | "model">("questions");

  const loadUser = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      if (response.status === 401) {
        resetAndroidStudyPlanReminders();
        setUser(null);
        return;
      }
      const currentUser = await readUser(response);
      activateAndroidStudyPlanAccount(currentUser.id);
      setUser(currentUser);
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => { void loadUser(); }, [loadUser]);

  const logout = async () => {
    const accountId = user?.id;
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      if (accountId) clearAndroidStudyPlan(accountId);
      setUser(null);
    }
  };

  if (booting) return <div className="grid min-h-dvh place-items-center bg-slate-50"><LoadingState text="正在验证管理员身份…" /></div>;
  if (!user) return <AdminLogin onSuccess={setUser} />;
  if (user.role !== "ADMIN") return <AccessDenied user={user} onLogout={logout} />;

  return <div className="min-h-dvh bg-slate-50">
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur-xl sm:px-8">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4">
        <div className="flex items-center gap-4"><Logo dark /><span className="hidden h-7 w-px bg-slate-200 sm:block" /><div className="hidden sm:block"><div className="text-sm font-bold text-slate-900">管理后台</div><div className="text-xs text-slate-400">账号、题库与模型服务统一管理</div></div></div>
        <div className="flex items-center gap-2 sm:gap-3">
          <Link href="/" className="btn-ghost flex items-center gap-2 text-xs"><ArrowLeft size={14} />学习端</Link>
          <div className="hidden text-right sm:block"><div className="text-sm font-semibold text-slate-800">{user.name}</div><div className="text-xs text-slate-400">{user.email}</div></div>
          <button onClick={() => void logout()} className="btn-ghost flex items-center gap-2 text-xs"><LogOut size={14} />退出</button>
        </div>
      </div>
    </header>
    <main className="mx-auto max-w-[1440px] p-4 sm:p-6 lg:p-10">
      <div className="mb-6 flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <button onClick={() => setSection("questions")} className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${section === "questions" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"}`}><BookOpen size={17} />题库管理</button>
        <button onClick={() => setSection("users")} className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${section === "users" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"}`}><UsersRound size={17} />账号管理</button>
        <button onClick={() => setSection("model")} className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${section === "model" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"}`}><KeyRound size={17} />模型 API</button>
      </div>
      {section === "questions" && <AdminView onPublishedChange={async () => {}} />}
      {section === "users" && <AdminUsersView />}
      {section === "model" && <ModelApiSettingsView />}
    </main>
  </div>;
}

function AdminLogin({ onSuccess }: { onSuccess: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || body.message || "管理员登录失败");
      const user = body.data?.user as User;
      activateAndroidStudyPlanAccount(user.id);
      if (user.role !== "ADMIN") {
        await fetch("/api/auth/logout", { method: "POST" });
        clearAndroidStudyPlan(user.id);
        throw new Error("该账号没有管理员权限");
      }
      onSuccess(user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "管理员登录失败");
    } finally { setLoading(false); }
  };

  return <div className="auth-page grid min-h-dvh place-items-center px-4 py-8">
    <div className="w-full max-w-md rounded-[28px] border border-white/70 bg-white p-6 shadow-[0_28px_80px_rgba(19,32,72,.18)] sm:p-9">
      <Logo dark />
      <div className="mt-8 flex items-center gap-2 text-sm font-semibold text-indigo-700"><ShieldCheck size={18} />管理员专用入口</div>
      <h1 className="mt-3 text-3xl font-bold tracking-[-.04em] text-slate-900">登录管理后台</h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">使用已授予管理员权限的邮箱账号登录。</p>
      <form onSubmit={submit} className="mt-7 space-y-4">
        <label className="block text-sm font-semibold text-slate-700">管理员邮箱<div className="relative mt-2"><Mail className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={17} /><input type="email" className="auth-input auth-input-icon" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></div></label>
        <label className="block text-sm font-semibold text-slate-700">密码<div className="relative mt-2"><LockKeyhole className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={17} /><input type={showPassword ? "text" : "password"} className="auth-input auth-input-icon pr-12" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /><button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-0 top-0 grid h-12 w-12 place-items-center text-slate-400" aria-label={showPassword ? "隐藏密码" : "显示密码"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
        {error && <p role="alert" className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}
        <button disabled={loading} className="btn-primary w-full py-3 disabled:opacity-55">{loading ? "正在登录…" : "登录管理后台"}</button>
      </form>
      <Link href="/" className="mt-5 flex items-center justify-center gap-2 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={15} />返回学习端</Link>
    </div>
  </div>;
}

function AccessDenied({ user, onLogout }: { user: User; onLogout: () => Promise<void> }) {
  return <div className="grid min-h-dvh place-items-center bg-slate-50 px-4"><div className="card w-full max-w-md p-8 text-center"><ShieldCheck className="mx-auto text-amber-500" size={34} /><h1 className="mt-4 text-2xl font-bold text-slate-900">当前账号不是管理员</h1><p className="mt-3 text-sm leading-6 text-slate-500">当前登录账号为 {user.email}，请退出后使用管理员账号登录。</p><button onClick={() => void onLogout()} className="btn-primary mt-6 w-full">退出并切换账号</button><Link href="/" className="mt-4 block text-sm text-slate-500">返回学习端</Link></div></div>;
}

"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";
import { Logo } from "./ui";

type Mode = "login" | "register";

export function LoginView({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [targetExam, setTargetExam] = useState("国家公务员考试");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const switchMode = (next: Mode) => {
    setMode(next); setPassword(""); setConfirmPassword(""); setError(""); setShowPassword(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const payload = mode === "login" ? { email, password } : { name, email, password, confirmPassword, targetExam };
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || body.message || (mode === "login" ? "登录失败" : "注册失败"));
      await onSuccess();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "请求失败，请稍后重试"); }
    finally { setLoading(false); }
  };

  return (
    <div className="auth-page min-h-dvh overflow-y-auto px-4 py-5 sm:px-6 sm:py-8">
      <div className="mx-auto grid w-full max-w-[1040px] overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-[0_28px_80px_rgba(19,32,72,.18)] lg:min-h-[680px] lg:grid-cols-[1.05fr_.95fr]">
        <section className="relative hidden overflow-hidden bg-[#15234d] p-12 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="auth-orb auth-orb-one" /><div className="auth-orb auth-orb-two" />
          <div className="relative z-10"><Logo /></div>
          <div className="relative z-10 max-w-md">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/8 px-3 py-1.5 text-xs text-indigo-100"><Sparkles size={14} />一站式智能备考平台</div>
            <h1 className="mt-6 text-[42px] font-bold leading-[1.16] tracking-[-.04em]">把每一次练习，<br />变成看得见的进步</h1>
            <p className="mt-5 text-sm leading-7 text-indigo-100/75">基于真实题库、个人表现与每日任务和一周规划，串联专项训练、模拟考试、申论批改和错题复习。</p>
            <div className="mt-8 grid gap-3 text-sm text-indigo-50/90 sm:grid-cols-2">
              {["12,000+ 行测题库", "完整资料分析题组", "训练进度自动恢复", "个性化 AI 学习规划"].map((item) => <div key={item} className="flex items-center gap-2"><CheckCircle2 size={16} className="text-indigo-300" />{item}</div>)}
            </div>
          </div>
          <div className="relative z-10 flex items-center gap-2 text-xs text-indigo-200/60"><ShieldCheck size={14} />学习数据仅用于生成你的备考反馈</div>
        </section>

        <section className="flex min-w-0 flex-col justify-center px-6 py-8 sm:px-10 lg:px-12 lg:py-10">
          <div className="mb-8 lg:hidden"><Logo dark /></div>
          <div className="mx-auto w-full max-w-[390px]">
            <div className="flex rounded-xl bg-slate-100 p-1" aria-label="账号入口">
              <button type="button" onClick={() => switchMode("login")} className={`flex-1 rounded-[9px] px-4 py-2.5 text-sm font-semibold transition ${mode === "login" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>登录</button>
              <button type="button" onClick={() => switchMode("register")} className={`flex-1 rounded-[9px] px-4 py-2.5 text-sm font-semibold transition ${mode === "register" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>注册账号</button>
            </div>
            <h2 className="mt-8 text-[28px] font-bold tracking-[-.03em] text-slate-900">{mode === "login" ? "欢迎回来" : "创建学习账号"}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">{mode === "login" ? "登录后继续你的备考计划与学习进度" : "注册后即可开始练习，系统会自动为你建立学习档案"}</p>

            <form onSubmit={submit} className="mt-7 space-y-4">
              {mode === "register" && <Field id="auth-name" label="姓名或昵称" icon={<UserRound size={17} />}><input id="auth-name" className="auth-input auth-input-icon" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required minLength={2} maxLength={30} /></Field>}
              <Field id="auth-email" label="邮箱" icon={<Mail size={17} />}><input id="auth-email" type="email" className="auth-input auth-input-icon" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></Field>
              <Field id="auth-password" label="密码" icon={<LockKeyhole size={17} />}>
                <input id="auth-password" type={showPassword ? "text" : "password"} className="auth-input auth-input-icon pr-12" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "register" ? 8 : undefined} />
                <button type="button" className="absolute bottom-0 right-0 grid h-12 w-12 place-items-center text-slate-400 hover:text-slate-700" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "隐藏密码" : "显示密码"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
              </Field>
              {mode === "register" && <>
                <Field id="auth-confirm" label="确认密码" icon={<LockKeyhole size={17} />}><input id="auth-confirm" type={showPassword ? "text" : "password"} className="auth-input auth-input-icon" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" required minLength={8} /></Field>
                <div><label htmlFor="auth-target" className="text-sm font-semibold text-slate-700">目标考试 <span className="font-normal text-slate-400">（可选）</span></label><input id="auth-target" className="auth-input mt-2" value={targetExam} onChange={(e) => setTargetExam(e.target.value)} autoComplete="off" maxLength={80} placeholder="例如：2027 国家公务员考试" /></div>
              </>}
              {error && <p role="alert" className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}
              <button disabled={loading} className="btn-primary flex w-full items-center justify-center gap-2 py-3 disabled:opacity-55">{loading ? (mode === "login" ? "正在登录…" : "正在创建账号…") : (mode === "login" ? "登录学习系统" : "注册并开始学习")}<ArrowRight size={17} aria-hidden="true" /></button>
            </form>
            {process.env.NODE_ENV !== "production" && mode === "login" && <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-500">开发演示账号：student@zhizheng.local / Demo123456</div>}
            <p className="mt-5 text-center text-xs leading-5 text-slate-400">公开注册仅创建学员账号，管理员权限由系统后台配置</p>
            <Link href="/admin" className="mt-3 block text-center text-sm font-semibold text-indigo-600 hover:text-indigo-800">进入管理员后台</Link>
          </div>
        </section>
      </div>
    </div>
  );
}

function Field({ id, label, icon, children }: { id: string; label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <div className="relative"><label htmlFor={id} className="text-sm font-semibold text-slate-700">{label}</label><span className="pointer-events-none absolute bottom-[15px] left-4 text-slate-400">{icon}</span>{children}</div>;
}

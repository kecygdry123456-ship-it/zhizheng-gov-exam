import type { ReactNode } from "react";
import { BookOpen, Inbox, LoaderCircle } from "lucide-react";

export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="relative grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-gradient-to-br from-[#5880f8] to-[#2f56d6] text-white shadow-[0_6px_18px_rgba(47,86,214,.38)]">
        <BookOpen size={19} strokeWidth={2.3} aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <div className={`text-[17px] font-bold tracking-[.04em] ${dark ? "text-slate-900" : "text-white"}`}>
          知政公考
        </div>
        <div className={`mt-0.5 truncate text-[9px] tracking-[.16em] ${dark ? "text-slate-400" : "text-slate-400/90"}`}>
          高效备考 · 稳步上岸
        </div>
      </div>
    </div>
  );
}

export function PageTitle({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[26px] font-bold tracking-[-.025em] text-slate-900 sm:text-[30px]">{title}</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-500">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ text, action, actionLabel = "重新加载" }: { text: string; action?: () => void; actionLabel?: string }) {
  return (
    <div className="card grid min-h-64 place-items-center px-6 py-14 text-center">
      <div>
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-slate-100 to-slate-50 text-slate-400 shadow-sm">
          <Inbox size={26} aria-hidden="true" />
        </div>
        <p className="mt-5 text-sm leading-6 text-slate-500">{text}</p>
        {action && <button onClick={action} className="btn-primary mt-5">{actionLabel}</button>}
      </div>
    </div>
  );
}

export function LoadingState({ text = "正在加载…" }: { text?: string }) {
  return (
    <div className="card grid min-h-52 place-items-center text-sm text-slate-500">
      <div className="flex items-center gap-3">
        <LoaderCircle className="spinner text-[#2f56d6]" size={20} aria-hidden="true" />
        {text}
      </div>
    </div>
  );
}

const statTones = {
  primary: { bg: "bg-[#eef2ff]", text: "text-[#2f56d6]", accent: "#2f56d6", glow: "rgba(47,86,214,.15)" },
  accent:  { bg: "bg-[#fff3ed]", text: "text-[#e05020]", accent: "#e05020", glow: "rgba(240,89,44,.15)" },
  success: { bg: "bg-[#edfaf4]", text: "text-[#0d9060]", accent: "#0d9060", glow: "rgba(13,144,96,.15)" },
  slate:   { bg: "bg-slate-100",  text: "text-slate-600",  accent: "#475d7a", glow: "rgba(71,93,122,.12)" },
};

export function StatCard({ label, value, unit, icon, tone = "primary" }: {
  label: string; value: string | number; unit?: string; icon: ReactNode;
  tone?: "primary" | "accent" | "success" | "slate";
}) {
  const t = statTones[tone];
  return (
    <div className="card flex items-center gap-4 p-5">
      <div
        className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${t.bg} ${t.text}`}
        style={{ boxShadow: `0 4px 14px ${t.glow}` }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs font-medium text-slate-500">{label}</div>
        <div className="mt-0.5 flex items-baseline gap-1.5">
          <strong className="text-[26px] font-bold tracking-[-.04em] text-slate-900">{value}</strong>
          {unit && <span className="text-xs text-slate-400">{unit}</span>}
        </div>
      </div>
    </div>
  );
}

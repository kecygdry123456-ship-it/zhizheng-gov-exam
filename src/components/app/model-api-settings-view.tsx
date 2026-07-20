"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Eye, EyeOff, KeyRound, ServerCog, Trash2 } from "lucide-react";
import { LoadingState, PageTitle } from "./ui";

type ModelConfig = {
  source: "DATABASE" | "ENVIRONMENT";
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyMasked: string;
  model: string;
  baseUrl: string;
  updatedAt: string | null;
};

export function ModelApiSettingsView() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [masked, setMasked] = useState("");
  const [source, setSource] = useState<ModelConfig["source"]>("DATABASE");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [form, setForm] = useState({ enabled: false, apiKey: "", model: "", baseUrl: "https://api.openai.com/v1" });

  const applyConfig = useCallback((config: ModelConfig) => {
    setForm({ enabled: config.enabled, apiKey: "", model: config.model, baseUrl: config.baseUrl });
    setHasApiKey(config.hasApiKey); setMasked(config.apiKeyMasked); setSource(config.source); setClearApiKey(false);
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/model-config", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "模型配置加载失败");
      applyConfig(body.data);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "模型配置加载失败"); }
    finally { setLoading(false); }
  }, [applyConfig]);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/model-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: form.enabled, model: form.model, baseUrl: form.baseUrl, ...(form.apiKey ? { apiKey: form.apiKey } : {}), ...(clearApiKey ? { clearApiKey: true } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "模型配置保存失败");
      applyConfig(body.data); setMessage("模型 API 配置已保存，用户端将自动使用此配置。");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "模型配置保存失败"); }
    finally { setSaving(false); }
  };

  if (loading) return <LoadingState text="正在读取模型 API 配置…" />;

  return <div className="fade">
    <PageTitle title="模型 API 管理" description="统一配置大模型 API Key、模型标识和 Base URL，所有用户自动复用。" />
    <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <form onSubmit={save} className="card p-5 sm:p-7">
        <label className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <span><span className="block font-semibold text-slate-800">启用模型服务</span><span className="mt-1 block text-xs leading-5 text-slate-500">关闭后用户端会使用系统数据规则生成学习计划。</span></span>
          <input type="checkbox" className="mt-1 h-5 w-5 accent-indigo-600" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
        </label>

        <div className="mt-6 grid gap-5">
          <label htmlFor="model-api-key" className="text-sm font-semibold text-slate-700">API Key
            <div className="relative mt-2"><KeyRound className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={17} /><input id="model-api-key" type={showKey ? "text" : "password"} value={form.apiKey} onChange={(event) => { setForm({ ...form, apiKey: event.target.value }); setClearApiKey(false); }} className="field pl-11 pr-12" autoComplete="off" placeholder={hasApiKey && !clearApiKey ? masked : "输入新的 API Key"} /><button type="button" onClick={() => setShowKey((value) => !value)} className="absolute right-0 top-0 grid h-full w-12 place-items-center text-slate-400" aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}>{showPasswordIcon(showKey)}</button></div>
            <span className="mt-2 block text-xs font-normal text-slate-400">留空会保留已保存的 Key，完整 Key 不会从服务器返回。</span>
          </label>
          {hasApiKey && <button type="button" onClick={() => { setClearApiKey(true); setForm({ ...form, apiKey: "", enabled: false }); }} className="flex w-fit items-center gap-2 text-xs font-semibold text-red-500"><Trash2 size={14} />{clearApiKey ? "保存后将清除 API Key" : "清除已保存的 API Key"}</button>}
          <label htmlFor="model-name" className="text-sm font-semibold text-slate-700">模型标识<input id="model-name" value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} className="field mt-2" placeholder="例如 gpt-5-mini 或服务商提供的模型名称" maxLength={200} /></label>
          <label htmlFor="model-base-url" className="text-sm font-semibold text-slate-700">Base URL<div className="relative mt-2"><ServerCog className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={17} /><input id="model-base-url" type="url" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} className="field pl-11" placeholder="https://api.openai.com/v1" required /></div></label>
        </div>
        {error && <p role="alert" className="mt-5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}
        {message && <p className="mt-5 flex items-center gap-2 rounded-xl border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-700"><CheckCircle2 size={16} />{message}</p>}
        <div className="mt-6 flex justify-end"><button disabled={saving} className="btn-primary disabled:opacity-50">{saving ? "正在保存…" : "保存模型配置"}</button></div>
      </form>

      <aside className="card h-fit p-5 sm:p-6">
        <h2 className="font-bold text-slate-900">配置说明</h2>
        <dl className="mt-4 space-y-4 text-sm"><div><dt className="text-slate-400">当前来源</dt><dd className="mt-1 font-semibold text-slate-700">{source === "DATABASE" ? "管理后台数据库配置" : "服务器环境变量"}</dd></div><div><dt className="text-slate-400">API Key</dt><dd className="mt-1 font-semibold text-slate-700">{hasApiKey && !clearApiKey ? masked : "未配置"}</dd></div><div><dt className="text-slate-400">用户端行为</dt><dd className="mt-1 leading-6 text-slate-600">用户无需输入 Key。生成计划时服务器自动调用模型，失败时自动回退数据规则。</dd></div></dl>
      </aside>
    </div>
  </div>;
}

function showPasswordIcon(show: boolean) {
  return show ? <EyeOff size={18} /> : <Eye size={18} />;
}

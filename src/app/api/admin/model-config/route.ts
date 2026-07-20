import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { normalizeModelBaseUrl } from "@/lib/model-url";
import { encryptSecret } from "@/lib/secret-box";

const input = z.object({
  enabled: z.boolean(),
  apiKey: z.string().trim().min(8).max(1000).optional(),
  clearApiKey: z.boolean().optional(),
  model: z.string().trim().max(200).optional(),
  baseUrl: z.url("Base URL 格式不正确").max(500),
});

function responseData(config: { apiKeyEncrypted: string | null; model: string | null; baseUrl: string; enabled: boolean; updatedAt: Date } | null) {
  if (config) return { source: "DATABASE", enabled: config.enabled, hasApiKey: Boolean(config.apiKeyEncrypted), apiKeyMasked: config.apiKeyEncrypted ? "••••••••（已配置）" : "", model: config.model || "", baseUrl: config.baseUrl, updatedAt: config.updatedAt };
  const hasApiKey = Boolean(process.env.OPENAI_API_KEY);
  return { source: "ENVIRONMENT", enabled: Boolean(hasApiKey && process.env.OPENAI_MODEL), hasApiKey, apiKeyMasked: hasApiKey ? "••••••••（环境变量）" : "", model: process.env.OPENAI_MODEL || "", baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1", updatedAt: null };
}

export async function GET() {
  if (!await isAdmin()) return NextResponse.json({ error: { code: "FORBIDDEN", message: "无管理权限", details: null } }, { status: 403 });
  const config = await prisma.modelConfig.findUnique({ where: { id: "default" } });
  return NextResponse.json({ data: responseData(config) });
}

export async function PUT(request: Request) {
  if (!await isAdmin()) return NextResponse.json({ error: { code: "FORBIDDEN", message: "无管理权限", details: null } }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "模型 API 配置不正确", details: parsed.error.flatten() } }, { status: 400 });
  try {
    const current = await prisma.modelConfig.findUnique({ where: { id: "default" } });
    const baseUrl = await normalizeModelBaseUrl(parsed.data.baseUrl);
    const apiKeyEncrypted = parsed.data.clearApiKey ? null : parsed.data.apiKey ? encryptSecret(parsed.data.apiKey) : current?.apiKeyEncrypted || null;
    const model = parsed.data.model?.trim() || null;
    if (parsed.data.enabled && (!apiKeyEncrypted || !model)) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "启用模型服务前必须配置 API Key 和模型标识", details: null } }, { status: 400 });
    const config = await prisma.modelConfig.upsert({
      where: { id: "default" },
      update: { enabled: parsed.data.enabled, apiKeyEncrypted, model, baseUrl },
      create: { id: "default", enabled: parsed.data.enabled, apiKeyEncrypted, model, baseUrl },
    });
    return NextResponse.json({ data: responseData(config) });
  } catch (reason) {
    return NextResponse.json({ error: { code: "INVALID_MODEL_CONFIG", message: reason instanceof Error ? reason.message : "模型 API 配置保存失败", details: null } }, { status: 400 });
  }
}

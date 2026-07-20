import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/secret-box";

export type ModelConnection = { apiKey?: string; model?: string; baseUrl?: string };

export async function getEffectiveModelConnection(): Promise<ModelConnection> {
  const stored = await prisma.modelConfig.findUnique({ where: { id: "default" } });
  if (stored) {
    if (!stored.enabled || !stored.apiKeyEncrypted || !stored.model) return {};
    try {
      return { apiKey: decryptSecret(stored.apiKeyEncrypted), model: stored.model, baseUrl: stored.baseUrl };
    } catch {
      return {};
    }
  }
  return {
    apiKey: process.env.OPENAI_API_KEY || undefined,
    model: process.env.OPENAI_MODEL || undefined,
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  };
}

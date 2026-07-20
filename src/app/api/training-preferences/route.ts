import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getTrainingRecommendation } from "@/lib/training-recommendation";
import { normalizeQuestionScopes, questionScopesSchema } from "@/lib/question-scope";

const input = z.object({
  practiceCount: z.number().int().min(5).max(100), practiceCategory: z.string().trim().max(30).nullable(), practiceScopes: questionScopesSchema.optional(), practiceDifficultyMode: z.enum(["EASY", "MEDIUM", "HARD", "CUSTOM", "RECOMMENDED"]), practiceMinDifficulty: z.number().min(1).max(10), practiceMaxDifficulty: z.number().min(1).max(10),
  examCount: z.number().int().min(5).max(100), examDuration: z.number().int().min(5).max(240), examDifficultyMode: z.enum(["EASY", "MEDIUM", "HARD", "CUSTOM", "RECOMMENDED"]), examMinDifficulty: z.number().min(1).max(10), examMaxDifficulty: z.number().min(1).max(10),
}).superRefine((value, context) => { if (value.practiceMinDifficulty > value.practiceMaxDifficulty) context.addIssue({ code: "custom", path: ["practiceMinDifficulty"], message: "专项最低难度不能高于最高难度" }); if (value.examMinDifficulty > value.examMaxDifficulty) context.addIssue({ code: "custom", path: ["examMinDifficulty"], message: "模拟最低难度不能高于最高难度" }); });

const defaults = { practiceCount: 20, practiceCategory: null, practiceScopes: [], practiceDifficultyMode: "CUSTOM", practiceMinDifficulty: 1, practiceMaxDifficulty: 10, examCount: 50, examDuration: 60, examDifficultyMode: "CUSTOM", examMinDifficulty: 1, examMaxDifficulty: 10 };

export async function GET() {
  const session = await getSession(); if (!session?.id) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "请先登录" } }, { status: 401 });
  const [preference, recommendation] = await Promise.all([prisma.trainingPreference.findUnique({ where: { userId: String(session.id) } }), getTrainingRecommendation(String(session.id))]);
  return NextResponse.json({ data: { preference: preference ? { ...preference, practiceScopes: normalizeQuestionScopes(preference.practiceScopes) } : defaults, recommendation } });
}

export async function PUT(request: Request) {
  const session = await getSession(); if (!session?.id) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "请先登录" } }, { status: 401 });
  const parsed = input.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "训练配置不正确", details: parsed.error.flatten() } }, { status: 400 });
  const data = parsed.data;
  const update = { ...data, ...(data.practiceScopes ? { practiceScopes: normalizeQuestionScopes(data.practiceScopes) } : {}) };
  const preference = await prisma.trainingPreference.upsert({ where: { userId: String(session.id) }, update, create: { userId: String(session.id), ...data, practiceScopes: normalizeQuestionScopes(data.practiceScopes) } });
  return NextResponse.json({ data: { ...preference, practiceScopes: normalizeQuestionScopes(preference.practiceScopes) } });
}

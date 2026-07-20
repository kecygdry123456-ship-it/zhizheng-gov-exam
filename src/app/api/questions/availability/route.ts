import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { parseQuestionScopesParameter, questionScopesSchema, questionScopesWhere } from "@/lib/question-scope";
import {
  GENERAL_KNOWLEDGE_QUESTION_TYPES,
  POLITICS_QUESTION_TYPES,
} from "@/lib/exam-templates";

const input = z.object({ category: z.string().trim().max(30).optional(), scopes: questionScopesSchema.default([]), questionPool: z.enum(["POLITICS", "GENERAL_KNOWLEDGE"]).optional(), minDifficulty: z.coerce.number().min(1).max(10).default(1), maxDifficulty: z.coerce.number().min(1).max(10).default(10) }).superRefine((value, context) => {
  if (value.minDifficulty > value.maxDifficulty) context.addIssue({ code: "custom", path: ["minDifficulty"], message: "最低难度不能高于最高难度" });
});

export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.id) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "请先登录" } }, { status: 401 });
  const url = new URL(request.url); const parsedScopes = parseQuestionScopesParameter(url.searchParams.get("scopes"));
  if (!parsedScopes.success) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "细分板块参数不正确" } }, { status: 400 });
  const parsed = input.safeParse({ category: url.searchParams.get("category") || undefined, scopes: parsedScopes.data, questionPool: url.searchParams.get("questionPool") || undefined, minDifficulty: url.searchParams.get("minDifficulty") ?? undefined, maxDifficulty: url.searchParams.get("maxDifficulty") ?? undefined });
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "筛选参数不正确", details: parsed.error.flatten() } }, { status: 400 });
  const rows = await prisma.question.findMany({ where: { status: "PUBLISHED", difficultyScore: { gte: parsed.data.minDifficulty, lte: parsed.data.maxDifficulty }, ...(parsed.data.category ? { category: { name: parsed.data.category } } : {}), ...questionScopesWhere(parsed.data.scopes), ...(parsed.data.questionPool ? { type: { in: parsed.data.questionPool === "POLITICS" ? [...POLITICS_QUESTION_TYPES] : [...GENERAL_KNOWLEDGE_QUESTION_TYPES] } } : {}) }, select: { materialId: true, type: true, stem: true, category: { select: { name: true } } } });
  const politicalTerms = ["习近平", "马克思", "毛泽东", "中国特色社会主义", "中国共产党", "党中央", "党的二十大", "二十届", "全会"];
  const poolRows = parsed.data.questionPool === "GENERAL_KNOWLEDGE"
    ? rows.filter((row) => !politicalTerms.some((term) => row.stem.includes(term)))
    : rows;
  const counts = new Map<string, number>(); for (const row of poolRows) if (row.materialId) counts.set(row.materialId, (counts.get(row.materialId) || 0) + 1);
  const eligible = poolRows.filter((row) => row.materialId ? counts.get(row.materialId) === 5 : row.category.name !== "资料分析");
  return NextResponse.json({ data: { total: eligible.length, materialGroups: [...counts.values()].filter((count) => count === 5).length } });
}

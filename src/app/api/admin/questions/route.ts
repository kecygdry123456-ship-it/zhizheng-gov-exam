import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/admin-auth";
import { adminQuestionQuery, questionInput } from "@/lib/validations/question";
import { difficultyLabel } from "@/lib/difficulty";

export async function GET(request: Request) {
  if (!await isAdmin()) return NextResponse.json({ error: { code: "FORBIDDEN", message: "无管理权限", details: null } }, { status: 403 });
  const url = new URL(request.url);
  const parsed = adminQuestionQuery.safeParse({
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
    query: url.searchParams.get("query") || undefined,
    status: url.searchParams.get("status") || undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "查询参数不正确", details: parsed.error.flatten() } }, { status: 400 });
  const { page, pageSize, query, status } = parsed.data;
  const where = {
    ...(status ? { status } : {}),
    ...(query ? { OR: [{ stem: { contains: query, mode: "insensitive" as const } }, { type: { contains: query, mode: "insensitive" as const } }, { category: { name: { contains: query, mode: "insensitive" as const } } }] } : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.question.count({ where }),
    prisma.question.findMany({ where, include: { category: true }, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return NextResponse.json({ data: { items: rows.map((item) => ({ ...item, category: item.category.name })), page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
}

export async function POST(request: Request) {
  if (!await isAdmin()) return NextResponse.json({ error: { code: "FORBIDDEN", message: "无管理权限", details: null } }, { status: 403 });
  const parsed = questionInput.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "题目信息不完整", details: parsed.error.flatten() } }, { status: 400 });
  const value = parsed.data;
  const category = await prisma.category.upsert({ where: { name: value.category }, update: {}, create: { name: value.category } });
  const difficultyScore = value.difficultyScore ?? ({ 基础: 3, 进阶: 5.5, 困难: 8 }[value.difficulty]);
  const row = await prisma.question.create({ data: { categoryId: category.id, type: value.type, stem: value.stem, options: value.options, answer: value.answer, explanation: value.explanation, difficultyScore, difficulty: difficultyLabel(difficultyScore), status: value.status } });
  return NextResponse.json({ data: { ...row, category: value.category } }, { status: 201 });
}

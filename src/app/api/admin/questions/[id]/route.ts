import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/admin-auth";
import { questionInput } from "@/lib/validations/question";
import { difficultyLabel } from "@/lib/difficulty";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdmin()) return NextResponse.json({ error: { code: "FORBIDDEN", message: "无管理权限", details: null } }, { status: 403 });
  const { id } = await params;
  const parsed = questionInput.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "题目信息不完整", details: parsed.error.flatten() } }, { status: 400 });
  const exists = await prisma.question.findUnique({ where: { id } });
  if (!exists) return NextResponse.json({ error: { code: "NOT_FOUND", message: "题目不存在", details: null } }, { status: 404 });
  const value = parsed.data;
  const category = await prisma.category.upsert({ where: { name: value.category }, update: {}, create: { name: value.category } });
  const difficultyScore = value.difficultyScore ?? ({ 基础: 3, 进阶: 5.5, 困难: 8 }[value.difficulty]);
  const row = await prisma.question.update({ where: { id }, data: { categoryId: category.id, type: value.type, stem: value.stem, options: value.options, answer: value.answer, explanation: value.explanation, difficultyScore, difficulty: difficultyLabel(difficultyScore), status: value.status } });
  return NextResponse.json({ data: { ...row, category: value.category } });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdmin()) return NextResponse.json({ error: { code: "FORBIDDEN", message: "无管理权限", details: null } }, { status: 403 });
  const { id } = await params;
  const exists = await prisma.question.findUnique({ where: { id } });
  if (!exists) return NextResponse.json({ error: { code: "NOT_FOUND", message: "题目不存在", details: null } }, { status: 404 });
  const row = await prisma.question.update({ where: { id }, data: { status: "DRAFT" } });
  return NextResponse.json({ data: row });
}

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { effectiveElapsedSeconds } from "@/lib/session-timing";

const answerInput = z.object({
  selected: z.number().int().nonnegative(),
  duration: z.number().int().nonnegative().max(8 * 60 * 60).default(0),
  mode: z.enum(["PRACTICE", "EXAM"]).default("PRACTICE"),
  practiceSessionId: z.string().min(1).optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const question = await prisma.question.findUnique({ where: { id }, include: { category: true } });
  if (!question || question.status !== "PUBLISHED") return NextResponse.json({ error: { code: "NOT_FOUND", message: "题目不存在", details: null } }, { status: 404 });
  return NextResponse.json({ data: { id: question.id, category: question.category.name, type: question.type, stem: question.stem, options: question.options, difficulty: question.difficulty, difficultyScore: question.difficultyScore } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.id) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "请先登录", details: null } }, { status: 401 });
  const { id } = await params;
  const parsed = answerInput.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "答案信息不正确", details: parsed.error.flatten() } }, { status: 400 });
  if (parsed.data.mode === "EXAM") return NextResponse.json({ error: { code: "INVALID_INPUT", message: "模拟考试答案必须通过考试会话统一提交", details: null } }, { status: 400 });
  const question = await prisma.question.findUnique({ where: { id } });
  if (!question) return NextResponse.json({ error: { code: "NOT_FOUND", message: "题目不存在", details: null } }, { status: 404 });
  let practiceSession = null;
  if (parsed.data.practiceSessionId) {
    if (parsed.data.mode !== "PRACTICE") return NextResponse.json({ error: { code: "INVALID_INPUT", message: "专项会话只能记录专项练习作答", details: null } }, { status: 400 });
    practiceSession = await prisma.practiceSession.findFirst({ where: { id: parsed.data.practiceSessionId, userId: String(session.id), status: "IN_PROGRESS" } });
    const sessionQuestionIds = practiceSession?.questionIds as string[] | undefined;
    if (!practiceSession || !sessionQuestionIds?.includes(id)) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "题目不属于当前专项练习", details: null } }, { status: 400 });
    if (practiceSession.pausedAt) return NextResponse.json({ error: { code: "SESSION_PAUSED", message: "专项练习已暂停，请先继续", details: null } }, { status: 409 });
  } else if (question.status !== "PUBLISHED") return NextResponse.json({ error: { code: "NOT_FOUND", message: "题目不存在", details: null } }, { status: 404 });
  const options = Array.isArray(question.options) ? question.options : [];
  if (parsed.data.selected >= options.length) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "答案选项不正确", details: null } }, { status: 400 });
  const correct = parsed.data.selected === question.answer;
  if (practiceSession) {
    const elapsed = effectiveElapsedSeconds(practiceSession);
    const duration = Math.min(parsed.data.duration, elapsed, 8 * 60 * 60);
    try {
      const attempt = await prisma.$transaction(async (tx) => {
        const updated = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          UPDATE "PracticeSession"
          SET "answers" = jsonb_set(COALESCE("answers", '{}'::jsonb), ARRAY[${id}], to_jsonb(${parsed.data.selected}::integer), true),
              "questionDurations" = jsonb_set(COALESCE("questionDurations", '{}'::jsonb), ARRAY[${id}], to_jsonb(GREATEST(COALESCE(("questionDurations" ->> ${id})::integer, 0), ${duration})::integer), true),
              "updatedAt" = NOW()
          WHERE "id" = ${practiceSession.id} AND "userId" = ${String(session.id)}
            AND "status" = 'IN_PROGRESS' AND "pausedAt" IS NULL
          RETURNING "id"
        `);
        if (!updated.length) throw new Error("PRACTICE_SESSION_ENDED");
        return tx.attempt.upsert({
          where: {
            practiceSessionId_questionId: {
              practiceSessionId: practiceSession.id,
              questionId: id,
            },
          },
          update: {
            selected: parsed.data.selected,
            correct,
            duration,
          },
          create: {
            userId: String(session.id),
            questionId: id,
            practiceSessionId: practiceSession.id,
            selected: parsed.data.selected,
            correct,
            mode: "PRACTICE",
            duration,
          },
        });
      });
      return NextResponse.json({ data: { attemptId: attempt.id, selected: parsed.data.selected } });
    } catch (reason) {
      if (reason instanceof Error && reason.message === "PRACTICE_SESSION_ENDED") return NextResponse.json({ error: { code: "INVALID_INPUT", message: "专项练习已经结束", details: null } }, { status: 409 });
      throw reason;
    }
  }
  const attempt = await prisma.attempt.create({ data: { userId: String(session.id), questionId: id, selected: parsed.data.selected, correct, mode: parsed.data.mode, duration: parsed.data.duration } });
  return NextResponse.json({ data: { attemptId: attempt.id, correct, selected: parsed.data.selected, correctAnswer: question.answer, explanation: question.explanation } });
}

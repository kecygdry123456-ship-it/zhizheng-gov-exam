import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { effectiveElapsedSeconds, sessionDeadlineAt } from "@/lib/session-timing";

const progressInput = z.object({
  questionId: z.string().min(1),
  selected: z.number().int().nonnegative().optional(),
  durationSeconds: z.number().int().nonnegative().max(8 * 60 * 60).optional(),
}).refine((value) => value.selected !== undefined || value.durationSeconds !== undefined, { message: "至少需要保存答案或用时" });
const input = z.union([
  progressInput,
  z.object({ paused: z.boolean() }),
  z.object({ status: z.literal("ABANDONED") }),
]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(); if (!session?.id) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "请先登录" } }, { status: 401 });
  const parsed = input.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "考试保存内容不正确" } }, { status: 400 });
  const { id } = await params; const exam = await prisma.examSession.findFirst({ where: { id, userId: String(session.id), status: "IN_PROGRESS" } }); if (!exam) return NextResponse.json({ error: { code: "NOT_FOUND", message: "考试会话不存在" } }, { status: 404 });
  if ("status" in parsed.data) { const abandoned = await prisma.examSession.updateMany({ where: { id, userId: String(session.id), status: "IN_PROGRESS" }, data: { status: "ABANDONED" } }); return NextResponse.json({ data: { abandoned: abandoned.count === 1 } }); }
  if ("paused" in parsed.data) {
    if (parsed.data.paused) {
      await prisma.examSession.updateMany({
        where: { id, userId: String(session.id), status: "IN_PROGRESS", pausedAt: null },
        data: { pausedAt: new Date() },
      });
    } else {
      await prisma.$executeRaw(Prisma.sql`
        UPDATE "ExamSession"
        SET "pausedDurationSeconds" = "pausedDurationSeconds" +
              GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (timezone('UTC', NOW()) - "pausedAt")))::integer),
            "pausedAt" = NULL,
            "updatedAt" = NOW()
        WHERE "id" = ${id} AND "userId" = ${String(session.id)}
          AND "status" = 'IN_PROGRESS' AND "pausedAt" IS NOT NULL
      `);
    }
    const updated = await prisma.examSession.findUniqueOrThrow({
      where: { id },
      select: { startedAt: true, durationMinutes: true, pausedAt: true, pausedDurationSeconds: true },
    });
    return NextResponse.json({ data: {
      paused: Boolean(updated.pausedAt),
      pausedAt: updated.pausedAt,
      pausedDurationSeconds: updated.pausedDurationSeconds,
      deadlineAt: sessionDeadlineAt(updated, updated.durationMinutes),
    } });
  }
  if (exam.pausedAt) return NextResponse.json({ error: { code: "SESSION_PAUSED", message: "模拟考试已暂停，请先继续" } }, { status: 409 });
  if (Date.now() >= sessionDeadlineAt(exam, exam.durationMinutes).getTime()) return NextResponse.json({ error: { code: "EXAM_EXPIRED", message: "考试时间已结束，请交卷查看结果" } }, { status: 409 });
  const ids = exam.questionIds as string[]; if (!ids.includes(parsed.data.questionId)) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "题目不属于当前试卷" } }, { status: 400 });
  const question = await prisma.question.findUnique({ where: { id: parsed.data.questionId } });
  const options = Array.isArray(question?.options) ? question.options : [];
  if (!question || (parsed.data.selected !== undefined && parsed.data.selected >= options.length)) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "选项不正确" } }, { status: 400 });
  let boundedDuration: number | undefined;
  if (parsed.data.durationSeconds !== undefined) {
    const elapsed = effectiveElapsedSeconds(exam);
    boundedDuration = Math.min(parsed.data.durationSeconds, elapsed, exam.durationMinutes * 60);
  }
  const questionId = parsed.data.questionId;
  let updatedCount = 0;
  if (parsed.data.selected !== undefined && boundedDuration !== undefined) {
    updatedCount = await prisma.$executeRaw(Prisma.sql`
      UPDATE "ExamSession"
      SET "answers" = jsonb_set(COALESCE("answers", '{}'::jsonb), ARRAY[${questionId}], to_jsonb(${parsed.data.selected}::integer), true),
          "questionDurations" = jsonb_set(COALESCE("questionDurations", '{}'::jsonb), ARRAY[${questionId}], to_jsonb(GREATEST(COALESCE(("questionDurations" ->> ${questionId})::integer, 0), ${boundedDuration})::integer), true),
          "updatedAt" = NOW()
      WHERE "id" = ${id} AND "userId" = ${String(session.id)}
        AND "status" = 'IN_PROGRESS' AND "pausedAt" IS NULL
    `);
  } else if (parsed.data.selected !== undefined) {
    updatedCount = await prisma.$executeRaw(Prisma.sql`
      UPDATE "ExamSession"
      SET "answers" = jsonb_set(COALESCE("answers", '{}'::jsonb), ARRAY[${questionId}], to_jsonb(${parsed.data.selected}::integer), true),
          "updatedAt" = NOW()
      WHERE "id" = ${id} AND "userId" = ${String(session.id)}
        AND "status" = 'IN_PROGRESS' AND "pausedAt" IS NULL
    `);
  } else if (boundedDuration !== undefined) {
    updatedCount = await prisma.$executeRaw(Prisma.sql`
      UPDATE "ExamSession"
      SET "questionDurations" = jsonb_set(COALESCE("questionDurations", '{}'::jsonb), ARRAY[${questionId}], to_jsonb(GREATEST(COALESCE(("questionDurations" ->> ${questionId})::integer, 0), ${boundedDuration})::integer), true),
          "updatedAt" = NOW()
      WHERE "id" = ${id} AND "userId" = ${String(session.id)}
        AND "status" = 'IN_PROGRESS' AND "pausedAt" IS NULL
    `);
  }
  if (!updatedCount) return NextResponse.json({ error: { code: "EXAM_ENDED", message: "考试会话已经结束" } }, { status: 409 });
  const updated = await prisma.examSession.findUnique({ where: { id }, select: { answers: true, questionDurations: true } });
  const answers = updated?.answers as Record<string, number> || {};
  return NextResponse.json({ data: { saved: true, answered: Object.keys(answers).length, questionDurations: updated?.questionDurations || {} } });
}

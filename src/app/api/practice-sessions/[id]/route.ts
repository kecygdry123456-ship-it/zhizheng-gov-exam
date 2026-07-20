import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { effectiveElapsedSeconds } from "@/lib/session-timing";

const progressInput = z
  .object({
    questionId: z.string().min(1).optional(),
    durationSeconds: z.number().int().nonnegative().max(8 * 60 * 60).optional(),
    currentIndex: z.number().int().nonnegative().max(149).optional(),
  })
  .refine(
    (value) =>
      value.currentIndex !== undefined ||
      (value.questionId !== undefined && value.durationSeconds !== undefined),
    { message: "至少需要保存题目位置或逐题用时" },
  );
const input = z.union([
  progressInput,
  z.object({ paused: z.boolean() }),
  z.object({ status: z.literal("ABANDONED") }),
]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.id)
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "请先登录" } },
      { status: 401 },
    );
  const parsed = input.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "专项练习进度不正确" } },
      { status: 400 },
    );
  const { id } = await params;
  const active = await prisma.practiceSession.findFirst({
    where: { id, userId: String(session.id), status: "IN_PROGRESS" },
  });
  if (!active)
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "专项练习会话不存在" } },
      { status: 404 },
    );
  if ("status" in parsed.data) {
    await prisma.practiceSession.updateMany({
      where: { id, userId: String(session.id), status: "IN_PROGRESS" },
      data: { status: "ABANDONED", completedAt: new Date() },
    });
    return NextResponse.json({ data: { abandoned: true } });
  }
  if ("paused" in parsed.data) {
    if (parsed.data.paused) {
      await prisma.practiceSession.updateMany({
        where: {
          id,
          userId: String(session.id),
          status: "IN_PROGRESS",
          pausedAt: null,
        },
        data: { pausedAt: new Date() },
      });
    } else {
      await prisma.$executeRaw(Prisma.sql`
        UPDATE "PracticeSession"
        SET "pausedDurationSeconds" = "pausedDurationSeconds" +
              GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (timezone('UTC', NOW()) - "pausedAt")))::integer),
            "pausedAt" = NULL,
            "updatedAt" = NOW()
        WHERE "id" = ${id} AND "userId" = ${String(session.id)}
          AND "status" = 'IN_PROGRESS' AND "pausedAt" IS NOT NULL
      `);
    }
    const updated = await prisma.practiceSession.findUniqueOrThrow({
      where: { id },
      select: { pausedAt: true, pausedDurationSeconds: true },
    });
    return NextResponse.json({
      data: {
        paused: Boolean(updated.pausedAt),
        pausedAt: updated.pausedAt,
        pausedDurationSeconds: updated.pausedDurationSeconds,
      },
    });
  }
  if (active.pausedAt)
    return NextResponse.json(
      { error: { code: "SESSION_PAUSED", message: "专项练习已暂停，请先继续" } },
      { status: 409 },
    );
  const ids = active.questionIds as string[];
  if (
    parsed.data.questionId !== undefined &&
    !ids.includes(parsed.data.questionId)
  )
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "题目不属于当前专项练习" } },
      { status: 400 },
    );
  if (
    parsed.data.currentIndex !== undefined &&
    parsed.data.currentIndex >= ids.length
  )
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "题目位置超出范围" } },
      { status: 400 },
    );
  if (
    parsed.data.questionId !== undefined &&
    parsed.data.durationSeconds !== undefined
  ) {
    const elapsed = effectiveElapsedSeconds(active);
    const bounded = Math.min(parsed.data.durationSeconds, elapsed, 8 * 60 * 60);
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "PracticeSession"
      SET "questionDurations" = jsonb_set(COALESCE("questionDurations", '{}'::jsonb), ARRAY[${parsed.data.questionId}], to_jsonb(GREATEST(COALESCE(("questionDurations" ->> ${parsed.data.questionId})::integer, 0), ${bounded})::integer), true),
          "updatedAt" = NOW()
      WHERE "id" = ${id} AND "userId" = ${String(session.id)}
        AND "status" = 'IN_PROGRESS' AND "pausedAt" IS NULL
    `);
  }
  if (parsed.data.currentIndex !== undefined)
    await prisma.practiceSession.updateMany({
      where: { id, userId: String(session.id), status: "IN_PROGRESS", pausedAt: null },
      data: { currentIndex: parsed.data.currentIndex },
    });
  return NextResponse.json({ data: { saved: true } });
}

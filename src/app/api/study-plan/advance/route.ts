import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { advanceDailyStudyPlan } from "@/lib/daily-study-plan";

const input = z.object({ planId: z.string().trim().min(1).max(100) }).strict();

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.id)
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "请先登录", details: null } },
      { status: 401 },
    );
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "每日任务信息不正确", details: parsed.error.flatten() } },
      { status: 400 },
    );
  try {
    return NextResponse.json({ data: await advanceDailyStudyPlan(String(session.id), parsed.data.planId) });
  } catch (reason) {
    return NextResponse.json(
      { error: { code: "DAILY_PLAN_ADVANCE_FAILED", message: reason instanceof Error ? reason.message : "每日任务推进失败", details: null } },
      { status: 409 },
    );
  }
}

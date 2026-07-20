import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { generateWeeklyStudyPlan } from "@/lib/weekly-study-plan";

export async function GET() {
  const session = await getSession();
  if (!session?.id)
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "请先登录", details: null } }, { status: 401 });
  const plan = await prisma.weeklyStudyPlan.findFirst({ where: { userId: String(session.id) }, orderBy: { generatedAt: "desc" } });
  return NextResponse.json({ data: plan });
}

export async function POST() {
  const session = await getSession();
  if (!session?.id)
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "请先登录", details: null } }, { status: 401 });
  try {
    const plan = await generateWeeklyStudyPlan(String(session.id));
    return NextResponse.json({ data: plan }, { status: 201 });
  } catch (reason) {
    return NextResponse.json({ error: { code: "WEEKLY_PLAN_GENERATION_FAILED", message: reason instanceof Error ? reason.message : "一周规划生成失败", details: null } }, { status: 502 });
  }
}

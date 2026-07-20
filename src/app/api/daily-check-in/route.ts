import { NextResponse } from "next/server";
import {
  createTodayDailyCheckIn,
  getTodayDailyCheckIn,
} from "@/lib/daily-check-in";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json(
    { error: { code: "UNAUTHORIZED", message: "请先登录", details: null } },
    { status: 401 },
  );
}

function responseData(
  checkIn: Awaited<ReturnType<typeof getTodayDailyCheckIn>>,
) {
  if (!checkIn) return { checkedIn: false };
  return {
    checkedIn: true,
    id: checkIn.id,
    checkInDate: checkIn.checkInDate.toISOString().slice(0, 10),
    questionGoal: checkIn.questionGoal,
    taskGoal: checkIn.taskGoal,
    summary: checkIn.goalSummary,
    source: checkIn.source,
    generatedAt: checkIn.generatedAt.toISOString(),
  };
}

export async function GET() {
  const session = await getSession();
  if (!session?.id) return unauthorized();
  const checkIn = await getTodayDailyCheckIn(String(session.id));
  return NextResponse.json({ data: responseData(checkIn) });
}

export async function POST() {
  const session = await getSession();
  if (!session?.id) return unauthorized();
  const checkIn = await createTodayDailyCheckIn(String(session.id));
  return NextResponse.json({ data: responseData(checkIn) });
}

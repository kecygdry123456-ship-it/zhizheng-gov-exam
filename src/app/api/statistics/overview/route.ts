import { NextResponse } from "next/server";
import {
  chinaDateValue,
  chinaDayStart,
  chinaNextDayStart,
  chinaWeekDate,
  chinaWeekStart,
} from "@/lib/china-time";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session?.id) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "请先登录", details: null } }, { status: 401 });
  const userId = String(session.id);
  const now = new Date();
  const start = chinaDayStart(now);
  const tomorrow = chinaNextDayStart(now);
  const recentStart = new Date(start);
  recentStart.setUTCDate(recentStart.getUTCDate() - 6);
  const week = chinaWeekStart(now);
  const [total, correct, today, thisWeek, weeklyCompletedTasks, todayCompletedTasks, weeklyCheckIns, todayCheckIn, rows] = await prisma.$transaction([
    prisma.attempt.count({ where: { userId } }),
    prisma.attempt.count({ where: { userId, correct: true } }),
    prisma.attempt.count({ where: { userId, createdAt: { gte: start } } }),
    prisma.attempt.count({ where: { userId, createdAt: { gte: week } } }),
    prisma.studyPlanCheckIn.count({
      where: {
        acceptanceMethod: "PROGRAM_VERIFIED",
        completedAt: { gte: week },
        plan: { userId },
      },
    }),
    prisma.studyPlanCheckIn.count({
      where: {
        acceptanceMethod: "PROGRAM_VERIFIED",
        completedAt: { gte: start, lt: tomorrow },
        plan: { userId },
      },
    }),
    prisma.dailyCheckIn.count({
      where: { userId, checkInDate: { gte: chinaWeekDate(now) } },
    }),
    prisma.dailyCheckIn.findUnique({
      where: {
        userId_checkInDate: { userId, checkInDate: chinaDateValue(now) },
      },
      select: {
        questionGoal: true,
        taskGoal: true,
        goalSummary: true,
        source: true,
      },
    }),
    prisma.attempt.findMany({ where: { userId }, select: { correct: true, createdAt: true, question: { select: { category: { select: { name: true } } } } }, orderBy: { createdAt: "asc" } }),
  ]);
  const categoryMap = new Map<string, { total: number; correct: number }>();
  for (const row of rows) {
    const name = row.question.category.name;
    const item = categoryMap.get(name) || { total: 0, correct: 0 };
    item.total += 1;
    if (row.correct) item.correct += 1;
    categoryMap.set(name, item);
  }
  const daily = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(recentStart); day.setUTCDate(recentStart.getUTCDate() + index);
    const next = new Date(day); next.setUTCDate(day.getUTCDate() + 1);
    const items = rows.filter((item) => item.createdAt >= day && item.createdAt < next);
    return { date: chinaDateValue(day).toISOString().slice(0, 10), total: items.length, correct: items.filter((item) => item.correct).length };
  });
  return NextResponse.json({ data: { total, correct, today, thisWeek, weeklyCompletedTasks, todayCompletedTasks, weeklyCheckIns, checkedInToday: Boolean(todayCheckIn), todayQuestionGoal: todayCheckIn?.questionGoal ?? null, todayTaskGoal: todayCheckIn?.taskGoal ?? null, todayGoalSummary: todayCheckIn?.goalSummary ?? null, todayGoalSource: todayCheckIn?.source ?? null, accuracy: total ? Math.round(correct / total * 100) : 0, categories: Array.from(categoryMap, ([name, value]) => ({ name, ...value, accuracy: Math.round(value.correct / value.total * 100) })), daily } });
}

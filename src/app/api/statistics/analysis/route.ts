import { NextResponse } from "next/server";
import { generateLearningAnalysis } from "@/lib/learning-analysis";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

const DAY_MS = 86_400_000;
const timeZone = "Asia/Shanghai";

function shanghaiDayStart(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(`${values.year}-${values.month}-${values.day}T00:00:00+08:00`);
}

function shanghaiDateLabel(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shanghaiWeekStart(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localWeekday = new Date(
    `${values.year}-${values.month}-${values.day}T12:00:00+08:00`,
  ).getUTCDay();
  const start = shanghaiDayStart(date);
  start.setUTCDate(start.getUTCDate() - ((localWeekday + 6) % 7));
  return start;
}

function rounded(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function aggregateMetrics(
  attempts: Array<{
    correct: boolean;
    duration: number;
    question: {
      type: string;
      difficultyScore: number;
      category: { name: string };
    };
  }>,
  key: (attempt: (typeof attempts)[number]) => string,
) {
  const groups = new Map<
    string,
    { total: number; correct: number; duration: number; timed: number; difficulty: number }
  >();
  for (const attempt of attempts) {
    const name = key(attempt);
    const item = groups.get(name) || {
      total: 0,
      correct: 0,
      duration: 0,
      timed: 0,
      difficulty: 0,
    };
    item.total += 1;
    if (attempt.correct) item.correct += 1;
    if (attempt.duration > 0) {
      item.duration += attempt.duration;
      item.timed += 1;
    }
    item.difficulty += attempt.question.difficultyScore;
    groups.set(name, item);
  }
  return Array.from(groups, ([name, item]) => ({
    name,
    total: item.total,
    correct: item.correct,
    accuracy: rounded((item.correct / item.total) * 100),
    averageDurationSeconds: item.timed
      ? Math.round(item.duration / item.timed)
      : 0,
    averageDifficulty: rounded(item.difficulty / item.total),
  }));
}

function period(
  attempts: Array<{ correct: boolean; createdAt: Date }>,
  start: Date,
  end: Date,
) {
  const rows = attempts.filter(
    (attempt) => attempt.createdAt >= start && attempt.createdAt < end,
  );
  const correct = rows.filter((attempt) => attempt.correct).length;
  return {
    total: rows.length,
    correct,
    accuracy: rows.length ? rounded((correct / rows.length) * 100) : null,
  };
}

export async function POST() {
  const session = await getSession();
  if (!session?.id)
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "请先登录" } },
      { status: 401 },
    );
  const userId = String(session.id);
  const now = new Date();
  const todayStart = shanghaiDayStart(now);
  const sevenDaysAgo = new Date(todayStart);
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 6);
  const fourteenDaysAgo = new Date(todayStart);
  fourteenDaysAgo.setUTCDate(fourteenDaysAgo.getUTCDate() - 13);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * DAY_MS);
  const weekStart = shanghaiWeekStart(now);
  const [total, correct, attempts, recentReports, weeklyCompletedTasks] =
    await Promise.all([
      prisma.attempt.count({ where: { userId } }),
      prisma.attempt.count({ where: { userId, correct: true } }),
      prisma.attempt.findMany({
        where: { userId, createdAt: { gte: ninetyDaysAgo } },
        orderBy: { createdAt: "desc" },
        take: 2_000,
        select: {
          correct: true,
          duration: true,
          createdAt: true,
          question: {
            select: {
              type: true,
              difficultyScore: true,
              category: { select: { name: true } },
            },
          },
        },
      }),
      prisma.trainingReport.findMany({
        where: { userId },
        orderBy: { completedAt: "desc" },
        take: 8,
        select: {
          mode: true,
          title: true,
          answered: true,
          accuracy: true,
          difficultyScore: true,
          durationSeconds: true,
          completedAt: true,
        },
      }),
      prisma.studyPlanCheckIn.count({
        where: {
          acceptanceMethod: "PROGRAM_VERIFIED",
          completedAt: { gte: weekStart },
          plan: { userId },
        },
      }),
    ]);

  const daily = Array.from({ length: 14 }, (_, index) => {
    const start = new Date(fourteenDaysAgo.getTime() + index * DAY_MS);
    const end = new Date(start.getTime() + DAY_MS);
    const rows = attempts.filter(
      (attempt) => attempt.createdAt >= start && attempt.createdAt < end,
    );
    return {
      date: shanghaiDateLabel(start),
      total: rows.length,
      correct: rows.filter((attempt) => attempt.correct).length,
    };
  });
  const context = {
    total,
    correct,
    accuracy: total ? rounded((correct / total) * 100) : 0,
    today: period(attempts, todayStart, now).total,
    last7Days: period(attempts, sevenDaysAgo, now),
    previous7Days: period(attempts, fourteenDaysAgo, sevenDaysAgo),
    weeklyCompletedTasks,
    categories: aggregateMetrics(
      attempts,
      (attempt) => attempt.question.category.name,
    ),
    subtypes: aggregateMetrics(
      attempts,
      (attempt) =>
        `${attempt.question.category.name} / ${attempt.question.type}`,
    ).sort(
      (left, right) =>
        left.accuracy - right.accuracy || right.total - left.total,
    ),
    daily,
    recentReports: recentReports.map((report) => ({
      ...report,
      completedAt: report.completedAt.toISOString(),
    })),
  };
  const analysis = await generateLearningAnalysis(userId, context);
  return NextResponse.json({ data: analysis });
}

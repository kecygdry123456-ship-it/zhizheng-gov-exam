import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  chinaDateKey,
  chinaDateValue,
  chinaDayStart,
  chinaNextDayStart,
} from "@/lib/china-time";
import { getEffectiveModelConnection } from "@/lib/model-config";
import { requestModelJsonObject } from "@/lib/model-json-client";
import { consumeDailyCheckInModelRequest } from "@/lib/model-usage";
import { prisma } from "@/lib/prisma";

export type DailyGoal = {
  questionGoal: number;
  taskGoal: number;
  summary: string;
};

export type DailyGoalContext = {
  targetExam: string;
  date: string;
  weekday: string;
  todayAnswered: number;
  todayCompletedTasks: number;
  recent14Days: {
    answered: number;
    correct: number;
    accuracy: number | null;
    activeDays: number;
    averageQuestionsPerActiveDay: number;
    completedTasks: number;
    taskActiveDays: number;
    averageTasksPerActiveDay: number;
  };
  categories: {
    name: string;
    total: number;
    correct: number;
    accuracy: number;
  }[];
  recentGoals: {
    date: string;
    questionGoal: number;
    taskGoal: number;
    source: string;
  }[];
};

const modelDailyGoal = z
  .object({
    questionGoal: z.number().int().min(5).max(100),
    taskGoal: z.number().int().min(1).max(8),
    summary: z.string().trim().min(10).max(160),
  })
  .strict();

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundToFive(value: number) {
  return Math.round(value / 5) * 5;
}

export function fallbackDailyGoal(context: DailyGoalContext): DailyGoal {
  const recent = context.recent14Days;
  let questions = recent.activeDays
    ? recent.averageQuestionsPerActiveDay
    : 20;
  if (recent.accuracy !== null && recent.accuracy < 55) questions *= 0.85;
  else if (recent.accuracy !== null && recent.accuracy >= 80) questions *= 1.1;
  const questionGoal = clamp(roundToFive(questions), 10, 60);

  const taskGoal = recent.taskActiveDays
    ? clamp(Math.ceil(recent.averageTasksPerActiveDay), 1, 5)
    : 2;
  return {
    questionGoal,
    taskGoal,
    summary: `结合近14天训练节奏，今天完成${questionGoal}题并通过${taskGoal}个系统任务验收。`,
  };
}

export function normalizeDailyGoal(
  value: unknown,
  fallback: DailyGoal,
): DailyGoal {
  const parsed = modelDailyGoal.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

const dailyGoalPrompt = [
  "你是公务员考试学习目标规划师。请根据用户近14天的真实作答、正确率、活跃天数、系统验收任务和近期目标，生成今天的学习目标。",
  "questionGoal表示今天累计应完成的题目数，必须是5至100的整数；taskGoal表示今天应通过系统程序验收的任务数，必须是1至8的整数。",
  "目标要略有挑战但可在一天内完成。训练不稳定或正确率偏低时不要用夸张题量惩罚用户；已有稳定节奏时可小幅提高。已经完成的题目和任务也包含在今天的目标总数中。",
  "常识、言语和判断可以支撑较多题量；资料和数量单题耗时更长，不要仅因其薄弱而大幅增加总题量。",
  "只返回JSON对象，字段严格为questionGoal、taskGoal、summary。summary用一句简洁中文说明目标依据，不输出Markdown或其他字段。",
].join("");

async function buildDailyGoalContext(
  userId: string,
  now: Date,
): Promise<DailyGoalContext> {
  const recentStart = chinaDayStart(now);
  recentStart.setUTCDate(recentStart.getUTCDate() - 13);
  const todayStart = chinaDayStart(now);
  const tomorrowStart = chinaNextDayStart(now);
  const [user, attempts, completedTasks, recentGoals] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { targetExam: true },
    }),
    prisma.attempt.findMany({
      where: { userId, createdAt: { gte: recentStart, lt: tomorrowStart } },
      select: {
        correct: true,
        createdAt: true,
        question: { select: { category: { select: { name: true } } } },
      },
    }),
    prisma.studyPlanCheckIn.findMany({
      where: {
        acceptanceMethod: "PROGRAM_VERIFIED",
        completedAt: { gte: recentStart, lt: tomorrowStart },
        plan: { userId },
      },
      select: { completedAt: true },
    }),
    prisma.dailyCheckIn.findMany({
      where: { userId, checkInDate: { gte: chinaDateValue(recentStart) } },
      orderBy: { checkInDate: "desc" },
      take: 7,
      select: {
        checkInDate: true,
        questionGoal: true,
        taskGoal: true,
        source: true,
      },
    }),
  ]);

  const activeDays = new Set(attempts.map((attempt) => chinaDateKey(attempt.createdAt)));
  const taskActiveDays = new Set(
    completedTasks.map((task) => chinaDateKey(task.completedAt)),
  );
  const correct = attempts.filter((attempt) => attempt.correct).length;
  const categoryMap = new Map<string, { total: number; correct: number }>();
  for (const attempt of attempts) {
    const name = attempt.question.category.name;
    const current = categoryMap.get(name) || { total: 0, correct: 0 };
    current.total += 1;
    if (attempt.correct) current.correct += 1;
    categoryMap.set(name, current);
  }

  return {
    targetExam: user?.targetExam || "公务员考试",
    date: chinaDateKey(now),
    weekday: new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      weekday: "long",
    }).format(now),
    todayAnswered: attempts.filter(
      (attempt) => attempt.createdAt >= todayStart,
    ).length,
    todayCompletedTasks: completedTasks.filter(
      (task) => task.completedAt >= todayStart,
    ).length,
    recent14Days: {
      answered: attempts.length,
      correct,
      accuracy: attempts.length
        ? Math.round((correct / attempts.length) * 1_000) / 10
        : null,
      activeDays: activeDays.size,
      averageQuestionsPerActiveDay: activeDays.size
        ? Math.round((attempts.length / activeDays.size) * 10) / 10
        : 0,
      completedTasks: completedTasks.length,
      taskActiveDays: taskActiveDays.size,
      averageTasksPerActiveDay: taskActiveDays.size
        ? Math.round((completedTasks.length / taskActiveDays.size) * 10) / 10
        : 0,
    },
    categories: Array.from(categoryMap, ([name, item]) => ({
      name,
      ...item,
      accuracy: Math.round((item.correct / item.total) * 1_000) / 10,
    })).sort((left, right) => right.total - left.total),
    recentGoals: recentGoals.map((goal) => ({
      date: goal.checkInDate.toISOString().slice(0, 10),
      questionGoal: goal.questionGoal,
      taskGoal: goal.taskGoal,
      source: goal.source,
    })),
  };
}

async function generateDailyGoal(
  userId: string,
  context: DailyGoalContext,
  fallback: DailyGoal,
) {
  const connection = await getEffectiveModelConnection();
  if (!connection.apiKey || !connection.model)
    return { ...fallback, source: "DATA_RULES" as const };
  try {
    const raw = await requestModelJsonObject(
      connection,
      dailyGoalPrompt,
      context,
      { beforeRequest: () => consumeDailyCheckInModelRequest(userId) },
    );
    const goal = normalizeDailyGoal(raw, fallback);
    return modelDailyGoal.safeParse(raw).success
      ? { ...goal, source: "MODEL_API" as const }
      : { ...fallback, source: "DATA_RULES" as const };
  } catch {
    return { ...fallback, source: "DATA_RULES" as const };
  }
}

export async function getTodayDailyCheckIn(userId: string, now = new Date()) {
  return prisma.dailyCheckIn.findUnique({
    where: {
      userId_checkInDate: { userId, checkInDate: chinaDateValue(now) },
    },
  });
}

export async function createTodayDailyCheckIn(
  userId: string,
  now = new Date(),
) {
  const existing = await getTodayDailyCheckIn(userId, now);
  if (existing) return existing;

  const context = await buildDailyGoalContext(userId, now);
  const fallback = fallbackDailyGoal(context);
  let created;
  try {
    created = await prisma.dailyCheckIn.create({
      data: {
        userId,
        checkInDate: chinaDateValue(now),
        questionGoal: fallback.questionGoal,
        taskGoal: fallback.taskGoal,
        goalSummary: fallback.summary,
        source: "DATA_RULES",
      },
    });
  } catch (reason) {
    if (
      reason instanceof Prisma.PrismaClientKnownRequestError &&
      reason.code === "P2002"
    ) {
      const concurrent = await getTodayDailyCheckIn(userId, now);
      if (concurrent) return concurrent;
    }
    throw reason;
  }

  const goal = await generateDailyGoal(userId, context, fallback);
  if (
    goal.questionGoal === created.questionGoal &&
    goal.taskGoal === created.taskGoal &&
    goal.summary === created.goalSummary &&
    goal.source === created.source
  )
    return created;

  return prisma.dailyCheckIn.update({
    where: { id: created.id },
    data: {
      questionGoal: goal.questionGoal,
      taskGoal: goal.taskGoal,
      goalSummary: goal.summary,
      source: goal.source,
      generatedAt: new Date(),
    },
  });
}

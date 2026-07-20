import { prisma } from "@/lib/prisma";

const EVALUATION_PURPOSE = "TRAINING_REPORT_EVALUATION";
const LEARNING_ANALYSIS_PURPOSE = "LEARNING_ANALYSIS";
const DAILY_CHECK_IN_PURPOSE = "DAILY_CHECK_IN_GOAL";
const QUOTA_REACHED = "MODEL_EVALUATION_QUOTA_REACHED";

function configuredLimit(name: string, fallback: number, maximum: number) {
  const configured = Number(process.env[name] || fallback);
  return Number.isFinite(configured)
    ? Math.min(maximum, Math.max(1, Math.round(configured)))
    : fallback;
}

function chinaDay() {
  const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const key = shifted.toISOString().slice(0, 10);
  return { key, date: new Date(`${key}T00:00:00.000Z`) };
}

async function consumeModelRequest(
  userId: string,
  purpose: string,
  perUserLimit: number,
  globalLimit: number,
) {
  const day = chinaDay();
  const globalKey = `${day.key}:${purpose}:GLOBAL`;
  const userKey = `${day.key}:${purpose}:USER:${userId}`;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.modelUsageDaily.upsert({
        where: { key: globalKey },
        update: {},
        create: {
          key: globalKey,
          usageDate: day.date,
          scope: "GLOBAL",
          purpose,
        },
      });
      await tx.modelUsageDaily.upsert({
        where: { key: userKey },
        update: {},
        create: {
          key: userKey,
          usageDate: day.date,
          scope: "USER",
          userId,
          purpose,
        },
      });

      const globalReservation = await tx.modelUsageDaily.updateMany({
        where: { key: globalKey, requestCount: { lt: globalLimit } },
        data: { requestCount: { increment: 1 } },
      });
      if (globalReservation.count !== 1) throw new Error(QUOTA_REACHED);

      const userReservation = await tx.modelUsageDaily.updateMany({
        where: { key: userKey, requestCount: { lt: perUserLimit } },
        data: { requestCount: { increment: 1 } },
      });
      if (userReservation.count !== 1) throw new Error(QUOTA_REACHED);
    });
    return true;
  } catch (reason) {
    if (reason instanceof Error && reason.message === QUOTA_REACHED)
      return false;
    throw reason;
  }
}

/** Atomically reserves quota for one outbound model HTTP request. */
export async function consumeTrainingEvaluationModelRequest(userId: string) {
  const perUserLimit = configuredLimit(
    "MODEL_EVALUATION_DAILY_LIMIT",
    50,
    1_000,
  );
  const globalLimit = configuredLimit(
    "MODEL_EVALUATION_GLOBAL_DAILY_LIMIT",
    1_000,
    100_000,
  );
  return consumeModelRequest(
    userId,
    EVALUATION_PURPOSE,
    perUserLimit,
    globalLimit,
  );
}

export async function consumeLearningAnalysisModelRequest(userId: string) {
  return consumeModelRequest(
    userId,
    LEARNING_ANALYSIS_PURPOSE,
    configuredLimit("MODEL_LEARNING_ANALYSIS_DAILY_LIMIT", 10, 100),
    configuredLimit("MODEL_LEARNING_ANALYSIS_GLOBAL_DAILY_LIMIT", 300, 10_000),
  );
}

export async function consumeDailyCheckInModelRequest(userId: string) {
  return consumeModelRequest(
    userId,
    DAILY_CHECK_IN_PURPOSE,
    configuredLimit("MODEL_DAILY_CHECK_IN_DAILY_LIMIT", 5, 50),
    configuredLimit("MODEL_DAILY_CHECK_IN_GLOBAL_DAILY_LIMIT", 500, 20_000),
  );
}

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateStudyPlan, type PlanPreferences } from "@/lib/study-plan";
import { taskKeyFor } from "@/lib/study-plan-task";

type TaskRecord = {
  id?: string;
  type?: string;
};

function taskList(value: Prisma.JsonValue): TaskRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is TaskRecord =>
          Boolean(item && typeof item === "object" && !Array.isArray(item)),
      )
    : [];
}

function preferencesFromSnapshot(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const preferences = (value as Record<string, unknown>).preferences;
  return preferences && typeof preferences === "object" && !Array.isArray(preferences)
    ? (preferences as PlanPreferences)
    : {};
}

export type AdvanceDailyPlanResult = {
  planId: string;
  completed: boolean;
  completedPlanCount: number;
  nextPlanId: string | null;
};

export async function advanceDailyStudyPlan(userId: string, planId: string) {
  const plan = await prisma.studyPlan.findFirst({
    where: { id: planId, userId, schemaVersion: { gte: 5 } },
    include: { checkIns: true },
  });
  if (!plan) throw new Error("未找到当前每日任务");

  const tasks = taskList(plan.tasks);
  const checkIns = new Set(
    plan.checkIns.map((checkIn) => `${checkIn.taskIndex}:${checkIn.taskKey}`),
  );
  const checkable = tasks
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => String(task.type || "").toUpperCase() !== "REST");
  const complete = checkable.every(({ task, index }) =>
    checkIns.has(`${index}:${taskKeyFor(task, index)}`),
  );
  if (!complete) {
    const completedPlanCount = await prisma.studyPlan.count({
      where: { userId, schemaVersion: { gte: 5 }, completedAt: { not: null } },
    });
    return {
      planId: plan.id,
      completed: false,
      completedPlanCount,
      nextPlanId: null,
    } satisfies AdvanceDailyPlanResult;
  }

  await prisma.studyPlan.updateMany({
    where: { id: plan.id, userId, completedAt: null },
    data: { completedAt: new Date() },
  });

  let next = await prisma.studyPlan.findFirst({
    where: { userId, previousPlanId: plan.id },
    orderBy: { generatedAt: "asc" },
  });
  if (!next) {
    const candidate = await generateStudyPlan(
      userId,
      preferencesFromSnapshot(plan.inputSnapshot),
    );
    try {
      next = await prisma.studyPlan.update({
        where: { id: candidate.id },
        data: { previousPlanId: plan.id },
      });
    } catch (reason) {
      if (
        !(reason instanceof Prisma.PrismaClientKnownRequestError) ||
        reason.code !== "P2002"
      )
        throw reason;
      await prisma.studyPlan.delete({ where: { id: candidate.id } }).catch(() => undefined);
      next = await prisma.studyPlan.findFirst({
        where: { userId, previousPlanId: plan.id },
        orderBy: { generatedAt: "asc" },
      });
    }
  }

  const completedPlanCount = await prisma.studyPlan.count({
    where: { userId, schemaVersion: { gte: 5 }, completedAt: { not: null } },
  });
  return {
    planId: plan.id,
    completed: true,
    completedPlanCount,
    nextPlanId: next?.id || null,
  } satisfies AdvanceDailyPlanResult;
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { generateStudyPlan } from "@/lib/study-plan";
import {
  completionSpecHash,
  parseCompletionSpec,
} from "@/lib/study-plan-completion";
import { taskKeyFor } from "@/lib/study-plan-task";
import {
  acceptanceMethodPreferenceValues,
  activeWeekdayValues,
  essayPreferenceValues,
  examWindowValues,
  focusAreaValues,
  intensityValues,
  learningGoalValues,
  learningMethodValues,
  mockExamPreferenceValues,
  studyConstraintValues,
  studyStatusValues,
  studyWindowValues,
} from "@/lib/study-plan-preferences";
import { z } from "zod";

function uniqueEnumArray<const T extends readonly [string, ...string[]]>(
  values: T,
  minimum: number,
  maximum: number,
) {
  return z
    .array(z.enum(values))
    .min(minimum)
    .max(maximum)
    .superRefine((items, context) => {
      if (new Set(items).size !== items.length) {
        context.addIssue({ code: "custom", message: "选项不能重复" });
      }
    });
}

const focusAreasInput = uniqueEnumArray(focusAreaValues, 0, 3).superRefine(
  (items, context) => {
    if (items.includes("AUTO") && items.length > 1) {
      context.addIssue({
        code: "custom",
        message: "自动推荐不能与指定重点同时选择",
      });
    }
  },
);

const examDateInput = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "考试日期必须使用 YYYY-MM-DD 格式")
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00+08:00`).getTime()), {
    message: "考试日期无效",
  });

const planInput = z
  .object({
    targetExam: z.string().trim().max(80).optional(),
    examDate: examDateInput.optional(),
    dailyMinutes: z.number().int().min(20).max(240).optional(),
    weeklyDays: z.number().int().min(1).max(7).optional(),
    currentLevel: z.string().trim().max(200).optional(),
    focus: z.string().trim().max(100).optional(),
    notes: z.string().trim().max(1_000).optional(),
    examWindow: z.enum(examWindowValues).optional(),
    focusAreas: focusAreasInput.optional(),
    studyStatus: z.enum(studyStatusValues).optional(),
    activeWeekdays: uniqueEnumArray(activeWeekdayValues, 0, 7).optional(),
    studyWindows: uniqueEnumArray(studyWindowValues, 0, 6).optional(),
    learningGoal: z.enum(learningGoalValues).optional(),
    learningMethods: uniqueEnumArray(learningMethodValues, 0, 4).optional(),
    intensity: z.enum(intensityValues).optional(),
    mockExamPreference: z.enum(mockExamPreferenceValues).optional(),
    essayPreference: z.enum(essayPreferenceValues).optional(),
    minTasksPerDay: z.number().int().min(1).max(21).optional(),
    maxTasksPerDay: z.number().int().min(1).max(21).nullable().optional(),
    maxTaskMinutes: z.number().int().min(10).max(180).optional(),
    maxQuestionsPerTask: z.number().int().min(5).max(100).optional(),
    acceptanceMethods: uniqueEnumArray(
      acceptanceMethodPreferenceValues,
      1,
      2,
    ).optional(),
    constraints: uniqueEnumArray(studyConstraintValues, 0, 4).optional(),
  })
  .superRefine((value, context) => {
    if (value.examWindow === "FIXED_DATE" && !value.examDate) {
      context.addIssue({
        code: "custom",
        path: ["examDate"],
        message: "选择已确定日期后必须提供考试日期",
      });
    }
    if (
      value.minTasksPerDay !== undefined &&
      value.maxTasksPerDay !== undefined &&
      value.maxTasksPerDay !== null &&
      value.minTasksPerDay > value.maxTasksPerDay
    ) {
      context.addIssue({
        code: "custom",
        path: ["minTasksPerDay"],
        message: "每日最少任务不能大于每日最多任务",
      });
    }
  });

function serializePlan<
  T extends {
    tasks: unknown;
    schemaVersion: number;
    checkIns: {
      taskKey: string;
      taskIndex: number;
      taskTitle: string;
      targetSnapshot: string;
      checkpointSnapshot: string;
      acceptanceMethod: string;
      specHash: string | null;
    }[];
  },
>(plan: T | null) {
  if (!plan || !Array.isArray(plan.tasks)) return plan;
  const tasks = plan.tasks.map((value, index) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? { ...value, id: taskKeyFor(value, index) }
      : value,
  );
  const checkIns = plan.checkIns.filter((checkIn) => {
    const value = tasks[checkIn.taskIndex];
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const task = value as Record<string, unknown>;
    const target =
      typeof task.target === "string" && task.target.trim()
        ? task.target.trim()
        : String(task.title || "").trim();
    const checkpoint =
      typeof task.checkpoint === "string" && task.checkpoint.trim()
        ? task.checkpoint.trim()
        : target;
    const completionSpec =
      plan.schemaVersion >= 4 ? parseCompletionSpec(task) : null;
    const acceptanceMatches =
      plan.schemaVersion <= 3
        ? true
        : completionSpec?.method === "PROGRAM"
          ? checkIn.acceptanceMethod === "PROGRAM_VERIFIED" &&
            checkIn.specHash === completionSpecHash(completionSpec)
          : completionSpec?.method === "SELF"
            ? checkIn.acceptanceMethod === "SELF_CONFIRMED"
            : false;
    return (
      acceptanceMatches &&
      checkIn.taskKey === taskKeyFor(value, checkIn.taskIndex) &&
      checkIn.taskTitle === String(task.title || "").trim() &&
      checkIn.targetSnapshot === target &&
      checkIn.checkpointSnapshot === checkpoint
    );
  });
  return { ...plan, tasks, checkIns };
}

export async function GET() {
  const session = await getSession();
  if (!session?.id) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "请先登录", details: null } }, { status: 401 });
  const [plan, completedPlanCount] = await Promise.all([
    prisma.studyPlan.findFirst({
    where: { userId: String(session.id), schemaVersion: { gte: 5 } },
    orderBy: { generatedAt: "desc" },
    include: { checkIns: { orderBy: { taskIndex: "asc" } } },
    }),
    prisma.studyPlan.count({
      where: { userId: String(session.id), schemaVersion: { gte: 5 }, completedAt: { not: null } },
    }),
  ]);
  const serialized = serializePlan(plan);
  return NextResponse.json({
    data: serialized ? { ...serialized, completedPlanCount } : null,
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.id) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "请先登录", details: null } }, { status: 401 });
  const parsed = planInput.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "规划信息不正确", details: parsed.error.flatten() } }, { status: 400 });
  try { const plan = await generateStudyPlan(String(session.id), parsed.data); return NextResponse.json({ data: plan }, { status: 201 }); }
  catch (reason) { return NextResponse.json({ error: { code: "MODEL_REQUEST_FAILED", message: reason instanceof Error ? reason.message : "模型服务调用失败", details: null } }, { status: 502 }); }
}

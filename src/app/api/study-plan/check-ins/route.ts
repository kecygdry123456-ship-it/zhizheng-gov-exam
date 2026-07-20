import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import {
  getOwnedStudyPlanTask,
  planContextSchema,
} from "@/lib/study-plan-task";

const taskIdentity = planContextSchema;

const completeInput = taskIdentity
  .extend({
    confirmations: z
      .object({
        taskCompleted: z.boolean(),
        checkpointMet: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.confirmations.taskCompleted) {
      context.addIssue({
        code: "custom",
        path: ["confirmations", "taskCompleted"],
        message: "请先确认任务内容已经完成",
      });
    }
    if (!value.confirmations.checkpointMet) {
      context.addIssue({
        code: "custom",
        path: ["confirmations", "checkpointMet"],
        message: "请先确认已经达到完成标准",
      });
    }
  });

function errorResponse(
  status: number,
  code: string,
  message: string,
  details: unknown = null,
) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status },
  );
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.id)
    return errorResponse(401, "UNAUTHORIZED", "请先登录");

  const parsed = completeInput.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return errorResponse(
      400,
      "ACCEPTANCE_REQUIRED",
      "完成两项验收确认后才能打卡",
      parsed.error.flatten(),
    );

  const { planId, taskIndex, taskKey } = parsed.data;
  const snapshot = await getOwnedStudyPlanTask(String(session.id), {
    planId,
    taskIndex,
    taskKey,
  });
  if (!snapshot || snapshot.taskKey !== taskKey)
    return errorResponse(404, "TASK_NOT_FOUND", "未找到可验收的规划任务");
  if (snapshot.taskType === "REST")
    return errorResponse(409, "TASK_NOT_CHECKABLE", "休整任务无需验收打卡");
  if (snapshot.schemaVersion >= 4 && !snapshot.completionSpec)
    return errorResponse(
      409,
      "TASK_SPEC_INVALID",
      "该任务的验收规则无效，请重新生成学习计划",
    );
  if (snapshot.completionSpec?.method === "NONE")
    return errorResponse(409, "TASK_NOT_CHECKABLE", "该任务无需验收打卡");
  if (snapshot.completionSpec?.method === "PROGRAM")
    return errorResponse(
      409,
      "PROGRAM_ACCEPTANCE_REQUIRED",
      "该任务必须使用训练结果进行系统验收",
    );

  const createData = {
    planId,
    taskKey,
    taskIndex,
    taskTitle: snapshot.taskTitle,
    targetSnapshot: snapshot.targetSnapshot,
    checkpointSnapshot: snapshot.checkpointSnapshot,
    acceptanceMethod: "SELF_CONFIRMED",
  } as const;
  const matchesSnapshot = (value: {
    taskKey: string;
    taskIndex: number;
    taskTitle: string;
    targetSnapshot: string;
    checkpointSnapshot: string;
    acceptanceMethod: string;
  }) =>
    value.taskKey === taskKey &&
    value.taskIndex === taskIndex &&
    value.taskTitle === snapshot.taskTitle &&
    value.targetSnapshot === snapshot.targetSnapshot &&
    value.checkpointSnapshot === snapshot.checkpointSnapshot &&
    value.acceptanceMethod === "SELF_CONFIRMED";

  const existing = await prisma.studyPlanCheckIn.findMany({
    where: { planId, OR: [{ taskKey }, { taskIndex }] },
  });
  const unchanged = existing.find(matchesSnapshot);
  if (unchanged) return NextResponse.json({ data: unchanged });

  let checkIn;
  try {
    checkIn = existing.length
      ? await prisma.$transaction(
          async (tx) => {
            await tx.studyPlanCheckIn.deleteMany({
              where: { planId, OR: [{ taskKey }, { taskIndex }] },
            });
            return tx.studyPlanCheckIn.create({ data: createData });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        )
      : await prisma.studyPlanCheckIn.upsert({
          where: { planId_taskKey: { planId, taskKey } },
          update: {},
          create: createData,
        });
  } catch (reason) {
    if (
      reason instanceof Prisma.PrismaClientKnownRequestError &&
      ["P2002", "P2034"].includes(reason.code)
    ) {
      const raced = await prisma.studyPlanCheckIn.findUnique({
        where: { planId_taskKey: { planId, taskKey } },
      });
      if (raced && matchesSnapshot(raced))
        return NextResponse.json({ data: raced });
      return errorResponse(
        409,
        "CHECK_IN_CONFLICT",
        "任务状态刚刚发生变化，请重试验收",
      );
    }
    throw reason;
  }
  return NextResponse.json({ data: checkIn });
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session?.id)
    return errorResponse(401, "UNAUTHORIZED", "请先登录");

  const parsed = taskIdentity.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return errorResponse(
      400,
      "INVALID_INPUT",
      "打卡信息不正确",
      parsed.error.flatten(),
    );

  const { planId, taskIndex, taskKey } = parsed.data;
  const task = await getOwnedStudyPlanTask(String(session.id), {
    planId,
    taskIndex,
    taskKey,
  });
  if (!task || task.taskKey !== taskKey)
    return errorResponse(404, "TASK_NOT_FOUND", "未找到可撤销的规划任务");

  const existing = await prisma.studyPlanCheckIn.findFirst({
    where: { planId, taskKey, taskIndex },
    select: { acceptanceMethod: true },
  });
  if (existing?.acceptanceMethod === "PROGRAM_VERIFIED")
    return errorResponse(
      409,
      "PROGRAM_CHECK_IN_IMMUTABLE",
      "系统验收记录不能手动撤销",
    );

  await prisma.studyPlanCheckIn.deleteMany({
    where: { planId, taskKey, taskIndex },
  });
  return NextResponse.json({
    data: { planId, taskIndex, completed: false },
  });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import {
  currentProgramCheckIn,
  evaluateProgramEvidence,
  findLatestProgramEvidence,
  persistProgramCheckIn,
} from "@/lib/study-plan-acceptance";
import {
  planContextSchema,
  requireProgramStudyPlanTask,
  StudyPlanTaskError,
} from "@/lib/study-plan-task";

const verifyInput = planContextSchema
  .extend({ evidenceId: z.string().trim().min(1).max(100) })
  .strict();

const candidateQuery = z
  .object({
    planId: z.string().trim().min(1).max(100),
    taskKey: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9._:@-]+$/),
    taskIndex: z.coerce.number().int().min(0).max(100),
  })
  .strict();

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

function taskError(reason: unknown) {
  return reason instanceof StudyPlanTaskError
    ? errorResponse(reason.status, reason.code, reason.message, reason.details)
    : null;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.id)
    return errorResponse(401, "UNAUTHORIZED", "请先登录");
  const url = new URL(request.url);
  const parsed = candidateQuery.safeParse({
    planId: url.searchParams.get("planId"),
    taskKey: url.searchParams.get("taskKey"),
    taskIndex: url.searchParams.get("taskIndex"),
  });
  if (!parsed.success)
    return errorResponse(
      400,
      "INVALID_INPUT",
      "验收任务信息不正确",
      parsed.error.flatten(),
    );
  try {
    const task = await requireProgramStudyPlanTask(
      String(session.id),
      parsed.data,
      undefined,
      { requireActive: false },
    );
    const checkIn = await currentProgramCheckIn(task);
    if (checkIn)
      return NextResponse.json({ data: { evidence: null, checkIn } });
    const evaluation = await findLatestProgramEvidence(
      task,
      String(session.id),
    );
    return NextResponse.json({
      data: {
        evidence: evaluation
          ? {
              id: evaluation.evidenceId,
              type: evaluation.evidenceType,
              completedAt: evaluation.completedAt,
              meetsCriteria: evaluation.gaps.length === 0,
              summary: evaluation.actual,
              gaps: evaluation.gaps,
            }
          : null,
        checkIn: null,
      },
    });
  } catch (reason) {
    const response = taskError(reason);
    if (response) return response;
    throw reason;
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.id)
    return errorResponse(401, "UNAUTHORIZED", "请先登录");
  const parsed = verifyInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return errorResponse(
      400,
      "INVALID_INPUT",
      "验收证据信息不正确",
      parsed.error.flatten(),
    );
  const { evidenceId, ...context } = parsed.data;
  try {
    const task = await requireProgramStudyPlanTask(
      String(session.id),
      context,
      undefined,
      { requireActive: false },
    );
    const current = await currentProgramCheckIn(task);
    if (current) {
      if (current.evidenceId === evidenceId)
        return NextResponse.json({ data: current });
      return errorResponse(
        409,
        "TASK_ALREADY_VERIFIED",
        "该任务已经通过系统验收",
        { evidenceId: current.evidenceId },
      );
    }
    const evaluation = await evaluateProgramEvidence(
      task,
      String(session.id),
      evidenceId,
    );
    if (evaluation.gaps.length)
      return errorResponse(
        422,
        "ACCEPTANCE_NOT_MET",
        "本次训练尚未达到完成标准",
        {
          evidenceId,
          criteria: evaluation.criteria,
          actual: evaluation.actual,
          gaps: evaluation.gaps,
        },
      );
    const checkIn = await persistProgramCheckIn(task, evaluation);
    return NextResponse.json({ data: checkIn });
  } catch (reason) {
    const response = taskError(reason);
    if (response) return response;
    throw reason;
  }
}

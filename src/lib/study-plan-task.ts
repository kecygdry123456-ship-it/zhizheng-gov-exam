import type { CompletionSpec } from "@/lib/study-plan-completion";
import {
  completionSpecHash,
  parseCompletionSpec,
} from "@/lib/study-plan-completion";
import { prisma } from "@/lib/prisma";
import {
  GENERAL_KNOWLEDGE_QUESTION_TYPES,
  POLITICS_QUESTION_TYPES,
} from "@/lib/exam-templates";
import { z } from "zod";
import {
  normalizeQuestionScopes,
  questionMatchesScopes,
  questionScopesLabel,
  sameQuestionScopes,
  type QuestionScope,
} from "@/lib/question-scope";

export const planContextSchema = z
  .object({
    planId: z.string().trim().min(1).max(100),
    taskKey: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9._:@-]+$/),
    taskIndex: z.number().int().min(0).max(100),
  })
  .strict();

export type PlanContext = z.infer<typeof planContextSchema>;

export type OwnedStudyPlanTask = {
  planId: string;
  schemaVersion: number;
  generatedAt: Date;
  expiresAt: Date;
  taskIndex: number;
  taskKey: string;
  taskType: string;
  taskTitle: string;
  targetSnapshot: string;
  checkpointSnapshot: string;
  task: Record<string, unknown>;
  completionSpec: CompletionSpec | null;
  specHash: string | null;
};

export class StudyPlanTaskError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = "StudyPlanTaskError";
  }
}

function text(task: Record<string, unknown>, key: string, fallback = "") {
  const value = task[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function taskKeyFor(value: unknown, taskIndex: number) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const candidate = (value as Record<string, unknown>).id;
    if (
      typeof candidate === "string" &&
      /^[A-Za-z0-9._:@-]{1,100}$/.test(candidate)
    )
      return candidate;
  }
  return `legacy-${String(taskIndex + 1).padStart(2, "0")}`;
}

export async function getOwnedStudyPlanTask(
  userId: string,
  context: PlanContext,
): Promise<OwnedStudyPlanTask | null> {
  const plan = await prisma.studyPlan.findFirst({
    where: { id: context.planId, userId },
    select: {
      id: true,
      tasks: true,
      schemaVersion: true,
      generatedAt: true,
      expiresAt: true,
    },
  });
  if (!plan || !Array.isArray(plan.tasks)) return null;
  const value = plan.tasks[context.taskIndex];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const task = value as Record<string, unknown>;
  const taskKey = taskKeyFor(task, context.taskIndex);
  if (taskKey !== context.taskKey) return null;
  const title = text(task, "title", `第 ${context.taskIndex + 1} 项任务`);
  const target = text(task, "target", title);
  const completionSpec =
    plan.schemaVersion >= 4 ? parseCompletionSpec(task) : null;
  return {
    planId: plan.id,
    schemaVersion: plan.schemaVersion,
    generatedAt: plan.generatedAt,
    expiresAt: plan.expiresAt,
    taskIndex: context.taskIndex,
    taskKey,
    taskType: text(task, "type", "PRACTICE").toUpperCase(),
    taskTitle: title.slice(0, 500),
    targetSnapshot: target.slice(0, 2_000),
    checkpointSnapshot: text(task, "checkpoint", target).slice(0, 2_000),
    task,
    completionSpec,
    specHash: completionSpec ? completionSpecHash(completionSpec) : null,
  };
}

export async function requireOwnedStudyPlanTask(
  userId: string,
  context: PlanContext,
) {
  const task = await getOwnedStudyPlanTask(userId, context);
  if (!task)
    throw new StudyPlanTaskError(
      404,
      "TASK_NOT_FOUND",
      "未找到可验收的规划任务",
    );
  return task;
}

export type ProgramEvidenceKind = "PRACTICE" | "EXAM" | "ESSAY";
export type ProgramCompletionSpec = Extract<
  CompletionSpec,
  { method: "PROGRAM" }
>;
export type ProgramStudyPlanTask = Omit<
  OwnedStudyPlanTask,
  "completionSpec" | "specHash"
> & {
  completionSpec: ProgramCompletionSpec;
  specHash: string;
};

export type TaskQuestion = {
  id: string;
  type: string;
  stem: string;
  difficultyScore: number;
  materialId: string | null;
  category: { name: string };
};

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function questionMatchesModule(question: TaskQuestion, module: string) {
  const normalized = module.trim();
  if (!normalized || ["行测", "行测综合", "综合", "全科"].includes(normalized))
    return true;
  if (normalized === "政治理论")
    return (POLITICS_QUESTION_TYPES as readonly string[]).includes(question.type);
  const aliases: Record<string, string[]> = {
    言语理解: ["言语理解", "言语理解与表达"],
    言语理解与表达: ["言语理解", "言语理解与表达"],
    判断: ["判断推理"],
    数量: ["数量关系"],
    常识: ["常识判断"],
    资料: ["资料分析"],
  };
  const expected = aliases[normalized] || [normalized];
  return expected.some(
    (name) =>
      question.category.name === name || question.category.name.startsWith(name),
  );
}

export function questionMatchesPool(question: TaskQuestion, pool: unknown) {
  if (pool === "POLITICS")
    return (POLITICS_QUESTION_TYPES as readonly string[]).includes(question.type);
  if (pool === "GENERAL_KNOWLEDGE") {
    const politicalTerms = [
      "习近平",
      "马克思",
      "毛泽东",
      "中国特色社会主义",
      "中国共产党",
      "党中央",
      "党的二十大",
      "二十届",
      "全会",
    ];
    return (
      (GENERAL_KNOWLEDGE_QUESTION_TYPES as readonly string[]).includes(
        question.type,
      ) && !politicalTerms.some((term) => question.stem.includes(term))
    );
  }
  return true;
}

export function programSpecRecord(task: OwnedStudyPlanTask) {
  return objectValue(task.completionSpec);
}

export function programSpecLaunch(task: OwnedStudyPlanTask) {
  return objectValue(programSpecRecord(task).launch);
}

export function validatePracticeTaskQuestions(
  task: OwnedStudyPlanTask,
  questions: TaskQuestion[],
) {
  const spec = programSpecRecord(task);
  const launch = programSpecLaunch(task);
  const gaps: string[] = [];
  const minAnswered = numberOrNull(spec.minAnswered);
  if (minAnswered !== null && questions.length < minAnswered)
    gaps.push(`题量至少需要 ${minAnswered} 题`);
  const launchQuestionCount = numberOrNull(launch.questionCount);
  if (
    launchQuestionCount !== null &&
    questions.length !== launchQuestionCount
  )
    gaps.push(`训练题量必须为 ${launchQuestionCount} 题`);
  if (
    typeof launch.category === "string" &&
    questions.some(
      (question) => question.category.name !== launch.category,
    )
  )
    gaps.push(`题目必须全部属于${launch.category}`);
  const launchScopes = normalizeQuestionScopes(launch.scopes);
  if (
    launchScopes.length &&
    questions.some((question) => !questionMatchesScopes(question, launchScopes))
  )
    gaps.push(`题目必须全部属于${questionScopesLabel(launchScopes)}`);
  const requiredModule =
    typeof spec.requiredModule === "string" ? spec.requiredModule : null;
  if (
    requiredModule &&
    questions.some((question) => !questionMatchesModule(question, requiredModule))
  )
    gaps.push(`题目必须全部属于${requiredModule}`);
  if (
    launch.questionPool &&
    questions.some(
      (question) => !questionMatchesPool(question, launch.questionPool),
    )
  )
    gaps.push("题目与计划指定的题型池不匹配");
  const range = objectValue(spec.difficultyRange);
  const minimum = numberOrNull(range.min);
  const maximum = numberOrNull(range.max);
  if (
    (minimum !== null &&
      questions.some((question) => question.difficultyScore < minimum)) ||
    (maximum !== null &&
      questions.some((question) => question.difficultyScore > maximum))
  )
    gaps.push("题目难度超出计划范围");
  const requiredGroups = numberOrNull(spec.minCompleteMaterialGroups) || 0;
  if (requiredGroups > 0) {
    const counts = new Map<string, number>();
    for (const question of questions) {
      if (!question.materialId) continue;
      counts.set(question.materialId, (counts.get(question.materialId) || 0) + 1);
    }
    const completeGroups = Array.from(counts.values()).filter(
      (count) => count === 5,
    ).length;
    if (completeGroups < requiredGroups)
      gaps.push(`至少需要 ${requiredGroups} 组完整资料分析材料`);
  }
  if (gaps.length)
    throw new StudyPlanTaskError(
      409,
      "PLAN_CONTEXT_MISMATCH",
      "训练设置与规划任务要求不匹配",
      { gaps },
    );
}

export function validatePracticeTaskConfig(
  task: OwnedStudyPlanTask,
  config: {
    count: number;
    category?: string;
    scopes?: QuestionScope[];
    questionPool?: string;
    minDifficulty: number;
    maxDifficulty: number;
  },
) {
  const launch = programSpecLaunch(task);
  const gaps: string[] = [];
  const questionCount = numberOrNull(launch.questionCount);
  if (questionCount !== null && config.count !== questionCount)
    gaps.push(`训练题量必须为 ${questionCount} 题`);
  if (
    typeof launch.category === "string" &&
    config.category !== launch.category
  )
    gaps.push(`训练板块必须为${launch.category}`);
  const launchScopes = normalizeQuestionScopes(launch.scopes);
  if (launchScopes.length && !sameQuestionScopes(config.scopes, launchScopes))
    gaps.push(`训练细分板块必须为${questionScopesLabel(launchScopes)}`);
  if (
    typeof launch.questionPool === "string" &&
    config.questionPool !== launch.questionPool
  )
    gaps.push("训练题型池与规划任务不匹配");
  const minimum = numberOrNull(launch.minDifficulty);
  const maximum = numberOrNull(launch.maxDifficulty);
  if (
    (minimum !== null && config.minDifficulty !== minimum) ||
    (maximum !== null && config.maxDifficulty !== maximum)
  )
    gaps.push("训练难度设置与规划任务不匹配");
  if (gaps.length)
    throw new StudyPlanTaskError(
      409,
      "PLAN_CONTEXT_MISMATCH",
      "训练设置与规划任务要求不匹配",
      { gaps },
    );
}

export function validateExamTaskConfig(
  task: OwnedStudyPlanTask,
  input: {
    questionCount: number;
    durationMinutes: number;
    templateId?: string;
  },
) {
  const spec = programSpecRecord(task);
  const launch = programSpecLaunch(task);
  const gaps: string[] = [];
  const minAnswered = numberOrNull(spec.minAnswered);
  if (minAnswered !== null && input.questionCount < minAnswered)
    gaps.push(`题量至少需要 ${minAnswered} 题`);
  if (
    typeof spec.requiredTemplateId === "string" &&
    input.templateId !== spec.requiredTemplateId
  )
    gaps.push("模拟卷型与规划任务不匹配");
  const launchDuration = numberOrNull(launch.durationMinutes);
  if (launchDuration !== null && input.durationMinutes !== launchDuration)
    gaps.push(`模拟时长必须为 ${launchDuration} 分钟`);
  if (gaps.length)
    throw new StudyPlanTaskError(
      409,
      "PLAN_CONTEXT_MISMATCH",
      "模拟考试设置与规划任务要求不匹配",
      { gaps },
    );
}

export function validateEssayTaskQuestion(
  task: OwnedStudyPlanTask,
  question: { id: string; type: string },
) {
  const launch = programSpecLaunch(task);
  const requiredQuestionId =
    typeof launch.questionId === "string" ? launch.questionId : null;
  const requiredType =
    typeof launch.essayType === "string" ? launch.essayType : null;
  if (
    (requiredQuestionId && question.id !== requiredQuestionId) ||
    (requiredType && question.type !== requiredType)
  )
    throw new StudyPlanTaskError(
      409,
      "PLAN_CONTEXT_MISMATCH",
      "申论题目与规划任务要求不匹配",
    );
}

export async function requireProgramStudyPlanTask(
  userId: string,
  context: PlanContext,
  expectedKind?: ProgramEvidenceKind,
  options: { requireActive?: boolean } = {},
) {
  const task = await requireOwnedStudyPlanTask(userId, context);
  const now = Date.now();
  if (
    options.requireActive !== false &&
    (task.generatedAt.getTime() > now || task.expiresAt.getTime() < now)
  )
    throw new StudyPlanTaskError(
      409,
      "PLAN_NOT_ACTIVE",
      "该学习计划当前不在有效期内",
    );
  if (task.taskType === "REST" || task.completionSpec?.method === "NONE")
    throw new StudyPlanTaskError(
      409,
      "TASK_NOT_CHECKABLE",
      "休整任务无需验收打卡",
    );
  if (!task.completionSpec || task.completionSpec.method !== "PROGRAM")
    throw new StudyPlanTaskError(
      409,
      "TASK_NOT_PROGRAM_VERIFIABLE",
      "该任务使用自我验收，不接受程序证据",
    );
  const expectedTaskTypes: Record<ProgramEvidenceKind, string[]> = {
    PRACTICE: ["ASSESSMENT", "PRACTICE", "TIMED_PRACTICE"],
    EXAM: ["EXAM"],
    ESSAY: ["ESSAY"],
  };
  if (!expectedTaskTypes[task.completionSpec.kind].includes(task.taskType))
    throw new StudyPlanTaskError(
      409,
      "TASK_SPEC_INVALID",
      "任务类型与程序验收规则不匹配，请重新生成学习计划",
    );
  const launch = programSpecLaunch(task);
  const durationMinutes = numberOrNull(launch.durationMinutes);
  if (
    options.requireActive !== false &&
    durationMinutes !== null &&
    now + durationMinutes * 60_000 > task.expiresAt.getTime()
  )
    throw new StudyPlanTaskError(
      409,
      "PLAN_TIME_INSUFFICIENT",
      "计划剩余有效时间不足以完成该限时任务",
    );
  if (expectedKind && task.completionSpec.kind !== expectedKind)
    throw new StudyPlanTaskError(
      409,
      "TASK_EVIDENCE_MISMATCH",
      "当前证据类型与规划任务不匹配",
    );
  return task as ProgramStudyPlanTask;
}

export function studyPlanTaskErrorResponse(reason: unknown) {
  if (!(reason instanceof StudyPlanTaskError)) return null;
  return Response.json(
    {
      error: {
        code: reason.code,
        message: reason.message,
        details: reason.details,
      },
    },
    { status: reason.status },
  );
}

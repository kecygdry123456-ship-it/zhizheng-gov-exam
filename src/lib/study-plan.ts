import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { EXAM_TEMPLATES } from "@/lib/exam-templates";
import {
  getEffectiveModelConnection,
  type ModelConnection,
} from "@/lib/model-config";
import { requestModelJsonObject } from "@/lib/model-json-client";
import {
  applyCompletionSpecs,
  checkpointForCompletionSpec,
  deriveCompletionSpec,
  MODULE_ACCURACY_BASELINES,
  type CompletionModule,
  type CompletionSpec,
} from "@/lib/study-plan-completion";
import {
  buildSubtypeTimingBenchmarks,
  estimateTaskMinutes,
  type SubtypeTimingBenchmark,
} from "@/lib/study-plan-timing";
import {
  acceptanceMethodPreferenceLabels,
  activeWeekdayLabels,
  essayPreferenceLabels,
  examWindowLabels,
  focusAreaLabels,
  intensityLabels,
  learningGoalLabels,
  learningMethodLabels,
  mockExamPreferenceLabels,
  studyConstraintLabels,
  studyStatusLabels,
  studyWindowLabels,
  type AcceptanceMethodPreference,
  type ActiveWeekday,
  type EssayPreference,
  type ExamWindow,
  type FocusArea,
  type LearningGoal,
  type LearningMethod,
  type MockExamPreference,
  type StudyConstraint,
  type StudyIntensity,
  type StudyStatus,
  type StudyWindow,
} from "@/lib/study-plan-preferences";

const planTaskTypes = [
  "ASSESSMENT",
  "KNOWLEDGE",
  "PRACTICE",
  "TIMED_PRACTICE",
  "WRONG",
  "EXAM",
  "ESSAY",
  "REVIEW",
  "REST",
] as const;

export type PlanTaskType = (typeof planTaskTypes)[number];
export type PlanPriority = "HIGH" | "MEDIUM" | "LOW";

export type PlanTask = {
  day: number;
  title: string;
  type: PlanTaskType;
  target: string;
  minutes: number;
  reason: string;
  priority: PlanPriority;
  checkpoint: string;
  module?: string | null;
  difficulty?: string | null;
  questionCount?: number | null;
  completionSpec?: CompletionSpec;
};

export type PlanStrategy = {
  phase: string;
  objective: string;
  priorities: {
    area: string;
    reason: string;
    allocationPercent?: number | null;
  }[];
  rhythm: string;
  adjustmentRules: string[];
};

export type PlanPreferences = {
  targetExam?: string;
  examDate?: string;
  dailyMinutes?: number;
  weeklyDays?: number;
  currentLevel?: string;
  focus?: string;
  notes?: string;
  examWindow?: ExamWindow;
  focusAreas?: FocusArea[];
  studyStatus?: StudyStatus;
  activeWeekdays?: ActiveWeekday[];
  studyWindows?: StudyWindow[];
  learningGoal?: LearningGoal;
  learningMethods?: LearningMethod[];
  intensity?: StudyIntensity;
  mockExamPreference?: MockExamPreference;
  essayPreference?: EssayPreference;
  minTasksPerDay?: number;
  maxTasksPerDay?: number | null;
  /** 兼容旧客户端，生成逻辑不再使用单任务时间上限。 */
  maxTaskMinutes?: number;
  maxQuestionsPerTask?: number;
  acceptanceMethods?: AcceptanceMethodPreference[];
  constraints?: StudyConstraint[];
};

type GeneratedPlan = {
  summary: string;
  strategy: PlanStrategy;
  tasks: PlanTask[];
};

const preferenceCodeLabels: Record<string, string> = {
  ...acceptanceMethodPreferenceLabels,
  ...examWindowLabels,
  ...studyStatusLabels,
  ...activeWeekdayLabels,
  ...studyWindowLabels,
  ...learningGoalLabels,
  ...learningMethodLabels,
  ...intensityLabels,
  ...mockExamPreferenceLabels,
  ...essayPreferenceLabels,
  ...studyConstraintLabels,
  AUTO: "自动推荐",
  OTHER: "其他考试",
};

const preferenceCodePattern = new RegExp(
  `(?<![A-Z0-9_])(?:${Object.keys(preferenceCodeLabels)
    .filter((code) => /^[A-Z][A-Z0-9_]*$/.test(code))
    .sort((left, right) => right.length - left.length)
    .join("|")})(?![A-Z0-9_])`,
  "g",
);

function localizePreferenceCodes(text: string) {
  return text.replace(
    preferenceCodePattern,
    (code) => preferenceCodeLabels[code] || code,
  );
}

function localizePlanPreferenceCodes(plan: GeneratedPlan): GeneratedPlan {
  return {
    summary: localizePreferenceCodes(plan.summary),
    strategy: {
      phase: localizePreferenceCodes(plan.strategy.phase),
      objective: localizePreferenceCodes(plan.strategy.objective),
      priorities: plan.strategy.priorities.map((priority) => ({
        ...priority,
        area: localizePreferenceCodes(priority.area),
        reason: localizePreferenceCodes(priority.reason),
      })),
      rhythm: localizePreferenceCodes(plan.strategy.rhythm),
      adjustmentRules: plan.strategy.adjustmentRules.map(
        localizePreferenceCodes,
      ),
    },
    tasks: plan.tasks.map((task) => ({
      ...task,
      title: localizePreferenceCodes(task.title),
      target: localizePreferenceCodes(task.target),
      reason: localizePreferenceCodes(task.reason),
      checkpoint: localizePreferenceCodes(task.checkpoint),
      module: task.module ? localizePreferenceCodes(task.module) : task.module,
      difficulty: task.difficulty
        ? localizePreferenceCodes(task.difficulty)
        : task.difficulty,
    })),
  };
}

type UnknownRecord = Record<string, unknown>;

const planTask = z.object({
  day: z.number().int().min(1).max(7),
  title: z.string().trim().min(1).max(160),
  type: z.enum(planTaskTypes),
  target: z.string().trim().min(1).max(500),
  minutes: z.number().int().min(5).max(240),
  reason: z.string().trim().min(1).max(800),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]),
  checkpoint: z.string().trim().min(1).max(500),
  module: z.string().trim().min(1).max(100).nullable().optional(),
  difficulty: z.string().trim().min(1).max(100).nullable().optional(),
  questionCount: z.number().int().min(1).max(200).nullable().optional(),
});

const planStrategy = z.object({
  phase: z.string().trim().min(1).max(300),
  objective: z.string().trim().min(1).max(800),
  priorities: z
    .array(
      z.object({
        area: z.string().trim().min(1).max(120),
        reason: z.string().trim().min(1).max(500),
        allocationPercent: z.number().int().min(1).max(100).nullable().optional(),
      }),
    )
    .min(1)
    .max(8),
  rhythm: z.string().trim().min(1).max(800),
  adjustmentRules: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
});

const modelPlan = z.object({
  summary: z.string().trim().min(1).max(1_500),
  strategy: planStrategy,
  tasks: z.array(planTask).min(1).max(21),
});

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function firstValue(source: UnknownRecord, keys: string[]) {
  for (const key of keys)
    if (source[key] !== undefined && source[key] !== null) return source[key];
}

function optionalText(value: unknown, max: number) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function textValue(value: unknown, fallback: string, max: number) {
  const text = optionalText(value, max);
  return text || fallback.slice(0, max);
}

function numberValue(value: unknown, fallback: number, min: number, max: number) {
  const matched =
    typeof value === "string" ? value.match(/\d+(?:\.\d+)?/)?.[0] : value;
  const number = Number(matched);
  return Number.isFinite(number)
    ? Math.min(max, Math.max(min, Math.round(number)))
    : fallback;
}

function nullableNumber(value: unknown, min: number, max: number) {
  if (value === undefined || value === null || value === "") return null;
  return numberValue(value, min, min, max);
}

function taskType(value: unknown, fallback: PlanTaskType): PlanTaskType {
  const type = String(value || "").trim().toUpperCase();
  if ((planTaskTypes as readonly string[]).includes(type))
    return type as PlanTaskType;
  if (/休息|缓冲|恢复|REST/.test(type)) return "REST";
  if (/诊断|测评|摸底|ASSESS/.test(type)) return "ASSESSMENT";
  if (/知识|方法|课程|理论|KNOWLEDGE|LESSON/.test(type)) return "KNOWLEDGE";
  if (/限时|速度|TIMED/.test(type)) return "TIMED_PRACTICE";
  if (/申论|写作|ESSAY/.test(type)) return "ESSAY";
  if (/模拟|套题|考试|EXAM/.test(type)) return "EXAM";
  if (/错题|WRONG/.test(type)) return "WRONG";
  if (/复盘|总结|REVIEW/.test(type)) return "REVIEW";
  if (/练习|专项|刷题|PRACTICE|TRAIN/.test(type)) return "PRACTICE";
  return fallback;
}

function taskPriority(value: unknown, fallback: PlanPriority): PlanPriority {
  const priority = String(value || "").trim().toUpperCase();
  if (["HIGH", "高", "P0", "P1"].includes(priority)) return "HIGH";
  if (["LOW", "低", "P3"].includes(priority)) return "LOW";
  if (["MEDIUM", "中", "P2"].includes(priority)) return "MEDIUM";
  return fallback;
}

function textList(value: unknown, fallback: string[], maxItems: number) {
  if (!Array.isArray(value)) return fallback.slice(0, maxItems);
  const items = value
    .map((item) => optionalText(item, 500))
    .filter((item): item is string => Boolean(item))
    .slice(0, maxItems);
  return items.length ? items : fallback.slice(0, maxItems);
}

const priorityRank: Record<PlanPriority, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

function effectiveActiveDays(preferences: PlanPreferences, generatedAt = new Date()) {
  // 每日任务始终只描述当前一天；用户的每周节奏由周规划负责。
  void preferences;
  void generatedAt;
  return [1];
}

function fitDayToBudget(
  input: PlanTask[],
  budget: number,
  taskLimit: number,
) {
  let repaired = false;
  let tasks = input.map((task) => {
    if (task.day === 1) return task;
    repaired = true;
    return { ...task, day: 1 };
  });

  if (tasks.length > taskLimit) {
    tasks = tasks
      .map((task, index) => ({ task, index }))
      .sort(
        (left, right) =>
          Number(right.task.type !== "REST") - Number(left.task.type !== "REST") ||
          priorityRank[right.task.priority] - priorityRank[left.task.priority] ||
          left.index - right.index,
      )
      .slice(0, taskLimit)
      .sort((left, right) => left.index - right.index)
      .map(({ task }) => task);
    repaired = true;
  }

  const formalExams = tasks.filter(
    (task) => task.type === "EXAM" && task.minutes >= 90,
  );
  if (formalExams.length) {
    return {
      tasks: formalExams.slice(0, Math.max(1, taskLimit)),
      repaired: repaired || tasks.length !== formalExams.length,
    };
  }

  if (tasks.reduce((sum, task) => sum + task.minutes, 0) <= budget)
    return { tasks, repaired };

  const maximumTasks = Math.min(taskLimit, Math.max(1, Math.floor(budget / 5)));
  const retained = tasks
    .map((task, index) => ({ task, index }))
    .sort(
      (left, right) =>
        Number(right.task.type !== "REST") - Number(left.task.type !== "REST") ||
        priorityRank[right.task.priority] - priorityRank[left.task.priority] ||
        left.index - right.index,
    )
    .slice(0, maximumTasks)
    .sort((left, right) => left.index - right.index)
    .map(({ task }) => task);
  const minimumTotal = retained.length * 5;
  const distributable = Math.max(0, budget - minimumTotal);
  const weights = retained.map((task) => Math.max(0, task.minutes - 5));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const allocations = retained.map((task, index) => {
    const exact = weightTotal ? (distributable * weights[index]) / weightTotal : 0;
    return {
      task,
      minutes: 5 + Math.floor(exact),
      fraction: exact - Math.floor(exact),
    };
  });
  let remainder = budget - allocations.reduce((sum, item) => sum + item.minutes, 0);
  for (const item of [...allocations].sort(
    (left, right) =>
      right.fraction - left.fraction ||
      priorityRank[right.task.priority] - priorityRank[left.task.priority],
  )) {
    if (!remainder) break;
    item.minutes += 1;
    remainder -= 1;
  }
  return {
    tasks: allocations.map(({ task, minutes }) => ({ ...task, minutes })),
    repaired: true,
  };
}

function alignQuestionTaskTiming(
  input: readonly PlanTask[],
  benchmarks: readonly SubtypeTimingBenchmark[],
  preferences: PlanPreferences,
  keepScheduledMinutes = false,
) {
  const maximumQuestions = Math.min(
    100,
    Math.max(5, Math.round(preferences.maxQuestionsPerTask || 100)),
  );
  return input.map((task) => {
    const spec = deriveCompletionSpec(task, {
      targetExam: preferences.targetExam,
      maxQuestionsPerTask: maximumQuestions,
    });
    if (spec.kind !== "PRACTICE") {
      if (
        task.type !== "EXAM" &&
        task.type !== "ESSAY" &&
        typeof task.questionCount === "number"
      ) {
        return {
          ...task,
          questionCount: Math.min(maximumQuestions, task.questionCount),
        };
      }
      return task;
    }

    const step = spec.requiredModule === "资料分析" ? 5 : 1;
    const minimumCount = 5;
    const minuteLimit = keepScheduledMinutes
      ? Math.max(5, Math.round(task.minutes))
      : Number.POSITIVE_INFINITY;
    let count = Math.min(maximumQuestions, spec.minAnswered);
    if (step === 5) count = Math.max(5, Math.floor(count / 5) * 5);
    let estimatedMinutes = estimateTaskMinutes(
      count,
      spec.launch.scopes || [],
      benchmarks,
    );
    while (count > minimumCount && estimatedMinutes > minuteLimit) {
      count = Math.max(minimumCount, count - step);
      estimatedMinutes = estimateTaskMinutes(
        count,
        spec.launch.scopes || [],
        benchmarks,
      );
    }
    return {
      ...task,
      questionCount: count,
      minutes: keepScheduledMinutes
        ? Math.max(Math.round(task.minutes), estimatedMinutes)
        : estimatedMinutes,
    };
  });
}

function applyPreferredCompletionSpecs(
  tasks: readonly PlanTask[],
  preferences: PlanPreferences,
  accuracyProfile: Partial<
    Record<CompletionModule, { accuracy: number; sampleSize: number }>
  >,
) {
  const methods = preferences.acceptanceMethods || ["SYSTEM", "SELF"];
  const selfOnly = methods.includes("SELF") && !methods.includes("SYSTEM");
  if (selfOnly) {
    const selfSpec = deriveCompletionSpec({ type: "KNOWLEDGE" });
    return tasks.map((task) => {
      if (task.type === "REST") {
        const spec = deriveCompletionSpec(task);
        return {
          ...task,
          checkpoint: checkpointForCompletionSpec(spec, task.checkpoint),
          completionSpec: spec,
        };
      }
      return {
        ...task,
        checkpoint: task.checkpoint?.trim() || task.target,
        completionSpec: selfSpec,
      };
    });
  }

  const executable = applyCompletionSpecs(tasks, {
    targetExam: preferences.targetExam,
    maxQuestionsPerTask: preferences.maxQuestionsPerTask,
    accuracyProfile,
  });
  return methods.includes("SYSTEM") && !methods.includes("SELF")
    ? executable.filter(
        (task) =>
          task.completionSpec.method === "PROGRAM" ||
          task.completionSpec.method === "NONE",
      )
    : executable;
}

function normalizeSchedule(
  input: PlanTask[],
  fallback: GeneratedPlan,
  preferences: PlanPreferences,
  generatedAt = new Date(),
) {
  const allowedDays = effectiveActiveDays(preferences, generatedAt);
  const targetActiveDays = allowedDays.length;
  const dailyBudget = Math.min(
    240,
    Math.max(20, Math.round(preferences.dailyMinutes || 60)),
  );
  const taskLimit = Math.min(
    21,
    Math.max(1, Math.round(preferences.maxTasksPerDay || 5)),
  );
  const minimumTasks = Math.min(
    taskLimit,
    Math.max(1, Math.floor(21 / Math.max(1, targetActiveDays))),
    Math.max(1, Math.round(preferences.minTasksPerDay || 1)),
  );
  let repaired = false;
  let tasks = [...input];

  const allowed = new Set(allowedDays);
  tasks = tasks.map((task) => {
    if (task.type === "REST" || allowed.has(task.day)) return task;
    repaired = true;
    return { ...task, day: 1 };
  });

  const excludedTypes = new Set<PlanTaskType>();
  if (
    preferences.mockExamPreference === "NONE" ||
    !fallback.tasks.some((task) => task.type === "EXAM")
  )
    excludedTypes.add("EXAM");
  if (
    preferences.essayPreference === "NONE" ||
    !fallback.tasks.some((task) => task.type === "ESSAY")
  )
    excludedTypes.add("ESSAY");
  if (
    preferences.acceptanceMethods?.includes("SYSTEM") &&
    !preferences.acceptanceMethods.includes("SELF")
  ) {
    excludedTypes.add("KNOWLEDGE");
    excludedTypes.add("WRONG");
    excludedTypes.add("REVIEW");
  }
  if (excludedTypes.size) {
    const permitted = tasks.filter((task) => !excludedTypes.has(task.type));
    if (permitted.length !== tasks.length) repaired = true;
    tasks = permitted;
  }
  const activeDayEntries = () => {
    const groups = new Map<number, PlanTask[]>();
    for (const task of tasks) {
      if (task.type === "REST") continue;
      groups.set(task.day, [...(groups.get(task.day) || []), task]);
    }
    return [...groups.entries()];
  };

  const activeEntries = activeDayEntries();
  if (activeEntries.length > targetActiveDays) {
    const retainedDays = new Set(
      activeEntries
        .sort((left, right) => {
          const score = (items: PlanTask[]) =>
            items.reduce(
              (sum, task) => sum + priorityRank[task.priority] * 100 + task.minutes,
              0,
            );
          return score(right[1]) - score(left[1]) || left[0] - right[0];
        })
        .slice(0, targetActiveDays)
        .map(([day]) => day),
    );
    tasks = tasks.filter(
      (task) => task.type === "REST" || retainedDays.has(task.day),
    );
    repaired = true;
  }

  let occupiedDays = new Set(activeDayEntries().map(([day]) => day));
  if (occupiedDays.size < targetActiveDays) {
    for (const task of fallback.tasks) {
      if (occupiedDays.size >= targetActiveDays) break;
      if (task.type === "REST" || occupiedDays.has(task.day)) continue;
      tasks.push(task);
      occupiedDays.add(task.day);
      repaired = true;
    }
  }

  for (const type of ["EXAM", "ESSAY"] as const) {
    const preferenceIsExplicit =
      type === "EXAM"
        ? preferences.mockExamPreference !== undefined &&
          preferences.mockExamPreference !== "NONE"
        : preferences.essayPreference !== undefined &&
          preferences.essayPreference !== "NONE";
    if (!preferenceIsExplicit) continue;
    const fallbackTasks = fallback.tasks.filter((task) => task.type === type);
    let missing =
      fallbackTasks.length - tasks.filter((task) => task.type === type).length;
    while (missing > 0) {
      const source = fallbackTasks[fallbackTasks.length - missing];
      if (!source) break;
      const destination = activeDayEntries()
        .map(([day, dayTasks]) => ({ day, dayTasks }))
        .filter((item) => item.dayTasks.length < taskLimit)
        .sort(
          (left, right) =>
            left.dayTasks.length - right.dayTasks.length ||
            left.dayTasks.reduce((sum, task) => sum + task.minutes, 0) -
              right.dayTasks.reduce((sum, task) => sum + task.minutes, 0) ||
            left.day - right.day,
        )[0];
      if (destination) {
        tasks.push({ ...source, day: destination.day });
      } else {
        const replacement = tasks
          .map((task, index) => ({ task, index }))
          .filter(({ task }) =>
            task.type !== "REST" && task.type !== "EXAM" && task.type !== "ESSAY",
          )
          .sort(
            (left, right) =>
              priorityRank[left.task.priority] - priorityRank[right.task.priority] ||
              left.task.minutes - right.task.minutes ||
              right.index - left.index,
          )[0];
        if (!replacement) break;
        tasks.splice(replacement.index, 1, {
          ...source,
          day: replacement.task.day,
        });
      }
      repaired = true;
      missing -= 1;
    }
  }

  occupiedDays = new Set(activeDayEntries().map(([day]) => day));
  const withoutConflictingRest = tasks.filter(
    (task) => task.type !== "REST" || !occupiedDays.has(task.day),
  );
  if (withoutConflictingRest.length !== tasks.length) repaired = true;

  const balancedTasks = [...withoutConflictingRest];
  const balanceDailyTasks = preferences.constraints?.includes("BALANCE_DAILY_TASKS");
  const currentNonRest = balancedTasks.filter((task) => task.type !== "REST").length;
  const balancedTarget = balanceDailyTasks
    ? Math.min(
        taskLimit,
        Math.max(minimumTasks, Math.round(currentNonRest / Math.max(1, targetActiveDays))),
      )
    : minimumTasks;
  const fillerPool = fallback.tasks.filter(
    (task) => !["REST", "EXAM", "ESSAY"].includes(task.type),
  );
  let fillerIndex = 0;
  for (const day of allowedDays) {
    let dayTasks = balancedTasks.filter(
      (task) => task.day === day && task.type !== "REST",
    );
    if (balanceDailyTasks && !dayTasks.some((task) => task.type === "EXAM")) {
      while (dayTasks.length > balancedTarget) {
        const removable = dayTasks
          .map((task, index) => ({ task, index }))
          .filter(({ task }) => !["EXAM", "ESSAY"].includes(task.type))
          .sort(
            (left, right) =>
              priorityRank[left.task.priority] - priorityRank[right.task.priority] ||
              left.task.minutes - right.task.minutes ||
              right.index - left.index,
          )[0];
        if (!removable) break;
        const globalIndex = balancedTasks.indexOf(removable.task);
        if (globalIndex >= 0) balancedTasks.splice(globalIndex, 1);
        dayTasks = dayTasks.filter((task) => task !== removable.task);
        repaired = true;
      }
    }
    const required = dayTasks.some((task) => task.type === "EXAM")
      ? 1
      : balancedTarget;
    while (dayTasks.length < required && fillerPool.length) {
      const source = fillerPool[fillerIndex % fillerPool.length];
      fillerIndex += 1;
      const added = { ...source, day };
      balancedTasks.push(added);
      dayTasks.push(added);
      repaired = true;
    }
  }

  const byDay = new Map<number, PlanTask[]>();
  for (const task of balancedTasks)
    byDay.set(task.day, [...(byDay.get(task.day) || []), task]);
  const fitted = [...byDay.entries()].flatMap(([day, dayTasks]) => {
    const result = fitDayToBudget(
      dayTasks,
      dailyBudget,
      taskLimit,
    );
    if (result.repaired) repaired = true;
    return result.tasks.map((task) => ({ ...task, day }));
  });
  while (fitted.length > 21) {
    const counts = new Map<number, number>();
    for (const task of fitted) counts.set(task.day, (counts.get(task.day) || 0) + 1);
    const removable = fitted
      .map((task, index) => ({ task, index }))
      .filter(({ task }) => (counts.get(task.day) || 0) > 1)
      .sort(
        (left, right) =>
          priorityRank[left.task.priority] - priorityRank[right.task.priority] ||
          left.task.minutes - right.task.minutes ||
          right.index - left.index,
      )[0];
    if (!removable) break;
    fitted.splice(removable.index, 1);
    repaired = true;
  }
  fitted.sort((left, right) => left.day - right.day);
  return { tasks: fitted, repaired };
}

function buildRulePlan(
  categories: { name: string; total: number; accuracy: number }[],
  subtypes: { name: string; total: number; accuracy: number }[],
  total: number,
  preferences: PlanPreferences,
  generatedAt = new Date(),
  dailySequence = 0,
): GeneratedPlan {
  const sorted = [...categories].sort((a, b) => a.accuracy - b.accuracy);
  const selectedFocus = (preferences.focusAreas || []).filter(
    (area): area is Exclude<FocusArea, "AUTO"> => area !== "AUTO",
  );
  const politicalPattern = /政治理论|习近平|马克思|党史|毛泽东|时政|时事政治/;
  const fallbackSubtype = (focus: string) => {
    if (politicalPattern.test(focus)) return "常识判断 / 时政常识";
    if (/常识/.test(focus)) return "常识判断 / 科技地理";
    if (/数量|数学|数字/.test(focus)) return "数量关系 / 数学运算";
    if (/判断|图形|定义|类比|逻辑/.test(focus)) return "判断推理 / 图形推理";
    if (/资料/.test(focus)) return "资料分析 / 综合材料";
    return "言语理解 / 逻辑填空";
  };
  const subtypeFor = (focus: string | undefined, excluded = new Set<string>()) => {
    const value = focus?.trim() || "";
    const matcher = (name: string) => {
      if (!value) return true;
      if (name === value) return true;
      if (politicalPattern.test(value)) return name.startsWith("常识判断 / ") && politicalPattern.test(name);
      if (/常识/.test(value)) return name.startsWith("常识判断 / ") && !politicalPattern.test(name);
      if (/言语/.test(value)) return name.startsWith("言语理解 / ");
      if (/数量|数学|数字/.test(value)) return name.startsWith("数量关系 / ");
      if (/判断|图形|定义|类比|逻辑/.test(value)) return name.startsWith("判断推理 / ");
      if (/资料/.test(value)) return name.startsWith("资料分析 / ");
      return name.includes(value);
    };
    return subtypes.find((item) => !excluded.has(item.name) && matcher(item.name))?.name || fallbackSubtype(value);
  };
  const focusCandidates = [
    ...selectedFocus,
    preferences.focus,
    ...sorted.map((item) => item.name),
  ].filter((value): value is string => Boolean(value));
  const weak = subtypeFor(focusCandidates[0]);
  const secondCandidates = selectedFocus.length > 1
    ? [selectedFocus[1], ...focusCandidates.filter((focus) => focus !== selectedFocus[1])]
    : focusCandidates;
  const second = secondCandidates
    .map((focus) => subtypeFor(focus, new Set([weak])))
    .find((name) => name !== weak) || (weak.includes("判断推理") ? "资料分析 / 综合材料" : "判断推理 / 图形推理");
  const minutes = Math.min(240, Math.max(20, preferences.dailyMinutes || 60));
  const activeDays = effectiveActiveDays(preferences, generatedAt);
  const stage =
    preferences.studyStatus && preferences.studyStatus !== "AUTO"
      ? studyStatusLabels[preferences.studyStatus]
      : preferences.currentLevel &&
          preferences.currentLevel !== studyStatusLabels.AUTO
        ? preferences.currentLevel
        : total < 100
          ? "基础阶段"
          : "强化阶段";
  const examText = preferences.examDate
    ? `，考试日期为 ${preferences.examDate}`
    : preferences.examWindow
      ? `，备考周期为${examWindowLabels[preferences.examWindow]}`
      : "";
  const goalText = preferences.learningGoal
    ? `，当前侧重${learningGoalLabels[preferences.learningGoal]}`
    : "";
  const summary = total
    ? `基于累计 ${total} 道作答${examText}，当前处于${stage}${goalText}。今天优先处理 ${weak}，同时保持 ${second} 的连续训练；完成任务后依据真实表现自动生成下一份每日任务。`
    : `当前有效作答样本较少${examText}，当前处于${stage}${goalText}。今天先围绕 ${weak} 与 ${second} 建立诊断基线，再依据结果调整下一份每日任务。`;

  const candidates: Omit<PlanTask, "day">[] = [
    {
      title: total ? `${weak}方法诊断` : "行测基础诊断",
      type: total ? "KNOWLEDGE" : "ASSESSMENT",
      target: total ? `复盘 ${weak} 常见失分方法并完成一组基础题` : "完成一组覆盖主要板块的诊断题",
      minutes: Math.max(20, Math.round(minutes * 0.7)),
      reason: total ? "先确认失分来自知识、方法还是节奏，再决定刷题量" : "用真实样本替代主观判断，建立后续计划基线",
      priority: "HIGH",
      checkpoint: total ? "能写出至少两类错因，并在基础题组达到 70% 正确率" : "完成诊断并记录各板块正确率与题均用时",
      module: total ? weak : null,
      difficulty: "基础到中等",
      questionCount: Math.max(10, Math.round(minutes / 4)),
    },
    {
      title: `${weak}限时题组`,
      type: "TIMED_PRACTICE",
      target: `完成 ${weak} 限时训练并逐题标注错因`,
      minutes: Math.max(25, Math.round(minutes * 0.8)),
      reason: "把方法理解转化为稳定的得分和时间控制",
      priority: "HIGH",
      checkpoint: "正确率不低于上次同板块表现，且题均用时不增加",
      module: weak,
      difficulty: stage.includes("冲刺") ? "中等到较难" : "基础到中等",
      questionCount: Math.max(10, Math.round(minutes / 3)),
    },
    {
      title: "错题闭环复盘",
      type: "WRONG",
      target: "重做最近错题，归纳可复用的识别信号和解题步骤",
      minutes: Math.max(20, Math.round(minutes * 0.55)),
      reason: "确认上一轮错误已经转化为可复用方法，而不是只记住答案",
      priority: "HIGH",
      checkpoint: "错题重做正确率达到 85%，每题能说明原始错因",
      module: weak,
      difficulty: null,
      questionCount: Math.max(8, Math.round(minutes / 5)),
    },
    {
      title: `${second}保持训练`,
      type: "PRACTICE",
      target: `完成 ${second} 专项并记录速度与正确率`,
      minutes: Math.max(25, Math.round(minutes * 0.65)),
      reason: "避免训练资源全部集中在单一板块，保持第二优先模块连续性",
      priority: "MEDIUM",
      checkpoint: "完成设定题量，正确率达到近期平均水平以上",
      module: second,
      difficulty: "匹配当前水平",
      questionCount: Math.max(10, Math.round(minutes / 3)),
    },
    {
      title: "申论材料与表达",
      type: "ESSAY",
      target: "完成一道申论小题，按评分点复盘材料提炼和表达",
      minutes: Math.max(30, Math.round(minutes * 0.8)),
      reason: "行测训练之外同步保持材料阅读和规范表达能力",
      priority: "MEDIUM",
      checkpoint: "在限字内完成作答，并依据反馈改写一次失分段落",
      module: "申论",
      difficulty: null,
      questionCount: 1,
    },
    minutes >= 60
      ? {
          title: "正式卷型阶段测验",
          type: "EXAM",
          target: "按目标考试卷型完成一次阶段测验并查看训练总结",
          minutes,
          reason: "验证板块训练是否转化为整卷时间分配和稳定得分",
          priority: "HIGH",
          checkpoint: "完成交卷，记录最低正确率板块和超时板块",
          module: "行测综合",
          difficulty: "正式卷型",
          questionCount: null,
        }
      : {
          title: "综合限时测验",
          type: "ASSESSMENT",
          target: "完成一组跨板块限时题并检查时间分配",
          minutes,
          reason: "可用时间不足以完成整卷时，用短测验验证综合节奏",
          priority: "HIGH",
          checkpoint: "在限定时间内完成，未出现单题长时间停留",
          module: "行测综合",
          difficulty: "中等",
          questionCount: Math.max(15, Math.round(minutes / 2.5)),
        },
    {
      title: "周复盘与下周校准",
      type: "REVIEW",
      target: "对比本周起点与阶段测验，确定下周保留、降低和增加的训练",
      minutes: Math.max(20, Math.round(minutes * 0.5)),
      reason: preferences.notes || "让计划随表现变化，不机械重复同一套任务",
      priority: "MEDIUM",
      checkpoint: "形成三个明确结论：继续项、调整项和下周第一优先项",
      module: null,
      difficulty: null,
      questionCount: null,
    },
  ];

  const weeklySlot = dailySequence % 7;
  const mockDue = preferences.mockExamPreference === "BIWEEKLY"
    ? dailySequence % 14 === 0
    : preferences.mockExamPreference === "TWICE_WEEKLY"
      ? weeklySlot === 0 || weeklySlot === 4
      : preferences.mockExamPreference === "WEEKLY"
        ? weeklySlot === 0
        : false;
  const essaySlots = preferences.mockExamPreference && preferences.mockExamPreference !== "NONE"
    ? preferences.essayPreference === "THREE_TIMES_WEEKLY"
      ? [1, 3, 5]
      : preferences.essayPreference === "TWICE_WEEKLY"
        ? [1, 4]
        : [1]
    : preferences.essayPreference === "THREE_TIMES_WEEKLY"
      ? [0, 2, 4]
      : preferences.essayPreference === "TWICE_WEEKLY"
        ? [0, 4]
        : [0];
  const essayDue = preferences.essayPreference !== undefined &&
    preferences.essayPreference !== "NONE" && essaySlots.includes(weeklySlot);
  const desiredEssayCount = essayDue ? 1 : 0;
  const desiredMockCount = mockDue ? 1 : 0;
  const essayCandidate = candidates[4];
  const formalExamMinutes = preferences.targetExam?.includes("广东")
    ? EXAM_TEMPLATES.GUANGDONG_PROVINCE.durationMinutes
    : EXAM_TEMPLATES.NATIONAL_PREFECTURE.durationMinutes;
  const mockCandidate: Omit<PlanTask, "day"> = {
    ...candidates[5],
    title: "正式卷型阶段测验",
    type: "EXAM",
    target: "按目标考试卷型完成一次阶段测验并查看训练总结",
    reason: "按照选定模考频率，检验板块训练能否迁移到整卷节奏",
    module: "行测综合",
    difficulty: "正式卷型",
    questionCount: null,
    minutes: formalExamMinutes,
  };
  const specialCandidates: Omit<PlanTask, "day">[] = [];
  const specialOrder =
    preferences.learningGoal === "ESSAY"
      ? (["ESSAY", "EXAM"] as const)
      : (["EXAM", "ESSAY"] as const);
  const remaining = { ESSAY: desiredEssayCount, EXAM: desiredMockCount };
  while (remaining.ESSAY > 0 || remaining.EXAM > 0) {
    for (const type of specialOrder) {
      if (remaining[type] <= 0) continue;
      const sequence =
        type === "ESSAY"
          ? desiredEssayCount - remaining.ESSAY + 1
          : desiredMockCount - remaining.EXAM + 1;
      const base = type === "ESSAY" ? essayCandidate : mockCandidate;
      specialCandidates.push({
        ...base,
        title:
          sequence > 1
            ? `${base.title}（第 ${sequence} 次）`
            : base.title,
      });
      remaining[type] -= 1;
    }
  }

  const baseCoreCandidates = [
    candidates[0],
    candidates[3],
    candidates[1],
    candidates[2],
    candidates[6],
  ];
  const systemOnly =
    preferences.acceptanceMethods?.includes("SYSTEM") &&
    !preferences.acceptanceMethods.includes("SELF");
  const coreCandidates = systemOnly
    ? baseCoreCandidates.filter((candidate) =>
        ["ASSESSMENT", "PRACTICE", "TIMED_PRACTICE"].includes(candidate.type),
      )
    : baseCoreCandidates;
  const hasExplicitFrequency =
    preferences.essayPreference !== undefined ||
    preferences.mockExamPreference !== undefined;
  const orderedCandidates = hasExplicitFrequency
    ? [coreCandidates[0], ...specialCandidates, ...coreCandidates.slice(1)]
    : [
        ...coreCandidates.slice(0, 2),
        ...specialCandidates,
        ...coreCandidates.slice(2),
      ];
  const ruleTaskLimit = preferences.maxTasksPerDay === null
    ? 21
    : Math.min(
        21,
        Math.max(
          1,
          Math.round(
            preferences.maxTasksPerDay || (hasExplicitFrequency ? 2 : 1),
          ),
        ),
      );
  const candidateQueue = [...orderedCandidates];
  while (candidateQueue.length < activeDays.length) {
    const sequence = candidateQueue.length - orderedCandidates.length + 2;
    candidateQueue.push({
      ...coreCandidates[coreCandidates.length - 1],
      title: `阶段复盘与校准（第 ${sequence} 次）`,
    });
  }
  const selectedCandidates = candidateQueue.slice(
    0,
    activeDays.length * ruleTaskLimit,
  );
  const scheduled = new Map<number, Omit<PlanTask, "day">[]>();
  for (const [index, candidate] of selectedCandidates.entries()) {
    const day =
      index < activeDays.length
        ? activeDays[index]
        : activeDays
            .map((activeDay) => ({
              day: activeDay,
              tasks: scheduled.get(activeDay) || [],
            }))
            .filter((item) => item.tasks.length < ruleTaskLimit)
            .sort(
              (left, right) =>
                left.tasks.length - right.tasks.length ||
                left.tasks.reduce((sum, task) => sum + task.minutes, 0) -
                  right.tasks.reduce((sum, task) => sum + task.minutes, 0) ||
                left.day - right.day,
            )[0]?.day;
    if (!day) break;
    scheduled.set(day, [...(scheduled.get(day) || []), candidate]);
  }
  const tasks = [...scheduled.entries()].flatMap(([day, dayTasks]) =>
    dayTasks.map((task) => ({ day, ...task })),
  );

  const methodText = preferences.learningMethods?.length
    ? preferences.learningMethods.map((method) => learningMethodLabels[method]).join("、")
    : "诊断、训练、复盘与校准";
  const windowText = preferences.studyWindows?.length
    ? `优先使用${preferences.studyWindows.map((window) => studyWindowLabels[window]).join("、")}`
    : "按可用时段执行";
  const constraintText = preferences.constraints?.length
    ? `；同时遵守${preferences.constraints.map((item) => studyConstraintLabels[item]).join("、")}`
    : "";
  const intensityText = preferences.intensity
    ? intensityLabels[preferences.intensity]
    : "均衡推进";

  return {
    summary,
    strategy: {
      phase: stage,
      objective: `当前任务先提高 ${weak} 的方法稳定性，再巩固 ${second}，并依据一周阶段目标验证训练迁移。`,
      priorities: [
        { area: weak, reason: "当前数据或用户目标指向的第一优先方向", allocationPercent: 45 },
        { area: second, reason: "保持第二模块连续性，防止顾此失彼", allocationPercent: 30 },
        { area: "综合与申论", reason: "通过整卷节奏和文字表达检验综合能力", allocationPercent: 25 },
      ],
      rhythm: `当前一天按${intensityText}强度，以“${methodText}”形成闭环；${windowText}${constraintText}。下一份任务会依据本次结果自动调整，不补量透支。`,
      adjustmentRules: [
        `若 ${weak} 正确率连续两组达到 80%，下一组提高约 1 个难度档。`,
        "若正确率下降且题均用时上升，暂停加量，回到错因和方法复盘。",
        "若当天可用时间不足，优先保留高优先级任务，不把全部任务顺延堆积。",
      ],
    },
    tasks,
  };
}

function normalizeModelPlan(
  raw: UnknownRecord,
  fallback: GeneratedPlan,
  preferences: PlanPreferences,
  generatedAt: Date,
) {
  const nested =
    record(firstValue(raw, ["data", "result", "plan", "studyPlan", "学习计划"])) ||
    raw;
  const taskValue = firstValue(nested, [
    "tasks",
    "days",
    "dailyTasks",
    "daily_plan",
    "schedule",
    "每日计划",
    "任务",
  ]);
  const rawTasks = Array.isArray(taskValue) ? taskValue.slice(0, 21) : [];
  if (!rawTasks.length) return null;

  let repaired = false;
  let tasks: PlanTask[] = rawTasks.flatMap((value, index) => {
    const task = record(value);
    if (!task) {
      repaired = true;
      return [];
    }
    const base = fallback.tasks[index % fallback.tasks.length];
    const day = 1;
    const requiredFields = [
      ["title", "name", "task", "主题", "标题", "任务名称"],
      ["type", "taskType", "category", "类型", "任务类型"],
      ["target", "goal", "content", "目标", "训练目标", "任务内容"],
      ["minutes", "duration", "time", "时长", "分钟"],
      ["reason", "why", "purpose", "原因", "理由", "安排依据"],
      ["priority", "importance", "优先级", "重要性"],
      ["checkpoint", "successCriteria", "completionStandard", "完成标准", "验收标准"],
    ];
    if (requiredFields.some((keys) => firstValue(task, keys) === undefined))
      repaired = true;
    return [
      {
        day,
        title: textValue(
          firstValue(task, ["title", "name", "task", "主题", "标题", "任务名称"]),
          base?.title || `第 ${day} 天训练任务`,
          160,
        ),
        type: taskType(
          firstValue(task, ["type", "taskType", "category", "类型", "任务类型"]),
          base?.type || "PRACTICE",
        ),
        target: textValue(
          firstValue(task, ["target", "goal", "content", "目标", "训练目标", "任务内容"]),
          base?.target || "完成计划任务并记录结果",
          500,
        ),
        minutes: numberValue(
          firstValue(task, ["minutes", "duration", "time", "时长", "分钟"]),
          base?.minutes || preferences.dailyMinutes || 60,
          5,
          240,
        ),
        reason: textValue(
          firstValue(task, ["reason", "why", "purpose", "原因", "理由", "安排依据"]),
          base?.reason || "根据本周目标安排",
          800,
        ),
        priority: taskPriority(
          firstValue(task, ["priority", "importance", "优先级", "重要性"]),
          base?.priority || "MEDIUM",
        ),
        checkpoint: textValue(
          firstValue(task, ["checkpoint", "successCriteria", "completionStandard", "完成标准", "验收标准"]),
          base?.checkpoint || "完成后记录正确率、用时和主要问题",
          500,
        ),
        module: optionalText(
          firstValue(task, ["module", "section", "focus", "板块", "模块"]),
          100,
        ),
        difficulty: optionalText(
          firstValue(task, ["difficulty", "difficultyRange", "难度", "难度范围"]),
          100,
        ),
        questionCount: nullableNumber(
          firstValue(task, ["questionCount", "count", "题量", "题目数量"]),
          1,
          200,
        ),
      } satisfies PlanTask,
    ];
  });

  const schedule = normalizeSchedule(tasks, fallback, preferences, generatedAt);
  tasks = schedule.tasks;
  if (schedule.repaired) repaired = true;

  const rawStrategy =
    record(firstValue(nested, ["strategy", "learningStrategy", "策略", "学习策略"])) ||
    {};
  const requiredStrategyFields = [
    ["phase", "stage", "currentPhase", "阶段"],
    ["objective", "weeklyGoal", "goal", "本周目标", "核心目标"],
    ["rhythm", "weeklyRhythm", "pace", "节奏", "周节奏"],
    ["adjustmentRules", "rules", "调整规则", "动态规则"],
  ];
  if (
    requiredStrategyFields.some(
      (keys) => firstValue(rawStrategy, keys) === undefined,
    )
  )
    repaired = true;
  const priorityValue = firstValue(rawStrategy, ["priorities", "focusAreas", "重点", "优先方向"]);
  const rawPriorities = Array.isArray(priorityValue) ? priorityValue : [];
  const priorities = rawPriorities.flatMap((value, index) => {
    const item = record(value);
    if (!item) return [];
    const base = fallback.strategy.priorities[index % fallback.strategy.priorities.length];
    return [
      {
        area: textValue(
          firstValue(item, ["area", "name", "module", "方向", "板块"]),
          base?.area || "重点能力",
          120,
        ),
        reason: textValue(
          firstValue(item, ["reason", "evidence", "原因", "依据"]),
          base?.reason || "根据当前数据确定",
          500,
        ),
        allocationPercent: nullableNumber(
          firstValue(item, ["allocationPercent", "allocation", "percent", "时间占比", "占比"]),
          1,
          100,
        ),
      },
    ];
  });
  if (!priorities.length) repaired = true;
  const adjustmentValue = firstValue(rawStrategy, [
    "adjustmentRules",
    "rules",
    "调整规则",
    "动态规则",
  ]);
  if (!Array.isArray(adjustmentValue) || !adjustmentValue.length) repaired = true;
  if (
    firstValue(nested, [
      "summary",
      "overview",
      "description",
      "planSummary",
      "总结",
      "计划概述",
    ]) === undefined
  )
    repaired = true;

  const normalized = {
    summary: textValue(
      firstValue(nested, ["summary", "overview", "description", "planSummary", "总结", "计划概述"]),
      fallback.summary,
      1_500,
    ),
    strategy: {
      phase: textValue(
        firstValue(rawStrategy, ["phase", "stage", "currentPhase", "阶段"]),
        fallback.strategy.phase,
        300,
      ),
      objective: textValue(
        firstValue(rawStrategy, ["objective", "weeklyGoal", "goal", "本周目标", "核心目标"]),
        fallback.strategy.objective,
        800,
      ),
      priorities: priorities.length ? priorities : fallback.strategy.priorities,
      rhythm: textValue(
        firstValue(rawStrategy, ["rhythm", "weeklyRhythm", "pace", "节奏", "周节奏"]),
        fallback.strategy.rhythm,
        800,
      ),
      adjustmentRules: textList(
        firstValue(rawStrategy, ["adjustmentRules", "rules", "调整规则", "动态规则"]),
        fallback.strategy.adjustmentRules,
        10,
      ),
    },
    tasks,
  };
  const localized = localizePlanPreferenceCodes(normalized);
  if (JSON.stringify(localized) !== JSON.stringify(normalized)) repaired = true;
  const parsed = modelPlan.safeParse(localized);
  return parsed.success ? { plan: parsed.data, repaired } : null;
}

const studyPlanSystemPrompt = [
  "你是经验丰富的公务员考试学习规划教练。请基于服务端给出的近期表现、长期样本、细分题型、难度、用时、训练报告、申论数据、考试倒计时、最新一周阶段目标和用户时间约束，制定当前一天的可执行任务。",
  "只使用输入中的数据，不推测用户身份，不虚构已完成的训练。计划应有取舍、有证据、能根据结果调整，而不是把固定模板换词复述。",
  "只返回JSON对象，包含summary、strategy和tasks。strategy包含phase、objective、priorities、rhythm、adjustmentRules；priorities每项包含area、reason，可选allocationPercent。",
  "tasks允许1到21项，每项包含day(固定为1)、title、type、target、minutes、reason、priority和checkpoint；禁止输出多天安排、星期几或未来日期。type可用ASSESSMENT、KNOWLEDGE、PRACTICE、TIMED_PRACTICE、WRONG、EXAM、ESSAY、REVIEW、REST；还可按需要提供module、difficulty和questionCount。",
  "PRACTICE、TIMED_PRACTICE和单板块ASSESSMENT任务必须精确到performance.subtypes中存在的细分题型，module使用“大板块 / 细分题型”格式；同一任务可用顿号连接同一大板块下的多个细分题型。只有明确的跨板块综合测评才能使用“行测综合”。",
  "timingBenchmarks给出每个“大板块 / 细分题型”的initialSeconds、sampleCount、observedAverageSeconds和recommendedSeconds。样本少时recommendedSeconds接近初始基准，样本丰富后会逐步学习用户真实速度；必须使用recommendedSeconds，不得用全卷统一题均时间。",
  "所有PRACTICE、TIMED_PRACTICE和ASSESSMENT都按计时任务生成。先确定细分题型和questionCount，再按各细分题型recommendedSeconds估算建议作答时长；单题型minutes=ceil(questionCount×recommendedSeconds/60)，多题型使用各题型建议秒数的平均值。minutes只是规划用的建议时长，服务端会按题目难度和板块另行生成更宽松的验收上限，尤其数量关系和资料分析，不要在target或checkpoint中自行编造固定正确率和验收时限。复盘应另设任务，不要把大量复盘时间混入计时作答分钟。",
  "题量必须体现板块差异：常识判断、言语理解与表达、判断推理属于较高题量密度，资料分析和数量关系属于较低题量密度；禁止给不同板块机械安排相同题量。服务端还会根据建议时长和板块密度校准题量。",
  "验收正确率由服务端根据板块基线、题目难度和用户历史作答动态生成。无历史样本时基线为常识判断50%、言语理解与表达80%、判断推理75%、资料分析70%、数量关系60%；不要在任务文本中写死统一的60%或自行覆盖这些规则。",
  "结构化preferences表示用户约束与倾向，不要机械地为每个选项各生成一个任务。当前只规划generatedAt对应的北京时间当天，activeWeekdays和weeklyDays仅作为今天是否安排的背景信息，不得输出其它日期。dailyMinutes和maxQuestionsPerTask是日常训练硬上限；当前任务数必须位于minTasksPerDay到maxTasksPerDay范围内。正式整卷模考是固定时长例外，不得为满足dailyMinutes而压缩。",
  "acceptanceMethods是允许的验收方式：仅SYSTEM时只生成可由训练报告或申论提交自动核对的ASSESSMENT、PRACTICE、TIMED_PRACTICE、EXAM、ESSAY任务；仅SELF时任务均按自验收设计；两者都有时可按任务性质混合安排。",
  "mockExamPreference和essayPreference按已完成每日任务次数滚动兑现；scheduledSpecialTasks是当前这一份允许出现的EXAM或ESSAY类型，未列出的特殊类型禁止生成。正式整卷模考使用目标考试固定卷型、固定题量和固定时长，不能用综合短测冒充。studyWindows只用于安排学习节奏，不得虚构具体通知时间。",
  "preferenceLabels已经提供所有偏好的中文含义。面向用户的summary、strategy和tasks文本必须使用自然中文，不得直接输出METHOD_FIRST、WEEKDAY_EVENING、TWICE_WEEKLY等内部枚举代码。",
  "允许同日多任务和休息日，但必须遵守每日任务数量范围；constraints包含BALANCE_DAILY_TASKS时，各学习日任务数应尽量相同，通常最多相差1项，正式整卷模考日可单独只有1项。自行决定任务组合、顺序、篇幅和表达方式。",
  "重点说明为什么这样分配、怎样判断任务完成、什么表现会触发升降难度或改变下一步。样本不足时可以先安排诊断，不要过度解读少量数据。不要输出Markdown或JSON之外的说明。",
  "输入上下文只应包含聚合表现和已校验偏好，不要索取或输出题干、答案、用户API Key、模型密钥或连接地址。",
].join("");

async function tryModelPlan(
  context: unknown,
  fallback: GeneratedPlan,
  preferences: PlanPreferences,
  connection: ModelConnection,
  generatedAt: Date,
) {
  if (!connection.apiKey || !connection.model)
    return { ...fallback, source: "DATA_RULES" as const };
  try {
    const raw = await requestModelJsonObject(
      connection,
      studyPlanSystemPrompt,
      context,
      { deadlineAt: Date.now() + 60_000 },
    );
    const normalized = raw
      ? normalizeModelPlan(raw, fallback, preferences, generatedAt)
      : null;
    if (!normalized) return { ...fallback, source: "DATA_RULES" as const };
    return {
      ...normalized.plan,
      source: normalized.repaired
        ? ("HYBRID_REPAIRED" as const)
        : ("MODEL_API" as const),
    };
  } catch {
    return { ...fallback, source: "DATA_RULES" as const };
  }
}

function rounded(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function performanceStats(
  attempts: {
    correct: boolean;
    duration: number;
    question: {
      type: string;
      difficultyScore: number;
      category: { name: string };
    };
  }[],
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
    adjustedAccuracy: rounded(((item.correct + 2) / (item.total + 4)) * 100),
    averageDurationSeconds: item.timed ? Math.round(item.duration / item.timed) : 0,
    averageDifficulty: rounded(item.difficulty / item.total),
  })).sort((left, right) => {
    const leftWeakness = (100 - left.adjustedAccuracy) * Math.log1p(left.total);
    const rightWeakness = (100 - right.adjustedAccuracy) * Math.log1p(right.total);
    return rightWeakness - leftWeakness;
  });
}

function periodStats(
  attempts: { correct: boolean; createdAt: Date }[],
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

function daysUntil(examDate?: string) {
  if (!examDate) return null;
  const date = new Date(`${examDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

export async function generateStudyPlan(
  userId: string,
  preferences: PlanPreferences = {},
  connection?: ModelConnection,
) {
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 86_400_000);
  const [
    totalAttempts,
    completedDailyPlans,
    attempts,
    recentReports,
    essaySubmissions,
    previousPlan,
    weeklyPlan,
    questionSubtypeCatalog,
  ] =
    await Promise.all([
      prisma.attempt.count({ where: { userId } }),
      prisma.studyPlan.count({
        where: { userId, schemaVersion: { gte: 5 }, completedAt: { not: null } },
      }),
      prisma.attempt.findMany({
        where: { userId, createdAt: { gte: ninetyDaysAgo } },
        orderBy: { createdAt: "desc" },
        take: 1_000,
        select: {
          correct: true,
          duration: true,
          mode: true,
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
          total: true,
          answered: true,
          accuracy: true,
          difficultyScore: true,
          durationSeconds: true,
          sections: true,
          completedAt: true,
        },
      }),
      prisma.essaySubmission.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { score: true, createdAt: true, question: { select: { type: true } } },
      }),
      prisma.studyPlan.findFirst({
        where: { userId, schemaVersion: { gte: 5 } },
        orderBy: { generatedAt: "desc" },
        select: { title: true, source: true, summary: true, tasks: true, generatedAt: true, inputSnapshot: true },
      }),
      prisma.weeklyStudyPlan.findFirst({
        where: { userId },
        orderBy: { generatedAt: "desc" },
        select: { title: true, summary: true, goals: true, strategy: true, generatedAt: true, expiresAt: true },
      }),
      prisma.question.findMany({
        where: { status: "PUBLISHED" },
        distinct: ["categoryId", "type"],
        select: { type: true, category: { select: { name: true } } },
      }),
    ]);

  const categories = performanceStats(attempts, (attempt) => attempt.question.category.name);
  const accuracyProfile: Partial<
    Record<CompletionModule, { accuracy: number; sampleSize: number }>
  > = {};
  const categoryModuleMap: Record<string, CompletionModule> = {
    常识判断: "常识判断",
    言语理解: "言语理解与表达",
    判断推理: "判断推理",
    资料分析: "资料分析",
    数量关系: "数量关系",
  };
  for (const category of categories) {
    const resolvedModule = categoryModuleMap[category.name];
    if (!resolvedModule) continue;
    accuracyProfile[resolvedModule] = {
      accuracy: category.accuracy,
      sampleSize: category.total,
    };
    if (resolvedModule === "常识判断") {
      accuracyProfile.政治理论 = accuracyProfile[resolvedModule];
    }
  }
  const subtypeStats = performanceStats(
    attempts,
    (attempt) => `${attempt.question.category.name} / ${attempt.question.type}`,
  );
  const subtypes = subtypeStats.slice(0, 24);
  const timingBenchmarks = buildSubtypeTimingBenchmarks(
    subtypeStats,
    questionSubtypeCatalog.map((item) => ({
      category: item.category.name,
      type: item.type,
    })),
  );
  const recent = periodStats(attempts, sevenDaysAgo, now);
  const previous = periodStats(attempts, fourteenDaysAgo, sevenDaysAgo);
  const rulePlan = buildRulePlan(
    categories,
    subtypes,
    totalAttempts,
    preferences,
    now,
    completedDailyPlans,
  );
  const fallbackSchedule = normalizeSchedule(
    rulePlan.tasks,
    rulePlan,
    preferences,
    now,
  );
  const fallback = { ...rulePlan, tasks: fallbackSchedule.tasks };
  const cleanPreferences = Object.fromEntries(
    Object.entries(preferences).filter(
      ([key, value]) => key !== "maxTaskMinutes" && value !== undefined,
    ),
  );
  const preferenceLabels = Object.fromEntries(
    Object.entries({
      examWindow: preferences.examWindow
        ? examWindowLabels[preferences.examWindow]
        : undefined,
      focusAreas: preferences.focusAreas?.map((area) => focusAreaLabels[area]),
      studyStatus: preferences.studyStatus
        ? studyStatusLabels[preferences.studyStatus]
        : undefined,
      activeWeekdays: preferences.activeWeekdays?.map(
        (day) => activeWeekdayLabels[day],
      ),
      studyWindows: preferences.studyWindows?.map(
        (window) => studyWindowLabels[window],
      ),
      learningGoal: preferences.learningGoal
        ? learningGoalLabels[preferences.learningGoal]
        : undefined,
      learningMethods: preferences.learningMethods?.map(
        (method) => learningMethodLabels[method],
      ),
      intensity: preferences.intensity
        ? intensityLabels[preferences.intensity]
        : undefined,
      mockExamPreference: preferences.mockExamPreference
        ? mockExamPreferenceLabels[preferences.mockExamPreference]
        : undefined,
      essayPreference: preferences.essayPreference
        ? essayPreferenceLabels[preferences.essayPreference]
        : undefined,
      acceptanceMethods: preferences.acceptanceMethods?.map(
        (method) => acceptanceMethodPreferenceLabels[method],
      ),
      constraints: preferences.constraints?.map(
        (constraint) => studyConstraintLabels[constraint],
      ),
    }).filter(([, value]) => value !== undefined),
  );
  const performance = {
    totalAttempts,
    sampledAttempts: attempts.length,
    accuracyBaselines: MODULE_ACCURACY_BASELINES,
    categories,
    subtypes,
    trend: {
      last7Days: recent,
      previous7Days: previous,
      accuracyChange:
        recent.accuracy !== null && previous.accuracy !== null
          ? rounded(recent.accuracy - previous.accuracy)
          : null,
    },
    recentReports: recentReports.map((report) => ({
      mode: report.mode,
      title: report.title,
      total: report.total,
      answered: report.answered,
      accuracy: report.accuracy,
      difficultyScore: report.difficultyScore,
      durationSeconds: report.durationSeconds,
      completedAt: report.completedAt.toISOString(),
      sections: Array.isArray(report.sections)
        ? report.sections.map((value) => {
            const section = record(value) || {};
            return {
              name: optionalText(section.name, 100),
              total: numberValue(section.total, 0, 0, 200),
              answered: numberValue(section.answered, 0, 0, 200),
              accuracy:
                section.accuracy === null
                  ? null
                  : numberValue(section.accuracy, 0, 0, 100),
              durationSeconds: numberValue(section.durationSeconds, 0, 0, 28_800),
              difficultyScore: numberValue(section.difficultyScore, 5, 1, 10),
            };
          })
        : [],
    })),
    essay: {
      submissions: essaySubmissions.length,
      averageScore: essaySubmissions.length
        ? rounded(
            essaySubmissions.reduce((sum, item) => sum + item.score, 0) /
              essaySubmissions.length,
          )
        : null,
      recent: essaySubmissions.map((item) => ({
        type: item.question.type,
        score: item.score,
        createdAt: item.createdAt.toISOString(),
      })),
    },
  };
  const previousTasks = Array.isArray(previousPlan?.tasks)
    ? previousPlan.tasks.slice(0, 21)
    : [];
  const context = {
    generatedAt: now.toISOString(),
    period: "当前单日任务",
    dailySequence: completedDailyPlans,
    scheduledSpecialTasks: fallback.tasks
      .filter((task) => task.type === "EXAM" || task.type === "ESSAY")
      .map((task) => task.type),
    daysUntilExam: daysUntil(preferences.examDate),
    preferences: cleanPreferences,
    preferenceLabels,
    performance,
    timingBenchmarks,
    previousPlan: previousPlan
      ? {
          title: previousPlan.title,
          source: previousPlan.source,
          summary: previousPlan.summary,
          tasks: previousTasks,
          generatedAt: previousPlan.generatedAt.toISOString(),
          preferences: record(previousPlan.inputSnapshot)?.preferences || null,
        }
      : null,
    weeklyPlan: weeklyPlan
      ? {
          title: weeklyPlan.title,
          summary: weeklyPlan.summary,
          goals: weeklyPlan.goals,
          strategy: weeklyPlan.strategy,
          generatedAt: weeklyPlan.generatedAt.toISOString(),
          expiresAt: weeklyPlan.expiresAt.toISOString(),
        }
      : null,
  };
  const generated = await tryModelPlan(
    context,
    fallback,
    preferences,
    connection || (await getEffectiveModelConnection()),
    now,
  );
  const expiresAt = new Date(now);
  expiresAt.setHours(expiresAt.getHours() + 24);
  const target = preferences.targetExam?.trim() || "公考";
  const timingAligned = alignQuestionTaskTiming(
    generated.tasks,
    timingBenchmarks,
    preferences,
  );
  const finalSchedule = normalizeSchedule(
    timingAligned,
    fallback,
    preferences,
    now,
  );
  const finalTimedTasks = alignQuestionTaskTiming(
    finalSchedule.tasks,
    timingBenchmarks,
    preferences,
    true,
  );
  const executableTasks = applyPreferredCompletionSpecs(
    finalTimedTasks,
    preferences,
    accuracyProfile,
  );
  const storedTasks = executableTasks.map((task, index) => ({
    ...task,
    id: `task-${String(index + 1).padStart(2, "0")}`,
  }));
  return prisma.studyPlan.create({
    data: {
      userId,
      title: `${target} · 每日任务`,
      source: generated.source,
      summary: generated.summary,
      tasks: storedTasks,
      strategy: generated.strategy,
      schemaVersion: 5,
      inputSnapshot: context,
      generationMeta: {
        source: generated.source,
        dataWindowDays: 90,
        sampledAttempts: attempts.length,
        generatedAt: now.toISOString(),
      },
      expiresAt,
    },
  });
}

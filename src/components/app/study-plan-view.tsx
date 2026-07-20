"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Gauge,
  Play,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  ShieldCheck,
  Target,
} from "lucide-react";
import { syncStudyPlanToAndroid } from "@/lib/android-study-plan-bridge";
import {
  acceptanceMethodPreferenceLabels,
  acceptanceMethodPreferenceValues,
  activeWeekdayValues,
  dailyMinutePresets,
  essayPreferenceLabels,
  essayPreferenceValues,
  examWindowLabels,
  examWindowValues,
  focusAreaLabels,
  focusAreaValues,
  intensityLabels,
  intensityValues,
  learningGoalLabels,
  learningGoalValues,
  learningMethodLabels,
  learningMethodValues,
  mockExamPreferenceLabels,
  mockExamPreferenceValues,
  studyConstraintLabels,
  studyConstraintValues,
  studyStatusLabels,
  studyStatusValues,
  studyWindowLabels,
  studyWindowValues,
  targetExamPresetOptions,
  weekdayOptions,
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
import type {
  StudyPlan,
  StudyPlanCheckIn,
  StudyPlanEvidence,
  StudyPlanLaunchContext,
  StudyPlanPreferences,
  StudyPlanTask,
} from "./types";
import { EmptyState, LoadingState, PageTitle } from "./ui";

type TargetExamChoice = (typeof targetExamPresetOptions)[number]["value"];
type ChoiceValue = string | number;
type ChoiceOption<T extends ChoiceValue> = { value: T; label: string };

type StudyPlanForm = {
  targetExamChoice: TargetExamChoice;
  customTargetExam: string;
  examWindow: ExamWindow;
  examDate: string;
  dailyMinutes: number;
  studyStatus: StudyStatus;
  activeWeekdays: ActiveWeekday[];
  studyWindows: StudyWindow[];
  focusAreas: FocusArea[];
  learningGoal: LearningGoal;
  learningMethods: LearningMethod[];
  intensity: StudyIntensity;
  mockExamPreference: MockExamPreference;
  essayPreference: EssayPreference;
  minTasksPerDay: string;
  maxTasksPerDay: string;
  maxQuestionsPerTask: string;
  acceptanceMethods: AcceptanceMethodPreference[];
  constraints: StudyConstraint[];
  notes: string;
};

type ProgramAcceptanceDetails = {
  evidenceId?: string;
  criteria?: unknown;
  actual?: unknown;
  gaps?: unknown;
};

type ProgramVerificationState = {
  loading: boolean;
  evidence: StudyPlanEvidence | null;
  error: string;
};

type ProgramVerificationResult =
  | { status: "PASSED"; checkIn: StudyPlanCheckIn }
  | { status: "NOT_MET"; details: ProgramAcceptanceDetails; message: string }
  | { status: "NO_EVIDENCE"; message: string };

const examWindowOptions = examWindowValues.map((value) => ({
  value,
  label: examWindowLabels[value],
}));
const focusAreaOptions = focusAreaValues.map((value) => ({
  value,
  label: focusAreaLabels[value],
}));
const studyStatusOptions = studyStatusValues.map((value) => ({
  value,
  label: studyStatusLabels[value],
}));
const studyWindowOptions = studyWindowValues.map((value) => ({
  value,
  label: studyWindowLabels[value],
}));
const learningGoalOptions = learningGoalValues.map((value) => ({
  value,
  label: learningGoalLabels[value],
}));
const learningMethodOptions = learningMethodValues.map((value) => ({
  value,
  label: learningMethodLabels[value],
}));
const intensityOptions = intensityValues.map((value) => ({
  value,
  label: intensityLabels[value],
}));
const mockExamOptions = mockExamPreferenceValues.map((value) => ({
  value,
  label: mockExamPreferenceLabels[value],
}));
const essayOptions = essayPreferenceValues.map((value) => ({
  value,
  label: essayPreferenceLabels[value],
}));
const constraintOptions = studyConstraintValues.map((value) => ({
  value,
  label: studyConstraintLabels[value],
}));
const acceptanceMethodOptions = acceptanceMethodPreferenceValues.map((value) => ({
  value,
  label: acceptanceMethodPreferenceLabels[value],
}));
const dailyMinuteOptions = dailyMinutePresets.map((value) => ({
  value,
  label: `${value} 分钟`,
}));

const typeLabels: Record<string, string> = {
  ASSESSMENT: "诊断测评",
  KNOWLEDGE: "知识方法",
  PRACTICE: "专项练习",
  TIMED_PRACTICE: "限时题组",
  WRONG: "错题复习",
  EXAM: "模拟考试",
  ESSAY: "申论训练",
  REVIEW: "总结复盘",
  REST: "休整缓冲",
};

const priorityLabels = {
  HIGH: { label: "高优先", className: "bg-red-50 text-red-700" },
  MEDIUM: { label: "中优先", className: "bg-amber-50 text-amber-700" },
  LOW: { label: "低优先", className: "bg-slate-100 text-slate-600" },
} as const;

function sourceLabel(source: string) {
  if (source === "MODEL_API") return "模型自主规划";
  if (source === "HYBRID_REPAIRED") return "模型规划 · 系统补全";
  if (source === "OPENAI") return "模型增强规划";
  return "数据规则规划";
}

function groupTasks(tasks: StudyPlanTask[]) {
  const groups = new Map<
    number,
    { task: StudyPlanTask; taskIndex: number }[]
  >();
  for (const [taskIndex, task] of tasks.entries()) {
    groups.set(task.day, [
      ...(groups.get(task.day) || []),
      { task, taskIndex },
    ]);
  }
  return Array.from(groups, ([day, items]) => ({ day, items })).sort(
    (left, right) => left.day - right.day,
  );
}

function taskKeyFor(task: StudyPlanTask, taskIndex: number) {
  return task.id && /^[A-Za-z0-9._:@-]{1,100}$/.test(task.id)
    ? task.id
    : `legacy-${String(taskIndex + 1).padStart(2, "0")}`;
}

function isRestTask(task: StudyPlanTask) {
  return String(task.type || "").toUpperCase() === "REST";
}

function isProgramTask(task: StudyPlanTask, schemaVersion?: number) {
  return (schemaVersion || 0) >= 4 && task.completionSpec?.method === "PROGRAM";
}

function verificationKey(taskIndex: number, taskKey: string) {
  return `${taskIndex}:${taskKey}`;
}

async function fetchProgramEvidence(
  planId: string,
  taskIndex: number,
  taskKey: string,
) {
  const params = new URLSearchParams({
    planId,
    taskKey,
    taskIndex: String(taskIndex),
  });
  const response = await fetch(`/api/study-plan/check-ins/verify?${params}`);
  const body = (await response.json().catch(() => null)) as {
    data?: {
      evidence?: StudyPlanEvidence | null;
      checkIn?: StudyPlanCheckIn | null;
    };
    error?: { message?: string };
  } | null;
  if (!response.ok)
    throw new Error(body?.error?.message || "验收记录读取失败");
  return {
    evidence: body?.data?.evidence || null,
    checkIn: body?.data?.checkIn || null,
  };
}

function listedValue<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function listedValues<T extends string>(
  values: readonly T[],
  input: unknown,
  max = values.length,
) {
  if (!Array.isArray(input)) return [] as T[];
  return Array.from(
    new Set(input.filter((value): value is T => listedValue(values, value))),
  ).slice(0, max);
}

function nearestPreset(value: unknown, presets: readonly number[], fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return presets.reduce((nearest, option) =>
    Math.abs(option - value) < Math.abs(nearest - value) ? option : nearest,
  );
}

function resolveTargetExam(targetExam?: string | null) {
  const value = targetExam?.trim();
  if (!value) {
    return {
      targetExamChoice: targetExamPresetOptions[0].value,
      customTargetExam: "",
    };
  }
  const direct = targetExamPresetOptions.find(
    (option) => option.value !== "OTHER" && option.value === value,
  );
  if (direct)
    return { targetExamChoice: direct.value, customTargetExam: "" };
  if (/广东/.test(value))
    return { targetExamChoice: "广东省公务员考试" as const, customTargetExam: "" };
  if (/副省/.test(value))
    return { targetExamChoice: "国家公务员考试（副省级）" as const, customTargetExam: "" };
  if (/国考|国家公务员/.test(value))
    return { targetExamChoice: "国家公务员考试（地市级）" as const, customTargetExam: "" };
  if (/事业单位/.test(value))
    return { targetExamChoice: "事业单位考试" as const, customTargetExam: "" };
  if (/选调/.test(value))
    return { targetExamChoice: "选调生考试" as const, customTargetExam: "" };
  if (/省考|省公务员/.test(value))
    return { targetExamChoice: "其他省公务员考试" as const, customTargetExam: "" };
  if (/未确定|待定/.test(value))
    return { targetExamChoice: "暂未确定" as const, customTargetExam: "" };
  return { targetExamChoice: "OTHER" as const, customTargetExam: value };
}

function legacyStudyStatus(value?: string): StudyStatus {
  if (!value) return "AUTO";
  if (/零基础/.test(value)) return "BEGINNER";
  if (/强化/.test(value)) return "REINFORCEMENT";
  if (/套卷/.test(value)) return "MOCK_IMPROVEMENT";
  if (/冲刺/.test(value)) return "SPRINT";
  if (/二次|再考/.test(value)) return "RETAKE";
  if (/基础/.test(value)) return "FOUNDATION";
  return "AUTO";
}

function legacyFocusArea(value?: string): FocusArea {
  if (!value) return "AUTO";
  if (/政治/.test(value)) return "政治理论";
  if (/常识/.test(value)) return "常识判断";
  if (/言语/.test(value)) return "言语理解与表达";
  if (/数量/.test(value)) return "数量关系";
  if (/资料/.test(value)) return "资料分析";
  if (/申论/.test(value)) return "申论";
  if (/判断|图形|定义|逻辑|类比/.test(value)) return "判断推理";
  return "AUTO";
}

function createInitialForm(targetExam?: string | null): StudyPlanForm {
  return {
    ...resolveTargetExam(targetExam),
    examWindow: "UNKNOWN",
    examDate: "",
    dailyMinutes: 60,
    studyStatus: "AUTO",
    activeWeekdays: ["MON", "TUE", "WED", "THU", "FRI", "SAT"],
    studyWindows: ["WEEKDAY_EVENING", "WEEKEND_MORNING"],
    focusAreas: ["AUTO"],
    learningGoal: "WEAKNESSES",
    learningMethods: [
      "SECTION_PRACTICE",
      "TIMED_SETS",
      "WRONG_QUESTION_DRIVEN",
    ],
    intensity: "BALANCED",
    mockExamPreference: "WEEKLY",
    essayPreference: "WEEKLY",
    minTasksPerDay: "2",
    maxTasksPerDay: "4",
    maxQuestionsPerTask: "20",
    acceptanceMethods: ["SYSTEM", "SELF"],
    constraints: [],
    notes: "",
  };
}

function restoreForm(
  current: StudyPlanForm,
  preferences: StudyPlanPreferences,
): StudyPlanForm {
  const storedWeekdays = listedValues(
    activeWeekdayValues,
    preferences.activeWeekdays,
  );
  const legacyWeekdayCount =
    typeof preferences.weeklyDays === "number"
      ? Math.max(1, Math.min(7, Math.round(preferences.weeklyDays)))
      : 0;
  const storedFocusAreas = listedValues(
    focusAreaValues,
    preferences.focusAreas,
    3,
  );
  const normalizedFocusAreas = storedFocusAreas.includes("AUTO")
    ? storedFocusAreas.length === 1
      ? (["AUTO"] as FocusArea[])
      : storedFocusAreas.filter((value) => value !== "AUTO")
    : storedFocusAreas;
  const studyWindows = listedValues(
    studyWindowValues,
    preferences.studyWindows,
  );
  const learningMethods = listedValues(
    learningMethodValues,
    preferences.learningMethods,
    4,
  );
  const constraints = listedValues(
    studyConstraintValues,
    preferences.constraints,
    4,
  );

  return {
    ...current,
    ...(preferences.targetExam
      ? resolveTargetExam(preferences.targetExam)
      : {}),
    examWindow: listedValue(examWindowValues, preferences.examWindow)
      ? preferences.examWindow
      : preferences.examDate
        ? "FIXED_DATE"
        : current.examWindow,
    examDate: preferences.examDate || "",
    dailyMinutes: nearestPreset(
      preferences.dailyMinutes,
      dailyMinutePresets,
      current.dailyMinutes,
    ),
    studyStatus: listedValue(studyStatusValues, preferences.studyStatus)
      ? preferences.studyStatus
      : legacyStudyStatus(preferences.currentLevel),
    activeWeekdays: storedWeekdays.length
      ? storedWeekdays
      : legacyWeekdayCount
        ? [...activeWeekdayValues.slice(0, legacyWeekdayCount)]
        : current.activeWeekdays,
    studyWindows: studyWindows.length ? studyWindows : current.studyWindows,
    focusAreas: normalizedFocusAreas.length
      ? normalizedFocusAreas
      : [legacyFocusArea(preferences.focus)],
    learningGoal: listedValue(learningGoalValues, preferences.learningGoal)
      ? preferences.learningGoal
      : current.learningGoal,
    learningMethods: learningMethods.length
      ? learningMethods
      : current.learningMethods,
    intensity: listedValue(intensityValues, preferences.intensity)
      ? preferences.intensity
      : current.intensity,
    mockExamPreference: listedValue(
      mockExamPreferenceValues,
      preferences.mockExamPreference,
    )
      ? preferences.mockExamPreference
      : current.mockExamPreference,
    essayPreference: listedValue(
      essayPreferenceValues,
      preferences.essayPreference,
    )
      ? preferences.essayPreference
      : current.essayPreference,
    minTasksPerDay:
      typeof preferences.minTasksPerDay === "number" &&
      Number.isFinite(preferences.minTasksPerDay)
        ? String(Math.max(1, Math.min(21, Math.round(preferences.minTasksPerDay))))
        : current.minTasksPerDay,
    maxTasksPerDay:
      preferences.maxTasksPerDay === null
        ? ""
        : typeof preferences.maxTasksPerDay === "number" &&
            Number.isFinite(preferences.maxTasksPerDay)
          ? String(Math.max(1, Math.min(21, Math.round(preferences.maxTasksPerDay))))
          : current.maxTasksPerDay,
    maxQuestionsPerTask:
      typeof preferences.maxQuestionsPerTask === "number" &&
      Number.isFinite(preferences.maxQuestionsPerTask)
        ? String(
            Math.max(
              5,
              Math.min(100, Math.round(preferences.maxQuestionsPerTask)),
            ),
          )
        : current.maxQuestionsPerTask,
    acceptanceMethods: listedValues(
      acceptanceMethodPreferenceValues,
      preferences.acceptanceMethods,
      2,
    ).length
      ? listedValues(
          acceptanceMethodPreferenceValues,
          preferences.acceptanceMethods,
          2,
        )
      : current.acceptanceMethods,
    constraints,
    notes: preferences.notes || "",
  };
}

function toggleSelection<T>(
  values: T[],
  value: T,
  options: { max?: number; keepOne?: boolean } = {},
) {
  if (values.includes(value)) {
    if (options.keepOne && values.length === 1) return values;
    return values.filter((item) => item !== value);
  }
  if (options.max && values.length >= options.max) return values;
  return [...values, value];
}

export function StudyPlanView({
  userId,
  targetExam,
  activeContext,
  onStartTask,
  onTaskAccepted,
}: {
  userId: string;
  targetExam?: string | null;
  activeContext?: StudyPlanLaunchContext | null;
  onStartTask?: (context: StudyPlanLaunchContext) => void;
  onTaskAccepted?: (planId: string, taskKey: string) => void;
}) {
  const [plan, setPlan] = useState<StudyPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState("");
  const [verificationStates, setVerificationStates] = useState<
    Record<string, ProgramVerificationState>
  >({});
  const [showForm, setShowForm] = useState(true);
  const [form, setForm] = useState<StudyPlanForm>(() =>
    createInitialForm(targetExam),
  );

  const load = async () => {
    try {
      const response = await fetch("/api/study-plan");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "计划加载失败");
      const latestPlan = body.data as StudyPlan | null;
      setPlan(latestPlan);
      if (latestPlan) {
        const preferences = latestPlan.inputSnapshot?.preferences;
        if (preferences)
          setForm((current) => restoreForm(current, preferences));
        setShowForm(false);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "计划加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    queueMicrotask(() => void load());
  }, []);

  useEffect(() => {
    if (plan) syncStudyPlanToAndroid(plan, userId);
  }, [plan, userId]);

  const programTaskSignature = plan
    ? `${plan.id}|${plan.tasks
        .map((task, taskIndex) =>
          isProgramTask(task, plan.schemaVersion)
            ? `${taskIndex}:${taskKeyFor(task, taskIndex)}`
            : "",
        )
        .filter(Boolean)
        .join("|")}`
    : "";

  useEffect(() => {
    if (!plan) return;
    const planId = plan.id;
    const tasks = plan.tasks
      .map((task, taskIndex) => ({
        task,
        taskIndex,
        taskKey: taskKeyFor(task, taskIndex),
      }))
      .filter(({ task }) => isProgramTask(task, plan.schemaVersion));
    if (!tasks.length) {
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setVerificationStates(
        Object.fromEntries(
          tasks.map(({ taskIndex, taskKey }) => [
            verificationKey(taskIndex, taskKey),
            { loading: true, evidence: null, error: "" },
          ]),
        ),
      );
    });
    void Promise.all(
      tasks.map(async ({ taskIndex, taskKey }) => {
        try {
          const result = await fetchProgramEvidence(planId, taskIndex, taskKey);
          return { taskIndex, taskKey, ...result, error: "" };
        } catch (reason) {
          return {
            taskIndex,
            taskKey,
            evidence: null,
            checkIn: null,
            error:
              reason instanceof Error ? reason.message : "验收记录读取失败",
          };
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setVerificationStates(
        Object.fromEntries(
          results.map((item) => [
            verificationKey(item.taskIndex, item.taskKey),
            { loading: false, evidence: item.evidence, error: item.error },
          ]),
        ),
      );
      const restored = results
        .map((item) => item.checkIn)
        .filter((item): item is StudyPlanCheckIn => Boolean(item));
      if (restored.length)
        setPlan((current) => {
          if (!current || current.id !== planId) return current;
          const changed = restored.some((item) => {
            const existing = (current.checkIns || []).find(
              (candidate) => candidate.taskIndex === item.taskIndex,
            );
            return (
              !existing ||
              existing.id !== item.id ||
              existing.specHash !== item.specHash ||
              existing.acceptanceMethod !== item.acceptanceMethod
            );
          });
          if (!changed) return current;
          const restoredIndexes = new Set(restored.map((item) => item.taskIndex));
          return {
            ...current,
            checkIns: [
              ...(current.checkIns || []).filter(
                (item) => !restoredIndexes.has(item.taskIndex),
              ),
              ...restored,
            ].sort((left, right) => left.taskIndex - right.taskIndex),
          };
        });
    });
    return () => {
      cancelled = true;
    };
  }, [plan, programTaskSignature]);

  const toggleFocusArea = (value: FocusArea) => {
    setForm((current) => {
      if (value === "AUTO") return { ...current, focusAreas: ["AUTO"] };
      const explicitAreas = current.focusAreas.filter(
        (area) => area !== "AUTO",
      );
      const next = toggleSelection(explicitAreas, value, {
        max: 3,
        keepOne: false,
      });
      return { ...current, focusAreas: next.length ? next : ["AUTO"] };
    });
  };

  const toggleWeekday = (value: ActiveWeekday) => {
    setForm((current) => {
      const next = toggleSelection(current.activeWeekdays, value, {
        keepOne: true,
      });
      return {
        ...current,
        activeWeekdays: activeWeekdayValues.filter((day) =>
          next.includes(day),
        ),
      };
    });
  };

  const generate = async () => {
    const selectedTargetExam =
      form.targetExamChoice === "OTHER"
        ? form.customTargetExam.trim()
        : form.targetExamChoice;
    if (!selectedTargetExam) {
      setError("请输入其他考试名称");
      return;
    }
    if (form.examWindow === "FIXED_DATE" && !form.examDate) {
      setError("请选择考试日期");
      return;
    }
    const minTasksPerDay = Number(form.minTasksPerDay);
    const maxTasksPerDay = form.maxTasksPerDay.trim() === ""
      ? null
      : Number(form.maxTasksPerDay);
    const maxQuestionsPerTask = Number(form.maxQuestionsPerTask);
    if (
      !Number.isInteger(minTasksPerDay) || minTasksPerDay < 1 || minTasksPerDay > 21 ||
      (maxTasksPerDay !== null &&
        (!Number.isInteger(maxTasksPerDay) || maxTasksPerDay < 1 || maxTasksPerDay > 21)) ||
      (maxTasksPerDay !== null && minTasksPerDay > maxTasksPerDay)
    ) {
      setError("每日任务范围需为 1～21 的整数；最多留空表示不限制");
      return;
    }
    if (
      !Number.isInteger(maxQuestionsPerTask) ||
      maxQuestionsPerTask < 5 ||
      maxQuestionsPerTask > 100
    ) {
      setError("单任务最大题量请输入 5～100 的整数");
      return;
    }
    setGenerating(true);
    setError("");
    try {
      const response = await fetch("/api/study-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetExam: selectedTargetExam,
          examWindow: form.examWindow,
          examDate:
            form.examWindow === "FIXED_DATE"
              ? form.examDate
              : undefined,
          dailyMinutes: form.dailyMinutes,
          weeklyDays: form.activeWeekdays.length,
          currentLevel:
            form.studyStatus === "AUTO"
              ? undefined
              : studyStatusLabels[form.studyStatus],
          focus:
            form.focusAreas[0] === "AUTO" ? undefined : form.focusAreas[0],
          notes: form.notes.trim() || undefined,
          studyStatus: form.studyStatus,
          activeWeekdays: form.activeWeekdays,
          studyWindows: form.studyWindows,
          focusAreas: form.focusAreas,
          learningGoal: form.learningGoal,
          learningMethods: form.learningMethods,
          intensity: form.intensity,
          mockExamPreference: form.mockExamPreference,
          essayPreference: form.essayPreference,
          minTasksPerDay,
          maxTasksPerDay,
          maxQuestionsPerTask,
          acceptanceMethods: form.acceptanceMethods,
          constraints: form.constraints,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "计划生成失败");
      setPlan(body.data);
      setShowForm(false);
      window.scrollTo({ top: 0 });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "计划生成失败");
    } finally {
      setGenerating(false);
    }
  };

  const advancePlan = async (planId: string) => {
    if (advancing) return false;
    setAdvancing(true);
    try {
      const response = await fetch("/api/study-plan/advance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message || "下一份每日任务生成失败");
      if (!body.data?.completed) return false;
      const refreshed = await fetch("/api/study-plan");
      const refreshedBody = await refreshed.json();
      if (!refreshed.ok || !refreshedBody.data)
        throw new Error(refreshedBody.error?.message || "下一份每日任务读取失败");
      setPlan(refreshedBody.data as StudyPlan);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "下一份每日任务生成失败");
      return false;
    } finally {
      setAdvancing(false);
    }
  };

  const completeTask = async (taskIndex: number, taskKey: string) => {
    if (!plan) throw new Error("计划尚未加载");
    const response = await fetch("/api/study-plan/check-ins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planId: plan.id,
        taskKey,
        taskIndex,
        confirmations: { taskCompleted: true, checkpointMet: true },
      }),
    });
    const body = await response.json();
    if (!response.ok)
      throw new Error(body.error?.message || "任务打卡失败，请稍后重试");
    const checkIn = body.data as StudyPlanCheckIn;
    setPlan((current) => {
      if (!current || current.id !== checkIn.planId) return current;
      const next = [
        ...(current.checkIns || []).filter(
          (item) => item.taskIndex !== checkIn.taskIndex,
        ),
        checkIn,
      ].sort((left, right) => left.taskIndex - right.taskIndex);
      return { ...current, checkIns: next };
    });
    await advancePlan(plan.id);
  };

  const startProgramTask = (
    task: StudyPlanTask,
    taskIndex: number,
    taskKey: string,
  ) => {
    if (
      !plan ||
      !isProgramTask(task, plan.schemaVersion) ||
      task.completionSpec?.method !== "PROGRAM"
    )
      return;
    onStartTask?.({
      planId: plan.id,
      taskKey,
      taskIndex,
      taskTitle: task.title,
      taskType: task.type,
      completionSpec: task.completionSpec,
      evidenceId: null,
    });
  };

  const verifyProgramTask = async (
    taskIndex: number,
    taskKey: string,
  ): Promise<ProgramVerificationResult> => {
    if (!plan) throw new Error("计划尚未加载");
    const planId = plan.id;
    const key = verificationKey(taskIndex, taskKey);
    let evidence = verificationStates[key]?.evidence || null;
    const completedEvidenceId =
      activeContext?.planId === planId &&
      activeContext.taskKey === taskKey &&
      activeContext.taskIndex === taskIndex
        ? activeContext.evidenceId || null
        : null;
    if (!evidence && !completedEvidenceId) {
      const refreshed = await fetchProgramEvidence(planId, taskIndex, taskKey);
      evidence = refreshed.evidence;
      setVerificationStates((current) => ({
        ...current,
        [key]: { loading: false, evidence, error: "" },
      }));
      if (refreshed.checkIn) {
        setPlan((current) => {
          if (!current || current.id !== planId) return current;
          return {
            ...current,
            checkIns: [
              ...(current.checkIns || []).filter(
                (item) => item.taskIndex !== taskIndex,
              ),
              refreshed.checkIn!,
            ].sort((left, right) => left.taskIndex - right.taskIndex),
          };
        });
        onTaskAccepted?.(planId, taskKey);
        await advancePlan(planId);
        return { status: "PASSED", checkIn: refreshed.checkIn };
      }
    }
    const evidenceId = completedEvidenceId || evidence?.id || null;
    if (!evidenceId)
      return {
        status: "NO_EVIDENCE",
        message: "尚未找到该任务的训练记录，请先开始并完成任务。",
      };

    const response = await fetch("/api/study-plan/check-ins/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planId,
        taskKey,
        taskIndex,
        evidenceId,
      }),
    });
    const body = (await response.json().catch(() => null)) as {
      data?: StudyPlanCheckIn;
      error?: {
        code?: string;
        message?: string;
        details?: ProgramAcceptanceDetails;
      };
    } | null;
    if (response.status === 422 && body?.error?.code === "ACCEPTANCE_NOT_MET")
      return {
        status: "NOT_MET",
        details: body.error.details || {},
        message: body.error.message || "本次训练尚未达到完成标准",
      };
    if (!response.ok || !body?.data)
      throw new Error(body?.error?.message || "系统验收失败，请稍后重试");
    const checkIn = body.data;
    setPlan((current) => {
      if (!current || current.id !== planId) return current;
      return {
        ...current,
        checkIns: [
          ...(current.checkIns || []).filter(
            (item) => item.taskIndex !== taskIndex,
          ),
          checkIn,
        ].sort((left, right) => left.taskIndex - right.taskIndex),
      };
    });
    onTaskAccepted?.(planId, taskKey);
    await advancePlan(planId);
    return { status: "PASSED", checkIn };
  };

  const undoTask = async (taskIndex: number, taskKey: string) => {
    if (!plan) throw new Error("计划尚未加载");
    const planId = plan.id;
    const response = await fetch("/api/study-plan/check-ins", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId, taskKey, taskIndex }),
    });
    const body = await response.json();
    if (!response.ok)
      throw new Error(body.error?.message || "撤销打卡失败，请稍后重试");
    setPlan((current) =>
      current?.id === planId
        ? {
            ...current,
            checkIns: (current.checkIns || []).filter(
              (item) => item.taskIndex !== taskIndex,
            ),
          }
        : current,
    );
  };

  const groups = groupTasks(plan?.tasks || []);
  const totalMinutes = (plan?.tasks || []).reduce(
    (sum, task) => sum + task.minutes,
    0,
  );
  const completedTaskIndexes = new Set(
    (plan?.checkIns || []).map((item) => item.taskIndex),
  );
  const checkableTasks = (plan?.tasks || []).filter(
    (task) => !isRestTask(task),
  );
  const completedTaskCount = (plan?.checkIns || []).filter((checkIn) => {
    const task = plan?.tasks[checkIn.taskIndex];
    return task && !isRestTask(task);
  }).length;

  if (loading) return <LoadingState text="正在读取学习计划…" />;
  return (
    <div className="fade">
      <div className="mobile-stack flex items-start justify-between gap-4">
        <PageTitle
          title="每日任务"
          description="依据一周阶段目标、近期表现、做题记录和个人设置，滚动生成当前一天的任务。"
        />
        <button
          type="button"
          onClick={() => setShowForm((current) => !current)}
          className="btn-ghost mobile-full flex shrink-0 items-center justify-center gap-2"
        >
          <SlidersHorizontal size={16} aria-hidden="true" />
          {showForm ? "收起设置" : "调整设置"}
        </button>
      </div>
      {error && (
        <div role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {error}
        </div>
      )}
      {advancing && (
        <div className="mb-4 rounded-lg bg-indigo-50 p-3 text-sm text-indigo-700">
          本次计划已完成，正在生成下一份每日任务…
        </div>
      )}
      {showForm && (
        <form
          data-testid="study-plan-form"
          className="card mb-6 overflow-hidden"
          onSubmit={(event) => {
            event.preventDefault();
            void generate();
          }}
        >
          <div className="px-4 py-5 sm:px-7 sm:py-6">
            <h2 className="font-bold text-slate-900">个性化信息</h2>
          </div>

          <section
            className="border-t border-slate-200 px-4 py-6 sm:px-7"
            aria-labelledby="plan-exam-settings"
          >
            <SectionHeading id="plan-exam-settings" index="01" title="考试目标" />
            <div className="mt-5 grid min-w-0 gap-6 xl:grid-cols-2">
              <RadioChoices
                name="target-exam"
                legend="目标考试"
                value={form.targetExamChoice}
                options={targetExamPresetOptions}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    targetExamChoice: value,
                    customTargetExam:
                      value === "OTHER" ? current.customTargetExam : "",
                  }))
                }
              />
              <RadioChoices
                name="exam-window"
                legend="考试周期"
                value={form.examWindow}
                options={examWindowOptions}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    examWindow: value,
                    examDate: value === "FIXED_DATE" ? current.examDate : "",
                  }))
                }
              />
            </div>
            {(form.targetExamChoice === "OTHER" ||
              form.examWindow === "FIXED_DATE") && (
              <div className="mt-5 grid min-w-0 gap-4 sm:grid-cols-2">
                {form.targetExamChoice === "OTHER" && (
                  <label className="min-w-0 text-sm font-semibold text-slate-700">
                    其他考试名称
                    <input
                      value={form.customTargetExam}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          customTargetExam: event.target.value,
                        }))
                      }
                      maxLength={80}
                      autoComplete="off"
                      className="field font-normal"
                    />
                  </label>
                )}
                {form.examWindow === "FIXED_DATE" && (
                  <label className="min-w-0 text-sm font-semibold text-slate-700">
                    考试日期
                    <input
                      type="date"
                      value={form.examDate}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          examDate: event.target.value,
                        }))
                      }
                      className="field font-normal"
                    />
                  </label>
                )}
              </div>
            )}
            <div className="mt-6">
              <RadioChoices
                name="study-status"
                legend="当前阶段"
                value={form.studyStatus}
                options={studyStatusOptions}
                onChange={(value) =>
                  setForm((current) => ({ ...current, studyStatus: value }))
                }
              />
            </div>
          </section>

          <section
            className="border-t border-slate-200 bg-slate-50/55 px-4 py-6 sm:px-7"
            aria-labelledby="plan-time-settings"
          >
            <SectionHeading id="plan-time-settings" index="02" title="时间安排" />
            <div className="mt-5 grid min-w-0 gap-6 xl:grid-cols-2">
              <RadioChoices
                name="daily-minutes"
                legend="每日学习分钟"
                value={form.dailyMinutes}
                options={dailyMinuteOptions}
                onChange={(value) =>
                  setForm((current) => ({ ...current, dailyMinutes: value }))
                }
              />
              <CheckboxChoices
                legend="每周学习日"
                values={form.activeWeekdays}
                options={weekdayOptions}
                onChange={toggleWeekday}
              />
            </div>
            <div className="mt-6">
              <CheckboxChoices
                legend="常用学习时段"
                values={form.studyWindows}
                options={studyWindowOptions}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    studyWindows: toggleSelection(
                      current.studyWindows,
                      value,
                      { keepOne: true },
                    ),
                  }))
                }
              />
            </div>
          </section>

          <section
            className="border-t border-slate-200 px-4 py-6 sm:px-7"
            aria-labelledby="plan-training-settings"
          >
            <SectionHeading id="plan-training-settings" index="03" title="训练重点" />
            <div className="mt-5">
              <CheckboxChoices
                legend="优先提升板块（最多3项，按选择顺序）"
                values={form.focusAreas}
                options={focusAreaOptions}
                onChange={toggleFocusArea}
                disabled={(value) =>
                  value !== "AUTO" &&
                  !form.focusAreas.includes(value) &&
                  form.focusAreas.filter((area) => area !== "AUTO").length >= 3
                }
                badge={(value) => {
                  if (value === "AUTO") return undefined;
                  const index = form.focusAreas.indexOf(value);
                  return index >= 0 ? `优先 ${index + 1}` : undefined;
                }}
              />
            </div>
            <div className="mt-6 grid min-w-0 gap-6 xl:grid-cols-2">
              <RadioChoices
                name="learning-goal"
                legend="主要提升目标"
                value={form.learningGoal}
                options={learningGoalOptions}
                onChange={(value) =>
                  setForm((current) => ({ ...current, learningGoal: value }))
                }
              />
              <CheckboxChoices
                legend="偏好训练方式（最多4项）"
                values={form.learningMethods}
                options={learningMethodOptions}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    learningMethods: toggleSelection(
                      current.learningMethods,
                      value,
                      { max: 4, keepOne: true },
                    ),
                  }))
                }
                disabled={(value) =>
                  !form.learningMethods.includes(value) &&
                  form.learningMethods.length >= 4
                }
              />
            </div>
          </section>

          <section
            className="border-t border-slate-200 bg-slate-50/55 px-4 py-6 sm:px-7"
            aria-labelledby="plan-preference-settings"
          >
            <SectionHeading id="plan-preference-settings" index="04" title="偏好限制" />
            <div className="mt-5 grid min-w-0 gap-6 xl:grid-cols-2">
              <RadioChoices
                name="study-intensity"
                legend="训练强度"
                value={form.intensity}
                options={intensityOptions}
                onChange={(value) =>
                  setForm((current) => ({ ...current, intensity: value }))
                }
              />
              <RadioChoices
                name="mock-frequency"
                legend="整卷模考频率"
                value={form.mockExamPreference}
                options={mockExamOptions}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    mockExamPreference: value,
                  }))
                }
              />
              <RadioChoices
                name="essay-frequency"
                legend="申论训练频率"
                value={form.essayPreference}
                options={essayOptions}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    essayPreference: value,
                  }))
                }
              />
              <fieldset className="min-w-0">
                <legend className="text-sm font-semibold text-slate-700">每日任务数量范围</legend>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="text-xs font-medium text-slate-500">
                    最少
                    <input
                      aria-label="每日最少任务"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={21}
                       required
                      value={form.minTasksPerDay}
                      onChange={(event) => setForm((current) => ({ ...current, minTasksPerDay: event.target.value }))}
                      className="field mt-2 w-full font-normal text-slate-800"
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-500">
                    最多
                    <input
                      aria-label="每日最多任务"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={21}
                       placeholder="不限"
                      value={form.maxTasksPerDay}
                      onChange={(event) => setForm((current) => ({ ...current, maxTasksPerDay: event.target.value }))}
                      className="field mt-2 w-full font-normal text-slate-800"
                    />
                  </label>
                </div>
              </fieldset>
              <label className="min-w-0 text-sm font-semibold text-slate-700">
                单任务最大题量
                <input
                  aria-label="单任务最大题量"
                  type="number"
                  inputMode="numeric"
                  min={5}
                  max={100}
                  required
                  value={form.maxQuestionsPerTask}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      maxQuestionsPerTask: event.target.value,
                    }))
                  }
                  className="field mt-3 w-full font-normal"
                />
              </label>
              <CheckboxChoices
                legend="验收方式"
                values={form.acceptanceMethods}
                options={acceptanceMethodOptions}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    acceptanceMethods: toggleSelection(
                      current.acceptanceMethods,
                      value,
                      { keepOne: true },
                    ),
                  }))
                }
              />
              <CheckboxChoices
                legend="其他限制（最多4项）"
                values={form.constraints}
                options={constraintOptions}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    constraints: toggleSelection(
                      current.constraints,
                      value,
                      { max: 4 },
                    ),
                  }))
                }
                disabled={(value) =>
                  !form.constraints.includes(value) &&
                  form.constraints.length >= 4
                }
              />
            </div>

            <details className="mt-6 border-y border-slate-200 bg-white/70">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-1 py-3 text-sm font-semibold text-slate-700">
                补充特殊情况（选填）
                <ChevronDown size={17} className="shrink-0 text-slate-400" aria-hidden="true" />
              </summary>
              <label className="block pb-4 text-sm text-slate-600">
                <span className="sr-only">补充说明</span>
                <textarea
                  value={form.notes}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  rows={4}
                  maxLength={1_000}
                  placeholder="仅填写选项未覆盖的特殊安排"
                  className="field mt-1"
                />
              </label>
            </details>
          </section>

          <div className="border-t border-blue-100 bg-blue-50/70 px-4 py-4 sm:px-7">
            <div className="font-semibold text-blue-800">
              模型服务由管理员统一配置
            </div>
            <p className="mt-1 text-xs leading-5 text-blue-700">
              模型仅读取聚合后的学习表现和本次偏好；不可用时会自动生成数据规则方案。
            </p>
          </div>
          <div className="safe-bottom flex justify-end border-t border-slate-200 bg-white px-4 py-5 sm:px-7">
            <button
              type="submit"
              disabled={generating}
              className="btn-primary flex w-full items-center justify-center gap-2 disabled:opacity-50 sm:w-auto"
            >
              <Sparkles size={16} aria-hidden="true" />
              {generating ? "正在分析并制定任务…" : "生成每日任务"}
            </button>
          </div>
        </form>
      )}
      {!plan ? (
        <EmptyState text="填写信息后生成第一份每日任务。" />
      ) : (
        <>
          <section className="brand-gradient overflow-hidden rounded-2xl p-6 text-white shadow-lg sm:p-8">
            <div className="flex items-center gap-2 text-xs text-blue-200">
              <Sparkles size={15} aria-hidden="true" />
              {sourceLabel(plan.source)}
            </div>
            <h2 className="mt-2 text-xl font-bold">{plan.title}</h2>
            <p className="mt-3 max-w-4xl text-sm leading-7 text-blue-100">
              {plan.summary}
            </p>
            <div className="mt-6 grid grid-cols-2 gap-x-5 gap-y-4 border-t border-white/15 pt-5 sm:grid-cols-4">
              <PlanMetric icon={<CalendarDays size={16} />} label="累计完成" value={`${plan.completedPlanCount || 0} 次`} />
              <PlanMetric icon={<Target size={16} />} label="任务" value={`${plan.tasks.length} 项`} />
              <PlanMetric icon={<Clock3 size={16} />} label="总投入" value={`${totalMinutes} 分钟`} />
              <PlanMetric icon={<Gauge size={16} />} label="当前阶段" value={plan.strategy?.phase || "滚动提升"} />
            </div>
            <div className="mt-5 border-t border-white/15 pt-4">
              <div className="flex items-center justify-between gap-3 text-xs text-blue-100">
                <span>当前任务进度</span>
                <b className="text-white">
                  {completedTaskCount} / {checkableTasks.length} 项
                </b>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/15">
                <i
                  role="progressbar"
                  aria-label="当前任务进度"
                  aria-valuemin={0}
                  aria-valuemax={checkableTasks.length}
                  aria-valuenow={completedTaskCount}
                  className="block h-full rounded-full bg-emerald-300 transition-[width]"
                  style={{
                    width: `${checkableTasks.length ? (completedTaskCount / checkableTasks.length) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
            <div className="mt-4 text-xs text-blue-200">
              生成时间：{new Date(plan.generatedAt).toLocaleString("zh-CN")}
            </div>
          </section>

          {plan.strategy && (
            <section className="mt-6 border-y border-slate-200 py-6" aria-labelledby="weekly-strategy-title">
              <div className="flex items-center gap-2">
                <Target size={18} className="text-indigo-600" aria-hidden="true" />
                <h2 id="weekly-strategy-title" className="font-bold text-slate-900">
                  当前任务依据
                </h2>
              </div>
              <div className="mt-5 grid gap-7 lg:grid-cols-[1.1fr_.9fr]">
                <div>
                  <p className="text-xs font-semibold text-indigo-600">核心目标</p>
                  <p className="mt-2 text-sm leading-7 text-slate-700">
                    {plan.strategy.objective}
                  </p>
                  <p className="mt-4 text-xs font-semibold text-slate-500">训练节奏</p>
                  <p className="mt-2 text-sm leading-7 text-slate-600">
                    {plan.strategy.rhythm}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500">时间与注意力分配</p>
                  <div className="mt-3 divide-y divide-slate-100 border-y border-slate-100">
                    {plan.strategy.priorities.map((priority, index) => (
                      <div key={`${priority.area}-${index}`} className="py-3">
                        <div className="flex items-center justify-between gap-3">
                          <b className="text-sm text-slate-800">{priority.area}</b>
                          {priority.allocationPercent ? (
                            <span className="text-xs font-semibold text-indigo-600">
                              {priority.allocationPercent}%
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          {priority.reason}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {plan.strategy.adjustmentRules.length ? (
                <div className="mt-6">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                    <RotateCcw size={15} aria-hidden="true" />
                    动态调整规则
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {plan.strategy.adjustmentRules.map((rule, index) => (
                      <p key={index} className="border-l-2 border-indigo-200 pl-3 text-xs leading-6 text-slate-600">
                        {rule}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          )}

          <section className="mt-8" aria-labelledby="weekly-actions-title">
            <div className="border-b border-slate-200 pb-3">
              <p className="text-xs font-semibold text-indigo-600">当前一天</p>
              <h2 id="weekly-actions-title" className="mt-1 text-lg font-bold">
                当前任务清单
              </h2>
            </div>
            <div className="mt-6 space-y-8">
              {groups.map((group) => {
                const dayMinutes = group.items.reduce(
                  (sum, item) => sum + item.task.minutes,
                  0,
                );
                const dayCompleted = group.items.filter((item) =>
                  !isRestTask(item.task) &&
                  completedTaskIndexes.has(item.taskIndex),
                ).length;
                return (
                  <section key={group.day} aria-labelledby={`plan-day-${group.day}`}>
                    <div className="flex items-end justify-between gap-4 border-b border-slate-100 pb-3">
                      <div>
                        <h3 id={`plan-day-${group.day}`} className="font-bold text-slate-900">
                          今日任务
                        </h3>
                      </div>
                      <span className="text-xs text-slate-400">
                        {group.items.length} 项 · {dayMinutes} 分钟
                        {dayCompleted > 0 ? ` · 已完成 ${dayCompleted}` : ""}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      {group.items.map(({ task, taskIndex }) => (
                        <TaskCard
                          key={`${task.day}-${task.title}-${taskIndex}`}
                          task={task}
                          taskIndex={taskIndex}
                          taskKey={taskKeyFor(task, taskIndex)}
                          checkIn={(plan.checkIns || []).find(
                            (item) =>
                              item.taskIndex === taskIndex &&
                              item.taskKey === taskKeyFor(task, taskIndex),
                          )}
                          onComplete={completeTask}
                          onUndo={undoTask}
                          verification={
                            verificationStates[
                              verificationKey(
                                taskIndex,
                                taskKeyFor(task, taskIndex),
                              )
                            ]
                          }
                          active={
                            activeContext?.planId === plan.id &&
                            activeContext.taskKey === taskKeyFor(task, taskIndex)
                          }
                          program={isProgramTask(task, plan.schemaVersion)}
                          onStart={startProgramTask}
                          onVerify={verifyProgramTask}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function PlanMetric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <span className="flex items-center gap-1.5 text-xs text-blue-200">
        {icon}
        {label}
      </span>
      <b className="mt-1 block break-words text-sm text-white">{value}</b>
    </div>
  );
}

function TaskCard({
  task,
  taskIndex,
  taskKey,
  checkIn,
  onComplete,
  onUndo,
  verification,
  active,
  program,
  onStart,
  onVerify,
}: {
  task: StudyPlanTask;
  taskIndex: number;
  taskKey: string;
  checkIn?: StudyPlanCheckIn;
  onComplete: (taskIndex: number, taskKey: string) => Promise<void>;
  onUndo: (taskIndex: number, taskKey: string) => Promise<void>;
  verification?: ProgramVerificationState;
  active?: boolean;
  program: boolean;
  onStart: (
    task: StudyPlanTask,
    taskIndex: number,
    taskKey: string,
  ) => void;
  onVerify: (
    taskIndex: number,
    taskKey: string,
  ) => Promise<ProgramVerificationResult>;
}) {
  const priority = priorityLabels[task.priority || "MEDIUM"];
  const [accepting, setAccepting] = useState(false);
  const [taskCompleted, setTaskCompleted] = useState(false);
  const [checkpointMet, setCheckpointMet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [verificationFailure, setVerificationFailure] =
    useState<ProgramAcceptanceDetails | null>(null);

  const submitAcceptance = async () => {
    if (!taskCompleted || !checkpointMet || saving) return;
    setSaving(true);
    setActionError("");
    try {
      await onComplete(taskIndex, taskKey);
      setAccepting(false);
      setTaskCompleted(false);
      setCheckpointMet(false);
    } catch (reason) {
      setActionError(
        reason instanceof Error ? reason.message : "任务打卡失败，请稍后重试",
      );
    } finally {
      setSaving(false);
    }
  };

  const undo = async () => {
    if (saving) return;
    setSaving(true);
    setActionError("");
    try {
      await onUndo(taskIndex, taskKey);
    } catch (reason) {
      setActionError(
        reason instanceof Error ? reason.message : "撤销打卡失败，请稍后重试",
      );
    } finally {
      setSaving(false);
    }
  };

  const verify = async () => {
    if (saving) return;
    setSaving(true);
    setActionError("");
    setVerificationFailure(null);
    try {
      const outcome = await onVerify(taskIndex, taskKey);
      if (outcome.status === "NOT_MET") {
        setActionError(outcome.message);
        setVerificationFailure({
          ...outcome.details,
          evidenceId:
            outcome.details.evidenceId || verification?.evidence?.id,
        });
      } else if (outcome.status === "NO_EVIDENCE") {
        setActionError(outcome.message);
      }
    } catch (reason) {
      setActionError(
        reason instanceof Error ? reason.message : "系统验收失败，请稍后重试",
      );
    } finally {
      setSaving(false);
    }
  };

  const checkpoint = task.checkpoint || task.target;
  const acceptanceId = `task-acceptance-${taskKey.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  return (
    <article
      data-testid={`study-plan-task-${taskIndex}`}
      className={`card h-full [overflow-wrap:anywhere] p-5 sm:p-6 ${checkIn ? "border-emerald-200 bg-emerald-50/30" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="pill bg-blue-50 text-blue-700">
          {typeLabels[task.type] || task.type}
        </span>
        <span className={`pill ${priority.className}`}>{priority.label}</span>
        <span className="ml-auto text-xs text-slate-400">
          {task.completionSpec?.kind === "PRACTICE" ? "建议 " : ""}{task.minutes} 分钟
        </span>
      </div>
      <h4 className="mt-4 font-bold text-slate-900">{task.title}</h4>
      <p className="mt-2 text-sm leading-6 text-slate-700">{task.target}</p>
      {(task.module || task.difficulty || task.questionCount) && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
          {task.module && <span>板块：{task.module}</span>}
          {task.difficulty && <span>难度：{task.difficulty}</span>}
          {task.questionCount && <span>题量：{task.questionCount}</span>}
        </div>
      )}
      <p className="mt-4 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-500">
        {task.reason}
      </p>
      <div className="mt-3 flex items-start gap-2 text-xs leading-5 text-emerald-700">
          <CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>完成标准：{checkpoint}</span>
      </div>

      {isRestTask(task) ? (
        <div className="mt-4 flex min-h-11 items-center gap-2 border-t border-slate-100 pt-4 text-xs font-semibold text-slate-500">
          <Clock3 size={16} aria-hidden="true" />
          休整任务，无需验收打卡
        </div>
      ) : checkIn ? (
        <div className="mt-4 border-t border-emerald-100 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              role="status"
              aria-live="polite"
              className="flex min-h-11 items-center gap-2 text-sm font-semibold text-emerald-700"
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-100">
                <Check size={16} strokeWidth={2.5} aria-hidden="true" />
              </span>
              <span>
                {checkIn.acceptanceMethod === "PROGRAM_VERIFIED"
                  ? "系统验收通过"
                  : "已完成"} · {new Date(checkIn.completedAt).toLocaleString("zh-CN", {
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            {checkIn.acceptanceMethod === "SELF_CONFIRMED" && (
              <button
                type="button"
                onClick={() => void undo()}
                disabled={saving}
                className="min-h-11 rounded-lg px-3 text-xs font-semibold text-slate-500 transition hover:bg-white hover:text-slate-700 disabled:opacity-50"
              >
                {saving ? "正在撤销…" : "撤销打卡"}
              </button>
            )}
          </div>
          {checkIn.acceptanceMethod === "PROGRAM_VERIFIED" &&
            checkIn.actualSnapshot && (
              <div className="mt-3 rounded-lg border border-emerald-100 bg-white/80 p-3">
                <b className="text-xs text-emerald-800">验收证据摘要</b>
                <MetricList value={checkIn.actualSnapshot} compact />
              </div>
            )}
          {actionError && (
            <p role="alert" className="mt-2 text-xs leading-5 text-red-600">
              {actionError}
            </p>
          )}
        </div>
      ) : program ? (
        <div className="mt-4 border-t border-blue-100 pt-4">
          <div className="grid min-w-0 grid-cols-1 gap-2 min-[380px]:grid-cols-2">
            <button
              type="button"
              className="btn-primary grid min-h-11 w-full grid-cols-[20px_minmax(0,1fr)_20px] items-center gap-2 text-center"
              onClick={() => onStart(task, taskIndex, taskKey)}
            >
              <span className="grid h-5 w-5 place-items-center" aria-hidden="true">
                <Play size={16} />
              </span>
              <span>{active ? "继续任务" : "开始任务"}</span>
              <span aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn-ghost grid min-h-11 w-full grid-cols-[20px_minmax(0,1fr)_20px] items-center gap-2 border-emerald-200 text-center text-emerald-700 disabled:opacity-50"
              disabled={saving || verification?.loading}
              onClick={() => void verify()}
            >
              <span className="grid h-5 w-5 place-items-center" aria-hidden="true">
                {saving || verification?.loading ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : (
                  <ShieldCheck size={16} />
                )}
              </span>
              <span>
                {saving
                  ? "正在验收…"
                  : verification?.loading
                    ? "正在读取…"
                    : "系统验收"}
              </span>
              <span aria-hidden="true" />
            </button>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-500">
            {verification?.evidence
              ? `已找到${evidenceTypeLabel(verification.evidence.type)}，完成于 ${formatEvidenceTime(verification.evidence.completedAt)}。`
              : verification?.loading
                ? "正在查找与本任务绑定的训练记录…"
                : "完成任务后，系统将依据真实训练记录自动核对完成标准。"}
          </p>
          {(actionError || verification?.error) && (
            <p role="alert" className="mt-3 flex items-start gap-2 text-xs leading-5 text-red-600">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{actionError || verification?.error}</span>
            </p>
          )}
          {verificationFailure &&
            (!verificationFailure.evidenceId ||
              verificationFailure.evidenceId === verification?.evidence?.id) && (
            <AcceptanceGapDetails details={verificationFailure} />
          )}
        </div>
      ) : accepting ? (
        <>
          <button
            type="button"
            aria-expanded={true}
            aria-controls={acceptanceId}
            className="btn-ghost mt-4 flex w-full items-center justify-center gap-2 border-emerald-200 text-emerald-700 sm:w-auto"
            onClick={() => {
              setAccepting(false);
              setTaskCompleted(false);
              setCheckpointMet(false);
              setActionError("");
            }}
          >
            <CheckCircle2 size={16} aria-hidden="true" />
            收起自我验收
          </button>
          <fieldset
            id={acceptanceId}
            className="mt-3 min-w-0 max-w-full border-t border-indigo-100 bg-indigo-50/50 px-3 py-4 sm:px-4"
            aria-label={`${task.title}任务验收`}
          >
          <legend className="px-1 text-sm font-bold text-slate-900">
            自我验收后打卡
          </legend>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            请按实际训练结果逐项确认；这是自我验收，不会自动读取训练成绩。
          </p>
          <div className="mt-3 space-y-2">
            <AcceptanceCheck
              checked={taskCompleted}
              onChange={setTaskCompleted}
              title="任务内容已完成"
              description={task.target}
            />
            <AcceptanceCheck
              checked={checkpointMet}
              onChange={setCheckpointMet}
              title="完成标准已达到"
              description={checkpoint}
            />
          </div>
          {actionError && (
            <p role="alert" className="mt-3 text-xs leading-5 text-red-600">
              {actionError}
            </p>
          )}
          <div className="mobile-button-row mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="btn-ghost"
              disabled={saving}
              onClick={() => {
                setAccepting(false);
                setTaskCompleted(false);
                setCheckpointMet(false);
                setActionError("");
              }}
            >
              取消
            </button>
            <button
              type="button"
              className="btn-primary disabled:opacity-45"
              disabled={!taskCompleted || !checkpointMet || saving}
              onClick={() => void submitAcceptance()}
            >
              {saving ? "正在打卡…" : "确认达标并打卡"}
            </button>
          </div>
          </fieldset>
        </>
      ) : (
        <button
          type="button"
          aria-expanded={false}
          aria-controls={acceptanceId}
          className="btn-ghost mt-4 flex w-full items-center justify-center gap-2 border-emerald-200 text-emerald-700 sm:w-auto"
          onClick={() => {
            setAccepting(true);
            setActionError("");
          }}
        >
          <CheckCircle2 size={16} aria-hidden="true" />
          自我验收并打卡
        </button>
      )}
    </article>
  );
}

function AcceptanceCheck({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description: string;
}) {
  return (
    <label className="flex min-h-11 min-w-0 max-w-full cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 text-left">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 accent-emerald-600"
      />
      <span className="min-w-0">
        <b className="block text-sm text-slate-800">{title}</b>
        <span className="mt-1 block [overflow-wrap:anywhere] text-xs leading-5 text-slate-500">
          {description}
        </span>
      </span>
    </label>
  );
}

const metricLabels: Record<string, string> = {
  answered: "实际作答",
  minAnswered: "最低作答",
  accuracy: "实际正确率",
  minAccuracy: "最低正确率",
  durationSeconds: "实际用时",
  elapsedSeconds: "实际用时",
  activeDurationSeconds: "有效作答用时",
  maxElapsedSeconds: "最长用时",
  requiredModule: "指定板块",
  module: "实际板块",
  difficultyRange: "难度范围",
  difficultyScore: "实际难度",
  minCompleteMaterialGroups: "完整材料组",
  completeMaterialGroups: "实际完整材料组",
  requiredTemplateId: "指定卷型",
  templateId: "实际卷型",
  minWordCount: "最低字数",
  wordCount: "实际字数",
  minScore: "最低得分",
  score: "实际得分",
  withinWordLimit: "符合限字",
  wordLimit: "字数上限",
  total: "总题量",
  correct: "答对题量",
  mode: "训练模式",
  evidence: "证据类型",
  questionPool: "指定题型池",
  requiredModuleSatisfied: "板块符合要求",
  questionPoolSatisfied: "题型池符合要求",
  difficultyRangeSatisfied: "难度符合要求",
  startedAt: "开始时间",
  completedAt: "完成时间",
  createdAt: "提交时间",
};

function evidenceTypeLabel(type: string) {
  if (type === "TRAINING_REPORT") return "训练报告";
  if (type === "ESSAY_SUBMISSION") return "申论提交记录";
  return "任务证据";
}

function formatEvidenceTime(value: string) {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return "刚刚";
  return time.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSeconds(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return minutes ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;
}

function formatMetricValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "不限制";
  if (key === "evidence" && value && typeof value === "object") {
    const evidence = value as Record<string, unknown>;
    if (evidence.kind === "TRAINING_REPORT")
      return evidence.mode === "EXAM" ? "模拟考试报告" : "专项练习报告";
    if (evidence.kind === "ESSAY_SUBMISSION") return "申论提交记录";
  }
  if (key === "requiredTemplateId" || key === "templateId") {
    if (value === "NATIONAL_PREFECTURE") return "国考地市级";
    if (value === "GUANGDONG_PROVINCE") return "广东省考";
  }
  if (
    typeof value === "number" &&
    [
      "durationSeconds",
      "elapsedSeconds",
      "activeDurationSeconds",
      "maxElapsedSeconds",
    ].includes(key)
  )
    return formatSeconds(value);
  if (
    typeof value === "number" &&
    ["accuracy", "minAccuracy"].includes(key)
  )
    return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  if (key === "difficultyScore" && typeof value === "number")
    return `${value.toFixed(1)}/10`;
  if (key === "questionPool") {
    if (value === "POLITICS") return "政治理论题型";
    if (value === "GENERAL_KNOWLEDGE") return "非政治常识题型";
  }
  if (
    ["startedAt", "completedAt", "createdAt"].includes(key) &&
    typeof value === "string"
  )
    return formatEvidenceTime(value);
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value))
    return value.map((item) => formatMetricValue(key, item)).join("、") || "无";
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.min === "number" && typeof record.max === "number")
      return `${record.min}-${record.max}/10`;
    return Object.entries(record)
      .map(([nestedKey, nestedValue]) =>
        `${metricLabels[nestedKey] || nestedKey} ${formatMetricValue(nestedKey, nestedValue)}`,
      )
      .join("，");
  }
  if (value === "PRACTICE") return "专项练习";
  if (value === "EXAM") return "模拟考试";
  return String(value);
}

function metricEntries(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>);
}

function MetricList({ value, compact = false }: { value: unknown; compact?: boolean }) {
  const entries = metricEntries(value);
  if (!entries.length)
    return <p className="mt-2 text-xs text-slate-500">暂无结构化数据</p>;
  return (
    <dl className={`${compact ? "mt-2" : "mt-3"} grid min-w-0 gap-x-3 gap-y-2 text-xs sm:grid-cols-2`}>
      {entries.map(([key, item]) => (
        <div key={key} className="min-w-0 [overflow-wrap:anywhere]">
          <dt className="text-slate-400">{metricLabels[key] || key}</dt>
          <dd className="mt-0.5 font-semibold text-slate-700">
            {formatMetricValue(key, item)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function gapMessages(value: unknown) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      if (typeof record.message === "string") return record.message;
      return Object.entries(record)
        .map(([key, value]) => `${metricLabels[key] || key}：${formatMetricValue(key, value)}`)
        .join("，");
    }
    return String(item);
  });
}

function AcceptanceGapDetails({ details }: { details: ProgramAcceptanceDetails }) {
  const gaps = gapMessages(details.gaps);
  return (
    <section className="mt-3 min-w-0 rounded-lg border border-amber-200 bg-amber-50/70 p-3" aria-label="系统验收差距">
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="min-w-0 rounded-md bg-white p-3">
          <b className="text-xs text-slate-700">目标值</b>
          <MetricList value={details.criteria} />
        </div>
        <div className="min-w-0 rounded-md bg-white p-3">
          <b className="text-xs text-slate-700">实际值</b>
          <MetricList value={details.actual} />
        </div>
      </div>
      <div className="mt-3 min-w-0 rounded-md bg-white p-3">
        <b className="text-xs text-amber-800">距离达标</b>
        {gaps.length ? (
          <ul className="mt-2 space-y-1 text-xs leading-5 text-amber-900">
            {gaps.map((gap, index) => (
              <li key={`${index}-${gap}`} className="[overflow-wrap:anywhere]">
                {gap}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-amber-900">请按目标值完成后再次验收。</p>
        )}
      </div>
    </section>
  );
}

function SectionHeading({
  id,
  index,
  title,
}: {
  id: string;
  index: string;
  title: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-indigo-50 text-xs font-bold text-indigo-600"
        aria-hidden="true"
      >
        {index}
      </span>
      <h3 id={id} className="text-base font-bold text-slate-900">
        {title}
      </h3>
    </div>
  );
}

function RadioChoices<T extends ChoiceValue>({
  name,
  legend,
  value,
  options,
  onChange,
}: {
  name: string;
  legend: string;
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-3 text-sm font-semibold text-slate-700">
        {legend}
      </legend>
      <div className="flex min-w-0 flex-wrap gap-2">
        {options.map((option) => {
          const selected = Object.is(value, option.value);
          return (
            <label key={String(option.value)} className="relative max-w-full">
              <input
                type="radio"
                name={name}
                value={String(option.value)}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="peer sr-only"
              />
              <span
                className={`flex min-h-11 max-w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm leading-5 transition peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-300 peer-focus-visible:ring-offset-2 ${
                  selected
                    ? "border-indigo-500 bg-indigo-50 font-semibold text-indigo-700"
                    : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                <span
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
                    selected
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-slate-300 bg-white"
                  }`}
                  aria-hidden="true"
                >
                  {selected && <Check size={11} strokeWidth={3} />}
                </span>
                <span className="min-w-0 break-words">{option.label}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function CheckboxChoices<T extends string>({
  legend,
  values,
  options,
  onChange,
  disabled,
  badge,
}: {
  legend: string;
  values: readonly T[];
  options: readonly ChoiceOption<T>[];
  onChange: (value: T) => void;
  disabled?: (value: T) => boolean;
  badge?: (value: T) => string | undefined;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-3 text-sm font-semibold text-slate-700">
        {legend}
      </legend>
      <div className="flex min-w-0 flex-wrap gap-2">
        {options.map((option) => {
          const selected = values.includes(option.value);
          const blocked = disabled?.(option.value) || false;
          const optionBadge = badge?.(option.value);
          return (
            <label
              key={String(option.value)}
              className={`relative max-w-full ${blocked ? "cursor-not-allowed opacity-45" : ""}`}
            >
              <input
                type="checkbox"
                value={String(option.value)}
                checked={selected}
                disabled={blocked}
                onChange={() => onChange(option.value)}
                className="peer sr-only"
              />
              <span
                className={`flex min-h-11 max-w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm leading-5 transition peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-300 peer-focus-visible:ring-offset-2 ${
                  selected
                    ? "border-indigo-500 bg-indigo-50 font-semibold text-indigo-700"
                    : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                <span
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${
                    selected
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-slate-300 bg-white"
                  }`}
                  aria-hidden="true"
                >
                  {selected && <Check size={11} strokeWidth={3} />}
                </span>
                <span className="min-w-0 break-words">{option.label}</span>
                {optionBadge && (
                  <span
                    className="shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700"
                    aria-hidden="true"
                  >
                    {optionBadge}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

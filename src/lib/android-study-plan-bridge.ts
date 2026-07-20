import type { StudyPlan, StudyPlanTask } from "@/components/app/types";

const BRIDGE_VERSION = 1 as const;
const MAX_TASKS = 21;
const MAX_TASKS_PER_DAY = 6;
const MAX_TASK_CANDIDATES = 56;
const MAX_MESSAGE_LENGTH = 24_000;
const TASK_TYPES = new Set([
  "ASSESSMENT",
  "KNOWLEDGE",
  "PRACTICE",
  "TIMED_PRACTICE",
  "WRONG",
  "EXAM",
  "ESSAY",
  "REVIEW",
  "REST",
]);

type AndroidStudyPlanBridge = {
  postMessage?: (message: string) => void;
};

export type AndroidStudyPlanTask = {
  id: string;
  title: string;
  type: string;
  target: string;
  minutes: number;
  priority: "HIGH" | "MEDIUM" | "LOW";
  module: string | null;
  checkpoint: string | null;
};

export type AndroidStudyPlanDay = {
  day: number;
  scheduledDate: string;
  tasks: AndroidStudyPlanTask[];
};

export type AndroidStudyPlanSyncMessage = {
  type: "SYNC_STUDY_PLAN";
  version: typeof BRIDGE_VERSION;
  accountId: string;
  planId: string;
  generatedAt: string;
  expiresAt: string;
  days: AndroidStudyPlanDay[];
};

export type AndroidStudyPlanClearMessage = {
  type: "CLEAR_STUDY_PLAN";
  version: typeof BRIDGE_VERSION;
  accountId: string;
};

export type AndroidStudyPlanActivateAccountMessage = {
  type: "ACTIVATE_STUDY_PLAN_ACCOUNT";
  version: typeof BRIDGE_VERSION;
  accountId: string;
};

export type AndroidStudyPlanResetMessage = {
  type: "RESET_STUDY_PLAN_REMINDERS";
  version: typeof BRIDGE_VERSION;
};

export type AndroidBridgeResult =
  | "synced"
  | "cleared"
  | "activated"
  | "reset"
  | "unsupported"
  | "invalid"
  | "failed";

declare global {
  interface Window {
    ZhizhengAndroid?: AndroidStudyPlanBridge;
  }
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function safeId(value: unknown) {
  const normalized = cleanText(value, 128);
  return /^[A-Za-z0-9._:@-]{1,128}$/.test(normalized) ? normalized : "";
}

function normalizeIsoDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function formatLocalDate(date: Date) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function scheduledDate(generatedAt: Date, day: number) {
  // Noon avoids a DST boundary changing the calendar date while adding days.
  return formatLocalDate(
    new Date(
      generatedAt.getFullYear(),
      generatedAt.getMonth(),
      generatedAt.getDate() + day - 1,
      12,
    ),
  );
}

function normalizeTask(
  task: StudyPlanTask,
  index: number,
  planId: string,
): { day: number; task: AndroidStudyPlanTask } | null {
  const day = Math.trunc(Number(task.day));
  const title = cleanText(task.title, 80);
  if (!Number.isFinite(day) || day < 1 || day > 7 || !title) return null;

  const priority = ["HIGH", "MEDIUM", "LOW"].includes(task.priority || "")
    ? (task.priority as AndroidStudyPlanTask["priority"])
    : "MEDIUM";
  const rawType = cleanText(task.type, 32);
  const type = TASK_TYPES.has(rawType) ? rawType : "PRACTICE";
  const moduleName = cleanText(task.module, 48);
  const checkpoint = cleanText(task.checkpoint, 160);

  return {
    day,
    task: {
      id: `${planId.slice(0, 96)}:${day}:${index + 1}`.slice(0, 128),
      title,
      type,
      target: cleanText(task.target, 200),
      minutes: Math.min(240, Math.max(1, Math.trunc(Number(task.minutes) || 1))),
      priority,
      module: moduleName || null,
      checkpoint: checkpoint || null,
    },
  };
}

export function buildAndroidStudyPlanMessage(
  plan: StudyPlan,
  rawAccountId: string,
): AndroidStudyPlanSyncMessage | null {
  const accountId = safeId(rawAccountId);
  const planId = safeId(plan.id);
  const generatedAt = normalizeIsoDate(plan.generatedAt);
  const expiresAt = normalizeIsoDate(plan.expiresAt);
  if (!accountId || !planId || !generatedAt || !expiresAt || !Array.isArray(plan.tasks)) return null;
  if (new Date(expiresAt).getTime() <= new Date(generatedAt).getTime()) return null;

  const tasksByDay = new Map<number, AndroidStudyPlanTask[]>();
  const completedTaskIndexes = new Set(
    (Array.isArray(plan.checkIns) ? plan.checkIns : [])
      .map((checkIn) => checkIn.taskIndex)
      .filter(
        (taskIndex) =>
          Number.isInteger(taskIndex) && taskIndex >= 0 && taskIndex < plan.tasks.length,
      ),
  );
  let acceptedTasks = 0;
  for (const [index, rawTask] of plan.tasks.slice(0, MAX_TASK_CANDIDATES).entries()) {
    if (acceptedTasks >= MAX_TASKS) break;
    if (completedTaskIndexes.has(index)) continue;
    const normalized = normalizeTask(rawTask, index, planId);
    if (!normalized) continue;
    const tasks = tasksByDay.get(normalized.day) || [];
    if (tasks.length >= MAX_TASKS_PER_DAY) continue;
    tasksByDay.set(normalized.day, [...tasks, normalized.task]);
    acceptedTasks += 1;
  }

  const generatedDate = new Date(generatedAt);
  const days = Array.from(tasksByDay, ([day, tasks]) => ({
    day,
    scheduledDate: scheduledDate(generatedDate, day),
    tasks,
  })).sort((left, right) => left.day - right.day);

  return {
    type: "SYNC_STUDY_PLAN",
    version: BRIDGE_VERSION,
    accountId,
    planId,
    generatedAt,
    expiresAt,
    days,
  };
}

function serializeSyncMessage(message: AndroidStudyPlanSyncMessage) {
  const bounded: AndroidStudyPlanSyncMessage = {
    ...message,
    days: message.days.map((day) => ({ ...day, tasks: [...day.tasks] })),
  };
  let serialized = JSON.stringify(bounded);

  while (serialized.length > MAX_MESSAGE_LENGTH && bounded.days.length) {
    const lastDay = bounded.days.at(-1);
    lastDay?.tasks.pop();
    if (!lastDay?.tasks.length) bounded.days.pop();
    serialized = JSON.stringify(bounded);
  }
  return serialized.length <= MAX_MESSAGE_LENGTH ? serialized : null;
}

function currentBridge(): AndroidStudyPlanBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.ZhizhengAndroid;
}

export function hasAndroidStudyPlanBridge() {
  return typeof currentBridge()?.postMessage === "function";
}

function postMessage(
  message:
    | AndroidStudyPlanSyncMessage
    | AndroidStudyPlanClearMessage
    | AndroidStudyPlanActivateAccountMessage
    | AndroidStudyPlanResetMessage,
  bridge: AndroidStudyPlanBridge,
) {
  const serialized = message.type === "SYNC_STUDY_PLAN"
    ? serializeSyncMessage(message)
    : JSON.stringify(message);
  if (!serialized || typeof bridge.postMessage !== "function") return "invalid" as const;
  try {
    bridge.postMessage(serialized);
    if (message.type === "SYNC_STUDY_PLAN") return "synced";
    if (message.type === "CLEAR_STUDY_PLAN") return "cleared";
    if (message.type === "ACTIVATE_STUDY_PLAN_ACCOUNT") return "activated";
    return "reset";
  } catch {
    return "failed" as const;
  }
}

export function syncStudyPlanToAndroid(
  plan: StudyPlan,
  accountId: string,
  bridge: AndroidStudyPlanBridge | undefined = currentBridge(),
): AndroidBridgeResult {
  if (typeof bridge?.postMessage !== "function") return "unsupported";
  const message = buildAndroidStudyPlanMessage(plan, accountId);
  return message ? postMessage(message, bridge) : "invalid";
}

export function clearAndroidStudyPlan(
  accountId: string,
  bridge: AndroidStudyPlanBridge | undefined = currentBridge(),
): AndroidBridgeResult {
  if (typeof bridge?.postMessage !== "function") return "unsupported";
  const safeAccountId = safeId(accountId);
  if (!safeAccountId) return "invalid";
  return postMessage(
    { type: "CLEAR_STUDY_PLAN", version: BRIDGE_VERSION, accountId: safeAccountId },
    bridge,
  );
}

export function activateAndroidStudyPlanAccount(
  accountId: string,
  bridge: AndroidStudyPlanBridge | undefined = currentBridge(),
): AndroidBridgeResult {
  if (typeof bridge?.postMessage !== "function") return "unsupported";
  const safeAccountId = safeId(accountId);
  if (!safeAccountId) return "invalid";
  return postMessage(
    { type: "ACTIVATE_STUDY_PLAN_ACCOUNT", version: BRIDGE_VERSION, accountId: safeAccountId },
    bridge,
  );
}

export function resetAndroidStudyPlanReminders(
  bridge: AndroidStudyPlanBridge | undefined = currentBridge(),
): AndroidBridgeResult {
  if (typeof bridge?.postMessage !== "function") return "unsupported";
  return postMessage(
    { type: "RESET_STUDY_PLAN_REMINDERS", version: BRIDGE_VERSION },
    bridge,
  );
}

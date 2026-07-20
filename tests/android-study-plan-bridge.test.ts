import assert from "node:assert/strict";
import test from "node:test";
import {
  activateAndroidStudyPlanAccount,
  buildAndroidStudyPlanMessage,
  clearAndroidStudyPlan,
  resetAndroidStudyPlanReminders,
  syncStudyPlanToAndroid,
} from "../src/lib/android-study-plan-bridge";
import type { StudyPlan } from "../src/components/app/types";

process.env.TZ = "Asia/Shanghai";

function fixture(overrides: Partial<StudyPlan> = {}): StudyPlan {
  return {
    id: "plan-1",
    title: "Seven-day plan",
    source: "DATA_RULES",
    summary: "Progressive study plan",
    generatedAt: "2026-07-15T02:00:00.000Z",
    expiresAt: "2026-07-22T02:00:00.000Z",
    tasks: [
      {
        day: 1,
        title: " Quantitative\u202E reasoning\npractice ",
        type: "TIMED_PRACTICE",
        target: "Complete 20 questions",
        minutes: 45,
        reason: "Weak area",
        priority: "HIGH",
        module: "Quantitative reasoning",
        checkpoint: "Reach 70 percent accuracy",
      },
      {
        day: 2,
        title: "Data analysis",
        type: "PRACTICE",
        target: "Complete one material set",
        minutes: 30,
        reason: "Maintain fluency",
      },
    ],
    ...overrides,
  };
}

test("study plan bridge creates account-scoped day groups with explicit dates", () => {
  const message = buildAndroidStudyPlanMessage(fixture(), " account-1\n");
  assert.ok(message);
  assert.equal(message.type, "SYNC_STUDY_PLAN");
  assert.equal(message.accountId, "account-1");
  assert.equal(message.version, 1);
  assert.equal(message.days.length, 2);
  assert.equal(message.days[0].scheduledDate, "2026-07-15");
  assert.equal(message.days[1].scheduledDate, "2026-07-16");
  assert.equal(message.days[0].tasks[0].title, "Quantitative reasoning practice");
  assert.equal(message.days[1].tasks[0].priority, "MEDIUM");
});

test("study plan bridge bounds task count, tasks per day, fields, and total message", () => {
  const longTasks = Array.from({ length: 55 }, (_, index) => ({
    day: index === 0 ? 8 : (index % 4) + 1,
    title: "T".repeat(120),
    type: "PRACTICE",
    target: "G".repeat(300),
    minutes: 999,
    reason: "test",
  }));
  const message = buildAndroidStudyPlanMessage(fixture({ tasks: longTasks }), "account-1");
  assert.ok(message);
  assert.equal(message.days.reduce((sum, day) => sum + day.tasks.length, 0), 21);
  assert.ok(message.days.every((day) => day.tasks.length <= 6));
  assert.equal(message.days[0].tasks[0].title.length, 80);
  assert.equal(message.days[0].tasks[0].target.length, 200);
  assert.equal(message.days[0].tasks[0].minutes, 240);

  const calls: string[] = [];
  assert.equal(syncStudyPlanToAndroid(fixture({ tasks: longTasks }), "account-1", {
    postMessage: (payload) => calls.push(payload),
  }), "synced");
  assert.ok(calls[0].length <= 24_000);
});

test("study plan bridge emits only native-safe task values", () => {
  const message = buildAndroidStudyPlanMessage(fixture({
    tasks: [
      {
        day: 1,
        title: "<b>数量关系</b>\u0000限时练习",
        type: "UNSUPPORTED",
        target: "<script>alert(1)</script>完成训练",
        minutes: 0,
        reason: "test",
      },
    ],
  }), "account-1");

  assert.ok(message);
  assert.equal(message.days[0].tasks[0].title, "数量关系 限时练习");
  assert.equal(message.days[0].tasks[0].target, "alert(1) 完成训练");
  assert.equal(message.days[0].tasks[0].type, "PRACTICE");
  assert.equal(message.days[0].tasks[0].minutes, 1);
});

test("study plan bridge removes completed tasks from future reminders", () => {
  const plan = fixture({
    checkIns: [
      {
        id: "check-in-1",
        planId: "plan-1",
        taskKey: "task-01",
        taskIndex: 0,
        taskTitle: "Quantitative reasoning practice",
        targetSnapshot: "Complete 20 questions",
        checkpointSnapshot: "Reach 70 percent accuracy",
        acceptanceMethod: "SELF_CONFIRMED",
        completedAt: "2026-07-15T03:00:00.000Z",
        updatedAt: "2026-07-15T03:00:00.000Z",
      },
    ],
  });
  const message = buildAndroidStudyPlanMessage(plan, "account-1");
  assert.ok(message);
  assert.equal(message.days.length, 1);
  assert.equal(message.days[0].day, 2);
  assert.equal(message.days[0].tasks[0].title, "Data analysis");

  const allCompleted = buildAndroidStudyPlanMessage(
    fixture({
      checkIns: [0, 1].map((taskIndex) => ({
        id: `check-in-${taskIndex}`,
        planId: "plan-1",
        taskKey: `task-${String(taskIndex + 1).padStart(2, "0")}`,
        taskIndex,
        taskTitle: "Done task",
        targetSnapshot: "Done",
        checkpointSnapshot: "Met",
        acceptanceMethod: "SELF_CONFIRMED" as const,
        completedAt: "2026-07-15T03:00:00.000Z",
        updatedAt: "2026-07-15T03:00:00.000Z",
      })),
    }),
    "account-1",
  );
  assert.ok(allCompleted);
  assert.deepEqual(allCompleted.days, []);
});

test("study plan bridge removes program-verified tasks from future reminders", () => {
  const message = buildAndroidStudyPlanMessage(
    fixture({
      checkIns: [
        {
          id: "check-in-program-1",
          planId: "plan-1",
          taskKey: "task-01",
          taskIndex: 0,
          taskTitle: "Quantitative reasoning practice",
          targetSnapshot: "Complete 20 questions",
          checkpointSnapshot: "Reach 70 percent accuracy",
          acceptanceMethod: "PROGRAM_VERIFIED",
          evidenceType: "TRAINING_REPORT",
          evidenceId: "report-1",
          completedAt: "2026-07-15T03:00:00.000Z",
          updatedAt: "2026-07-15T03:00:00.000Z",
        },
      ],
    }),
    "account-1",
  );

  assert.ok(message);
  assert.equal(message.days.length, 1);
  assert.equal(message.days[0].day, 2);
  assert.equal(message.days[0].tasks[0].title, "Data analysis");
});

test("study plan bridge removes mixed self-confirmed and program-verified tasks", () => {
  const message = buildAndroidStudyPlanMessage(
    fixture({
      checkIns: [
        {
          id: "check-in-self-1",
          planId: "plan-1",
          taskKey: "task-01",
          taskIndex: 0,
          taskTitle: "Quantitative reasoning practice",
          targetSnapshot: "Complete 20 questions",
          checkpointSnapshot: "Reach 70 percent accuracy",
          acceptanceMethod: "SELF_CONFIRMED",
          completedAt: "2026-07-15T03:00:00.000Z",
          updatedAt: "2026-07-15T03:00:00.000Z",
        },
        {
          id: "check-in-program-2",
          planId: "plan-1",
          taskKey: "task-02",
          taskIndex: 1,
          taskTitle: "Data analysis",
          targetSnapshot: "Complete one material set",
          checkpointSnapshot: "Complete the assigned task",
          acceptanceMethod: "PROGRAM_VERIFIED",
          evidenceType: "TRAINING_REPORT",
          evidenceId: "report-2",
          completedAt: "2026-07-16T03:00:00.000Z",
          updatedAt: "2026-07-16T03:00:00.000Z",
        },
      ],
    }),
    "account-1",
  );

  assert.ok(message);
  assert.deepEqual(message.days, []);
});

test("study plan bridge rejects unsafe identifiers and invalid validity windows", () => {
  assert.equal(buildAndroidStudyPlanMessage(fixture(), "../account"), null);
  assert.equal(buildAndroidStudyPlanMessage(fixture({ id: "plan/id" }), "account-1"), null);
  assert.equal(buildAndroidStudyPlanMessage(fixture({
    generatedAt: "2026-07-15T02:00:00.000Z",
    expiresAt: "2026-07-15T02:00:00.000Z",
  }), "account-1"), null);
  assert.equal(clearAndroidStudyPlan("../account", { postMessage: () => undefined }), "invalid");
});

test("bridge is silent when unsupported and otherwise posts versioned envelopes", () => {
  assert.equal(syncStudyPlanToAndroid(fixture(), "account-1", undefined), "unsupported");
  const calls: string[] = [];
  const bridge = { postMessage: (message: string) => calls.push(message) };
  assert.equal(syncStudyPlanToAndroid(fixture(), "account-1", bridge), "synced");
  assert.equal(activateAndroidStudyPlanAccount("account-1", bridge), "activated");
  assert.equal(clearAndroidStudyPlan("account-1", bridge), "cleared");
  assert.equal(resetAndroidStudyPlanReminders(bridge), "reset");
  assert.equal(JSON.parse(calls[0]).type, "SYNC_STUDY_PLAN");
  assert.deepEqual(JSON.parse(calls[1]), {
    type: "ACTIVATE_STUDY_PLAN_ACCOUNT",
    version: 1,
    accountId: "account-1",
  });
  assert.deepEqual(JSON.parse(calls[2]), {
    type: "CLEAR_STUDY_PLAN",
    version: 1,
    accountId: "account-1",
  });
  assert.deepEqual(JSON.parse(calls[3]), {
    type: "RESET_STUDY_PLAN_REMINDERS",
    version: 1,
  });
});

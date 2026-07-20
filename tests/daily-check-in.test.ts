import assert from "node:assert/strict";
import test from "node:test";
import {
  fallbackDailyGoal,
  normalizeDailyGoal,
  type DailyGoalContext,
} from "../src/lib/daily-check-in";
import { chinaDateKey, chinaWeekDate, chinaWeekStart } from "../src/lib/china-time";

const context: DailyGoalContext = {
  targetExam: "公务员考试",
  date: "2026-07-20",
  weekday: "星期一",
  todayAnswered: 0,
  todayCompletedTasks: 0,
  recent14Days: {
    answered: 120,
    correct: 84,
    accuracy: 70,
    activeDays: 6,
    averageQuestionsPerActiveDay: 20,
    completedTasks: 8,
    taskActiveDays: 4,
    averageTasksPerActiveDay: 2,
  },
  categories: [],
  recentGoals: [],
};

test("签到规则目标会随近期活跃量生成题目和任务目标", () => {
  const goal = fallbackDailyGoal(context);
  assert.equal(goal.questionGoal, 20);
  assert.equal(goal.taskGoal, 2);
  assert.match(goal.summary, /20题/);
});

test("模型签到目标越界或字段不完整时回退规则目标", () => {
  const fallback = fallbackDailyGoal(context);
  assert.deepEqual(
    normalizeDailyGoal({ questionGoal: 101, taskGoal: 2, summary: "越界" }, fallback),
    fallback,
  );
  assert.deepEqual(
    normalizeDailyGoal({ questionGoal: 35, taskGoal: 3, summary: "今天完成更多稳定训练" }, fallback),
    { questionGoal: 35, taskGoal: 3, summary: "今天完成更多稳定训练" },
  );
});

test("签到和统计使用北京时间自然周日期", () => {
  const sunday = new Date("2026-07-19T15:59:59.000Z");
  const monday = new Date("2026-07-19T16:00:00.000Z");
  assert.equal(chinaDateKey(sunday), "2026-07-19");
  assert.equal(chinaDateKey(monday), "2026-07-20");
  assert.equal(chinaWeekStart(monday).toISOString(), "2026-07-19T16:00:00.000Z");
  assert.equal(chinaWeekDate(monday).toISOString(), "2026-07-20T00:00:00.000Z");
});

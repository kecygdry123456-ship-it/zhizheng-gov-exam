import assert from "node:assert/strict";
import test from "node:test";
import { fallbackLearningAnalysis } from "../src/lib/learning-analysis";

test("累计学习分析兜底结果包含长篇分段判断和可执行行动", () => {
  const result = fallbackLearningAnalysis({
    total: 180,
    correct: 121,
    accuracy: 67.2,
    today: 20,
    last7Days: { total: 75, correct: 53, accuracy: 70.7 },
    previous7Days: { total: 60, correct: 38, accuracy: 63.3 },
    weeklyCompletedTasks: 4,
    categories: [
      { name: "言语理解", total: 60, correct: 48, accuracy: 80, averageDurationSeconds: 52, averageDifficulty: 5.3 },
      { name: "数量关系", total: 35, correct: 18, accuracy: 51.4, averageDurationSeconds: 110, averageDifficulty: 5.8 },
    ],
    subtypes: [
      { name: "数量关系 / 数学运算", total: 20, correct: 9, accuracy: 45, averageDurationSeconds: 122, averageDifficulty: 6.1 },
    ],
    daily: [],
    recentReports: [],
  });

  const prose = [
    result.overall,
    result.ability,
    result.trend,
    result.priorities,
    result.trainingPlan,
    result.caveat,
  ].join("");
  assert.ok(prose.length >= 700);
  assert.ok(result.actions.length >= 4);
  assert.match(result.ability, /数量关系/);
  assert.match(result.trainingPlan, /资料和数量应减少单次题量/);
});

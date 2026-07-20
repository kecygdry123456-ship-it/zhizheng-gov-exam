import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSubtypeTimingBenchmarks,
  estimateTaskMinutes,
  initialSubtypeSeconds,
} from "../src/lib/study-plan-timing";

test("细分题型使用分类初值且同名题型按大板块区分", () => {
  assert.equal(initialSubtypeSeconds("数量关系", "数学运算"), 90);
  assert.equal(initialSubtypeSeconds("判断推理", "数学运算"), 90);
  assert.equal(initialSubtypeSeconds("判断推理", "类比推理"), 35);
  assert.equal(initialSubtypeSeconds("常识判断", "法律常识"), 30);
});

test("题均时间随有效样本逐步学习并抑制异常值", () => {
  const [sparse] = buildSubtypeTimingBenchmarks([
    { name: "判断推理 / 图形推理", total: 2, averageDurationSeconds: 120 },
  ]);
  const [rich] = buildSubtypeTimingBenchmarks([
    { name: "判断推理 / 图形推理", total: 40, averageDurationSeconds: 90 },
  ]);
  const [outlier] = buildSubtypeTimingBenchmarks([
    { name: "判断推理 / 图形推理", total: 40, averageDurationSeconds: 1_000 },
  ]);
  assert.equal(sparse.recommendedSeconds, 60);
  assert.ok(rich.recommendedSeconds > sparse.recommendedSeconds);
  assert.ok(outlier.recommendedSeconds <= 135);
  assert.equal(
    estimateTaskMinutes(10, [{ category: "判断推理", type: "图形推理" }], [rich]),
    15,
  );
});

test("无作答记录的题库细分板块仍进入初始计时基准", () => {
  const benchmarks = buildSubtypeTimingBenchmarks([], [
    { category: "资料分析", type: "综合材料" },
  ]);
  assert.deepEqual(benchmarks, [
    {
      category: "资料分析",
      type: "综合材料",
      initialSeconds: 75,
      sampleCount: 0,
      observedAverageSeconds: null,
      recommendedSeconds: 75,
    },
  ]);
});

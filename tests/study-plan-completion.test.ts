import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCompletionSpecs,
  checkpointForCompletionSpec,
  completionSpecHash,
  completionSpecSchema,
  deriveCompletionSpec,
  parseCompletionSpec,
} from "../src/lib/study-plan-completion";
import { GENERAL_KNOWLEDGE_QUESTION_TYPES } from "../src/lib/exam-templates";
import { questionMatchesPool } from "../src/lib/study-plan-task";

test("completion spec 使用严格判别联合并拒绝未知字段", () => {
  const spec = deriveCompletionSpec({
    type: "PRACTICE",
    minutes: 30,
    module: "数量关系",
    difficulty: "4～6分",
    questionCount: 10,
  });
  assert.equal(spec.kind, "PRACTICE");
  assert.equal(
    completionSpecSchema.safeParse({ ...spec, injected: true }).success,
    false,
  );
  assert.equal(
    completionSpecSchema.safeParse({
      ...spec,
      launch: { ...spec.launch, injected: true },
    }).success,
    false,
  );
  assert.equal(spec.kind, "PRACTICE");
  if (spec.kind === "PRACTICE") {
    assert.ok(spec.launch.scopes?.some((scope) => scope.category === "数量关系" && scope.type === "数学运算"));
    assert.equal(spec.launch.durationMinutes, 30);
    assert.equal(spec.maxElapsedSeconds, 2_880);
  }
});

test("规划中的精确细分题型写入启动规格和验收文案", () => {
  const spec = deriveCompletionSpec({
    type: "TIMED_PRACTICE",
    module: "判断推理 / 图形推理、逻辑判断",
    minutes: 30,
    questionCount: 10,
  });
  assert.equal(spec.kind, "PRACTICE");
  if (spec.kind !== "PRACTICE") return;
  assert.deepEqual(spec.launch.scopes, [
    { category: "判断推理", type: "逻辑判断" },
    { category: "判断推理", type: "图形推理" },
  ]);
  assert.match(checkpointForCompletionSpec(spec), /细分板块限定/);
  assert.match(checkpointForCompletionSpec(spec), /逻辑判断|图形推理/);
});

test("重名细分题型按约定归入正确的大板块", () => {
  const cases = [
    ["数学运算", "数量关系"],
    ["逻辑判断", "判断推理"],
    ["科技地理", "常识判断"],
  ] as const;

  for (const [type, category] of cases) {
    const spec = deriveCompletionSpec({
      type: "PRACTICE",
      module: type,
      minutes: 20,
      questionCount: 5,
    });
    assert.equal(spec.kind, "PRACTICE");
    if (spec.kind !== "PRACTICE") continue;
    assert.equal(spec.launch.category, category);
    assert.deepEqual(spec.launch.scopes, [{ category, type }]);
  }
});

test("资料分析题量上调为完整五题组并生成可见验收标准", () => {
  const spec = deriveCompletionSpec({
    type: "TIMED_PRACTICE",
    minutes: 45,
    module: "资料分析",
    difficulty: "基础到中等",
    questionCount: 13,
  });
  assert.equal(spec.kind, "PRACTICE");
  if (spec.kind !== "PRACTICE") return;
  assert.equal(spec.minAnswered, 15);
  assert.equal(spec.minCompleteMaterialGroups, 3);
  assert.deepEqual(spec.difficultyRange, { min: 1, max: 7 });
  assert.equal(spec.maxElapsedSeconds, 4_080);
  assert.match(checkpointForCompletionSpec(spec), /完整作答 3 组/);
});

test("单任务题量上限对资料分析向下收敛到完整五题组", () => {
  const spec = deriveCompletionSpec(
    {
      type: "PRACTICE",
      minutes: 20,
      module: "资料分析 / 综合材料",
      questionCount: 18,
    },
    { maxQuestionsPerTask: 12 },
  );
  assert.equal(spec.kind, "PRACTICE");
  if (spec.kind !== "PRACTICE") return;
  assert.equal(spec.minAnswered, 10);
  assert.equal(spec.minCompleteMaterialGroups, 2);
  assert.equal(spec.launch.durationMinutes, 20);
});

test("缺省题量按任务时长派生，显式小数难度保持精度", () => {
  const [task] = applyCompletionSpecs([
    {
      type: "ASSESSMENT",
      minutes: 50,
      module: "行测综合",
      difficulty: "4.5-6.5 分",
      questionCount: null,
    },
  ]);
  assert.equal(task.completionSpec.kind, "PRACTICE");
  if (task.completionSpec.kind !== "PRACTICE") return;
  assert.equal(task.completionSpec.minAnswered, 20);
  assert.equal(task.questionCount, 20);
  assert.deepEqual(task.completionSpec.difficultyRange, {
    min: 4.5,
    max: 6.5,
  });
});

test("模型给出的越界难度区间会被收敛到一至十分", () => {
  const upper = deriveCompletionSpec({
    type: "PRACTICE",
    minutes: 30,
    module: "数量关系",
    difficulty: "9.5-10.5",
  });
  const lower = deriveCompletionSpec({
    type: "PRACTICE",
    minutes: 30,
    module: "数量关系",
    difficulty: "0.5-3",
  });
  assert.equal(upper.kind, "PRACTICE");
  assert.equal(lower.kind, "PRACTICE");
  if (upper.kind !== "PRACTICE" || lower.kind !== "PRACTICE") return;
  assert.deepEqual(upper.difficultyRange, { min: 9.5, max: 10 });
  assert.deepEqual(lower.difficultyRange, { min: 1, max: 3 });
});

test("正确率和验收时间随难度动态变化且数量资料获得更宽余量", () => {
  const easy = deriveCompletionSpec({
    type: "TIMED_PRACTICE",
    module: "数量关系 / 数学运算",
    minutes: 15,
    difficulty: "1-4分",
    questionCount: 10,
  });
  const hard = deriveCompletionSpec({
    type: "TIMED_PRACTICE",
    module: "数量关系 / 数学运算",
    minutes: 15,
    difficulty: "7-10分",
    questionCount: 10,
  });
  const language = deriveCompletionSpec({
    type: "TIMED_PRACTICE",
    module: "言语理解与表达 / 片段阅读",
    minutes: 15,
    difficulty: "7-10分",
    questionCount: 10,
  });
  for (const spec of [easy, hard, language]) assert.equal(spec.kind, "PRACTICE");
  if (easy.kind !== "PRACTICE" || hard.kind !== "PRACTICE" || language.kind !== "PRACTICE") return;
  assert.equal(easy.minAccuracy, 65);
  assert.equal(hard.minAccuracy, 55);
  assert.equal(language.minAccuracy, 75);
  assert.ok(hard.maxElapsedSeconds! > easy.maxElapsedSeconds!);
  assert.ok(hard.maxElapsedSeconds! > language.maxElapsedSeconds!);

  const [task] = applyCompletionSpecs([{
    type: "TIMED_PRACTICE",
    module: "数量关系 / 数学运算",
    minutes: 15,
    difficulty: "7-10分",
    questionCount: 10,
    target: "模型写入的固定正确率与时间",
    checkpoint: "模型写入的固定完成标准",
  }]);
  assert.match(task.target, /正确率≥55%/);
  assert.match(task.target, /验收用时≤28分钟/);
  assert.match(task.checkpoint, /正确率不低于 55%/);
  assert.match(task.checkpoint, /总用时不超过 28 分钟/);
  assert.doesNotMatch(task.target, /模型写入/);
});

test("政治理论使用专用题型池而不是数据库板块名", () => {
  const spec = deriveCompletionSpec({
    type: "PRACTICE",
    minutes: 40,
    module: "政治理论",
    questionCount: 15,
  });
  assert.equal(spec.kind, "PRACTICE");
  if (spec.kind !== "PRACTICE") return;
  assert.equal(spec.requiredModule, "政治理论");
  assert.equal(spec.launch.category, "常识判断");
  assert.equal(spec.launch.questionPool, "POLITICS");
});

test("普通常识使用非政治常识题型池", () => {
  const spec = deriveCompletionSpec({
    type: "PRACTICE",
    minutes: 20,
    module: "常识判断",
    questionCount: 2,
  });
  assert.equal(spec.kind, "PRACTICE");
  if (spec.kind !== "PRACTICE") return;
  assert.equal(spec.launch.questionCount, 17);
  assert.equal(spec.launch.category, "常识判断");
  assert.equal(spec.launch.questionPool, "GENERAL_KNOWLEDGE");
  assert.ok(GENERAL_KNOWLEDGE_QUESTION_TYPES.includes("常识判断"));
  assert.equal(
    questionMatchesPool(
      {
        id: "general-knowledge",
        type: "常识判断",
        stem: "下列关于传统节日的说法正确的是",
        difficultyScore: 5,
        materialId: null,
        category: { name: "常识判断" },
      },
      "GENERAL_KNOWLEDGE",
    ),
    true,
  );
  assert.equal(
    questionMatchesPool(
      {
        id: "political-generic",
        type: "常识判断",
        stem: "下列关于党的二十大报告的说法正确的是",
        difficultyScore: 5,
        materialId: null,
        category: { name: "常识判断" },
      },
      "GENERAL_KNOWLEDGE",
    ),
    false,
  );
});

test("各板块使用不同初始正确率，并按历史表现小幅调整", () => {
  const modules = [
    ["常识判断", 50],
    ["言语理解与表达", 80],
    ["判断推理", 75],
    ["资料分析", 70],
    ["数量关系", 60],
  ] as const;
  for (const [module, expected] of modules) {
    const spec = deriveCompletionSpec({
      type: "PRACTICE",
      module,
      minutes: 30,
      difficulty: "中等",
    });
    assert.equal(spec.kind, "PRACTICE");
    if (spec.kind === "PRACTICE") assert.equal(spec.minAccuracy, expected);
  }

  const improved = deriveCompletionSpec(
    {
      type: "PRACTICE",
      module: "数量关系",
      minutes: 30,
      difficulty: "中等",
    },
    { accuracyProfile: { 数量关系: { accuracy: 90, sampleSize: 20 } } },
  );
  assert.equal(improved.kind, "PRACTICE");
  if (improved.kind === "PRACTICE") assert.equal(improved.minAccuracy, 70);
});

test("常识、言语、判断题量高于资料和数量", () => {
  const counts = [
    "常识判断",
    "言语理解与表达",
    "判断推理",
    "资料分析",
    "数量关系",
  ].map((module) => {
    const spec = deriveCompletionSpec({
      type: "PRACTICE",
      module,
      minutes: 30,
      difficulty: "中等",
    });
    assert.equal(spec.kind, "PRACTICE");
    return spec.kind === "PRACTICE" ? spec.launch.questionCount : 0;
  });
  assert.ok(counts[0] > counts[3]);
  assert.ok(counts[1] > counts[4]);
  assert.ok(counts[2] > counts[4]);
});

test("未知板块降级为自验收，知识、错题和复盘保持自验收", () => {
  for (const task of [
    { type: "PRACTICE", module: "模型虚构板块" },
    { type: "KNOWLEDGE", module: "数量关系" },
    { type: "WRONG", module: "判断推理" },
    { type: "REVIEW", module: null },
  ]) {
    assert.equal(deriveCompletionSpec(task).kind, "SELF");
  }
  assert.equal(deriveCompletionSpec({ type: "REST" }).kind, "NONE");
});

test("短时模考改为综合测评，正式模考固定国考与广东卷参数", () => {
  const [shortExam] = applyCompletionSpecs(
    [
      {
        type: "EXAM",
        title: "正式卷型阶段测验",
        target: "完成模拟卷",
        minutes: 60,
        checkpoint: "模型生成的自然语言标准",
      },
    ],
    { targetExam: "国家公务员考试（地市级）" },
  );
  assert.equal(shortExam.type, "ASSESSMENT");
  assert.equal(shortExam.completionSpec.kind, "PRACTICE");
  assert.doesNotMatch(shortExam.checkpoint || "", /模型生成/);

  const national = deriveCompletionSpec(
    { type: "EXAM", minutes: 130 },
    { targetExam: "国家公务员考试（地市级）" },
  );
  assert.equal(national.kind, "EXAM");
  if (national.kind !== "EXAM") return;
  assert.equal(national.requiredTemplateId, "NATIONAL_PREFECTURE");
  assert.equal(national.minAnswered, 130);
  assert.equal(national.maxElapsedSeconds, 7_200);

  const province = deriveCompletionSpec(
    { type: "EXAM", minutes: 90 },
    { targetExam: "广东省公务员考试" },
  );
  assert.equal(province.kind, "EXAM");
  if (province.kind !== "EXAM") return;
  assert.equal(province.requiredTemplateId, "GUANGDONG_PROVINCE");
  assert.equal(province.minAnswered, 90);
  assert.equal(province.maxElapsedSeconds, 5_400);
});

test("申论规格只使用服务端派生的字数、限字和分数标准", () => {
  const [task] = applyCompletionSpecs([
    {
      type: "ESSAY",
      minutes: 45,
      checkpoint: "忽略此处的任意模型标准",
      completionSpec: { method: "NONE" },
    },
  ]);
  assert.equal(task.completionSpec.kind, "ESSAY");
  if (task.completionSpec.kind !== "ESSAY") return;
  assert.equal(task.completionSpec.minWordCount, 160);
  assert.equal(task.completionSpec.minScore, 60);
  assert.equal(task.completionSpec.withinWordLimit, true);
  assert.doesNotMatch(task.checkpoint || "", /忽略此处/);
});

test("解析器兼容任务包装，规格哈希不受对象键顺序影响", () => {
  const spec = deriveCompletionSpec({
    type: "PRACTICE",
    module: "言语理解与表达",
    minutes: 40,
    questionCount: 20,
  });
  assert.deepEqual(parseCompletionSpec({ completionSpec: spec }), spec);
  assert.equal(parseCompletionSpec({ method: "PROGRAM" }), null);
  const reordered = {
    ...spec,
    launch: Object.fromEntries(Object.entries(spec.launch).reverse()),
  };
  assert.equal(completionSpecHash(spec), completionSpecHash(reordered));
  assert.match(completionSpecHash(spec), /^[a-f0-9]{64}$/);
});

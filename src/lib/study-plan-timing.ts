import type { QuestionScope } from "@/lib/question-scope";

type SubtypePerformance = {
  name: string;
  total: number;
  averageDurationSeconds: number;
};

export type SubtypeTimingBenchmark = {
  category: string;
  type: string;
  initialSeconds: number;
  sampleCount: number;
  observedAverageSeconds: number | null;
  recommendedSeconds: number;
};

const categoryInitialSeconds: Record<string, number> = {
  常识判断: 30,
  言语理解: 55,
  数量关系: 90,
  判断推理: 60,
  资料分析: 75,
};

const subtypeInitialSeconds: Record<string, number> = {
  "言语理解 / 逻辑填空": 45,
  "言语理解 / 篇章阅读": 90,
  "言语理解 / 片段阅读": 60,
  "言语理解 / 语句排序": 55,
  "言语理解 / 语句填空": 45,
  "言语理解 / 标题选择": 50,
  "言语理解 / 细节判断": 60,
  "言语理解 / 主旨概括": 60,
  "数量关系 / 数字推理": 75,
  "数量关系 / 数学运算": 90,
  "数量关系 / 排列组合": 105,
  "数量关系 / 比例问题": 85,
  "数量关系 / 概率问题": 100,
  "数量关系 / 行程问题": 105,
  "数量关系 / 工程问题": 95,
  "判断推理 / 图形推理": 60,
  "判断推理 / 定义判断": 55,
  "判断推理 / 类比推理": 35,
  "判断推理 / 逻辑判断": 90,
  "判断推理 / 加强论证": 65,
  "判断推理 / 削弱论证": 65,
  "判断推理 / 条件推理": 90,
  "判断推理 / 数学运算": 90,
  "资料分析 / 综合材料": 75,
  "资料分析 / 文字材料": 80,
  "资料分析 / 图形材料": 70,
  "资料分析 / 表格材料": 75,
};

function roundedFive(value: number) {
  return Math.max(15, Math.round(value / 5) * 5);
}

export function initialSubtypeSeconds(category: string, type: string) {
  return subtypeInitialSeconds[`${category} / ${type}`] ||
    categoryInitialSeconds[category] ||
    60;
}

export function buildSubtypeTimingBenchmarks(
  subtypes: readonly SubtypePerformance[],
  catalog: readonly QuestionScope[] = [],
): SubtypeTimingBenchmark[] {
  const performanceMap = new Map(subtypes.map((item) => [item.name, item]));
  const names = new Set([
    ...catalog.map((scope) => `${scope.category} / ${scope.type}`),
    ...subtypes.map((subtype) => subtype.name),
  ]);
  return [...names].sort((left, right) => left.localeCompare(right, "zh-CN")).map((name) => {
    const [category = "", ...typeParts] = name.split(" / ");
    const type = typeParts.join(" / ");
    const subtype = performanceMap.get(name) || {
      name,
      total: 0,
      averageDurationSeconds: 0,
    };
    const initialSeconds = initialSubtypeSeconds(category, type);
    const observed =
      subtype.total >= 3 && subtype.averageDurationSeconds > 0
        ? Math.min(
            initialSeconds * 2.5,
            Math.max(initialSeconds * 0.5, subtype.averageDurationSeconds),
          )
        : null;
    const observedWeight = observed === null
      ? 0
      : Math.min(0.8, subtype.total / 40);
    const recommendedSeconds = roundedFive(
      initialSeconds * (1 - observedWeight) +
        (observed || initialSeconds) * observedWeight,
    );
    return {
      category,
      type,
      initialSeconds,
      sampleCount: subtype.total,
      observedAverageSeconds:
        observed === null ? null : Math.round(subtype.averageDurationSeconds),
      recommendedSeconds,
    };
  });
}

export function estimateTaskMinutes(
  questionCount: number,
  scopes: readonly QuestionScope[],
  benchmarks: readonly SubtypeTimingBenchmark[],
) {
  const benchmarkMap = new Map(
    benchmarks.map((item) => [`${item.category}\u0000${item.type}`, item]),
  );
  const seconds = scopes.length
    ? scopes.map((scope) =>
        benchmarkMap.get(`${scope.category}\u0000${scope.type}`)
          ?.recommendedSeconds ||
        initialSubtypeSeconds(scope.category, scope.type),
      )
    : [60];
  const averageSeconds =
    seconds.reduce((sum, value) => sum + value, 0) / seconds.length;
  return Math.max(5, Math.ceil((questionCount * averageSeconds) / 60));
}

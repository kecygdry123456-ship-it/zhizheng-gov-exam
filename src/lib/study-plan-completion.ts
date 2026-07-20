import { createHash } from "node:crypto";
import { z } from "zod";
import {
  EXAM_TEMPLATES,
  type ExamTemplateId,
} from "@/lib/exam-templates";
import {
  normalizeQuestionScopes,
  questionScopesLabel,
  questionScopesSchema,
  type QuestionScope,
} from "@/lib/question-scope";

const completionModuleValues = [
  "政治理论",
  "常识判断",
  "言语理解与表达",
  "数量关系",
  "判断推理",
  "资料分析",
] as const;

export type CompletionModule = (typeof completionModuleValues)[number];

const noneLaunchSchema = z.object({ kind: z.literal("NONE") }).strict();
const noneEvidenceSchema = z.object({ kind: z.literal("NONE") }).strict();
const selfEvidenceSchema = z
  .object({ kind: z.literal("SELF_CONFIRMATION") })
  .strict();

const difficultyRangeSchema = z
  .object({
    min: z.number().min(1).max(10),
    max: z.number().min(1).max(10),
  })
  .strict()
  .refine((value) => value.min <= value.max, {
    message: "最低难度不能高于最高难度",
    path: ["min"],
  });

const practiceCompletionSpecSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("PRACTICE"),
    method: z.literal("PROGRAM"),
    launch: z
      .object({
        kind: z.literal("PRACTICE"),
        questionCount: z.number().int().min(5).max(100),
        category: z.string().trim().min(1).max(30).nullable(),
        scopes: questionScopesSchema.optional(),
        questionPool: z
          .enum(["POLITICS", "GENERAL_KNOWLEDGE"])
          .nullable(),
        minDifficulty: z.number().min(1).max(10),
        maxDifficulty: z.number().min(1).max(10),
        durationMinutes: z.number().int().min(5).max(240).nullable(),
      })
      .strict(),
    evidence: z
      .object({
        kind: z.literal("TRAINING_REPORT"),
        mode: z.literal("PRACTICE"),
      })
      .strict(),
    minAnswered: z.number().int().min(5).max(100),
    minAccuracy: z.number().min(0).max(100).nullable(),
    maxElapsedSeconds: z.number().int().positive().max(14_400).nullable(),
    requiredModule: z.enum(completionModuleValues).nullable(),
    difficultyRange: difficultyRangeSchema,
    minCompleteMaterialGroups: z.number().int().min(0).max(20),
    requiredTemplateId: z.null(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.launch.minDifficulty > value.launch.maxDifficulty) {
      context.addIssue({
        code: "custom",
        path: ["launch", "minDifficulty"],
        message: "最低难度不能高于最高难度",
      });
    }
    if (
      value.launch.minDifficulty !== value.difficultyRange.min ||
      value.launch.maxDifficulty !== value.difficultyRange.max
    ) {
      context.addIssue({
        code: "custom",
        path: ["launch"],
        message: "启动难度必须与验收难度一致",
      });
    }
    if (value.launch.questionCount !== value.minAnswered) {
      context.addIssue({
        code: "custom",
        path: ["minAnswered"],
        message: "启动题量必须与最低作答量一致",
      });
    }
    if (
      (value.launch.durationMinutes === null) !==
        (value.maxElapsedSeconds === null) ||
      (value.launch.durationMinutes !== null &&
        value.maxElapsedSeconds !== null &&
        value.maxElapsedSeconds < value.launch.durationMinutes * 60)
    ) {
      context.addIssue({
        code: "custom",
        path: ["maxElapsedSeconds"],
        message: "验收最长用时不能短于建议完成时间",
      });
    }
    if (value.requiredModule === "资料分析") {
      if (value.minAnswered % 5 !== 0) {
        context.addIssue({
          code: "custom",
          path: ["minAnswered"],
          message: "资料分析题量必须是 5 的倍数",
        });
      }
      if (value.minCompleteMaterialGroups !== value.minAnswered / 5) {
        context.addIssue({
          code: "custom",
          path: ["minCompleteMaterialGroups"],
          message: "资料分析完整材料组数与题量不一致",
        });
      }
    } else if (value.minCompleteMaterialGroups !== 0) {
      context.addIssue({
        code: "custom",
        path: ["minCompleteMaterialGroups"],
        message: "非资料分析任务不得要求完整材料组",
      });
    }
    if (value.requiredModule === null) {
      if (value.launch.category !== null || value.launch.questionPool !== null || value.launch.scopes?.length) {
        context.addIssue({
          code: "custom",
          path: ["launch", "category"],
          message: "综合任务不得限定单一板块",
        });
      }
    } else if (value.requiredModule === "政治理论") {
      if (
        value.launch.category !== "常识判断" ||
        value.launch.questionPool !== "POLITICS"
      ) {
        context.addIssue({
          code: "custom",
          path: ["launch", "questionPool"],
          message: "政治理论必须使用政治题型池，不能按数据库板块直接筛选",
        });
      }
    } else if (value.requiredModule === "常识判断") {
      if (
        value.launch.category !== "常识判断" ||
        value.launch.questionPool !== "GENERAL_KNOWLEDGE"
      ) {
        context.addIssue({
          code: "custom",
          path: ["launch", "questionPool"],
          message: "常识判断必须排除政治理论题型池",
        });
      }
    } else {
      const expectedCategories: Record<
        Exclude<CompletionModule, "政治理论" | "常识判断">,
        string
      > = {
        言语理解与表达: "言语理解",
        数量关系: "数量关系",
        判断推理: "判断推理",
        资料分析: "资料分析",
      };
      if (
        value.launch.category !== expectedCategories[value.requiredModule] ||
        value.launch.questionPool !== null
      ) {
        context.addIssue({
          code: "custom",
          path: ["launch", "category"],
          message: "启动板块必须与验收板块一致",
        });
      }
    }
    if (
      value.launch.scopes?.some(
        (scope) =>
          value.launch.category !== null && scope.category !== value.launch.category,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["launch", "scopes"],
        message: "细分板块必须属于启动大板块",
      });
    }
  });

const examCompletionSpecSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("EXAM"),
    method: z.literal("PROGRAM"),
    launch: z
      .object({
        kind: z.literal("EXAM"),
        templateId: z.enum(["NATIONAL_PREFECTURE", "GUANGDONG_PROVINCE"]),
        questionCount: z.number().int().positive(),
        durationMinutes: z.number().int().positive(),
      })
      .strict(),
    evidence: z
      .object({
        kind: z.literal("TRAINING_REPORT"),
        mode: z.literal("EXAM"),
      })
      .strict(),
    minAnswered: z.number().int().positive(),
    minAccuracy: z.null(),
    maxElapsedSeconds: z.number().int().positive(),
    requiredModule: z.null(),
    difficultyRange: z.null(),
    minCompleteMaterialGroups: z.literal(0),
    requiredTemplateId: z.enum([
      "NATIONAL_PREFECTURE",
      "GUANGDONG_PROVINCE",
    ]),
  })
  .strict()
  .superRefine((value, context) => {
    const template = EXAM_TEMPLATES[value.requiredTemplateId];
    if (
      value.launch.templateId !== value.requiredTemplateId ||
      value.launch.questionCount !== template.questionCount ||
      value.launch.durationMinutes !== template.durationMinutes ||
      value.minAnswered !== template.questionCount ||
      value.maxElapsedSeconds !== template.durationMinutes * 60
    ) {
      context.addIssue({
        code: "custom",
        path: ["launch"],
        message: "正式模考必须使用固定卷型的题量和时长",
      });
    }
  });

const essayCompletionSpecSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("ESSAY"),
    method: z.literal("PROGRAM"),
    launch: z.object({ kind: z.literal("ESSAY") }).strict(),
    evidence: z.object({ kind: z.literal("ESSAY_SUBMISSION") }).strict(),
    minWordCount: z.number().int().min(20).max(5_000),
    minScore: z.number().int().min(0).max(100),
    withinWordLimit: z.boolean(),
    requiredTemplateId: z.null(),
  })
  .strict();

export const completionSpecSchema = z.discriminatedUnion("kind", [
  z
    .object({
      version: z.literal(1),
      kind: z.literal("NONE"),
      method: z.literal("NONE"),
      launch: noneLaunchSchema,
      evidence: noneEvidenceSchema,
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      kind: z.literal("SELF"),
      method: z.literal("SELF"),
      launch: noneLaunchSchema,
      evidence: selfEvidenceSchema,
    })
    .strict(),
  practiceCompletionSpecSchema,
  examCompletionSpecSchema,
  essayCompletionSpecSchema,
]);

export type CompletionSpec = z.infer<typeof completionSpecSchema>;

export type CompletionTaskInput = {
  type: string;
  title?: string | null;
  target?: string | null;
  minutes?: number | null;
  checkpoint?: string | null;
  module?: string | null;
  difficulty?: string | null;
  questionCount?: number | null;
  completionSpec?: unknown;
};

export type CompletionDerivationContext = {
  targetExam?: string | null;
  maxQuestionsPerTask?: number | null;
  accuracyProfile?: Partial<
    Record<CompletionModule, { accuracy: number; sampleSize: number }>
  >;
};

type ModuleResolution = {
  recognized: boolean;
  requiredModule: CompletionModule | null;
  category: string | null;
  scopes: QuestionScope[];
  questionPool: "POLITICS" | "GENERAL_KNOWLEDGE" | null;
};

const comprehensiveModule: ModuleResolution = {
  recognized: true,
  requiredModule: null,
  category: null,
  scopes: [],
  questionPool: null,
};

const moduleSubtypeCatalog = {
  言语理解: ["逻辑填空", "篇章阅读", "片段阅读", "语句排序", "语句填空", "标题选择", "细节判断", "主旨概括", "言语理解与表达", "言语理解与表达能力"],
  判断推理: ["图形推理", "定义判断", "类比推理", "逻辑判断", "加强论证", "削弱论证", "条件推理", "判断推理", "判断推理能力", "科技地理", "数学运算"],
  数量关系: ["数学运算", "数字推理", "排列组合", "比例问题", "概率问题", "行程问题", "工程问题", "数量关系"],
  资料分析: ["综合材料", "文字材料", "图形材料", "表格材料", "资料分析"],
  常识判断: ["政治理论", "习近平新时代中国特色社会主义思想", "马克思主义基本原理", "党史党建", "中国特色社会主义理论体系", "毛泽东思想", "政治常识", "时政常识", "时事政治", "科技地理", "历史人文", "法律常识", "经济常识", "管理常识", "常识应用能力", "科技常识", "行政常识", "宪法常识", "地理常识", "历史文化", "常识判断", "逻辑判断"],
} as const;

const politicalSubtypes = new Set([
  "政治理论", "习近平新时代中国特色社会主义思想", "马克思主义基本原理",
  "党史党建", "中国特色社会主义理论体系", "毛泽东思想", "政治常识",
  "时政常识", "时事政治",
]);

const categoryModules: Record<string, CompletionModule> = {
  言语理解: "言语理解与表达",
  判断推理: "判断推理",
  数量关系: "数量关系",
  资料分析: "资料分析",
  常识判断: "常识判断",
};

function moduleResolutionForScopes(category: keyof typeof moduleSubtypeCatalog, scopes: QuestionScope[]): ModuleResolution {
  const political = category === "常识判断" && scopes.length > 0 && scopes.every((scope) => politicalSubtypes.has(scope.type));
  return {
    recognized: true,
    requiredModule: political ? "政治理论" : categoryModules[category],
    category,
    scopes: normalizeQuestionScopes(scopes),
    questionPool: category === "常识判断"
      ? political ? "POLITICS" : "GENERAL_KNOWLEDGE"
      : null,
  };
}

function allScopesForCategory(category: keyof typeof moduleSubtypeCatalog, filter?: (type: string) => boolean) {
  return moduleSubtypeCatalog[category]
    .filter((type) => !filter || filter(type))
    .map((type) => ({ category, type }));
}

function resolveModule(value: unknown): ModuleResolution {
  const moduleName = typeof value === "string" ? value.trim() : "";
  if (!moduleName || /^(全部|综合|行测综合|综合能力|多板块)$/.test(moduleName)) {
    return comprehensiveModule;
  }

  const explicit = moduleName.match(/^([^/／]+)\s*[/／]\s*(.+)$/);
  if (explicit) {
    const category = explicit[1].trim() as keyof typeof moduleSubtypeCatalog;
    const types = explicit[2].split(/[、，,]/).map((item) => item.trim()).filter(Boolean);
    if (category in moduleSubtypeCatalog && types.every((type) => (moduleSubtypeCatalog[category] as readonly string[]).includes(type))) {
      return moduleResolutionForScopes(category, types.map((type) => ({ category, type })));
    }
  }

  const genericParents = ["政治理论", "常识判断", "言语理解", "言语理解与表达", "数量关系", "判断推理", "资料分析"];
  if (!genericParents.includes(moduleName)) {
    const preferredCategory: Record<string, keyof typeof moduleSubtypeCatalog> = {
      科技地理: "常识判断",
      逻辑判断: "判断推理",
      数学运算: "数量关系",
    };
    const canonicalCategories: Array<keyof typeof moduleSubtypeCatalog> = [
      "数量关系", "判断推理", "常识判断", "言语理解", "资料分析",
    ];
    for (const category of canonicalCategories) {
      const specific = (moduleSubtypeCatalog[category] as readonly string[])
        .filter((type) => type !== category && !genericParents.includes(type))
        .filter((type) => !preferredCategory[type] || preferredCategory[type] === category)
        .filter((type) => moduleName.includes(type));
      if (specific.length) {
        return moduleResolutionForScopes(
          category,
          [...new Set(specific)].map((type) => ({ category, type })),
        );
      }
    }
  }

  if (/政治|时政|党史|马克思|习近平/.test(moduleName)) {
    return moduleResolutionForScopes(
      "常识判断",
      allScopesForCategory("常识判断", (type) => politicalSubtypes.has(type)),
    );
  }
  if (/常识/.test(moduleName)) {
    return moduleResolutionForScopes(
      "常识判断",
      allScopesForCategory("常识判断", (type) => !politicalSubtypes.has(type)),
    );
  }
  if (/言语/.test(moduleName)) return moduleResolutionForScopes("言语理解", allScopesForCategory("言语理解"));
  if (/数量|数学|数字推理/.test(moduleName)) return moduleResolutionForScopes("数量关系", allScopesForCategory("数量关系"));
  if (/判断|图形|定义|类比|逻辑推理/.test(moduleName)) return moduleResolutionForScopes("判断推理", allScopesForCategory("判断推理"));
  if (/资料/.test(moduleName)) return moduleResolutionForScopes("资料分析", allScopesForCategory("资料分析"));
  return { recognized: false, requiredModule: null, category: null, scopes: [], questionPool: null };
}

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  if (value === null || value === undefined || value === "") {
    return Math.min(max, Math.max(min, Math.round(fallback)));
  }
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(max, Math.max(min, Math.round(number)))
    : fallback;
}

function difficultyRange(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  const explicit = text.match(
    /(\d+(?:\.\d+)?)\s*(?:[-~～至到])\s*(\d+(?:\.\d+)?)/,
  );
  if (explicit) {
    const left = Math.min(10, Math.max(1, Number(explicit[1])));
    const right = Math.min(10, Math.max(1, Number(explicit[2])));
    return { min: Math.min(left, right), max: Math.max(left, right) };
  }
  if (/基础.*(?:中等|进阶)|(?:中等|进阶).*基础/.test(text)) {
    return { min: 1, max: 7 };
  }
  if (/(?:中等|进阶).*(?:较难|困难)|(?:较难|困难).*(?:中等|进阶)/.test(text)) {
    return { min: 4, max: 10 };
  }
  if (/基础|简单|容易|入门|EASY/i.test(text)) return { min: 1, max: 4 };
  if (/较难|困难|高难|HARD/i.test(text)) return { min: 7, max: 10 };
  if (/中等|进阶|MEDIUM/i.test(text)) return { min: 4, max: 7 };
  return { min: 1, max: 10 };
}

function difficultyMidpoint(range: { min: number; max: number }) {
  return (range.min + range.max) / 2;
}

export const MODULE_ACCURACY_BASELINES: Record<CompletionModule, number> = {
  政治理论: 50,
  常识判断: 50,
  言语理解与表达: 80,
  判断推理: 75,
  资料分析: 70,
  数量关系: 60,
};

function roundToFive(value: number) {
  return Math.sign(value) * Math.round(Math.abs(value) / 5) * 5;
}

export function dynamicMinimumAccuracy(
  range: { min: number; max: number },
  taskType: string,
  requiredModule: CompletionModule | null = null,
  accuracyProfile?: CompletionDerivationContext["accuracyProfile"],
) {
  if (taskType === "ASSESSMENT") return null;
  const baseline = requiredModule
    ? MODULE_ACCURACY_BASELINES[requiredModule]
    : 70;
  const midpoint = difficultyMidpoint(range);
  const difficultyAdjustment = midpoint <= 3.5 ? 5 : midpoint >= 7.5 ? -5 : 0;
  const observed = requiredModule ? accuracyProfile?.[requiredModule] : undefined;
  const historyAdjustment =
    observed && observed.sampleSize >= 5
      ? Math.min(10, Math.max(-10, roundToFive((observed.accuracy - baseline) * 0.25)))
      : 0;
  return Math.min(90, Math.max(40, roundToFive(baseline + difficultyAdjustment + historyAdjustment)));
}

export function dynamicMaxElapsedSeconds(
  suggestedMinutes: number,
  requiredModule: CompletionModule | null,
  range: { min: number; max: number },
) {
  const moduleMultiplier =
    requiredModule === "数量关系"
      ? 1.6
      : requiredModule === "资料分析"
        ? 1.5
        : 1.25;
  const difficultyMultiplier = 1 +
    Math.max(0, difficultyMidpoint(range) - 5) * 0.04;
  const minutes = Math.ceil(
    suggestedMinutes * moduleMultiplier * difficultyMultiplier,
  );
  return Math.min(14_400, Math.max(suggestedMinutes * 60, minutes * 60));
}

function practiceQuestionCount(
  task: CompletionTaskInput,
  module: ModuleResolution,
  context: CompletionDerivationContext,
) {
  const minutes = clampInteger(task.minutes, 45, 5, 240);
  const maximum = clampInteger(context.maxQuestionsPerTask, 100, 5, 100);
  const requested =
    task.questionCount === null || task.questionCount === undefined
      ? null
      : clampInteger(task.questionCount, 5, 5, 100);
  const rateByModule: Partial<Record<CompletionModule, number>> = {
    政治理论: 0.85,
    常识判断: 0.85,
    言语理解与表达: 0.7,
    判断推理: 0.7,
    资料分析: 0.35,
    数量关系: 0.4,
  };
  const rate = module.requiredModule ? rateByModule[module.requiredModule] : undefined;
  const fallback = rate
    ? Math.max(5, Math.round(minutes * rate))
    : task.type === "ASSESSMENT"
      ? Math.max(10, Math.round(minutes / 2.5))
      : Math.max(10, Math.round(minutes / 3));
  // For the three higher-density modules, do not let a model-provided low
  // count erase the intended practice volume. Data and quantity stay lighter.
  let count = rate
    ? rate >= 0.7
      ? Math.max(fallback, requested ?? fallback)
      : Math.min(fallback, requested ?? fallback)
    : requested ?? fallback;
  count = Math.min(maximum, count);
  if (module.requiredModule === "资料分析") {
    count = Math.min(100, Math.max(5, Math.ceil(count / 5) * 5));
    if (count > maximum) {
      count = Math.max(5, Math.floor(maximum / 5) * 5);
    }
  }
  return count;
}

function resolveExamTemplate(
  task: CompletionTaskInput,
  context: CompletionDerivationContext,
): ExamTemplateId {
  const exam = `${context.targetExam || ""} ${task.title || ""} ${task.target || ""}`;
  return /广东|省考|省公务员/.test(exam)
    ? "GUANGDONG_PROVINCE"
    : "NATIONAL_PREFECTURE";
}

function selfSpec(): CompletionSpec {
  return {
    version: 1,
    kind: "SELF",
    method: "SELF",
    launch: { kind: "NONE" },
    evidence: { kind: "SELF_CONFIRMATION" },
  };
}

function noneSpec(): CompletionSpec {
  return {
    version: 1,
    kind: "NONE",
    method: "NONE",
    launch: { kind: "NONE" },
    evidence: { kind: "NONE" },
  };
}

export function deriveCompletionSpec(
  task: CompletionTaskInput,
  context: CompletionDerivationContext = {},
): CompletionSpec {
  const type = String(task.type || "").toUpperCase();
  if (type === "REST") return noneSpec();
  if (["KNOWLEDGE", "WRONG", "REVIEW"].includes(type)) return selfSpec();

  if (type === "ESSAY") {
    return {
      version: 1,
      kind: "ESSAY",
      method: "PROGRAM",
      launch: { kind: "ESSAY" },
      evidence: { kind: "ESSAY_SUBMISSION" },
      minWordCount: 160,
      minScore: 60,
      withinWordLimit: true,
      requiredTemplateId: null,
    };
  }

  if (type === "EXAM") {
    const templateId = resolveExamTemplate(task, context);
    const template = EXAM_TEMPLATES[templateId];
    const availableMinutes = clampInteger(task.minutes, 0, 0, 240);
    if (availableMinutes >= template.durationMinutes) {
      return {
        version: 1,
        kind: "EXAM",
        method: "PROGRAM",
        launch: {
          kind: "EXAM",
          templateId,
          questionCount: template.questionCount,
          durationMinutes: template.durationMinutes,
        },
        evidence: { kind: "TRAINING_REPORT", mode: "EXAM" },
        minAnswered: template.questionCount,
        minAccuracy: null,
        maxElapsedSeconds: template.durationMinutes * 60,
        requiredModule: null,
        difficultyRange: null,
        minCompleteMaterialGroups: 0,
        requiredTemplateId: templateId,
      };
    }
    return deriveCompletionSpec(
      {
        ...task,
        type: "ASSESSMENT",
        module: "行测综合",
        difficulty: "中等",
        questionCount: null,
      },
      context,
    );
  }

  if (!["ASSESSMENT", "PRACTICE", "TIMED_PRACTICE"].includes(type)) {
    return selfSpec();
  }

  const moduleResolution = resolveModule(task.module);
  if (
    !moduleResolution.recognized ||
    /申论/.test(String(task.module || ""))
  ) {
    return selfSpec();
  }
  const range = difficultyRange(task.difficulty);
  const count = practiceQuestionCount(task, moduleResolution, context);
  const durationMinutes = clampInteger(task.minutes, 45, 5, 240);
  const minAccuracy = dynamicMinimumAccuracy(
    range,
    type,
    moduleResolution.requiredModule,
    context.accuracyProfile,
  );
  const maxElapsedSeconds = dynamicMaxElapsedSeconds(
    durationMinutes,
    moduleResolution.requiredModule,
    range,
  );
  return completionSpecSchema.parse({
    version: 1,
    kind: "PRACTICE",
    method: "PROGRAM",
    launch: {
      kind: "PRACTICE",
      questionCount: count,
      category: moduleResolution.category,
      scopes: moduleResolution.scopes,
      questionPool: moduleResolution.questionPool,
      minDifficulty: range.min,
      maxDifficulty: range.max,
      durationMinutes,
    },
    evidence: { kind: "TRAINING_REPORT", mode: "PRACTICE" },
    minAnswered: count,
    minAccuracy,
    maxElapsedSeconds,
    requiredModule: moduleResolution.requiredModule,
    difficultyRange: range,
    minCompleteMaterialGroups:
      moduleResolution.requiredModule === "资料分析" ? count / 5 : 0,
    requiredTemplateId: null,
  });
}

function formatDifficulty(range: { min: number; max: number }) {
  return range.min === 1 && range.max === 10
    ? "题目难度不限"
    : `题目难度为 ${range.min}～${range.max} 分`;
}

export function checkpointForCompletionSpec(
  spec: CompletionSpec,
  selfCheckpoint?: string | null,
) {
  if (spec.kind === "NONE") return "休息任务无需验收";
  if (spec.kind === "SELF") {
    return selfCheckpoint?.trim() || "完成任务要求，并确认已经达到完成标准";
  }
  if (spec.kind === "ESSAY") {
    return `提交 1 道申论作答，正文不少于 ${spec.minWordCount} 字${
      spec.withinWordLimit ? "且不超过题目限字" : ""
    }，评分达到 ${spec.minScore} 分；提交后由系统验收`;
  }
  if (spec.kind === "EXAM") {
    const template = EXAM_TEMPLATES[spec.requiredTemplateId];
    return `完成${template.name} ${spec.minAnswered} 题，并在 ${template.durationMinutes} 分钟内交卷；交卷后由系统验收`;
  }

  const criteria = [`完成 ${spec.minAnswered} 题`];
  if (spec.launch.scopes?.length) criteria.push(`细分板块限定为${questionScopesLabel(spec.launch.scopes)}`);
  else if (spec.requiredModule) criteria.push(`板块限定为${spec.requiredModule}`);
  criteria.push(formatDifficulty(spec.difficultyRange));
  if (spec.minAccuracy !== null) {
    criteria.push(`正确率不低于 ${spec.minAccuracy}%`);
  }
  if (spec.maxElapsedSeconds !== null) {
    criteria.push(`总用时不超过 ${Math.round(spec.maxElapsedSeconds / 60)} 分钟`);
  }
  if (spec.minCompleteMaterialGroups > 0) {
    criteria.push(`完整作答 ${spec.minCompleteMaterialGroups} 组资料材料（每组 5 题）`);
  }
  return `${criteria.join("，")}；交卷后由系统验收`;
}

export function targetForCompletionSpec(
  spec: CompletionSpec,
  fallback: string,
) {
  if (spec.kind !== "PRACTICE") return fallback;
  const parts = [`完成${spec.minAnswered}题`];
  if (spec.minAccuracy !== null) parts.push(`正确率≥${spec.minAccuracy}%`);
  if (spec.maxElapsedSeconds !== null)
    parts.push(`验收用时≤${Math.round(spec.maxElapsedSeconds / 60)}分钟`);
  return parts.join("，");
}

function normalizeShortExam<T extends CompletionTaskInput>(
  task: T,
  context: CompletionDerivationContext,
): T {
  if (String(task.type).toUpperCase() !== "EXAM") return task;
  const template = EXAM_TEMPLATES[resolveExamTemplate(task, context)];
  const minutes = clampInteger(task.minutes, 0, 0, 240);
  if (minutes >= template.durationMinutes) {
    return {
      ...task,
      minutes: template.durationMinutes,
      questionCount: template.questionCount,
      module: "行测综合",
      difficulty: "正式卷型",
    };
  }
  return {
    ...task,
    type: "ASSESSMENT",
    title: String(task.title || "综合测评").replace(
      /正式卷型|整卷|模拟考试|模拟卷/g,
      "综合限时",
    ),
    target: "完成一组跨板块限时测评并查看训练总结",
    module: "行测综合",
    difficulty: "中等",
    questionCount: null,
  };
}

export function applyCompletionSpecs<T extends CompletionTaskInput>(
  tasks: readonly T[],
  context: CompletionDerivationContext = {},
): Array<Omit<T, "completionSpec"> & { completionSpec: CompletionSpec }> {
  return tasks.map((input) => {
    const task = normalizeShortExam(input, context);
    const spec = deriveCompletionSpec(task, context);
    const executableTask =
      spec.kind === "PRACTICE"
        ? {
            ...task,
            questionCount: spec.minAnswered,
            module: spec.launch.scopes?.length
              ? spec.launch.scopes.map((scope) => `${scope.category} / ${scope.type}`).join("、")
              : spec.requiredModule || task.module,
          }
        : spec.kind === "ESSAY"
          ? { ...task, questionCount: 1 }
          : task;
    return {
      ...executableTask,
      target: targetForCompletionSpec(
        spec,
        String(executableTask.target || "完成任务要求"),
      ),
      checkpoint: checkpointForCompletionSpec(spec, executableTask.checkpoint),
      completionSpec: spec,
    };
  });
}

export function parseCompletionSpec(value: unknown): CompletionSpec | null {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const candidate = record && "completionSpec" in record ? record.completionSpec : value;
  const parsed = completionSpecSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]),
  );
}

export function completionSpecHash(spec: CompletionSpec | unknown) {
  const parsed = completionSpecSchema.parse(spec);
  return createHash("sha256")
    .update(JSON.stringify(stableValue(parsed)))
    .digest("hex");
}

import { z } from "zod";
import { scorePaperDifficulty } from "@/lib/difficulty";
import { getEffectiveModelConnection } from "@/lib/model-config";
import { requestModelJsonObject } from "@/lib/model-json-client";

export type TrainingReportSubtype = {
  key: string;
  name: string;
  total: number;
  answered: number;
  correct: number;
  accuracy: number | null;
  durationSeconds: number;
  averageDurationSeconds: number;
  difficultyScore: number;
  /** Legacy reports may contain subtype-level evaluations. */
  evaluation?: string | null;
};

export type TrainingReportSection = {
  key: string;
  name: string;
  total: number;
  answered: number;
  correct: number;
  accuracy: number | null;
  durationSeconds: number;
  difficultyScore: number;
  evaluation: string | null;
  subtypes: TrainingReportSubtype[];
};

export type ReportQuestion = {
  id: string;
  category: string;
  type: string;
  difficultyScore: number;
  section?: string;
  subtype?: string;
};

export type ReportAttempt = {
  id: string;
  questionId: string;
  correct: boolean;
};

function roundedAccuracy(correct: number, answered: number) {
  return answered ? Math.round((correct / answered) * 1000) / 10 : null;
}

function safeDuration(value: unknown) {
  const duration = Number(value);
  return Number.isFinite(duration)
    ? Math.min(8 * 60 * 60, Math.max(0, Math.round(duration)))
    : 0;
}

export function normalizeQuestionDurations(
  questionIds: string[],
  input: Record<string, number>,
) {
  return Object.fromEntries(
    questionIds.map((id) => [id, safeDuration(input[id])]),
  );
}

export function fitQuestionDurationsToTotal(
  questionIds: string[],
  input: Record<string, number>,
  totalDuration: number,
) {
  const normalized = normalizeQuestionDurations(questionIds, input);
  const total = safeDuration(totalDuration);
  const sum = Object.values(normalized).reduce((value, item) => value + item, 0);
  if (!sum || sum <= total) return normalized;
  if (!total)
    return Object.fromEntries(questionIds.map((id) => [id, 0]));
  const scaled = questionIds.map((id) => {
    const exact = (normalized[id] * total) / sum;
    return { id, value: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  let remainder = total - scaled.reduce((value, item) => value + item.value, 0);
  for (const item of [...scaled].sort((left, right) => right.fraction - left.fraction)) {
    if (!remainder) break;
    item.value += 1;
    remainder -= 1;
  }
  return Object.fromEntries(scaled.map((item) => [item.id, item.value]));
}

export function buildTrainingReportSnapshot(input: {
  questions: ReportQuestion[];
  attempts: ReportAttempt[];
  questionDurations: Record<string, number>;
  durationSeconds: number;
}) {
  const attempts = new Map(input.attempts.map((attempt) => [attempt.questionId, attempt]));
  const durations = normalizeQuestionDurations(
    input.questions.map((question) => question.id),
    input.questionDurations,
  );
  const sectionMap = new Map<
    string,
    { name: string; questions: ReportQuestion[]; subtypeMap: Map<string, ReportQuestion[]> }
  >();
  for (const question of input.questions) {
    const sectionName = question.section || question.category;
    const subtypeName = question.subtype || question.type || sectionName;
    const section = sectionMap.get(sectionName) || {
      name: sectionName,
      questions: [],
      subtypeMap: new Map<string, ReportQuestion[]>(),
    };
    section.questions.push(question);
    section.subtypeMap.set(subtypeName, [
      ...(section.subtypeMap.get(subtypeName) || []),
      question,
    ]);
    sectionMap.set(sectionName, section);
  }

  const sections: TrainingReportSection[] = Array.from(sectionMap.values()).map(
    (section, sectionIndex) => {
      const subtypes = Array.from(section.subtypeMap, ([name, questions], subtypeIndex) => {
        const answered = questions.filter((question) => attempts.has(question.id)).length;
        const correct = questions.filter((question) => attempts.get(question.id)?.correct).length;
        const durationSeconds = questions.reduce(
          (sum, question) => sum + durations[question.id],
          0,
        );
        const answeredDurationSeconds = questions.reduce(
          (sum, question) =>
            sum + (attempts.has(question.id) ? durations[question.id] : 0),
          0,
        );
        return {
          key: `s${sectionIndex}-t${subtypeIndex}`,
          name,
          total: questions.length,
          answered,
          correct,
          accuracy: roundedAccuracy(correct, answered),
          durationSeconds,
          averageDurationSeconds: answered
            ? Math.round(answeredDurationSeconds / answered)
            : 0,
          difficultyScore: scorePaperDifficulty(
            questions.map((question) => question.difficultyScore),
          ),
        } satisfies TrainingReportSubtype;
      });
      const answered = subtypes.reduce((sum, subtype) => sum + subtype.answered, 0);
      const correct = subtypes.reduce((sum, subtype) => sum + subtype.correct, 0);
      return {
        key: `s${sectionIndex}`,
        name: section.name,
        total: section.questions.length,
        answered,
        correct,
        accuracy: roundedAccuracy(correct, answered),
        durationSeconds: subtypes.reduce(
          (sum, subtype) => sum + subtype.durationSeconds,
          0,
        ),
        difficultyScore: scorePaperDifficulty(
          section.questions.map((question) => question.difficultyScore),
        ),
        evaluation: null,
        subtypes,
      } satisfies TrainingReportSection;
    },
  );
  const allocatedDuration = sections.reduce(
    (sum, section) => sum + section.durationSeconds,
    0,
  );
  const durationSeconds = Math.max(safeDuration(input.durationSeconds), allocatedDuration);
  const answered = input.attempts.length;
  const correct = input.attempts.filter((attempt) => attempt.correct).length;
  return {
    sections,
    questionDurations: durations,
    durationSeconds,
    inactiveDurationSeconds: Math.max(0, durationSeconds - allocatedDuration),
    total: input.questions.length,
    answered,
    correct,
    accuracy: roundedAccuracy(correct, answered) || 0,
    difficultyScore: scorePaperDifficulty(
      input.questions.map((question) => question.difficultyScore),
    ),
  };
}

function difficultyText(score: number) {
  if (score < 4) return "基础";
  if (score < 7) return "中等";
  return "较高";
}

function sectionKey(section: TrainingReportSection, index: number) {
  return section.key || `s${index}`;
}

function fallbackSectionEvaluation(item: TrainingReportSection) {
  if (!item.answered)
    return `本次包含 ${item.total} 道${item.name}题，但没有提交答案，暂时无法判断该板块的掌握程度。`;
  const sample = item.answered < 3 ? "本板块作答样本较少，结论仅供参考。" : "";
  const weakest = [...item.subtypes]
    .filter((subtype) => subtype.answered)
    .sort((left, right) => (left.accuracy || 0) - (right.accuracy || 0))[0];
  const focus =
    weakest && item.subtypes.filter((subtype) => subtype.answered).length > 1
      ? `其中${weakest.name}的正确率相对较低，可优先复盘。`
      : "";
  if ((item.accuracy || 0) >= 85)
    return `${sample}${difficultyText(item.difficultyScore)}难度下，${item.name}整体正确率稳定，用时 ${item.durationSeconds} 秒。建议保持当前方法，并通过更高难度题检验稳定性。${focus}`;
  if ((item.accuracy || 0) >= 65)
    return `${sample}${difficultyText(item.difficultyScore)}难度下，${item.name}已具备一定基础，但仍有可压缩的失分空间。建议结合错题检查审题、方法选择和作答节奏。${focus}`;
  return `${sample}${difficultyText(item.difficultyScore)}难度下，${item.name}失分较多。建议先按题型归类复盘错误原因，再用同类基础题巩固方法。${focus}`;
}

export function fallbackTrainingEvaluation(input: {
  answered: number;
  correct: number;
  accuracy: number;
  difficultyScore: number;
  sections: TrainingReportSection[];
}) {
  const sectionEvaluations = input.sections.map((section, index) => ({
    key: sectionKey(section, index),
    evaluation: fallbackSectionEvaluation(section),
  }));
  const answeredSections = input.sections.filter((section) => section.answered);
  const weakest = [...answeredSections].sort(
    (left, right) => (left.accuracy || 0) - (right.accuracy || 0),
  )[0];
  const overallEvaluation = input.answered
    ? `本次共作答 ${input.answered} 题，正确率 ${input.accuracy}%，综合难度 ${input.difficultyScore}/10。${weakest ? `${weakest.name}是本轮优先复盘方向，` : ""}建议先核对错题原因，再安排一组针对性练习。`
    : `本次没有提交有效答案，暂时无法评价掌握程度。建议完成至少一组题目后再查看训练结论。`;
  return { overallEvaluation, sectionEvaluations };
}

const modelEvaluation = z.object({
  overallEvaluation: z.string().trim().min(1).max(1_200),
  sectionEvaluations: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(50),
        evaluation: z.string().trim().min(1).max(1_000),
      }),
    )
    .max(30),
});

const trainingEvaluationSystemPrompt = [
  "你是有经验、有判断力的公务员考试训练分析师。请基于给出的聚合数据分析本轮训练。",
  "只使用输入中的作答、正确率、用时和难度等信息，不推测用户身份，不虚构题目内容。",
  "只返回JSON对象，包含overallEvaluation字符串和sectionEvaluations数组；数组必须为每个大板块的给定key返回且只返回一项，每项包含key和evaluation。不要为细分题型单独生成评价，也不要输出Markdown或JSON之外的说明。",
  "在这个技术格式内可以自由发挥：自行决定篇幅、语气、分析重点、表达顺序和建议数量，不受固定字数或固定句式限制。",
  "每个大板块评价可以使用其细分题型数据作为分析依据，综合联系难度、正确率与节奏，判断优势、短板、可能的失分模式和复盘方向；细分数据是证据而不是逐项点评清单，不必机械复述全部指标，也不必套用统一模板。",
  "overallEvaluation要站在整次训练的角度比较各大板块，给出整体判断、复盘优先级和后续训练策略，不要简单拼接各板块评价。",
  "数据样本较少时自然体现判断的不确定性即可。评价应具体、诚实且有实际训练价值，避免空泛鼓励和超出数据的断言。",
].join("");

export async function generateTrainingEvaluation(input: {
  mode: string;
  total: number;
  answered: number;
  correct: number;
  accuracy: number;
  durationSeconds: number;
  difficultyScore: number;
  sections: TrainingReportSection[];
  allowModel?: boolean;
  beforeModelRequest?: () => Promise<boolean>;
  modelDeadlineAt?: number;
}) {
  const fallback = fallbackTrainingEvaluation(input);
  if (input.allowModel === false)
    return { ...fallback, status: "FALLBACK" as const, source: "DATA_RULES" };
  const connection = await getEffectiveModelConnection();
  if (!connection.apiKey || !connection.model)
    return { ...fallback, status: "FALLBACK" as const, source: "DATA_RULES" };
  try {
    const context = {
      mode: input.mode,
      total: input.total,
      answered: input.answered,
      correct: input.correct,
      accuracy: input.accuracy,
      durationSeconds: input.durationSeconds,
      difficultyScore: input.difficultyScore,
      sections: input.sections.map((section, sectionIndex) => ({
        key: sectionKey(section, sectionIndex),
        name: section.name,
        total: section.total,
        answered: section.answered,
        correct: section.correct,
        accuracy: section.accuracy,
        durationSeconds: section.durationSeconds,
        difficultyScore: section.difficultyScore,
        subtypes: section.subtypes.map((subtype) => ({
          name: subtype.name,
          total: subtype.total,
          answered: subtype.answered,
          correct: subtype.correct,
          accuracy: subtype.accuracy,
          durationSeconds: subtype.durationSeconds,
          averageDurationSeconds: subtype.averageDurationSeconds,
          difficultyScore: subtype.difficultyScore,
        })),
      })),
    };
    const raw = await requestModelJsonObject(
      connection,
      trainingEvaluationSystemPrompt,
      context,
      {
        beforeRequest: input.beforeModelRequest,
        deadlineAt: input.modelDeadlineAt,
      },
    );
    const parsed = modelEvaluation.safeParse(raw);
    if (!parsed.success) throw new Error("模型评价格式不正确");
    const expectedKeys = input.sections.map((section, index) =>
      sectionKey(section, index),
    );
    const resultMap = new Map(
      parsed.data.sectionEvaluations.map((item) => [item.key, item.evaluation]),
    );
    if (
      parsed.data.sectionEvaluations.length !== expectedKeys.length ||
      resultMap.size !== expectedKeys.length ||
      expectedKeys.some((key) => !resultMap.has(key))
    )
      throw new Error("模型未返回完整板块评价");
    return {
      overallEvaluation: parsed.data.overallEvaluation,
      sectionEvaluations: expectedKeys.map((key) => ({
        key,
        evaluation: resultMap.get(key)!,
      })),
      status: "READY" as const,
      source: "MODEL_API",
    };
  } catch {
    return { ...fallback, status: "FALLBACK" as const, source: "DATA_RULES" };
  }
}

export function applyTrainingEvaluation(
  sections: TrainingReportSection[],
  evaluations: { key: string; evaluation: string }[],
) {
  const map = new Map(evaluations.map((item) => [item.key, item.evaluation]));
  return sections.map((section, index) => {
    const key = sectionKey(section, index);
    return {
      ...section,
      key,
      evaluation: map.get(key) || section.evaluation || null,
    };
  });
}

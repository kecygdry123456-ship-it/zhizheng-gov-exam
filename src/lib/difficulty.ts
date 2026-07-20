export type DifficultyQuestion = {
  category: string;
  type: string;
  stem: string;
  options: string[];
  material?: string;
};

export type KnowledgeDifficultyContext = {
  corpusDocumentCount: number;
  termDocumentFrequency: ReadonlyMap<string, number>;
};

const categoryBase: Record<string, number> = {
  常识判断: 2.7,
  言语理解: 4.0,
  判断推理: 4.7,
  数量关系: 5.4,
  资料分析: 5.2,
};

const knowledgeStopWords = new Set([
  "下列", "关于", "说法", "表述", "正确", "错误", "不正确", "不属于",
  "包括", "不包括", "其中", "的是", "一项", "选项", "根据", "可以",
  "应当", "有关", "相关", "进行", "具有", "我国", "以下", "分别",
  "常识判断", "常识应用能力", "政治理论", "政治常识",
]);

const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });

export function extractKnowledgeTerms(question: DifficultyQuestion) {
  const text = [question.type, question.stem, ...question.options].join(" ");
  const terms = new Set<string>();
  for (const item of segmenter.segment(text)) {
    const term = item.segment.trim();
    if (
      item.isWordLike &&
      /^[\p{Script=Han}]{2,12}$/u.test(term) &&
      !knowledgeStopWords.has(term)
    )
      terms.add(term);
  }
  for (const match of text.matchAll(/《([^》]{2,18})》/g)) terms.add(match[1]);
  for (const match of text.matchAll(/(?:19|20)\d{2}年?/g)) terms.add(match[0]);
  return [...terms];
}

export function buildKnowledgeDifficultyContext(
  questions: DifficultyQuestion[],
): KnowledgeDifficultyContext {
  const termDocumentFrequency = new Map<string, number>();
  for (const question of questions) {
    for (const term of extractKnowledgeTerms(question))
      termDocumentFrequency.set(term, (termDocumentFrequency.get(term) || 0) + 1);
  }
  return { corpusDocumentCount: questions.length, termDocumentFrequency };
}

function knowledgeRarity(
  terms: string[],
  context?: KnowledgeDifficultyContext,
) {
  if (!terms.length) return 0;
  const scores = terms.map((term) => {
    if (context?.corpusDocumentCount) {
      const frequency = context.termDocumentFrequency.get(term) || 1;
      return Math.log((context.corpusDocumentCount + 1) / (frequency + 1)) /
        Math.log(context.corpusDocumentCount + 1);
    }
    return Math.min(1, Math.max(0.1, (term.length - 2) / 8));
  });
  const rarest = scores.sort((left, right) => right - left).slice(0, 6);
  return rarest.reduce((sum, value) => sum + value, 0) / rarest.length;
}

const hardTypePatterns: [RegExp, number][] = [
  [/排列组合|概率|工程|行程|几何|最值|容斥/, 1.0],
  [/条件推理|真假|分析推理|削弱|加强|论证/, 0.7],
  [/语句排序|篇章阅读|主旨|意图/, 0.45],
  [/增长率|基期|比重|平均数|倍数/, 0.55],
  [/法律|经济|科技|历史文化/, 0.3],
];

function clamp(value: number, min = 1, max = 10) {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

export function difficultyLabel(score: number) {
  if (score < 4) return "基础";
  if (score < 7) return "进阶";
  return "困难";
}

export function scoreQuestionDifficulty(
  question: DifficultyQuestion,
  attempts?: { total: number; wrong: number },
  knowledgeContext?: KnowledgeDifficultyContext,
) {
  let contentScore = categoryBase[question.category] ?? 5;
  if (question.category === "常识判断") {
    const terms = extractKnowledgeTerms(question);
    const statementMarkers = (question.stem.match(/[①②③④⑤⑥]/g) || []).length;
    const independentOptions = question.options.filter(
      (option) =>
        extractKnowledgeTerms({ ...question, stem: option, options: [] }).length,
    ).length;
    const knowledgePointCount = Math.min(
      8,
      Math.max(
        1,
        statementMarkers || independentOptions,
        Math.ceil(terms.length / 4),
      ),
    );
    contentScore += Math.min(1.4, (knowledgePointCount - 1) * 0.22);
    contentScore += knowledgeRarity(terms, knowledgeContext) * 0.7;
    // 题型只提供很弱的先验，主要区分来自知识点数量与题库稀有度。
    if (/政治理论|党史党建|时事政治|政治常识/.test(question.type))
      contentScore += 0.1;
    if (/不属于|不包括|不正确|错误的是|排序正确|对应正确|对应错误/.test(question.stem)) {
      contentScore += 0.2;
    }
    if (statementMarkers >= 2)
      contentScore += Math.min(0.5, statementMarkers * 0.12);
    if (/根本|本质|核心|前提|基础|标志|首次|首要|主要依据|直接依据/.test(question.stem)) {
      contentScore += 0.15;
    }
    const precisionMarkers = [
      ...(question.stem.match(/(?:19|20)\d{2}年?/g) || []),
      ...(question.stem.match(/第[一二三四五六七八九十百\d]+条/g) || []),
      ...(question.stem.match(/《[^》]+》/g) || []),
    ].length;
    contentScore += Math.min(0.55, precisionMarkers * 0.12);
  }
  for (const [pattern, weight] of hardTypePatterns) if (pattern.test(question.type)) contentScore += weight;

  const stemLength = question.stem.replace(/\s/g, "").length;
  contentScore += Math.min(1.1, Math.max(0, (stemLength - 45) / 240));
  const numberCount = (question.stem.match(/\d+(?:\.\d+)?%?/g) || []).length;
  contentScore += Math.min(0.8, numberCount * 0.1);
  const relationCount = (question.stem.match(/如果|只有|除非|至少|至多|同比|环比|占比|倍|增加|减少/g) || []).length;
  contentScore += Math.min(0.8, relationCount * 0.18);
  if (question.category === "资料分析") {
    const operationGroups = [
      /增长率|增速|同比|环比/,
      /增长量|增加量|减少量/,
      /基期|现期/,
      /比重|占比|份额/,
      /平均数|均值|人均|每单位/,
      /倍数|翻番|是.*倍/,
    ].filter((pattern) => pattern.test(question.stem)).length;
    contentScore += Math.min(1.05, operationGroups * 0.22);
    if (/年均增长|混合增长|贡献率|拉动增长|两期比重|平均数增长率|乘积增长率|间隔增长/.test(question.stem))
      contentScore += 0.65;
    if (/以下说法.*(?:正确|错误).*几|能够推出|不能推出/.test(question.stem))
      contentScore += 0.55;

    const material = question.material?.replace(/\s/g, "") || "";
    if (material) {
      const materialNumbers = (material.match(/\d+(?:\.\d+)?%?/g) || []).length;
      contentScore += Math.min(0.45, material.length / 2400);
      contentScore += Math.min(0.3, materialNumbers * 0.012);
    }
  }
  if (question.options.length > 4) contentScore += 0.35;

  const lengths = question.options.map((option) => option.replace(/\s/g, "").length);
  const optionMean = lengths.reduce((sum, value) => sum + value, 0) / Math.max(1, lengths.length);
  const optionVariance = lengths.reduce((sum, value) => sum + (value - optionMean) ** 2, 0) / Math.max(1, lengths.length);
  if (optionMean > 24) contentScore += 0.35;
  if (Math.sqrt(optionVariance) < Math.max(2, optionMean * 0.18)) contentScore += 0.25;
  // 将公考真题集中在中高难区的原始特征分拉伸到完整 10 分制，保留筛选区间的区分度。
  contentScore = clamp(1 + (contentScore - 2.5) * 1.7);

  if (!attempts || attempts.total < 5) return round1(contentScore);
  const priorWeight = 12;
  const observedDifficulty = 1 + 9 * ((attempts.wrong + (contentScore - 1) / 9 * priorWeight) / (attempts.total + priorWeight));
  return round1(clamp(contentScore * 0.65 + observedDifficulty * 0.35));
}

function percentile(sorted: number[], ratio: number) {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

export function scorePaperDifficulty(scores: number[]) {
  if (!scores.length) return 0;
  const normalized = scores.map((score) => clamp(score));
  const power = 2.4;
  const generalizedMean = (normalized.reduce((sum, score) => sum + score ** power, 0) / normalized.length) ** (1 / power);
  const sorted = [...normalized].sort((a, b) => a - b);
  const p80 = percentile(sorted, 0.8);
  const p95 = percentile(sorted, 0.95);
  const arithmeticMean = normalized.reduce((sum, score) => sum + score, 0) / normalized.length;
  const deviation = Math.sqrt(normalized.reduce((sum, score) => sum + (score - arithmeticMean) ** 2, 0) / normalized.length);
  const pressure = clamp(generalizedMean + deviation * 0.7);
  return round1(clamp(generalizedMean * 0.55 + p80 * 0.25 + p95 * 0.15 + pressure * 0.05));
}

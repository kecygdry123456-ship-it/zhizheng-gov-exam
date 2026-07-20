import { z } from "zod";
import { getEffectiveModelConnection } from "@/lib/model-config";
import { requestModelJsonObject } from "@/lib/model-json-client";
import { consumeLearningAnalysisModelRequest } from "@/lib/model-usage";

export type LearningAnalysisMetric = {
  name: string;
  total: number;
  correct: number;
  accuracy: number;
  averageDurationSeconds: number;
  averageDifficulty: number;
};

export type LearningAnalysisContext = {
  total: number;
  correct: number;
  accuracy: number;
  today: number;
  last7Days: { total: number; correct: number; accuracy: number | null };
  previous7Days: { total: number; correct: number; accuracy: number | null };
  weeklyCompletedTasks: number;
  categories: LearningAnalysisMetric[];
  subtypes: LearningAnalysisMetric[];
  daily: { date: string; total: number; correct: number }[];
  recentReports: {
    mode: string;
    title: string;
    answered: number;
    accuracy: number;
    difficultyScore: number;
    durationSeconds: number;
    completedAt: string;
  }[];
};

const modelLearningAnalysis = z
  .object({
    headline: z.string().trim().min(8).max(80),
    overall: z.string().trim().min(120).max(1_200),
    ability: z.string().trim().min(120).max(1_200),
    trend: z.string().trim().min(80).max(800),
    priorities: z.string().trim().min(100).max(1_000),
    trainingPlan: z.string().trim().min(160).max(1_400),
    caveat: z.string().trim().min(60).max(500),
    actions: z.array(z.string().trim().min(30).max(260)).min(4).max(6),
  })
  .strict();

export type LearningAnalysis = z.infer<typeof modelLearningAnalysis> & {
  source: "MODEL_API" | "DATA_RULES";
  generatedAt: string;
};

function percent(value: number | null) {
  return value === null ? "暂无有效样本" : `${value}%`;
}

function metricLabel(metric: LearningAnalysisMetric | undefined) {
  return metric
    ? `${metric.name}（${metric.total}题，正确率${metric.accuracy}%，平均难度${metric.averageDifficulty.toFixed(1)}/10）`
    : "暂无足够板块样本";
}

export function fallbackLearningAnalysis(
  context: LearningAnalysisContext,
): Omit<LearningAnalysis, "source" | "generatedAt"> {
  const ranked = [...context.categories]
    .filter((item) => item.total > 0)
    .sort(
      (left, right) =>
        right.accuracy - left.accuracy || right.total - left.total,
    );
  const strongest = ranked[0];
  const weakest = ranked.at(-1);
  const weakestSubtypes = [...context.subtypes]
    .filter((item) => item.total >= 2)
    .sort(
      (left, right) =>
        left.accuracy - right.accuracy || right.total - left.total,
    )
    .slice(0, 3);
  const trendDifference =
    context.last7Days.accuracy !== null &&
    context.previous7Days.accuracy !== null
      ? Math.round(
          (context.last7Days.accuracy - context.previous7Days.accuracy) * 10,
        ) / 10
      : null;
  const trendText =
    trendDifference === null
      ? "近两周尚未形成可以稳定比较的连续样本，因此当前更适合建立基线，而不是根据少量波动判断能力升降。"
      : trendDifference > 0
        ? `近7天正确率比前7天提高${trendDifference}个百分点，方向是积极的，但仍需用同板块、相近难度题组复测，确认提升来自方法稳定而非题目偶然偏易。`
        : trendDifference < 0
          ? `近7天正确率比前7天下降${Math.abs(trendDifference)}个百分点，应先核对训练难度、用时压力和板块构成，再判断是正常难度升级还是方法与节奏出现回退。`
          : "近7天与前7天正确率基本持平，说明当前表现进入平台期；下一阶段应通过细分题型和题均用时寻找突破口。";
  const weakSubtypeText = weakestSubtypes.length
    ? weakestSubtypes.map(metricLabel).join("、")
    : "细分题型样本仍少，暂不能可靠定位到更小的知识点";

  return {
    headline: context.total
      ? "从累计表现转向可验证的板块提升"
      : "先建立有效样本，再形成个性化判断",
    overall: context.total
      ? `目前累计完成${context.total}道题，答对${context.correct}道，总体正确率为${context.accuracy}%。近7天完成${context.last7Days.total}道题，并有${context.weeklyCompletedTasks}个任务通过系统验收。当前数据已经能够描述训练覆盖面和大致表现，但总体正确率不能单独代表真实水平：题目难度、板块构成、限时程度和样本数量都会影响结果。后续判断应优先比较相同板块、相近难度下的正确率与题均用时，并通过连续题组确认变化。`
      : "当前账号还没有形成有效作答样本，系统暂时无法对优势、短板和趋势作出可靠结论。此时最有价值的做法不是追求一个看似精确的总体评分，而是先完成覆盖主要行测板块的诊断训练，记录正确率、用时和错因。形成第一批可比较数据后，再决定应优先补知识、改方法还是提速度。",
    ability: strongest && weakest
      ? `从现有板块数据看，相对表现较好的是${metricLabel(strongest)}，相对需要优先核查的是${metricLabel(weakest)}。这是一种基于当前样本的相对排序，不等于前者已经稳固或后者一定薄弱。进一步下钻后，当前优先关注的细分题型包括${weakSubtypeText}。复盘时应把错误分成知识缺口、题型识别、推理步骤、计算失误和时间分配五类，避免只重做答案而没有改变下一次作答过程。`
      : "板块样本尚不足以形成可靠排序。建议首轮诊断同时覆盖常识判断、言语理解与表达、判断推理、资料分析和数量关系，并尽量保持难度与限时条件一致。完成后先看每个板块是否有足够题量，再比较正确率；样本少于一组时，只记录现象，不急于给能力贴标签。",
    trend: `${trendText} 近7天共作答${context.last7Days.total}题，正确率为${percent(context.last7Days.accuracy)}；前7天共作答${context.previous7Days.total}题，正确率为${percent(context.previous7Days.accuracy)}。同时要观察训练频率是否集中在少数日期，避免用一次突击结果替代稳定趋势。`,
    priorities: weakest
      ? `第一优先级应放在${weakest.name}，但训练目标不是单纯增加刷题量，而是先用一组基础到中等难度题确认主要失分类型，再进行针对性训练。第二优先级是保持优势板块的手感，使用较短题组验证正确率是否稳定。若弱项正确率上升但用时明显恶化，应暂缓提高难度；若正确率和速度同时改善，再逐步增加难度或缩短限时。`
      : "当前第一优先级是完成诊断并补齐数据，而不是直接安排高难度或大题量。诊断后选择一个失分最集中且样本足够的板块作为主攻方向，再选择一个表现较稳的板块做保持训练。每次训练只改变一个关键变量，例如难度、题量或限时，才能判断调整是否真正有效。",
    trainingPlan: `下一阶段建议采用“诊断、复盘、同类验证、再评估”的闭环。先完成一组与当前水平匹配的计时题，训练结束后立即记录错因和超时题；随后只复盘最集中的一至两类问题，并写出可执行的识别信号或解题步骤；间隔一段时间后，用相近难度的新题复测，比较正确率和题均用时。常识、言语和判断可安排相对更多题量以形成稳定样本，资料和数量应减少单次题量，给阅读、列式、计算与检查留出时间。连续两组达到各板块动态验收线且用时没有恶化时再升级难度；连续两组未达标时，应降低难度或缩小题型范围，而不是继续机械加量。`,
    caveat: `本分析仅依据系统中已记录的作答、用时、难度、训练报告和验收记录。样本分布不均、未计时作答或短期集中刷题都会降低结论稳定性，因此所有优先级都应通过下一组同条件训练复核。`,
    actions: [
      weakest
        ? `完成一组${weakest.name}基础到中等难度计时题，训练后把错题按知识、方法、计算和时间四类归因，并保留本次正确率与题均用时。`
        : "完成一组覆盖主要板块的诊断题，确保每个板块都有作答记录，并保存正确率、题均用时和主要错因。",
      "从本轮错误最多的题型中选一类，整理至少两条可在读题阶段识别的信号，再用新的同类题验证，而不是直接重看答案。",
      "下一次训练保持板块和难度相近，只调整一个变量；若正确率提高且题均用时不增加，才把该方法视为有效改进。",
      "资料分析和数量关系采用较小题组并完整记录过程；常识、言语和判断采用较大题组，以减少偶然对错对结论的影响。",
    ],
  };
}

const learningAnalysisPrompt = [
  "你是资深公务员考试学习分析师。请根据输入的累计作答、近两周趋势、板块和细分题型、难度、用时、近期训练报告及系统验收任务数，撰写一份较长、具体、可执行的中文学习分析。",
  "只使用输入数据，不虚构题目内容、考试成绩、用户身份或未发生的训练。要区分样本事实、合理判断和仍需验证的假设；样本少时明确说明不确定性。",
  "分析总篇幅应约900至1600个汉字，不能只给一句建议。比较板块时同时考虑正确率、样本量、平均难度与题均用时，不要把少量样本直接判定为稳定优势或短板。",
  "只返回JSON对象，字段必须是headline、overall、ability、trend、priorities、trainingPlan、caveat和actions。前七个字段为连贯中文段落；actions为4至6条可验收行动，每条包含明确训练对象、做法或判断条件。",
  "overall给出总体画像和证据边界；ability比较板块与细分题型；trend比较近7天与前7天；priorities说明优先级及原因；trainingPlan给出诊断、复盘、复测和升降难度规则；caveat说明数据限制。",
  "避免空泛鼓励、固定模板和机械复述全部指标，不输出Markdown，不输出JSON之外的说明。",
].join("");

export async function generateLearningAnalysis(
  userId: string,
  context: LearningAnalysisContext,
): Promise<LearningAnalysis> {
  const fallback = fallbackLearningAnalysis(context);
  const generatedAt = new Date().toISOString();
  const connection = await getEffectiveModelConnection();
  if (!connection.apiKey || !connection.model) {
    return { ...fallback, source: "DATA_RULES", generatedAt };
  }
  try {
    const raw = await requestModelJsonObject(
      connection,
      learningAnalysisPrompt,
      context,
      { beforeRequest: () => consumeLearningAnalysisModelRequest(userId) },
    );
    const parsed = modelLearningAnalysis.safeParse(raw);
    if (!parsed.success) throw new Error("模型学习分析格式不正确");
    return { ...parsed.data, source: "MODEL_API", generatedAt };
  } catch {
    return { ...fallback, source: "DATA_RULES", generatedAt };
  }
}

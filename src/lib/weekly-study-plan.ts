import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getEffectiveModelConnection, type ModelConnection } from "@/lib/model-config";
import { requestModelJsonObject } from "@/lib/model-json-client";
import type { WeeklyStudyPlanGoal } from "@/components/app/types";

const goalSchema = z.object({
  title: z.string().trim().min(1).max(160),
  objective: z.string().trim().min(1).max(500),
  focusAreas: z.array(z.string().trim().min(1).max(100)).min(1).max(6),
  successCriteria: z.array(z.string().trim().min(1).max(300)).min(1).max(5),
  rationale: z.string().trim().min(1).max(500),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]),
  allocationPercent: z.number().int().min(1).max(100).nullable().optional(),
});

const strategySchema = z.object({
  phase: z.string().trim().min(1).max(200),
  objective: z.string().trim().min(1).max(600),
  priorities: z.array(z.object({
    area: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(1).max(400),
    allocationPercent: z.number().int().min(1).max(100).nullable().optional(),
  })).min(1).max(6),
  rhythm: z.string().trim().min(1).max(600),
  adjustmentRules: z.array(z.string().trim().min(1).max(400)).min(1).max(8),
});

const weeklyResultSchema = z.object({
  summary: z.string().trim().min(1).max(1_200),
  goals: z.array(goalSchema).min(3).max(5),
  strategy: strategySchema,
});

type WeeklyResult = z.infer<typeof weeklyResultSchema>;

const prompt = [
  "你是公务员考试阶段规划教练。只规划未来七天要达成的3到5个阶段性目标，不安排每天做什么。",
  "只返回JSON对象，包含summary、goals、strategy。每个goal包含title、objective、focusAreas、successCriteria、rationale、priority和可选allocationPercent。",
  "禁止输出day、日期、周一至周日、每天任务、具体题量排期或逐日时间表；focusAreas必须精确到大板块/细分题型。",
  "目标必须可验收，结合近期答题记录、训练报告、申论记录、用户设置和上一份周规划；不要虚构没有提供的数据。",
].join("");

function text(value: unknown, fallback: string, max: number) {
  const result = typeof value === "string" ? value.trim() : "";
  return (result || fallback).slice(0, max);
}

function list(value: unknown, fallback: string[], max: number) {
  if (!Array.isArray(value)) return fallback.slice(0, max);
  const result = value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim().slice(0, 300)).slice(0, max);
  return result.length ? result : fallback.slice(0, max);
}

function priority(value: unknown): "HIGH" | "MEDIUM" | "LOW" {
  const normalized = String(value || "").toUpperCase();
  return normalized === "HIGH" || normalized === "LOW" ? normalized : "MEDIUM";
}

function fallbackPlan(target: string, areas: string[], accuracy: number | null): WeeklyResult {
  const primary = areas[0] || "行测综合";
  const secondary = areas[1] || "判断推理 / 图形推理";
  const accuracyText = accuracy === null ? "建立可靠基线" : `将近期正确率从 ${accuracy}% 稳定提升并记录题均用时`;
  return {
    summary: `本周围绕 ${primary} 和 ${secondary} 建立可验证的阶段提升，完成训练、错题闭环和一次综合复盘；具体每日任务由“每日任务”模块滚动生成。`,
    goals: [
      { title: `${primary}能力提升`, objective: accuracyText, focusAreas: [primary], successCriteria: ["完成该细分板块的训练记录", "对主要错因形成可复用方法"], rationale: "近期表现或用户设置将其列为优先方向", priority: "HIGH", allocationPercent: 45 },
      { title: `${secondary}稳定训练`, objective: "保持第二重点板块的正确率和速度，不因集中补弱而失去连续性", focusAreas: [secondary], successCriteria: ["完成至少两次有效训练记录", "速度与正确率至少一项改善"], rationale: "保持能力结构均衡", priority: "MEDIUM", allocationPercent: 30 },
      { title: "错题与综合迁移闭环", objective: "把本周错误转化为方法，并用综合结果检验迁移效果", focusAreas: ["错题复盘", "行测综合"], successCriteria: ["整理本周高频错因", "完成一次综合复盘并提出下周调整项"], rationale: "避免只刷题不吸收", priority: "MEDIUM", allocationPercent: 25 },
    ],
    strategy: {
      phase: "阶段性提升",
      objective: `本周先稳住 ${primary}，再用 ${secondary} 和综合复盘验证迁移。`,
      priorities: [
        { area: primary, reason: "当前数据或用户重点指向", allocationPercent: 45 },
        { area: secondary, reason: "保持第二重点连续性", allocationPercent: 30 },
        { area: "复盘与综合", reason: "形成闭环", allocationPercent: 25 },
      ],
      rhythm: "每日任务根据当天完成情况自动滚动生成；本周只检查阶段目标，不预先规定每天安排。",
      adjustmentRules: ["连续两次达到标准后提高难度", "正确率下降且用时上升时先复盘再加量", "周末依据训练报告调整下一周重点"],
    },
  };
}

function normalize(raw: Record<string, unknown>, fallback: WeeklyResult): WeeklyResult | null {
  const source = raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)
    ? raw.data as Record<string, unknown>
    : raw;
  const goals = Array.isArray(source.goals) ? source.goals.slice(0, 5).flatMap((value, index) => {
    const item = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
    if (!item) return [];
    const base = fallback.goals[index % fallback.goals.length];
    return [{
      title: text(item.title, base.title, 160),
      objective: text(item.objective, base.objective, 500),
      focusAreas: list(item.focusAreas, base.focusAreas, 6),
      successCriteria: list(item.successCriteria, base.successCriteria, 5),
      rationale: text(item.rationale, base.rationale, 500),
      priority: priority(item.priority),
      allocationPercent: typeof item.allocationPercent === "number" ? Math.max(1, Math.min(100, Math.round(item.allocationPercent))) : base.allocationPercent,
    } satisfies WeeklyStudyPlanGoal];
  }) : [];
  if (goals.length < 3) return null;
  const rawStrategy = source.strategy && typeof source.strategy === "object" && !Array.isArray(source.strategy) ? source.strategy as Record<string, unknown> : {};
  const strategyPriorities = Array.isArray(rawStrategy.priorities)
    ? rawStrategy.priorities.slice(0, 6).flatMap((value, index) => {
        const item = value && typeof value === "object" && !Array.isArray(value)
          ? value as Record<string, unknown>
          : null;
        if (!item) return [];
        const base = fallback.strategy.priorities[index % fallback.strategy.priorities.length];
        return [{
          area: text(item.area, base.area, 120),
          reason: text(item.reason, base.reason, 400),
          allocationPercent: typeof item.allocationPercent === "number"
            ? Math.max(1, Math.min(100, Math.round(item.allocationPercent)))
            : base.allocationPercent,
        }];
      })
    : [];
  const strategy = {
    phase: text(rawStrategy.phase, fallback.strategy.phase, 200),
    objective: text(rawStrategy.objective, fallback.strategy.objective, 600),
    priorities: strategyPriorities.length ? strategyPriorities : fallback.strategy.priorities,
    rhythm: text(rawStrategy.rhythm, fallback.strategy.rhythm, 600),
    adjustmentRules: list(rawStrategy.adjustmentRules, fallback.strategy.adjustmentRules, 8),
  };
  const result = { summary: text(source.summary, fallback.summary, 1_200), goals, strategy };
  if (/[周星期][一二三四五六日天]|每天|逐日|day\s*\d/i.test(JSON.stringify(result))) return null;
  const parsed = weeklyResultSchema.safeParse(result);
  return parsed.success ? parsed.data : null;
}

export async function generateWeeklyStudyPlan(userId: string, connection?: ModelConnection) {
  const now = new Date();
  const since = new Date(now.getTime() - 90 * 86_400_000);
  const [user, attempts, reports, essays, latestDaily, previous] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { targetExam: true } }),
    prisma.attempt.findMany({ where: { userId, createdAt: { gte: since } }, take: 1_000, orderBy: { createdAt: "desc" }, select: { correct: true, question: { select: { category: { select: { name: true } }, type: true } } } }),
    prisma.trainingReport.findMany({ where: { userId }, take: 8, orderBy: { completedAt: "desc" }, select: { title: true, accuracy: true, mode: true, completedAt: true, sections: true } }),
    prisma.essaySubmission.findMany({ where: { userId }, take: 8, orderBy: { createdAt: "desc" }, select: { score: true, wordCount: true, createdAt: true, question: { select: { type: true } } } }),
    prisma.studyPlan.findFirst({ where: { userId, schemaVersion: { gte: 5 } }, orderBy: { generatedAt: "desc" }, select: { inputSnapshot: true } }),
    prisma.weeklyStudyPlan.findFirst({ where: { userId }, orderBy: { generatedAt: "desc" }, select: { summary: true, goals: true, strategy: true, generatedAt: true } }),
  ]);
  const grouped = new Map<string, { total: number; correct: number }>();
  for (const attempt of attempts) {
    const name = `${attempt.question.category.name} / ${attempt.question.type}`;
    const row = grouped.get(name) || { total: 0, correct: 0 };
    row.total += 1;
    if (attempt.correct) row.correct += 1;
    grouped.set(name, row);
  }
  const areas = [...grouped.entries()].sort((a, b) => a[1].correct / a[1].total - b[1].correct / b[1].total).map(([name]) => name);
  const weakest = areas[0] ? Math.round((grouped.get(areas[0])!.correct / grouped.get(areas[0])!.total) * 1000) / 10 : null;
  const fallback = fallbackPlan(user?.targetExam || "公考", areas, weakest);
  const preferences = latestDaily?.inputSnapshot && typeof latestDaily.inputSnapshot === "object" && !Array.isArray(latestDaily.inputSnapshot)
    ? (latestDaily.inputSnapshot as Record<string, unknown>).preferences || null
    : null;
  const context = {
    generatedAt: now.toISOString(),
    period: "未来一周阶段目标",
    preferences,
    performance: {
      sampledAttempts: attempts.length,
      focusAreas: areas.slice(0, 8),
      recentReports: reports.map((report) => ({ ...report, completedAt: report.completedAt.toISOString() })),
      recentEssays: essays.map((essay) => ({ type: essay.question.type, score: essay.score, wordCount: essay.wordCount, createdAt: essay.createdAt.toISOString() })),
    },
    previousPlan: previous || null,
  };
  let result = fallback;
  let source = "DATA_RULES";
  const model = connection || await getEffectiveModelConnection();
  if (model.apiKey && model.model) {
    try {
      const raw = await requestModelJsonObject(model, prompt, context, { deadlineAt: Date.now() + 60_000 });
      const normalized = raw ? normalize(raw, fallback) : null;
      if (normalized) { result = normalized; source = "MODEL_API"; }
    } catch { /* fallback remains deterministic */ }
  }
  const expiresAt = new Date(now.getTime() + 7 * 86_400_000);
  return prisma.weeklyStudyPlan.create({ data: { userId, title: `${user?.targetExam || "公考"} · 一周阶段规划`, summary: result.summary, goals: result.goals, strategy: result.strategy, source, inputSnapshot: context, expiresAt, schemaVersion: 1 } });
}

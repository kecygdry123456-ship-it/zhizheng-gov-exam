"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Clock3,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  SlidersHorizontal,
} from "lucide-react";
import type {
  AnswerResult,
  DifficultyMode,
  PublicQuestion,
  QuestionSession,
  QuestionSetOptions,
  StudyPlanLaunchContext,
  TrainingPreference,
  TrainingRecommendation,
  TrainingReport,
} from "./types";
import { EmptyState, LoadingState, PageTitle } from "./ui";
import {
  MaterialQuestionWorkspace,
  type MaterialQuestionItem,
} from "./material-question-workspace";
import { plainQuestionText, QuestionContent } from "./question-content";
import {
  defaultPreference,
  difficultyPresets,
  loadTrainingPreference,
  rangeForMode,
  saveTrainingPreference,
} from "./training-config";
import { TrainingReportView } from "./training-report-view";
import { completeTrainingEvaluation } from "./training-report-client";
import { useActiveQuestionTiming } from "./use-active-question-timing";
import {
  PracticeScopeSelector,
  type PracticeCategory,
} from "./practice-scope-selector";
import {
  normalizeQuestionScopes,
  questionScopesLabel,
} from "@/lib/question-scope";

type AnswerState = { selected: number; result: AnswerResult };
type ActivePractice = {
  id: string;
  questions: PublicQuestion[];
  answerStates: Record<string, AnswerState>;
  questionDurations: Record<string, number>;
  config: QuestionSetOptions & { availableTotal?: number };
  paperDifficulty: number;
  currentIndex: number;
  startedAt: string;
  paused: boolean;
  pausedAt?: string | null;
  pausedDurationSeconds: number;
  studyPlanId?: string | null;
  studyPlanTaskKey?: string | null;
  planContext?: { planId?: string; taskKey?: string; taskIndex?: number } | null;
};

type ApiBody<T> = {
  data?: T;
  error?: { message?: string };
};

function categoryScopes(categories: PracticeCategory[], categoryName?: string | null) {
  const category = categories.find((item) => item.name === categoryName);
  return category
    ? category.subtypes.map((subtype) => ({
        category: category.name,
        type: subtype.name,
      }))
    : [];
}

function restoredOptions(
  options: QuestionSetOptions,
  categories: PracticeCategory[],
): QuestionSetOptions {
  const scopes = normalizeQuestionScopes(options.scopes);
  const legacyScopes = scopes.length
    ? scopes
    : categoryScopes(categories, options.category);
  return {
    ...options,
    category: legacyScopes.length ? "" : options.category || "",
    scopes: legacyScopes,
  };
}

function formatElapsedTime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

async function readApiBody<T>(response: Response) {
  return (await response.json().catch(() => null)) as ApiBody<T> | null;
}

export function PracticeView({
  questions,
  total,
  paperDifficulty,
  favorites,
  onAnswer,
  onFavorite,
  onReload,
  onCompleted,
  planContext,
  onPlanEvidence,
  onOpenPlan,
  onExitPlanTask,
}: {
  questions: PublicQuestion[];
  total: number;
  paperDifficulty: number;
  favorites: string[];
  onAnswer: (
    id: string,
    selected: number,
    mode?: "PRACTICE" | "EXAM",
    duration?: number,
    practiceSessionId?: string,
  ) => Promise<AnswerResult>;
  onFavorite: (id: string) => Promise<void>;
  onReload: (options?: QuestionSetOptions) => Promise<QuestionSession>;
  onCompleted?: () => void;
  planContext?: StudyPlanLaunchContext | null;
  onPlanEvidence?: (evidenceId: string) => void;
  onOpenPlan?: () => void;
  onExitPlanTask?: () => void;
}) {
  const planContextRef = useRef(planContext);
  useEffect(() => {
    planContextRef.current = planContext;
  }, [planContext]);
  const planIdentity = planContext
    ? `${planContext.planId}:${planContext.taskKey}:${planContext.taskIndex}`
    : "";
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);
  const [answerStates, setAnswerStates] = useState<Record<string, AnswerState>>(
    {},
  );
  const submittingQuestionIds = useRef(new Set<string>());
  const [categories, setCategories] = useState<PracticeCategory[]>([]);
  const categoriesRef = useRef<PracticeCategory[]>([]);
  useEffect(() => {
    categoriesRef.current = categories;
  }, [categories]);
  const [booting, setBooting] = useState(true);
  const [settings, setSettings] = useState<QuestionSetOptions>({
    count: 20,
    category: "",
    scopes: [],
    minDifficulty: 1,
    maxDifficulty: 10,
  });
  const [difficultyMode, setDifficultyMode] =
    useState<DifficultyMode>("CUSTOM");
  const [preference, setPreference] =
    useState<TrainingPreference>(defaultPreference);
  const [recommendation, setRecommendation] =
    useState<TrainingRecommendation | null>(null);
  const [available, setAvailable] = useState(0);
  const [activeQuestions, setActiveQuestions] =
    useState<PublicQuestion[]>(questions);
  const [runTotal, setRunTotal] = useState(total);
  const [runPaperDifficulty, setRunPaperDifficulty] =
    useState(paperDifficulty);
  const [practiceSessionId, setPracticeSessionId] = useState<string | null>(null);
  const [practiceStartedAt, setPracticeStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [paused, setPaused] = useState(false);
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [pausedDurationSeconds, setPausedDurationSeconds] = useState(0);
  const [changingPause, setChangingPause] = useState(false);
  const [progressDockCollapsed, setProgressDockCollapsed] = useState(false);
  const [trainingReport, setTrainingReport] =
    useState<TrainingReport | null>(null);
  const [completing, setCompleting] = useState(false);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [evaluationError, setEvaluationError] = useState("");
  const evaluationTarget = useRef<string | null>(null);
  const {
    activate: activateTiming,
    reset: resetTiming,
    snapshot: timingSnapshot,
  } = useActiveQuestionTiming((questionId, durationSeconds) => {
    if (!practiceSessionId) return;
    void fetch(`/api/practice-sessions/${practiceSessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId, durationSeconds }),
      keepalive: true,
    });
  });
  const restoreActiveSession = useCallback(
    (active: ActivePractice, availableCategories: PracticeCategory[] = categoriesRef.current) => {
      const restoredIndex = Math.min(
        Math.max(0, active.currentIndex),
        Math.max(0, active.questions.length - 1),
      );
      const restored = active.answerStates || {};
      const restoredAnswer = restored[active.questions[restoredIndex]?.id];
      const context = planContextRef.current;
      const launch =
        context?.completionSpec.kind === "PRACTICE"
          ? context.completionSpec.launch
          : null;
      setPracticeSessionId(active.id);
      setPracticeStartedAt(new Date(active.startedAt).getTime());
      setPaused(Boolean(active.paused));
      setPausedAt(active.pausedAt ? new Date(active.pausedAt).getTime() : null);
      setPausedDurationSeconds(active.pausedDurationSeconds || 0);
      setActiveQuestions(active.questions);
      setSettings(
        launch
          ? {
              count: launch.questionCount,
              category: launch.category || "",
              scopes: normalizeQuestionScopes(launch.scopes),
              questionPool: launch.questionPool || undefined,
              minDifficulty: launch.minDifficulty,
              maxDifficulty: launch.maxDifficulty,
            }
          : restoredOptions({
              count: active.config.count || active.questions.length,
              category: active.config.category || "",
              scopes: active.config.scopes,
              questionPool: active.config.questionPool,
              minDifficulty: active.config.minDifficulty,
              maxDifficulty: active.config.maxDifficulty,
            }, availableCategories),
      );
      setRunTotal(active.config?.availableTotal || active.questions.length);
      setRunPaperDifficulty(active.paperDifficulty);
      setIndex(restoredIndex);
      setAnswerStates(restored);
      setSelected(restoredAnswer?.selected ?? null);
      setResult(restoredAnswer?.result ?? null);
      setCompleted(false);
      setTrainingReport(null);
      setCompleting(false);
      setNavigatorOpen(false);
      setEvaluationError("");
      evaluationTarget.current = null;
      submittingQuestionIds.current.clear();
      resetTiming(active.questionDurations || {});
      activateTiming(active.paused ? null : active.questions[restoredIndex]?.id || null);
    },
    [activateTiming, resetTiming],
  );
  const beginSession = useCallback(
    async (
      generated: QuestionSession,
      options: QuestionSetOptions,
      replacesSessionId: string | null = null,
    ) => {
      const context = planContextRef.current;
      if (context && generated.items.length !== options.count) {
        throw new Error(
          generated.items.length
            ? `当前细分板块仅能组成 ${generated.items.length} 题，未达到计划要求的 ${options.count} 题，请返回每日任务重新生成`
            : "当前计划指定的细分板块暂无可用题目，请返回每日任务重新生成",
        );
      }
      if (!generated.items.length) {
        throw new Error("当前条件下没有可用题目，请调整训练设置");
      }
      const response = await fetch("/api/practice-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionIds: generated.items.map((item) => item.id),
          config: { ...options, availableTotal: generated.total },
          ...(planContextRef.current
            ? {
                planContext: {
                  planId: planContextRef.current.planId,
                  taskKey: planContextRef.current.taskKey,
                  taskIndex: planContextRef.current.taskIndex,
                },
              }
            : {}),
          ...(replacesSessionId ? { replacesSessionId } : {}),
        }),
      });
      const body = await readApiBody<{ id: string; startedAt: string }>(response);
      if (response.status === 409) {
        const activeResponse = await fetch("/api/practice-sessions");
        const activeBody = await readApiBody<ActivePractice | null>(activeResponse);
        if (!activeResponse.ok)
          throw new Error(
            activeBody?.error?.message || "专项练习恢复失败",
          );
        if (!activeBody || !("data" in activeBody))
          throw new Error("专项练习恢复响应格式不正确");
        if (!activeBody.data)
          throw new Error(
            body?.error?.message || "专项练习状态已变化，请重新生成题组",
          );
        restoreActiveSession(activeBody.data);
        return false;
      }
      if (!response.ok)
        throw new Error(body?.error?.message || "专项练习启动失败");
      if (!body?.data?.id)
        throw new Error("专项练习启动响应格式不正确");
      setPracticeSessionId(body.data.id);
      setPracticeStartedAt(new Date(body.data.startedAt).getTime());
      setPaused(false);
      setPausedAt(null);
      setPausedDurationSeconds(0);
      setActiveQuestions(generated.items);
      setRunTotal(generated.total);
      setRunPaperDifficulty(generated.paperDifficulty);
      setIndex(0);
      setSelected(null);
      setResult(null);
      setCompleted(false);
      setAnswerStates({});
      submittingQuestionIds.current.clear();
      setTrainingReport(null);
      setCompleting(false);
      setNavigatorOpen(false);
      setEvaluationError("");
      evaluationTarget.current = null;
      resetTiming();
      activateTiming(generated.items[0]?.id || null);
      return true;
    },
    [activateTiming, resetTiming, restoreActiveSession],
  );

  useEffect(() => {
    if (!practiceStartedAt || !practiceSessionId || completed) return;
    const update = () => {
      const now = pausedAt || Date.now();
      setElapsedSeconds(Math.max(
        0,
        Math.floor((now - practiceStartedAt) / 1000) - pausedDurationSeconds,
      ));
    };
    update();
    const timer = window.setInterval(update, 1_000);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
    };
  }, [completed, pausedAt, pausedDurationSeconds, practiceSessionId, practiceStartedAt]);

  useEffect(() => {
    queueMicrotask(async () => {
      try {
        const [categoryBody, config, activeResponse] = await Promise.all([
          fetch("/api/categories").then((response) => response.json()),
          loadTrainingPreference(),
          fetch("/api/practice-sessions"),
        ]);
        const activeBody = await readApiBody<ActivePractice | null>(activeResponse);
        if (!activeResponse.ok)
          throw new Error(
            activeBody?.error?.message || "专项练习恢复失败",
          );
        if (!activeBody || !("data" in activeBody))
          throw new Error("专项练习恢复响应格式不正确");
        setCategories(categoryBody.data || []);
        setPreference(config.preference);
        setRecommendation(config.recommendation);
        const value = config.preference;
        const context = planContextRef.current;
        const launch = context?.completionSpec.kind === "PRACTICE"
          ? context.completionSpec.launch
          : null;
        const next: QuestionSetOptions = launch
          ? {
              count: launch.questionCount,
              category: launch.category || "",
              scopes: normalizeQuestionScopes(launch.scopes),
              questionPool: launch.questionPool || undefined,
              minDifficulty: launch.minDifficulty,
              maxDifficulty: launch.maxDifficulty,
            }
          : restoredOptions({
              count: value.practiceCount,
              category: value.practiceCategory || "",
              scopes: normalizeQuestionScopes(value.practiceScopes),
              minDifficulty: value.practiceMinDifficulty,
              maxDifficulty: value.practiceMaxDifficulty,
            }, categoryBody.data || []);
        setSettings(next);
        setDifficultyMode(launch ? "CUSTOM" : value.practiceDifficultyMode);
        if (activeBody.data) {
          const active = activeBody.data;
          const activePlanId = active.studyPlanId || active.planContext?.planId;
          const activeTaskKey =
            active.studyPlanTaskKey || active.planContext?.taskKey;
          if (
            context &&
            (activePlanId !== context.planId || activeTaskKey !== context.taskKey)
          ) {
            const generated = await onReload(next);
            await beginSession(generated, next, active.id);
          } else {
            restoreActiveSession(active, categoryBody.data || []);
          }
        } else {
          const generated = await onReload(next);
          await beginSession(generated, next, null);
        }
      } catch (reason) {
        setCategories([]);
        setActiveQuestions([]);
        setPracticeSessionId(null);
        setError(reason instanceof Error ? reason.message : "专项练习恢复失败");
      } finally {
        setBooting(false);
      }
    });
  }, [beginSession, onReload, planIdentity, restoreActiveSession]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        minDifficulty: String(settings.minDifficulty),
        maxDifficulty: String(settings.maxDifficulty),
      });
      if (settings.category) params.set("category", settings.category);
      if (settings.scopes?.length) params.set("scopes", JSON.stringify(settings.scopes));
      if (settings.questionPool) params.set("questionPool", settings.questionPool);
      fetch(`/api/questions/availability?${params}`)
        .then((response) => response.json())
        .then((body) => setAvailable(body.data?.total || 0))
        .catch(() => setAvailable(0));
    }, 250);
    return () => clearTimeout(timer);
  }, [settings.category, settings.scopes, settings.minDifficulty, settings.maxDifficulty, settings.questionPool]);

  const applySettings = async () => {
    setApplying(true);
    setError("");
    try {
      const nextPreference = {
        ...preference,
        practiceCount: settings.count,
        practiceCategory: settings.scopes?.length ? null : settings.category || null,
        practiceScopes: normalizeQuestionScopes(settings.scopes),
        practiceDifficultyMode: difficultyMode,
        practiceMinDifficulty: settings.minDifficulty,
        practiceMaxDifficulty: settings.maxDifficulty,
      };
      await saveTrainingPreference(nextPreference);
      setPreference(nextPreference);
      const session = await onReload(settings);
      const startedFresh = await beginSession(
        session,
        settings,
        practiceSessionId,
      );
      if (startedFresh && session.items.length < settings.count)
        setError(
          settings.category === "资料分析" || settings.scopes?.some((scope) => scope.category === "资料分析")
            ? `资料分析按完整 5 题组题，本次题量调整为 ${session.items.length} 道。`
            : `当前筛选条件只有 ${session.items.length} 道可用题目，已全部加入本轮训练。`,
        );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "组题失败");
    } finally {
      setApplying(false);
    }
  };

  const replaceQuestionSet = async () => {
    if (applying || completing || paused) return;
    const deadline = Date.now() + 8_000;
    while (
      submittingQuestionIds.current.size > 0 &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => window.setTimeout(resolve, 80));
    }
    if (submittingQuestionIds.current.size > 0) {
      setError("当前作答仍在保存，请稍后再换题");
      return;
    }
    await applySettings();
  };

  const question = activeQuestions[index];
  const materialQuestionItems: MaterialQuestionItem[] = question?.materialId
    ? activeQuestions
        .map((item, itemIndex) => ({ question: item, index: itemIndex }))
        .filter((item) => item.question.materialId === question.materialId)
        .sort(
          (left, right) =>
            (left.question.materialOrder ?? left.index) -
            (right.question.materialOrder ?? right.index),
        )
    : [];
  const applyMode = (mode: DifficultyMode) => {
    setDifficultyMode(mode);
    if (mode === "CUSTOM") return;
    const range = rangeForMode(mode, recommendation, {
      min: settings.minDifficulty,
      max: settings.maxDifficulty,
    });
    setSettings({
      ...settings,
      minDifficulty: range.min,
      maxDifficulty: range.max,
      ...(mode === "RECOMMENDED" && recommendation?.category
        ? {
            category: recommendation.scopes?.length ? "" : recommendation.category,
            scopes: recommendation.scopes?.length
              ? normalizeQuestionScopes(recommendation.scopes)
              : categoryScopes(categories, recommendation.category),
          }
        : {}),
    });
  };
  if (booting) return <LoadingState text="正在恢复专项训练配置…" />;
  if (!question)
    return (
      <div className="fade">
        {planContext && (
          <PlanTaskBanner title={planContext.taskTitle} onExit={() => void exitPlanTask()} />
        )}
        <PageTitle
          title="专项练习"
          description="先设置板块、难度和题量，再生成训练题组。"
        />
        {!planContext && (
          <Settings
            categories={categories}
            settings={settings}
            setSettings={setSettings}
            difficultyMode={difficultyMode}
            applyMode={applyMode}
            recommendation={recommendation}
            available={available}
            applying={applying || saving}
            onApply={applySettings}
          />
        )}
        {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
        <EmptyState text="当前条件下没有可用题目，请调整训练设置" />
      </div>
    );
  if (completed && trainingReport)
    return <>
      {planContext && (
        <PlanTaskBanner
          title={planContext.taskTitle}
          evidenceReady
          onOpenPlan={onOpenPlan}
          onExit={() => void exitPlanTask()}
        />
      )}
      <TrainingReportView
      report={trainingReport}
      title="专项练习已完成"
      description="本轮统计与练习评价已保存，可随时回看。"
      evaluationError={evaluationError}
      onRetryEvaluation={() => void evaluateReport(trainingReport.id)}
      actions={<>
        <button
          onClick={() => void restartPractice()}
          disabled={applying}
          className="btn-primary"
        >{applying ? "正在启动…" : "重新练习"}</button>
        <button onClick={() => setCompleted(false)} className="btn-ghost">调整设置</button>
      </>}
      />
    </>;

  async function restartPractice() {
    if (applying) return;
    setApplying(true);
    setEvaluationError("");
    try {
      await beginSession(
        {
          items: activeQuestions,
          total: runTotal,
          requested: activeQuestions.length,
          materialGroups: new Set(
            activeQuestions.map((item) => item.materialId).filter(Boolean),
          ).size,
          paperDifficulty: runPaperDifficulty,
        },
        settings,
        null,
      );
    } catch (reason) {
      setEvaluationError(
        reason instanceof Error ? reason.message : "专项练习启动失败",
      );
    } finally {
      setApplying(false);
    }
  }

  const togglePause = async () => {
    if (!practiceSessionId || changingPause || saving || completing) return;
    setChangingPause(true);
    setError("");
    const nextPaused = !paused;
    if (nextPaused) activateTiming(null);
    try {
      const response = await fetch(`/api/practice-sessions/${practiceSessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: nextPaused }),
      });
      const body = await readApiBody<{
        paused: boolean;
        pausedAt: string | null;
        pausedDurationSeconds: number;
      }>(response);
      if (!response.ok)
        throw new Error(body?.error?.message || "暂停状态保存失败");
      const state = body?.data;
      if (!state) throw new Error("暂停状态响应格式不正确");
      setPaused(state.paused);
      setPausedAt(state.pausedAt ? new Date(state.pausedAt).getTime() : null);
      setPausedDurationSeconds(state.pausedDurationSeconds);
      if (!state.paused) activateTiming(question.id);
    } catch (reason) {
      if (nextPaused) activateTiming(question.id);
      setError(reason instanceof Error ? reason.message : "暂停状态保存失败");
    } finally {
      setChangingPause(false);
    }
  };

  const submitAnswer = async (submittedAnswer: number, targetIndex = index) => {
    const targetQuestion = activeQuestions[targetIndex];
    if (
      !targetQuestion ||
      paused ||
      saving ||
      submittingQuestionIds.current.has(targetQuestion.id)
    )
      return;
    const submittedQuestionId = targetQuestion.id;
    const submittedIndex = targetIndex;
    const previousAnswer = answerStates[submittedQuestionId];
    const wasAnswered = Boolean(previousAnswer);
    let answerAccepted = false;
    submittingQuestionIds.current.add(submittedQuestionId);
    if (submittedIndex !== index) {
      activateTiming(submittedQuestionId);
      setIndex(submittedIndex);
      setResult(previousAnswer?.result ?? null);
      setNavigatorOpen(false);
      if (practiceSessionId)
        void fetch(`/api/practice-sessions/${practiceSessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentIndex: submittedIndex }),
          keepalive: true,
        });
    }
    setSelected(submittedAnswer);
    setSaving(true);
    setError("");
    try {
      if (!practiceSessionId)
        throw new Error("专项练习会话不存在，请重新生成题组");
      activateTiming(null);
      const duration = timingSnapshot()[submittedQuestionId] || 0;
      const nextResult = await onAnswer(
        submittedQuestionId,
        submittedAnswer,
        "PRACTICE",
        duration,
        practiceSessionId,
      );
      answerAccepted = true;
      setAnswerStates((value) => ({
        ...value,
        [submittedQuestionId]: {
          selected: nextResult.selected,
          result: nextResult,
        },
      }));
      setSelected(nextResult.selected);
      setResult(nextResult);
      if (!wasAnswered && submittedIndex < activeQuestions.length - 1) {
        choose(submittedIndex + 1, true);
      } else {
        activateTiming(submittedQuestionId);
      }
    } catch (reason) {
      setSelected(previousAnswer?.selected ?? null);
      setResult(previousAnswer?.result ?? null);
      setError(reason instanceof Error ? reason.message : "提交失败");
    } finally {
      if (!answerAccepted) activateTiming(submittedQuestionId);
      submittingQuestionIds.current.delete(submittedQuestionId);
      setSaving(false);
    }
  };
  const choose = (next: number, allowWhileSaving = false) => {
    if (paused || (!allowWhileSaving && saving) || completing) return;
    const savedAnswer = answerStates[activeQuestions[next]?.id];
    activateTiming(activeQuestions[next]?.id || null);
    setIndex(next);
    setSelected(savedAnswer?.selected ?? null);
    setResult(savedAnswer?.result ?? null);
    setError("");
    setNavigatorOpen(false);
    if (practiceSessionId)
      void fetch(`/api/practice-sessions/${practiceSessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentIndex: next }),
        keepalive: true,
      });
  };
  async function evaluateReport(reportId: string) {
    evaluationTarget.current = reportId;
    setEvaluationError("");
    try {
      const evaluated = await completeTrainingEvaluation(reportId);
      if (evaluationTarget.current !== reportId) return;
      setTrainingReport((current) =>
        current?.id === reportId ? evaluated : current,
      );
    } catch (reason) {
      if (evaluationTarget.current === reportId)
        setEvaluationError(
          reason instanceof Error ? reason.message : "练习评价生成失败",
        );
    }
  }
  async function exitPlanTask() {
    if (practiceSessionId) {
      activateTiming(null);
      const response = await fetch(`/api/practice-sessions/${practiceSessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ABANDONED" }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error?.message || "退出计划任务失败，请重试");
        return;
      }
      setPracticeSessionId(null);
      setPracticeStartedAt(null);
      setActiveQuestions([]);
      resetTiming();
    }
    onExitPlanTask?.();
  }
  const finishPractice = async () => {
    if (completing) return false;
    setCompleting(true);
    setError("");
    try {
      if (!practiceSessionId)
        throw new Error("专项练习会话不存在，请重新生成题组");
      activateTiming(null);
      const questionDurations = timingSnapshot();
      await Promise.all(
        Object.entries(questionDurations).map(([questionId, durationSeconds]) =>
          fetch(`/api/practice-sessions/${practiceSessionId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ questionId, durationSeconds }),
          }).then(async (response) => {
            if (!response.ok) {
              const body = await response.json();
              throw new Error(body.error?.message || "练习用时保存失败");
            }
          }),
        ),
      );
      const response = await fetch("/api/training-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          practiceSessionId,
          title: settings.scopes?.length
            ? `${questionScopesLabel(settings.scopes)}专项练习`
            : settings.category
              ? `${settings.category}专项练习`
            : "综合专项练习",
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message || "练习总结生成失败");
      const created = body.data as TrainingReport;
      setPracticeSessionId(null);
      setPracticeStartedAt(null);
      setTrainingReport(created);
      setCompleted(true);
      onCompleted?.();
      onPlanEvidence?.(created.id);
      window.scrollTo({ top: 0 });
      void evaluateReport(created.id);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "练习总结生成失败");
      return false;
    } finally {
      setCompleting(false);
    }
  };

  const renderMaterialPracticeQuestion = (item: MaterialQuestionItem) => {
    const itemQuestion = item.question;
    const savedAnswer = answerStates[itemQuestion.id];
    const itemSelected =
      item.index === index ? selected : (savedAnswer?.selected ?? null);
    return (
      <>
        <div className="material-question-meta justify-between">
          <span>
            {itemQuestion.type} · 难度 {itemQuestion.difficultyScore.toFixed(1)}/10 · 第 {item.index + 1} 题
          </span>
          <button
            type="button"
            aria-label={`收藏第 ${item.index + 1} 题`}
            onClick={() =>
              onFavorite(itemQuestion.id).catch((reason) =>
                setError(reason.message),
              )
            }
            className="touch-target grid shrink-0 place-items-center border-0 bg-transparent text-xl text-amber-500"
          >
            {favorites.includes(itemQuestion.id) ? "★" : "☆"}
          </button>
        </div>
        <p className="material-question-stem">
          <b className="mr-2">{item.index + 1}.</b>
          <QuestionContent content={itemQuestion.stem} />
        </p>
        <div className="material-question-options">
          {itemQuestion.options.map((option, optionIndex) => (
            <button
              key={`${optionIndex}-${option}`}
              type="button"
              disabled={saving || completing || paused}
              onClick={() => void submitAnswer(optionIndex, item.index)}
              aria-label={`${String.fromCharCode(65 + optionIndex)}. ${plainQuestionText(option)}`}
              className={`material-question-option ${itemSelected === optionIndex ? "is-selected" : ""}`}
            >
              <span className="material-option-letter">
                {String.fromCharCode(65 + optionIndex)}
              </span>
              <span className="material-option-content">
                <QuestionContent content={option} variant="option" />
              </span>
            </button>
          ))}
        </div>
        {itemQuestion.paperTitle && (
          <p className="mt-4 text-xs text-slate-400">
            来源：{itemQuestion.paperTitle}
          </p>
        )}
      </>
    );
  };

  const progressPanel = (
    <div className="practice-progress-panel p-5">
      <div className="flex justify-between">
        <b>练习进度</b>
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <span className="flex items-center gap-1 font-mono text-indigo-600" aria-label="专项练习已用时间">
            <Clock3 size={15} aria-hidden="true" />
            {formatElapsedTime(elapsedSeconds)}
          </span>
          <span>{index + 1}/{activeQuestions.length}</span>
        </div>
      </div>
      <div className="progress mt-4">
        <i style={{ width: `${((index + 1) / activeQuestions.length) * 100}%` }} />
      </div>
      <button
        onClick={() => void togglePause()}
        disabled={changingPause || saving || completing}
        className="btn-ghost mt-4 w-full disabled:opacity-40"
      >
        {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
        {changingPause ? "正在保存…" : paused ? "继续练习" : "暂停练习"}
      </button>
      {paused && (
        <p className="mt-3 text-center text-xs font-medium text-amber-700">
          练习已暂停，继续后才能作答
        </p>
      )}
      <button
        onClick={() => setNavigatorOpen((value) => !value)}
        aria-expanded={navigatorOpen}
        className="compact-nav-toggle btn-ghost mt-4 w-full items-center justify-between"
      >
        <span>已作答 {Object.keys(answerStates).length}/{activeQuestions.length}</span>
        <span>{navigatorOpen ? "收起题号" : "展开题号"}</span>
      </button>
      <div className={`compact-nav-grid mt-5 grid grid-cols-5 gap-2 ${navigatorOpen ? "open" : ""}`}>
        {activeQuestions.map((item, itemIndex) => (
          <button
            key={item.id}
            onClick={() => choose(itemIndex)}
            disabled={saving || completing || paused}
            aria-label={`第 ${itemIndex + 1} 题${answerStates[item.id] ? "，已作答" : ""}`}
            className={`touch-target grid h-11 place-items-center rounded border text-xs ${itemIndex === index ? "border-orange-500 bg-orange-50 text-orange-600" : answerStates[item.id] ? "border-green-300 bg-green-50 text-green-700" : "border-slate-200"}`}
          >
            {itemIndex + 1}
          </button>
        ))}
      </div>
      {Object.keys(answerStates).length > 0 && (
        <button
          onClick={() => void finishPractice()}
          disabled={saving || completing || paused}
          className="btn-primary mt-4 w-full disabled:opacity-40"
        >
          {completing
            ? "正在生成总结…"
            : Object.keys(answerStates).length === activeQuestions.length
              ? "确认交卷"
              : "提前交卷"}
        </button>
      )}
      <button
        type="button"
        onClick={() => void replaceQuestionSet()}
        disabled={applying || completing || paused}
        className="btn-ghost mt-4 w-full disabled:opacity-50"
      >
        {applying ? "正在换题…" : saving ? "保存后换题" : "换一组题目"}
      </button>
      {error && (
        <p role="alert" className="mt-3 text-sm leading-6 text-red-500">
          {error}
        </p>
      )}
    </div>
  );

  const progressDock = (
    <aside
      className={`practice-progress-dock card ${progressDockCollapsed ? "is-collapsed" : ""}`}
      aria-label="练习进度面板"
    >
      <div className="practice-progress-dock-bar">
        <button
          type="button"
          onClick={() => setProgressDockCollapsed((value) => !value)}
          aria-label={progressDockCollapsed ? "展开练习工具" : "收起练习工具"}
          title={progressDockCollapsed ? "展开练习工具" : "收起练习工具"}
        >
          {progressDockCollapsed ? (
            <PanelRightOpen size={19} aria-hidden="true" />
          ) : (
            <PanelRightClose size={19} aria-hidden="true" />
          )}
        </button>
        {!progressDockCollapsed && (
          <span>{index + 1}/{activeQuestions.length}</span>
        )}
      </div>
      <div className="practice-progress-dock-content">{progressPanel}</div>
    </aside>
  );

  const syncPanel = (
    <div className="card p-5 text-sm text-slate-500">
      <b className="text-slate-800">数据同步</b>
      <p className="mt-3 leading-6">作答、收藏和错题会自动保存到当前账号。</p>
    </div>
  );

  return (
    <div className="fade">
      {planContext && (
        <PlanTaskBanner title={planContext.taskTitle} onExit={() => void exitPlanTask()} />
      )}
      <PageTitle
        title="专项练习"
        description={`本轮 ${activeQuestions.length} 道，符合条件题库共 ${runTotal} 道，套题难度 ${runPaperDifficulty.toFixed(1)}/10。`}
      />
      {!planContext && (
        <Settings
          categories={categories}
          settings={settings}
          setSettings={setSettings}
          difficultyMode={difficultyMode}
          applyMode={applyMode}
          recommendation={recommendation}
          available={available}
          applying={applying || saving}
          onApply={applySettings}
        />
      )}
      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}
      {question.material && materialQuestionItems.length ? (
        <>
          <div className="material-mobile-toolbar" aria-label="专项练习快捷工具">
            <span className="flex items-center gap-1 font-mono text-indigo-700" aria-label="材料题练习已用时间">
              <Clock3 size={16} aria-hidden="true" />
              {formatElapsedTime(elapsedSeconds)}
            </span>
            <span className="text-sm text-slate-400">{index + 1}/{activeQuestions.length}</span>
            <button
              type="button"
              onClick={() => void togglePause()}
              disabled={changingPause || saving || completing}
              aria-label={paused ? "继续练习" : "暂停练习"}
              title={paused ? "继续练习" : "暂停练习"}
            >
              {paused ? <Play size={18} aria-hidden="true" /> : <Pause size={18} aria-hidden="true" />}
            </button>
          </div>
          <MaterialQuestionWorkspace
            key={question.material.id}
            material={question.material}
            items={materialQuestionItems}
            currentIndex={index}
            answered={(questionId) => Boolean(answerStates[questionId])}
            disabled={saving || completing || paused}
            onSelect={(nextIndex) => choose(nextIndex)}
            renderQuestion={renderMaterialPracticeQuestion}
          />
          <div className="material-workspace-controls material-practice-support grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,.55fr)]">
            {progressDock}
            {syncPanel}
          </div>
        </>
      ) : (
        <div className="two-col grid grid-cols-[1fr_280px] gap-5">
          <div className="question-card card p-6 sm:p-8">
            <div className="flex items-center justify-between">
              <div className="flex flex-wrap gap-2">
                <span className="pill bg-blue-50 text-blue-700">{question.category}</span>
                <span className="pill bg-slate-100 text-slate-500">{question.type}</span>
                <span className="pill bg-orange-50 text-orange-600">
                  难度 {question.difficultyScore.toFixed(1)}/10 · {question.difficulty}
                </span>
                {question.region && (
                  <span className="pill bg-green-50 text-green-700">
                    {question.year || ""}{question.region}
                  </span>
                )}
              </div>
              <button
                aria-label="收藏题目"
                onClick={() => onFavorite(question.id).catch((reason) => setError(reason.message))}
                className="touch-target grid shrink-0 place-items-center border-0 bg-transparent text-xl text-amber-500"
              >
                {favorites.includes(question.id) ? "★" : "☆"}
              </button>
            </div>
            <p className="mt-7 text-[17px] leading-8">
              <b className="mr-2">{index + 1}.</b>
              <QuestionContent content={question.stem} />
            </p>
            <div className="mt-6 space-y-3">
              {question.options.map((option, optionIndex) => (
                <button
                  key={`${optionIndex}-${option}`}
                  disabled={saving || completing || paused}
                  onClick={() => void submitAnswer(optionIndex)}
                  className={`w-full rounded-xl border p-4 text-left text-sm transition ${selected === optionIndex ? "border-[#e85d3f] bg-orange-50" : "border-slate-200 bg-white hover:border-slate-300"}`}
                >
                  <span className="mr-3 text-slate-400">{String.fromCharCode(65 + optionIndex)}.</span>
                  <QuestionContent content={option} variant="option" />
                </button>
              ))}
            </div>
            {question.paperTitle && <p className="mt-3 text-xs text-slate-400">来源：{question.paperTitle}</p>}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <button onClick={() => choose(Math.max(0, index - 1))} disabled={index === 0 || saving || completing || paused} className="btn-ghost disabled:opacity-40">上一题</button>
              <div className="flex flex-1 justify-end gap-2 max-[420px]:grid max-[420px]:grid-cols-2">
                {!result && index < activeQuestions.length - 1 && <button onClick={() => choose(index + 1)} disabled={saving || completing || paused} className="btn-ghost disabled:opacity-40" title="跳过当前题，稍后可通过题号导航返回">下一题</button>}
                {result && index === activeQuestions.length - 1 ? (
                  <button onClick={() => void finishPractice()} disabled={completing || saving || paused} className="btn-primary disabled:opacity-40">{completing || saving ? "正在生成总结…" : "确认交卷"}</button>
                ) : result ? (
                  <button onClick={() => choose(index + 1)} disabled={completing || paused} className="btn-primary">下一题</button>
                ) : null}
              </div>
            </div>
          </div>
          <div className="space-y-5"><div className="card">{progressPanel}</div>{syncPanel}</div>
        </div>
      )}
    </div>
  );
}

function PlanTaskBanner({
  title,
  evidenceReady = false,
  onExit,
  onOpenPlan,
}: {
  title: string;
  evidenceReady?: boolean;
  onExit?: () => void;
  onOpenPlan?: () => void;
}) {
  return (
    <div className="mb-4 flex min-w-0 flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 [overflow-wrap:anywhere]">
        <b className="block">计划任务：{title}</b>
        <span className="mt-1 block text-xs text-blue-700">
          {evidenceReady ? "训练记录已生成，可返回每日任务进行系统验收。" : "本轮结果将用于该任务的系统验收。"}
        </span>
      </div>
      {evidenceReady && onOpenPlan ? (
        <button type="button" className="btn-primary min-h-11 shrink-0" onClick={onOpenPlan}>
          返回计划验收
        </button>
      ) : onExit ? (
        <button type="button" className="btn-ghost min-h-11 shrink-0" onClick={onExit}>
          退出计划任务
        </button>
      ) : null}
    </div>
  );
}

function Settings({
  categories,
  settings,
  setSettings,
  difficultyMode,
  applyMode,
  recommendation,
  available,
  applying,
  onApply,
}: {
  categories: PracticeCategory[];
  settings: QuestionSetOptions;
  setSettings: (value: QuestionSetOptions) => void;
  difficultyMode: DifficultyMode;
  applyMode: (mode: DifficultyMode) => void;
  recommendation: TrainingRecommendation | null;
  available: number;
  applying: boolean;
  onApply: () => Promise<void>;
}) {
  const scores = Array.from({ length: 10 }, (_, index) => index + 1);
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="card mb-6 p-5 sm:p-6">
      <div className={`flex items-center justify-between gap-3 ${expanded ? "mb-5 border-b border-slate-100 pb-4" : ""}`}>
        <div className="flex min-w-0 items-center gap-2">
          <SlidersHorizontal size={18} className="shrink-0 text-indigo-600" aria-hidden="true" />
          <b className="text-slate-900">练习设置</b>
        </div>
        <button
          type="button"
          className="btn-ghost flex min-h-11 shrink-0 items-center justify-center gap-2"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起设置" : "展开设置"}
          <ChevronDown
            size={16}
            className={`transition-transform ${expanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
      </div>
      {expanded && <>
      <div className="flex flex-wrap gap-2">
        {difficultyPresets.map((preset) => (
          <button
            key={preset.mode}
            onClick={() => applyMode(preset.mode)}
            className={
              difficultyMode === preset.mode ? "btn-primary" : "btn-ghost"
            }
          >
            {preset.label}
          </button>
        ))}
        <button
          onClick={() => applyMode("RECOMMENDED")}
          className={
            difficultyMode === "RECOMMENDED" ? "btn-primary" : "btn-ghost"
          }
        >
          推荐难度
        </button>
        <button
          onClick={() => applyMode("CUSTOM")}
          className={difficultyMode === "CUSTOM" ? "btn-primary" : "btn-ghost"}
        >
          自定义
        </button>
      </div>
      {recommendation && (
        <p className="mt-3 text-xs text-blue-600">{recommendation.reason}</p>
      )}
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-4">
          <PracticeScopeSelector
            categories={categories}
            value={normalizeQuestionScopes(settings.scopes)}
            onChange={(scopes) =>
              setSettings({ ...settings, category: "", questionPool: undefined, scopes })
            }
          />
        </div>
        <label className="text-sm">
          题目数量
          <div className="mt-2 flex gap-1">
            {[10, 20, 30, 50].map((count) => (
              <button
                key={count}
                onClick={() => setSettings({ ...settings, count })}
                className={`rounded border px-2 py-2 text-xs ${settings.count === count ? "border-orange-500 bg-orange-50" : "border-slate-200"}`}
              >
                {count}
              </button>
            ))}
          </div>
          <input
            aria-label="专项题目数量"
            type="number"
            min={5}
            max={100}
            value={settings.count}
            onChange={(event) =>
              setSettings({ ...settings, count: Number(event.target.value) })
            }
            className="field mt-2 w-full"
          />
        </label>
        <label className="text-sm">
          最低难度
          <select
            aria-label="专项最低难度"
            value={settings.minDifficulty}
            onChange={(event) => {
              setSettings({
                ...settings,
                minDifficulty: Number(event.target.value),
              });
              applyMode("CUSTOM");
            }}
            className="field mt-2 w-full"
          >
            {scores.map((score) => (
              <option key={score}>{score}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          最高难度
          <select
            aria-label="专项最高难度"
            value={settings.maxDifficulty}
            onChange={(event) => {
              setSettings({
                ...settings,
                maxDifficulty: Number(event.target.value),
              });
              applyMode("CUSTOM");
            }}
            className="field mt-2 w-full"
          >
            {scores.map((score) => (
              <option key={score}>{score}</option>
            ))}
          </select>
        </label>
        <div className="flex flex-col justify-end">
          <p className="mb-2 text-xs text-slate-500">
            当前范围可用 {available} 道
            {settings.category === "资料分析" || settings.scopes?.some((scope) => scope.category === "资料分析") ? "（资料分析按完整 5 题组）" : ""}
          </p>
          <button
            onClick={() => void onApply()}
            disabled={applying}
            className="btn-primary w-full disabled:opacity-50"
          >
            {applying ? "正在组题…" : "应用并保存配置"}
          </button>
        </div>
      </div>
      </>}
    </div>
  );
}

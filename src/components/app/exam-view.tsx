"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import type {
  ExamSubmitResult,
  PublicQuestion,
  QuestionSession,
  QuestionSetOptions,
  StudyPlanLaunchContext,
  TrainingReport,
} from "./types";
import {
  EXAM_TEMPLATES,
  isExamTemplateId,
  type ExamTemplateId,
} from "@/lib/exam-templates";
import { EmptyState, LoadingState, PageTitle } from "./ui";
import {
  MaterialQuestionWorkspace,
  type MaterialQuestionItem,
} from "./material-question-workspace";
import { plainQuestionText, QuestionContent } from "./question-content";
import { TrainingReportView } from "./training-report-view";
import { completeTrainingEvaluation } from "./training-report-client";
import { useActiveQuestionTiming } from "./use-active-question-timing";

type ActiveExam = {
  id: string;
  questions: PublicQuestion[];
  answers: Record<string, number>;
  questionDurations: Record<string, number>;
  config: Record<string, unknown>;
  paperDifficulty: number;
  durationMinutes: number;
  remainingSeconds: number;
  deadlineAt: string;
  paused: boolean;
  pausedAt?: string | null;
  pausedDurationSeconds: number;
  studyPlanId?: string | null;
  studyPlanTaskKey?: string | null;
  planContext?: { planId?: string; taskKey?: string; taskIndex?: number } | null;
};

type ExamProgress = {
  questionId: string;
  selected?: number;
  durationSeconds?: number;
};

function formatElapsedTime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

export function ExamView({
  questions,
  paperDifficulty,
  onReload,
  onSubmitExam,
  planContext,
  onPlanEvidence,
  onOpenPlan,
  onExitPlanTask,
}: {
  questions: PublicQuestion[];
  paperDifficulty: number;
  onReload: (options?: QuestionSetOptions) => Promise<QuestionSession>;
  onSubmitExam: (
    answers: { questionId: string; selected: number }[],
    duration: number,
    questionDurations: Record<string, number>,
    sessionId: string,
  ) => Promise<ExamSubmitResult>;
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
  const [booting, setBooting] = useState(true);
  const [started, setStarted] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [paperQuestions, setPaperQuestions] =
    useState<PublicQuestion[]>(questions);
  const [paperScore, setPaperScore] = useState(paperDifficulty);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const answersRef = useRef(answers);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [templateId, setTemplateId] =
    useState<ExamTemplateId>("NATIONAL_PREFECTURE");
  const [durationMinutes, setDurationMinutes] = useState(120);
  const [questionCount, setQuestionCount] = useState(130);
  const [seconds, setSeconds] = useState(120 * 60);
  const [deadlineAt, setDeadlineAt] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [changingPause, setChangingPause] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [starting, setStarting] = useState(false);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [report, setReport] = useState<TrainingReport | null>(null);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [evaluationError, setEvaluationError] = useState("");
  const [planBindingMismatch, setPlanBindingMismatch] = useState(false);
  const submittingRef = useRef(false);
  const submitRef = useRef<() => Promise<void>>(async () => {});
  const evaluationTarget = useRef<string | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const enqueueSave = useCallback(
    (targetSessionId: string, progress: ExamProgress) => {
      const save = async () => {
        const response = await fetch(`/api/exam-sessions/${targetSessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(progress),
          keepalive: true,
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          throw new Error(body?.error?.message || "答题进度保存失败");
        }
      };
      const queued = saveQueueRef.current.then(save);
      saveQueueRef.current = queued.catch((reason) => {
        const message =
          reason instanceof Error ? reason.message : "答题进度保存失败";
        setSaveError(`自动保存失败：${message}。系统仍会继续交卷。`);
      });
      return saveQueueRef.current;
    },
    [],
  );
  const {
    activate: activateTiming,
    reset: resetTiming,
    snapshot: timingSnapshot,
  } = useActiveQuestionTiming((questionId, durationSeconds) => {
    if (!sessionId || !started) return;
    void enqueueSave(sessionId, { questionId, durationSeconds });
  });

  useEffect(() => {
    queueMicrotask(async () => {
      try {
        const response = await fetch("/api/exam-sessions");
        const activeResponse = (await response.json().catch(() => null)) as {
          data?: ActiveExam | null;
          error?: { message?: string };
        } | null;
        if (!response.ok)
          throw new Error(
            activeResponse?.error?.message || "模拟考试恢复失败",
          );
        if (!activeResponse || !("data" in activeResponse))
          throw new Error("模拟考试恢复响应格式不正确");
        if (activeResponse.data) {
          const active = activeResponse.data;
          const context = planContextRef.current;
          const activePlanId = active.studyPlanId || active.planContext?.planId;
          const activeTaskKey =
            active.studyPlanTaskKey || active.planContext?.taskKey;
          setPlanBindingMismatch(
            Boolean(
              context &&
                (activePlanId !== context.planId ||
                  activeTaskKey !== context.taskKey),
            ),
          );
          const activeTemplate = active.config.templateId;
          if (isExamTemplateId(activeTemplate)) setTemplateId(activeTemplate);
          saveQueueRef.current = Promise.resolve();
          setSaveError("");
          setSessionId(active.id);
          setPaperQuestions(active.questions);
          setQuestionCount(active.questions.length);
          setAnswers(active.answers);
          answersRef.current = active.answers;
          resetTiming(active.questionDurations || {});
          setPaperScore(active.paperDifficulty);
          setDurationMinutes(active.durationMinutes);
          setSeconds(Math.max(0, active.remainingSeconds));
          setDeadlineAt(new Date(active.deadlineAt).getTime());
          setPaused(Boolean(active.paused));
          setStarted(true);
          const firstUnanswered = active.questions.findIndex(
            (question) => active.answers[question.id] === undefined,
          );
          const restoredIndex = firstUnanswered >= 0 ? firstUnanswered : 0;
          setCurrentIndex(restoredIndex);
          activateTiming(active.paused ? null : active.questions[restoredIndex]?.id || null);
        } else {
          const context = planContextRef.current;
          const launch =
            context?.completionSpec.kind === "EXAM"
              ? context.completionSpec.launch
              : null;
          const stored = localStorage.getItem("exam_template");
          const nextTemplateId = launch
            ? launch.templateId
            : isExamTemplateId(stored)
              ? stored
              : "NATIONAL_PREFECTURE";
          const template = EXAM_TEMPLATES[nextTemplateId];
          setTemplateId(nextTemplateId);
          setQuestionCount(template.questionCount);
          setDurationMinutes(template.durationMinutes);
          setSeconds(template.durationMinutes * 60);
          setDeadlineAt(null);
          const generated = await onReload({
            template: nextTemplateId,
            count: template.questionCount,
            minDifficulty: 1,
            maxDifficulty: 10,
          });
          setPaperQuestions(generated.items);
          setPaperScore(generated.paperDifficulty);
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "模拟考试加载失败");
      } finally {
        setBooting(false);
      }
    });
  }, [activateTiming, onReload, planIdentity, resetTiming]);

  const resetExam = () => {
    setStarted(false);
    setSessionId(null);
    setAnswers({});
    answersRef.current = {};
    setCurrentIndex(0);
    setSeconds(durationMinutes * 60);
    setDeadlineAt(null);
    setPaused(false);
    setReport(null);
    setError("");
    setSaveError("");
    saveQueueRef.current = Promise.resolve();
    submittingRef.current = false;
    setSubmitting(false);
    resetTiming();
    setEvaluationError("");
    setPlanBindingMismatch(false);
    evaluationTarget.current = null;
  };
  const generatePaper = async (nextTemplateId: ExamTemplateId = templateId) => {
    setGenerating(true);
    setError("");
    try {
      const template = EXAM_TEMPLATES[nextTemplateId];
      localStorage.setItem("exam_template", nextTemplateId);
      setTemplateId(nextTemplateId);
      setQuestionCount(template.questionCount);
      setDurationMinutes(template.durationMinutes);
      const generated = await onReload({
        template: nextTemplateId,
        count: template.questionCount,
        minDifficulty: 1,
        maxDifficulty: 10,
      });
      setPaperQuestions(generated.items);
      setPaperScore(generated.paperDifficulty);
      setAnswers({});
      answersRef.current = {};
      setCurrentIndex(0);
      setSeconds(template.durationMinutes * 60);
      setDeadlineAt(null);
      setReport(null);
      setSaveError("");
      saveQueueRef.current = Promise.resolve();
      resetTiming();
      setEvaluationError("");
      evaluationTarget.current = null;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "模拟卷生成失败");
    } finally {
      setGenerating(false);
    }
  };
  const startExam = async () => {
    if (starting) return;
    setStarting(true);
    setError("");
    try {
      const response = await fetch("/api/exam-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionIds: paperQuestions.map((question) => question.id),
          durationMinutes,
          paperDifficulty: paperScore,
          config: {
            templateId,
            questionCount,
          },
          ...(planContextRef.current
            ? {
                planContext: {
                  planId: planContextRef.current.planId,
                  taskKey: planContextRef.current.taskKey,
                  taskIndex: planContextRef.current.taskIndex,
                },
              }
            : {}),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "考试启动失败");
      saveQueueRef.current = Promise.resolve();
      setSaveError("");
      setSessionId(body.data.id);
      setSeconds(durationMinutes * 60);
      setDeadlineAt(new Date(body.data.deadlineAt).getTime());
      setPaused(false);
      setStarted(true);
      setCurrentIndex(0);
      resetTiming();
      activateTiming(paperQuestions[0]?.id || null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "考试启动失败");
    } finally {
      setStarting(false);
    }
  };
  const saveAnswer = (questionId: string, selected: number, questionIndex = currentIndex) => {
    if (paused || changingPause || submitting) return;
    if (questionIndex !== currentIndex) {
      activateTiming(questionId);
      setCurrentIndex(questionIndex);
    }
    const next = { ...answersRef.current, [questionId]: selected };
    answersRef.current = next;
    setAnswers(next);
    const durationSeconds = timingSnapshot()[questionId] || 0;
    if (sessionId)
      void enqueueSave(sessionId, { questionId, selected, durationSeconds });
    if (questionIndex < paperQuestions.length - 1)
      navigateTo(questionIndex + 1);
  };
  const navigateTo = (nextIndex: number) => {
    if (paused || changingPause) return;
    const bounded = Math.min(
      paperQuestions.length - 1,
      Math.max(0, nextIndex),
    );
    activateTiming(paperQuestions[bounded]?.id || null);
    setCurrentIndex(bounded);
    setNavigatorOpen(false);
  };
  const evaluateReport = async (reportId: string) => {
    evaluationTarget.current = reportId;
    setEvaluationError("");
    try {
      const evaluated = await completeTrainingEvaluation(reportId);
      if (evaluationTarget.current !== reportId) return;
      setReport((current) => (current?.id === reportId ? evaluated : current));
    } catch (reason) {
      if (evaluationTarget.current === reportId)
        setEvaluationError(
          reason instanceof Error ? reason.message : "练习评价生成失败",
        );
    }
  };
  const togglePause = async () => {
    if (!sessionId || changingPause || submitting) return;
    setChangingPause(true);
    setError("");
    const nextPaused = !paused;
    if (nextPaused) {
      activateTiming(null);
      await saveQueueRef.current;
    }
    try {
      const response = await fetch(`/api/exam-sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: nextPaused }),
      });
      const body = (await response.json().catch(() => null)) as {
        data?: { paused: boolean; deadlineAt: string };
        error?: { message?: string };
      } | null;
      if (!response.ok)
        throw new Error(body?.error?.message || "暂停状态保存失败");
      if (!body?.data) throw new Error("暂停状态响应格式不正确");
      setPaused(body.data.paused);
      setDeadlineAt(new Date(body.data.deadlineAt).getTime());
      if (!body.data.paused)
        activateTiming(paperQuestions[currentIndex]?.id || null);
    } catch (reason) {
      if (nextPaused) activateTiming(paperQuestions[currentIndex]?.id || null);
      setError(reason instanceof Error ? reason.message : "暂停状态保存失败");
    } finally {
      setChangingPause(false);
    }
  };
  const submit = async () => {
    if (paused || changingPause || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      if (!sessionId) throw new Error("考试会话不存在，请重新开始考试");
      activateTiming(null);
      const questionDurations = timingSnapshot();
      await saveQueueRef.current;
      const entries = Object.entries(answersRef.current);
      const result = await onSubmitExam(
        entries.map(([questionId, selected]) => ({ questionId, selected })),
        durationMinutes * 60 - seconds,
        questionDurations,
        sessionId,
      );
      setReport(result.report);
      onPlanEvidence?.(result.report.id);
      setStarted(false);
      window.scrollTo({ top: 0 });
      resetTiming();
      void evaluateReport(result.report.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "交卷失败，请重试");
      submittingRef.current = false;
      setSubmitting(false);
    }
  };
  useEffect(() => {
    submitRef.current = submit;
  });
  const abandon = async () => {
    if (
      !sessionId ||
      !confirm("确认放弃当前模拟考试吗？已保存的选择将不计入成绩。")
    )
      return;
    activateTiming(null);
    await saveQueueRef.current;
    const response = await fetch(`/api/exam-sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ABANDONED" }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(body?.error?.message || "放弃考试失败，请重试");
      return;
    }
    resetExam();
    const context = planContextRef.current;
    if (context?.completionSpec.kind === "EXAM")
      await generatePaper(context.completionSpec.launch.templateId);
  };

  const exitPlanTask = async () => {
    if (started && sessionId) {
      if (!confirm("确认退出当前计划模考吗？本场已保存的进度将被放弃。"))
        return;
      activateTiming(null);
      await saveQueueRef.current;
      const response = await fetch(`/api/exam-sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ABANDONED" }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(body?.error?.message || "退出计划模考失败，请重试");
        return;
      }
      resetExam();
    }
    onExitPlanTask?.();
  };

  useEffect(() => {
    if (!started || report || !deadlineAt || paused) return;
    let submitted = false;
    const syncClock = () => {
      const remaining = Math.max(
        0,
        Math.ceil((deadlineAt - Date.now()) / 1000),
      );
      setSeconds(remaining);
      if (!remaining && !submitted) {
        submitted = true;
        queueMicrotask(() => void submitRef.current());
      }
    };
    syncClock();
    const timer = setInterval(syncClock, 500);
    document.addEventListener("visibilitychange", syncClock);
    window.addEventListener("focus", syncClock);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", syncClock);
      window.removeEventListener("focus", syncClock);
    };
  }, [deadlineAt, paused, started, report]);

  if (booting) return <LoadingState text="正在恢复模拟考试与训练配置…" />;
  if (report)
    return <>
      {planContext && (
        <ExamPlanBanner
          title={planContext.taskTitle}
          evidenceReady
          onOpenPlan={onOpenPlan}
          onExit={() => void exitPlanTask()}
        />
      )}
      <TrainingReportView
      report={report}
      title="考试报告"
      description={`本次得分 ${report.total ? Math.round(report.correct / report.total * 100) : 0} 分，已作答 ${report.answered} 题，练习总结已保存。`}
      evaluationError={evaluationError}
      onRetryEvaluation={() => void evaluateReport(report.id)}
      actions={<>
        {saveError && <p className="mr-auto text-sm text-red-500" role="alert">{saveError}</p>}
        <button onClick={resetExam} className="btn-primary">配置新考试</button>
      </>}
      />
    </>;
  if (!started)
    return (
      <div className="fade">
        {planContext && (
          <ExamPlanBanner title={planContext.taskTitle} onExit={() => void exitPlanTask()} />
        )}
        <PageTitle
          title="模拟考试"
          description="按正式行测试卷结构组卷；题量、时长和板块顺序均由卷型固定。"
        />
        <ExamSettings
          templateId={templateId}
          onSelect={setTemplateId}
          lockedTemplateId={
            planContext?.completionSpec.kind === "EXAM"
              ? planContext.completionSpec.launch.templateId
              : undefined
          }
          generating={generating}
          onGenerate={() => generatePaper(templateId)}
        />
        {(error || saveError) && <p className="mb-4 text-sm text-red-500" role="alert">{error || saveError}</p>}
        {paperQuestions.length ? (
          <div className="card mx-auto max-w-3xl overflow-hidden">
            <div className="brand-gradient p-8 text-white sm:p-10">
              <span className="text-sm text-blue-200">规范化行测模拟</span>
              <h2 className="mt-2 text-2xl font-bold">
                {EXAM_TEMPLATES[templateId].name}综合模拟卷
              </h2>
              <p className="mt-3 text-sm text-blue-100">
                {EXAM_TEMPLATES[templateId].description} · 本套难度 {paperScore.toFixed(1)}/10
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 p-5 text-center sm:gap-4 sm:p-8">
              <div>
                <b className="text-2xl">{paperQuestions.length}</b>
                <p className="text-xs text-slate-400">试题数量</p>
              </div>
              <div>
                <b className="text-2xl">{durationMinutes}</b>
                <p className="text-xs text-slate-400">考试时长</p>
              </div>
              <div>
                <b className="text-2xl">{paperScore.toFixed(1)}</b>
                <p className="text-xs text-slate-400">套题难度</p>
              </div>
            </div>
            <div className="px-5 pb-5 sm:px-8 sm:pb-8">
              <button
                onClick={() => void startExam()}
                disabled={starting}
                className="btn-primary w-full py-3 disabled:opacity-50"
              >
                {starting ? "正在启动考试…" : "开始考试"}
              </button>
            </div>
          </div>
        ) : (
          <EmptyState text="当前条件下无法组成试卷，请调整难度范围" />
        )}
      </div>
    );

  const question = paperQuestions[currentIndex];
  if (!question) return <EmptyState text="当前考试题目不可用" />;
  const materialQuestionItems: MaterialQuestionItem[] = question.materialId
    ? paperQuestions
        .map((item, itemIndex) => ({ question: item, index: itemIndex }))
        .filter((item) => item.question.materialId === question.materialId)
        .sort(
          (left, right) =>
            (left.question.materialOrder ?? left.index) -
            (right.question.materialOrder ?? right.index),
        )
    : [];
  const renderMaterialExamQuestion = (item: MaterialQuestionItem) => {
    const itemQuestion = item.question;
    const itemSelected = answers[itemQuestion.id];
    return (
      <>
        <div className="material-question-meta">
          {itemQuestion.examSubtype || itemQuestion.examSection || itemQuestion.type} · 难度 {itemQuestion.difficultyScore.toFixed(1)}/10 · 第 {item.index + 1} 题
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
              disabled={submitting || paused || changingPause}
              onClick={() => saveAnswer(itemQuestion.id, optionIndex, item.index)}
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
      </>
    );
  };
  const examNavigation = (
    <div className="card h-fit p-5">
      <div className="flex justify-between">
        <b>答题导航</b>
        <span className="text-xs text-slate-400">橙色为已作答</span>
      </div>
      <button
        onClick={() => setNavigatorOpen((value) => !value)}
        aria-expanded={navigatorOpen}
        className="compact-nav-toggle btn-ghost mt-4 w-full items-center justify-between"
      >
        <span>已作答 {Object.keys(answers).length}/{paperQuestions.length}</span>
        <span>{navigatorOpen ? "收起题号" : "展开题号"}</span>
      </button>
      <div className={`compact-nav-grid mt-4 grid grid-cols-5 gap-2 ${navigatorOpen ? "open" : ""}`}>
        {paperQuestions.map((item, itemIndex) => (
          <button
            key={item.id}
            onClick={() => navigateTo(itemIndex)}
            disabled={paused || changingPause}
            className={`touch-target grid h-11 place-items-center rounded border text-xs ${itemIndex === currentIndex ? "border-blue-500 bg-blue-50 text-blue-700" : answers[item.id] !== undefined ? "border-orange-400 bg-orange-50 text-orange-600" : "border-slate-200"}`}
          >
            {itemIndex + 1}
          </button>
        ))}
      </div>
      <button
        onClick={() => void submit()}
        disabled={submitting || paused || changingPause}
        className="btn-primary mt-5 w-full"
      >
        {submitting ? "正在交卷…" : "提前交卷"}
      </button>
      {(error || saveError) && <p className="mt-3 text-xs text-red-500" role="alert">{error || saveError}</p>}
    </div>
  );
  return (
    <div className="fade">
      {planContext && (
        <ExamPlanBanner
          title={planContext.taskTitle}
          bindingMismatch={planBindingMismatch}
          onExit={() => void exitPlanTask()}
        />
      )}
      {planBindingMismatch && (
        <p role="alert" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
          当前恢复的是此前开始的模拟考试，不能用于本次计划任务验收。请放弃该场考试后，按计划卷型重新开始。
        </p>
      )}
      <div className="mobile-stack mb-5 flex items-start justify-between gap-4">
        <PageTitle
          title="模拟考试进行中"
          description={`已作答 ${Object.keys(answers).length}/${paperQuestions.length} · 系统实时保存`}
        />
        <div className="mobile-exam-toolbar flex gap-2">
          <div
            className="flex items-center gap-2 rounded-lg bg-indigo-50 px-4 py-2 text-indigo-700"
            aria-label="模拟考试已用时间"
          >
            <span className="text-xs font-semibold">已用</span>
            <span className="font-mono">
              {formatElapsedTime(
                Math.max(0, durationMinutes * 60 - seconds),
              )}
            </span>
          </div>
          <button
            onClick={() => void togglePause()}
            disabled={changingPause || submitting}
            className="btn-ghost disabled:opacity-40"
          >
            {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
            {changingPause ? "保存中…" : paused ? "继续" : "暂停"}
          </button>
          <button
            onClick={() => void abandon()}
            className="btn-ghost text-red-500"
          >
            放弃
          </button>
        </div>
      </div>
      {paused && (
        <p role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-center text-sm font-medium text-amber-800">
          模拟考试已暂停，继续后才能作答和交卷
        </p>
      )}
      {question.material && materialQuestionItems.length ? (
        <>
          <MaterialQuestionWorkspace
            key={question.material.id}
            material={question.material}
            items={materialQuestionItems}
            currentIndex={currentIndex}
            answered={(questionId) => answers[questionId] !== undefined}
            disabled={submitting || paused || changingPause}
            onSelect={navigateTo}
            renderQuestion={renderMaterialExamQuestion}
          />
          <div className="material-workspace-controls">{examNavigation}</div>
        </>
      ) : (
        <div className="two-col grid grid-cols-[1fr_280px] gap-5">
          <div className="question-card card p-6 sm:p-8">
            <div className="mb-4 text-xs text-slate-400">
              {question.examSubtype || question.examSection || question.category} · 难度 {question.difficultyScore.toFixed(1)}/10 · 第 {currentIndex + 1} 题
            </div>
            <p className="leading-8">
              <b>{currentIndex + 1}. </b>
              <QuestionContent content={question.stem} />
            </p>
            <div className="mt-5 space-y-3">
              {question.options.map((option, optionIndex) => (
                <button
                  key={`${optionIndex}-${option}`}
                  disabled={submitting || paused || changingPause}
                  onClick={() => saveAnswer(question.id, optionIndex)}
                  className={`w-full rounded-lg border p-4 text-left text-sm ${answers[question.id] === optionIndex ? "border-orange-500 bg-orange-50" : "border-slate-200"}`}
                >
                  <span className="mr-3 text-slate-400">{String.fromCharCode(65 + optionIndex)}.</span>
                  <QuestionContent content={option} variant="option" />
                </button>
              ))}
            </div>
            <div className="mobile-button-row mt-6 flex justify-between">
              <button onClick={() => navigateTo(currentIndex - 1)} disabled={currentIndex === 0 || paused || changingPause} className="btn-ghost disabled:opacity-40">上一题</button>
              {currentIndex < paperQuestions.length - 1 ? (
                <button onClick={() => navigateTo(currentIndex + 1)} disabled={paused || changingPause} className="btn-primary">下一题</button>
              ) : (
                <button onClick={() => void submit()} disabled={submitting || paused || changingPause} className="btn-primary">{submitting ? "正在交卷…" : "确认交卷"}</button>
              )}
            </div>
          </div>
          {examNavigation}
        </div>
      )}
    </div>
  );
}

function ExamSettings({
  templateId,
  onSelect,
  generating,
  onGenerate,
  lockedTemplateId,
}: {
  templateId: ExamTemplateId;
  onSelect: (value: ExamTemplateId) => void;
  generating: boolean;
  onGenerate: () => Promise<void>;
  lockedTemplateId?: ExamTemplateId;
}) {
  return (
    <div className="card mb-6 p-5 sm:p-6">
      <div className="grid gap-4 md:grid-cols-2">
        {(Object.keys(EXAM_TEMPLATES) as ExamTemplateId[]).map((id) => {
          const template = EXAM_TEMPLATES[id];
          return (
          <button
            key={id}
            onClick={() => onSelect(id)}
            disabled={Boolean(lockedTemplateId && lockedTemplateId !== id)}
            aria-pressed={templateId === id}
            className={`min-h-11 rounded-2xl border p-5 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${templateId === id ? "border-orange-500 bg-orange-50 ring-2 ring-orange-100" : "border-slate-200 bg-white hover:border-slate-300"}`}
          >
            <span className="text-lg font-bold text-slate-900">{template.name}</span>
            <span className="mt-1 block text-sm text-slate-500">{template.description}</span>
            <span className="mt-3 block text-sm font-semibold text-orange-600">
              {template.questionCount} 题 · {template.durationMinutes} 分钟
            </span>
            <span className="mt-3 block text-xs leading-6 text-slate-500">
              {template.sections.map((section) => `${section.label} ${section.count}`).join(" · ")}
            </span>
            <span className="mt-2 block text-[11px] leading-5 text-slate-400">
              {template.sections.flatMap((section) => section.subtypes || []).map((subtype) => `${subtype.label}${subtype.count}`).join(" · ")}
            </span>
          </button>
          );
        })}
      </div>
      <p className="mt-4 text-xs leading-5 text-slate-500">
        题目只在各自板块内部随机，整卷严格按所选卷型的板块顺序排列；资料分析按完整 5 题材料组抽取。
      </p>
      <button onClick={() => void onGenerate()} disabled={generating} className="btn-primary mt-5 w-full disabled:opacity-50">
        {generating ? "正在规范组卷…" : `生成${EXAM_TEMPLATES[templateId].name}试卷`}
      </button>
    </div>
  );
}

function ExamPlanBanner({
  title,
  evidenceReady = false,
  bindingMismatch = false,
  onExit,
  onOpenPlan,
}: {
  title: string;
  evidenceReady?: boolean;
  bindingMismatch?: boolean;
  onExit?: () => void;
  onOpenPlan?: () => void;
}) {
  return (
    <div className="mb-4 flex min-w-0 flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 [overflow-wrap:anywhere]">
        <b className="block">计划任务：{title}</b>
        <span className="mt-1 block text-xs text-blue-700">
          {evidenceReady
            ? "考试报告已生成，可返回每日任务进行系统验收。"
            : bindingMismatch
              ? "当前考试未绑定该计划任务，放弃后重新开始即可生成有效证据。"
              : "本场考试结果将用于该任务的系统验收。"}
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

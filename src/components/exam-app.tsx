"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminView } from "@/components/app/admin-view";
import { AppShell } from "@/components/app/app-shell";
import { DashboardView } from "@/components/app/dashboard-view";
import { ExamView } from "@/components/app/exam-view";
import { EssayView } from "@/components/app/essay-view";
import { FavoritesView } from "@/components/app/favorites-view";
import { LoginView } from "@/components/app/login-view";
import { PracticeView } from "@/components/app/practice-view";
import { StatisticsView } from "@/components/app/statistics-view";
import { StudyPlanView } from "@/components/app/study-plan-view";
import { WeeklyPlanView } from "@/components/app/weekly-plan-view";
import { WrongView } from "@/components/app/wrong-view";
import type { AnswerResult, ExamSubmitResult, Overview, PublicQuestion, QuestionSession, QuestionSetOptions, StudyPlan, StudyPlanLaunchContext, User, View, WrongQuestionSet } from "@/components/app/types";
import { LoadingState } from "@/components/app/ui";
import {
  activateAndroidStudyPlanAccount,
  clearAndroidStudyPlan,
  hasAndroidStudyPlanBridge,
  resetAndroidStudyPlanReminders,
  syncStudyPlanToAndroid,
} from "@/lib/android-study-plan-bridge";

const emptyOverview: Overview = { total: 0, correct: 0, today: 0, thisWeek: 0, weeklyCompletedTasks: 0, todayCompletedTasks: 0, weeklyCheckIns: 0, checkedInToday: false, todayQuestionGoal: null, todayTaskGoal: null, todayGoalSummary: null, todayGoalSource: null, accuracy: 0, categories: [], daily: [] };
const NATIVE_DESTINATION_KEY = "zhizheng:native-destination";
const PLAN_CONTEXT_KEY = "zhizheng:study-plan-task";

function viewForPlanTask(context: StudyPlanLaunchContext): View {
  if (context.completionSpec.kind === "EXAM") return "exam";
  if (context.completionSpec.kind === "ESSAY") return "essay";
  return "practice";
}

function readStoredPlanContext() {
  try {
    const value = JSON.parse(sessionStorage.getItem(PLAN_CONTEXT_KEY) || "null") as StudyPlanLaunchContext | null;
    if (
      value &&
      typeof value.planId === "string" &&
      typeof value.taskKey === "string" &&
      Number.isInteger(value.taskIndex) &&
      value.completionSpec?.method === "PROGRAM"
    )
      return value;
  } catch {}
  return null;
}

function storePlanContext(context: StudyPlanLaunchContext | null) {
  try {
    if (context) sessionStorage.setItem(PLAN_CONTEXT_KEY, JSON.stringify(context));
    else sessionStorage.removeItem(PLAN_CONTEXT_KEY);
  } catch {}
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || "请求失败");
  return body.data as T;
}

export function ExamApp() {
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<View>(() => {
    const stored = readStoredPlanContext();
    return stored ? (stored.evidenceId ? "plan" : viewForPlanTask(stored)) : "home";
  });
  const [questions, setQuestions] = useState<PublicQuestion[]>([]);
  const [questionTotal, setQuestionTotal] = useState(0);
  const [paperDifficulty, setPaperDifficulty] = useState(0);
  const [favorites, setFavorites] = useState<PublicQuestion[]>([]);
  const [wrongSets, setWrongSets] = useState<WrongQuestionSet[]>([]);
  const [overview, setOverview] = useState<Overview>(emptyOverview);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState("");
  const [planContext, setPlanContext] = useState<StudyPlanLaunchContext | null>(
    () => readStoredPlanContext(),
  );

  const loadQuestions = useCallback(async (options: QuestionSetOptions = { count: 50, minDifficulty: 1, maxDifficulty: 10 }) => {
    const params = new URLSearchParams({ count: String(options.count), minDifficulty: String(options.minDifficulty), maxDifficulty: String(options.maxDifficulty) });
    if (options.category) params.set("category", options.category);
    if (options.scopes?.length) params.set("scopes", JSON.stringify(options.scopes));
    if (options.questionPool) params.set("questionPool", options.questionPool);
    if (options.template) params.set("template", options.template);
    const questionData = await fetch(`/api/questions/session?${params}`).then((response) => readJson<QuestionSession>(response));
    setQuestions(questionData.items); setQuestionTotal(questionData.total); setPaperDifficulty(questionData.paperDifficulty);
    return questionData;
  }, []);

  const refreshLearningData = useCallback(async () => {
    const [favoriteData, wrongData, overviewData] = await Promise.all([
      fetch("/api/favorites").then((response) => readJson<PublicQuestion[]>(response)),
      fetch("/api/wrong-questions").then((response) => readJson<WrongQuestionSet[]>(response)),
      fetch("/api/statistics/overview").then((response) => readJson<Overview>(response)),
    ]);
    setFavorites(favoriteData);
    setWrongSets(wrongData);
    setOverview(overviewData);
  }, []);

  const refreshLearningDataInBackground = useCallback(() => {
    void refreshLearningData().catch((reason) => {
      console.warn("学习概览后台刷新失败，将在下次刷新时重试。", reason);
    });
  }, [refreshLearningData]);

  const loadSession = useCallback(async () => {
    setBooting(true); setError("");
    try {
      const authResponse = await fetch("/api/auth/me");
      if (authResponse.status === 401) {
        storePlanContext(null);
        setPlanContext(null);
        setView("home");
        if (hasAndroidStudyPlanBridge()) resetAndroidStudyPlanReminders();
      }
      const currentUser = await readJson<User>(authResponse);
      setUser(currentUser);
      activateAndroidStudyPlanAccount(currentUser.id);
      const syncNativePlan = hasAndroidStudyPlanBridge()
        ? fetch("/api/study-plan")
            .then((response) => readJson<StudyPlan | null>(response))
            .then((plan) => {
              if (plan) syncStudyPlanToAndroid(plan, currentUser.id);
              else clearAndroidStudyPlan(currentUser.id);
            })
            .catch((reason) => {
              console.warn("手机每日任务提醒同步失败，将在进入每日任务时重试。", reason);
            })
        : Promise.resolve();
      await Promise.all([loadQuestions(), refreshLearningData()]);
      await syncNativePlan;
    } catch (reason) {
      setUser(null);
      if (reason instanceof Error && reason.message !== "请先登录") setError(reason.message);
    } finally { setBooting(false); }
  }, [loadQuestions, refreshLearningData]);

  useEffect(() => { queueMicrotask(() => void loadSession()); }, [loadSession]);

  useEffect(() => {
    const stored = readStoredPlanContext();
    if (!stored) return;
    queueMicrotask(() => {
      setPlanContext(stored);
      setView(stored.evidenceId ? "plan" : viewForPlanTask(stored));
    });
  }, []);

  useEffect(() => {
    const openStudyPlan = () => {
      setView("plan");
      try { sessionStorage.removeItem(NATIVE_DESTINATION_KEY); } catch {}
    };
    window.addEventListener("zhizheng:open-study-plan", openStudyPlan);
    try {
      if (sessionStorage.getItem(NATIVE_DESTINATION_KEY) === "plan") openStudyPlan();
    } catch {}
    return () => window.removeEventListener("zhizheng:open-study-plan", openStudyPlan);
  }, []);

  const answer = async (id: string, selected: number, mode: "PRACTICE" | "EXAM" = "PRACTICE", duration = 0, practiceSessionId?: string) => {
    const result = await fetch(`/api/questions/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selected, mode, duration, practiceSessionId }) }).then((response) => readJson<AnswerResult>(response));
    if (mode === "PRACTICE") refreshLearningDataInBackground();
    return result;
  };

  const favorite = async (id: string) => {
    await fetch("/api/favorites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ questionId: id }) }).then((response) => readJson<{ favorite: boolean }>(response));
    await refreshLearningData();
  };

  const submitExam = async (answers: { questionId: string; selected: number }[], duration: number, questionDurations: Record<string, number>, sessionId: string) => {
    const result = await fetch("/api/exams/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers, duration, questionDurations, sessionId }) }).then((response) => readJson<ExamSubmitResult>(response));
    refreshLearningDataInBackground();
    return result;
  };

  const startWrongSet = async (set: WrongQuestionSet) => {
    const readActiveSession = () =>
      fetch("/api/practice-sessions").then((response) =>
        readJson<{ id: string } | null>(response),
      );
    const createSession = (replacesSessionId?: string) =>
      fetch("/api/practice-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionIds: set.questions.map((question) => question.id),
          config: {
            count: set.questions.length,
            scopes: [],
            minDifficulty: 1,
            maxDifficulty: 10,
            availableTotal: set.questions.length,
          },
          ...(replacesSessionId ? { replacesSessionId } : {}),
        }),
      });

    const active = await readActiveSession();
    let response = await createSession(active?.id);
    if (response.status === 409) {
      const current = await readActiveSession();
      response = await createSession(current?.id);
    }
    await readJson<{ id: string; startedAt: string }>(response);
    storePlanContext(null);
    setPlanContext(null);
    setView("practice");
  };

  const logout = async () => {
    const accountId = user?.id;
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      if (accountId) clearAndroidStudyPlan(accountId);
      storePlanContext(null);
      setPlanContext(null);
      setUser(null); setView("home"); setQuestions([]); setQuestionTotal(0); setFavorites([]); setWrongSets([]); setOverview(emptyOverview);
    }
  };

  const startPlanTask = (context: StudyPlanLaunchContext) => {
    const next = { ...context, evidenceId: null };
    storePlanContext(next);
    setPlanContext(next);
    setView(viewForPlanTask(next));
  };

  const recordPlanEvidence = (evidenceId: string) => {
    setPlanContext((current) => {
      if (!current) return current;
      const next = { ...current, evidenceId };
      storePlanContext(next);
      return next;
    });
  };

  const finishPlanTask = (planId: string, taskKey: string) => {
    setPlanContext((current) => {
      if (!current || current.planId !== planId || current.taskKey !== taskKey)
        return current;
      storePlanContext(null);
      return null;
    });
    refreshLearningDataInBackground();
  };

  const checkIn = async () => {
    await fetch("/api/daily-check-in", { method: "POST" }).then((response) => readJson(response));
    await refreshLearningData();
  };

  if (booting) return <div className="grid min-h-screen place-items-center bg-slate-50"><div className="w-full max-w-md"><LoadingState text="正在恢复学习进度…" /></div></div>;
  if (!user) return <><LoginView onSuccess={loadSession} />{error && <div className="fixed bottom-5 left-1/2 -translate-x-1/2 rounded-lg bg-red-600 px-4 py-2 text-sm text-white">{error}</div>}</>;

  return <AppShell user={user} view={view} overview={overview} onView={setView} onLogout={() => void logout()} onCheckIn={checkIn}>
    {view === "home" && <DashboardView overview={overview} onView={setView} />}
    {view === "practice" && <PracticeView questions={questions} total={questionTotal} paperDifficulty={paperDifficulty} favorites={favorites.map((item) => item.id)} onAnswer={answer} onFavorite={favorite} onReload={loadQuestions} onCompleted={refreshLearningDataInBackground} planContext={planContext?.completionSpec.kind === "PRACTICE" ? planContext : null} onPlanEvidence={recordPlanEvidence} onOpenPlan={() => setView("plan")} onExitPlanTask={() => { storePlanContext(null); setPlanContext(null); }} />}
    {view === "exam" && <ExamView questions={questions} paperDifficulty={paperDifficulty} onReload={loadQuestions} onSubmitExam={submitExam} planContext={planContext?.completionSpec.kind === "EXAM" ? planContext : null} onPlanEvidence={recordPlanEvidence} onOpenPlan={() => setView("plan")} onExitPlanTask={() => { storePlanContext(null); setPlanContext(null); }} />}
    {view === "essay" && <EssayView planContext={planContext?.completionSpec.kind === "ESSAY" ? planContext : null} onPlanEvidence={recordPlanEvidence} onOpenPlan={() => setView("plan")} onExitPlanTask={() => { storePlanContext(null); setPlanContext(null); }} />}
     {view === "plan" && <StudyPlanView userId={user.id} targetExam={user.targetExam} activeContext={planContext} onStartTask={startPlanTask} onTaskAccepted={finishPlanTask} />}
     {view === "roadmap" && <WeeklyPlanView />}
    {view === "wrong" && <WrongView sets={wrongSets} onView={setView} onStart={startWrongSet} />}
    {view === "favorites" && <FavoritesView favorites={favorites} onView={setView} />}
    {view === "stats" && <StatisticsView overview={overview} />}
    {view === "admin" && user.role === "ADMIN" && <AdminView onPublishedChange={async () => { await Promise.all([loadQuestions(), refreshLearningData()]); }} />}
  </AppShell>;
}

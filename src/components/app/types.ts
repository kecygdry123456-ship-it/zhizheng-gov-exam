export type View = "home" | "practice" | "exam" | "essay" | "plan" | "roadmap" | "wrong" | "favorites" | "stats" | "admin";

export type User = { id: string; name: string; email: string; role: "STUDENT" | "ADMIN"; targetExam: string | null };

export type MaterialBlock =
  | { type: "richText"; content: string }
  | { type: "text"; content: string }
  | { type: "image"; url: string; alt: string }
  | { type: "table"; rows: string[][] };
export type QuestionMaterial = { id: string; title: string; content: string; blocks: MaterialBlock[] };
export type PublicQuestion = { id: string; category: string; examSection?: string; examSubtype?: string; type: string; stem: string; options: string[]; difficulty: string; difficultyScore: number; materialId?: string | null; materialOrder?: number | null; material?: QuestionMaterial | null; source?: string | null; paperTitle?: string | null; year?: number | null; region?: string | null };

import type { ExamTemplateId } from "@/lib/exam-templates";
import type { QuestionScope } from "@/lib/question-scope";
import type { CompletionSpec } from "@/lib/study-plan-completion";
import type {
  AcceptanceMethodPreference,
  ActiveWeekday,
  EssayPreference,
  ExamWindow,
  FocusArea,
  LearningGoal,
  LearningMethod,
  MockExamPreference,
  StudyConstraint,
  StudyIntensity,
  StudyStatus,
  StudyWindow,
} from "@/lib/study-plan-preferences";

export type QuestionSetOptions = { count: number; category?: string; scopes?: QuestionScope[]; questionPool?: "POLITICS" | "GENERAL_KNOWLEDGE"; minDifficulty: number; maxDifficulty: number; template?: ExamTemplateId };
export type QuestionSession = { items: PublicQuestion[]; total: number; requested: number; materialGroups: number; paperDifficulty: number };
export type DifficultyMode = "EASY" | "MEDIUM" | "HARD" | "CUSTOM" | "RECOMMENDED";
export type TrainingPreference = { practiceCount: number; practiceCategory: string | null; practiceScopes: QuestionScope[]; practiceDifficultyMode: DifficultyMode; practiceMinDifficulty: number; practiceMaxDifficulty: number; examCount: number; examDuration: number; examDifficultyMode: DifficultyMode; examMinDifficulty: number; examMaxDifficulty: number };
export type TrainingRecommendation = { minDifficulty: number; maxDifficulty: number; category: string | null; scopes: QuestionScope[]; confidence: "LOW" | "MEDIUM" | "HIGH"; reason: string };

export type Attempt = { id: string; questionId: string; correct: boolean; selected: number | null; duration: number; createdAt: string };

export type WrongQuestionSet = {
  id: string;
  title: string;
  mode: "PRACTICE" | "EXAM";
  total: number;
  answered: number;
  wrongCount: number;
  completedAt: string;
  questions: PublicQuestion[];
};

export type Overview = {
  total: number;
  correct: number;
  today: number;
  thisWeek: number;
  weeklyCompletedTasks?: number;
  todayCompletedTasks?: number;
  weeklyCheckIns?: number;
  checkedInToday?: boolean;
  todayQuestionGoal?: number | null;
  todayTaskGoal?: number | null;
  todayGoalSummary?: string | null;
  todayGoalSource?: string | null;
  accuracy: number;
  categories: { name: string; total: number; correct: number; accuracy: number }[];
  daily: { date: string; total: number; correct: number }[];
};

export type LearningAnalysis = {
  headline: string;
  overall: string;
  ability: string;
  trend: string;
  priorities: string;
  trainingPlan: string;
  caveat: string;
  actions: string[];
  source: "MODEL_API" | "DATA_RULES";
  generatedAt: string;
};

export type AdminQuestion = PublicQuestion & { answer: number; explanation: string; status: "DRAFT" | "PUBLISHED"; updatedAt: string };

export type AnswerResult = { attemptId: string; selected: number };
export type ExamSubmitResult = { answered: number; correct: number; submittedAt: string; attemptIds: string[]; report: TrainingReport };

export type TrainingReportEvaluationStatus = "PENDING" | "EVALUATING" | "READY" | "FALLBACK";
export type TrainingReportEvaluationSource = "MODEL_API" | "DATA_RULES" | null;

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
  /** Only present on reports generated before section-level evaluations. */
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

export type TrainingReport = {
  id: string;
  mode: "PRACTICE" | "EXAM";
  title: string;
  templateId?: ExamTemplateId | null;
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  inactiveDurationSeconds?: number;
  total: number;
  answered: number;
  correct: number;
  accuracy: number;
  score?: number | null;
  difficultyScore: number;
  evaluationStatus: TrainingReportEvaluationStatus;
  evaluationSource: TrainingReportEvaluationSource;
  overallEvaluation: string | null;
  sections: TrainingReportSection[];
  questionReviews: TrainingReportQuestionReview[];
};

export type TrainingReportQuestionReview = {
  questionId: string;
  index: number;
  category: string;
  type: string;
  stem: string;
  options: string[];
  selected: number | null;
  correctAnswer: number;
  correct: boolean;
  explanation: string;
  durationSeconds: number;
  material?: QuestionMaterial | null;
};

export type EssayMaterial = { id: string; title: string; topic: string; year: number | null; content: string; questions: { id: string; type: string; prompt: string; wordLimit: number; submissionCount: number }[] };

export type StudyPlanContext = {
  planId: string;
  taskKey: string;
  taskIndex: number;
};

export type StudyPlanLaunchContext = StudyPlanContext & {
  taskTitle: string;
  taskType: string;
  completionSpec: CompletionSpec;
  evidenceId?: string | null;
};

export type StudyPlanEvidence = {
  id: string;
  type: string;
  completedAt: string;
  summary?: unknown;
};

export type StudyPlanTask = {
  id?: string;
  day: number;
  title: string;
  type: string;
  target: string;
  minutes: number;
  reason: string;
  priority?: "HIGH" | "MEDIUM" | "LOW";
  checkpoint?: string;
  module?: string | null;
  difficulty?: string | null;
  questionCount?: number | null;
  completionSpec?: CompletionSpec | null;
};

export type StudyPlanCheckIn = {
  id: string;
  planId: string;
  taskKey: string;
  taskIndex: number;
  taskTitle: string;
  targetSnapshot: string;
  checkpointSnapshot: string;
  acceptanceMethod: "SELF_CONFIRMED" | "PROGRAM_VERIFIED";
  evidenceType?: string | null;
  evidenceId?: string | null;
  criteriaSnapshot?: Record<string, unknown> | null;
  actualSnapshot?: Record<string, unknown> | null;
  specHash?: string | null;
  completedAt: string;
  updatedAt: string;
};

export type StudyPlanStrategy = {
  phase: string;
  objective: string;
  priorities: {
    area: string;
    reason: string;
    allocationPercent?: number | null;
  }[];
  rhythm: string;
  adjustmentRules: string[];
};

export type StudyPlanPreferences = {
  targetExam?: string;
  examDate?: string;
  dailyMinutes?: number;
  weeklyDays?: number;
  currentLevel?: string;
  focus?: string;
  notes?: string;
  examWindow?: ExamWindow;
  focusAreas?: FocusArea[];
  studyStatus?: StudyStatus;
  activeWeekdays?: ActiveWeekday[];
  studyWindows?: StudyWindow[];
  learningGoal?: LearningGoal;
  learningMethods?: LearningMethod[];
  intensity?: StudyIntensity;
  mockExamPreference?: MockExamPreference;
  essayPreference?: EssayPreference;
  minTasksPerDay?: number;
  maxTasksPerDay?: number | null;
  /** Legacy input retained for old saved plans only. */
  maxTaskMinutes?: number;
  maxQuestionsPerTask?: number;
  acceptanceMethods?: AcceptanceMethodPreference[];
  constraints?: StudyConstraint[];
};

export type StudyPlanInputSnapshot = {
  preferences?: StudyPlanPreferences;
  [key: string]: unknown;
};

export type StudyPlan = {
  id: string;
  title: string;
  source: string;
  summary: string;
  tasks: StudyPlanTask[];
  strategy?: StudyPlanStrategy | null;
  schemaVersion?: number;
  inputSnapshot?: StudyPlanInputSnapshot | null;
  checkIns?: StudyPlanCheckIn[];
  generatedAt: string;
  expiresAt: string;
  completedAt?: string | null;
  completedPlanCount?: number;
};

export type WeeklyStudyPlanGoal = {
  title: string;
  objective: string;
  focusAreas: string[];
  successCriteria: string[];
  rationale: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  allocationPercent?: number | null;
};

export type WeeklyStudyPlan = {
  id: string;
  title: string;
  summary: string;
  goals: WeeklyStudyPlanGoal[];
  strategy: StudyPlanStrategy;
  source: string;
  inputSnapshot?: StudyPlanInputSnapshot | null;
  generatedAt: string;
  expiresAt: string;
  schemaVersion?: number;
};

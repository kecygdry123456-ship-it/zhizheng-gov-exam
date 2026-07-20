export const examWindowValues = [
  "UNKNOWN",
  "WITHIN_1_MONTH",
  "ONE_TO_THREE_MONTHS",
  "THREE_TO_SIX_MONTHS",
  "OVER_SIX_MONTHS",
  "FIXED_DATE",
] as const;

export const focusAreaValues = [
  "AUTO",
  "政治理论",
  "常识判断",
  "言语理解与表达",
  "数量关系",
  "判断推理",
  "资料分析",
  "申论",
] as const;

export const studyStatusValues = [
  "AUTO",
  "BEGINNER",
  "FOUNDATION",
  "REINFORCEMENT",
  "MOCK_IMPROVEMENT",
  "SPRINT",
  "RETAKE",
] as const;

export const activeWeekdayValues = [
  "MON",
  "TUE",
  "WED",
  "THU",
  "FRI",
  "SAT",
  "SUN",
] as const;

export const studyWindowValues = [
  "WEEKDAY_MORNING",
  "WEEKDAY_NOON",
  "WEEKDAY_EVENING",
  "WEEKEND_MORNING",
  "WEEKEND_AFTERNOON",
  "WEEKEND_EVENING",
] as const;

export const learningGoalValues = [
  "FOUNDATION",
  "ACCURACY",
  "SPEED",
  "WEAKNESSES",
  "FULL_EXAM",
  "ESSAY",
] as const;

export const learningMethodValues = [
  "METHOD_FIRST",
  "SECTION_PRACTICE",
  "TIMED_SETS",
  "WRONG_QUESTION_DRIVEN",
  "FULL_MOCK",
  "ESSAY_PARALLEL",
  "SHORT_FREQUENT",
] as const;

export const intensityValues = ["LIGHT", "BALANCED", "HIGH"] as const;

export const mockExamPreferenceValues = [
  "NONE",
  "BIWEEKLY",
  "WEEKLY",
  "TWICE_WEEKLY",
] as const;

export const essayPreferenceValues = [
  "NONE",
  "WEEKLY",
  "TWICE_WEEKLY",
  "THREE_TIMES_WEEKLY",
] as const;

export const acceptanceMethodPreferenceValues = ["SYSTEM", "SELF"] as const;

export const studyConstraintValues = [
  "NO_EARLY_MORNING",
  "NO_LATE_NIGHT",
  "WORKDAY_LIGHT",
  "WEEKEND_HEAVY",
  "AVOID_LONG_SESSIONS",
  "KEEP_ONE_REST_DAY",
  "BALANCE_DAILY_TASKS",
] as const;

export type ExamWindow = (typeof examWindowValues)[number];
export type FocusArea = (typeof focusAreaValues)[number];
export type StudyStatus = (typeof studyStatusValues)[number];
export type ActiveWeekday = (typeof activeWeekdayValues)[number];
export type StudyWindow = (typeof studyWindowValues)[number];
export type LearningGoal = (typeof learningGoalValues)[number];
export type LearningMethod = (typeof learningMethodValues)[number];
export type StudyIntensity = (typeof intensityValues)[number];
export type MockExamPreference = (typeof mockExamPreferenceValues)[number];
export type EssayPreference = (typeof essayPreferenceValues)[number];
export type AcceptanceMethodPreference =
  (typeof acceptanceMethodPreferenceValues)[number];
export type StudyConstraint = (typeof studyConstraintValues)[number];

export const targetExamPresetOptions = [
  { value: "国家公务员考试（地市级）", label: "国考地市级" },
  { value: "国家公务员考试（副省级）", label: "国考副省级" },
  { value: "广东省公务员考试", label: "广东省考" },
  { value: "其他省公务员考试", label: "其他省考通用" },
  { value: "事业单位考试", label: "事业单位" },
  { value: "选调生考试", label: "选调生" },
  { value: "暂未确定", label: "暂未确定" },
  { value: "OTHER", label: "其他考试" },
] as const;

export const examWindowLabels: Record<ExamWindow, string> = {
  UNKNOWN: "尚未公布",
  WITHIN_1_MONTH: "1个月内",
  ONE_TO_THREE_MONTHS: "1-3个月",
  THREE_TO_SIX_MONTHS: "3-6个月",
  OVER_SIX_MONTHS: "6个月以上",
  FIXED_DATE: "已确定日期",
};

export const focusAreaLabels: Record<FocusArea, string> = {
  AUTO: "根据表现自动推荐",
  政治理论: "政治理论",
  常识判断: "常识判断",
  言语理解与表达: "言语理解与表达",
  数量关系: "数量关系",
  判断推理: "判断推理",
  资料分析: "资料分析",
  申论: "申论",
};

export const studyStatusLabels: Record<StudyStatus, string> = {
  AUTO: "根据表现自动判断",
  BEGINNER: "零基础",
  FOUNDATION: "基础阶段",
  REINFORCEMENT: "强化阶段",
  MOCK_IMPROVEMENT: "套卷提升",
  SPRINT: "冲刺阶段",
  RETAKE: "二次备考",
};

export const weekdayOptions = [
  { value: "MON", label: "周一" },
  { value: "TUE", label: "周二" },
  { value: "WED", label: "周三" },
  { value: "THU", label: "周四" },
  { value: "FRI", label: "周五" },
  { value: "SAT", label: "周六" },
  { value: "SUN", label: "周日" },
] as const;

export const activeWeekdayLabels: Record<ActiveWeekday, string> = {
  MON: "周一",
  TUE: "周二",
  WED: "周三",
  THU: "周四",
  FRI: "周五",
  SAT: "周六",
  SUN: "周日",
};

export const studyWindowLabels: Record<StudyWindow, string> = {
  WEEKDAY_MORNING: "工作日早晨",
  WEEKDAY_NOON: "工作日午休",
  WEEKDAY_EVENING: "工作日晚间",
  WEEKEND_MORNING: "周末上午",
  WEEKEND_AFTERNOON: "周末下午",
  WEEKEND_EVENING: "周末晚间",
};

export const learningGoalLabels: Record<LearningGoal, string> = {
  FOUNDATION: "补齐基础",
  ACCURACY: "提高正确率",
  SPEED: "提高作答速度",
  WEAKNESSES: "集中攻克弱项",
  FULL_EXAM: "适应整卷节奏",
  ESSAY: "加强申论表达",
};

export const learningMethodLabels: Record<LearningMethod, string> = {
  METHOD_FIRST: "方法先行",
  SECTION_PRACTICE: "专项刷题",
  TIMED_SETS: "限时题组",
  WRONG_QUESTION_DRIVEN: "错题驱动",
  FULL_MOCK: "整卷模考",
  ESSAY_PARALLEL: "申论同步",
  SHORT_FREQUENT: "少量多次",
};

export const intensityLabels: Record<StudyIntensity, string> = {
  LIGHT: "轻量维持",
  BALANCED: "均衡推进",
  HIGH: "高强度提升",
};

export const mockExamPreferenceLabels: Record<MockExamPreference, string> = {
  NONE: "暂不安排",
  BIWEEKLY: "每两周1次",
  WEEKLY: "每周1次",
  TWICE_WEEKLY: "每周2次",
};

export const essayPreferenceLabels: Record<EssayPreference, string> = {
  NONE: "暂不安排",
  WEEKLY: "每周1次",
  TWICE_WEEKLY: "每周2次",
  THREE_TIMES_WEEKLY: "每周3次",
};

export const acceptanceMethodPreferenceLabels: Record<
  AcceptanceMethodPreference,
  string
> = {
  SYSTEM: "系统验收",
  SELF: "自验收",
};

export const studyConstraintLabels: Record<StudyConstraint, string> = {
  NO_EARLY_MORNING: "不安排早起学习",
  NO_LATE_NIGHT: "不安排深夜学习",
  WORKDAY_LIGHT: "工作日少安排",
  WEEKEND_HEAVY: "重点放在周末",
  AVOID_LONG_SESSIONS: "避免长时间连续训练",
  KEEP_ONE_REST_DAY: "每周至少休息1天",
  BALANCE_DAILY_TASKS: "每日任务均衡分配",
};

export const dailyMinutePresets = [30, 45, 60, 80, 90, 120, 180, 240] as const;

import type { DifficultyMode, TrainingPreference, TrainingRecommendation } from "./types";

export const defaultPreference: TrainingPreference = { practiceCount: 20, practiceCategory: null, practiceScopes: [], practiceDifficultyMode: "CUSTOM", practiceMinDifficulty: 1, practiceMaxDifficulty: 10, examCount: 50, examDuration: 60, examDifficultyMode: "CUSTOM", examMinDifficulty: 1, examMaxDifficulty: 10 };

export const difficultyPresets: { mode: DifficultyMode; label: string; min: number; max: number }[] = [
  { mode: "EASY", label: "基础 1～4", min: 1, max: 4 },
  { mode: "MEDIUM", label: "进阶 4～7", min: 4, max: 7 },
  { mode: "HARD", label: "困难 7～10", min: 7, max: 10 },
];

export function rangeForMode(mode: DifficultyMode, recommendation: TrainingRecommendation | null, current: { min: number; max: number }) {
  if (mode === "RECOMMENDED" && recommendation) return { min: recommendation.minDifficulty, max: recommendation.maxDifficulty };
  const preset = difficultyPresets.find((item) => item.mode === mode);
  return preset ? { min: preset.min, max: preset.max } : current;
}

export async function loadTrainingPreference() {
  const response = await fetch("/api/training-preferences"); const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || "训练配置加载失败");
  return body.data as { preference: TrainingPreference; recommendation: TrainingRecommendation };
}

export async function saveTrainingPreference(preference: TrainingPreference) {
  const response = await fetch("/api/training-preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(preference) }); const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || "训练配置保存失败");
  return body.data as TrainingPreference;
}

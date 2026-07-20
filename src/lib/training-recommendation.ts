import { prisma } from "@/lib/prisma";

function clamp(value: number) { return Math.min(10, Math.max(1, value)); }

export async function getTrainingRecommendation(userId: string) {
  const attempts = await prisma.attempt.findMany({ where: { userId }, include: { question: { include: { category: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
  if (attempts.length < 10) return { minDifficulty: 4, maxDifficulty: 6, category: null, scopes: [], confidence: "LOW", reason: "当前有效作答较少，建议先从 4～6 分的中等题建立稳定正确率。" };
  const accuracy = attempts.filter((attempt) => attempt.correct).length / attempts.length;
  const weightedDifficulty = attempts.reduce((sum, attempt, index) => sum + attempt.question.difficultyScore * (1 + (attempts.length - index) / attempts.length), 0) / attempts.reduce((sum, _, index) => sum + 1 + (attempts.length - index) / attempts.length, 0);
  const shift = accuracy >= 0.8 ? 1.2 : accuracy >= 0.65 ? 0.4 : accuracy < 0.5 ? -1 : -0.3;
  const center = clamp(weightedDifficulty + shift);
  const categories = new Map<string, { total: number; correct: number }>();
  const subtypes = new Map<string, { category: string; type: string; total: number; correct: number }>();
  for (const attempt of attempts) {
    const name = attempt.question.category.name; const current = categories.get(name) || { total: 0, correct: 0 }; current.total += 1; if (attempt.correct) current.correct += 1; categories.set(name, current);
    const key = `${name}\u0000${attempt.question.type}`;
    const subtype = subtypes.get(key) || { category: name, type: attempt.question.type, total: 0, correct: 0 };
    subtype.total += 1; if (attempt.correct) subtype.correct += 1; subtypes.set(key, subtype);
  }
  const weak = [...categories.entries()].filter(([, value]) => value.total >= 3).sort((a, b) => a[1].correct / a[1].total - b[1].correct / b[1].total)[0];
  const weakSubtype = [...subtypes.values()].filter((value) => value.total >= 3).sort((a, b) => a.correct / a.total - b.correct / b.total || b.total - a.total)[0];
  const minDifficulty = Math.floor(clamp(center - 1)); const maxDifficulty = Math.ceil(clamp(center + 1.5));
  const scopes = weakSubtype ? [{ category: weakSubtype.category, type: weakSubtype.type }] : [];
  return { minDifficulty, maxDifficulty, category: weakSubtype?.category || weak?.[0] || null, scopes, confidence: attempts.length >= 40 ? "HIGH" : "MEDIUM", reason: `根据最近 ${attempts.length} 次作答（正确率 ${Math.round(accuracy * 100)}%），建议训练 ${minDifficulty}～${maxDifficulty} 分题目${weakSubtype ? `，优先巩固${weakSubtype.category}中的${weakSubtype.type}` : weak ? `，优先巩固${weak[0]}` : ""}。` };
}

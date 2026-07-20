import type { Prisma } from "@prisma/client";

export const publicQuestionInclude = { category: true, material: true } satisfies Prisma.QuestionInclude;
export type PublicQuestionRow = Prisma.QuestionGetPayload<{ include: typeof publicQuestionInclude }>;

export function toPublicQuestion(question: PublicQuestionRow) {
  return { id: question.id, category: question.category.name, type: question.type, stem: question.stem, options: question.options, difficulty: question.difficulty, difficultyScore: question.difficultyScore, materialId: question.materialId, materialOrder: question.materialOrder, material: question.material ? { id: question.material.id, title: question.material.title, content: question.material.content, blocks: question.material.blocks } : null, source: question.source, paperTitle: question.paperTitle, year: question.year, region: question.region };
}

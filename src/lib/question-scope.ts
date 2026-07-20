import { z } from "zod";

export const questionScopeSchema = z
  .object({
    category: z.string().trim().min(1).max(30),
    type: z.string().trim().min(1).max(100),
  })
  .strict();

export const questionScopesSchema = z
  .array(questionScopeSchema)
  .max(60)
  .superRefine((scopes, context) => {
    const keys = scopes.map(questionScopeKey);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: "custom", message: "细分板块不能重复" });
    }
  });

export type QuestionScope = z.infer<typeof questionScopeSchema>;

export function questionScopeKey(scope: QuestionScope) {
  return `${scope.category}\u0000${scope.type}`;
}

export function normalizeQuestionScopes(value: unknown): QuestionScope[] {
  const parsed = questionScopesSchema.safeParse(value);
  if (!parsed.success) return [];
  return [...parsed.data].sort(
    (left, right) =>
      left.category.localeCompare(right.category, "zh-CN") ||
      left.type.localeCompare(right.type, "zh-CN"),
  );
}

export function parseQuestionScopesParameter(value: string | null) {
  if (!value) return { success: true as const, data: [] as QuestionScope[] };
  try {
    const parsed = questionScopesSchema.safeParse(JSON.parse(value));
    return parsed.success
      ? { success: true as const, data: normalizeQuestionScopes(parsed.data) }
      : { success: false as const, error: parsed.error };
  } catch {
    return { success: false as const, error: null };
  }
}

export function sameQuestionScopes(left: unknown, right: unknown) {
  return (
    JSON.stringify(normalizeQuestionScopes(left)) ===
    JSON.stringify(normalizeQuestionScopes(right))
  );
}

export function questionMatchesScopes(
  question: { type: string; category: { name: string } },
  scopes: readonly QuestionScope[],
) {
  return (
    !scopes.length ||
    scopes.some(
      (scope) =>
        scope.category === question.category.name && scope.type === question.type,
    )
  );
}

export function questionScopesWhere(scopes: readonly QuestionScope[]) {
  return scopes.length
    ? {
        OR: scopes.map((scope) => ({
          category: { name: scope.category },
          type: scope.type,
        })),
      }
    : {};
}

export function questionScopesLabel(scopes: readonly QuestionScope[]) {
  if (!scopes.length) return "全部细分板块";
  if (scopes.length === 1) return scopes[0].type;
  return `${scopes[0].type}等 ${scopes.length} 项`;
}

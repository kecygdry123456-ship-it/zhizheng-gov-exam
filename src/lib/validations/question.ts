import { z } from "zod";

export const questionInput = z.object({
  category: z.string().trim().min(2, "分类名称至少 2 个字").max(30),
  type: z.string().trim().min(2, "题型名称至少 2 个字").max(30),
  stem: z.string().trim().min(5, "题干至少 5 个字").max(5000),
  options: z.array(z.string().trim().min(1).max(500)).min(2).max(8),
  answer: z.number().int().nonnegative(),
  explanation: z.string().trim().min(2, "解析至少 2 个字").max(5000),
  difficulty: z.enum(["基础", "进阶", "困难"]),
  difficultyScore: z.number().min(1).max(10).optional(),
  status: z.enum(["DRAFT", "PUBLISHED"]).default("PUBLISHED"),
}).superRefine((value, context) => {
  if (value.answer >= value.options.length) {
    context.addIssue({ code: "custom", path: ["answer"], message: "正确答案必须对应一个有效选项" });
  }
});

export const adminQuestionQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  query: z.string().trim().max(100).optional(),
  status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
});

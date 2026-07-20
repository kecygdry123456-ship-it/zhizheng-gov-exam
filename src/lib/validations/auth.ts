import { z } from "zod";

const password = z.string().min(8, "密码至少 8 位").max(100, "密码过长").superRefine((value, context) => {
  if (Buffer.byteLength(value, "utf8") > 72) context.addIssue({ code: "custom", message: "密码不能超过 72 个 UTF-8 字节" });
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) context.addIssue({ code: "custom", message: "密码必须同时包含字母和数字" });
});

export const loginInput = z.object({ email: z.string().trim().toLowerCase().email("请输入有效邮箱").max(254), password: z.string().min(1).max(100) }).superRefine((value, context) => {
  if (Buffer.byteLength(value.password, "utf8") > 72) context.addIssue({ code: "custom", path: ["password"], message: "密码长度不正确" });
});

export const registerInput = z.object({
  name: z.string().trim().min(2, "姓名或昵称至少 2 个字").max(30, "姓名或昵称最多 30 个字"),
  email: z.string().trim().toLowerCase().email("请输入有效邮箱").max(254),
  password,
  confirmPassword: z.string(),
  targetExam: z.string().trim().max(80).optional(),
}).superRefine((value, context) => {
  if (value.password !== value.confirmPassword) context.addIssue({ code: "custom", path: ["confirmPassword"], message: "两次输入的密码不一致" });
});

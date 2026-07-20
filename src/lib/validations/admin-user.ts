import { z } from "zod";

export const adminUserQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  query: z.string().trim().max(100).default(""),
  role: z.enum(["STUDENT", "ADMIN"]).optional(),
});

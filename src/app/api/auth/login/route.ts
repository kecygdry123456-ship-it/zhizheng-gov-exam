import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/session";
import { loginInput } from "@/lib/validations/auth";

export async function POST(request: Request) {
  const parsed = loginInput.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) { const message = "请输入有效的邮箱和密码"; return NextResponse.json({ error: { code: "INVALID_INPUT", message, details: parsed.error.flatten() }, message }, { status: 400 }); }
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !await bcrypt.compare(parsed.data.password, user.passwordHash)) { const message = "邮箱或密码不正确"; return NextResponse.json({ error: { code: "INVALID_LOGIN", message, details: null }, message }, { status: 401 }); }
  await createSession({ id: user.id, name: user.name, role: user.role });
  return NextResponse.json({ data: { user: { id: user.id, name: user.name, email: user.email, role: user.role, targetExam: user.targetExam } } });
}

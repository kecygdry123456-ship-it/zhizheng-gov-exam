import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/session";
import { registerInput } from "@/lib/validations/auth";

export async function POST(request: Request) {
  const parsed = registerInput.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "注册信息不正确", details: parsed.error.flatten() } }, { status: 400 });
  const { name, email, password, targetExam } = parsed.data;
  try {
    const user = await prisma.user.create({ data: { name, email, passwordHash: await bcrypt.hash(password, 12), role: "STUDENT", targetExam: targetExam || "国家公务员考试" }, select: { id: true, name: true, email: true, role: true, targetExam: true } });
    await createSession({ id: user.id, name: user.name, role: user.role });
    return NextResponse.json({ data: { user } }, { status: 201 });
  } catch (reason) {
    if (reason instanceof Prisma.PrismaClientKnownRequestError && reason.code === "P2002") return NextResponse.json({ error: { code: "ACCOUNT_EXISTS", message: "该邮箱已注册，可以直接登录", details: null } }, { status: 409 });
    throw reason;
  }
}

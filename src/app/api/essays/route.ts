import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session?.id) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "请先登录", details: null } }, { status: 401 });
  const materials = await prisma.essayMaterial.findMany({ include: { questions: { select: { id: true, type: true, prompt: true, wordLimit: true, _count: { select: { submissions: { where: { userId: String(session.id) } } } } } } }, orderBy: { createdAt: "asc" } });
  return NextResponse.json({ data: materials.map((material) => ({ id: material.id, title: material.title, topic: material.topic, year: material.year, content: material.content, questions: material.questions.map((question) => ({ id: question.id, type: question.type, prompt: question.prompt, wordLimit: question.wordLimit, submissionCount: question._count.submissions })) })) });
}

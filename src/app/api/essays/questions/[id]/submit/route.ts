import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import {
  planContextSchema,
  requireProgramStudyPlanTask,
  studyPlanTaskErrorResponse,
  validateEssayTaskQuestion,
} from "@/lib/study-plan-task";

const submissionInput = z.object({
  content: z.string().trim().min(20, "作答内容至少 20 个字").max(5000),
  planContext: planContextSchema.optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.id) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "请先登录", details: null } }, { status: 401 });
  const parsed = submissionInput.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "申论作答内容不完整", details: parsed.error.flatten() } }, { status: 400 });
  const { id } = await params;
  const question = await prisma.essayQuestion.findUnique({ where: { id } });
  if (!question) return NextResponse.json({ error: { code: "NOT_FOUND", message: "申论题目不存在", details: null } }, { status: 404 });
  const userId = String(session.id);
  let planTask = null;
  if (parsed.data.planContext) {
    try {
      planTask = await requireProgramStudyPlanTask(
        userId,
        parsed.data.planContext,
        "ESSAY",
      );
      validateEssayTaskQuestion(planTask, question);
    } catch (reason) {
      const response = studyPlanTaskErrorResponse(reason);
      if (response) return response;
      throw reason;
    }
  }
  const content = parsed.data.content;
  const wordCount = content.replace(/\s/g, "").length;
  const points = Array.isArray(question.scoringPoints) ? question.scoringPoints.map(String) : [];
  const matchedPoints = points.filter((point) => content.includes(point) || content.includes(point.slice(0, Math.min(4, point.length))));
  const missingPoints = points.filter((point) => !matchedPoints.includes(point));
  const pointScore = points.length ? Math.round(matchedPoints.length / points.length * 60) : 40;
  const lengthRatio = wordCount / question.wordLimit;
  const lengthScore = lengthRatio >= 0.55 && lengthRatio <= 1.05 ? 20 : lengthRatio > 1.2 ? 8 : 12;
  const paragraphs = content.split(/\n+/).filter((item) => item.trim()).length;
  const structureScore = paragraphs >= 2 || /一是|首先|第一/.test(content) ? 20 : 12;
  const score = Math.min(100, pointScore + lengthScore + structureScore);
  const feedback = {
    summary: `本次作答得分 ${score} 分，覆盖 ${matchedPoints.length}/${points.length} 个主要评分点。`,
    strengths: matchedPoints.length ? `已覆盖：${matchedPoints.join("、")}。` : "表达基本围绕题目展开。",
    improvements: missingPoints.length ? `建议补充：${missingPoints.join("、")}。` : "主要要点较完整，可继续压缩语言并强化层次。",
    matchedPoints,
    missingPoints,
    referenceAnswer: question.referenceAnswer,
  };
  const submission = await prisma.essaySubmission.create({ data: {
    userId,
    questionId: id,
    studyPlanId: planTask?.planId,
    studyPlanTaskKey: planTask?.taskKey,
    content,
    wordCount,
    score,
    feedback,
  } });
  return NextResponse.json({ data: { id: submission.id, wordCount, score, feedback, createdAt: submission.createdAt } }, { status: 201 });
}

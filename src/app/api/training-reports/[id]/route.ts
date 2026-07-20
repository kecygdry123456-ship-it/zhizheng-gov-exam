import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { withQuestionReviews } from "@/lib/training-report-review";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.id)
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "请先登录" } },
      { status: 401 },
    );
  const { id } = await params;
  const report = await prisma.trainingReport.findFirst({
    where: { id, userId: String(session.id) },
  });
  if (!report)
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "练习总结不存在" } },
      { status: 404 },
    );
  return NextResponse.json({
    data: await withQuestionReviews(report, String(session.id)),
  });
}

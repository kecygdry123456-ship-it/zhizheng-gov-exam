import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { evaluateTrainingReport } from "@/lib/training-report-evaluation-service";
import { withQuestionReviews } from "@/lib/training-report-review";

export async function POST(
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
  const result = await evaluateTrainingReport(id, String(session.id));
  if (!result)
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "练习总结不存在" } },
      { status: 404 },
    );
  const report = await withQuestionReviews(result.report, String(session.id));
  return NextResponse.json(
    { data: report },
    result.busy
      ? { status: 202, headers: { "Retry-After": "2" } }
      : undefined,
  );
}

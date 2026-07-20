import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { adminUserQuery } from "@/lib/validations/admin-user";

export async function GET(request: Request) {
  const actor = await getAdminUser();
  if (actor?.role !== "ADMIN")
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "无管理权限", details: null } },
      { status: 403 },
    );

  const url = new URL(request.url);
  const parsed = adminUserQuery.safeParse({
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
    query: url.searchParams.get("query") ?? undefined,
    role: url.searchParams.get("role") || undefined,
  });
  if (!parsed.success)
    return NextResponse.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: "查询参数不正确",
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );

  const { page, pageSize, query, role } = parsed.data;
  const where: Prisma.UserWhereInput = {
    ...(role ? { role } : {}),
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { email: { contains: query, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const data = await prisma.$transaction(async (tx) => {
    const [total, adminCount] = await Promise.all([
      tx.user.count({ where }),
      tx.user.count({ where: { role: "ADMIN" } }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(page, totalPages);
    const rows = await tx.user.findMany({
      where,
      orderBy: [{ role: "asc" }, { createdAt: "desc" }],
      skip: (currentPage - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        targetExam: true,
        createdAt: true,
        _count: {
          select: {
            attempts: true,
            studyPlans: true,
            trainingReports: true,
          },
        },
      },
    });

    return {
      items: rows.map(({ _count, ...user }) => ({
        ...user,
        activity: {
          attempts: _count.attempts,
          studyPlans: _count.studyPlans,
          trainingReports: _count.trainingReports,
        },
      })),
      page: currentPage,
      pageSize,
      total,
      totalPages,
      adminCount,
      currentUserId: actor.id,
    };
  });

  return NextResponse.json({ data });
}

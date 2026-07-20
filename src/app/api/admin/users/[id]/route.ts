import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

class AccountDeleteError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  const actorId = session?.id ? String(session.id) : "";
  if (!actorId)
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "无管理权限", details: null } },
      { status: 403 },
    );

  const { id } = await params;
  try {
    const deleted = await prisma.$transaction(
      async (tx) => {
        const actor = await tx.user.findUnique({
          where: { id: actorId },
          select: { role: true },
        });
        if (actor?.role !== "ADMIN")
          throw new AccountDeleteError("FORBIDDEN", "无管理权限", 403);
        if (id === actorId)
          throw new AccountDeleteError(
            "CANNOT_DELETE_SELF",
            "不能删除当前登录的管理员账号",
            409,
          );

        const target = await tx.user.findUnique({
          where: { id },
          select: { id: true, name: true, email: true, role: true },
        });
        if (!target)
          throw new AccountDeleteError("NOT_FOUND", "账号不存在", 404);

        if (target.role === "ADMIN") {
          const adminCount = await tx.user.count({ where: { role: "ADMIN" } });
          if (adminCount <= 1)
            throw new AccountDeleteError(
              "LAST_ADMIN",
              "系统必须至少保留一个管理员账号",
              409,
            );
        }

        // ModelUsageDaily intentionally has no User foreign key, so clean it explicitly.
        await tx.modelUsageDaily.deleteMany({ where: { userId: id } });
        await tx.user.delete({ where: { id } });
        return target;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return NextResponse.json({
      data: {
        deleted: true,
        user: deleted,
      },
    });
  } catch (reason) {
    if (reason instanceof AccountDeleteError)
      return NextResponse.json(
        {
          error: {
            code: reason.code,
            message: reason.message,
            details: null,
          },
        },
        { status: reason.status },
      );
    if (
      reason instanceof Prisma.PrismaClientKnownRequestError &&
      reason.code === "P2034"
    )
      return NextResponse.json(
        {
          error: {
            code: "DELETE_CONFLICT",
            message: "账号状态刚刚发生变化，请刷新后重试",
            details: null,
          },
        },
        { status: 409 },
      );
    if (
      reason instanceof Prisma.PrismaClientKnownRequestError &&
      reason.code === "P2025"
    )
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "账号不存在", details: null } },
        { status: 404 },
      );
    throw reason;
  }
}

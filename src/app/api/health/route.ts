import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ data: { status: "ok", database: "connected", time: new Date().toISOString() } }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: { code: "SERVICE_UNAVAILABLE", message: "数据库连接不可用", details: null } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

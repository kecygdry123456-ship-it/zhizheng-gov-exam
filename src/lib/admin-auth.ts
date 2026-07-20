import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export async function getAdminUser() {
  const session = await getSession();
  if (!session?.id) return null;
  return prisma.user.findUnique({
    where: { id: String(session.id) },
    select: { id: true, name: true, email: true, role: true },
  });
}

export async function isAdmin() {
  return (await getAdminUser())?.role === "ADMIN";
}

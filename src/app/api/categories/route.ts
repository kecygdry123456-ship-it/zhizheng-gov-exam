import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const categories = await prisma.category.findMany({ orderBy: [{ sort: "asc" }, { name: "asc" }], select: { id: true, name: true } });
  const rows = await prisma.question.findMany({
    where: { status: "PUBLISHED" },
    select: { type: true, materialId: true, category: { select: { id: true, name: true } } },
  });
  const categoryCounts = new Map<string, number>();
  const subtypeCounts = new Map<string, number>();
  const subtypeNames = new Map<string, Set<string>>();
  const materialGroups = new Map<string, typeof rows>();
  const add = (map: Map<string, number>, key: string, count: number) =>
    map.set(key, (map.get(key) || 0) + count);
  for (const row of rows) {
    subtypeNames.set(row.category.id, (subtypeNames.get(row.category.id) || new Set()).add(row.type));
    if (row.materialId) {
      materialGroups.set(row.materialId, [...(materialGroups.get(row.materialId) || []), row]);
      continue;
    }
    if (row.category.name === "资料分析") continue;
    add(categoryCounts, row.category.id, 1);
    add(subtypeCounts, `${row.category.id}\u0000${row.type}`, 1);
  }
  for (const group of materialGroups.values()) {
    if (group.length !== 5) continue;
    const categoryIds = new Set(group.map((row) => row.category.id));
    if (categoryIds.size !== 1) continue;
    const categoryId = group[0].category.id;
    add(categoryCounts, categoryId, 5);
    const types = new Set(group.map((row) => row.type));
    if (types.size === 1) add(subtypeCounts, `${categoryId}\u0000${group[0].type}`, 5);
  }
  const data = categories.map((category) => ({
    id: category.id,
    name: category.name,
    questionCount: categoryCounts.get(category.id) || 0,
    subtypes: [...(subtypeNames.get(category.id) || [])]
      .sort((left, right) => left.localeCompare(right, "zh-CN"))
      .map((name) => ({
        name,
        questionCount: subtypeCounts.get(`${category.id}\u0000${name}`) || 0,
      })),
  }));
  return NextResponse.json({ data });
}

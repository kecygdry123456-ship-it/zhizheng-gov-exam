import { PrismaClient } from "@prisma/client";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const db = new PrismaClient();
const fix = process.argv.includes("--fix");
const htmlPattern = /<[a-z][^>]*>/i;
const imagePattern = /<img\b[^>]*\bsrc\s*=\s*(?:["']([^"']+)["']|([^\s>]+))[^>]*>/gi;
const entityPattern = /&(?:nbsp|amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/i;
const escapePattern = /(?:\\[nrt]|\\u[0-9a-f]{4}|\\x[0-9a-f]{2})/i;

function optionsOf(value: unknown) { return Array.isArray(value) ? value.map(String) : []; }
function imageUrls(value: string) { return [...value.matchAll(imagePattern)].map((match) => match[1] || match[2]).filter(Boolean); }
function normalizeEscapes(value: string) {
  return value.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16))).replace(/\\u([0-9a-f]{4})/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16))).replace(/\\x([0-9a-f]{2})/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16))).replace(/\\r\\n|\\n|\\r/g, "\n").replace(/\\t/g, " ");
}

async function main() {
  const questions = await db.question.findMany({ select: { id: true, stem: true, options: true, answer: true, explanation: true, status: true, materialId: true, materialOrder: true, externalKey: true, category: { select: { name: true } } } });
  const counters: Record<string, number> = { total: questions.length, published: 0, draft: 0, stemHtml: 0, optionHtml: 0, explanationHtml: 0, stemImages: 0, optionImages: 0, explanationImages: 0, entityEscapes: 0, slashEscapes: 0, nonFourOptions: 0, missingOptions: 0, emptyOptions: 0, answerOutOfRange: 0, placeholderQuestions: 0, publishedPlaceholderQuestions: 0, testPollutionQuestions: 0, publishedTestPollutionQuestions: 0, remoteImageQuestions: 0, repairedTextQuestions: 0, draftedQuestions: 0, abnormalMaterialGroups: 0 };
  const samples: Record<string, string[]> = {};
  const placeholderMaterialIds = new Set<string>();
  const add = (name: string, id: string) => { (samples[name] ||= []); if (samples[name].length < 20) samples[name].push(id); };
  for (const question of questions) {
    counters[question.status === "PUBLISHED" ? "published" : "draft"] += 1;
    const options = optionsOf(question.options); const all = [question.stem, ...options, question.explanation];
    if (htmlPattern.test(question.stem)) counters.stemHtml += 1;
    if (options.some((item) => htmlPattern.test(item))) counters.optionHtml += 1;
    if (htmlPattern.test(question.explanation)) counters.explanationHtml += 1;
    counters.stemImages += imageUrls(question.stem).length; counters.optionImages += options.reduce((sum, item) => sum + imageUrls(item).length, 0); counters.explanationImages += imageUrls(question.explanation).length;
    if (all.some((item) => entityPattern.test(item))) { counters.entityEscapes += 1; add("entityEscapes", question.id); }
    if (all.some((item) => escapePattern.test(item))) { counters.slashEscapes += 1; add("slashEscapes", question.id); }
    if (options.length !== 4) { counters.nonFourOptions += 1; add("nonFourOptions", question.id); }
    if (options.length < 2) { counters.missingOptions += 1; add("missingOptions", question.id); }
    if (options.some((item) => !item.trim())) { counters.emptyOptions += 1; add("emptyOptions", question.id); }
    if (question.answer < 0 || question.answer >= options.length) { counters.answerOutOfRange += 1; add("answerOutOfRange", question.id); }
    const placeholder = question.stem.trim().startsWith("题目正在全力以赴征集") && options.every((item) => item.trim() === "缺失");
    const testPollution = ["页面测试分类", "页面图片测试分类"].includes(question.category.name) || /^ui-(?:rich-)?(?:question|test)/i.test(question.externalKey || "");
    if (placeholder) { counters.placeholderQuestions += 1; if (question.status === "PUBLISHED") counters.publishedPlaceholderQuestions += 1; add("placeholderQuestions", question.id); if (question.materialId) placeholderMaterialIds.add(question.materialId); }
    if (testPollution) { counters.testPollutionQuestions += 1; if (question.status === "PUBLISHED") counters.publishedTestPollutionQuestions += 1; add("testPollutionQuestions", question.id); }
    if (all.flatMap(imageUrls).some((url) => /^https?:\/\//i.test(url))) { counters.remoteImageQuestions += 1; add("remoteImageQuestions", question.id); }
    if (!fix) continue;
    const stem = normalizeEscapes(question.stem); const nextOptions = options.map(normalizeEscapes); const explanation = normalizeEscapes(question.explanation);
    const invalid = options.length < 2 || options.some((item) => !item.trim()) || question.answer < 0 || question.answer >= options.length || placeholder || testPollution;
    const changed = stem !== question.stem || explanation !== question.explanation || nextOptions.some((item, index) => item !== options[index]);
    if (changed || (invalid && question.status !== "DRAFT")) { await db.question.update({ where: { id: question.id }, data: { ...(changed ? { stem, options: nextOptions, explanation } : {}), ...(invalid ? { status: "DRAFT" as const } : {}) } }); if (changed) counters.repairedTextQuestions += 1; if (invalid && question.status !== "DRAFT") counters.draftedQuestions += 1; }
  }
  if (fix && placeholderMaterialIds.size) {
    const result = await db.question.updateMany({ where: { materialId: { in: [...placeholderMaterialIds] }, status: "PUBLISHED" }, data: { status: "DRAFT" } });
    counters.draftedQuestions += result.count;
  }
  const groups = await db.question.groupBy({ by: ["materialId"], where: { materialId: { not: null }, status: "PUBLISHED" }, _count: { _all: true } });
  const abnormalIds = groups.filter((group) => group._count._all !== 5).map((group) => group.materialId).filter((id): id is string => Boolean(id));
  const rows = await db.question.findMany({ where: { materialId: { not: null }, status: "PUBLISHED" }, select: { materialId: true, materialOrder: true } }); const orders = new Map<string, number[]>();
  for (const row of rows) orders.set(row.materialId!, [...(orders.get(row.materialId!) || []), row.materialOrder || 0]);
  for (const [id, values] of orders) if (values.slice().sort((a, b) => a - b).join(",") !== "1,2,3,4,5" && !abnormalIds.includes(id)) abnormalIds.push(id);
  counters.abnormalMaterialGroups = abnormalIds.length;
  if (fix && abnormalIds.length) { const result = await db.question.updateMany({ where: { materialId: { in: abnormalIds }, status: "PUBLISHED" }, data: { status: "DRAFT" } }); counters.draftedQuestions += result.count; }
  const report = { generatedAt: new Date().toISOString(), fixApplied: fix, counters, samples }; await mkdir(path.join(process.cwd(), "reports"), { recursive: true }); await writeFile(path.join(process.cwd(), "reports", "question-bank-audit.json"), JSON.stringify(report, null, 2), "utf8"); console.log(JSON.stringify(report, null, 2));
}

main().finally(() => db.$disconnect());

import { PrismaClient } from "@prisma/client";
import { load } from "cheerio";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { difficultyLabel, scoreQuestionDifficulty } from "../src/lib/difficulty";
import {
  localizeMaterialImages,
  materialHash as hash,
  parseMaterialHtml,
  type MaterialBlock,
} from "./lib/material-html";
import { materialLinkData, validateImageBuffer } from "./repair-missing-question-materials";

const db = new PrismaClient();
const baseUrl = "https://balagk.com";
const paperLimit = Math.min(2000, Math.max(1, Number(process.env.BALA_PAPER_LIMIT || 2000)));
const pauseMs = Math.max(150, Number(process.env.BALA_REQUEST_INTERVAL_MS || 250));

type BalaPaper = { id: number; title: string; region: string; question_count: number; source_url?: string; questions?: BalaQuestion[] };
type BalaQuestion = { id: number; question: string; material?: string; options: string[]; answer: string; explanation?: string; knowledge_point?: string; source_knowledge_point?: string; sub_category?: string; is_complete?: number; is_duplicate?: number; sort_order: number; difficulty?: string };

function wait(milliseconds: number) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function normalize(text: string) { return text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim(); }
function sourcePaperId(url?: string) { return url?.match(/\/paper\/(\d+)/)?.[1] || ""; }

async function fetchJson<T>(url: string): Promise<T> {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(url, { headers: { "User-Agent": "ZhizhengGovExam/1.2 public-bank-import", Accept: "application/json" } }); lastStatus = response.status;
    if (response.ok) return response.json() as Promise<T>;
    await wait(attempt * 800);
  }
  throw new Error(`${url} 返回 ${lastStatus}`);
}

function mapCategory(question: BalaQuestion) {
  const point = question.knowledge_point || question.source_knowledge_point || "";
  if (/资料分析/.test(point)) return "资料分析";
  if (/数量关系|数学运算/.test(point)) return "数量关系";
  if (/判断推理/.test(point)) return "判断推理";
  if (/言语理解/.test(point)) return "言语理解";
  if (/政治理论|常识判断/.test(point)) return "常识判断";
  return "";
}

function htmlToText(html: string) { const $ = load(html || ""); return normalize($.root().text()); }

async function localizeBlocks(blocks: MaterialBlock[], paperKey: string, groupHash: string) {
  const directory = path.join(process.cwd(), "public", "question-materials", paperKey);
  await mkdir(directory, { recursive: true });
  return localizeMaterialImages(blocks, async (source, imageIndex) => {
    const remoteUrl = new URL(source, baseUrl).toString();
    const response = await fetch(remoteUrl, { headers: { "User-Agent": "ZhizhengGovExam/1.2 material-image" } });
    if (!response.ok) throw new Error(`${remoteUrl} 返回 ${response.status}`);
    const downloaded = validateImageBuffer(Buffer.from(await response.arrayBuffer()));
    const filename = `material-${groupHash}-${imageIndex + 1}${downloaded.extension}`;
    const filePath = path.join(directory, filename); const publicPath = `/question-materials/${paperKey}/${filename}`;
    let existing: Buffer | null = null;
    try { existing = await readFile(filePath); validateImageBuffer(existing); } catch { existing = null; }
    if (!existing?.equals(downloaded.buffer)) await writeFile(filePath, downloaded.buffer);
    return publicPath;
  });
}

async function loadPapers() {
  const pageSize = 200; const papers: BalaPaper[] = [];
  for (let page = 1; papers.length < paperLimit; page += 1) {
    const result = await fetchJson<{ papers: BalaPaper[]; total: number }>(`${baseUrl}/api/papers?category=${encodeURIComponent("行测")}&page=${page}&pageSize=${pageSize}`);
    papers.push(...result.papers);
    if (!result.papers.length || papers.length >= result.total) break;
  }
  return papers.slice(0, paperLimit);
}

async function cleanupIncompleteMaterials() {
  const groups = await db.question.groupBy({ by: ["materialId"], where: { materialId: { not: null }, status: "PUBLISHED" }, _count: { _all: true } });
  const incompleteIds = groups.filter((group) => group._count._all !== 5).map((group) => group.materialId).filter((id): id is string => Boolean(id));
  if (incompleteIds.length) await db.question.updateMany({ where: { materialId: { in: incompleteIds }, category: { name: "资料分析" } }, data: { status: "DRAFT" } });
  await db.questionMaterial.deleteMany({ where: { questions: { none: {} } } });
  return incompleteIds.length;
}

async function main() {
  const papers = await loadPapers(); const categoryCache = new Map<string, string>(); let created = 0; let updated = 0; let materialGroups = 0; let failed = 0;
  for (let paperIndex = 0; paperIndex < papers.length; paperIndex += 1) {
    const summary = papers[paperIndex];
    try {
      const paper = await fetchJson<BalaPaper>(`${baseUrl}/api/papers/${summary.id}`); const questions = (paper.questions || []).filter((question) => question.is_complete !== 0 && question.is_duplicate !== 1 && question.options?.length >= 2 && /^[A-H]$/i.test(question.answer || "")); const sourceId = sourcePaperId(paper.source_url); const paperKey = sourceId || `bala-${paper.id}`; const year = Number(paper.title.match(/(20\d{2})/)?.[1]) || null;
      const materialMap = new Map<string, { index: number; html: string; questions: BalaQuestion[] }>();
      for (const question of questions) if ((question.material || "").trim()) { const key = hash(question.material || ""); const group = materialMap.get(key) || { index: materialMap.size, html: question.material || "", questions: [] }; group.questions.push(question); materialMap.set(key, group); }
      const completeMaterials = [...materialMap.values()].filter((group) => group.questions.length === 5); const materialIds = new Map<number, string>(); const materialContents = new Map<number, string>();
      for (const group of completeMaterials) { const parsed = parseMaterialHtml(group.html); const groupHash = hash(group.html); const blocks = await localizeBlocks(parsed.blocks, paperKey, groupHash); const externalKey = `bala-material:${paper.id}:${groupHash}`; const row = await db.questionMaterial.upsert({ where: { externalKey }, update: { title: `${paper.title} 公共材料（${group.index + 1}）`, content: parsed.content, blocks, sourceUrl: paper.source_url || `${baseUrl}/practice/online/?paperId=${paper.id}`, paperTitle: paper.title, year, region: paper.region }, create: { externalKey, title: `${paper.title} 公共材料（${group.index + 1}）`, content: parsed.content, blocks, sourceUrl: paper.source_url || `${baseUrl}/practice/online/?paperId=${paper.id}`, paperTitle: paper.title, year, region: paper.region } }); materialIds.set(group.index, row.id); materialContents.set(group.index, parsed.content); materialGroups += 1; }
      const materialIndexByQuestion = new Map<number, { index: number; order: number }>(); for (const group of completeMaterials) group.questions.sort((a, b) => a.sort_order - b.sort_order).forEach((question, order) => materialIndexByQuestion.set(question.id, { index: group.index, order: order + 1 }));
      let paperImported = 0;
      for (const question of questions) {
        const category = mapCategory(question); if (!category) continue; const materialLink = materialIndexByQuestion.get(question.id); if (category === "资料分析" && !materialLink) continue;
        let categoryId = categoryCache.get(category); if (!categoryId) { const row = await db.category.upsert({ where: { name: category }, update: {}, create: { name: category } }); categoryId = row.id; categoryCache.set(category, categoryId); }
        const answer = question.answer.toUpperCase().charCodeAt(0) - 65; if (answer >= question.options.length) continue; const type = question.sub_category || question.knowledge_point || category; const difficultyScore = scoreQuestionDifficulty({ category, type, stem: normalize(question.question), options: question.options.map(normalize), material: materialLink ? materialContents.get(materialLink.index) : undefined }); const externalKey = sourceId ? `gkzhenti:${sourceId}:${question.sort_order}` : `bala:${paper.id}:${question.id}`;
        const existing = await db.question.findUnique({ where: { externalKey } }); const linkedMaterialId = materialLink ? materialIds.get(materialLink.index) : undefined;
        const data = { categoryId, type: normalize(type).slice(0, 30), stem: normalize(question.question), options: question.options.map(normalize), answer, explanation: htmlToText(question.explanation || "") || `正确答案为 ${question.answer.toUpperCase()}。`, difficulty: difficultyLabel(difficultyScore), difficultyScore, status: "PUBLISHED" as const, source: "BALA公考公开题库", sourceUrl: paper.source_url || `${baseUrl}/practice/online/?paperId=${paper.id}`, externalKey, paperTitle: paper.title, year, region: paper.region, ...materialLinkData(linkedMaterialId && materialLink ? { materialId: linkedMaterialId, materialOrder: materialLink.order } : null, existing) };
        if (existing) { await db.question.update({ where: { id: existing.id }, data }); updated += 1; } else { await db.question.create({ data }); created += 1; } paperImported += 1;
      }
      console.log(`[${paperIndex + 1}/${papers.length}] ${paper.title}：${paperImported} 道，完整资料分析 ${completeMaterials.length} 组`);
    } catch (reason) { failed += 1; console.warn(`试卷导入失败：${summary.title} - ${reason instanceof Error ? reason.message : String(reason)}`); }
    await wait(pauseMs);
  }
  const cleanedMaterialGroups = await cleanupIncompleteMaterials();
  const [publishedTotal, analysisTotal] = await Promise.all([db.question.count({ where: { status: "PUBLISHED" } }), db.question.count({ where: { status: "PUBLISHED", category: { name: "资料分析" }, materialId: { not: null } } })]);
  console.log(JSON.stringify({ papers: papers.length, created, updated, materialGroups, failed, cleanedMaterialGroups, publishedTotal, completeAnalysisQuestions: analysisTotal }, null, 2));
}

main().finally(() => db.$disconnect());

import { PrismaClient } from "@prisma/client";
import { load } from "cheerio";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { difficultyLabel, scoreQuestionDifficulty } from "../src/lib/difficulty";
import {
  localizeMaterialImages,
  materialHash,
  parseMaterialHtml,
  sanitizeRichTextFragment,
  type MaterialBlock,
} from "./lib/material-html";
import { materialLinkData, validateImageBuffer } from "./repair-missing-question-materials";

const db = new PrismaClient();
const baseUrl = "https://gwy.gkzhenti.cn";
const provinces = (process.env.QUESTION_PROVINCES || "浙江,山东,江苏,广东,四川,湖北,湖南,河南,河北,安徽,江西,福建,北京,上海,天津,重庆,陕西,山西,辽宁,吉林,黑龙江,云南,贵州,广西,海南,甘肃,青海,宁夏,内蒙古,新疆").split(",").map((item) => item.trim()).filter(Boolean);
const paperLimitPerProvince = Math.min(200, Math.max(1, Number(process.env.QUESTION_PAPER_LIMIT || 120)));
const pauseMs = Math.max(250, Number(process.env.QUESTION_REQUEST_INTERVAL_MS || 500));

type CatalogItem = { No: string; Title: string; Source?: string };
type ImportedMaterial = { index: number; hash: string; label: string; content: string; blocks: MaterialBlock[]; questionNumbers: number[] };
type ImportedQuestion = { number: number; category: string; type: string; stem: string; options: string[]; answer: number; materialIndex?: number; materialOrder?: number };

function wait(milliseconds: number) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function normalize(text: string) { return text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim(); }
function paperId(url: string) { return url.split("/").filter(Boolean).at(-1) || ""; }
function absoluteUrl(url: string) { return url.startsWith("//") ? `https:${url}` : url.startsWith("http") ? url : new URL(url, baseUrl).toString(); }
function normalizeRichValue(html: string) { return normalize(sanitizeRichTextFragment(html)); }

async function fetchText(url: string) {
  const response = await fetch(url, { headers: { "User-Agent": "ZhizhengGovExam/1.1 public-question-import" } });
  if (!response.ok) throw new Error(`${url} 返回 ${response.status}`);
  return response.text();
}

function mapCategory(section: string) {
  if (/言语/.test(section)) return "言语理解";
  if (/判断推理/.test(section)) return "判断推理";
  if (/数量关系|数学运算/.test(section)) return "数量关系";
  if (/资料分析/.test(section)) return "资料分析";
  if (/常识|政治理论/.test(section)) return "常识判断";
  return "";
}

function parseAnswers(html: string) {
  const answers = new Map<number, number>();
  const $ = load(html); const text = $("#printcontent").text();
  for (const match of text.matchAll(/(\d+)\s*[、.]\s*([A-H])/g)) answers.set(Number(match[1]), match[2].charCodeAt(0) - 65);
  return answers;
}

function parsePaper(html: string, answers: Map<number, number>) {
  const $ = load(html); const questions: ImportedQuestion[] = []; const materials: ImportedMaterial[] = [];
  let section = ""; let currentMaterial: ImportedMaterial | null = null; let materialOrder = 0;
  $("#printcontent .row").each((_, row) => {
    const subtitle = normalize($(row).find(".subtitle").text());
    if (subtitle) { section = subtitle; currentMaterial = null; return; }
    const category = mapCategory(section);
    const materialLabel = normalize($(row).find(".sub2title").text());
    if (materialLabel) {
      const html = $(row).html() || ""; const parsed = parseMaterialHtml(html);
      currentMaterial = { index: materials.length, hash: materialHash(html), label: materialLabel, content: parsed.content, blocks: parsed.blocks, questionNumbers: [] };
      materials.push(currentMaterial); materialOrder = 0; return;
    }

    const number = Number(normalize($(row).find(".left").first().text())); const right = $(row).find(".right").first();
    if (!Number.isInteger(number) || !right.length || !category) return;
    if (currentMaterial && !currentMaterial.questionNumbers.includes(number)) currentMaterial.questionNumbers.push(number);
    if (!answers.has(number) || right.find("table").length) return;
    right.find("u").each((__, node) => { if (!normalize($(node).text())) $(node).text("____"); });
    const options: { label: string; text: string }[] = [];
    right.find("div").each((__, optionNode) => { const text = normalize($(optionNode).text()); const match = text.match(/^([A-H])(?:[、.．]\s*|\s+)/); if (!match || options.some((item) => item.label === match[1])) return; const raw = ($(optionNode).html() || "").replace(/^\s*[A-H](?:[、.．]\s*|\s+)/i, ""); const value = $(optionNode).find("img").length ? normalizeRichValue(raw) : normalize(text.slice(match[0].length)); if (value) options.push({ label: match[1], text: value }); });
    options.sort((a, b) => a.label.localeCompare(b.label));
    if (options.length < 2 || options.length > 8 || options.some((item) => !item.text)) return;
    const clone = right.clone(); clone.find("div").each((__, node) => { if (/^[A-H][、.．]/.test(normalize($(node).text()))) $(node).remove(); });
    const stem = clone.find("img").length ? normalizeRichValue(clone.html() || "") : normalize(clone.text()); const answer = answers.get(number)!;
    if (stem.length < 8 || stem.length > 5000 || answer >= options.length) return;
    if (!currentMaterial && category !== "资料分析" && /上述资料|上述材料|根据资料|根据材料|根据下列文字|根据以下文字|根据下文/.test(stem)) return;
    if (category === "资料分析" && !currentMaterial) return;
    questions.push({ number, category, type: category === "资料分析" ? "资料分析" : normalize(section.replace(/^[一二三四五六七八九十]+[、.]/, "").split("。")[0]).slice(0, 30) || category, stem, options: options.map((item) => item.text), answer, ...(currentMaterial ? { materialIndex: currentMaterial.index, materialOrder: ++materialOrder } : {}) });
  });

  const completeMaterialIndexes = new Set(materials.filter((material) => material.questionNumbers.length === 5 && questions.filter((question) => question.materialIndex === material.index).length === 5).map((material) => material.index));
  return { materials: materials.filter((material) => completeMaterialIndexes.has(material.index)), questions: questions.filter((question) => question.materialIndex === undefined || completeMaterialIndexes.has(question.materialIndex)) };
}

async function localizeMaterialBlocks(blocks: MaterialBlock[], id: string, hash: string) {
  const directory = path.join(process.cwd(), "public", "question-materials", id);
  await mkdir(directory, { recursive: true });
  return localizeMaterialImages(blocks, async (source, imageIndex) => {
    const remoteUrl = absoluteUrl(source);
    const response = await fetch(remoteUrl, { headers: { "User-Agent": "ZhizhengGovExam/1.1 material-image" } });
    if (!response.ok) throw new Error(`${remoteUrl} 返回 ${response.status}`);
    const downloaded = validateImageBuffer(Buffer.from(await response.arrayBuffer()));
    const filename = `material-${hash}-${imageIndex + 1}${downloaded.extension}`;
    const filePath = path.join(directory, filename); const publicPath = `/question-materials/${id}/${filename}`;
    let existing: Buffer | null = null;
    try { existing = await readFile(filePath); validateImageBuffer(existing); } catch { existing = null; }
    if (!existing?.equals(downloaded.buffer)) await writeFile(filePath, downloaded.buffer);
    return publicPath;
  });
}

async function loadCatalog() {
  const papers = new Map<string, CatalogItem & { region: string }>();
  for (const region of provinces) {
    const url = `${baseUrl}/api/json?cls=${encodeURIComponent("行测")}&province=${encodeURIComponent(region)}`;
    const response = await fetch(url, { headers: { "User-Agent": "ZhizhengGovExam/1.1 public-question-import" } });
    if (!response.ok) { console.warn(`目录读取失败：${region} ${response.status}`); continue; }
    const list = await response.json() as CatalogItem[];
    for (const item of list.slice(0, paperLimitPerProvince)) { const id = paperId(item.No); if (id && /行测/.test(item.Title) && !papers.has(id)) papers.set(id, { ...item, No: absoluteUrl(item.No), region }); }
    await wait(pauseMs);
  }
  return [...papers.values()].sort((a, b) => b.Title.localeCompare(a.Title, "zh-CN", { numeric: true }));
}

async function main() {
  const disabledStandalone = await db.question.updateMany({ where: { category: { name: "资料分析" }, materialId: null, status: "PUBLISHED" }, data: { status: "DRAFT" } });
  if (disabledStandalone.count) console.log(`已停用 ${disabledStandalone.count} 道无完整材料的资料分析题`);
  const removed = await db.question.deleteMany({ where: { externalKey: { startsWith: "gkzhenti:" }, materialId: null, category: { name: "资料分析" } } });
  if (removed.count) console.log(`已清理 ${removed.count} 道缺少完整材料的资料分析题`);
  const papers = await loadCatalog(); const categoryCache = new Map<string, string>();
  let created = 0; let updated = 0; let materialGroups = 0; let failedPapers = 0;
  for (let index = 0; index < papers.length; index += 1) {
    const paper = papers[index]; const id = paperId(paper.No);
    try {
      const [questionHtml, answerHtml] = await Promise.all([fetchText(paper.No), fetchText(`${baseUrl}/answer/${id}`)]);
      const parsed = parsePaper(questionHtml, parseAnswers(answerHtml)); const yearMatch = paper.Title.match(/(20\d{2})年/); const year = yearMatch ? Number(yearMatch[1]) : null;
      const materialIds = new Map<number, string>();
      const materialContents = new Map<number, string>();
      for (const material of parsed.materials) {
        const externalKey = `gkzhenti-material:${id}:${material.hash}`; const blocks = await localizeMaterialBlocks(material.blocks, id, material.hash);
        const row = await db.questionMaterial.upsert({ where: { externalKey }, update: { title: `${paper.Title} 公共材料${material.label}`, content: material.content, blocks, sourceUrl: paper.No, paperTitle: paper.Title, year, region: paper.region }, create: { externalKey, title: `${paper.Title} 公共材料${material.label}`, content: material.content, blocks, sourceUrl: paper.No, paperTitle: paper.Title, year, region: paper.region } });
        materialIds.set(material.index, row.id); materialGroups += 1;
        materialContents.set(material.index, material.content);
      }
      for (const question of parsed.questions) {
        let categoryId = categoryCache.get(question.category);
        if (!categoryId) { const category = await db.category.upsert({ where: { name: question.category }, update: {}, create: { name: question.category } }); categoryId = category.id; categoryCache.set(question.category, categoryId); }
        const externalKey = `gkzhenti:${id}:${question.number}`; const existing = await db.question.findUnique({ where: { externalKey } }); const difficultyScore = scoreQuestionDifficulty({ ...question, material: question.materialIndex === undefined ? undefined : materialContents.get(question.materialIndex) }); const linkedMaterialId = question.materialIndex === undefined ? undefined : materialIds.get(question.materialIndex);
        const data = { categoryId, type: question.type, stem: question.stem, options: question.options, answer: question.answer, explanation: `公开真题答案为 ${String.fromCharCode(65 + question.answer)}。来源：${paper.Title}。`, difficulty: difficultyLabel(difficultyScore), difficultyScore, status: "PUBLISHED" as const, source: paper.Source || "公开真题库", sourceUrl: paper.No, externalKey, paperTitle: paper.Title, year, region: paper.region, ...materialLinkData(linkedMaterialId && question.materialOrder ? { materialId: linkedMaterialId, materialOrder: question.materialOrder } : null, existing) };
        if (existing) { await db.question.update({ where: { id: existing.id }, data }); updated += 1; } else { await db.question.create({ data }); created += 1; }
      }
      console.log(`[${index + 1}/${papers.length}] ${paper.Title}：${parsed.questions.length} 道，完整资料分析 ${parsed.materials.length} 组`);
    } catch (reason) { failedPapers += 1; console.warn(`试卷处理失败：${paper.Title} - ${reason instanceof Error ? reason.message : String(reason)}`); }
    await wait(pauseMs);
  }
  const [publishedTotal, analysisTotal] = await Promise.all([db.question.count({ where: { status: "PUBLISHED" } }), db.question.count({ where: { status: "PUBLISHED", category: { name: "资料分析" }, materialId: { not: null } } })]);
  console.log(JSON.stringify({ papers: papers.length, created, updated, materialGroups, failedPapers, publishedTotal, completeAnalysisQuestions: analysisTotal }, null, 2));
}

main().finally(() => db.$disconnect());

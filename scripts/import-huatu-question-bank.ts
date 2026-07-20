import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { load } from "cheerio";
import { difficultyLabel, scoreQuestionDifficulty } from "../src/lib/difficulty";
import {
  localizeMaterialImages,
  materialHash,
  parseMaterialHtml,
  sanitizeRichTextFragment,
  type MaterialBlock,
} from "./lib/material-html";
import { validateImageBuffer } from "./repair-missing-question-materials";

const db = new PrismaClient();
const listBaseUrl = "https://v.huatu.com";
const questionBaseUrl = "https://ns.huatu.com";
const targetPublished = Math.max(1, Number(process.env.HUATU_TARGET_PUBLISHED || 50_000));
const concurrency = Math.min(16, Math.max(1, Number(process.env.HUATU_REQUEST_CONCURRENCY || 6)));
const batchSize = Math.min(500, Math.max(20, Number(process.env.HUATU_BATCH_SIZE || 200)));
const pauseMs = Math.max(0, Number(process.env.HUATU_REQUEST_INTERVAL_MS || 20));

// This is an atypical, repeatedly selected general-knowledge material set.
// Keep the source importer from reintroducing it after the cleanup migration.
const excludedQuestionIds = new Set([40098982, 40098983, 40098984, 40098985, 40098987]);

type HuatuArea = { id: number; name: string };
type HuatuModule = { name: string; qcount: number };
type HuatuPaper = {
  id: number;
  name: string;
  year?: number;
  area: number;
  qcount: number;
  questions?: number[];
  modules?: HuatuModule[];
};
type HuatuPoint = { pointsName?: string[] };
type HuatuQuestion = {
  id: number;
  type: number;
  from?: string;
  material?: string | null;
  materials?: string[];
  year?: number | null;
  area?: number | null;
  status?: number;
  canAnswer?: number;
  hideFlag?: number;
  teachType?: string;
  difficult?: number;
  pointList?: HuatuPoint[];
  displayPointNameList?: { pointName?: string }[];
  stem?: string;
  answer?: number;
  choices?: string[];
  analysis?: string;
};
type QuestionReference = {
  paperId: number;
  paperTitle: string;
  paperYear: number | null;
  region: string | null;
  order: number;
};
type PreparedQuestion = {
  externalKey: string;
  stemKey: string;
  category: string;
  data: Omit<Prisma.QuestionCreateManyInput, "categoryId" | "materialId" | "materialOrder">;
  materialHtml: string;
  reference: QuestionReference;
};

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function richText(value: string) {
  const $ = load(sanitizeRichTextFragment(value || ""), undefined, false);
  $("img").each((_, image) => {
    if (/latex\.huatu\.com\/latex\/convert\?latex=$/i.test($(image).attr("src") || "")) $(image).remove();
  });
  return ($.root().html() || "").replace(/(?:<br>\s*){3,}/gi, "<br><br>");
}

function contentKey(value: string) {
  const $ = load(value || "", undefined, false);
  $("img").each((_, image) => {
    const source = $(image).attr("src") || "";
    $(image).replaceWith(` [IMG:${source.split("?")[0]}] `);
  });
  return normalizeText($.root().text()).toLowerCase();
}

function yearOf(paper: HuatuPaper) {
  return paper.year || Number(paper.name.match(/(20\d{2})/)?.[1]) || null;
}

function mapCategory(question: HuatuQuestion) {
  const names = (question.pointList || []).flatMap((point) => point.pointsName || []);
  const text = names.join("/");
  if (/资料分析/.test(text)) return "资料分析";
  if (/数量关系|数学运算|数字推理/.test(text)) return "数量关系";
  if (/判断推理|图形推理|定义判断|类比推理|逻辑判断/.test(text)) return "判断推理";
  if (/言语理解|片段阅读|篇章阅读|逻辑填空|语句/.test(text)) return "言语理解";
  if (/政治理论|常识判断/.test(text)) return "常识判断";
  return "";
}

function questionType(question: HuatuQuestion, category: string) {
  const names = (question.pointList || []).flatMap((point) => point.pointsName || []);
  const preferred = [
    "习近平新时代中国特色社会主义思想",
    "时事政治",
    "政治理论",
    "法律常识",
    "经济常识",
    "科技地理",
    "历史人文",
    "常识判断",
    "逻辑填空",
    "片段阅读",
    "篇章阅读",
    "语句填空",
    "语句排序",
    "数字推理",
    "数学运算",
    "图形推理",
    "定义判断",
    "类比推理",
    "逻辑判断",
    "资料分析",
  ].find((name) => names.includes(name));
  return normalizeText(preferred || question.displayPointNameList?.[0]?.pointName || names[1] || names[0] || category).slice(0, 30);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(20_000),
        headers: {
          "User-Agent": "ZhizhengGovExam/1.0 public-bank-import",
          Accept: "application/json",
          ...init?.headers,
        },
      });
      lastStatus = response.status;
      if (response.ok) return response.json() as Promise<T>;
    } catch {
      lastStatus = 0;
    }
    await wait(attempt * 500);
  }
  throw new Error(`${url} 返回 ${lastStatus || "网络错误"}`);
}

async function postHuatu<T>(pathName: string, body = "") {
  return fetchJson<T>(`${listBaseUrl}${pathName}`, {
    method: "POST",
    headers: {
      Referer: `${listBaseUrl}/tiku/truelist/1/1`,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
    },
    body,
  });
}

async function loadCatalog() {
  const areaResult = await postHuatu<{ code: number; data: HuatuArea[] }>("/tiku/common/getarea");
  const areas = areaResult.data || [];
  const areaNames = new Map(areas.map((area) => [area.id, area.name]));
  const papers = new Map<number, HuatuPaper>();
  for (const area of areas) {
    const result = await postHuatu<{ code: number; data: HuatuPaper[] }>(
      "/tiku/common/getlist",
      `area=${area.id}&papertype=`,
    );
    for (const paper of result.data || []) papers.set(paper.id, paper);
    await wait(100);
  }
  return { areas: areaNames, papers: [...papers.values()] };
}

function questionReferences(papers: HuatuPaper[], areas: Map<number, string>) {
  const references = new Map<number, QuestionReference>();
  const orderedPapers = [...papers].sort(
    (left, right) =>
      (yearOf(right) || 0) - (yearOf(left) || 0) || right.id - left.id,
  );
  for (const paper of orderedPapers) {
    (paper.questions || []).forEach((questionId, index) => {
      if (references.has(questionId)) return;
      references.set(questionId, {
        paperId: paper.id,
        paperTitle: paper.name,
        paperYear: yearOf(paper),
        region: areas.get(paper.area) || null,
        order: index + 1,
      });
    });
  }
  return references;
}

function prepareQuestion(question: HuatuQuestion, reference: QuestionReference): PreparedQuestion | null {
  const category = mapCategory(question);
  const choices = (question.choices || []).map(richText).filter(Boolean);
  const stem = richText(question.stem || "");
  const answer = Number(question.answer) - 1;
  if (
    !category ||
    question.status !== 2 ||
    question.canAnswer === 0 ||
    question.hideFlag === 1 ||
    question.teachType !== "单选题" ||
    choices.length < 2 ||
    choices.length > 8 ||
    !Number.isInteger(answer) ||
    answer < 0 ||
    answer >= choices.length ||
    contentKey(stem).length < 8
  )
    return null;
  const type = questionType(question, category);
  const materialHtml = question.material || question.materials?.[0] || "";
  // 来源难度经常按板块或整组材料统一给值，必须按每道小题自身重新定档。
  const difficultyScore = scoreQuestionDifficulty({
    category,
    type,
    stem: contentKey(stem),
    options: choices.map(contentKey),
    material: contentKey(materialHtml),
  });
  const explanation = richText(question.analysis || "") || `正确答案为 ${String.fromCharCode(65 + answer)}。`;
  return {
    externalKey: `huatu:${question.id}`,
    stemKey: contentKey(stem),
    category,
    materialHtml,
    reference,
    data: {
      type,
      stem,
      options: choices,
      answer,
      explanation,
      difficulty: difficultyLabel(difficultyScore),
      difficultyScore,
      status: "PUBLISHED",
      source: "华图公开真题库",
      sourceUrl: `${questionBaseUrl}/q/v1/questions/${question.id}`,
      externalKey: `huatu:${question.id}`,
      paperTitle: reference.paperTitle,
      year: question.year || reference.paperYear,
      region: reference.region,
    },
  };
}

async function localizeMaterialBlocks(blocks: MaterialBlock[], key: string) {
  const directory = path.join(process.cwd(), "public", "question-materials", `huatu-${key}`);
  await mkdir(directory, { recursive: true });
  return localizeMaterialImages(blocks, async (source, imageIndex) => {
    const response = await fetch(source, {
      signal: AbortSignal.timeout(20_000),
      headers: { "User-Agent": "ZhizhengGovExam/1.0 material-image", Accept: "image/*,*/*;q=0.8" },
    });
    if (!response.ok) throw new Error(`${source} 返回 ${response.status}`);
    const downloaded = validateImageBuffer(Buffer.from(await response.arrayBuffer()));
    const filename = `material-${imageIndex + 1}${downloaded.extension}`;
    const filePath = path.join(directory, filename);
    let existing: Buffer | null = null;
    try {
      existing = await readFile(filePath);
      validateImageBuffer(existing);
    } catch {
      existing = null;
    }
    if (!existing?.equals(downloaded.buffer)) await writeFile(filePath, downloaded.buffer);
    return `/question-materials/huatu-${key}/${filename}`;
  });
}

async function main() {
  const initialPublished = await db.question.count({ where: { status: "PUBLISHED" } });
  if (initialPublished >= targetPublished) {
    console.log(JSON.stringify({ initialPublished, targetPublished, created: 0, message: "题库已达到目标" }, null, 2));
    return;
  }

  const { areas, papers } = await loadCatalog();
  const references = questionReferences(papers, areas);
  const existingQuestions = await db.question.findMany({
    where: { status: "PUBLISHED" },
    select: { stem: true, externalKey: true },
  });
  const existingStemKeys = new Set(existingQuestions.map((question) => contentKey(question.stem)).filter(Boolean));
  const existingExternalKeys = new Set(
    existingQuestions
      .map((question) => question.externalKey)
      .filter((key): key is string => Boolean(key?.startsWith("huatu:"))),
  );
  const categoryRows = await Promise.all(
    ["言语理解", "判断推理", "数量关系", "资料分析", "常识判断"].map((name) =>
      db.category.upsert({ where: { name }, update: {}, create: { name } }),
    ),
  );
  const categoryIds = new Map(categoryRows.map((category) => [category.name, category.id]));
  const materialGroups = new Map<string, PreparedQuestion[]>();
  const processedMaterials = new Set<string>();
  const questionIds = [...references.keys()].filter(
    (id) => !excludedQuestionIds.has(id) && !existingExternalKeys.has(`huatu:${id}`),
  );
  let publishedTotal = initialPublished;
  let fetched = 0;
  let created = 0;
  let duplicateStems = 0;
  let invalid = 0;
  let failed = 0;
  let materialGroupsCreated = 0;

  async function insertStandalone(questions: PreparedQuestion[]) {
    const rows: Prisma.QuestionCreateManyInput[] = [];
    for (const question of questions) {
      if (existingStemKeys.has(question.stemKey)) {
        duplicateStems += 1;
        continue;
      }
      const categoryId = categoryIds.get(question.category);
      if (!categoryId) continue;
      existingStemKeys.add(question.stemKey);
      rows.push({ ...question.data, categoryId });
    }
    if (!rows.length) return;
    const result = await db.question.createMany({ data: rows, skipDuplicates: true });
    created += result.count;
    publishedTotal += result.count;
  }

  async function insertMaterialGroup(key: string, group: PreparedQuestion[]) {
    processedMaterials.add(key);
    const unique = new Map(group.map((question) => [question.externalKey, question]));
    const questions = [...unique.values()].sort((left, right) => left.reference.order - right.reference.order);
    if (questions.length !== 5 || new Set(questions.map((question) => question.stemKey)).size !== 5) {
      invalid += questions.length;
      return;
    }
    if (questions.some((question) => existingStemKeys.has(question.stemKey))) {
      duplicateStems += questions.length;
      return;
    }
    const parsed = parseMaterialHtml(questions[0].materialHtml);
    let blocks: MaterialBlock[];
    try {
      blocks = await localizeMaterialBlocks(parsed.blocks, key);
    } catch (reason) {
      failed += questions.length;
      console.warn(`材料组 ${key} 图片下载失败：${reason instanceof Error ? reason.message : String(reason)}`);
      return;
    }
    const first = questions[0];
    const material = await db.questionMaterial.upsert({
      where: { externalKey: `huatu-material:${key}` },
      update: {},
      create: {
        externalKey: `huatu-material:${key}`,
        title: `${first.reference.paperTitle} 公共材料`,
        content: parsed.content,
        blocks,
        sourceUrl: first.data.sourceUrl,
        paperTitle: first.reference.paperTitle,
        year: first.data.year,
        region: first.reference.region,
      },
    });
    const rows = questions.map((question, index) => ({
      ...question.data,
      categoryId: categoryIds.get(question.category)!,
      materialId: material.id,
      materialOrder: index + 1,
    }));
    const result = await db.question.createMany({ data: rows, skipDuplicates: true });
    if (result.count !== 5) {
      await db.question.updateMany({ where: { materialId: material.id }, data: { status: "DRAFT" } });
      invalid += result.count;
      return;
    }
    questions.forEach((question) => existingStemKeys.add(question.stemKey));
    created += result.count;
    publishedTotal += result.count;
    materialGroupsCreated += 1;
  }

  for (let start = 0; start < questionIds.length && publishedTotal < targetPublished; start += batchSize) {
    const ids = questionIds.slice(start, start + batchSize);
    const results: Array<HuatuQuestion | null> = new Array(ids.length).fill(null);
    let cursor = 0;
    async function worker() {
      while (cursor < ids.length) {
        const index = cursor++;
        try {
          const response = await fetchJson<{ data: HuatuQuestion }>(`${questionBaseUrl}/q/v1/questions/${ids[index]}`);
          results[index] = response.data || null;
        } catch {
          failed += 1;
        }
        if (pauseMs) await wait(pauseMs);
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    fetched += ids.length;
    const standalone: PreparedQuestion[] = [];
    for (const question of results) {
      if (!question) continue;
      const reference = references.get(question.id);
      if (!reference) continue;
      const prepared = prepareQuestion(question, reference);
      if (!prepared) {
        invalid += 1;
        continue;
      }
      if (!prepared.materialHtml) {
        standalone.push(prepared);
        continue;
      }
      const key = materialHash(prepared.materialHtml);
      if (processedMaterials.has(key)) continue;
      const group = materialGroups.get(key) || [];
      group.push(prepared);
      materialGroups.set(key, group);
      if (group.length === 5) await insertMaterialGroup(key, group);
    }
    await insertStandalone(standalone);
    console.log(
      `[${Math.min(start + ids.length, questionIds.length)}/${questionIds.length}] 已抓取 ${fetched}，新增 ${created}，正式题 ${publishedTotal}/${targetPublished}，重复 ${duplicateStems}，失败 ${failed}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        papers: papers.length,
        sourceQuestionIds: references.size,
        fetched,
        created,
        duplicateStems,
        invalid,
        failed,
        materialGroupsCreated,
        initialPublished,
        publishedTotal,
        targetPublished,
      },
      null,
      2,
    ),
  );
}

main().finally(() => db.$disconnect());

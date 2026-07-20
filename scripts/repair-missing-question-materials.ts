import { Prisma, PrismaClient } from "@prisma/client";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  localizeMaterialImages,
  materialHash,
  materialImageSources,
  parseMaterialHtml,
  type MaterialBlock,
} from "./lib/material-html";

const baseUrl = "https://balagk.com";
const imagePlaceholder = "[[QUESTION_IMAGE]]";
const imagePattern = /<img\b[^>]*>/gi;

export type BalaQuestion = {
  id: number;
  question: string;
  material?: string;
  options: string[];
  answer: string;
  knowledge_point?: string;
  source_knowledge_point?: string;
  sub_category?: string;
  is_complete?: number;
  is_duplicate?: number;
  sort_order: number;
};

export type BalaPaper = {
  id: number;
  title: string;
  region: string;
  question_count: number;
  source_url?: string;
  questions?: BalaQuestion[];
};

export type LocalQuestion = {
  id: string;
  externalKey: string | null;
  paperTitle: string | null;
  stem: string;
  options: unknown;
  answer: number;
  status: "DRAFT" | "PUBLISHED";
  materialId: string | null;
  materialOrder: number | null;
};

export type LocalMaterial = {
  blocks: unknown;
  externalKey: string;
  id: string;
  questionIds: string[];
};

export type SourceMaterialGroup = {
  index: number;
  hash: string;
  html: string;
  questions: BalaQuestion[];
};

export type VerifiedMaterialGroup = {
  mode: "CREATE_MISSING" | "REPAIR_DAMAGED";
  paper: BalaPaper;
  group: SourceMaterialGroup;
  localQuestions: LocalQuestion[];
};

export type MaterialLink = { materialId: string; materialOrder: number };

export function normalizeQuestionValue(value: string) {
  return value
    .replace(imagePattern, ` ${imagePlaceholder} `)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourcePaperId(url?: string) {
  return url?.match(/\/paper\/(\d+)/)?.[1] || "";
}

export function sourceQuestionExternalKey(paper: BalaPaper, question: BalaQuestion) {
  const sourceId = sourcePaperId(paper.source_url);
  return sourceId
    ? `gkzhenti:${sourceId}:${question.sort_order}`
    : `bala:${paper.id}:${question.id}`;
}

export function sourceMaterialExternalKey(paper: BalaPaper, group: SourceMaterialGroup) {
  return `bala-material:${paper.id}:${group.hash}`;
}

export function collectSourceMaterialGroups(paper: BalaPaper) {
  const grouped = new Map<string, Omit<SourceMaterialGroup, "index">>();
  for (const question of paper.questions || []) {
    const html = question.material || "";
    if (!html.trim()) continue;
    const hash = materialHash(html);
    const group = grouped.get(hash) || { hash, html, questions: [] };
    group.questions.push(question);
    grouped.set(hash, group);
  }
  return [...grouped.values()]
    .sort((left, right) =>
      Math.min(...left.questions.map((question) => question.sort_order)) -
      Math.min(...right.questions.map((question) => question.sort_order)),
    )
    .map((group, index) => ({ ...group, index }));
}

function localOptions(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

export function verifyMissingMaterialGroup(
  paper: BalaPaper,
  group: SourceMaterialGroup,
  localByExternalKey: ReadonlyMap<string, LocalQuestion>,
  localMaterials: ReadonlyMap<string, LocalMaterial> = new Map(),
): { ok: true; value: VerifiedMaterialGroup } | { ok: false; reason: string } {
  if (group.questions.length !== 5) return { ok: false, reason: "source-question-count" };
  const parsed = parseMaterialHtml(group.html);
  if (!materialImageSources(parsed.blocks).length) return { ok: false, reason: "material-has-no-image" };

  const ordered = [...group.questions].sort((left, right) => left.sort_order - right.sort_order);
  if (new Set(ordered.map((question) => question.sort_order)).size !== 5) {
    return { ok: false, reason: "duplicate-source-order" };
  }

  const localQuestions: LocalQuestion[] = [];
  for (const source of ordered) {
    if (
      source.is_complete === 0 ||
      source.is_duplicate === 1 ||
      !Array.isArray(source.options) ||
      source.options.length < 2 ||
      !/^[A-H]$/i.test(source.answer || "")
    ) {
      return { ok: false, reason: `invalid-source-question:${source.sort_order}` };
    }
    const local = localByExternalKey.get(sourceQuestionExternalKey(paper, source));
    if (!local) return { ok: false, reason: `missing-local-question:${source.sort_order}` };
    if (local.status !== "PUBLISHED") return { ok: false, reason: `local-not-published:${source.sort_order}` };
    if (normalizeQuestionValue(local.paperTitle || "") !== normalizeQuestionValue(paper.title)) {
      return { ok: false, reason: `paper-title-mismatch:${source.sort_order}` };
    }
    if (normalizeQuestionValue(local.stem) !== normalizeQuestionValue(source.question)) {
      return { ok: false, reason: `stem-mismatch:${source.sort_order}` };
    }
    const expectedOptions = source.options.map(normalizeQuestionValue);
    const actualOptions = localOptions(local.options).map(normalizeQuestionValue);
    if (JSON.stringify(actualOptions) !== JSON.stringify(expectedOptions)) {
      return { ok: false, reason: `options-mismatch:${source.sort_order}` };
    }
    if (local.answer !== source.answer.toUpperCase().charCodeAt(0) - 65) {
      return { ok: false, reason: `answer-mismatch:${source.sort_order}` };
    }
    localQuestions.push(local);
  }

  const allUnlinked = localQuestions.every((question) => question.materialId === null && question.materialOrder === null);
  if (allUnlinked) {
    return {
      ok: true,
      value: { mode: "CREATE_MISSING", paper, group: { ...group, questions: ordered }, localQuestions },
    };
  }

  const materialId = localQuestions[0].materialId;
  if (
    !materialId ||
    localQuestions.some((question, index) => question.materialId !== materialId || question.materialOrder !== index + 1)
  ) {
    return { ok: false, reason: "local-material-link-shape" };
  }
  const existingMaterial = localMaterials.get(materialId);
  if (!existingMaterial) return { ok: false, reason: "local-material-not-loaded" };
  if (existingMaterial.externalKey !== sourceMaterialExternalKey(paper, group)) {
    return { ok: false, reason: "local-material-external-key-mismatch" };
  }
  const expectedQuestionIds = localQuestions.map((question) => question.id).sort();
  if (JSON.stringify([...existingMaterial.questionIds].sort()) !== JSON.stringify(expectedQuestionIds)) {
    return { ok: false, reason: "local-material-question-set-mismatch" };
  }
  const existingBlocks = Array.isArray(existingMaterial.blocks)
    ? existingMaterial.blocks.filter(
        (block): block is MaterialBlock => Boolean(block && typeof block === "object" && "type" in block),
      )
    : [];
  if (materialImageSources(existingBlocks).length) {
    return { ok: false, reason: "local-material-already-has-image" };
  }
  return {
    ok: true,
    value: { mode: "REPAIR_DAMAGED", paper, group: { ...group, questions: ordered }, localQuestions },
  };
}

export function materialLinkData(
  next: MaterialLink | null,
  existing: Pick<LocalQuestion, "materialId" | "materialOrder"> | null,
) {
  if (next) return { materialId: next.materialId, materialOrder: next.materialOrder };
  if (existing?.materialId) return {};
  return { materialId: null, materialOrder: null };
}

type ValidImage = { buffer: Buffer; extension: ".png" | ".jpg" | ".gif" | ".webp"; width: number; height: number };

function jpegDimensions(buffer: Buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + length + 2 > buffer.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
    }
    offset += length + 2;
  }
  return null;
}

export function validateImageBuffer(buffer: Buffer): ValidImage {
  if (buffer.length < 24 || buffer.length > 20 * 1024 * 1024) throw new Error("invalid-image-size");
  let extension: ValidImage["extension"];
  let width = 0;
  let height = 0;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    extension = ".png"; width = buffer.readUInt32BE(16); height = buffer.readUInt32BE(20);
  } else if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    extension = ".jpg"; const dimensions = jpegDimensions(buffer);
    if (dimensions) ({ width, height } = dimensions);
  } else if (["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) {
    extension = ".gif"; width = buffer.readUInt16LE(6); height = buffer.readUInt16LE(8);
  } else if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    extension = ".webp";
    const kind = buffer.subarray(12, 16).toString("ascii");
    if (kind === "VP8X" && buffer.length >= 30) {
      width = 1 + buffer.readUIntLE(24, 3); height = 1 + buffer.readUIntLE(27, 3);
    } else if (kind === "VP8L" && buffer.length >= 25) {
      const bits = buffer.readUInt32LE(21); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (kind === "VP8 " && buffer.length >= 30 && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
      width = buffer.readUInt16LE(26) & 0x3fff; height = buffer.readUInt16LE(28) & 0x3fff;
    }
  } else {
    throw new Error("unsupported-image-magic");
  }
  if (!width || !height || width > 20_000 || height > 20_000) throw new Error("invalid-image-dimensions");
  return { buffer, extension, width, height };
}

async function fetchJson<T>(url: string): Promise<T> {
  let error = "request-failed";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
        headers: { Accept: "application/json", "User-Agent": "ZhizhengGovExam/1.5 missing-material-audit" },
      });
      if (response.ok) return response.json() as Promise<T>;
      error = `HTTP ${response.status}`;
    } catch (reason) { error = reason instanceof Error ? reason.message : String(reason); }
    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }
  throw new Error(`${url}: ${error}`);
}

async function fetchImage(url: string) {
  let error = "request-failed";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
        headers: { Accept: "image/*", "User-Agent": "ZhizhengGovExam/1.5 missing-material-repair" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return validateImageBuffer(Buffer.from(await response.arrayBuffer()));
    } catch (reason) { error = reason instanceof Error ? reason.message : String(reason); }
    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }
  throw new Error(`${url}: ${error}`);
}

async function loadPapers() {
  const pageSize = 200;
  const summaries = new Map<number, BalaPaper>();
  let loaded = 0;
  for (let page = 1; ; page += 1) {
    const result = await fetchJson<{ papers: BalaPaper[]; total: number }>(
      `${baseUrl}/api/papers?category=${encodeURIComponent("行测")}&page=${page}&pageSize=${pageSize}`,
    );
    for (const paper of result.papers) summaries.set(paper.id, paper);
    loaded += result.papers.length;
    if (!result.papers.length || loaded >= result.total) break;
  }
  const papers: BalaPaper[] = [];
  const ordered = [...summaries.values()].sort((left, right) => left.id - right.id);
  for (let index = 0; index < ordered.length; index += 1) {
    papers.push(await fetchJson<BalaPaper>(`${baseUrl}/api/papers/${ordered[index].id}`));
    if ((index + 1) % 50 === 0 || index + 1 === ordered.length) {
      console.log(`BALA papers ${index + 1}/${ordered.length}`);
    }
  }
  return papers;
}

async function localizedBlocks(candidate: VerifiedMaterialGroup, apply: boolean) {
  const parsed = parseMaterialHtml(candidate.group.html);
  const paperKey = sourcePaperId(candidate.paper.source_url) || `bala-${candidate.paper.id}`;
  const directory = path.join(process.cwd(), "public", "question-materials", paperKey);
  return localizeMaterialImages(parsed.blocks, async (source, imageIndex) => {
    const remoteUrl = new URL(source, candidate.paper.source_url || baseUrl).toString();
    const downloaded = await fetchImage(remoteUrl);
    const filename = `missing-${candidate.group.hash}-${imageIndex + 1}${downloaded.extension}`;
    const filePath = path.join(directory, filename);
    if (apply) {
      await mkdir(directory, { recursive: true });
      let existing: Buffer | null = null;
      try { await access(filePath); existing = await readFile(filePath); validateImageBuffer(existing); } catch { existing = null; }
      if (!existing?.equals(downloaded.buffer)) await writeFile(filePath, downloaded.buffer);
    }
    return `/question-materials/${paperKey}/${filename}`;
  });
}

async function applyCandidate(db: PrismaClient, candidate: VerifiedMaterialGroup, blocks: MaterialBlock[]) {
  const parsed = parseMaterialHtml(candidate.group.html);
  const year = Number(candidate.paper.title.match(/(20\d{2})/)?.[1]) || null;
  const externalKey = sourceMaterialExternalKey(candidate.paper, candidate.group);
  await db.$transaction(async (transaction) => {
    const current = await transaction.question.findMany({
      where: { id: { in: candidate.localQuestions.map((question) => question.id) } },
      select: { id: true, externalKey: true, paperTitle: true, stem: true, options: true, answer: true, status: true, materialId: true, materialOrder: true },
    });
    const linkedMaterialIds = [...new Set(
      current.map((question) => question.materialId).filter((id): id is string => Boolean(id)),
    )];
    const currentMaterials = linkedMaterialIds.length
      ? await transaction.questionMaterial.findMany({
          where: { id: { in: linkedMaterialIds } },
          select: { id: true, externalKey: true, blocks: true, questions: { select: { id: true } } },
        })
      : [];
    const verified = verifyMissingMaterialGroup(
      candidate.paper,
      candidate.group,
      new Map(current.map((question) => [question.externalKey!, question])),
      new Map(currentMaterials.map((material) => [material.id, {
        blocks: material.blocks,
        externalKey: material.externalKey,
        id: material.id,
        questionIds: material.questions.map((question) => question.id),
      }])),
    );
    if (!verified.ok) throw new Error(`candidate-changed:${verified.reason}`);
    const material = await transaction.questionMaterial.upsert({
      where: { externalKey },
      update: { title: `${candidate.paper.title} 材料组（${candidate.group.index + 1}）`, content: parsed.content, blocks: blocks as Prisma.InputJsonValue, sourceUrl: candidate.paper.source_url || `${baseUrl}/practice/online/?paperId=${candidate.paper.id}`, paperTitle: candidate.paper.title, year, region: candidate.paper.region },
      create: { externalKey, title: `${candidate.paper.title} 材料组（${candidate.group.index + 1}）`, content: parsed.content, blocks: blocks as Prisma.InputJsonValue, sourceUrl: candidate.paper.source_url || `${baseUrl}/practice/online/?paperId=${candidate.paper.id}`, paperTitle: candidate.paper.title, year, region: candidate.paper.region },
    });
    for (let index = 0; index < verified.value.localQuestions.length; index += 1) {
      await transaction.question.update({ where: { id: verified.value.localQuestions[index].id }, data: { materialId: material.id, materialOrder: index + 1 } });
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function main() {
  const apply = process.argv.includes("--apply");
  const db = new PrismaClient();
  try {
    const [papers, localQuestions, materialRows] = await Promise.all([
      loadPapers(),
      db.question.findMany({ select: { id: true, externalKey: true, paperTitle: true, stem: true, options: true, answer: true, status: true, materialId: true, materialOrder: true } }),
      db.questionMaterial.findMany({
        select: { id: true, externalKey: true, blocks: true, questions: { select: { id: true } } },
      }),
    ]);
    const localByExternalKey = new Map(localQuestions.filter((question) => question.externalKey).map((question) => [question.externalKey!, question]));
    const localMaterials = new Map(materialRows.map((material) => [material.id, {
      blocks: material.blocks,
      externalKey: material.externalKey,
      id: material.id,
      questionIds: material.questions.map((question) => question.id),
    }]));
    const candidates: VerifiedMaterialGroup[] = [];
    const rejected: Record<string, number> = {};
    for (const paper of papers) {
      for (const group of collectSourceMaterialGroups(paper)) {
        const result = verifyMissingMaterialGroup(paper, group, localByExternalKey, localMaterials);
        if (result.ok) candidates.push(result.value);
        else rejected[result.reason.split(":", 1)[0]] = (rejected[result.reason.split(":", 1)[0]] || 0) + 1;
      }
    }

    const failures: Array<{ paperId: number; hash: string; error: string }> = [];
    let applied = 0;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      try {
        const blocks = await localizedBlocks(candidate, apply);
        if (apply) { await applyCandidate(db, candidate, blocks); applied += 1; }
      } catch (reason) {
        failures.push({ paperId: candidate.paper.id, hash: candidate.group.hash, error: reason instanceof Error ? reason.message : String(reason) });
      }
    }
    console.log(JSON.stringify({
      dryRun: !apply,
      papers: papers.length,
      candidates: candidates.length,
      candidateQuestions: candidates.length * 5,
      createMissing: candidates.filter((candidate) => candidate.mode === "CREATE_MISSING").length,
      repairDamaged: candidates.filter((candidate) => candidate.mode === "REPAIR_DAMAGED").length,
      validated: candidates.length - failures.length,
      applied,
      rejected,
      failures,
    }, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally { await db.$disconnect(); }
}

const directEntry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === directEntry) main().catch((reason) => { console.error(reason); process.exitCode = 1; });

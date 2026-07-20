import { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateImageBuffer } from "./repair-missing-question-materials";

const expectedDiagramHash = "7e3acec054e88e2410ee77b8298a55138162f49c89e96d7fcafa558f92498758";
const expectedFormulaHash = "290633f68ae9564a614917c03bad4205c938f904df34d7b5ff02ddaaf765ae2c";
const formulaPublicPath = `/question-images/${expectedFormulaHash.slice(0, 2)}/${expectedFormulaHash}.png`;
const imageTagPattern = /<img\b[^>]*>/gi;
const imageSourcePattern = /\bsrc\s*=\s*["']([^"']+)["']/i;

const approvedQuestions = [
  ["gkzhenti:1716870707389:34", "1716870707389"],
  ["gkzhenti:1716870707689:71", "1716870707689"],
  ["gkzhenti:1716870707992:70", "1716870707992"],
  ["gkzhenti:1716870708194:14", "1716870708194"],
  ["gkzhenti:1716870708295:61", "1716870708295"],
  ["gkzhenti:1716870708496:70", "1716870708496"],
  ["gkzhenti:1720413487446:70", "1720413487446"],
  ["gkzhenti:1720413487647:79", "1720413487647"],
] as const;

export type DirectImageQuestion = {
  answer: number;
  externalKey: string | null;
  options: unknown;
  status: "DRAFT" | "PUBLISHED";
  stem: string;
};

export function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function repairedDirectImageStem(stem: string) {
  const formula = `<img src="${formulaPublicPath}" alt="sqrt(5) is approximately 2.24" class="inline-img" style="display:inline;vertical-align:middle;max-height:1.5em;">`;
  return `${formula}${stem}`;
}

function questionImageSources(stem: string) {
  return (stem.match(imageTagPattern) || [])
    .map((tag) => tag.match(imageSourcePattern)?.[1] || "")
    .filter(Boolean);
}

function verifyQuestionMetadata(question: DirectImageQuestion) {
  if (!approvedQuestions.some(([externalKey]) => externalKey === question.externalKey)) return "not-approved";
  if (question.status !== "PUBLISHED") return "not-published";
  if (question.answer !== 2 || JSON.stringify(question.options) !== JSON.stringify(["8", "10", "12", "14"])) {
    return "answer-or-options-mismatch";
  }
  return null;
}

export function verifyDirectImageCandidate(
  question: DirectImageQuestion,
  localDiagram: Buffer,
  sourceFormula: Buffer,
  sourceDiagram: Buffer,
) {
  const metadataError = verifyQuestionMetadata(question);
  if (metadataError) return { ok: false as const, reason: metadataError };
  const tags = question.stem.match(imageTagPattern) || [];
  if (tags.length !== 1 || question.stem.replace(imageTagPattern, "").trim()) {
    return { ok: false as const, reason: "unexpected-stem-shape" };
  }
  if (question.stem.includes(formulaPublicPath)) return { ok: false as const, reason: "already-repaired" };
  validateImageBuffer(localDiagram);
  validateImageBuffer(sourceFormula);
  validateImageBuffer(sourceDiagram);
  if (sha256(localDiagram) !== expectedDiagramHash || sha256(sourceDiagram) !== expectedDiagramHash) {
    return { ok: false as const, reason: "diagram-hash-mismatch" };
  }
  if (sha256(sourceFormula) !== expectedFormulaHash) return { ok: false as const, reason: "formula-hash-mismatch" };
  return { ok: true as const, stem: repairedDirectImageStem(question.stem) };
}

export function verifyAlreadyRepairedDirectImageCandidate(
  question: DirectImageQuestion,
  localFormula: Buffer,
  localDiagram: Buffer,
  expectedHashes = { formula: expectedFormulaHash, diagram: expectedDiagramHash },
) {
  const metadataError = verifyQuestionMetadata(question);
  if (metadataError) return { ok: false as const, reason: metadataError };
  const tags = question.stem.match(imageTagPattern) || [];
  const sources = questionImageSources(question.stem);
  if (
    tags.length !== 2 ||
    sources.length !== 2 ||
    sources[0] !== formulaPublicPath ||
    !sources[1].startsWith("/question-images/") ||
    question.stem.replace(imageTagPattern, "").trim()
  ) {
    return { ok: false as const, reason: "unexpected-repaired-stem-shape" };
  }
  validateImageBuffer(localFormula);
  validateImageBuffer(localDiagram);
  if (sha256(localFormula) !== expectedHashes.formula) return { ok: false as const, reason: "local-formula-hash-mismatch" };
  if (sha256(localDiagram) !== expectedHashes.diagram) return { ok: false as const, reason: "diagram-hash-mismatch" };
  return { ok: true as const };
}

function localImageFile(source: string) {
  if (!source.startsWith("/question-images/")) throw new Error("local-image-path-missing");
  const root = path.resolve(process.cwd(), "public");
  const file = path.resolve(root, `.${source}`);
  if (!file.startsWith(`${root}${path.sep}`)) throw new Error("local-image-path-invalid");
  return file;
}

async function fetchImage(url: string) {
  let error = "request-failed";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
        headers: { Accept: "image/*", "User-Agent": "ZhizhengGovExam/1.5 direct-image-repair" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      validateImageBuffer(buffer);
      return buffer;
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }
  throw new Error(`${url}: ${error}`);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const db = new PrismaClient();
  const failures: Array<{ externalKey: string; error: string }> = [];
  let validated = 0;
  let updated = 0;
  let alreadyRepaired = 0;
  let formulaReady = false;
  try {
    for (const [externalKey, paperId] of approvedQuestions) {
      try {
        const question = await db.question.findUnique({
          where: { externalKey },
          select: { id: true, externalKey: true, stem: true, options: true, answer: true, status: true },
        });
        if (!question) throw new Error("question-not-found");
        const existingSources = questionImageSources(question.stem);
        if (existingSources.includes(formulaPublicPath)) {
          const [localFormula, localDiagram] = await Promise.all([
            readFile(localImageFile(existingSources[0] || "")),
            readFile(localImageFile(existingSources[1] || "")),
          ]);
          const existing = verifyAlreadyRepairedDirectImageCandidate(question, localFormula, localDiagram);
          if (!existing.ok) throw new Error(existing.reason);
          validated += 1;
          alreadyRepaired += 1;
          formulaReady = true;
          continue;
        }
        const [localDiagram, sourceFormula, sourceDiagram] = await Promise.all([
          readFile(localImageFile(existingSources[0] || "")),
          fetchImage(`https://upload.gkzhenti.cn/${paperId}/f5523cc75faf4986813b7c50945b7cae`),
          fetchImage(`https://upload.gkzhenti.cn/${paperId}/18e46d8839e7115.png`),
        ]);
        const result = verifyDirectImageCandidate(question, localDiagram, sourceFormula, sourceDiagram);
        if (!result.ok) throw new Error(result.reason);
        validated += 1;
        if (!apply) continue;
        if (!formulaReady) {
          const file = path.join(process.cwd(), "public", ...formulaPublicPath.split("/").filter(Boolean));
          await mkdir(path.dirname(file), { recursive: true });
          try {
            if (sha256(await readFile(file)) !== expectedFormulaHash) throw new Error("existing-formula-hash-mismatch");
          } catch (reason) {
            if ((reason as NodeJS.ErrnoException).code !== "ENOENT") throw reason;
            await writeFile(file, sourceFormula);
          }
          formulaReady = true;
        }
        const changed = await db.question.updateMany({
          where: {
            id: question.id,
            stem: question.stem,
            status: "PUBLISHED",
            answer: question.answer,
            options: { equals: question.options as Prisma.InputJsonValue },
          },
          data: { stem: result.stem },
        });
        if (changed.count !== 1) throw new Error("question-changed-during-repair");
        updated += 1;
      } catch (reason) {
        failures.push({ externalKey, error: reason instanceof Error ? reason.message : String(reason) });
      }
    }
    console.log(JSON.stringify({ dryRun: !apply, approved: approvedQuestions.length, validated, alreadyRepaired, updated, formulaPublicPath, failures }, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

const directEntry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === directEntry) main().catch((reason) => { console.error(reason); process.exitCode = 1; });

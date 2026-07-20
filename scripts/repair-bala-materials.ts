import { Prisma, PrismaClient } from "@prisma/client";
import { access } from "node:fs/promises";
import path from "node:path";
import {
  localizeMaterialImages,
  materialHash,
  materialImageSources,
  parseMaterialHtml,
  type MaterialBlock,
} from "./lib/material-html";

const db = new PrismaClient();
const baseUrl = "https://balagk.com";
const dryRun = process.argv.includes("--dry-run");
const requestIntervalMs = Math.max(100, Number(process.env.BALA_REQUEST_INTERVAL_MS || 250));
const repairLimit = Math.max(0, Number(process.env.BALA_MATERIAL_REPAIR_LIMIT || 0));
const publicRoot = path.resolve(process.cwd(), "public");

type BalaPaper = { id: number; questions?: Array<{ material?: string }> };
type RepairFailure = { externalKey: string; error: string };

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchPaper(paperId: string) {
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/papers/${paperId}`, {
        signal: AbortSignal.timeout(20_000),
        headers: {
          Accept: "application/json",
          "User-Agent": "ZhizhengGovExam/1.4 bala-material-repair",
        },
      });
      if (response.ok) return response.json() as Promise<BalaPaper>;
      lastError = `HTTP ${response.status}`;
    } catch (reason) {
      lastError = reason instanceof Error ? reason.message : String(reason);
    }
    await wait(attempt * 500);
  }
  throw new Error(`BALA API 读取失败：${lastError}`);
}

function parseExternalKey(externalKey: string) {
  const match = externalKey.match(/^bala-material:(\d+):([a-f0-9]{16})$/i);
  return match ? { paperId: match[1], hash: match[2].toLowerCase() } : null;
}

function asMaterialBlocks(value: Prisma.JsonValue): MaterialBlock[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (block): block is MaterialBlock =>
      Boolean(block) &&
      typeof block === "object" &&
      !Array.isArray(block) &&
      typeof (block as { type?: unknown }).type === "string",
  );
}

function localMaterialFile(publicUrl: string) {
  const pathname = publicUrl.split(/[?#]/, 1)[0];
  if (!pathname.startsWith("/question-materials/")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const filePath = path.resolve(publicRoot, `.${decoded}`);
  return filePath.startsWith(`${publicRoot}${path.sep}`) ? filePath : null;
}

async function verifyLocalImages(urls: readonly string[]) {
  for (const url of urls) {
    const filePath = localMaterialFile(url);
    if (!filePath) throw new Error(`旧 block 中不是本地材料图片：${url}`);
    try {
      await access(filePath);
    } catch {
      throw new Error(`本地材料图片不存在：${url}`);
    }
  }
}

async function main() {
  const rows = await db.questionMaterial.findMany({
    where: { externalKey: { startsWith: "bala-material:" } },
    select: { id: true, externalKey: true, content: true, blocks: true },
    orderBy: { externalKey: "asc" },
    ...(repairLimit ? { take: repairLimit } : {}),
  });
  const rowsByPaper = new Map<string, typeof rows>();
  const failures: RepairFailure[] = [];
  let matched = 0;
  let updated = 0;
  let wouldUpdate = 0;
  let skipped = 0;

  for (const row of rows) {
    const key = parseExternalKey(row.externalKey);
    if (!key) {
      failures.push({ externalKey: row.externalKey, error: "externalKey 格式无效" });
      continue;
    }
    rowsByPaper.set(key.paperId, [...(rowsByPaper.get(key.paperId) || []), row]);
  }

  let paperIndex = 0;
  for (const [paperId, paperRows] of rowsByPaper) {
    paperIndex += 1;
    try {
      const paper = await fetchPaper(paperId);
      const htmlByHash = new Map<string, string>();
      for (const question of paper.questions || []) {
        const html = question.material || "";
        if (html) htmlByHash.set(materialHash(html), html);
      }

      for (const row of paperRows) {
        try {
          const key = parseExternalKey(row.externalKey)!;
          const html = htmlByHash.get(key.hash);
          if (!html || materialHash(html) !== key.hash) {
            throw new Error("API 中未找到 exact hash 对应的材料 HTML");
          }
          matched += 1;

          const parsed = parseMaterialHtml(html);
          const remoteImageCount = materialImageSources(parsed.blocks).length;
          const localUrls = materialImageSources(asMaterialBlocks(row.blocks)).filter((url) =>
            url.startsWith("/question-materials/"),
          );
          if (remoteImageCount !== localUrls.length) {
            throw new Error(`图片数量不一致：API ${remoteImageCount}，本地 ${localUrls.length}`);
          }
          await verifyLocalImages(localUrls);
          const blocks = await localizeMaterialImages(
            parsed.blocks,
            (_source, imageIndex) => localUrls[imageIndex],
          );
          const changed = row.content !== parsed.content || JSON.stringify(row.blocks) !== JSON.stringify(blocks);
          if (!changed) {
            skipped += 1;
            continue;
          }

          if (dryRun) {
            wouldUpdate += 1;
            continue;
          }
          await db.questionMaterial.update({
            where: { id: row.id },
            data: { content: parsed.content, blocks: blocks as Prisma.InputJsonValue },
          });
          updated += 1;
        } catch (reason) {
          failures.push({
            externalKey: row.externalKey,
            error: reason instanceof Error ? reason.message : String(reason),
          });
        }
      }
      console.log(`[${paperIndex}/${rowsByPaper.size}] BALA 试卷 ${paperId}：${paperRows.length} 组材料`);
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : String(reason);
      for (const row of paperRows) failures.push({ externalKey: row.externalKey, error });
    }
    await wait(requestIntervalMs);
  }

  console.log(JSON.stringify({
    dryRun,
    scanned: rows.length,
    matched,
    updated,
    wouldUpdate,
    skipped,
    failed: failures.length,
    failureSamples: failures.slice(0, 30),
  }, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().finally(() => db.$disconnect());

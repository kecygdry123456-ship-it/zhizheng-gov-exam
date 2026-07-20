import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const db = new PrismaClient();
const imagePattern = /(<img\b[^>]*\bsrc\s*=\s*["'])([^"']+)(["'][^>]*>)/gi;
const root = path.join(process.cwd(), "public", "question-images");
const concurrency = Math.min(24, Math.max(2, Number(process.env.QUESTION_IMAGE_CONCURRENCY || 10)));

function hash(value: string) { return createHash("sha256").update(value).digest("hex").slice(0, 24); }
function remote(value: string) { return /^https?:\/\//i.test(value); }
function urls(value: string) { return [...value.matchAll(imagePattern)].map((match) => match[2]).filter(remote); }
function replaceUrls(value: string, mapping: Map<string, string>) { return value.replace(imagePattern, (tag, before, url, after) => `${before}${mapping.get(url) || url}${after}`); }

function imageExtension(contentType: string, buffer: Buffer) {
  const type = contentType.toLowerCase();
  if (type.includes("svg") || buffer.subarray(0, 200).toString("utf8").includes("<svg")) return ".svg";
  if (type.includes("bmp") || buffer.subarray(0, 2).toString("ascii") === "BM") return ".bmp";
  if (type.includes("webp") || buffer.subarray(8, 12).toString("ascii") === "WEBP") return ".webp";
  if (type.includes("gif") || buffer.subarray(0, 3).toString("ascii") === "GIF") return ".gif";
  if (type.includes("jpeg") || (buffer[0] === 0xff && buffer[1] === 0xd8)) return ".jpg";
  return ".png";
}

async function normalizeImageBuffer(buffer: Buffer) {
  const png = buffer.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (png >= 0 && png <= 16) {
    const end = buffer.indexOf(Buffer.from("IEND"), png);
    return end > 0 ? buffer.subarray(png, Math.min(buffer.length, end + 8)) : buffer.subarray(png);
  }
  if ((buffer[0] === 0xff && buffer[1] === 0xd8) || buffer.subarray(0, 3).toString("ascii") === "GIF" || buffer.subarray(8, 12).toString("ascii") === "WEBP" || buffer.subarray(4, 12).toString("ascii").includes("ftypavif") || buffer.subarray(0, 300).toString("utf8").includes("<svg")) return buffer;
  const isBmp = buffer.subarray(0, 2).toString("ascii") === "BM";
  const isTiff = buffer.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || buffer.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]));
  if (isBmp) return buffer;
  if (isTiff) return sharp(buffer).png().toBuffer();
  throw new Error("源站返回的内容不是可识别图片");
}

async function existingPublicPath(url: string) {
  const key = hash(url); const directory = path.join(root, key.slice(0, 2));
  for (const extension of [".png", ".jpg", ".webp", ".gif", ".svg"]) {
    try { await access(path.join(directory, `${key}${extension}`)); return `/question-images/${key.slice(0, 2)}/${key}${extension}`; }
    catch { /* continue */ }
  }
  return "";
}

async function download(url: string) {
  const existing = await existingPublicPath(url); if (existing) return existing;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "ZhizhengGovExam/1.3 question-image-localizer", Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const downloaded = Buffer.from(await response.arrayBuffer()); if (downloaded.length < 20) throw new Error("图片内容为空");
      const buffer = await normalizeImageBuffer(downloaded);
      const key = hash(url); const extension = imageExtension(response.headers.get("content-type") || "", buffer); const directory = path.join(root, key.slice(0, 2));
      await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, `${key}${extension}`), buffer);
      return `/question-images/${key.slice(0, 2)}/${key}${extension}`;
    } catch (reason) {
      if (attempt === 3) throw reason;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  return "";
}

async function main() {
  const questions = await db.question.findMany({ select: { id: true, stem: true, options: true, explanation: true } });
  const unique = new Set<string>();
  for (const question of questions) {
    const options = Array.isArray(question.options) ? question.options.map(String) : [];
    for (const value of [question.stem, ...options, question.explanation]) for (const url of urls(value)) unique.add(url);
  }
  const queue = [...unique]; const mapping = new Map<string, string>(); const failures: { url: string; error: string }[] = []; let cursor = 0;
  async function worker() {
    while (cursor < queue.length) {
      const index = cursor++; const url = queue[index];
      try { mapping.set(url, await download(url)); }
      catch (reason) { failures.push({ url, error: reason instanceof Error ? reason.message : String(reason) }); }
      if ((index + 1) % 100 === 0 || index + 1 === queue.length) console.log(`图片处理 ${index + 1}/${queue.length}，失败 ${failures.length}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  let updated = 0;
  for (let start = 0; start < questions.length; start += 50) {
    const batch = questions.slice(start, start + 50);
    await Promise.all(batch.map(async (question) => {
      const options = Array.isArray(question.options) ? question.options.map(String) : [];
      const stem = replaceUrls(question.stem, mapping); const nextOptions = options.map((option) => replaceUrls(option, mapping)); const explanation = replaceUrls(question.explanation, mapping);
      if (stem === question.stem && explanation === question.explanation && nextOptions.every((option, index) => option === options[index])) return;
      await db.question.update({ where: { id: question.id }, data: { stem, options: nextOptions, explanation } }); updated += 1;
    }));
  }
  console.log(JSON.stringify({ questions: questions.length, uniqueRemoteImages: queue.length, localizedImages: mapping.size, failedImages: failures.length, updatedQuestions: updated, failureSamples: failures.slice(0, 20) }, null, 2));
}

main().finally(() => db.$disconnect());

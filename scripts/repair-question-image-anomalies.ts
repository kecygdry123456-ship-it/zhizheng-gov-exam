import { PrismaClient } from "@prisma/client";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const db = new PrismaClient();
const root = path.join(process.cwd(), "public", "question-images");

async function files(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(item)); else result.push(item);
  }
  return result;
}

function valid(buffer: Buffer) {
  return (buffer[0] === 0x89 && buffer.subarray(1, 4).toString("ascii") === "PNG") || (buffer[0] === 0xff && buffer[1] === 0xd8) || buffer.subarray(0, 3).toString("ascii") === "GIF" || buffer.subarray(8, 12).toString("ascii") === "WEBP" || buffer.subarray(4, 12).toString("ascii").includes("ftypavif") || buffer.subarray(0, 300).toString("utf8").includes("<svg");
}

function repairWrappedPng(buffer: Buffer) {
  const signature = buffer.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (signature < 0 || signature > 16) return null;
  const end = buffer.indexOf(Buffer.from("IEND"), signature);
  return end > signature ? buffer.subarray(signature, Math.min(buffer.length, end + 8)) : buffer.subarray(signature);
}

async function main() {
  const repaired: string[] = []; const invalid: string[] = [];
  for (const file of await files(root)) {
    const buffer = await readFile(file);
    if (valid(buffer)) continue;
    const normalized = repairWrappedPng(buffer);
    if (normalized && valid(normalized)) { await writeFile(file, normalized); repaired.push(file); }
    else invalid.push(file);
  }
  const questions = await db.question.findMany({ select: { id: true, stem: true, options: true, explanation: true, status: true } });
  const disabled: string[] = []; const explanationOnly: string[] = [];
  for (const file of invalid) {
    const publicPath = `/${path.relative(path.join(process.cwd(), "public"), file).split(path.sep).join("/")}`;
    for (const question of questions) {
      const options = Array.isArray(question.options) ? question.options.map(String) : [];
      if (question.stem.includes(publicPath) || options.some((option) => option.includes(publicPath))) {
        if (question.status !== "DRAFT") await db.question.update({ where: { id: question.id }, data: { status: "DRAFT" } });
        disabled.push(question.id);
      } else if (question.explanation.includes(publicPath)) explanationOnly.push(question.id);
    }
  }
  console.log(JSON.stringify({ repairedImages: repaired.length, invalidImages: invalid.length, disabledQuestions: [...new Set(disabled)], explanationOnlyQuestions: [...new Set(explanationOnly)], invalidFiles: invalid.map((file) => path.relative(process.cwd(), file)) }, null, 2));
}

main().finally(() => db.$disconnect());

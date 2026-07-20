import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  MISSING_IMAGE_AUDIT_SCHEMA_VERSION,
  auditCoverageFingerprints,
  auditParsedPaper,
  databaseQuestionImageSources,
  parseGkzhentiExternalKey,
  parseSourcePaperHtml,
  questionAuditFingerprint,
  type AuditQuestion,
  type DirectQuestionImageFinding,
  type MaterialGroupFinding,
} from "./lib/missing-image-audit";

const db = new PrismaClient();
const defaultReportPath = path.resolve(process.cwd(), "reports", "missing-image-audit.json");
const publicRoot = path.resolve(process.cwd(), "public");

type Config = {
  dryRun: boolean;
  limit: number;
  paperId: string | null;
  reportPath: string;
  requestIntervalMs: number;
  retries: number;
  timeoutMs: number;
};

type FailedPaper = {
  attempts: number;
  balaFallbackEligible: true;
  candidateExternalKeys: string[];
  error: string;
  paperId: string;
  paperTitle: string | null;
  sourceUrl: string;
};

type AuditReport = {
  coverage: {
    auditedExternalKeys: string[];
    auditedQuestions: Array<{ externalKey: string; fingerprint: string }>;
    successfulPaperIds: string[];
  };
  failedPapers: FailedPaper[];
  findings: {
    directQuestionImages: DirectQuestionImageFinding[];
    materialGroups: MaterialGroupFinding[];
  };
  generatedAt: string;
  mode: "REPORT_ONLY";
  parameters: {
    dryRun: boolean;
    limit: number;
    paperId: string | null;
    requestIntervalMs: number;
    retries: number;
    timeoutMs: number;
  };
  run: {
    attemptedPaperIds: string[];
    newlyAuditedExternalKeys: string[];
    successfulPaperIds: string[];
  };
  schemaVersion: number;
  source: "gkzhenti";
  summary: {
    candidatePapers: number;
    candidateQuestions: number;
    databaseQuestions: number;
    directQuestionImageFindings: number;
    failedPapers: number;
    fullyRecoverableMaterialGroups: number;
    materialGroupFindings: number;
    previouslyAuditedQuestions: number;
    priorityFiveQuestionGroups: number;
    scannedPapers: number;
    skippedExistingMaterial: number;
    skippedPreviouslyAudited: number;
    candidatesWithValidStoredImages: number;
    totalAuditedQuestions: number;
  };
};

class PaperFetchError extends Error {
  constructor(message: string, readonly attempts: number) {
    super(message);
    this.name = "PaperFetchError";
  }
}

function positiveInteger(value: string, flag: string, allowZero = false) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < (allowZero ? 0 : 1)) {
    throw new Error(`${flag} 必须是${allowZero ? "非负" : "正"}整数`);
  }
  return parsed;
}

function argumentValue(args: string[], index: number, flag: string) {
  const argument = args[index];
  const inline = argument.slice(flag.length + 1);
  if (argument.startsWith(`${flag}=`)) return { value: inline, consumed: 0 };
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} 缺少值`);
  return { value, consumed: 1 };
}

function parseArguments(args: string[]): Config {
  const config: Config = {
    dryRun: false,
    limit: 0,
    paperId: null,
    reportPath: defaultReportPath,
    requestIntervalMs: positiveInteger(process.env.GKZHENTI_AUDIT_REQUEST_INTERVAL_MS || "750", "请求间隔"),
    retries: positiveInteger(process.env.GKZHENTI_AUDIT_RETRIES || "3", "重试次数"),
    timeoutMs: positiveInteger(process.env.GKZHENTI_AUDIT_TIMEOUT_MS || "20000", "请求超时"),
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--dry-run") {
      config.dryRun = true;
      continue;
    }
    if (argument === "--report-only") continue;
    if (argument === "--fix" || argument === "--write-db") {
      throw new Error("该审计器只读，不支持写数据库参数");
    }
    const flags = ["--limit", "--paper-id", "--report", "--request-interval-ms", "--retries", "--timeout-ms"];
    const flag = flags.find((candidate) => argument === candidate || argument.startsWith(`${candidate}=`));
    if (!flag) throw new Error(`未知参数：${argument}`);
    const parsed = argumentValue(args, index, flag);
    index += parsed.consumed;
    if (flag === "--limit") config.limit = positiveInteger(parsed.value, flag, true);
    else if (flag === "--paper-id") {
      if (!/^\d+$/.test(parsed.value)) throw new Error(`${flag} 必须是数字 paperId`);
      config.paperId = parsed.value;
    } else if (flag === "--report") config.reportPath = path.resolve(process.cwd(), parsed.value);
    else if (flag === "--request-interval-ms") config.requestIntervalMs = positiveInteger(parsed.value, flag, true);
    else if (flag === "--retries") config.retries = positiveInteger(parsed.value, flag);
    else if (flag === "--timeout-ms") config.timeoutMs = positiveInteger(parsed.value, flag);
  }
  return config;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function imageFileIsValid(buffer: Buffer) {
  if (buffer.length < 12) return false;
  return (
    (buffer[0] === 0x89 && buffer.subarray(1, 4).toString("ascii") === "PNG") ||
    (buffer[0] === 0xff && buffer[1] === 0xd8) ||
    buffer.subarray(0, 3).toString("ascii") === "GIF" ||
    buffer.subarray(8, 12).toString("ascii") === "WEBP" ||
    buffer.subarray(4, 12).toString("ascii").includes("ftypavif") ||
    buffer.subarray(0, 512).toString("utf8").toLowerCase().includes("<svg")
  );
}

function publicFilePath(source: string) {
  if (!source.startsWith("/")) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(source.split(/[?#]/, 1)[0]);
  } catch {
    return null;
  }
  const resolved = path.resolve(publicRoot, `.${pathname}`);
  const relative = path.relative(publicRoot, resolved);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? resolved : null;
}

type StoredImageState = { fingerprint: string; valid: boolean };

function bufferFingerprint(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function storedImageState(source: string): Promise<StoredImageState> {
  if (/^data:image\//i.test(source)) {
    return {
      fingerprint: `data:${createHash("sha256").update(source).digest("hex")}`,
      valid: source.length > 32,
    };
  }
  const file = publicFilePath(source);
  if (!file) return { fingerprint: `nonlocal:${createHash("sha256").update(source).digest("hex")}`, valid: false };
  try {
    const buffer = await readFile(file);
    return { fingerprint: `file:${bufferFingerprint(buffer)}`, valid: imageFileIsValid(buffer) };
  } catch {
    return { fingerprint: "missing", valid: false };
  }
}

async function questionStoredImageState(question: AuditQuestion, cache: Map<string, StoredImageState>) {
  const sources = databaseQuestionImageSources(question);
  const fingerprints: string[] = [];
  let allValid = sources.length > 0;
  let validCount = 0;
  for (const source of sources) {
    let state = cache.get(source);
    if (!state) {
      state = await storedImageState(source);
      cache.set(source, state);
    }
    fingerprints.push(`${source}:${state.fingerprint}`);
    if (!state.valid) allValid = false;
    else validCount += 1;
  }
  return { allValid, fingerprint: questionAuditFingerprint(question, fingerprints), validCount };
}

async function readPreviousReport(reportPath: string) {
  try {
    const raw = await readFile(reportPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("根节点不是对象");
    return parsed as Partial<AuditReport>;
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`无法读取历史审计报告 ${reportPath}：${reason instanceof Error ? reason.message : String(reason)}`);
  }
}

function paperUrl(paperId: string) {
  const baseUrl = process.env.GKZHENTI_BASE_URL || "https://gwy.gkzhenti.cn";
  return new URL(`/paper/${paperId}`, baseUrl).toString();
}

function requestScheduler(intervalMs: number) {
  let lastRequestAt = 0;
  return async () => {
    const delay = Math.max(0, intervalMs - (Date.now() - lastRequestAt));
    if (delay) await wait(delay);
    lastRequestAt = Date.now();
  };
}

async function fetchPaper(
  url: string,
  config: Pick<Config, "requestIntervalMs" | "retries" | "timeoutMs">,
  beforeRequest: () => Promise<void>,
) {
  let lastError = "未知错误";
  for (let attempt = 1; attempt <= config.retries; attempt += 1) {
    await beforeRequest();
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "ZhizhengGovExam/1.5 missing-image-audit",
        },
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      if (response.ok) {
        const html = await response.text();
        const parsed = parseSourcePaperHtml(html, url);
        if (parsed.questionRows.length || parsed.materialGroups.length) return { html, attempts: attempt };
        lastError = "响应中缺少可解析的 #printcontent 题目行";
      } else {
        lastError = `HTTP ${response.status}`;
      }
    } catch (reason) {
      lastError = reason instanceof Error ? reason.message : String(reason);
    }
    if (attempt < config.retries) await wait(Math.min(4_000, 400 * 2 ** (attempt - 1)));
  }
  throw new PaperFetchError(lastError, config.retries);
}

function arrayFromPrevious<T>(value: unknown) {
  return Array.isArray(value) ? value as T[] : [];
}

function comparePaperIds(left: string, right: string) {
  return left.localeCompare(right, "en", { numeric: true });
}

async function writeReport(reportPath: string, report: AuditReport) {
  const temporaryPath = `${reportPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await rename(temporaryPath, reportPath);
}

async function main() {
  const config = parseArguments(process.argv.slice(2));
  const previousReport = await readPreviousReport(config.reportPath);
  const compatiblePrevious =
    previousReport?.schemaVersion === MISSING_IMAGE_AUDIT_SCHEMA_VERSION && previousReport.source === "gkzhenti"
      ? previousReport
      : null;
  const previousCoverage = auditCoverageFingerprints(compatiblePrevious);
  const previouslyAuditedQuestions = previousCoverage.size;
  const rows = await db.question.findMany({
    where: { externalKey: { startsWith: "gkzhenti:" }, status: "PUBLISHED" },
    select: {
      externalKey: true,
      materialId: true,
      options: true,
      paperTitle: true,
      sourceUrl: true,
      stem: true,
    },
    orderBy: { externalKey: "asc" },
  }) as AuditQuestion[];

  const allByPaper = new Map<string, AuditQuestion[]>();
  const candidatesByPaper = new Map<string, AuditQuestion[]>();
  const currentFingerprints = new Map<string, string>();
  const validDatabaseImageCounts = new Map<string, number>();
  const imageValidityCache = new Map<string, StoredImageState>();
  let skippedExistingMaterial = 0;
  let skippedPreviouslyAudited = 0;
  let candidatesWithValidStoredImages = 0;

  for (const question of rows) {
    const key = parseGkzhentiExternalKey(question.externalKey);
    if (!key) continue;
    allByPaper.set(key.paperId, [...(allByPaper.get(key.paperId) || []), question]);
    if (question.materialId) {
      skippedExistingMaterial += 1;
      continue;
    }
    const state = await questionStoredImageState(question, imageValidityCache);
    currentFingerprints.set(question.externalKey, state.fingerprint);
    validDatabaseImageCounts.set(question.externalKey, state.validCount);
    if (previousCoverage.get(question.externalKey) === state.fingerprint) {
      skippedPreviouslyAudited += 1;
      continue;
    }
    if (state.allValid) candidatesWithValidStoredImages += 1;
    candidatesByPaper.set(key.paperId, [...(candidatesByPaper.get(key.paperId) || []), question]);
  }

  let candidatePaperIds = [...candidatesByPaper.keys()]
    .filter((paperId) => !config.paperId || paperId === config.paperId)
    .sort(comparePaperIds);
  if (config.limit) candidatePaperIds = candidatePaperIds.slice(0, config.limit);
  const selectedCandidateCount = candidatePaperIds.reduce((sum, paperId) => sum + (candidatesByPaper.get(paperId)?.length || 0), 0);

  const previousDirect = arrayFromPrevious<DirectQuestionImageFinding>(compatiblePrevious?.findings?.directQuestionImages)
    .filter((finding) => previousCoverage.get(finding.externalKey) === currentFingerprints.get(finding.externalKey));
  const previousGroups = arrayFromPrevious<MaterialGroupFinding>(compatiblePrevious?.findings?.materialGroups)
    .filter((finding) => finding.externalKeys.some((key) => previousCoverage.get(key) === currentFingerprints.get(key)));
  const directByKey = new Map(previousDirect.map((finding) => [finding.externalKey, finding]));
  const groupsByKey = new Map(previousGroups.map((finding) => [finding.groupKey, finding]));
  const failedByPaper = new Map(arrayFromPrevious<FailedPaper>(compatiblePrevious?.failedPapers).map((failure) => [failure.paperId, failure]));
  const successfulPaperIds = new Set(arrayFromPrevious<string>(compatiblePrevious?.coverage?.successfulPaperIds));
  const newlyAuditedExternalKeys: string[] = [];
  const runSuccessfulPaperIds: string[] = [];
  const beforeRequest = requestScheduler(config.requestIntervalMs);

  for (let index = 0; index < candidatePaperIds.length; index += 1) {
    const paperId = candidatePaperIds[index];
    const candidates = candidatesByPaper.get(paperId) || [];
    const allQuestions = allByPaper.get(paperId) || [];
    const sourceUrl = paperUrl(paperId);
    const paperTitle = allQuestions.find((question) => question.paperTitle)?.paperTitle || null;
    const eligibleExternalKeys = new Set(candidates.map((question) => question.externalKey));
    try {
      const fetched = await fetchPaper(sourceUrl, config, beforeRequest);
      const parsed = parseSourcePaperHtml(fetched.html, sourceUrl);
      const findings = auditParsedPaper({
        allQuestions,
        databaseValidImageCounts: validDatabaseImageCounts,
        eligibleExternalKeys,
        pageUrl: sourceUrl,
        paperId,
        paperTitle,
        parsed,
      });
      const ambiguousNumbers = new Set(parsed.duplicateQuestionNumbers);
      const sourceNumbers = new Set(parsed.questionRows.map((row) => row.number));
      const auditedCandidates = candidates.filter((question) => {
        const key = parseGkzhentiExternalKey(question.externalKey);
        return Boolean(key && sourceNumbers.has(key.number) && !ambiguousNumbers.has(key.number));
      });
      const auditedKeys = new Set(auditedCandidates.map((question) => question.externalKey));
      const missingCandidates = candidates.filter((question) => !auditedKeys.has(question.externalKey));
      for (const externalKey of auditedKeys) directByKey.delete(externalKey);
      for (const [groupKey, finding] of groupsByKey) {
        if (finding.paperId === paperId && finding.externalKeys.some((externalKey) => auditedKeys.has(externalKey))) {
          groupsByKey.delete(groupKey);
        }
      }
      for (const finding of findings.directQuestionImages) directByKey.set(finding.externalKey, finding);
      for (const question of auditedCandidates) {
        const externalKey = question.externalKey;
        const fingerprint = currentFingerprints.get(externalKey);
        if (!fingerprint) continue;
        if (!previousCoverage.has(externalKey)) newlyAuditedExternalKeys.push(externalKey);
        previousCoverage.set(externalKey, fingerprint);
      }
      if (missingCandidates.length) {
        const candidateExternalKeys = missingCandidates.map((question) => question.externalKey).sort();
        failedByPaper.set(paperId, {
          attempts: fetched.attempts,
          balaFallbackEligible: true,
          candidateExternalKeys,
          error: `源页缺少或重复 ${candidateExternalKeys.length} 道待审题的题目行`,
          paperId,
          paperTitle,
          sourceUrl,
        });
        successfulPaperIds.delete(paperId);
        console.warn(`[${index + 1}/${candidatePaperIds.length}] ${paperId}：仅确认 ${auditedCandidates.length}/${candidates.length} 道，剩余题目保留待审`);
        continue;
      }
      for (const finding of findings.materialGroups) groupsByKey.set(finding.groupKey, finding);
      successfulPaperIds.add(paperId);
      runSuccessfulPaperIds.push(paperId);
      failedByPaper.delete(paperId);
      console.log(`[${index + 1}/${candidatePaperIds.length}] ${paperId}：直接缺图 ${findings.directQuestionImages.length}，材料组 ${findings.materialGroups.length}`);
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : String(reason);
      failedByPaper.set(paperId, {
        attempts: reason instanceof PaperFetchError ? reason.attempts : 0,
        balaFallbackEligible: true,
        candidateExternalKeys: [...eligibleExternalKeys].sort(),
        error,
        paperId,
        paperTitle,
        sourceUrl,
      });
      console.warn(`[${index + 1}/${candidatePaperIds.length}] ${paperId} 抓取失败：${error}`);
    }
  }

  const directQuestionImages = [...directByKey.values()].sort((a, b) =>
    a.paperId.localeCompare(b.paperId, "en", { numeric: true }) || a.number - b.number,
  );
  const materialGroups = [...groupsByKey.values()].sort((a, b) =>
    Number(b.priorityFiveQuestionGroup) - Number(a.priorityFiveQuestionGroup) ||
    Number(b.fullyRecoverable) - Number(a.fullyRecoverable) ||
    a.groupKey.localeCompare(b.groupKey, "en", { numeric: true }),
  );
  const failedPapers = [...failedByPaper.values()].sort((a, b) => comparePaperIds(a.paperId, b.paperId));
  const report: AuditReport = {
    coverage: {
      auditedExternalKeys: [...previousCoverage.keys()].sort(),
      auditedQuestions: [...previousCoverage]
        .map(([externalKey, fingerprint]) => ({ externalKey, fingerprint }))
        .sort((left, right) => left.externalKey.localeCompare(right.externalKey, "en", { numeric: true })),
      successfulPaperIds: [...successfulPaperIds].sort(comparePaperIds),
    },
    failedPapers,
    findings: { directQuestionImages, materialGroups },
    generatedAt: new Date().toISOString(),
    mode: "REPORT_ONLY",
    parameters: {
      dryRun: config.dryRun,
      limit: config.limit,
      paperId: config.paperId,
      requestIntervalMs: config.requestIntervalMs,
      retries: config.retries,
      timeoutMs: config.timeoutMs,
    },
    run: {
      attemptedPaperIds: candidatePaperIds,
      newlyAuditedExternalKeys: newlyAuditedExternalKeys.sort(),
      successfulPaperIds: runSuccessfulPaperIds.sort(comparePaperIds),
    },
    schemaVersion: MISSING_IMAGE_AUDIT_SCHEMA_VERSION,
    source: "gkzhenti",
    summary: {
      candidatePapers: candidatePaperIds.length,
      candidateQuestions: selectedCandidateCount,
      databaseQuestions: rows.length,
      directQuestionImageFindings: directQuestionImages.length,
      failedPapers: failedPapers.length,
      fullyRecoverableMaterialGroups: materialGroups.filter((group) => group.fullyRecoverable).length,
      materialGroupFindings: materialGroups.length,
      previouslyAuditedQuestions,
      priorityFiveQuestionGroups: materialGroups.filter((group) => group.priorityFiveQuestionGroup).length,
      scannedPapers: runSuccessfulPaperIds.length,
      skippedExistingMaterial,
      skippedPreviouslyAudited,
      candidatesWithValidStoredImages,
      totalAuditedQuestions: previousCoverage.size,
    },
  };

  if (!config.dryRun) await writeReport(config.reportPath, report);
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((reason) => {
    console.error(reason instanceof Error ? reason.message : String(reason));
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

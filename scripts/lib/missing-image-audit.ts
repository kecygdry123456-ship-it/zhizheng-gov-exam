import { load, type CheerioAPI } from "cheerio";
import { createHash } from "node:crypto";

export const MISSING_IMAGE_AUDIT_SCHEMA_VERSION = 2;

export type AuditQuestion = {
  externalKey: string;
  materialId: string | null;
  options: unknown;
  paperTitle: string | null;
  sourceUrl: string | null;
  stem: string;
};

export type ParsedGkzhentiKey = {
  number: number;
  paperId: string;
};

export type SourceQuestionRow = {
  imageSources: string[];
  number: number;
};

export type SourceMaterialGroup = {
  imageSources: string[];
  label: string;
  questionNumbers: number[];
  sourceIndex: number;
};

export type ParsedSourcePaper = {
  duplicateQuestionNumbers: number[];
  materialGroups: SourceMaterialGroup[];
  questionRows: SourceQuestionRow[];
};

export type DirectQuestionImageFinding = {
  databaseImageSources: string[];
  externalKey: string;
  number: number;
  paperId: string;
  paperTitle: string | null;
  sourceImageSources: string[];
  sourceUrl: string;
};

export type MaterialGroupFinding = {
  externalKeys: string[];
  fullyRecoverable: boolean;
  groupKey: string;
  groupSize: number;
  imageSources: string[];
  label: string;
  matchedQuestionCount: number;
  paperId: string;
  paperTitle: string | null;
  priorityFiveQuestionGroup: boolean;
  questionNumbers: number[];
  sourceUrl: string;
  unlinkedQuestionCount: number;
};

export type PaperAuditFindings = {
  directQuestionImages: DirectQuestionImageFinding[];
  materialGroups: MaterialGroupFinding[];
};

export type AuditCoverageRecord = {
  externalKey: string;
  fingerprint: string;
};

function normalizeText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function parseQuestionNumber(value: string) {
  const match = normalizeText(value).match(/^(\d+)\s*(?:[.．、。]|$)/);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizeImageSource(value: string, pageUrl?: string) {
  const source = value.trim();
  if (!source) return "";
  if (/^data:image\//i.test(source)) return source;
  try {
    return pageUrl ? new URL(source, pageUrl).toString() : new URL(source).toString();
  } catch {
    return pageUrl || !/^[a-z][a-z\d+.-]*:/i.test(source) ? source : "";
  }
}

function imageSourcesFromSelection(
  $: CheerioAPI,
  selection: ReturnType<CheerioAPI>,
  pageUrl?: string,
) {
  const sources = new Set<string>();
  selection.find("img").addBack("img").each((_, image) => {
    const element = $(image);
    const raw = element.attr("src") || element.attr("data-src") || element.attr("data-original") || "";
    const source = normalizeImageSource(raw, pageUrl);
    if (source) sources.add(source);
  });
  return [...sources];
}

export function extractHtmlImageSources(fragment: string, pageUrl?: string) {
  const $ = load(fragment || "", undefined, false);
  return imageSourcesFromSelection($, $.root(), pageUrl);
}

export function databaseQuestionImageSources(question: Pick<AuditQuestion, "stem" | "options">) {
  const fragments = [question.stem];
  if (Array.isArray(question.options)) {
    for (const option of question.options) if (typeof option === "string") fragments.push(option);
  }
  return [...new Set(fragments.flatMap((fragment) => extractHtmlImageSources(fragment)))];
}

export function questionAuditFingerprint(question: AuditQuestion, storedImageFingerprints: readonly string[]) {
  return createHash("sha256").update(JSON.stringify({
    externalKey: question.externalKey,
    materialId: question.materialId,
    options: question.options,
    paperTitle: question.paperTitle,
    sourceUrl: question.sourceUrl,
    stem: question.stem,
    storedImageFingerprints,
  })).digest("hex");
}

export function parseGkzhentiExternalKey(externalKey: string): ParsedGkzhentiKey | null {
  const match = externalKey.match(/^gkzhenti:(\d+):([1-9]\d*)$/);
  if (!match) return null;
  const number = Number(match[2]);
  if (!Number.isSafeInteger(number)) return null;
  return { paperId: match[1], number };
}

export function parseSourcePaperHtml(html: string, pageUrl?: string): ParsedSourcePaper {
  const $ = load(html || "");
  const questionRows: SourceQuestionRow[] = [];
  const materialGroups: SourceMaterialGroup[] = [];
  let activeMaterial: SourceMaterialGroup | null = null;

  $("#printcontent .row").each((_, row) => {
    const element = $(row);
    if (element.find(".subtitle").length) {
      activeMaterial = null;
      return;
    }

    const sub2title = element.find(".sub2title").first();
    if (sub2title.length) {
      activeMaterial = {
        imageSources: imageSourcesFromSelection($, element, pageUrl),
        label: normalizeText(sub2title.text()),
        questionNumbers: [],
        sourceIndex: materialGroups.length,
      };
      materialGroups.push(activeMaterial);
      return;
    }

    const number = parseQuestionNumber(element.find(".left").first().text());
    const right = element.find(".right").first();
    if (number === null || !right.length) return;
    questionRows.push({
      imageSources: imageSourcesFromSelection($, right, pageUrl),
      number,
    });
    if (activeMaterial && !activeMaterial.questionNumbers.includes(number)) {
      activeMaterial.questionNumbers.push(number);
    }
  });

  const counts = new Map<number, number>();
  for (const row of questionRows) counts.set(row.number, (counts.get(row.number) || 0) + 1);
  return {
    duplicateQuestionNumbers: [...counts].filter(([, count]) => count > 1).map(([number]) => number).sort((a, b) => a - b),
    materialGroups,
    questionRows,
  };
}

function compareExternalKeys(left: string, right: string) {
  const a = parseGkzhentiExternalKey(left);
  const b = parseGkzhentiExternalKey(right);
  if (!a || !b) return left.localeCompare(right);
  return a.paperId.localeCompare(b.paperId, "en", { numeric: true }) || a.number - b.number;
}

export function auditParsedPaper(input: {
  allQuestions: readonly AuditQuestion[];
  databaseValidImageCounts?: ReadonlyMap<string, number>;
  eligibleExternalKeys: ReadonlySet<string>;
  pageUrl: string;
  paperId: string;
  paperTitle: string | null;
  parsed: ParsedSourcePaper;
}): PaperAuditFindings {
  const questionsByNumber = new Map<number, AuditQuestion>();
  for (const question of input.allQuestions) {
    const key = parseGkzhentiExternalKey(question.externalKey);
    if (key?.paperId === input.paperId && !questionsByNumber.has(key.number)) {
      questionsByNumber.set(key.number, question);
    }
  }

  const ambiguousNumbers = new Set(input.parsed.duplicateQuestionNumbers);
  const directQuestionImages: DirectQuestionImageFinding[] = [];
  for (const sourceRow of input.parsed.questionRows) {
    if (!sourceRow.imageSources.length || ambiguousNumbers.has(sourceRow.number)) continue;
    const question = questionsByNumber.get(sourceRow.number);
    if (!question || !input.eligibleExternalKeys.has(question.externalKey)) continue;
    const databaseImageSources = databaseQuestionImageSources(question);
    const validDatabaseImageCount = input.databaseValidImageCounts?.get(question.externalKey)
      ?? databaseImageSources.length;
    if (sourceRow.imageSources.length <= validDatabaseImageCount) continue;
    directQuestionImages.push({
      databaseImageSources,
      externalKey: question.externalKey,
      number: sourceRow.number,
      paperId: input.paperId,
      paperTitle: input.paperTitle,
      sourceImageSources: sourceRow.imageSources,
      sourceUrl: input.pageUrl,
    });
  }

  const materialGroups: MaterialGroupFinding[] = [];
  for (const sourceGroup of input.parsed.materialGroups) {
    if (!sourceGroup.imageSources.length || !sourceGroup.questionNumbers.length) continue;
    const uniqueNumbers = [...new Set(sourceGroup.questionNumbers)];
    const matched = uniqueNumbers
      .filter((number) => !ambiguousNumbers.has(number))
      .map((number) => questionsByNumber.get(number))
      .filter((question): question is AuditQuestion => Boolean(question));
    const unlinked = matched.filter((question) => !question.materialId);
    if (!unlinked.some((question) => input.eligibleExternalKeys.has(question.externalKey))) continue;

    const fullyRecoverable =
      uniqueNumbers.every((number) => !ambiguousNumbers.has(number)) &&
      matched.length === uniqueNumbers.length &&
      unlinked.length === uniqueNumbers.length;
    const externalKeys = matched.map((question) => question.externalKey).sort(compareExternalKeys);
    const groupKey = `gkzhenti-group:${input.paperId}:${uniqueNumbers.join(",")}`;
    materialGroups.push({
      externalKeys,
      fullyRecoverable,
      groupKey,
      groupSize: uniqueNumbers.length,
      imageSources: sourceGroup.imageSources,
      label: sourceGroup.label,
      matchedQuestionCount: matched.length,
      paperId: input.paperId,
      paperTitle: input.paperTitle,
      priorityFiveQuestionGroup: fullyRecoverable && uniqueNumbers.length === 5,
      questionNumbers: uniqueNumbers,
      sourceUrl: input.pageUrl,
      unlinkedQuestionCount: unlinked.length,
    });
  }

  directQuestionImages.sort((a, b) => compareExternalKeys(a.externalKey, b.externalKey));
  materialGroups.sort((a, b) => a.groupKey.localeCompare(b.groupKey, "en", { numeric: true }));
  return { directQuestionImages, materialGroups };
}

export function auditCoverageFingerprints(report: unknown) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return new Map<string, string>();
  if (
    (report as { schemaVersion?: unknown }).schemaVersion !== MISSING_IMAGE_AUDIT_SCHEMA_VERSION ||
    (report as { source?: unknown }).source !== "gkzhenti"
  ) {
    return new Map<string, string>();
  }
  const coverage = (report as { coverage?: unknown }).coverage;
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) return new Map<string, string>();
  const values = (coverage as { auditedQuestions?: unknown }).auditedQuestions;
  if (!Array.isArray(values)) return new Map<string, string>();
  const records = values.filter((value): value is AuditCoverageRecord => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Partial<AuditCoverageRecord>;
    return Boolean(
      typeof record.externalKey === "string" &&
      parseGkzhentiExternalKey(record.externalKey) &&
      typeof record.fingerprint === "string" &&
      /^[a-f\d]{64}$/.test(record.fingerprint),
    );
  });
  return new Map(records.map((record) => [record.externalKey, record.fingerprint]));
}

export function auditCoverageKeys(report: unknown) {
  return new Set(auditCoverageFingerprints(report).keys());
}

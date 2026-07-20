import { createHash } from "node:crypto";
import { load } from "cheerio";

export type RichTextMaterialBlock = { type: "richText"; content: string };
export type TableMaterialBlock = { type: "table"; rows: string[][] };
export type LegacyTextMaterialBlock = { type: "text"; content: string };
export type LegacyImageMaterialBlock = { type: "image"; url: string; alt: string };
export type MaterialBlock =
  | RichTextMaterialBlock
  | TableMaterialBlock
  | LegacyTextMaterialBlock
  | LegacyImageMaterialBlock;

export type ParsedMaterial = {
  content: string;
  blocks: Array<RichTextMaterialBlock | TableMaterialBlock>;
};

type ImageResolver = (source: string, imageIndex: number) => string | Promise<string>;

const allowedInlineTags = new Set([
  "b",
  "br",
  "em",
  "i",
  "img",
  "s",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "u",
]);
const discardedTags = new Set([
  "button",
  "embed",
  "form",
  "iframe",
  "input",
  "link",
  "math",
  "meta",
  "object",
  "script",
  "style",
  "svg",
]);
const allowedImageStyleProperties = new Set([
  "display",
  "height",
  "max-height",
  "max-width",
  "min-height",
  "min-width",
  "object-fit",
  "vertical-align",
  "width",
]);

function normalizeText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeImageSource(value: string) {
  const source = value.trim();
  if (!source) return "";
  if (source.startsWith("//")) return `https:${source}`;
  if (source.startsWith("/")) return source;
  try {
    const url = new URL(source);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return !/[\\\s<>]/.test(source) && !/^[a-z][a-z\d+.-]*:/i.test(source) ? source : "";
  }
}

function sanitizeClassName(value: string) {
  return value
    .split(/\s+/)
    .filter((token) => /^[a-z0-9_-]+$/i.test(token))
    .join(" ");
}

function sanitizeImageStyle(value: string) {
  const declarations: string[] = [];
  for (const declaration of value.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 1) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const propertyValue = declaration.slice(separator + 1).trim();
    if (!allowedImageStyleProperties.has(property) || !propertyValue) continue;
    if (/[\\{}]|(?:expression|javascript|url)\s*\(/i.test(propertyValue)) continue;
    declarations.push(`${property}:${propertyValue}`);
  }
  return declarations.length ? `${declarations.join(";")};` : "";
}

export function sanitizeRichTextFragment(fragment: string) {
  const $ = load(fragment || "", undefined, false);
  const elements = $("*").toArray().reverse();

  for (const node of elements) {
    const element = $(node);
    const tagName = "tagName" in node ? node.tagName.toLowerCase() : "";
    if (discardedTags.has(tagName)) {
      element.remove();
      continue;
    }
    if (!allowedInlineTags.has(tagName)) {
      element.replaceWith(element.contents());
      continue;
    }

    const source = tagName === "img" ? normalizeImageSource(element.attr("src") || "") : "";
    const alt = tagName === "img" ? element.attr("alt") || "" : "";
    const className = tagName === "img" ? sanitizeClassName(element.attr("class") || "") : "";
    const style = tagName === "img" ? sanitizeImageStyle(element.attr("style") || "") : "";
    for (const attribute of Object.keys("attribs" in node ? node.attribs : {})) element.removeAttr(attribute);
    if (source) element.attr("src", source);
    if (alt) element.attr("alt", alt);
    if (className) element.attr("class", className);
    if (style) element.attr("style", style);
  }

  return ($.root().html() || "").trim();
}

function fragmentText(fragment: string) {
  const $ = load(fragment || "", undefined, false);
  return normalizeText($.root().text());
}

export function materialHash(html: string) {
  return createHash("sha256").update(html).digest("hex").slice(0, 16);
}

export function parseMaterialHtml(html: string): ParsedMaterial {
  // A small set of source papers uses `<p=align:center>`, which HTML parsers
  // treat as a custom element and can therefore omit from paragraph blocks.
  const normalizedHtml = (html || "").replace(
    /<p\s*=\s*align\s*:\s*(?:left|center|right|justify)\s*>/gi,
    "<p>",
  );
  const $ = load(normalizedHtml, undefined, false);
  const blocks: ParsedMaterial["blocks"] = [];
  const candidates = $("p,table")
    .toArray()
    .filter((node) => !$(node).parents("p,table").length);

  for (const node of candidates) {
    const element = $(node);
    if (element.is("table")) {
      const rows: string[][] = [];
      element.find("tr").each((_, row) => {
        const cells = $(row)
          .find("th,td")
          .map((__, cell) => normalizeText($(cell).text()))
          .get()
          .filter(Boolean);
        if (cells.length) rows.push(cells);
      });
      if (rows.length) blocks.push({ type: "table", rows });
      continue;
    }

    const content = sanitizeRichTextFragment(element.html() || "");
    if (content) blocks.push({ type: "richText", content });
  }

  if (!blocks.length) {
    const content = sanitizeRichTextFragment($.root().html() || "");
    if (content) blocks.push({ type: "richText", content });
  }

  const content = blocks
    .filter((block): block is RichTextMaterialBlock => block.type === "richText")
    .map((block) => fragmentText(block.content))
    .filter(Boolean)
    .join("\n");
  return { content: content || "图表资料", blocks };
}

export function materialImageSources(blocks: readonly MaterialBlock[]) {
  const sources: string[] = [];
  for (const block of blocks) {
    if (block.type === "image") {
      if (block.url) sources.push(block.url);
      continue;
    }
    if (block.type !== "richText") continue;
    const $ = load(block.content || "", undefined, false);
    $("img").each((_, image) => {
      const source = $(image).attr("src");
      if (source) sources.push(source);
    });
  }
  return sources;
}

export async function localizeMaterialImages(
  blocks: readonly MaterialBlock[],
  resolveImage: ImageResolver,
) {
  const localized: MaterialBlock[] = [];
  let imageIndex = 0;

  for (const block of blocks) {
    if (block.type === "image") {
      const replacement = normalizeImageSource(await resolveImage(block.url, imageIndex));
      if (!replacement) throw new Error(`图片 ${imageIndex + 1} 的本地 URL 无效`);
      localized.push({ ...block, url: replacement });
      imageIndex += 1;
      continue;
    }
    if (block.type !== "richText") {
      localized.push(block);
      continue;
    }

    const $ = load(block.content || "", undefined, false);
    for (const image of $("img").toArray()) {
      const source = $(image).attr("src") || "";
      if (!source) continue;
      const replacement = normalizeImageSource(await resolveImage(source, imageIndex));
      if (!replacement) throw new Error(`图片 ${imageIndex + 1} 的本地 URL 无效`);
      $(image).attr("src", replacement);
      imageIndex += 1;
    }
    localized.push({ ...block, content: $.root().html() || "" });
  }

  return localized;
}

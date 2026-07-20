import { Fragment, type ReactNode } from "react";
import { ZoomableQuestionImage } from "./zoomable-question-image";

const imageTag = /<img\b[^>]*>/gi;

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

export function plainQuestionText(value: string) {
  return decodeEntities(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(imageTag, " [题图] ")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function attribute(tag: string, name: string) {
  return decodeEntities(tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:["']([^"']+)["']|([^\\s>]+))`, "i"))?.slice(1).find(Boolean) || "");
}

function safeImageUrl(value: string) {
  if (value.startsWith("/")) return value;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.toString() : ""; }
  catch { return ""; }
}

export function QuestionContent({ content, variant = "stem" }: { content: string; variant?: "stem" | "option" | "explanation" }) {
  content = decodeEntities(content);
  if (!/<[a-z]|&(?:nbsp|amp|lt|gt|quot|#)/i.test(content)) return <>{content}</>;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of content.matchAll(imageTag)) {
    const index = match.index || 0;
    const text = plainQuestionText(content.slice(cursor, index));
    if (text) nodes.push(<Fragment key={`text-${index}`}>{text}</Fragment>);
    const tag = match[0];
    const src = safeImageUrl(attribute(tag, "src"));
    const alt = plainQuestionText(attribute(tag, "alt")) || "题目配图";
    const maxHeightEm = Number(tag.match(/max-height\s*:\s*([\d.]+)em/i)?.[1] || "");
    const forceInline = /(?:formula|math|equation)/i.test(attribute(tag, "class")) || (maxHeightEm > 0 && maxHeightEm <= 3);
    const inlineHint = /display\s*:\s*inline/i.test(tag) || /\binline-img\b/i.test(attribute(tag, "class"));
    if (src) {
      const className = `question-rich-image ${variant === "option" ? "option-image" : ""}`;
      nodes.push(
        <ZoomableQuestionImage
          key={`image-${index}`}
          src={src}
          alt={alt}
          className={className}
          inlineHint={inlineHint}
          forceInline={forceInline}
        />,
      );
    }
    cursor = index + tag.length;
  }
  const tail = plainQuestionText(content.slice(cursor));
  if (tail) nodes.push(<Fragment key="tail">{tail}</Fragment>);
  return <span className={`question-rich-content ${variant}`}>{nodes}</span>;
}

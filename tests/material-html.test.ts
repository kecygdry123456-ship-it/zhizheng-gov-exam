import assert from "node:assert/strict";
import { test } from "node:test";
import {
  localizeMaterialImages,
  materialHash,
  materialImageSources,
  parseMaterialHtml,
  sanitizeRichTextFragment,
  type MaterialBlock,
} from "../scripts/lib/material-html";

test("material parser keeps an inline percentage image in its sentence", () => {
  const parsed = parseMaterialHtml(`
    <p>其中，老年人口抚养比<img src="https://img.example/ratio.png" class="inline-img formula" style="display:inline;vertical-align:middle;max-height:1.5em;">。</p>
  `);

  assert.deepEqual(parsed.blocks.map((block) => block.type), ["richText"]);
  const block = parsed.blocks[0];
  assert.equal(block.type, "richText");
  assert.ok(block.content.indexOf("老年人口抚养比") < block.content.indexOf("<img"));
  assert.ok(block.content.indexOf("<img") < block.content.lastIndexOf("。"));
  assert.match(block.content, /class="inline-img formula"/);
  assert.match(block.content, /style="display:inline;vertical-align:middle;max-height:1.5em;"/);
  assert.deepEqual(materialImageSources(parsed.blocks), ["https://img.example/ratio.png"]);
  assert.equal(parsed.content, "其中，老年人口抚养比。" );
});

test("material parser keeps table order and falls back to one rich-text fragment", () => {
  const parsed = parseMaterialHtml(`
    <p>第一段</p>
    <table><tr><th>年份</th><th>增速</th></tr><tr><td>2025</td><td>12.4%</td></tr></table>
    <p>第二段</p>
  `);
  assert.deepEqual(parsed.blocks, [
    { type: "richText", content: "第一段" },
    { type: "table", rows: [["年份", "增速"], ["2025", "12.4%"]] },
    { type: "richText", content: "第二段" },
  ]);

  assert.deepEqual(parseMaterialHtml("没有 p 标签的材料").blocks, [
    { type: "richText", content: "没有 p 标签的材料" },
  ]);
});

test("material parser recovers images from malformed aligned paragraph tags", () => {
  const parsed = parseMaterialHtml(`
    <p=align:center><img src="https://img.example/chart.png"></p>
    <p>图表说明</p>
  `);
  assert.deepEqual(materialImageSources(parsed.blocks), ["https://img.example/chart.png"]);
  assert.equal(parsed.blocks.length, 2);
  assert.equal(parsed.blocks[0].type, "richText");
  assert.match(parsed.blocks[0].type === "richText" ? parsed.blocks[0].content : "", /<img/);
});

test("rich-text sanitization removes active content but keeps safe image hints", () => {
  const content = sanitizeRichTextFragment(`
    <script>alert(1)</script><span onclick="steal()">文字</span>
    <img src="javascript:alert(1)" onerror="steal()">
    <img src="https://img.example/chart.png" class="inline-img bad:name" style="display:inline;background:url(javascript:alert(1));vertical-align:middle;">
  `);

  assert.doesNotMatch(content, /script|onclick|onerror|javascript|background/i);
  assert.match(content, />文字</);
  assert.match(content, /src="https:\/\/img\.example\/chart\.png"/);
  assert.match(content, /class="inline-img"/);
  assert.match(content, /style="display:inline;vertical-align:middle;"/);
});

test("image localization replaces rich-text sources in document order", async () => {
  const parsed = parseMaterialHtml(`
    <p>甲<img src="//img.example/a.png" class="inline-img">乙</p>
    <p><img src="images/b.png" style="max-width:100%;height:auto;"></p>
  `);
  const seen: string[] = [];
  const localized = await localizeMaterialImages(parsed.blocks, (source, imageIndex) => {
    seen.push(source);
    return `/question-materials/paper/material-${imageIndex + 1}.png`;
  });

  assert.deepEqual(seen, ["https://img.example/a.png", "images/b.png"]);
  assert.deepEqual(materialImageSources(localized), [
    "/question-materials/paper/material-1.png",
    "/question-materials/paper/material-2.png",
  ]);
  const first = localized[0];
  assert.equal(first.type, "richText");
  assert.ok(first.content.indexOf("甲") < first.content.indexOf("<img"));
  assert.ok(first.content.indexOf("<img") < first.content.indexOf("乙"));
  assert.match(first.content, /class="inline-img"/);
});

test("image source extraction supports legacy and rich-text blocks", () => {
  const blocks: MaterialBlock[] = [
    { type: "text", content: "旧文字" },
    { type: "image", url: "/question-materials/old-1.png", alt: "旧图片" },
    { type: "richText", content: "新文字<img src=\"/question-materials/new-2.png\">" },
  ];
  assert.deepEqual(materialImageSources(blocks), [
    "/question-materials/old-1.png",
    "/question-materials/new-2.png",
  ]);
  assert.equal(materialHash("<p>材料</p>"), materialHash("<p>材料</p>"));
  assert.notEqual(materialHash("<p>材料</p>"), materialHash("<p>材料。</p>"));
});

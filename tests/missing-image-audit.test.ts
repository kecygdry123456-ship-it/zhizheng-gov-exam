import assert from "node:assert/strict";
import test from "node:test";
import {
  auditCoverageKeys,
  auditCoverageFingerprints,
  auditParsedPaper,
  databaseQuestionImageSources,
  parseGkzhentiExternalKey,
  parseSourcePaperHtml,
  questionAuditFingerprint,
  type AuditQuestion,
} from "../scripts/lib/missing-image-audit";

function question(paperId: string, number: number, overrides: Partial<AuditQuestion> = {}): AuditQuestion {
  return {
    externalKey: `gkzhenti:${paperId}:${number}`,
    materialId: null,
    options: ["甲", "乙", "丙", "丁"],
    paperTitle: "测试试卷",
    sourceUrl: `https://gwy.gkzhenti.cn/paper/${paperId}`,
    stem: `第 ${number} 题`,
    ...overrides,
  };
}

test("externalKey 只接受 paperId:number 的规范精确映射", () => {
  assert.deepEqual(parseGkzhentiExternalKey("gkzhenti:1653915068993:47"), {
    paperId: "1653915068993",
    number: 47,
  });
  assert.equal(parseGkzhentiExternalKey("gkzhenti:1653915068993:047"), null);
  assert.equal(parseGkzhentiExternalKey("gkzhenti:1653915068993:47:1"), null);
  assert.equal(parseGkzhentiExternalKey("bala:1653915068993:47"), null);
});

test("结构化解析题目行图片和 sub2title 图片题组边界", () => {
  const html = `
    <div id="printcontent">
      <div class="row"><div class="subtitle">资料分析</div></div>
      <div class="row">
        <div class="sub2title">根据图表回答 41-45 题</div>
        <p><img data-original="/assets/material.png"></p>
      </div>
      ${[41, 42, 43, 44, 45].map((number) => `
        <div class="row"><div class="left">${number}.</div><div class="right">题干 ${number}</div></div>
      `).join("")}
      <div class="row"><div class="sub2title">根据文字回答下一题</div><p>纯文字材料</p></div>
      <div class="row">
        <div class="left">47、</div>
        <div class="right">结合数据作答 <img data-src="//img.example.test/question-47.png"></div>
      </div>
      <div class="row"><div class="subtitle">判断推理</div></div>
      <div class="row"><div class="left">48</div><div class="right"><img src="/assets/direct-48.png"></div></div>
    </div>`;
  const parsed = parseSourcePaperHtml(html, "https://gwy.gkzhenti.cn/paper/1001");

  assert.deepEqual(parsed.duplicateQuestionNumbers, []);
  assert.equal(parsed.materialGroups.length, 2);
  assert.deepEqual(parsed.materialGroups[0].questionNumbers, [41, 42, 43, 44, 45]);
  assert.deepEqual(parsed.materialGroups[0].imageSources, ["https://gwy.gkzhenti.cn/assets/material.png"]);
  assert.deepEqual(parsed.materialGroups[1].questionNumbers, [47]);
  assert.deepEqual(parsed.questionRows.find((row) => row.number === 47)?.imageSources, [
    "https://img.example.test/question-47.png",
  ]);
  assert.deepEqual(parsed.questionRows.find((row) => row.number === 48)?.imageSources, [
    "https://gwy.gkzhenti.cn/assets/direct-48.png",
  ]);
});

test("仅对精确命中的待审题报告直接缺图，并优先完整五题材料组", () => {
  const paperId = "1001";
  const pageUrl = `https://gwy.gkzhenti.cn/paper/${paperId}`;
  const parsed = parseSourcePaperHtml(`
    <div id="printcontent">
      <div class="row"><div class="sub2title">图表材料</div><img src="/m.png"></div>
      ${[41, 42, 43, 44, 45].map((number) => `<div class="row"><div class="left">${number}</div><div class="right">题目</div></div>`).join("")}
      <div class="row"><div class="sub2title">纯文字材料</div></div>
      <div class="row"><div class="left">47</div><div class="right"><img src="/q47.png">题目</div></div>
    </div>
  `, pageUrl);
  const allQuestions = [41, 42, 43, 44, 45, 47].map((number) => question(paperId, number));
  const findings = auditParsedPaper({
    allQuestions,
    eligibleExternalKeys: new Set(["gkzhenti:1001:41", "gkzhenti:1001:47"]),
    pageUrl,
    paperId,
    paperTitle: "测试试卷",
    parsed,
  });

  assert.deepEqual(findings.directQuestionImages.map((item) => item.externalKey), ["gkzhenti:1001:47"]);
  assert.equal(findings.materialGroups.length, 1);
  assert.equal(findings.materialGroups[0].groupSize, 5);
  assert.equal(findings.materialGroups[0].matchedQuestionCount, 5);
  assert.equal(findings.materialGroups[0].unlinkedQuestionCount, 5);
  assert.equal(findings.materialGroups[0].fullyRecoverable, true);
  assert.equal(findings.materialGroups[0].priorityFiveQuestionGroup, true);
});

test("缺题或已有 material 的图片题组不会标记 fullyRecoverable", () => {
  const paperId = "1002";
  const pageUrl = `https://gwy.gkzhenti.cn/paper/${paperId}`;
  const parsed = parseSourcePaperHtml(`
    <div id="printcontent">
      <div class="row"><div class="sub2title">图表材料</div><img src="/m.png"></div>
      ${[1, 2, 3, 4, 5].map((number) => `<div class="row"><div class="left">${number}</div><div class="right">题目</div></div>`).join("")}
    </div>
  `, pageUrl);
  const allQuestions = [
    question(paperId, 1),
    question(paperId, 2, { materialId: "existing-material" }),
    question(paperId, 3),
    question(paperId, 4),
  ];
  const findings = auditParsedPaper({
    allQuestions,
    eligibleExternalKeys: new Set(["gkzhenti:1002:1"]),
    pageUrl,
    paperId,
    paperTitle: "测试试卷",
    parsed,
  });

  assert.equal(findings.materialGroups[0].matchedQuestionCount, 4);
  assert.equal(findings.materialGroups[0].unlinkedQuestionCount, 3);
  assert.equal(findings.materialGroups[0].fullyRecoverable, false);
  assert.equal(findings.materialGroups[0].priorityFiveQuestionGroup, false);
});

test("历史 coverage 只读取当前 schema 的合法题目指纹，供增量去重", () => {
  const fingerprint = "a".repeat(64);
  const report = {
    schemaVersion: 2,
    source: "gkzhenti",
    coverage: {
      auditedQuestions: [
        { externalKey: "gkzhenti:1001:1", fingerprint },
        { externalKey: "gkzhenti:1001:01", fingerprint },
        { externalKey: "bala:1001:2", fingerprint },
        { externalKey: "gkzhenti:1001:2", fingerprint: "invalid" },
      ],
    },
  };
  assert.deepEqual([...auditCoverageKeys(report)], ["gkzhenti:1001:1"]);
  assert.equal(auditCoverageFingerprints(report).get("gkzhenti:1001:1"), fingerprint);
  assert.deepEqual([...auditCoverageKeys({ ...report, schemaVersion: 1 })], []);
});

test("题面或本地图片内容变化会改变增量审计指纹", () => {
  const row = question("1004", 1);
  const original = questionAuditFingerprint(row, ["/question-images/a.png:file:abc"]);
  assert.notEqual(questionAuditFingerprint({ ...row, stem: "题干已变化" }, ["/question-images/a.png:file:abc"]), original);
  assert.notEqual(questionAuditFingerprint(row, ["/question-images/a.png:file:def"]), original);
});

test("数据库题干和选项图片提取不把普通文本误判为图片", () => {
  assert.deepEqual(databaseQuestionImageSources(question("1003", 1, {
    stem: "题干 <img src=\"/question-images/aa/a.png\">",
    options: ["文本", "<img data-src=\"/question-images/bb/b.png\">"],
  })), ["/question-images/aa/a.png", "/question-images/bb/b.png"]);
  assert.deepEqual(databaseQuestionImageSources(question("1003", 2)), []);
});

test("直接图片数量已完整匹配时不误报，源图更多时才报告", () => {
  const paperId = "1005";
  const pageUrl = `https://gwy.gkzhenti.cn/paper/${paperId}`;
  const row = question(paperId, 1, { stem: '<img src="/question-images/local.png">' });
  const input = {
    allQuestions: [row],
    databaseValidImageCounts: new Map([[row.externalKey, 1]]),
    eligibleExternalKeys: new Set([row.externalKey]),
    pageUrl,
    paperId,
    paperTitle: row.paperTitle,
  };
  const complete = auditParsedPaper({
    ...input,
    parsed: parseSourcePaperHtml(`
      <div id="printcontent"><div class="row"><div class="left">1</div><div class="right"><img src="/source-one.png"></div></div></div>
    `, pageUrl),
  });
  assert.equal(complete.directQuestionImages.length, 0);

  const missing = auditParsedPaper({
    ...input,
    parsed: parseSourcePaperHtml(`
      <div id="printcontent"><div class="row"><div class="left">1</div><div class="right"><img src="/source-one.png"><img src="/source-two.png"></div></div></div>
    `, pageUrl),
  });
  assert.deepEqual(missing.directQuestionImages.map((finding) => finding.externalKey), [row.externalKey]);
});

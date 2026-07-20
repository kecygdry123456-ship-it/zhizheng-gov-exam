import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectSourceMaterialGroups,
  materialLinkData,
  sourceMaterialExternalKey,
  sourceQuestionExternalKey,
  validateImageBuffer,
  verifyMissingMaterialGroup,
  type BalaPaper,
  type BalaQuestion,
  type LocalQuestion,
} from "../scripts/repair-missing-question-materials";

const material = '<p><img src="https://img.example/chart.png"></p>';

function sourceQuestion(order: number): BalaQuestion {
  return {
    id: 1_000 + order,
    question: order === 3
      ? `题目 ${order}<img src="https://img.example/stem.png">`
      : `题目 ${order}`,
    material,
    options: order === 4
      ? ['<img src="https://img.example/a.png">', "选项乙"]
      : ["选项甲", "选项乙"],
    answer: order % 2 ? "A" : "B",
    knowledge_point: "数量关系",
    source_knowledge_point: "数量关系",
    sub_category: "数学运算",
    is_complete: 1,
    is_duplicate: 0,
    sort_order: order,
  };
}

function paper(): BalaPaper {
  return {
    id: 96,
    title: "2022年上海市公务员录用考试《行测》题（B类）（网友回忆版）",
    region: "上海",
    question_count: 5,
    source_url: "https://gwy.gkzhenti.cn/paper/1653915068993",
    questions: [1, 2, 3, 4, 5].map(sourceQuestion),
  };
}

function localQuestion(sourcePaper: BalaPaper, source: BalaQuestion): LocalQuestion {
  return {
    id: `local-${source.sort_order}`,
    externalKey: sourceQuestionExternalKey(sourcePaper, source),
    paperTitle: sourcePaper.title,
    stem: source.question.replace("https://img.example/stem.png", "/question-images/aa/local.png"),
    options: source.options.map((option) => option.replace(/https:\/\/img\.example\/a\.png/, "/question-images/bb/local.png")),
    answer: source.answer.charCodeAt(0) - 65,
    status: "PUBLISHED",
    materialId: null,
    materialOrder: null,
  };
}

test("misclassified five-question image material is still eligible", () => {
  const sourcePaper = paper();
  const groups = collectSourceMaterialGroups(sourcePaper);
  assert.equal(groups.length, 1);
  const local = new Map(
    sourcePaper.questions!.map((question) => {
      const row = localQuestion(sourcePaper, question);
      return [row.externalKey!, row] as const;
    }),
  );
  const result = verifyMissingMaterialGroup(sourcePaper, groups[0], local);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value.localQuestions.map((question) => question.id), ["local-1", "local-2", "local-3", "local-4", "local-5"]);
});

test("question surface mismatch rejects the entire material group", () => {
  const sourcePaper = paper();
  const group = collectSourceMaterialGroups(sourcePaper)[0];
  const local = new Map(
    sourcePaper.questions!.map((question) => {
      const row = localQuestion(sourcePaper, question);
      if (question.sort_order === 4) row.options = ["不同选项", "选项乙"];
      return [row.externalKey!, row] as const;
    }),
  );
  assert.deepEqual(verifyMissingMaterialGroup(sourcePaper, group, local), {
    ok: false,
    reason: "options-mismatch:4",
  });
});

test("an exactly linked five-question material with no stored image is repairable", () => {
  const sourcePaper = paper();
  const group = collectSourceMaterialGroups(sourcePaper)[0];
  const rows = sourcePaper.questions!.map((question, index) => ({
    ...localQuestion(sourcePaper, question),
    materialId: "damaged-material",
    materialOrder: index + 1,
  }));
  const result = verifyMissingMaterialGroup(
    sourcePaper,
    group,
    new Map(rows.map((row) => [row.externalKey!, row])),
    new Map([["damaged-material", {
      id: "damaged-material",
      externalKey: sourceMaterialExternalKey(sourcePaper, group),
      blocks: [{ type: "richText", content: "图表说明" }],
      questionIds: rows.map((row) => row.id),
    }]]),
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.mode, "REPAIR_DAMAGED");
});

test("linked materials are rejected if they already have an image or contain extra questions", () => {
  const sourcePaper = paper();
  const group = collectSourceMaterialGroups(sourcePaper)[0];
  const rows = sourcePaper.questions!.map((question, index) => ({
    ...localQuestion(sourcePaper, question),
    materialId: "existing-material",
    materialOrder: index + 1,
  }));
  const local = new Map(rows.map((row) => [row.externalKey!, row]));
  const baseMaterial = {
    id: "existing-material",
    externalKey: sourceMaterialExternalKey(sourcePaper, group),
    blocks: [{ type: "richText", content: '<img src="/question-materials/existing.png">' }],
    questionIds: rows.map((row) => row.id),
  };
  assert.deepEqual(
    verifyMissingMaterialGroup(sourcePaper, group, local, new Map([[baseMaterial.id, baseMaterial]])),
    { ok: false, reason: "local-material-already-has-image" },
  );
  assert.deepEqual(
    verifyMissingMaterialGroup(sourcePaper, group, local, new Map([[baseMaterial.id, {
      ...baseMaterial,
      blocks: [{ type: "richText", content: "图表说明" }],
      questionIds: [...baseMaterial.questionIds, "unexpected-question"],
    }]])),
    { ok: false, reason: "local-material-question-set-mismatch" },
  );
});

test("missing source link never clears an existing material link", () => {
  assert.deepEqual(materialLinkData(null, { materialId: "existing-material", materialOrder: 3 }), {});
  assert.deepEqual(materialLinkData(null, { materialId: null, materialOrder: null }), { materialId: null, materialOrder: null });
  assert.deepEqual(materialLinkData({ materialId: "new-material", materialOrder: 2 }, { materialId: "old-material", materialOrder: 1 }), {
    materialId: "new-material",
    materialOrder: 2,
  });
});

test("image validation checks magic and dimensions", () => {
  const png = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
  png.writeUInt32BE(500, 16);
  png.writeUInt32BE(313, 20);
  assert.deepEqual(validateImageBuffer(png), { buffer: png, extension: ".png", width: 500, height: 313 });
  assert.throws(() => validateImageBuffer(Buffer.alloc(24)), /unsupported-image-magic/);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeQuestionScopes,
  parseQuestionScopesParameter,
  questionMatchesScopes,
  sameQuestionScopes,
} from "../src/lib/question-scope";

test("细分板块按大板块和题型共同去重并稳定排序", () => {
  const scopes = [
    { category: "数量关系", type: "数学运算" },
    { category: "判断推理", type: "数学运算" },
  ];
  const normalized = normalizeQuestionScopes([...scopes].reverse());
  assert.deepEqual(
    normalized.map((scope) => `${scope.category}/${scope.type}`).sort(),
    scopes.map((scope) => `${scope.category}/${scope.type}`).sort(),
  );
  assert.equal(sameQuestionScopes(scopes, [...scopes].reverse()), true);
  assert.equal(
    questionMatchesScopes(
      { category: { name: "数量关系" }, type: "数学运算" },
      [{ category: "判断推理", type: "数学运算" }],
    ),
    false,
  );
});

test("URL 细分板块参数拒绝重复、残缺和非 JSON 数据", () => {
  const valid = [{ category: "判断推理", type: "图形推理" }];
  assert.deepEqual(parseQuestionScopesParameter(JSON.stringify(valid)), {
    success: true,
    data: valid,
  });
  assert.equal(parseQuestionScopesParameter("not-json").success, false);
  assert.equal(
    parseQuestionScopesParameter(JSON.stringify([...valid, ...valid])).success,
    false,
  );
  assert.equal(
    parseQuestionScopesParameter(JSON.stringify([{ category: "判断推理" }])).success,
    false,
  );
});

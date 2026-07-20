import assert from "node:assert/strict";
import test from "node:test";
import {
  buildKnowledgeDifficultyContext,
  scoreQuestionDifficulty,
} from "../src/lib/difficulty";

const options = ["选项甲", "选项乙", "选项丙", "选项丁"];

test("政治理论与普通常识都按题目知识点而不是板块统一定档", () => {
  const easyPolitics = {
    category: "常识判断",
    type: "政治理论",
    stem: "中国共产党的根本宗旨是：",
    options: ["全心全意为人民服务", "依法治国", "改革开放", "共同富裕"],
  };
  const hardGeneral = {
    category: "常识判断",
    type: "历史人文",
    stem: "下列典籍、作者、成书年代与制度记载对应正确的是：",
    options: [
      "《周礼》—周公旦—西周—六官制度",
      "《梦溪笔谈》—沈括—北宋—均田制度",
      "《天工开物》—宋应星—明代—九品中正制",
      "《海国图志》—魏源—清代—三省六部制",
    ],
  };
  const context = buildKnowledgeDifficultyContext([
    easyPolitics,
    easyPolitics,
    easyPolitics,
    hardGeneral,
  ]);
  const easyScore = scoreQuestionDifficulty(easyPolitics, undefined, context);
  const hardScore = scoreQuestionDifficulty(hardGeneral, undefined, context);
  assert.ok(easyScore < hardScore, `${easyScore} 应低于 ${hardScore}`);
  assert.ok(easyScore < 5, `常见政治知识也可以是基础题，实际 ${easyScore}`);
  assert.ok(hardScore >= 5, `生僻多知识点常识题应进入中高难度，实际 ${hardScore}`);
});

test("常识否定问法和多陈述组合提高记忆干扰难度", () => {
  const simple = scoreQuestionDifficulty({
    category: "常识判断",
    type: "常识应用能力",
    stem: "下列说法正确的是：",
    options,
  });
  const complex = scoreQuestionDifficulty({
    category: "常识判断",
    type: "常识应用能力",
    stem: "关于下列说法：①甲；②乙；③丙；④丁，其中对应错误的是：",
    options,
  });
  assert.ok(complex >= simple + 0.7, `${simple} -> ${complex}`);
});

test("足量真实错误率仍能校准常识先验", () => {
  const question = {
    category: "常识判断",
    type: "政治理论",
    stem: "下列关于政治理论的表述正确的是：",
    options,
  };
  const easyObserved = scoreQuestionDifficulty(question, { total: 100, wrong: 10 });
  const hardObserved = scoreQuestionDifficulty(question, { total: 100, wrong: 80 });
  assert.ok(hardObserved > easyObserved + 1.5);
});

test("同一材料的各小题按自身运算复杂度分别定档", () => {
  const material = "某地区2021年至2025年生产总值分别为120、138、151、176和203亿元，各年人口与产业结构见统计表。";
  const direct = scoreQuestionDifficulty({
    category: "资料分析",
    type: "资料分析",
    material,
    stem: "2025年该地区生产总值为多少亿元？",
    options: ["176", "188", "196", "203"],
  });
  const compound = scoreQuestionDifficulty({
    category: "资料分析",
    type: "资料分析",
    material,
    stem: "若2020年为基期，2021至2025年的年均增长率及第三产业对总增长的贡献率分别约为多少？",
    options: ["11.1%、42.3%", "14.1%、38.6%", "15.0%、45.2%", "16.2%、51.4%"],
  });
  assert.ok(compound >= direct + 1, `同组复杂题 ${compound} 应明显高于直接读数题 ${direct}`);
});

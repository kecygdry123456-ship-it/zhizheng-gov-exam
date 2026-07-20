export type ExamTemplateId = "NATIONAL_PREFECTURE" | "GUANGDONG_PROVINCE";

export type ExamTemplate = {
  id: ExamTemplateId;
  name: string;
  description: string;
  questionCount: number;
  durationMinutes: number;
  sections: readonly {
    category: string;
    label: string;
    count: number;
    pool?: "POLITICS" | "GENERAL_KNOWLEDGE";
    subtypes?: readonly {
      label: string;
      count: number;
      types: readonly string[];
    }[];
  }[];
};

export const EXAM_TEMPLATES: Record<ExamTemplateId, ExamTemplate> = {
  NATIONAL_PREFECTURE: {
    id: "NATIONAL_PREFECTURE",
    name: "国考型",
    description: "参考国家公务员考试地市级行测试卷",
    questionCount: 130,
    durationMinutes: 120,
    sections: [
      { category: "常识判断", label: "政治理论", count: 20, pool: "POLITICS", subtypes: [
        { label: "习近平新时代中国特色社会主义思想", count: 8, types: ["习近平新时代中国特色社会主义思想"] },
        { label: "时事政治", count: 6, types: ["时政常识", "时事政治"] },
        { label: "马克思主义基本原理", count: 3, types: ["马克思主义基本原理"] },
        { label: "党史党建", count: 2, types: ["党史党建"] },
        { label: "其他政治理论", count: 1, types: ["政治理论", "中国特色社会主义理论体系", "毛泽东思想", "政治常识"] },
      ] },
      { category: "常识判断", label: "常识判断", count: 15, pool: "GENERAL_KNOWLEDGE", subtypes: [
        { label: "科技地理", count: 5, types: ["科技地理", "科技常识", "地理常识"] },
        { label: "法律常识", count: 4, types: ["法律常识", "宪法常识"] },
        { label: "历史人文", count: 3, types: ["历史人文", "历史文化"] },
        { label: "经济常识", count: 2, types: ["经济常识"] },
        { label: "管理行政", count: 1, types: ["管理常识", "行政常识", "常识应用能力"] },
      ] },
      { category: "言语理解", label: "言语理解与表达", count: 30, subtypes: [
        { label: "逻辑填空", count: 14, types: ["逻辑填空"] },
        { label: "片段阅读", count: 11, types: ["片段阅读", "标题选择", "细节判断", "主旨概括"] },
        { label: "语句填空", count: 3, types: ["语句填空"] },
        { label: "语句排序", count: 2, types: ["语句排序"] },
      ] },
      { category: "数量关系", label: "数量关系", count: 10, subtypes: [
        { label: "数学运算", count: 10, types: ["数学运算", "排列组合", "比例问题", "概率问题", "行程问题", "工程问题"] },
      ] },
      { category: "判断推理", label: "判断推理", count: 35, subtypes: [
        { label: "图形推理", count: 10, types: ["图形推理"] },
        { label: "定义判断", count: 10, types: ["定义判断"] },
        { label: "类比推理", count: 5, types: ["类比推理"] },
        { label: "逻辑判断", count: 10, types: ["逻辑判断", "加强论证", "削弱论证", "条件推理"] },
      ] },
      { category: "资料分析", label: "资料分析", count: 20, subtypes: [
        { label: "综合材料", count: 10, types: ["综合材料"] },
        { label: "文字材料", count: 5, types: ["文字材料"] },
        { label: "图表材料", count: 5, types: ["图形材料", "表格材料"] },
      ] },
    ],
  },
  GUANGDONG_PROVINCE: {
    id: "GUANGDONG_PROVINCE",
    name: "省考型",
    description: "参考广东省公务员考试行测试卷",
    questionCount: 90,
    durationMinutes: 90,
    sections: [
      { category: "常识判断", label: "政治", count: 10, pool: "POLITICS", subtypes: [
        { label: "习近平新时代中国特色社会主义思想", count: 4, types: ["习近平新时代中国特色社会主义思想"] },
        { label: "时事政治", count: 3, types: ["时政常识", "时事政治"] },
        { label: "政治理论", count: 2, types: ["政治理论", "中国特色社会主义理论体系", "毛泽东思想", "政治常识"] },
        { label: "马克思党史", count: 1, types: ["马克思主义基本原理", "党史党建"] },
      ] },
      { category: "常识判断", label: "常识", count: 5, pool: "GENERAL_KNOWLEDGE", subtypes: [
        { label: "科技地理", count: 2, types: ["科技地理", "科技常识", "地理常识"] },
        { label: "法律常识", count: 1, types: ["法律常识", "宪法常识"] },
        { label: "历史人文", count: 1, types: ["历史人文", "历史文化"] },
        { label: "经济管理", count: 1, types: ["经济常识", "管理常识", "行政常识", "常识应用能力"] },
      ] },
      { category: "言语理解", label: "言语理解与表达", count: 15, subtypes: [
        { label: "逻辑填空", count: 5, types: ["逻辑填空"] },
        { label: "片段阅读", count: 7, types: ["片段阅读", "标题选择", "细节判断", "主旨概括"] },
        { label: "语句填空", count: 1, types: ["语句填空"] },
        { label: "语句排序", count: 2, types: ["语句排序"] },
      ] },
      { category: "数量关系", label: "数量关系", count: 15, subtypes: [
        { label: "数字推理", count: 4, types: ["数字推理"] },
        { label: "数学运算", count: 11, types: ["数学运算", "排列组合", "比例问题", "概率问题", "行程问题", "工程问题"] },
      ] },
      { category: "判断推理", label: "判断推理", count: 25, subtypes: [
        { label: "图形推理", count: 5, types: ["图形推理"] },
        { label: "逻辑判断", count: 15, types: ["逻辑判断", "定义判断", "类比推理", "加强论证", "削弱论证", "条件推理"] },
        { label: "科学推理", count: 5, types: ["科技地理", "数学运算"] },
      ] },
      { category: "资料分析", label: "资料分析", count: 20, subtypes: [
        { label: "综合材料", count: 5, types: ["综合材料"] },
        { label: "文字材料", count: 5, types: ["文字材料"] },
        { label: "图形材料", count: 5, types: ["图形材料"] },
        { label: "表格材料", count: 5, types: ["表格材料"] },
      ] },
    ],
  },
};

export const EXAM_TEMPLATE_IDS = Object.keys(EXAM_TEMPLATES) as ExamTemplateId[];

export const POLITICS_QUESTION_TYPES = [
  "政治理论",
  "习近平新时代中国特色社会主义思想",
  "马克思主义基本原理",
  "党史党建",
  "中国特色社会主义理论体系",
  "毛泽东思想",
  "政治常识",
  "时政常识",
  "时事政治",
] as const;

export const GENERAL_KNOWLEDGE_QUESTION_TYPES = [
  "常识判断",
  "科技地理",
  "历史人文",
  "法律常识",
  "经济常识",
  "管理常识",
  "常识应用能力",
  "科技常识",
  "行政常识",
  "宪法常识",
  "地理常识",
  "历史文化",
] as const;

export function isExamTemplateId(value: unknown): value is ExamTemplateId {
  return typeof value === "string" && value in EXAM_TEMPLATES;
}

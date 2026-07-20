import { PrismaClient } from "@prisma/client";
import { difficultyLabel, scoreQuestionDifficulty } from "../src/lib/difficulty";
import bcrypt from "bcryptjs";
import { questionBank } from "./question-bank";

const db = new PrismaClient();

const originalQuestions = [
  { category: "言语理解", type: "逻辑填空", stem: "城市文化建设既要保留历史记忆，也要顺应时代发展。只有让传统文化与现代生活相互____，城市文脉才能真正延续。", options: ["分离", "融合", "抵触", "替代"], answer: 1, explanation: "语境强调两者共同促进城市文脉延续，融合最符合文意。", difficulty: "基础" as const },
  { category: "判断推理", type: "逻辑判断", stem: "所有参加培训的人员都通过了考核，小李没有通过考核。由此可以推出：", options: ["小李参加了培训", "小李没有参加培训", "参加培训一定能得高分", "小李缺席了考核"], answer: 1, explanation: "根据充分条件关系，可以得到小李没有参加培训。", difficulty: "基础" as const },
  { category: "数量关系", type: "数学运算", stem: "某单位共有48人，其中党员人数比非党员人数多12人。党员有多少人？", options: ["18", "24", "30", "36"], answer: 2, explanation: "设党员为x人，x-(48-x)=12，解得x=30。", difficulty: "基础" as const },
  { category: "资料分析", type: "增长率", stem: "某地区去年生产总值为800亿元，今年增长至920亿元，同比增长率为：", options: ["12%", "15%", "18%", "20%"], answer: 1, explanation: "增长率=(920-800)÷800=15%。", difficulty: "基础" as const },
  { category: "常识判断", type: "政治常识", stem: "我国的根本政治制度是：", options: ["基层群众自治制度", "人民代表大会制度", "民族区域自治制度", "多党合作制度"], answer: 1, explanation: "人民代表大会制度是我国的根本政治制度。", difficulty: "基础" as const },
];

const essays = [
  {
    title: "数字公共服务中的适老化改造",
    topic: "公共服务",
    year: 2026,
    content: "近年来，政务服务、医疗挂号、交通出行等场景加快数字化。手机办理减少了排队时间，也提高了部门处理效率。但一些老年人不会使用智能手机，面对验证码、人脸识别和多层菜单时常常无所适从。某市政务大厅保留人工窗口，并安排志愿者提供一对一指导；社区定期开设手机课堂，把高频事项制作成大字版操作卡。与此同时，也有群众反映，部分平台虽然设置了长辈模式，但入口较深，字体放大后页面布局混乱；有的线下窗口简单要求群众先在手机上预约，没有充分考虑特殊群体。专家认为，数字化不应成为公共服务的新门槛。技术设计、线下兜底、人员培训和社会协同应共同推进，让不同群体都能平等、便利地获得服务。",
    questions: [
      { type: "归纳概括", prompt: "根据材料，概括当前数字公共服务适老化面临的主要问题。", wordLimit: 200, referenceAnswer: "主要问题包括：老年人数字技能不足；部分平台长辈模式入口深、适配不充分；线上流程复杂；一些线下窗口取消或弱化人工服务；工作人员服务意识和指导能力不足；技术改造、线下兜底与社会协同尚未形成合力。", scoringPoints: ["数字技能不足", "平台适配不足", "流程复杂", "线下服务不足", "人员指导不足", "协同不足"] },
      { type: "提出对策", prompt: "针对材料中的问题，提出推进数字公共服务适老化的具体措施。", wordLimit: 300, referenceAnswer: "一是优化产品设计，简化高频事项流程，完善大字、语音和清晰导航。二是保留人工窗口、电话办理等线下渠道，禁止强制线上预约。三是加强工作人员培训和现场引导。四是依托社区开展数字技能教学，制作简明操作指南。五是吸收老年用户参与测试，建立问题反馈和持续改进机制。六是推动政府、平台、社区和家庭协同服务。", scoringPoints: ["优化设计", "保留人工渠道", "人员培训", "社区教学", "用户测试", "多方协同"] },
    ],
  },
  {
    title: "传统村落保护与活化利用",
    topic: "乡村振兴",
    year: 2026,
    content: "A村保存着成片传统民居和古树水系，但过去房屋年久失修，年轻人大量外出。为了改善环境，村里修缮公共空间，引入专业团队记录建筑工艺和村史，并鼓励村民参与讨论。部分闲置民居被改造成乡村书屋、手工作坊和小型民宿，村民通过讲解、餐饮和农产品销售增加收入。发展过程中也出现了新问题：个别经营者追求网红效果，使用与村落风貌不协调的装饰；旅游旺季垃圾和停车压力增大；传统技艺展示有时只停留在表演层面，年轻传承人仍然不足。当地提出，保护不是把村落封存起来，也不是一味商业化，而是要尊重原有格局和村民生活，在合理利用中延续文化。",
    questions: [
      { type: "综合分析", prompt: "结合材料，谈谈你对“保护不是把村落封存起来，也不是一味商业化”的理解。", wordLimit: 300, referenceAnswer: "这句话强调传统村落保护要处理好保护、发展与生活的关系。封存式保护割裂文化与现实生活，缺少持续动力；过度商业化则会破坏风貌、挤压村民生活并使文化空心化。应以真实性和整体性保护为前提，尊重村民主体地位，适度导入符合村落特点的产业，完善环境承载和利益联结，使文化传承、村民增收与社区发展相互促进。", scoringPoints: ["反对封存", "防止过度商业化", "真实性保护", "村民主体", "适度产业", "文化与发展统一"] },
      { type: "提出对策", prompt: "请为A村进一步做好传统村落保护与发展提出建议。", wordLimit: 350, referenceAnswer: "完善保护规划和建设规范，修缮历史建筑并保护整体格局；建立经营项目审查机制，控制不协调装饰和过度开发；完善停车、垃圾处理和游客容量管理；支持村民参与经营并建立合理收益分配；加强村史、工艺档案和传承人培养；发展书屋、研学、手作等与本地文化相符的业态；建立专家、村民和经营者共同参与的长期评估机制。", scoringPoints: ["保护规划", "项目审查", "承载管理", "村民收益", "传承培养", "特色业态", "共同评估"] },
    ],
  },
  {
    title: "城市社区协商治理",
    topic: "基层治理",
    year: 2026,
    content: "B社区建成年代较早，停车、加装电梯、宠物管理等问题长期存在。过去遇到矛盾主要由社区工作人员分别协调，往往反复沟通仍难形成一致意见。后来社区建立议事平台，邀请居民代表、物业、业委会、专业人员和相关部门共同参与。讨论加装电梯时，社区先入户收集不同楼层居民诉求，再由专业人员解释安全、采光和费用分担方案，最终形成分层补偿和后续维护办法。实践中也发现，有的议事会参与者固定，年轻人和租户声音较少；部分议题开会讨论很多，但责任人和完成时限不清；少数居民只在涉及自身利益时参与。社区计划通过线上征集、轮值代表、结果公示和跟踪评价改进机制。",
    questions: [
      { type: "归纳概括", prompt: "概括B社区协商治理取得成效的主要做法。", wordLimit: 220, referenceAnswer: "搭建多方参与的议事平台；议事前深入收集不同群体诉求；引入专业人员提供信息和方案支持；围绕利益差异开展充分沟通；形成费用分担、补偿和维护等具体规则；推动居民、物业、业委会和部门共同协作。", scoringPoints: ["多方平台", "收集诉求", "专业支持", "充分沟通", "具体规则", "协同参与"] },
      { type: "贯彻执行", prompt: "假如你是社区工作人员，请拟写一份完善社区议事机制的工作要点。", wordLimit: 400, referenceAnswer: "一、拓宽参与渠道。线上线下征集议题，吸纳年轻人、租户等群体，推行代表轮值。二、规范议事流程。明确议题筛选、情况调查、方案论证、会议协商等环节。三、强化专业支持。根据议题邀请法律、工程等专业人员。四、明确执行责任。形成任务清单，标明责任主体和完成时限。五、加强公开反馈。及时公示协商结果和进展，接受居民监督。六、开展跟踪评价。定期回访实施效果，及时调整方案。七、培育参与意识，通过社区活动提升居民公共责任。", scoringPoints: ["拓宽参与", "规范流程", "专业支持", "责任时限", "公开反馈", "跟踪评价", "参与意识"] },
    ],
  },
];

async function main() {
  const passwordHash = await bcrypt.hash("Demo123456", 12);
  await db.user.upsert({ where: { email: "admin@zhizheng.local" }, update: {}, create: { name: "系统管理员", email: "admin@zhizheng.local", passwordHash, role: "ADMIN" } });
  await db.user.upsert({ where: { email: "student@zhizheng.local" }, update: {}, create: { name: "备考学员", email: "student@zhizheng.local", passwordHash } });

  for (const question of [...originalQuestions, ...questionBank]) {
    const exists = await db.question.findFirst({ where: { stem: question.stem } });
    if (exists) continue;
    const category = await db.category.upsert({ where: { name: question.category }, update: {}, create: { name: question.category } });
    const difficultyScore = scoreQuestionDifficulty(question);
    await db.question.create({ data: { categoryId: category.id, type: question.type, stem: question.stem, options: question.options, answer: question.answer, explanation: question.explanation, difficultyScore, difficulty: difficultyLabel(difficultyScore), status: question.category === "资料分析" ? "DRAFT" : "PUBLISHED" } });
  }

  for (const essay of essays) {
    const exists = await db.essayMaterial.findFirst({ where: { title: essay.title } });
    if (exists) continue;
    await db.essayMaterial.create({ data: { title: essay.title, topic: essay.topic, year: essay.year, content: essay.content, questions: { create: essay.questions.map((question) => ({ type: question.type, prompt: question.prompt, wordLimit: question.wordLimit, referenceAnswer: question.referenceAnswer, scoringPoints: question.scoringPoints })) } } });
  }
}

main().finally(() => db.$disconnect());

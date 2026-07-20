import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { PrismaClient } from "@prisma/client";

const port = Number(process.env.TEST_PORT || 3107);
const baseUrl = `http://127.0.0.1:${port}`;
const db = new PrismaClient();
const createdAttemptIds = [];
const createdEssaySubmissionIds = [];
const createdStudyPlanIds = [];
const createdExamSessionIds = [];
const createdPracticeSessionIds = [];
const createdTrainingReportIds = [];
let server;
let serverOutput = "";
let modelMockServer;
let modelMockBaseUrl = "";
const modelMockRequests = [];
let modelMockMode = "success";
let studentCookie = "";
let studentId = "";
let adminCookie = "";
let modelAdminCookie = "";
let initialModelConfig = null;
let targetQuestion;
let favoriteInitiallyExisted = false;
let createdAdminQuestionId = "";
let initialPreference = null;
let initialModelUsageRows = null;
let touchedModelUsageKeys = [];
let initialLearningAnalysisUsageRows = null;
let touchedLearningAnalysisUsageKeys = [];
const registeredEmailInput = `  Register.API.${Date.now()}@Example.COM  `;
const registeredEmail = registeredEmailInput.trim().toLowerCase();
const registeredPassword = "SecurePass123";
let registeredUserId = "";
let registeredCookie = "";
const adminManagedUserEmail = `admin-managed-api-${Date.now()}@example.com`;
let adminManagedUserId = "";
let adminManagedUsageKey = "";

function sessionCookie(response) {
  const header = response.headers.get("set-cookie") || "";
  return header.split(";", 1)[0];
}

function trainingEvaluationUsageKeys(userId) {
  const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const day = shifted.toISOString().slice(0, 10);
  const purpose = "TRAINING_REPORT_EVALUATION";
  return [
    `${day}:${purpose}:GLOBAL`,
    `${day}:${purpose}:USER:${userId}`,
  ];
}

function learningAnalysisUsageKeys(userId) {
  const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const day = shifted.toISOString().slice(0, 10);
  const purpose = "LEARNING_ANALYSIS";
  return [
    `${day}:${purpose}:GLOBAL`,
    `${day}:${purpose}:USER:${userId}`,
  ];
}

function dailyCheckInUsageKeys(userId) {
  const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const day = shifted.toISOString().slice(0, 10);
  const purpose = "DAILY_CHECK_IN_GOAL";
  return [
    `${day}:${purpose}:GLOBAL`,
    `${day}:${purpose}:USER:${userId}`,
  ];
}

async function rememberModelUsageBaseline() {
  if (initialModelUsageRows) return;
  touchedModelUsageKeys = trainingEvaluationUsageKeys(studentId);
  initialModelUsageRows = await db.modelUsageDaily.findMany({
    where: { key: { in: touchedModelUsageKeys } },
  });
}

async function rememberLearningAnalysisUsageBaseline() {
  if (initialLearningAnalysisUsageRows) return;
  touchedLearningAnalysisUsageKeys = learningAnalysisUsageKeys(studentId);
  initialLearningAnalysisUsageRows = await db.modelUsageDaily.findMany({
    where: { key: { in: touchedLearningAnalysisUsageKeys } },
  });
}

async function createEvaluationReportFixture(title) {
  const now = new Date();
  const report = await db.trainingReport.create({
    data: {
      userId: studentId,
      clientKey: `evaluation-fixture:${Date.now()}:${Math.random()}`,
      mode: "PRACTICE",
      title,
      questionIds: [],
      attemptIds: [],
      questionDurations: {},
      durationSeconds: 60,
      total: 1,
      answered: 1,
      correct: 1,
      accuracy: 100,
      difficultyScore: 5,
      sections: [
        {
          key: "fixture-section",
          name: "测试板块",
          total: 1,
          answered: 1,
          correct: 1,
          accuracy: 100,
          durationSeconds: 60,
          difficultyScore: 5,
          evaluation: null,
          subtypes: [
            {
              key: "fixture-subtype",
              name: "测试题型",
              total: 1,
              answered: 1,
              correct: 1,
              accuracy: 100,
              durationSeconds: 60,
              averageDurationSeconds: 60,
              difficultyScore: 5,
            },
          ],
        },
      ],
      startedAt: new Date(now.getTime() - 60_000),
      completedAt: now,
    },
  });
  createdTrainingReportIds.push(report.id);
  return report;
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.cookie) headers.set("Cookie", options.cookie);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`测试服务启动失败：${serverOutput.slice(-2000)}`);
}

before(async () => {
  modelMockServer = createServer((request, response) => {
    let rawBody = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { rawBody += chunk; });
    request.on("end", () => {
      modelMockRequests.push({ method: request.method, url: request.url, body: rawBody, authorization: request.headers.authorization || "" });
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      if (request.url === "/v1/responses") {
        response.statusCode = 404;
        response.end(JSON.stringify({ error: { message: "Responses API is not supported" } }));
        return;
      }
      if (request.url === "/v1/chat/completions") {
        if (modelMockMode === "oversized") {
          response.write('{"choices":[{"message":{"content":"');
          let sent = 0;
          const timer = setInterval(() => {
            if (sent >= 200) {
              clearInterval(timer);
              response.end('"}}]}');
              return;
            }
            response.write("x".repeat(50_000));
            sent += 1;
          }, 20);
          response.on("close", () => clearInterval(timer));
          return;
        }
        let modelResponse = null;
        try {
          const requestBody = JSON.parse(rawBody);
          const systemPrompt = requestBody.messages?.[0]?.content || "";
          if (systemPrompt.includes("公务员考试训练分析师")) {
            const context = JSON.parse(requestBody.messages?.[1]?.content || "{}");
            modelResponse = {
              overallEvaluation: "本轮作答节奏基本稳定，已结合正确率和综合难度完成分析；建议优先复盘低正确率细分题型，再用同难度题组验证改进效果。",
              sectionEvaluations: (context.sections || []).map((section) => ({
                key: section.key,
                evaluation: `${section.name}板块已结合细分题型数据完成分析，建议复盘失分模式并安排针对性巩固练习。`,
              })),
            };
            if (modelMockMode === "partial") modelResponse.sectionEvaluations = [];
          } else if (systemPrompt.includes("资深公务员考试学习分析师")) {
            modelResponse = {
              headline: "当前训练已形成基础画像，下一步应转向可验证的弱项提升",
              overall: "累计作答已经能够反映主要板块的覆盖情况，但总体正确率不能脱离题目难度、限时条件和样本分布单独解释。近七天的训练量、正确率与系统验收任务数共同说明执行情况，后续需要在相同板块和相近难度下持续复测，才能判断提升是否稳定。当前结论应被视为训练决策依据，而不是对能力的永久标签。",
              ability: "板块比较应同时查看正确率、题量、平均难度和题均用时。样本较多且正确率稳定的板块可以作为保持项，样本足够但正确率偏低或用时偏长的板块应进入优先复盘。细分题型只用于定位失分模式，不能因为少数几题就直接判定长期短板；复盘时还要区分知识缺口、题型识别、步骤遗漏、计算失误与时间压力。",
              trend: "近七天与前七天的变化需要结合训练板块和难度解释。正确率上升但用时明显增加，说明得分改善尚未转化为考场效率；正确率与速度同时改善，才适合逐步提高难度。训练集中在一两天完成时，趋势可信度也会下降，因此还应观察连续性。",
              priorities: "第一优先级应选择样本足够且失分最集中的板块，先缩小到具体题型做基础到中等难度验证；第二优先级用于保持当前较稳定板块，避免主攻弱项时出现回落。每一轮只改变难度、题量或限时中的一个变量，并以新题复测结果决定是否升级。",
              trainingPlan: "下一阶段采用诊断、复盘、同类验证和再评估的闭环。常识判断、言语理解与表达、判断推理使用相对较大的题组，以降低偶然对错造成的波动；资料分析和数量关系使用较小题组，为阅读、列式、计算和检查留出时间。训练后立即标记错因与超时题，复盘最集中的一至两类问题，再用相近难度的新题验证。连续两组达到动态验收线且题均用时没有恶化时提高难度，连续两组未达标时降低难度或缩小范围。",
              caveat: "以上判断仅依据系统已记录的作答、用时、难度、训练报告和验收记录。未计时作答、样本过少或板块分布不均都会降低结论稳定性，因此优先级仍需通过下一组同条件训练复核。",
              actions: [
                "完成一组当前最低正确率板块的基础到中等难度计时题，记录正确率、题均用时和四类主要错因。",
                "选择本轮错误最集中的一个细分题型，整理两条读题识别信号，并使用新的同类题验证方法。",
                "下一次训练保持板块与难度不变，只调整一个变量，并比较正确率与题均用时是否同时改善。",
                "资料与数量采用较小题组，常识、言语和判断采用较大题组，完成后再决定是否提高难度。",
              ],
            };
          } else if (systemPrompt.includes("公务员考试学习目标规划师")) {
            modelResponse = {
              questionGoal: 35,
              taskGoal: 3,
              summary: "根据近期作答节奏安排35题，并完成3个系统验收任务。",
            };
          } else if (systemPrompt.includes("公务员考试学习规划教练")) {
            modelResponse = {
              summary: "近期数据表明数量关系仍是首要提升方向，工作日晚间采用 METHOD_FIRST，再做限时验证，同时保留言语和申论训练以检查能力迁移。",
              strategy: {
                phase: "强化阶段 · 方法稳定性校准",
                objective: "让数量关系从会做转为限时稳定得分，并用阶段测验确认训练是否迁移到整卷节奏。",
                priorities: [
                  { area: "数量关系", reason: "结合近期正确率、难度和用时确定为第一优先项", allocationPercent: 50 },
                  { area: "言语理解", reason: "维持已有能力，避免单板块训练造成波动", allocationPercent: 30 },
                  { area: "申论与综合复盘", reason: "保留材料表达和整卷校准", allocationPercent: 20 },
                ],
                rhythm: "第1天同日安排方法复盘与限时验证，随后穿插错题、保持训练、申论和阶段测验，第7天依据检查点调整下一周期。",
                adjustmentRules: [
                  "若数量关系连续两组正确率达到80%且题均用时下降，则下一组提高1个难度档。",
                  "若正确率和速度同时下降，则暂停加量，回到方法复盘并缩小题组。",
                ],
              },
              tasks: [
                { day: 1, title: "数量关系方法复盘", type: "KNOWLEDGE", target: "复盘三类高频错因并整理识别信号", minutes: 55, reason: "先处理方法漏洞，避免直接堆题量", priority: "HIGH", checkpoint: "能独立说明三类题的识别信号和步骤", module: "数量关系", difficulty: "基础到中等", questionCount: 12 },
                { day: 1, title: "数量关系限时验证", type: "TIMED_PRACTICE", target: "完成一组限时题并记录题均用时", minutes: 45, reason: "在同一天验证方法是否能转化为速度", priority: "HIGH", checkpoint: "正确率达到70%以上且没有单题超时", module: "数量关系", difficulty: "中等", questionCount: 15 },
                { day: 2, title: "错题闭环", type: "WRONG", target: "重做近期错题并为每题标注错因", minutes: 35, reason: "检查方法修正是否真正生效", priority: "HIGH", checkpoint: "重做正确率达到85%", module: "数量关系", difficulty: "匹配原题", questionCount: 10 },
                { day: 3, title: "言语保持训练", type: "PRACTICE", target: "完成言语专项并记录正确率", minutes: 45, reason: "避免重点训练挤压稳定板块", priority: "MEDIUM", checkpoint: "正确率不低于近期平均值", module: "言语理解", difficulty: "中等", questionCount: 20 },
                { day: 4, title: "申论归纳表达", type: "ESSAY", target: "完成一道归纳概括并依据评分点改写", minutes: 50, reason: "保持材料提炼和规范表达能力", priority: "MEDIUM", checkpoint: "在限字内完成并至少改写一个失分段落", module: "申论", difficulty: "强化", questionCount: 1 },
                { day: 6, title: "阶段限时测验", type: "EXAM", target: "完成目标卷型阶段测验", minutes: 60, reason: "检查专项能力向综合节奏的迁移", priority: "HIGH", checkpoint: "完成交卷并定位最低正确率和超时板块", module: "行测综合", difficulty: "正式卷型", questionCount: 40 },
                { day: 6, title: "测验即时复盘", type: "REVIEW", target: "整理阶段测验中的时间分配问题", minutes: 20, reason: "趁记忆清晰完成即时校准", priority: "MEDIUM", checkpoint: "形成一条时间调整规则和两个错因结论", module: "行测综合", difficulty: "匹配测验", questionCount: 5 },
                { day: 7, title: "周总结与动态校准", type: "REVIEW", target: "根据所有检查点确定下一周优先级", minutes: 40, reason: "让后续计划随真实表现变化", priority: "MEDIUM", checkpoint: "明确继续项、降级项和下周第一任务", module: "综合复盘", difficulty: "匹配表现", questionCount: 6 },
              ],
            };
          }
        } catch {}
        response.end(JSON.stringify({
          choices: [{
            message: {
              content: `\n\`\`\`json\n${JSON.stringify(modelResponse || {})}\n\`\`\`\n`,
            },
          }],
        }));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: { message: "Not found" } }));
    });
  });
  await new Promise((resolve, reject) => {
    modelMockServer.once("error", reject);
    modelMockServer.listen(0, "127.0.0.1", resolve);
  });
  const modelMockAddress = modelMockServer.address();
  assert.ok(modelMockAddress && typeof modelMockAddress === "object");
  modelMockBaseUrl = `http://127.0.0.1:${modelMockAddress.port}/v1`;

  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      ALLOW_INSECURE_MODEL_BASE_URL: "1",
      ALLOW_PRIVATE_MODEL_BASE_URL: "1",
      DISABLE_BACKGROUND_REPORT_EVALUATION: "1",
      MODEL_EVALUATION_DAILY_LIMIT: "50",
      MODEL_EVALUATION_GLOBAL_DAILY_LIMIT: "1000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
  server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
  await waitForServer();
  initialModelConfig = await db.modelConfig.findUnique({ where: { id: "default" } });
  const adminLogin = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: "admin@zhizheng.local", password: "Demo123456" }) });
  assert.equal(adminLogin.status, 200);
  modelAdminCookie = sessionCookie(adminLogin);
});

after(async () => {
  if (createdTrainingReportIds.length) await db.trainingReport.deleteMany({ where: { id: { in: createdTrainingReportIds } } });
  if (createdAttemptIds.length) await db.attempt.deleteMany({ where: { id: { in: createdAttemptIds } } });
  if (createdEssaySubmissionIds.length) await db.essaySubmission.deleteMany({ where: { id: { in: createdEssaySubmissionIds } } });
  if (createdStudyPlanIds.length) await db.studyPlan.deleteMany({ where: { id: { in: createdStudyPlanIds } } });
  if (createdExamSessionIds.length) await db.examSession.deleteMany({ where: { id: { in: createdExamSessionIds } } });
  if (createdPracticeSessionIds.length) await db.practiceSession.deleteMany({ where: { id: { in: createdPracticeSessionIds } } });
  if (studentId) {
    if (initialPreference) { const preferenceData = { ...initialPreference }; delete preferenceData.id; delete preferenceData.userId; await db.trainingPreference.upsert({ where: { userId: studentId }, update: preferenceData, create: { userId: studentId, ...preferenceData } }); }
    else await db.trainingPreference.deleteMany({ where: { userId: studentId } });
  }
  if (createdAdminQuestionId) await db.question.deleteMany({ where: { id: createdAdminQuestionId } });
  await db.category.deleteMany({ where: { name: "自动化测试分类", questions: { none: {} } } });
  if (studentId && targetQuestion) {
    await db.favorite.deleteMany({ where: { userId: studentId, questionId: targetQuestion.id } });
    if (favoriteInitiallyExisted) await db.favorite.create({ data: { userId: studentId, questionId: targetQuestion.id } });
  }
  if (registeredUserId) await db.user.deleteMany({ where: { id: registeredUserId } });
  else await db.user.deleteMany({ where: { email: registeredEmail } });
  if (adminManagedUsageKey) await db.modelUsageDaily.deleteMany({ where: { key: adminManagedUsageKey } });
  if (adminManagedUserId) await db.user.deleteMany({ where: { id: adminManagedUserId } });
  if (initialModelConfig) {
    const data = { ...initialModelConfig }; delete data.id;
    await db.modelConfig.upsert({ where: { id: "default" }, update: data, create: { id: "default", ...data } });
  } else await db.modelConfig.deleteMany({ where: { id: "default" } });
  if (initialModelUsageRows) {
    await db.modelUsageDaily.deleteMany({ where: { key: { in: touchedModelUsageKeys } } });
    if (initialModelUsageRows.length)
      await db.modelUsageDaily.createMany({ data: initialModelUsageRows });
  }
  if (initialLearningAnalysisUsageRows) {
    await db.modelUsageDaily.deleteMany({
      where: { key: { in: touchedLearningAnalysisUsageKeys } },
    });
    if (initialLearningAnalysisUsageRows.length)
      await db.modelUsageDaily.createMany({ data: initialLearningAnalysisUsageRows });
  }
  if (registeredUserId) {
    await db.modelUsageDaily.deleteMany({ where: { key: { in: dailyCheckInUsageKeys(registeredUserId) } } });
  }
  await db.$disconnect();
  server?.kill();
  if (modelMockServer) await new Promise((resolve) => modelMockServer.close(resolve));
});

test("AUTH-001：未登录读取当前用户应返回统一的 401 响应", async () => {
  const response = await api("/api/auth/me");
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.error?.code, "UNAUTHORIZED");
});

test("HEALTH-001：服务状态检查应确认数据库连接正常", async () => {
  const response = await api("/api/health");
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.status, "ok");
  assert.equal(body.data.database, "connected");
});

test("AUTH-002：错误登录信息应返回统一错误结构", async () => {
  const response = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "student@zhizheng.local", password: "NotThePassword" }),
  });
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(typeof body.error?.code, "string", "登录接口应返回 error.code");
  assert.equal(typeof body.error?.message, "string", "登录接口应返回 error.message");
});

test("AUTH-003：学员登录后应获得有效会话并可恢复当前用户", async () => {
  const response = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "student@zhizheng.local", password: "Demo123456" }),
  });
  assert.equal(response.status, 200);
  const rawCookie = response.headers.get("set-cookie") || "";
  assert.match(rawCookie, /HttpOnly/i);
  assert.match(rawCookie, /SameSite=Lax/i);
  studentCookie = sessionCookie(response);
  assert.match(studentCookie, /^zx_session=.+/);

  const meResponse = await api("/api/auth/me", { cookie: studentCookie });
  const me = await meResponse.json();
  assert.equal(meResponse.status, 200);
  assert.equal(me.data.email, "student@zhizheng.local");
  assert.equal(me.data.role, "STUDENT");
  studentId = me.data.id;
  initialPreference = await db.trainingPreference.findUnique({ where: { userId: studentId } });
});

test("AUTH-005：公开注册应规范化邮箱、强制创建学员并自动建立会话", async () => {
  const response = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name: "注册测试学员",
      email: registeredEmailInput,
      password: registeredPassword,
      confirmPassword: registeredPassword,
      targetExam: "2027 国家公务员考试",
      role: "ADMIN",
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.data.user.email, registeredEmail);
  assert.equal(body.data.user.role, "STUDENT", "公开注册不得接受客户端提交的管理员角色");
  assert.equal(body.data.user.targetExam, "2027 国家公务员考试");
  assert.equal(Object.hasOwn(body.data.user, "passwordHash"), false);
  assert.equal(JSON.stringify(body).includes("passwordHash"), false);
  registeredUserId = body.data.user.id;

  const rawCookie = response.headers.get("set-cookie") || "";
  assert.match(rawCookie, /HttpOnly/i);
  assert.match(rawCookie, /SameSite=Lax/i);
  registeredCookie = sessionCookie(response);
  assert.match(registeredCookie, /^zx_session=.+/);

  const meResponse = await api("/api/auth/me", { cookie: registeredCookie });
  const me = await meResponse.json();
  assert.equal(meResponse.status, 200);
  assert.equal(me.data.id, registeredUserId);
  assert.equal(me.data.email, registeredEmail);
  assert.equal(me.data.role, "STUDENT");
});

test("AUTH-006：重复邮箱注册应返回 ACCOUNT_EXISTS", async () => {
  const response = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ name: "重复注册学员", email: registeredEmail.toUpperCase(), password: registeredPassword, confirmPassword: registeredPassword }),
  });
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error?.code, "ACCOUNT_EXISTS");
});

test("AUTH-007：注册应拒绝弱密码、超出 bcrypt 字节限制的密码和不一致确认密码", async () => {
  const invalidCases = [
    {
      label: "弱密码",
      payload: { name: "弱密码测试", email: `weak.${Date.now()}@example.com`, password: "onlyletters", confirmPassword: "onlyletters" },
    },
    {
      label: "超过 72 个 UTF-8 字节的密码",
      payload: (() => {
        const password = `Abc12345${"密".repeat(22)}`;
        return { name: "长密码测试", email: `long.${Date.now()}@example.com`, password, confirmPassword: password };
      })(),
    },
    {
      label: "确认密码不一致",
      payload: { name: "确认密码测试", email: `mismatch.${Date.now()}@example.com`, password: "SecurePass123", confirmPassword: "SecurePass124" },
    },
  ];

  for (const { label, payload } of invalidCases) {
    const response = await api("/api/auth/register", { method: "POST", body: JSON.stringify(payload) });
    const body = await response.json();
    assert.equal(response.status, 400, `${label}应被拒绝`);
    assert.equal(body.error?.code, "INVALID_INPUT", `${label}应返回统一错误码`);
  }
});

test("AUTH-008：新账号退出后仍可使用规范化邮箱重新登录", async () => {
  const logoutResponse = await api("/api/auth/logout", { method: "POST", cookie: registeredCookie });
  assert.equal(logoutResponse.status, 200);
  assert.match(logoutResponse.headers.get("set-cookie") || "", /zx_session=;/i);

  const loginResponse = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: `  ${registeredEmail.toUpperCase()}  `, password: registeredPassword }),
  });
  const login = await loginResponse.json();
  assert.equal(loginResponse.status, 200);
  assert.equal(login.data.user.id, registeredUserId);
  assert.equal(login.data.user.email, registeredEmail);
  assert.equal(Object.hasOwn(login.data.user, "passwordHash"), false);
  assert.match(sessionCookie(loginResponse), /^zx_session=.+/);
});

test("QUESTION-001：题目分页响应不得提前包含答案和解析", async () => {
  const response = await api("/api/questions?page=1&pageSize=3", { cookie: studentCookie });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.data.items));
  assert.ok(body.data.items.length > 0, "种子数据应至少包含一道已发布题目");
  assert.equal(body.data.page, 1);
  assert.equal(body.data.pageSize, 3);
  assert.equal(typeof body.data.total, "number");
  for (const item of body.data.items) {
    assert.equal(Object.hasOwn(item, "answer"), false);
    assert.equal(Object.hasOwn(item, "explanation"), false);
    assert.ok(Array.isArray(item.options));
  }
  targetQuestion = body.data.items[0];
});

test("QUESTION-004：正式题库应至少包含 35 道已发布题目", async () => {
  const response = await api("/api/questions?page=1&pageSize=50", { cookie: studentCookie });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(body.data.total >= 35, `当前题目数量为 ${body.data.total}`);
  const categoryResponse = await api("/api/categories", { cookie: studentCookie }); const categoryBody = await categoryResponse.json();
  assert.ok(categoryBody.data.filter((item) => item.questionCount > 0).length >= 5);
  assert.ok(categoryBody.data.every((item) => Array.isArray(item.subtypes)));
  assert.ok(categoryBody.data.find((item) => item.name === "判断推理")?.subtypes.some((item) => item.name === "图形推理" && item.questionCount > 0));
});

test("QUESTION-005：随机组题应从千题规模数据库返回一组题目", async () => {
  const response = await api("/api/questions/session?count=50", { cookie: studentCookie });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(body.data.total >= 10000, `当前完整题库数量为 ${body.data.total}`);
  assert.equal(body.data.items.length, 50);
  assert.equal(body.data.items.some((item) => Object.hasOwn(item, "answer")), false);
  assert.ok(body.data.paperDifficulty >= 1 && body.data.paperDifficulty <= 10);
  assert.equal(body.data.items.every((item) => item.difficultyScore >= 1 && item.difficultyScore <= 10), true);
});

test("QUESTION-006：随机组题支持板块、题量和难度范围", async () => {
  const response = await api("/api/questions/session?count=12&category=言语理解&minDifficulty=4&maxDifficulty=6", { cookie: studentCookie });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.items.length, 12);
  assert.equal(body.data.items.every((item) => item.category === "言语理解"), true);
  assert.equal(body.data.items.every((item) => item.difficultyScore >= 4 && item.difficultyScore <= 6), true);

  const invalidResponse = await api("/api/questions/session?count=10&minDifficulty=8&maxDifficulty=3", { cookie: studentCookie });
  assert.equal(invalidResponse.status, 400);
});

test("QUESTION-007：资料分析必须按完整材料五题返回", async () => {
  const response = await api("/api/questions/session?count=10&category=资料分析&minDifficulty=1&maxDifficulty=10", { cookie: studentCookie });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.items.length, 10);
  const groups = new Map();
  for (const item of body.data.items) {
    assert.ok(item.materialId);
    assert.ok(item.material?.blocks?.length > 0);
    groups.set(item.materialId, (groups.get(item.materialId) || 0) + 1);
  }
  assert.equal(groups.size, 2);
  assert.equal([...groups.values()].every((count) => count === 5), true);
});

test("QUESTION-009：近期会话题目应优先过滤且题库不足时才回补", async () => {
  const query = "/api/questions/session?count=10&category=数量关系&minDifficulty=1&maxDifficulty=10";
  const firstResponse = await api(query, { cookie: studentCookie });
  const first = await firstResponse.json();
  assert.equal(firstResponse.status, 200, JSON.stringify(first));
  assert.equal(first.data.items.length, 10);
  const sessionResponse = await api("/api/practice-sessions", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({
      questionIds: first.data.items.map((item) => item.id),
      config: { count: 10, category: "数量关系", scopes: [], minDifficulty: 1, maxDifficulty: 10 },
    }),
  });
  const practice = await sessionResponse.json();
  assert.equal(sessionResponse.status, 201, JSON.stringify(practice));
  createdPracticeSessionIds.push(practice.data.id);
  await api(`/api/practice-sessions/${practice.data.id}`, { method: "PATCH", cookie: studentCookie, body: JSON.stringify({ status: "ABANDONED" }) });
  const secondResponse = await api(query, { cookie: studentCookie });
  const second = await secondResponse.json();
  assert.equal(secondResponse.status, 200, JSON.stringify(second));
  const firstIds = new Set(first.data.items.map((item) => item.id));
  assert.equal(second.data.items.some((item) => firstIds.has(item.id)), false, "题库充足时不得立即重复近期会话题目");
  assert.equal(second.data.reusedSelected, 0);
});

test("QUESTION-007A：多选细分板块精确匹配大板块与题型且可用量一致", async () => {
  const scopes = [
    { category: "数量关系", type: "数学运算" },
    { category: "判断推理", type: "图形推理" },
  ];
  const query = `count=20&scopes=${encodeURIComponent(JSON.stringify(scopes))}&minDifficulty=1&maxDifficulty=10`;
  const [sessionResponse, availabilityResponse] = await Promise.all([
    api(`/api/questions/session?${query}`, { cookie: studentCookie }),
    api(`/api/questions/availability?${query}`, { cookie: studentCookie }),
  ]);
  const [sessionBody, availabilityBody] = await Promise.all([
    sessionResponse.json(), availabilityResponse.json(),
  ]);
  assert.equal(sessionResponse.status, 200, JSON.stringify(sessionBody));
  assert.equal(availabilityResponse.status, 200, JSON.stringify(availabilityBody));
  assert.equal(sessionBody.data.total, availabilityBody.data.total);
  assert.equal(sessionBody.data.items.length, 20);
  assert.ok(sessionBody.data.items.every((item) => scopes.some(
    (scope) => scope.category === item.category && scope.type === item.type,
  )));

  const duplicateNameScope = [{ category: "判断推理", type: "数学运算" }];
  const duplicateNameResponse = await api(
    `/api/questions/session?count=5&scopes=${encodeURIComponent(JSON.stringify(duplicateNameScope))}`,
    { cookie: studentCookie },
  );
  const duplicateNameBody = await duplicateNameResponse.json();
  assert.equal(duplicateNameResponse.status, 200, JSON.stringify(duplicateNameBody));
  assert.ok(duplicateNameBody.data.items.every(
    (item) => item.category === "判断推理" && item.type === "数学运算",
  ));

  const invalidResponse = await api(
    `/api/questions/session?count=5&scopes=${encodeURIComponent(JSON.stringify([...scopes, scopes[0]]))}`,
    { cookie: studentCookie },
  );
  assert.equal(invalidResponse.status, 400);
});

test("QUESTION-007B：资料分析细分选择仍保持完整五题材料组", async () => {
  const scopes = [{ category: "资料分析", type: "综合材料" }];
  const response = await api(
    `/api/questions/session?count=10&scopes=${encodeURIComponent(JSON.stringify(scopes))}&minDifficulty=1&maxDifficulty=10`,
    { cookie: studentCookie },
  );
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.items.length, 10);
  assert.ok(body.data.items.every((item) => item.category === "资料分析" && item.type === "综合材料"));
  const groups = new Map();
  for (const item of body.data.items) groups.set(item.materialId, (groups.get(item.materialId) || 0) + 1);
  assert.ok([...groups.values()].every((count) => count === 5));
});

test("QUESTION-008：政治与普通常识题型池应在组题和可用量接口保持一致", async () => {
  const politicsTypes = new Set([
    "政治理论", "习近平新时代中国特色社会主义思想", "马克思主义基本原理",
    "党史党建", "中国特色社会主义理论体系", "毛泽东思想", "政治常识",
    "时政常识", "时事政治",
  ]);
  const generalTypes = new Set([
    "常识判断", "科技地理", "历史人文", "法律常识", "经济常识", "管理常识",
    "常识应用能力", "科技常识", "行政常识", "宪法常识", "地理常识", "历史文化",
  ]);
  const politicalTerms = [
    "习近平", "马克思", "毛泽东", "中国特色社会主义", "中国共产党",
    "党中央", "党的二十大", "二十届", "全会",
  ];
  for (const pool of ["POLITICS", "GENERAL_KNOWLEDGE"]) {
    const query = `category=${encodeURIComponent("常识判断")}&questionPool=${pool}&count=5&minDifficulty=1&maxDifficulty=10`;
    const [sessionResponse, availabilityResponse] = await Promise.all([
      api(`/api/questions/session?${query}`, { cookie: studentCookie }),
      api(`/api/questions/availability?${query}`, { cookie: studentCookie }),
    ]);
    const [sessionBody, availabilityBody] = await Promise.all([
      sessionResponse.json(), availabilityResponse.json(),
    ]);
    assert.equal(sessionResponse.status, 200, JSON.stringify(sessionBody));
    assert.equal(availabilityResponse.status, 200, JSON.stringify(availabilityBody));
    assert.equal(sessionBody.data.total, availabilityBody.data.total);
    assert.equal(sessionBody.data.items.length, 5);
    if (pool === "POLITICS") {
      assert.ok(sessionBody.data.items.every((item) => politicsTypes.has(item.type)));
    } else {
      assert.ok(sessionBody.data.items.every((item) => generalTypes.has(item.type)));
      assert.ok(sessionBody.data.items.every(
        (item) => !politicalTerms.some((term) => item.stem.includes(term)),
      ));
    }
  }
  const genericScope = encodeURIComponent(JSON.stringify([
    { category: "常识判断", type: "常识判断" },
  ]));
  const genericQuery = `category=${encodeURIComponent("常识判断")}&scopes=${genericScope}&questionPool=GENERAL_KNOWLEDGE&count=20&minDifficulty=1&maxDifficulty=10`;
  const genericResponse = await api(`/api/questions/session?${genericQuery}`, {
    cookie: studentCookie,
  });
  const genericBody = await genericResponse.json();
  assert.equal(genericResponse.status, 200, JSON.stringify(genericBody));
  assert.equal(genericBody.data.items.length, 20);
  assert.ok(genericBody.data.items.every((item) => item.type === "常识判断"));
  assert.ok(genericBody.data.items.every(
    (item) => !politicalTerms.some((term) => item.stem.includes(term)),
  ));
  for (const path of ["session", "availability"]) {
    const response = await api(
      `/api/questions/${path}?category=${encodeURIComponent("常识判断")}&questionPool=INVALID_POOL`,
      { cookie: studentCookie },
    );
    const body = await response.json();
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(body.error?.code, "INVALID_INPUT");
  }
});

test("PREFERENCE-001：训练配置应持久化细分板块并返回个性化难度建议", async () => {
  const practiceScopes = [{ category: "判断推理", type: "图形推理" }, { category: "数量关系", type: "数学运算" }];
  const payload = { practiceCount: 30, practiceCategory: null, practiceScopes, practiceDifficultyMode: "MEDIUM", practiceMinDifficulty: 4, practiceMaxDifficulty: 7, examCount: 40, examDuration: 75, examDifficultyMode: "RECOMMENDED", examMinDifficulty: 4, examMaxDifficulty: 7 };
  const putResponse = await api("/api/training-preferences", { method: "PUT", cookie: studentCookie, body: JSON.stringify(payload) });
  assert.equal(putResponse.status, 200);
  const getResponse = await api("/api/training-preferences", { cookie: studentCookie }); const body = await getResponse.json();
  assert.equal(body.data.preference.practiceCount, 30);
  assert.deepEqual(body.data.preference.practiceScopes, practiceScopes);
  assert.equal(body.data.preference.examDuration, 75);
  assert.ok(body.data.recommendation.minDifficulty >= 1 && body.data.recommendation.maxDifficulty <= 10);
  assert.equal(typeof body.data.recommendation.reason, "string");
  assert.ok(Array.isArray(body.data.recommendation.scopes));
});

test("QUESTION-002：题目详情在提交前不得包含答案和解析", async () => {
  const response = await api(`/api/questions/${targetQuestion.id}`, { cookie: studentCookie });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(Object.hasOwn(body.data, "answer"), false);
  assert.equal(Object.hasOwn(body.data, "explanation"), false);
});

test("QUESTION-003：非法分页参数应得到可识别的客户端错误", async () => {
  const response = await api("/api/questions?page=not-a-number&pageSize=20", { cookie: studentCookie });
  const text = await response.text();
  let body = {};
  try { body = JSON.parse(text); } catch {}
  assert.equal(response.status, 400, `实际状态码为 ${response.status}，响应内容为 ${text || "空"}`);
  assert.equal(body.error?.code, "INVALID_INPUT");
});

test("ANSWER-001：超出选项范围的答案应被拒绝", async () => {
  const response = await api(`/api/questions/${targetQuestion.id}`, {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({ selected: targetQuestion.options.length + 10 }),
  });
  const body = await response.json();
  if (body.data?.attemptId) createdAttemptIds.push(body.data.attemptId);
  assert.equal(response.status, 400);
  assert.equal(body.error?.code, "INVALID_INPUT");
});

test("ANSWER-002：有效答案应由服务端判定并写入作答记录", async () => {
  const response = await api(`/api/questions/${targetQuestion.id}`, {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({ selected: 0, duration: 12 }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(typeof body.data.correct, "boolean");
  assert.equal(typeof body.data.correctAnswer, "number");
  assert.equal(typeof body.data.explanation, "string");
  assert.equal(typeof body.data.attemptId, "string");
  createdAttemptIds.push(body.data.attemptId);

  const attemptsResponse = await api("/api/attempts", { cookie: studentCookie });
  const attempts = await attemptsResponse.json();
  assert.equal(attemptsResponse.status, 200);
  assert.ok(attempts.data.some((item) => item.id === body.data.attemptId));

  if (body.data.correct) {
    const wrongSelection = (body.data.correctAnswer + 1) % targetQuestion.options.length;
    const wrongResponse = await api(`/api/questions/${targetQuestion.id}`, {
      method: "POST",
      cookie: studentCookie,
      body: JSON.stringify({ selected: wrongSelection }),
    });
    const wrongBody = await wrongResponse.json();
    assert.equal(wrongBody.data.correct, false);
    createdAttemptIds.push(wrongBody.data.attemptId);
  }
});

test("ANSWER-003：专项练习交卷前可修改前面题目的答案且不重复计数", async () => {
  const questionResponse = await api(
    "/api/questions/session?count=5&category=数量关系&minDifficulty=1&maxDifficulty=10",
    { cookie: studentCookie },
  );
  const questionBody = await questionResponse.json();
  assert.equal(questionResponse.status, 200, JSON.stringify(questionBody));
  const items = questionBody.data.items;
  const sessionResponse = await api("/api/practice-sessions", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({
      questionIds: items.map((item) => item.id),
      config: {
        count: items.length,
        category: "数量关系",
        scopes: [],
        minDifficulty: 1,
        maxDifficulty: 10,
      },
    }),
  });
  const practice = await sessionResponse.json();
  assert.equal(sessionResponse.status, 201, JSON.stringify(practice));
  createdPracticeSessionIds.push(practice.data.id);

  const firstAnswerResponse = await api(`/api/questions/${items[0].id}`, {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({
      selected: 0,
      mode: "PRACTICE",
      duration: 1,
      practiceSessionId: practice.data.id,
    }),
  });
  const firstAnswer = await firstAnswerResponse.json();
  assert.equal(firstAnswerResponse.status, 200, JSON.stringify(firstAnswer));
  createdAttemptIds.push(firstAnswer.data.attemptId);

  const revisedResponse = await api(`/api/questions/${items[0].id}`, {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({
      selected: 1,
      mode: "PRACTICE",
      duration: 2,
      practiceSessionId: practice.data.id,
    }),
  });
  const revised = await revisedResponse.json();
  assert.equal(revisedResponse.status, 200, JSON.stringify(revised));
  assert.equal(revised.data.attemptId, firstAnswer.data.attemptId);
  assert.equal(revised.data.selected, 1);

  const [attempts, storedSession, question] = await Promise.all([
    db.attempt.findMany({
      where: { practiceSessionId: practice.data.id, questionId: items[0].id },
    }),
    db.practiceSession.findUnique({ where: { id: practice.data.id } }),
    db.question.findUniqueOrThrow({ where: { id: items[0].id } }),
  ]);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].selected, 1);
  assert.equal(attempts[0].correct, question.answer === 1);
  assert.equal(storedSession.answers[items[0].id], 1);

  await api(`/api/practice-sessions/${practice.data.id}`, {
    method: "PATCH",
    cookie: studentCookie,
    body: JSON.stringify({ status: "ABANDONED" }),
  });
});

test("EXAM-002：国考型和省考型应按固定板块配额与顺序组卷", async () => {
  const cases = [
    {
      template: "NATIONAL_PREFECTURE",
      total: 130,
      sections: [["政治理论", 20], ["常识判断", 15], ["言语理解与表达", 30], ["数量关系", 10], ["判断推理", 35], ["资料分析", 20]],
    },
    {
      template: "GUANGDONG_PROVINCE",
      total: 90,
      sections: [["政治", 10], ["常识", 5], ["言语理解与表达", 15], ["数量关系", 15], ["判断推理", 25], ["资料分析", 20]],
    },
  ];
  for (const item of cases) {
    const response = await api(`/api/questions/session?template=${item.template}`, { cookie: studentCookie });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.items.length, item.total);
    let offset = 0;
    for (const [sectionName, count] of item.sections) {
      const section = body.data.items.slice(offset, offset + count);
      assert.equal(section.every((question) => question.examSection === sectionName), true, `${item.template} 的 ${sectionName} 板块顺序或题量错误`);
      if (sectionName === "资料分析") {
        for (let index = 0; index < section.length; index += 5) {
          const group = section.slice(index, index + 5);
          assert.equal(new Set(group.map((question) => question.materialId)).size, 1, "资料分析必须按完整五题材料组卷");
        }
      }
      offset += count;
    }
    const politicalTypes = new Set(["政治理论", "习近平新时代中国特色社会主义思想", "马克思主义基本原理", "党史党建", "中国特色社会主义理论体系", "毛泽东思想", "政治常识", "时政常识", "时事政治"]);
    const politicalCount = item.template === "NATIONAL_PREFECTURE" ? 20 : 10;
    const commonCount = item.template === "NATIONAL_PREFECTURE" ? 15 : 5;
    assert.equal(body.data.items.slice(0, politicalCount).every((question) => politicalTypes.has(question.type)), true, "政治板块必须来自核心政治理论题型");
    assert.equal(body.data.items.slice(politicalCount, politicalCount + commonCount).every((question) => !politicalTypes.has(question.type)), true, "常识板块不得混入政治理论题");
    assert.equal(body.data.subtypeCounts.every((subtype) => subtype.selected === subtype.requested), true, `${item.template} 的细分题型配额必须全部满足`);
    const normalizedStems = body.data.items.map((question) => question.stem.replace(/<[^>]*>/g, "").replace(/\s+/g, "").toLowerCase());
    assert.equal(new Set(normalizedStems).size, normalizedStems.length, `${item.template} 不应包含重复题干`);
    assert.equal(body.data.items.some((question) => question.stem.includes("题目正在全力以赴征集")), false, "正式模拟卷不得包含占位题");
    if (item.template === "GUANGDONG_PROVINCE") {
      const taskKey = `program-exam-${Date.now()}`;
      const completionSpec = {
        version: 1,
        kind: "EXAM",
        method: "PROGRAM",
        launch: {
          kind: "EXAM",
          templateId: "GUANGDONG_PROVINCE",
          questionCount: 90,
          durationMinutes: 90,
        },
        evidence: { kind: "TRAINING_REPORT", mode: "EXAM" },
        minAnswered: 90,
        minAccuracy: null,
        maxElapsedSeconds: 5_400,
        requiredModule: null,
        difficultyRange: null,
        minCompleteMaterialGroups: 0,
        requiredTemplateId: "GUANGDONG_PROVINCE",
      };
      const task = {
        id: taskKey,
        day: 1,
        title: "广东省考正式模考程序验收",
        type: "EXAM",
        target: "完成广东省考正式卷",
        minutes: 90,
        reason: "验证正式模考程序验收",
        priority: "HIGH",
        checkpoint: "完成 90 题并在 90 分钟内交卷",
        module: "行测综合",
        difficulty: "正式卷型",
        questionCount: 90,
        completionSpec,
      };
      const plan = await db.studyPlan.create({
        data: {
          userId: studentId,
          title: "正式模考程序验收集成测试",
          source: "DATA_RULES",
          summary: "验证正式卷型、题量、时长和证据会话。",
          tasks: [task],
          schemaVersion: 4,
          generatedAt: new Date(Date.now() - 60_000),
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      createdStudyPlanIds.push(plan.id);
      const planContext = { planId: plan.id, taskKey, taskIndex: 0 };
      const examSessionResponse = await api("/api/exam-sessions", {
        method: "POST",
        cookie: studentCookie,
        body: JSON.stringify({
          questionIds: body.data.items.map((question) => question.id),
          durationMinutes: 90,
          paperDifficulty: body.data.paperDifficulty,
          planContext,
          config: {
            questionCount: 90,
            templateId: "GUANGDONG_PROVINCE",
          },
        }),
      });
      const examSession = await examSessionResponse.json();
      assert.equal(examSessionResponse.status, 201, JSON.stringify(examSession));
      createdExamSessionIds.push(examSession.data.id);
      const answerRows = await db.question.findMany({
        where: { id: { in: body.data.items.map((question) => question.id) } },
        select: { id: true, answer: true },
      });
      const answerMap = new Map(answerRows.map((question) => [question.id, question.answer]));
      const submitResponse = await api("/api/exams/submit", {
        method: "POST",
        cookie: studentCookie,
        body: JSON.stringify({
          sessionId: examSession.data.id,
          answers: body.data.items.map((question) => ({
            questionId: question.id,
            selected: answerMap.get(question.id),
          })),
          duration: 0,
          questionDurations: {},
        }),
      });
      const submitted = await submitResponse.json();
      assert.equal(submitResponse.status, 200, JSON.stringify(submitted));
      createdTrainingReportIds.push(submitted.data.report.id);
      createdAttemptIds.push(...submitted.data.attemptIds);
      const verifyResponse = await api("/api/study-plan/check-ins/verify", {
        method: "POST",
        cookie: studentCookie,
        body: JSON.stringify({
          ...planContext,
          evidenceId: submitted.data.report.id,
        }),
      });
      const verified = await verifyResponse.json();
      assert.equal(verifyResponse.status, 200, JSON.stringify(verified));
      assert.equal(verified.data.acceptanceMethod, "PROGRAM_VERIFIED");
      assert.equal(verified.data.actualSnapshot.answered, 90);
      assert.equal(verified.data.actualSnapshot.templateId, "GUANGDONG_PROVINCE");
    }
  }
  for (const template of ["NATIONAL_PREFECTURE", "GUANGDONG_PROVINCE"]) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await api(`/api/questions/session?template=${template}`, { cookie: studentCookie });
      const body = await response.json();
      assert.equal(response.status, 200);
      const normalized = body.data.items.map((question) => question.stem.replace(/<[^>]*>/g, "").replace(/\s+/g, "").toLowerCase());
      assert.equal(new Set(normalized).size, normalized.length, `${template} 连续抽样不得出现重复题干`);
      const material = body.data.items.filter((question) => question.examSection === "资料分析");
      for (let index = 0; index < material.length; index += 5) {
        const groupStems = material.slice(index, index + 5).map((question) => question.stem.replace(/<[^>]*>/g, "").replace(/\s+/g, "").toLowerCase());
        assert.equal(new Set(groupStems).size, 5, "资料分析材料组内部不得包含重复题目");
      }
    }
  }
});

test("EXAM-001：模拟考试应一次性写入并返回成绩", async () => {
  const questionResponse = await api("/api/questions?pageSize=2", { cookie: studentCookie });
  const questionBody = await questionResponse.json();
  assert.ok(questionBody.data.items.length >= 2);
  const sessionResponse = await api("/api/exam-sessions", { method: "POST", cookie: studentCookie, body: JSON.stringify({ questionIds: questionBody.data.items.map((item) => item.id), durationMinutes: 10, paperDifficulty: 5, config: { questionCount: 2, difficultyMode: "CUSTOM", minDifficulty: 1, maxDifficulty: 10 } }) });
  await sessionResponse.json();
  assert.equal(sessionResponse.status, 400, "考试会话至少需要 5 道题");

  const fiveResponse = await api("/api/questions/session?count=5", { cookie: studentCookie }); const fiveBody = await fiveResponse.json();
  const validSessionResponse = await api("/api/exam-sessions", { method: "POST", cookie: studentCookie, body: JSON.stringify({ questionIds: fiveBody.data.items.map((item) => item.id), durationMinutes: 10, paperDifficulty: fiveBody.data.paperDifficulty, config: { questionCount: 5, difficultyMode: "CUSTOM", minDifficulty: 1, maxDifficulty: 10 } }) }); const validSession = await validSessionResponse.json();
  assert.equal(validSessionResponse.status, 201); createdExamSessionIds.push(validSession.data.id);
  await db.examSession.update({ where: { id: validSession.data.id }, data: { startedAt: new Date(Date.now() - 120_000) } });
  const saveResponse = await api(`/api/exam-sessions/${validSession.data.id}`, { method: "PATCH", cookie: studentCookie, body: JSON.stringify({ questionId: fiveBody.data.items[0].id, selected: 0, durationSeconds: 15 }) }); assert.equal(saveResponse.status, 200);
  const activeResponse = await api("/api/exam-sessions", { cookie: studentCookie }); const active = await activeResponse.json(); assert.equal(active.data.id, validSession.data.id); assert.equal(active.data.answers[fiveBody.data.items[0].id], 0); assert.equal(typeof active.data.questionDurations[fiveBody.data.items[0].id], "number");
  const concurrentSaves = await Promise.all(fiveBody.data.items.slice(0, 2).map((item, index) => api(`/api/exam-sessions/${validSession.data.id}`, { method: "PATCH", cookie: studentCookie, body: JSON.stringify({ questionId: item.id, selected: 0, durationSeconds: index + 1 }) })));
  assert.equal(concurrentSaves.every((item) => item.status === 200), true);
  const afterConcurrentResponse = await api("/api/exam-sessions", { cookie: studentCookie });
  const afterConcurrent = await afterConcurrentResponse.json();
  assert.equal(fiveBody.data.items.slice(0, 2).every((item) => afterConcurrent.data.answers[item.id] === 0), true, "并发保存不同题目时不得互相覆盖答案");
  assert.equal(Object.keys(afterConcurrent.data.answers).length, 2);

  let inFlightSave;
  let inFlightSubmit;
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ExamSession" WHERE "id" = ${validSession.data.id} FOR UPDATE`;
    inFlightSave = api(`/api/exam-sessions/${validSession.data.id}`, {
      method: "PATCH",
      cookie: studentCookie,
      body: JSON.stringify({ questionId: fiveBody.data.items[2].id, selected: 0 }),
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    inFlightSubmit = api("/api/exams/submit", {
      method: "POST",
      cookie: studentCookie,
      body: JSON.stringify({ answers: fiveBody.data.items.slice(0, 2).map((item) => ({ questionId: item.id, selected: 0 })), duration: 120, questionDurations: { [fiveBody.data.items[0].id]: 90, [fiveBody.data.items[1].id]: 30 }, sessionId: validSession.data.id }),
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
  });
  const [inFlightSaveResponse, response] = await Promise.all([
    inFlightSave,
    inFlightSubmit,
  ]);
  assert.equal(inFlightSaveResponse.status, 200, "先进入数据库等待的合法答案保存必须成功");
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.answered, 3, "交卷必须读取行锁内的最新答案，不能用旧快照覆盖在途保存");
  assert.equal(typeof body.data.correct, "number");
  assert.equal(body.data.attemptIds.length, 3);
  assert.equal(body.data.report.mode, "EXAM");
  assert.equal(body.data.report.total, 5);
  assert.equal(body.data.report.questionReviews.length, 5, "模拟考试结算必须返回全部逐题解析");
  assert.equal(body.data.report.questionReviews.every((item) => typeof item.correctAnswer === "number" && typeof item.explanation === "string"), true);
  assert.ok(body.data.report.durationSeconds >= 120 && body.data.report.durationSeconds <= 125);
  assert.equal(body.data.report.evaluationStatus, "PENDING");
  createdTrainingReportIds.push(body.data.report.id);
  createdAttemptIds.push(...body.data.attemptIds);
  const rows = await db.attempt.findMany({ where: { id: { in: body.data.attemptIds } } });
  assert.equal(rows.every((item) => item.mode === "EXAM"), true);
  assert.deepEqual(rows.map((item) => item.duration).sort((a, b) => a - b), [0, 30, 90]);
  const repeatedResponse = await api("/api/exams/submit", { method: "POST", cookie: studentCookie, body: JSON.stringify({ answers: fiveBody.data.items.slice(0, 2).map((item) => ({ questionId: item.id, selected: 0 })), duration: 120, questionDurations: {}, sessionId: validSession.data.id }) });
  const repeated = await repeatedResponse.json();
  assert.equal(repeatedResponse.status, 200);
  assert.equal(repeated.data.report.id, body.data.report.id, "重复交卷必须返回同一份报告");
  const afterSubmit = await api("/api/exam-sessions", { cookie: studentCookie }); const afterBody = await afterSubmit.json(); assert.equal(afterBody.data, null);
});

test("SESSION-PAUSE-001：专项与模考暂停应持久化、阻止作答并扣除暂停用时", async () => {
  const questionResponse = await api("/api/questions/session?count=5", { cookie: studentCookie });
  const questionBody = await questionResponse.json();
  const items = questionBody.data.items;

  const practiceResponse = await api("/api/practice-sessions", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({ questionIds: items.map((item) => item.id), config: { count: 5, minDifficulty: 1, maxDifficulty: 10 } }),
  });
  const practice = await practiceResponse.json();
  assert.equal(practiceResponse.status, 201);
  createdPracticeSessionIds.push(practice.data.id);
  await db.practiceSession.update({ where: { id: practice.data.id }, data: { startedAt: new Date(Date.now() - 120_000) } });
  const pausePractice = await api(`/api/practice-sessions/${practice.data.id}`, { method: "PATCH", cookie: studentCookie, body: JSON.stringify({ paused: true }) });
  assert.equal(pausePractice.status, 200);
  const blockedPractice = await api(`/api/questions/${items[0].id}`, { method: "POST", cookie: studentCookie, body: JSON.stringify({ selected: 0, duration: 10, practiceSessionId: practice.data.id }) });
  const blockedPracticeBody = await blockedPractice.json();
  assert.equal(blockedPractice.status, 409);
  assert.equal(blockedPracticeBody.error?.code, "SESSION_PAUSED");
  const restoredPractice = await api("/api/practice-sessions", { cookie: studentCookie }).then((response) => response.json());
  assert.equal(restoredPractice.data.paused, true, "刷新恢复接口必须保留暂停状态");
  await db.practiceSession.update({ where: { id: practice.data.id }, data: { pausedAt: new Date(Date.now() - 60_000) } });
  const resumePractice = await api(`/api/practice-sessions/${practice.data.id}`, { method: "PATCH", cookie: studentCookie, body: JSON.stringify({ paused: false }) });
  const resumedPractice = await resumePractice.json();
  assert.equal(resumePractice.status, 200);
  assert.equal(resumedPractice.data.paused, false);
  assert.ok(resumedPractice.data.pausedDurationSeconds >= 59);
  await api(`/api/practice-sessions/${practice.data.id}`, { method: "PATCH", cookie: studentCookie, body: JSON.stringify({ status: "ABANDONED" }) });

  const examResponse = await api("/api/exam-sessions", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({ questionIds: items.map((item) => item.id), durationMinutes: 10, paperDifficulty: questionBody.data.paperDifficulty, config: { questionCount: 5 } }),
  });
  const exam = await examResponse.json();
  assert.equal(examResponse.status, 201);
  createdExamSessionIds.push(exam.data.id);
  await db.examSession.update({ where: { id: exam.data.id }, data: { startedAt: new Date(Date.now() - 180_000) } });
  const pauseExam = await api(`/api/exam-sessions/${exam.data.id}`, { method: "PATCH", cookie: studentCookie, body: JSON.stringify({ paused: true }) });
  assert.equal(pauseExam.status, 200);
  const blockedExam = await api(`/api/exam-sessions/${exam.data.id}`, { method: "PATCH", cookie: studentCookie, body: JSON.stringify({ questionId: items[0].id, selected: 0 }) });
  const blockedExamBody = await blockedExam.json();
  assert.equal(blockedExam.status, 409);
  assert.equal(blockedExamBody.error?.code, "SESSION_PAUSED");
  await db.examSession.update({ where: { id: exam.data.id }, data: { pausedAt: new Date(Date.now() - 60_000) } });
  const resumeExam = await api(`/api/exam-sessions/${exam.data.id}`, { method: "PATCH", cookie: studentCookie, body: JSON.stringify({ paused: false }) });
  const resumedExam = await resumeExam.json();
  assert.equal(resumeExam.status, 200);
  assert.ok(
    resumedExam.data.pausedDurationSeconds >= 59 && resumedExam.data.pausedDurationSeconds <= 62,
    `累计暂停应约为60秒：${JSON.stringify(resumedExam.data)}`,
  );
  const resumedSave = await api(`/api/exam-sessions/${exam.data.id}`, { method: "PATCH", cookie: studentCookie, body: JSON.stringify({ questionId: items[0].id, selected: 0, durationSeconds: 120 }) });
  assert.equal(resumedSave.status, 200, "继续后应恢复作答和计时保存");
  const savedTiming = await db.examSession.findUnique({ where: { id: exam.data.id }, select: { startedAt: true, pausedAt: true, pausedDurationSeconds: true, questionDurations: true } });
  assert.ok(savedTiming.questionDurations[items[0].id] >= 118, `暂停后有效逐题用时应可保存：${JSON.stringify(savedTiming)}`);
  const submitResponse = await api("/api/exams/submit", { method: "POST", cookie: studentCookie, body: JSON.stringify({ answers: [], duration: 999, questionDurations: {}, sessionId: exam.data.id }) });
  const submitted = await submitResponse.json();
  assert.equal(submitResponse.status, 200);
  assert.ok(submitted.data.report.durationSeconds >= 118 && submitted.data.report.durationSeconds <= 123, `有效用时应约为120秒，实际 ${submitted.data.report.durationSeconds}`);
  createdTrainingReportIds.push(submitted.data.report.id);
  createdAttemptIds.push(...submitted.data.attemptIds);
});

test("EXAM-003：服务端截止后不得再保存或计入新增答案", async () => {
  const questionResponse = await api("/api/questions/session?count=5", { cookie: studentCookie });
  const questionBody = await questionResponse.json();
  const items = questionBody.data.items;
  const sessionResponse = await api("/api/exam-sessions", { method: "POST", cookie: studentCookie, body: JSON.stringify({ questionIds: items.map((item) => item.id), durationMinutes: 5, paperDifficulty: questionBody.data.paperDifficulty, config: { questionCount: 5 } }) });
  const exam = await sessionResponse.json();
  assert.equal(sessionResponse.status, 201);
  createdExamSessionIds.push(exam.data.id);
  await db.examSession.update({ where: { id: exam.data.id }, data: { startedAt: new Date(Date.now() - 301_000) } });
  const lateSave = await api(`/api/exam-sessions/${exam.data.id}`, { method: "PATCH", cookie: studentCookie, body: JSON.stringify({ questionId: items[0].id, selected: 0, durationSeconds: 10 }) });
  const lateSaveBody = await lateSave.json();
  assert.equal(lateSave.status, 409);
  assert.equal(lateSaveBody.error?.code, "EXAM_EXPIRED");
  const submitResponse = await api("/api/exams/submit", { method: "POST", cookie: studentCookie, body: JSON.stringify({ answers: [{ questionId: items[0].id, selected: 0 }], duration: 300, questionDurations: { [items[0].id]: 600 }, sessionId: exam.data.id }) });
  const submitted = await submitResponse.json();
  assert.equal(submitResponse.status, 200);
  assert.equal(submitted.data.answered, 0, "截止后才提交的答案不得计入成绩");
  assert.equal(submitted.data.report.durationSeconds, 300);
  assert.equal(submitted.data.attemptIds.length, 0);
  assert.equal(
    submitted.data.report.questionDurations[items[0].id],
    300,
    "自动交卷时当前题最后一段用时应进入报告，但不得生成作答记录或突破考试总时长",
  );
  assert.ok(
    Object.values(submitted.data.report.questionDurations).reduce(
      (sum, value) => sum + value,
      0,
    ) <= submitted.data.report.durationSeconds,
    "客户端逐题用时必须被服务端归一化到考试总时长内",
  );
  createdTrainingReportIds.push(submitted.data.report.id);
});

test("ESSAY-001：学员可以读取申论材料并提交作答反馈", async () => {
  const listResponse = await api("/api/essays", { cookie: studentCookie });
  const list = await listResponse.json();
  assert.equal(listResponse.status, 200);
  assert.ok(list.data.length >= 3);
  const question = list.data[0].questions[0];
  const content = "材料反映出数字技能不足、平台适配不足、线上流程复杂、线下服务不足等问题。应优化平台设计，保留人工服务，加强人员培训和社区教学，并推动多方协同。";
  const submitResponse = await api(`/api/essays/questions/${question.id}/submit`, { method: "POST", cookie: studentCookie, body: JSON.stringify({ content }) });
  const submitted = await submitResponse.json();
  assert.equal(submitResponse.status, 201);
  assert.equal(typeof submitted.data.score, "number");
  assert.equal(typeof submitted.data.feedback.referenceAnswer, "string");
  createdEssaySubmissionIds.push(submitted.data.id);
});

test("PLAN-001：旧版规划请求应继续兼容并持久化 V2 策略与检查点", async () => {
  const disableModel = await api("/api/admin/model-config", { method: "PUT", cookie: modelAdminCookie, body: JSON.stringify({ enabled: false, clearApiKey: true, model: "", baseUrl: "https://api.openai.com/v1" }) });
  assert.equal(disableModel.status, 200);
  const response = await api("/api/study-plan", { method: "POST", cookie: studentCookie, body: JSON.stringify({ targetExam: "2027国考", dailyMinutes: 80, weeklyDays: 6, currentLevel: "强化阶段", focus: "数量关系", notes: "周末安排模拟考试" }) });
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.data.tasks.length, 6);
  assert.equal(new Set(body.data.tasks.map((item) => item.day)).size, 6);
  assert.equal(typeof body.data.summary, "string");
  assert.match(body.data.summary, /数量关系/);
  assert.match(body.data.summary, /80/);
  assert.equal(body.data.schemaVersion, 4);
  assert.equal(body.data.source, "DATA_RULES");
  assert.equal(body.data.strategy.phase, "强化阶段");
  assert.ok(body.data.strategy.objective.includes("数量关系"));
  assert.ok(body.data.strategy.adjustmentRules.length >= 2);
  assert.ok(body.data.tasks.every((item) => typeof item.checkpoint === "string" && item.checkpoint.length > 0));
  assert.ok(body.data.tasks.every((item) => item.completionSpec?.version === 1));
  assert.ok(body.data.tasks.every((item) => item.minutes <= 80));
  assert.equal(body.data.inputSnapshot.preferences.weeklyDays, 6);
  assert.equal(body.data.inputSnapshot.preferences.focus, "数量关系");
  assert.equal(body.data.inputSnapshot.preferences.notes, "周末安排模拟考试");
  assert.equal(body.data.generationMeta.sampledAttempts, body.data.inputSnapshot.performance.sampledAttempts);
  createdStudyPlanIds.push(body.data.id);
  const getResponse = await api("/api/study-plan", { cookie: studentCookie });
  const latest = await getResponse.json();
  assert.equal(latest.data.id, body.data.id);
  assert.deepEqual(latest.data.strategy, body.data.strategy);
  assert.deepEqual(latest.data.tasks, body.data.tasks);
});

test("PLAN-003：结构化个性偏好应完整持久化并约束规则规划", async () => {
  const preferences = {
    targetExam: "广东省考",
    examWindow: "ONE_TO_THREE_MONTHS",
    dailyMinutes: 80,
    weeklyDays: 4,
    currentLevel: "强化阶段",
    studyStatus: "REINFORCEMENT",
    activeWeekdays: ["MON", "WED", "FRI", "SUN"],
    studyWindows: ["WEEKDAY_EVENING", "WEEKEND_MORNING"],
    focusAreas: ["数量关系", "资料分析"],
    learningGoal: "WEAKNESSES",
    learningMethods: ["METHOD_FIRST", "TIMED_SETS", "FULL_MOCK"],
    intensity: "BALANCED",
    mockExamPreference: "WEEKLY",
    essayPreference: "WEEKLY",
    minTasksPerDay: 2,
    maxTasksPerDay: 3,
    maxQuestionsPerTask: 15,
    acceptanceMethods: ["SYSTEM", "SELF"],
    constraints: ["NO_EARLY_MORNING", "KEEP_ONE_REST_DAY", "BALANCE_DAILY_TASKS"],
  };
  const response = await api("/api/study-plan", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify(preferences),
  });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.data.source, "DATA_RULES");
  for (const [key, value] of Object.entries(preferences))
    assert.deepEqual(body.data.inputSnapshot.preferences[key], value, `偏好 ${key} 应原样进入规划快照`);

  const tasksByDay = new Map();
  for (const task of body.data.tasks) {
    tasksByDay.set(task.day, [...(tasksByDay.get(task.day) || []), task]);
    if (task.type !== "EXAM")
      assert.ok(task.minutes <= preferences.dailyMinutes, `日常任务 ${task.title} 不得超过每日预算`);
    if (task.type !== "EXAM" && typeof task.questionCount === "number")
      assert.ok(task.questionCount <= preferences.maxQuestionsPerTask, `单项任务 ${task.title} 不得超过 ${preferences.maxQuestionsPerTask} 题`);
    if (task.completionSpec?.kind === "PRACTICE") {
      assert.equal(task.completionSpec.launch.durationMinutes, task.minutes);
      assert.ok(task.completionSpec.maxElapsedSeconds > task.minutes * 60, "验收最长用时应宽于规划建议时间");
      if (task.completionSpec.minAccuracy !== null)
        assert.match(task.target, new RegExp(`正确率≥${task.completionSpec.minAccuracy}%`));
      assert.match(task.target, new RegExp(`验收用时≤${Math.round(task.completionSpec.maxElapsedSeconds / 60)}分钟`));
    }
  }
  assert.ok(
    [...tasksByDay.values()].every((tasks) => {
      const formalExamDay = tasks.some((task) => task.type === "EXAM");
      return formalExamDay
        ? tasks.length === 1
        : tasks.length >= preferences.minTasksPerDay && tasks.length <= preferences.maxTasksPerDay;
    }),
    "每个普通学习日的任务数必须位于用户范围内，正式模考日单独成日",
  );
  const ordinaryCounts = [...tasksByDay.values()]
    .filter((tasks) => !tasks.some((task) => task.type === "EXAM"))
    .map((tasks) => tasks.length);
  assert.ok(Math.max(...ordinaryCounts) - Math.min(...ordinaryCounts) <= 1, "均衡分配后普通学习日任务数最多相差1项");
  assert.ok(
    body.data.tasks.some(
      (task) =>
        task.type === "EXAM" &&
        task.completionSpec?.kind === "EXAM" &&
        task.completionSpec?.launch?.questionCount === 90 &&
        task.completionSpec?.launch?.durationMinutes === 90,
    ),
    "每周模考偏好必须落成广东省考固定题量和时长的正式卷",
  );
  assert.ok(body.data.tasks.some((task) => task.type === "ESSAY"), "每周申论偏好应在规则规划中落成申论任务");

  assert.match(body.data.strategy.objective, /数量关系/);
  assert.match(body.data.strategy.objective, /资料分析/);
  const quantityTask = body.data.tasks.find(
    (task) =>
      String(task.module || "").startsWith("数量关系 / ") &&
      task.completionSpec?.kind === "PRACTICE",
  );
  const materialTask = body.data.tasks.find(
    (task) =>
      String(task.module || "").startsWith("资料分析 / ") &&
      task.completionSpec?.kind === "PRACTICE",
  );
  assert.ok(quantityTask, "数量关系任务应精确到细分题型");
  assert.ok(materialTask, "资料分析任务应精确到细分题型");
  for (const task of [quantityTask, materialTask]) {
    assert.ok(
      task.completionSpec?.kind === "PRACTICE" && task.completionSpec.launch.scopes?.length > 0,
      `任务 ${task.module} 的启动规格应包含细分板块 scopes`,
    );
  }
  assert.ok(
    quantityTask.completionSpec.maxElapsedSeconds >= quantityTask.minutes * 60 * 1.6,
    "数量关系验收应至少保留60%的时间余量",
  );
  assert.ok(
    materialTask.completionSpec.maxElapsedSeconds >= materialTask.minutes * 60 * 1.5,
    "资料分析验收应至少保留50%的时间余量",
  );
  assert.equal(
    body.data.tasks.some((task) => String(task.module || "").includes("数量关系、资料分析")),
    false,
    "多个重点板块不得拼接为不存在的伪模块",
  );
  assert.equal(JSON.stringify(body.data.tasks).includes("数量关系、资料分析方法"), false);
  createdStudyPlanIds.push(body.data.id);
});

test("PLAN-004：规划接口应拒绝非法枚举、重复多选和超出上限的重点", async () => {
  const invalidInputs = [
    { intensity: "EXTREME" },
    { focusAreas: ["数量关系", "数量关系"] },
    { focusAreas: ["AUTO", "数量关系"] },
    { focusAreas: ["政治理论", "数量关系", "判断推理", "资料分析"] },
    { activeWeekdays: ["MON", "MON"] },
    { learningMethods: ["METHOD_FIRST", "METHOD_FIRST"] },
    { acceptanceMethods: [] },
    { acceptanceMethods: ["SYSTEM", "SYSTEM"] },
    { minTasksPerDay: 4, maxTasksPerDay: 2 },
    { maxTasksPerDay: 22 },
    { maxQuestionsPerTask: 4 },
  ];
  for (const input of invalidInputs) {
    const response = await api("/api/study-plan", {
      method: "POST",
      cookie: studentCookie,
      body: JSON.stringify(input),
    });
    const body = await response.json();
    assert.equal(response.status, 400, `非法偏好应返回 400：${JSON.stringify(input)} => ${JSON.stringify(body)}`);
    assert.equal(body.error?.code, "INVALID_INPUT");
  }
});

test("PLAN-004A：无限单日任务和验收方式应进入计划硬约束", async () => {
  const systemResponse = await api("/api/study-plan", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({
      targetExam: "验收偏好测试",
      dailyMinutes: 120,
      weeklyDays: 2,
      activeWeekdays: ["MON", "WED"],
      minTasksPerDay: 1,
      maxTasksPerDay: 3,
      maxTaskMinutes: 30,
      maxQuestionsPerTask: 10,
      acceptanceMethods: ["SYSTEM"],
      mockExamPreference: "NONE",
      essayPreference: "NONE",
    }),
  });
  const system = await systemResponse.json();
  assert.equal(systemResponse.status, 201, JSON.stringify(system));
  createdStudyPlanIds.push(system.data.id);
  assert.equal(system.data.inputSnapshot.preferences.minTasksPerDay, 1);
  assert.equal(system.data.inputSnapshot.preferences.maxTasksPerDay, 3);
  assert.equal(system.data.inputSnapshot.preferences.maxTaskMinutes, undefined, "旧客户端单项时间字段不得进入模型上下文");
  assert.ok(system.data.tasks.some((task) => task.completionSpec?.method === "PROGRAM"));
  assert.ok(system.data.tasks.every((task) =>
    task.completionSpec?.method === "PROGRAM" || task.completionSpec?.method === "NONE"
  ));
  assert.ok(system.data.tasks.every((task) =>
    task.type === "EXAM" || typeof task.questionCount !== "number" || task.questionCount <= 10
  ));

  const selfResponse = await api("/api/study-plan", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({
      targetExam: "自验收偏好测试",
      weeklyDays: 1,
      activeWeekdays: ["FRI"],
      acceptanceMethods: ["SELF"],
      maxQuestionsPerTask: 10,
      mockExamPreference: "NONE",
      essayPreference: "NONE",
    }),
  });
  const self = await selfResponse.json();
  assert.equal(selfResponse.status, 201, JSON.stringify(self));
  createdStudyPlanIds.push(self.data.id);
  assert.ok(self.data.tasks.some((task) => task.completionSpec?.method === "SELF"));
  assert.ok(self.data.tasks.every((task) =>
    task.completionSpec?.method === "SELF" || task.completionSpec?.method === "NONE"
  ));
});

test("PLAN-004B：每周两次模考必须生成两场正式固定卷任务", async () => {
  const response = await api("/api/study-plan", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({
      targetExam: "国家公务员考试（地市级）",
      dailyMinutes: 60,
      activeWeekdays: ["MON", "WED", "FRI", "SUN"],
      minTasksPerDay: 1,
      maxTasksPerDay: 2,
      mockExamPreference: "TWICE_WEEKLY",
      essayPreference: "NONE",
      acceptanceMethods: ["SYSTEM", "SELF"],
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  createdStudyPlanIds.push(body.data.id);
  const exams = body.data.tasks.filter((task) => task.type === "EXAM");
  assert.equal(exams.length, 2);
  assert.equal(new Set(exams.map((task) => task.day)).size, 2);
  assert.ok(exams.every((task) =>
    task.minutes === 120 &&
    task.questionCount === 130 &&
    task.completionSpec?.kind === "EXAM" &&
    task.completionSpec.launch.questionCount === 130 &&
    task.completionSpec.launch.durationMinutes === 120
  ));
});

test("PLAN-005：任务打卡应先完成双重验收、持久化快照并支持幂等与撤销", async () => {
  const planResponse = await api("/api/study-plan", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({
      targetExam: "任务验收自动化测试",
      dailyMinutes: 60,
      weeklyDays: 1,
      activeWeekdays: ["MON"],
      focusAreas: ["数量关系", "资料分析"],
      mockExamPreference: "NONE",
      essayPreference: "NONE",
      maxTasksPerDay: 1,
      maxTaskMinutes: 45,
    }),
  });
  const generated = await planResponse.json();
  assert.equal(planResponse.status, 201, JSON.stringify(generated));
  createdStudyPlanIds.push(generated.data.id);
  const task = {
    ...generated.data.tasks[0],
    type: "KNOWLEDGE",
    completionSpec: {
      version: 1,
      kind: "SELF",
      method: "SELF",
      launch: { kind: "NONE" },
      evidence: { kind: "SELF_CONFIRMATION" },
    },
  };
  generated.data.tasks[0] = task;
  await db.studyPlan.update({
    where: { id: generated.data.id },
    data: { tasks: generated.data.tasks },
  });
  const generatedTaskIds = generated.data.tasks.map((item) => item.id);
  assert.deepEqual(
    generatedTaskIds,
    generated.data.tasks.map((_, index) => `task-${String(index + 1).padStart(2, "0")}`),
    "新计划必须为每项任务生成稳定且有序的 task.id",
  );
  assert.equal(new Set(generatedTaskIds).size, generatedTaskIds.length);
  assert.ok(task?.title);
  assert.ok(task?.target);
  assert.ok(task?.checkpoint);
  const initialGetResponse = await api("/api/study-plan", { cookie: studentCookie });
  const initialGet = await initialGetResponse.json();
  assert.equal(initialGetResponse.status, 200);
  assert.deepEqual(initialGet.data.checkIns, []);

  const incompleteConfirmations = [
    { taskCompleted: true, checkpointMet: false },
    { taskCompleted: false, checkpointMet: true },
  ];
  for (const confirmations of incompleteConfirmations) {
    const rejectedResponse = await api("/api/study-plan/check-ins", {
      method: "POST",
      cookie: studentCookie,
      body: JSON.stringify({
        planId: generated.data.id,
        taskIndex: 0,
        taskKey: task.id,
        confirmations,
      }),
    });
    const rejected = await rejectedResponse.json();
    assert.equal(
      rejectedResponse.status,
      400,
      `未通过全部验收步骤时不得完成打卡：${JSON.stringify(rejected)}`,
    );
    assert.equal(typeof rejected.error?.message, "string");
  }
  assert.equal(
    await db.studyPlanCheckIn.count({ where: { planId: generated.data.id } }),
    0,
    "任何未通过完整验收的请求都不得留下打卡记录",
  );

  const checkInPayload = {
    planId: generated.data.id,
    taskIndex: 0,
    taskKey: task.id,
    confirmations: { taskCompleted: true, checkpointMet: true },
  };
  const unauthorizedResponse = await api("/api/study-plan/check-ins", {
    method: "POST",
    body: JSON.stringify(checkInPayload),
  });
  assert.equal(unauthorizedResponse.status, 401);
  const foreignResponse = await api("/api/study-plan/check-ins", {
    method: "POST",
    cookie: registeredCookie,
    body: JSON.stringify(checkInPayload),
  });
  assert.equal(foreignResponse.status, 404, "其他用户不得探测或打卡当前用户的规划任务");
  const checkInIdentity = {
    planId: generated.data.id,
    taskIndex: 0,
    taskKey: task.id,
  };
  const unauthorizedDeleteResponse = await api("/api/study-plan/check-ins", {
    method: "DELETE",
    body: JSON.stringify(checkInIdentity),
  });
  assert.equal(unauthorizedDeleteResponse.status, 401);
  const foreignDeleteResponse = await api("/api/study-plan/check-ins", {
    method: "DELETE",
    cookie: registeredCookie,
    body: JSON.stringify(checkInIdentity),
  });
  assert.equal(foreignDeleteResponse.status, 404, "其他用户不得探测或撤销当前用户的打卡");
  const mismatchedKeyResponse = await api("/api/study-plan/check-ins", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({ ...checkInPayload, taskKey: "task-99" }),
  });
  assert.equal(mismatchedKeyResponse.status, 404, "taskKey 与 taskIndex 不一致时必须拒绝打卡");

  const firstResponse = await api("/api/study-plan/check-ins", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify(checkInPayload),
  });
  const first = await firstResponse.json();
  assert.equal(firstResponse.status, 200, JSON.stringify(first));

  const firstGetResponse = await api("/api/study-plan", { cookie: studentCookie });
  const firstGet = await firstGetResponse.json();
  assert.equal(firstGetResponse.status, 200);
  assert.equal(firstGet.data.id, generated.data.id);
  assert.equal(firstGet.data.checkIns.length, 1);
  assert.equal(firstGet.data.checkIns[0].taskIndex, 0);
  assert.equal(firstGet.data.checkIns[0].taskKey, task.id);
  assert.equal(firstGet.data.checkIns[0].acceptanceMethod, "SELF_CONFIRMED");
  assert.equal(firstGet.data.checkIns[0].taskTitle, task.title);
  assert.equal(firstGet.data.checkIns[0].targetSnapshot, task.target);
  assert.equal(firstGet.data.checkIns[0].checkpointSnapshot, task.checkpoint);
  assert.equal(Number.isNaN(Date.parse(firstGet.data.checkIns[0].completedAt)), false);
  const completedAt = firstGet.data.checkIns[0].completedAt;

  const duplicateResponses = await Promise.all(
    Array.from({ length: 2 }, () =>
      api("/api/study-plan/check-ins", {
        method: "POST",
        cookie: studentCookie,
        body: JSON.stringify(checkInPayload),
      }),
    ),
  );
  assert.equal(
    duplicateResponses.every((response) => response.status === 200),
    true,
    "并发重复验收应幂等成功",
  );
  const duplicateGetResponse = await api("/api/study-plan", { cookie: studentCookie });
  const duplicateGet = await duplicateGetResponse.json();
  const sameTaskCheckIns = duplicateGet.data.checkIns.filter(
    (item) => item.taskIndex === 0 && item.taskKey === task.id,
  );
  assert.equal(sameTaskCheckIns.length, 1, "重复打卡不得生成重复记录");
  assert.equal(sameTaskCheckIns[0].completedAt, completedAt, "幂等重试不得篡改原完成时间");

  const stored = await db.studyPlan.findUnique({
    where: { id: generated.data.id },
    select: { checkIns: true },
  });
  assert.equal(stored?.checkIns.length, 1, "打卡状态必须持久化到数据库");
  assert.equal(stored?.checkIns[0].taskTitle, task.title);
  assert.equal(stored?.checkIns[0].taskKey, task.id);
  assert.equal(stored?.checkIns[0].acceptanceMethod, "SELF_CONFIRMED");
  assert.equal(stored?.checkIns[0].checkpointSnapshot, task.checkpoint);
  assert.equal(stored?.checkIns[0].completedAt.toISOString(), completedAt);

  const undoResponse = await api("/api/study-plan/check-ins", {
    method: "DELETE",
    cookie: studentCookie,
    body: JSON.stringify({ planId: generated.data.id, taskIndex: 0, taskKey: task.id }),
  });
  const undone = await undoResponse.json();
  assert.equal(undoResponse.status, 200, JSON.stringify(undone));
  const afterUndoResponse = await api("/api/study-plan", { cookie: studentCookie });
  const afterUndo = await afterUndoResponse.json();
  assert.equal(afterUndo.data.checkIns.some((item) => item.taskKey === task.id), false);
});

test("PLAN-006：旧计划应获得稳定 legacy taskKey 且 REST 任务不可打卡", async () => {
  const legacyTasks = [
    {
      day: 1,
      title: "旧计划数量关系训练",
      type: "PRACTICE",
      target: "完成十道数量关系题",
      minutes: 30,
      reason: "验证旧计划兼容",
      priority: "HIGH",
      checkpoint: "正确率达到 70%",
    },
    {
      day: 2,
      title: "旧计划休息日",
      type: "rest",
      target: "休息并调整状态",
      minutes: 10,
      reason: "避免连续高强度训练",
      priority: "LOW",
      checkpoint: "完成休整",
    },
  ];
  const legacyPlan = await db.studyPlan.create({
    data: {
      userId: studentId,
      title: "旧计划 taskKey 兼容测试",
      source: "DATA_RULES",
      summary: "验证旧任务在没有 id 时仍有稳定键。",
      tasks: legacyTasks,
      strategy: null,
      schemaVersion: 2,
      inputSnapshot: {},
      generationMeta: { source: "DATA_RULES" },
      generatedAt: new Date(Date.now() + 60_000),
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    },
  });
  createdStudyPlanIds.push(legacyPlan.id);

  const getResponse = await api("/api/study-plan", { cookie: studentCookie });
  const loaded = await getResponse.json();
  assert.equal(getResponse.status, 200);
  assert.equal(loaded.data.id, legacyPlan.id);
  assert.deepEqual(loaded.data.tasks.map((item) => item.id), ["legacy-01", "legacy-02"]);

  const legacyPayload = {
    planId: legacyPlan.id,
    taskIndex: 0,
    taskKey: "legacy-01",
    confirmations: { taskCompleted: true, checkpointMet: true },
  };
  const completeResponse = await api("/api/study-plan/check-ins", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify(legacyPayload),
  });
  const completed = await completeResponse.json();
  assert.equal(completeResponse.status, 200, JSON.stringify(completed));
  assert.equal(completed.data.taskKey, "legacy-01");
  assert.equal(completed.data.acceptanceMethod, "SELF_CONFIRMED");

  const changedCheckpoint = "正确率达到 80%，并完成错因记录";
  await db.studyPlan.update({
    where: { id: legacyPlan.id },
    data: {
      tasks: [
        { ...legacyTasks[0], checkpoint: changedCheckpoint },
        legacyTasks[1],
      ],
    },
  });
  const refreshedResponse = await api("/api/study-plan/check-ins", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify(legacyPayload),
  });
  const refreshed = await refreshedResponse.json();
  assert.equal(refreshedResponse.status, 200, JSON.stringify(refreshed));
  assert.equal(refreshed.data.checkpointSnapshot, changedCheckpoint);
  assert.equal(
    await db.studyPlanCheckIn.count({ where: { planId: legacyPlan.id } }),
    1,
    "任务标准变化后应更新验收快照而不是留下重复记录",
  );

  const restResponse = await api("/api/study-plan/check-ins", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({
      planId: legacyPlan.id,
      taskIndex: 1,
      taskKey: "legacy-02",
      confirmations: { taskCompleted: true, checkpointMet: true },
    }),
  });
  assert.equal(restResponse.status, 409, "REST 任务应明确返回无需打卡的冲突状态");
  assert.equal(
    await db.studyPlanCheckIn.count({ where: { planId: legacyPlan.id, taskKey: "legacy-02" } }),
    0,
  );

  const undoResponse = await api("/api/study-plan/check-ins", {
    method: "DELETE",
    cookie: studentCookie,
    body: JSON.stringify({ planId: legacyPlan.id, taskIndex: 0, taskKey: "legacy-01" }),
  });
  assert.equal(undoResponse.status, 200);
});

test("PLAN-007：程序验收应使用绑定证据、核算完整五题材料组并保证并发幂等", async () => {
  const materials = await db.questionMaterial.findMany({
    where: { questions: { some: { status: "PUBLISHED" } } },
    select: {
      questions: {
        where: { status: "PUBLISHED" },
        select: { id: true, answer: true, difficultyScore: true },
        orderBy: [{ materialOrder: "asc" }, { id: "asc" }],
      },
    },
    take: 100,
  });
  const materialQuestions = materials.find((item) => item.questions.length === 5)?.questions;
  assert.equal(materialQuestions?.length, 5, "测试题库应至少包含一组完整资料分析材料");

  const taskKey = `program-material-${Date.now()}`;
  const completionSpec = {
    version: 1,
    kind: "PRACTICE",
    method: "PROGRAM",
    launch: {
      kind: "PRACTICE",
      questionCount: 5,
      category: "资料分析",
      questionPool: null,
      minDifficulty: 1,
      maxDifficulty: 10,
      durationMinutes: 5,
    },
    evidence: { kind: "TRAINING_REPORT", mode: "PRACTICE" },
    minAnswered: 5,
    minAccuracy: 0,
    maxElapsedSeconds: 300,
    requiredModule: "资料分析",
    difficultyRange: { min: 1, max: 10 },
    minCompleteMaterialGroups: 1,
    requiredTemplateId: null,
  };
  const task = {
    id: taskKey,
    day: 1,
    title: "资料分析完整材料程序验收",
    type: "TIMED_PRACTICE",
    target: "完成一组完整资料分析材料",
    minutes: 5,
    reason: "验证服务端证据链",
    priority: "HIGH",
    checkpoint: "完整作答五题后由系统验收",
    module: "资料分析",
    difficulty: "1-10",
    questionCount: 5,
    completionSpec,
  };
  const plan = await db.studyPlan.create({
    data: {
      userId: studentId,
      title: "程序验收集成测试",
      source: "DATA_RULES",
      summary: "验证程序验收的绑定、差距、幂等和证据占用。",
      tasks: [task],
      strategy: null,
      schemaVersion: 4,
      inputSnapshot: {},
      generationMeta: { source: "DATA_RULES" },
      generatedAt: new Date(Date.now() - 600_000),
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  createdStudyPlanIds.push(plan.id);
  await db.studyPlan.updateMany({
    where: {
      id: {
        in: createdStudyPlanIds.filter((planId) => planId !== plan.id),
      },
    },
    data: { generatedAt: new Date("2000-01-01T00:00:00.000Z") },
  });
  const planContext = { planId: plan.id, taskKey, taskIndex: 0 };

  const bypassResponse = await api("/api/study-plan/check-ins", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({
      ...planContext,
      confirmations: { taskCompleted: true, checkpointMet: true },
    }),
  });
  const bypass = await bypassResponse.json();
  assert.equal(bypassResponse.status, 409);
  assert.equal(bypass.error?.code, "PROGRAM_ACCEPTANCE_REQUIRED");

  const invalidSessionResponse = await api("/api/practice-sessions", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({
      questionIds: materialQuestions.slice(0, 4).map((item) => item.id),
      planContext,
      config: { count: 4, category: "资料分析", minDifficulty: 1, maxDifficulty: 10 },
    }),
  });
  const invalidSession = await invalidSessionResponse.json();
  assert.equal(invalidSessionResponse.status, 409, JSON.stringify(invalidSession));
  assert.equal(invalidSession.error?.code, "PLAN_CONTEXT_MISMATCH");

  async function completeMaterialPractice(answerCount, title, elapsedSeconds = 20) {
    const sessionResponse = await api("/api/practice-sessions", {
      method: "POST",
      cookie: studentCookie,
      body: JSON.stringify({
        questionIds: materialQuestions.map((item) => item.id),
        planContext,
        config: { count: 5, category: "资料分析", minDifficulty: 1, maxDifficulty: 10 },
      }),
    });
    const practiceSession = await sessionResponse.json();
    assert.equal(sessionResponse.status, 201, JSON.stringify(practiceSession));
    createdPracticeSessionIds.push(practiceSession.data.id);
    await db.practiceSession.update({
      where: { id: practiceSession.data.id },
      data: { startedAt: new Date(Date.now() - elapsedSeconds * 1_000) },
    });
    for (const question of materialQuestions.slice(0, answerCount)) {
      const answerResponse = await api(`/api/questions/${question.id}`, {
        method: "POST",
        cookie: studentCookie,
        body: JSON.stringify({
          selected: question.answer,
          duration: 1,
          practiceSessionId: practiceSession.data.id,
        }),
      });
      const answer = await answerResponse.json();
      assert.equal(answerResponse.status, 200, JSON.stringify(answer));
      createdAttemptIds.push(answer.data.attemptId);
    }
    const reportResponse = await api("/api/training-reports", {
      method: "POST",
      cookie: studentCookie,
      body: JSON.stringify({ practiceSessionId: practiceSession.data.id, title }),
    });
    const report = await reportResponse.json();
    assert.equal(reportResponse.status, 201, JSON.stringify(report));
    createdTrainingReportIds.push(report.data.id);
    assert.equal(report.data.studyPlanId, plan.id);
    assert.equal(report.data.studyPlanTaskKey, taskKey);
    return report.data;
  }

  const partialReport = await completeMaterialPractice(4, "四题资料分析验收测试", 400);
  assert.ok(partialReport.durationSeconds < 300, "客户端逐题用时应小于服务端墙钟用时");
  const partialSession = await db.practiceSession.findUniqueOrThrow({
    where: { id: partialReport.practiceSessionId },
    select: { startedAt: true },
  });
  const originalExpiresAt = new Date(Date.now() + 86_400_000);
  await db.studyPlan.update({
    where: { id: plan.id },
    data: { expiresAt: new Date(partialSession.startedAt.getTime() + 1_000) },
  });
  const expiredEvidenceResponse = await api("/api/study-plan/check-ins/verify", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({ ...planContext, evidenceId: partialReport.id }),
  });
  const expiredEvidence = await expiredEvidenceResponse.json();
  assert.equal(expiredEvidenceResponse.status, 409, JSON.stringify(expiredEvidence));
  assert.equal(expiredEvidence.error?.code, "EVIDENCE_TIME_INVALID");
  await db.studyPlan.update({
    where: { id: plan.id },
    data: { expiresAt: originalExpiresAt },
  });
  const partialVerifyResponse = await api("/api/study-plan/check-ins/verify", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({ ...planContext, evidenceId: partialReport.id }),
  });
  const partialVerify = await partialVerifyResponse.json();
  assert.equal(partialVerifyResponse.status, 422, JSON.stringify(partialVerify));
  assert.equal(partialVerify.error?.code, "ACCEPTANCE_NOT_MET");
  assert.equal(partialVerify.error.details.actual.answered, 4);
  assert.equal(partialVerify.error.details.actual.completeMaterialGroups, 0);
  assert.ok(partialVerify.error.details.actual.elapsedSeconds >= 399);
  assert.ok(
    partialVerify.error.details.gaps.some((gap) => gap.code === "COMPLETE_MATERIAL_GROUPS"),
  );
  assert.ok(
    partialVerify.error.details.gaps.some((gap) => gap.code === "MAX_ELAPSED_SECONDS"),
    "限时验收必须使用服务端墙钟用时，不能信任客户端逐题用时",
  );

  const candidateResponse = await api(
    `/api/study-plan/check-ins/verify?planId=${encodeURIComponent(plan.id)}&taskKey=${encodeURIComponent(taskKey)}&taskIndex=0`,
    { cookie: studentCookie },
  );
  const candidate = await candidateResponse.json();
  assert.equal(candidateResponse.status, 200);
  assert.equal(candidate.data.evidence.id, partialReport.id);
  assert.equal(candidate.data.evidence.meetsCriteria, false);

  const completeReport = await completeMaterialPractice(5, "完整资料分析验收测试");
  const concurrentResponses = await Promise.all(
    Array.from({ length: 4 }, () =>
      api("/api/study-plan/check-ins/verify", {
        method: "POST",
        cookie: studentCookie,
        body: JSON.stringify({ ...planContext, evidenceId: completeReport.id }),
      }),
    ),
  );
  const concurrentBodies = await Promise.all(concurrentResponses.map((response) => response.json()));
  assert.ok(concurrentResponses.every((response) => response.status === 200), JSON.stringify(concurrentBodies));
  assert.equal(new Set(concurrentBodies.map((body) => body.data.id)).size, 1);
  assert.ok(concurrentBodies.every((body) => body.data.acceptanceMethod === "PROGRAM_VERIFIED"));
  assert.equal(
    await db.studyPlanEvidenceClaim.count({ where: { evidenceKey: `TRAINING_REPORT:${completeReport.id}` } }),
    1,
  );

  const changedTask = {
    ...task,
    completionSpec: { ...completionSpec, minAccuracy: 10 },
  };
  await db.studyPlan.update({
    where: { id: plan.id },
    data: { tasks: [changedTask], generatedAt: new Date() },
  });
  const refreshedPlanResponse = await api("/api/study-plan", { cookie: studentCookie });
  const refreshedPlan = await refreshedPlanResponse.json();
  assert.equal(refreshedPlanResponse.status, 200);
  assert.equal(refreshedPlan.data.id, plan.id);
  assert.deepEqual(refreshedPlan.data.checkIns, [], "规则哈希变化后旧程序验收必须失效");
  await db.studyPlan.update({
    where: { id: plan.id },
    data: { generatedAt: plan.generatedAt },
  });

  const reusedResponse = await api("/api/study-plan/check-ins/verify", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({ ...planContext, evidenceId: completeReport.id }),
  });
  const reused = await reusedResponse.json();
  assert.equal(reusedResponse.status, 409, JSON.stringify(reused));
  assert.equal(reused.error?.code, "EVIDENCE_ALREADY_USED");

  const replacementReport = await completeMaterialPractice(5, "规则变化后新证据验收测试");
  const replacementResponse = await api("/api/study-plan/check-ins/verify", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({ ...planContext, evidenceId: replacementReport.id }),
  });
  const replacement = await replacementResponse.json();
  assert.equal(replacementResponse.status, 200, JSON.stringify(replacement));
  assert.equal(replacement.data.evidenceId, replacementReport.id);
  assert.equal(await db.studyPlanEvidenceClaim.count({ where: { planId: plan.id } }), 2);

  const immutableResponse = await api("/api/study-plan/check-ins", {
    method: "DELETE",
    cookie: studentCookie,
    body: JSON.stringify(planContext),
  });
  const immutable = await immutableResponse.json();
  assert.equal(immutableResponse.status, 409);
  assert.equal(immutable.error?.code, "PROGRAM_CHECK_IN_IMMUTABLE");

  const driftedCheckpoint = "文本变化后必须重新完成程序验收";
  await db.studyPlan.update({
    where: { id: plan.id },
    data: {
      tasks: [
        {
          ...changedTask,
          checkpoint: driftedCheckpoint,
        },
      ],
    },
  });
  const driftedCandidateResponse = await api(
    `/api/study-plan/check-ins/verify?planId=${encodeURIComponent(plan.id)}&taskKey=${encodeURIComponent(taskKey)}&taskIndex=0`,
    { cookie: studentCookie },
  );
  const driftedCandidate = await driftedCandidateResponse.json();
  assert.equal(driftedCandidateResponse.status, 200, JSON.stringify(driftedCandidate));
  assert.equal(driftedCandidate.data.checkIn, null, "任务文本快照变化后 verify 不得返回旧打卡");

  const driftedReport = await completeMaterialPractice(5, "文本变化后的新证据验收测试");
  const driftedVerifyResponse = await api("/api/study-plan/check-ins/verify", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({ ...planContext, evidenceId: driftedReport.id }),
  });
  const driftedVerify = await driftedVerifyResponse.json();
  assert.equal(driftedVerifyResponse.status, 200, JSON.stringify(driftedVerify));
  assert.equal(driftedVerify.data.checkpointSnapshot, driftedCheckpoint);
  await db.studyPlan.update({
    where: { id: plan.id },
    data: { generatedAt: new Date() },
  });
  const driftedPlanResponse = await api("/api/study-plan", { cookie: studentCookie });
  const driftedPlan = await driftedPlanResponse.json();
  assert.equal(driftedPlanResponse.status, 200);
  assert.equal(driftedPlan.data.id, plan.id);
  assert.equal(driftedPlan.data.checkIns.length, 1);
  assert.equal(driftedPlan.data.checkIns[0].checkpointSnapshot, driftedCheckpoint);
  await db.studyPlan.update({
    where: { id: plan.id },
    data: { generatedAt: plan.generatedAt },
  });

  await db.studyPlan.update({
    where: { id: plan.id },
    data: {
      tasks: [
        {
          ...changedTask,
          type: "KNOWLEDGE",
          checkpoint: driftedCheckpoint,
          completionSpec: {
            version: 1,
            kind: "SELF",
            method: "SELF",
            launch: { kind: "NONE" },
            evidence: { kind: "SELF_CONFIRMATION" },
          },
        },
      ],
    },
  });
  const switchedToSelfResponse = await api("/api/study-plan/check-ins", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({
      ...planContext,
      confirmations: { taskCompleted: true, checkpointMet: true },
    }),
  });
  const switchedToSelf = await switchedToSelfResponse.json();
  assert.equal(switchedToSelfResponse.status, 200, JSON.stringify(switchedToSelf));
  assert.equal(switchedToSelf.data.acceptanceMethod, "SELF_CONFIRMED");
  assert.equal(switchedToSelf.data.evidenceId, null);
  assert.equal(
    await db.studyPlanEvidenceClaim.count({ where: { planId: plan.id } }),
    3,
    "切换验收方式不得释放历史程序证据占用",
  );

  const foreignResponse = await api("/api/study-plan/check-ins/verify", {
    method: "POST",
    cookie: registeredCookie,
    body: JSON.stringify({ ...planContext, evidenceId: replacementReport.id }),
  });
  assert.equal(foreignResponse.status, 404, "其他用户不得探测计划或证据");
});

test("PLAN-007A：普通专项中完成的精确匹配训练可用于系统验收", async () => {
  const directQuestions = await db.question.findMany({
    where: {
      status: "PUBLISHED",
      materialId: null,
      category: { name: { in: ["言语理解", "数量关系", "判断推理"] } },
    },
    include: { category: { select: { name: true } } },
    orderBy: { id: "asc" },
    take: 1_000,
  });
  const grouped = new Map();
  for (const question of directQuestions) {
    const key = `${question.category.name}\u0000${question.type}`;
    const items = grouped.get(key) || [];
    items.push(question);
    grouped.set(key, items);
  }
  const questions = [...grouped.values()].find((items) => items.length >= 5)?.slice(0, 5);
  assert.equal(questions?.length, 5, "测试题库应包含至少五道同一细分板块的非材料题");
  const category = questions[0].category.name;
  const type = questions[0].type;
  const requiredModule = category === "言语理解" ? "言语理解与表达" : category;
  const taskKey = `unbound-practice-${Date.now()}`;
  const task = {
    id: taskKey,
    day: 1,
    title: `${category} / ${type}普通入口验收`,
    type: "PRACTICE",
    target: "完成五道精确细分板块训练",
    minutes: 10,
    reason: "验证普通专项入口的服务端训练记录可以自动匹配",
    priority: "HIGH",
    checkpoint: "完成五题后由系统验收",
    module: `${category} / ${type}`,
    difficulty: "1-10",
    questionCount: 5,
    completionSpec: {
      version: 1,
      kind: "PRACTICE",
      method: "PROGRAM",
      launch: {
        kind: "PRACTICE",
        questionCount: 5,
        category,
        scopes: [{ category, type }],
        questionPool: null,
        minDifficulty: 1,
        maxDifficulty: 10,
        durationMinutes: 10,
      },
      evidence: { kind: "TRAINING_REPORT", mode: "PRACTICE" },
      minAnswered: 5,
      minAccuracy: 0,
      maxElapsedSeconds: 600,
      requiredModule,
      difficultyRange: { min: 1, max: 10 },
      minCompleteMaterialGroups: 0,
      requiredTemplateId: null,
    },
  };
  const generatedAt = new Date(Date.now() - 10 * 60_000);
  const plan = await db.studyPlan.create({
    data: {
      userId: studentId,
      title: "普通专项记录自动匹配测试",
      source: "DATA_RULES",
      summary: "验证计划过期后完成的同账号普通专项仍可按真实指标验收。",
      tasks: [task],
      schemaVersion: 5,
      inputSnapshot: {},
      generationMeta: { source: "DATA_RULES" },
      generatedAt,
      expiresAt: new Date(Date.now() - 1_000),
    },
  });
  createdStudyPlanIds.push(plan.id);
  await db.practiceSession.updateMany({
    where: { userId: studentId, status: "IN_PROGRESS" },
    data: { status: "ABANDONED", completedAt: new Date() },
  });

  const sessionResponse = await api("/api/practice-sessions", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({
      questionIds: questions.map((question) => question.id),
      config: {
        count: 5,
        category,
        scopes: [{ category, type }],
        minDifficulty: 1,
        maxDifficulty: 10,
      },
    }),
  });
  const practiceSession = await sessionResponse.json();
  assert.equal(sessionResponse.status, 201, JSON.stringify(practiceSession));
  createdPracticeSessionIds.push(practiceSession.data.id);
  for (const question of questions) {
    const answerResponse = await api(`/api/questions/${question.id}`, {
      method: "POST",
      cookie: studentCookie,
      body: JSON.stringify({
        selected: question.answer,
        duration: 1,
        practiceSessionId: practiceSession.data.id,
      }),
    });
    const answer = await answerResponse.json();
    assert.equal(answerResponse.status, 200, JSON.stringify(answer));
    createdAttemptIds.push(answer.data.attemptId);
  }
  const reportResponse = await api("/api/training-reports", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({
      practiceSessionId: practiceSession.data.id,
      title: "普通入口精确匹配训练",
    }),
  });
  const report = await reportResponse.json();
  assert.equal(reportResponse.status, 201, JSON.stringify(report));
  createdTrainingReportIds.push(report.data.id);
  assert.equal(report.data.studyPlanId, null);
  assert.equal(report.data.studyPlanTaskKey, null);

  const planContext = { planId: plan.id, taskKey, taskIndex: 0 };
  const candidateResponse = await api(
    `/api/study-plan/check-ins/verify?planId=${encodeURIComponent(plan.id)}&taskKey=${encodeURIComponent(taskKey)}&taskIndex=0`,
    { cookie: studentCookie },
  );
  const candidate = await candidateResponse.json();
  assert.equal(candidateResponse.status, 200, JSON.stringify(candidate));
  assert.equal(candidate.data.evidence.id, report.data.id);
  assert.equal(candidate.data.evidence.meetsCriteria, true);

  const verifyResponse = await api("/api/study-plan/check-ins/verify", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({ ...planContext, evidenceId: report.data.id }),
  });
  const verified = await verifyResponse.json();
  assert.equal(verifyResponse.status, 200, JSON.stringify(verified));
  assert.equal(verified.data.evidenceId, report.data.id);
  assert.equal(verified.data.acceptanceMethod, "PROGRAM_VERIFIED");
});

test("PLAN-008：申论程序验收应核验字数、限字和得分且拒绝未绑定证据", async () => {
  const essayQuestion = await db.essayQuestion.findFirst({
    orderBy: { createdAt: "asc" },
  });
  assert.ok(essayQuestion);
  assert.ok(essayQuestion.wordLimit >= 160, "申论测试题限字应容纳最低验收字数");
  const taskKey = `program-essay-${Date.now()}`;
  const completionSpec = {
    version: 1,
    kind: "ESSAY",
    method: "PROGRAM",
    launch: { kind: "ESSAY" },
    evidence: { kind: "ESSAY_SUBMISSION" },
    minWordCount: 160,
    minScore: 60,
    withinWordLimit: true,
    requiredTemplateId: null,
  };
  const task = {
    id: taskKey,
    day: 1,
    title: "申论程序验收",
    type: "ESSAY",
    target: "完成一道申论题",
    minutes: 45,
    reason: "验证申论服务端指标",
    priority: "HIGH",
    checkpoint: "字数、限字和得分均达标后由系统验收",
    module: "申论",
    difficulty: "强化",
    questionCount: 1,
    completionSpec,
  };
  const plan = await db.studyPlan.create({
    data: {
      userId: studentId,
      title: "申论程序验收集成测试",
      source: "DATA_RULES",
      summary: "验证申论程序验收。",
      tasks: [task],
      schemaVersion: 4,
      generatedAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  createdStudyPlanIds.push(plan.id);
  const planContext = { planId: plan.id, taskKey, taskIndex: 0 };

  const unboundEvidenceId = createdEssaySubmissionIds[0];
  assert.ok(unboundEvidenceId, "前置申论用例应已创建一份未绑定提交");
  const unboundResponse = await api("/api/study-plan/check-ins/verify", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({ ...planContext, evidenceId: unboundEvidenceId }),
  });
  const unbound = await unboundResponse.json();
  assert.equal(unboundResponse.status, 409, JSON.stringify(unbound));
  assert.equal(unbound.error?.code, "EVIDENCE_NOT_BOUND");

  async function submitEssay(content) {
    const response = await api(`/api/essays/questions/${essayQuestion.id}/submit`, {
      method: "POST",
      cookie: studentCookie,
      body: JSON.stringify({ content, planContext }),
    });
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    createdEssaySubmissionIds.push(body.data.id);
    return body.data;
  }

  async function verifyEssay(evidenceId) {
    const response = await api("/api/study-plan/check-ins/verify", {
      method: "POST",
      cookie: studentCookie,
      body: JSON.stringify({ ...planContext, evidenceId }),
    });
    return { response, body: await response.json() };
  }

  const targetLength = Math.min(
    essayQuestion.wordLimit,
    Math.max(160, Math.ceil(essayQuestion.wordLimit * 0.6)),
  );
  const lowScoreContent = (`一是围绕材料展开一般性说明。${"内容尚未覆盖评分要点。".repeat(30)}`).slice(0, targetLength);
  const lowScoreSubmission = await submitEssay(lowScoreContent);
  const lowScoreVerify = await verifyEssay(lowScoreSubmission.id);
  assert.equal(lowScoreVerify.response.status, 422, JSON.stringify(lowScoreVerify.body));
  assert.ok(lowScoreVerify.body.error.details.gaps.some((gap) => gap.code === "MIN_SCORE"));
  assert.equal(Object.hasOwn(lowScoreVerify.body.error.details.actual, "elapsedSeconds"), false, "申论不得伪造或验收用时");

  const overLimitContent = (`一是展开说明。${"补充论证内容。".repeat(1_000)}`).slice(0, essayQuestion.wordLimit + 20);
  const overLimitSubmission = await submitEssay(overLimitContent);
  const overLimitVerify = await verifyEssay(overLimitSubmission.id);
  assert.equal(overLimitVerify.response.status, 422, JSON.stringify(overLimitVerify.body));
  assert.ok(overLimitVerify.body.error.details.gaps.some((gap) => gap.code === "WORD_LIMIT"));

  const points = Array.isArray(essayQuestion.scoringPoints)
    ? essayQuestion.scoringPoints.map(String).join("，")
    : "";
  const passingContent = (`一是${points}。${"结合材料逐项归纳并规范表达。".repeat(1_000)}`).slice(0, targetLength);
  const passingSubmission = await submitEssay(passingContent);
  const passingVerify = await verifyEssay(passingSubmission.id);
  assert.equal(passingVerify.response.status, 200, JSON.stringify(passingVerify.body));
  assert.equal(passingVerify.body.data.acceptanceMethod, "PROGRAM_VERIFIED");
  assert.equal(passingVerify.body.data.evidenceType, "ESSAY_SUBMISSION");
  assert.equal(passingVerify.body.data.evidenceId, passingSubmission.id);
});

test("REPORT-002：模型未启用时仍应生成完整的规则兜底评价", async () => {
  const sessionResponse = await api("/api/practice-sessions", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({
      questionIds: [targetQuestion.id],
      config: { count: 1, minDifficulty: 1, maxDifficulty: 10 },
    }),
  });
  const practiceSession = await sessionResponse.json();
  assert.equal(sessionResponse.status, 201);
  createdPracticeSessionIds.push(practiceSession.data.id);
  await db.practiceSession.update({ where: { id: practiceSession.data.id }, data: { startedAt: new Date(Date.now() - 12_000) } });
  const answerResponse = await api(`/api/questions/${targetQuestion.id}`, { method: "POST", cookie: studentCookie, body: JSON.stringify({ selected: 0, duration: 12, practiceSessionId: practiceSession.data.id }) });
  const answer = await answerResponse.json();
  assert.equal(answerResponse.status, 200);
  createdAttemptIds.push(answer.data.attemptId);
  const payload = { practiceSessionId: practiceSession.data.id, title: "无模型兜底测试" };
  const createResponse = await api("/api/training-reports", { method: "POST", cookie: studentCookie, body: JSON.stringify(payload) });
  const created = await createResponse.json();
  assert.equal(createResponse.status, 201);
  createdTrainingReportIds.push(created.data.id);
  modelMockRequests.length = 0;
  const evaluateResponse = await api(`/api/training-reports/${created.data.id}/evaluate`, { method: "POST", cookie: studentCookie });
  const evaluated = await evaluateResponse.json();
  assert.equal(evaluateResponse.status, 200);
  assert.equal(evaluated.data.evaluationStatus, "FALLBACK");
  assert.equal(evaluated.data.evaluationSource, "DATA_RULES");
  assert.ok(evaluated.data.overallEvaluation.length >= 10);
  assert.equal(evaluated.data.sections.every((section) => section.evaluation?.length >= 8), true);
  assert.equal(
    evaluated.data.sections.flatMap((section) => section.subtypes).every((item) => !Object.hasOwn(item, "evaluation")),
    true,
    "规则兜底也只能生成大板块评价，不能写入细分题型评价",
  );
  assert.equal(modelMockRequests.length, 0, "模型未启用时不得发起外部请求");
});

test("MODEL-ADMIN-001：管理员可保存全局模型配置且 API Key 不回显", async () => {
  const guestResponse = await api("/api/admin/model-config");
  assert.equal(guestResponse.status, 403);
  const studentResponse = await api("/api/admin/model-config", { cookie: studentCookie });
  assert.equal(studentResponse.status, 403);
  const saveResponse = await api("/api/admin/model-config", { method: "PUT", cookie: modelAdminCookie, body: JSON.stringify({ enabled: true, apiKey: "local-test-api-key", model: "third-party-compatible-model", baseUrl: modelMockBaseUrl }) });
  const saved = await saveResponse.json();
  assert.equal(saveResponse.status, 200, JSON.stringify(saved));
  assert.equal(saved.data.enabled, true);
  assert.equal(saved.data.hasApiKey, true);
  assert.equal(saved.data.model, "third-party-compatible-model");
  assert.equal(JSON.stringify(saved).includes("local-test-api-key"), false);
  const getResponse = await api("/api/admin/model-config", { cookie: modelAdminCookie });
  const loaded = await getResponse.json();
  assert.equal(getResponse.status, 200);
  assert.equal(loaded.data.apiKeyMasked.includes("已配置"), true);
  assert.equal(JSON.stringify(loaded).includes("local-test-api-key"), false);
  const stored = await db.modelConfig.findUnique({ where: { id: "default" } });
  assert.ok(stored?.apiKeyEncrypted);
  assert.equal(stored.apiKeyEncrypted.includes("local-test-api-key"), false);
});

test("PLAN-002：模型规划应保留同日多任务、修复日预算并使用真实上下文", async () => {
  modelMockRequests.length = 0;
  const response = await api("/api/study-plan", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({
      targetExam: "2027国考",
      dailyMinutes: 80,
      weeklyDays: 6,
      currentLevel: "强化阶段",
      focus: "数量关系",
      examWindow: "ONE_TO_THREE_MONTHS",
      studyStatus: "REINFORCEMENT",
      focusAreas: ["数量关系", "言语理解与表达"],
      studyWindows: ["WEEKDAY_EVENING", "WEEKEND_MORNING"],
      learningGoal: "SPEED",
      learningMethods: ["METHOD_FIRST", "TIMED_SETS"],
      intensity: "BALANCED",
      minTasksPerDay: 1,
      maxTasksPerDay: 3,
      maxQuestionsPerTask: 20,
      acceptanceMethods: ["SYSTEM", "SELF"],
      constraints: ["NO_EARLY_MORNING"],
      notes: "需要一份可长期执行的计划",
      apiKey: "attempted-user-override",
      model: "attempted-user-model",
      baseUrl: "https://should-not-be-used.example/v1",
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.data.source, "HYBRID_REPAIRED");
  assert.equal(typeof body.data.summary, "string");
  assert.ok(body.data.summary.length >= 10);
  assert.ok(body.data.tasks.length > 7, "模型返回的多任务结构不应被压缩成固定七项");
  assert.equal(new Set(body.data.tasks.filter((item) => item.type !== "REST").map((item) => item.day)).size, 6);
  assert.equal(body.data.tasks.filter((item) => item.day === 1).length, 2, "同一天的多个任务必须保留");
  const totalsByDay = new Map();
  for (const task of body.data.tasks) {
    assert.ok(["ASSESSMENT", "KNOWLEDGE", "PRACTICE", "TIMED_PRACTICE", "WRONG", "EXAM", "ESSAY", "REVIEW", "REST"].includes(task.type));
    assert.equal(Number.isInteger(task.minutes), true);
    assert.ok(task.minutes >= 5 && task.minutes <= 80);
    assert.equal(typeof task.title, "string");
    assert.ok(task.title.length >= 1);
    assert.equal(typeof task.target, "string");
    assert.ok(task.target.length >= 1);
    assert.equal(typeof task.reason, "string");
    assert.ok(task.reason.length >= 1);
    assert.equal(typeof task.checkpoint, "string");
    assert.ok(task.checkpoint.length >= 1);
    totalsByDay.set(task.day, (totalsByDay.get(task.day) || 0) + task.minutes);
  }
  assert.ok([...totalsByDay.values()].every((minutes) => minutes <= 80), "同日任务总时长不得突破每日预算");
  assert.ok((totalsByDay.get(1) || 0) > 0, "第 1 天应保留有效训练任务");
  assert.match(body.data.strategy.phase, /强化阶段/);
  assert.match(body.data.strategy.objective, /数量关系/);
  assert.equal(body.data.strategy.priorities.length, 3);
  assert.equal(body.data.strategy.adjustmentRules.length, 2);
  assert.match(body.data.strategy.adjustmentRules[0], /提高1个难度档/);
  assert.equal(
    JSON.stringify({
      summary: body.data.summary,
      strategy: body.data.strategy,
      tasks: body.data.tasks,
    }).includes("METHOD_FIRST"),
    false,
    "用户可见计划不得暴露内部偏好枚举",
  );
  assert.match(body.data.summary, /方法先行/);
  assert.ok(modelMockRequests.some((item) => item.url === "/v1/responses"));
  assert.ok(modelMockRequests.some((item) => item.url === "/v1/chat/completions"));
  assert.ok(modelMockRequests.every((item) => item.authorization === "Bearer local-test-api-key"));
  assert.ok(modelMockRequests.some((item) => item.body.includes("third-party-compatible-model")));
  assert.equal(modelMockRequests.some((item) => item.body.includes("attempted-user-model")), false);
  const planningRequest = modelMockRequests.find((item) => item.url === "/v1/chat/completions" && item.body.includes("公务员考试学习规划教练"));
  assert.ok(planningRequest, "应向模型发送智能规划请求");
  assert.match(planningRequest.body, /recommendedSeconds/);
  assert.match(planningRequest.body, /不得用全卷统一题均时间/);
  const planningBody = JSON.parse(planningRequest.body);
  const context = JSON.parse(planningBody.messages[1].content);
  assert.equal(context.preferences.weeklyDays, 6);
  assert.equal(context.preferences.dailyMinutes, 80);
  assert.equal(context.preferences.examWindow, "ONE_TO_THREE_MONTHS");
  assert.equal(context.preferences.studyStatus, "REINFORCEMENT");
  assert.deepEqual(context.preferences.focusAreas, ["数量关系", "言语理解与表达"]);
  assert.deepEqual(context.preferences.studyWindows, ["WEEKDAY_EVENING", "WEEKEND_MORNING"]);
  assert.equal(context.preferences.learningGoal, "SPEED");
  assert.deepEqual(context.preferences.learningMethods, ["METHOD_FIRST", "TIMED_SETS"]);
  assert.equal(context.preferences.intensity, "BALANCED");
  assert.equal(context.preferences.minTasksPerDay, 1);
  assert.equal(context.preferences.maxTasksPerDay, 3);
  assert.equal(context.preferences.maxQuestionsPerTask, 20);
  assert.deepEqual(context.preferences.acceptanceMethods, ["SYSTEM", "SELF"]);
  assert.deepEqual(context.preferences.constraints, ["NO_EARLY_MORNING"]);
  assert.ok(context.performance.totalAttempts > 0);
  assert.ok(context.performance.categories.length > 0);
  assert.ok(context.performance.subtypes.length > 0);
  assert.ok(context.timingBenchmarks.length >= 50);
  assert.ok(context.timingBenchmarks.every((item) =>
    item.initialSeconds > 0 && item.recommendedSeconds > 0 && item.sampleCount >= 0
  ));
  assert.ok("last7Days" in context.performance.trend);
  assert.ok(context.performance.recentReports.length > 0);
  assert.ok(context.performance.essay.submissions > 0);
  assert.ok(context.previousPlan && context.previousPlan.tasks.length > 0);
  assert.equal(JSON.stringify(context).includes('"stem"'), false, "模型上下文不得包含题干");
  assert.equal(JSON.stringify(context).includes('"answer"'), false, "模型上下文不得包含答案");
  assert.equal(JSON.stringify(context).includes("attempted-user-override"), false, "模型上下文不得包含用户提交的 API Key");
  createdStudyPlanIds.push(body.data.id);
});

test("REPORT-001：专项结束应持久化逐题用时、细分难度并通过模型生成板块与整体评价", async () => {
  const pool = await db.question.findMany({ where: { status: "PUBLISHED", materialId: null }, select: { id: true, categoryId: true, type: true }, take: 5000 });
  const grouped = new Map();
  for (const item of pool) { const key = `${item.categoryId}:${item.type}`; grouped.set(key, [...(grouped.get(key) || []), item]); }
  const items = [...grouped.values()].find((group) => group.length >= 5)?.slice(0, 5);
  assert.ok(items?.length === 5, "测试题库应至少存在一组同细分题型的5道题");
  const sessionResponse = await api("/api/practice-sessions", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({ questionIds: items.map((item) => item.id), config: { count: 5, minDifficulty: 1, maxDifficulty: 10 } }),
  });
  const practiceSession = await sessionResponse.json();
  assert.equal(sessionResponse.status, 201);
  createdPracticeSessionIds.push(practiceSession.data.id);
  await db.practiceSession.update({ where: { id: practiceSession.data.id }, data: { startedAt: new Date(Date.now() - 43_000) } });
  for (const [index, duration] of [11, 29].entries()) {
    const answerResponse = await api(`/api/questions/${items[index].id}`, {
      method: "POST",
      cookie: studentCookie,
      body: JSON.stringify({ selected: 0, duration, practiceSessionId: practiceSession.data.id }),
    });
    const answer = await answerResponse.json();
    assert.equal(answerResponse.status, 200);
    assert.equal(Object.hasOwn(answer.data, "correctAnswer"), false, "专项作答过程中不得下发正确答案");
    assert.equal(Object.hasOwn(answer.data, "explanation"), false, "专项作答过程中不得下发解析");
    createdAttemptIds.push(answer.data.attemptId);
  }
  const timingResponse = await api(`/api/practice-sessions/${practiceSession.data.id}`, { method: "PATCH", cookie: studentCookie, body: JSON.stringify({ questionId: items[2].id, durationSeconds: 3, currentIndex: 2 }) });
  assert.equal(timingResponse.status, 200);
  const restoredResponse = await api("/api/practice-sessions", { cookie: studentCookie });
  const restored = await restoredResponse.json();
  assert.equal(restored.data.id, practiceSession.data.id);
  assert.equal(restored.data.currentIndex, 2);
  assert.equal(Object.keys(restored.data.answerStates).length, 2);
  assert.equal(
    Object.values(restored.data.answerStates).every((state) =>
      !Object.hasOwn(state.result, "correctAnswer") && !Object.hasOwn(state.result, "explanation")
    ),
    true,
    "恢复未交卷专项时也不得泄露答案和解析",
  );
  assert.equal(restored.data.questionDurations[items[0].id], 11);
  assert.equal(restored.data.questionDurations[items[1].id], 29);
  assert.equal(restored.data.questionDurations[items[2].id], 3);
  const payload = {
    practiceSessionId: practiceSession.data.id,
    title: "API专项总结测试",
  };
  const createResponse = await api("/api/training-reports", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify(payload),
  });
  const created = await createResponse.json();
  assert.equal(createResponse.status, 201, JSON.stringify(created));
  const report = created.data;
  createdTrainingReportIds.push(report.id);
  assert.equal(report.mode, "PRACTICE");
  assert.equal(report.total, 5);
  assert.equal(report.answered, 2);
  assert.equal(report.questionReviews.length, 5);
  assert.equal(report.questionReviews.filter((item) => item.selected !== null).length, 2);
  assert.equal(report.questionReviews.every((item) => typeof item.correctAnswer === "number" && typeof item.explanation === "string"), true);
  assert.equal(report.durationSeconds, 43);
  assert.equal(report.sections.reduce((sum, section) => sum + section.durationSeconds, 0), 43);
  const subtypes = report.sections.flatMap((section) => section.subtypes);
  assert.equal(subtypes.length, 1);
  assert.equal(subtypes[0].durationSeconds, 43);
  assert.equal(subtypes[0].averageDurationSeconds, 20, "题均耗时只能统计已作答题目的用时");
  assert.equal(subtypes.every((item) => typeof item.difficultyScore === "number" && item.difficultyScore > 0), true);
  assert.equal(report.sections.every((section) => typeof section.key === "string" && section.key.length > 0), true);
  assert.equal(report.sections.every((section) => section.evaluation === null), true);
  assert.equal(subtypes.every((item) => !Object.hasOwn(item, "evaluation")), true, "新快照不应再创建细分题型评价字段");

  const duplicateResponse = await api("/api/training-reports", { method: "POST", cookie: studentCookie, body: JSON.stringify(payload) });
  const duplicate = await duplicateResponse.json();
  assert.equal(duplicateResponse.status, 200);
  assert.equal(duplicate.data.id, report.id);
  assert.equal(await db.trainingReport.count({ where: { userId: studentId, practiceSessionId: practiceSession.data.id } }), 1);

  modelMockRequests.length = 0;
  await rememberModelUsageBaseline();
  const usageBefore = new Map(
    initialModelUsageRows.map((item) => [item.key, item.requestCount]),
  );
  const evaluationResponses = await Promise.all([
    api(`/api/training-reports/${report.id}/evaluate`, { method: "POST", cookie: studentCookie }),
    api(`/api/training-reports/${report.id}/evaluate`, { method: "POST", cookie: studentCookie }),
  ]);
  assert.equal(evaluationResponses.every((response) => [200, 202].includes(response.status)), true);
  const evaluatedResponse = await api(`/api/training-reports/${report.id}`, { cookie: studentCookie });
  const evaluated = await evaluatedResponse.json();
  assert.equal(evaluated.data.evaluationStatus, "READY");
  assert.equal(evaluated.data.evaluationSource, "MODEL_API");
  assert.ok(evaluated.data.overallEvaluation.length >= 10);
  assert.equal(evaluated.data.sections.every((section) => typeof section.evaluation === "string" && section.evaluation.length >= 8), true);
  assert.equal(
    evaluated.data.sections.flatMap((section) => section.subtypes).every((item) => !Object.hasOwn(item, "evaluation")),
    true,
    "模型评价只应写入大板块，不能写入细分题型",
  );
  const reportRequests = modelMockRequests.filter((item) => item.body.includes("公务员考试训练分析师"));
  assert.ok(reportRequests.length >= 1);
  assert.equal(reportRequests.filter((item) => item.url === "/v1/chat/completions").length, 1, "并发评价只能触发一次模型业务调用");
  assert.equal(reportRequests.some((item) => item.body.includes("local-test-api-key")), false);
  assert.equal(reportRequests.some((item) => item.body.includes("\"stem\"")), false);
  assert.equal(reportRequests.some((item) => item.body.includes("20至80个汉字") || item.body.includes("60至180个汉字")), false, "模型评价不应再受固定字数约束");
  assert.equal(reportRequests.some((item) => item.body.includes("不受固定字数或固定句式限制")), true, "模型应被明确允许自行决定评价表达方式");
  const reportChatRequest = reportRequests.find((item) => item.url === "/v1/chat/completions");
  const reportChatBody = JSON.parse(reportChatRequest.body);
  const reportContext = JSON.parse(reportChatBody.messages[1].content);
  assert.equal(
    reportContext.sections.every((section) => Array.isArray(section.subtypes)),
    true,
    "模型仍应接收细分题型数值作为板块分析依据",
  );
  assert.equal(reportRequests.some((item) => item.body.includes("不要为细分题型单独生成评价")), true);
  const usageAfter = await db.modelUsageDaily.findMany({
    where: { key: { in: touchedModelUsageKeys } },
  });
  assert.equal(usageAfter.length, 2);
  for (const item of usageAfter)
    assert.equal(
      item.requestCount,
      (usageBefore.get(item.key) || 0) + 2,
      "Responses 探测和 Chat 回退都必须计入模型调用额度",
    );

  const getResponse = await api(`/api/training-reports/${report.id}`, { cookie: studentCookie });
  const loaded = await getResponse.json();
  assert.equal(getResponse.status, 200);
  assert.equal(loaded.data.overallEvaluation, evaluated.data.overallEvaluation);
  assert.deepEqual(
    loaded.data.sections.map((section) => section.evaluation),
    evaluated.data.sections.map((section) => section.evaluation),
    "大板块评价必须随训练总结持久化",
  );
  assert.equal(loaded.data.sections.flatMap((section) => section.subtypes).every((item) => !Object.hasOwn(item, "evaluation")), true);
  const unauthorized = await api(`/api/training-reports/${report.id}`);
  assert.equal(unauthorized.status, 401);
});

test("REPORT-003：模型缺少板块结果时应完整降级且不能留下永久加载状态", async () => {
  const sessionResponse = await api("/api/practice-sessions", { method: "POST", cookie: studentCookie, body: JSON.stringify({ questionIds: [targetQuestion.id], config: { count: 1, minDifficulty: 1, maxDifficulty: 10 } }) });
  const practiceSession = await sessionResponse.json();
  assert.equal(sessionResponse.status, 201);
  createdPracticeSessionIds.push(practiceSession.data.id);
  await db.practiceSession.update({ where: { id: practiceSession.data.id }, data: { startedAt: new Date(Date.now() - 5_000) } });
  const answerResponse = await api(`/api/questions/${targetQuestion.id}`, { method: "POST", cookie: studentCookie, body: JSON.stringify({ selected: 0, duration: 5, practiceSessionId: practiceSession.data.id }) });
  const answer = await answerResponse.json();
  createdAttemptIds.push(answer.data.attemptId);
  const reportResponse = await api("/api/training-reports", { method: "POST", cookie: studentCookie, body: JSON.stringify({ practiceSessionId: practiceSession.data.id, title: "模型异常降级测试" }) });
  const created = await reportResponse.json();
  createdTrainingReportIds.push(created.data.id);
  modelMockMode = "partial";
  try {
    const evaluateResponse = await api(`/api/training-reports/${created.data.id}/evaluate`, { method: "POST", cookie: studentCookie });
    const evaluated = await evaluateResponse.json();
    assert.equal(evaluateResponse.status, 200);
    assert.equal(evaluated.data.evaluationStatus, "FALLBACK");
    assert.equal(evaluated.data.evaluationSource, "DATA_RULES");
    assert.equal(evaluated.data.sections.every((section) => section.evaluation?.length >= 8), true);
    assert.equal(evaluated.data.sections.flatMap((section) => section.subtypes).every((item) => !Object.hasOwn(item, "evaluation")), true);
  } finally {
    modelMockMode = "success";
  }
});

test("REPORT-004：细分与整套难度必须使用非简单平均算法", async () => {
  const questions = await db.question.findMany({ where: { status: "PUBLISHED", materialId: null }, select: { id: true, difficultyScore: true }, take: 3 });
  assert.equal(questions.length, 3);
  try {
    await Promise.all([
      db.question.update({ where: { id: questions[0].id }, data: { difficultyScore: 1 } }),
      db.question.update({ where: { id: questions[1].id }, data: { difficultyScore: 1 } }),
      db.question.update({ where: { id: questions[2].id }, data: { difficultyScore: 10 } }),
    ]);
    const sessionResponse = await api("/api/practice-sessions", { method: "POST", cookie: studentCookie, body: JSON.stringify({ questionIds: questions.map((item) => item.id), config: { count: 3, minDifficulty: 1, maxDifficulty: 10 } }) });
    const practiceSession = await sessionResponse.json();
    assert.equal(sessionResponse.status, 201);
    createdPracticeSessionIds.push(practiceSession.data.id);
    await db.practiceSession.update({ where: { id: practiceSession.data.id }, data: { startedAt: new Date(Date.now() - 3_000) } });
    const answerResponse = await api(`/api/questions/${questions[0].id}`, { method: "POST", cookie: studentCookie, body: JSON.stringify({ selected: 0, duration: 3, practiceSessionId: practiceSession.data.id }) });
    const answer = await answerResponse.json();
    createdAttemptIds.push(answer.data.attemptId);
    const reportResponse = await api("/api/training-reports", { method: "POST", cookie: studentCookie, body: JSON.stringify({ practiceSessionId: practiceSession.data.id, title: "难度算法测试" }) });
    const report = await reportResponse.json();
    assert.equal(reportResponse.status, 201);
    createdTrainingReportIds.push(report.data.id);
    assert.equal(report.data.difficultyScore, 8);
    assert.notEqual(report.data.difficultyScore, 4, "[1,1,10]的简单平均为4，报告不得使用该结果");
  } finally {
    await Promise.all(questions.map((question) => db.question.update({ where: { id: question.id }, data: { difficultyScore: question.difficultyScore } })));
  }
});

test("REPORT-005：训练总结应使用完成时间与 ID 稳定游标分页", async () => {
  const token = Date.now();
  const completedAt = new Date(Date.now() + 60_000);
  const fixtures = await Promise.all(
    Array.from({ length: 13 }, (_, index) =>
      db.trainingReport.create({
        data: {
          userId: studentId,
          clientKey: `pagination-test:${token}:${index}`,
          mode: "PRACTICE",
          title: `分页训练总结 ${String(index + 1).padStart(2, "0")}`,
          questionIds: [],
          attemptIds: [],
          questionDurations: {},
          durationSeconds: 60 + index,
          total: 1,
          answered: 1,
          correct: index % 2,
          accuracy: index % 2 ? 100 : 0,
          difficultyScore: 5,
          sections: [],
          evaluationStatus: "FALLBACK",
          evaluationSource: "DATA_RULES",
          overallEvaluation: "用于验证训练总结游标分页。",
          startedAt: new Date(completedAt.getTime() - 60_000),
          completedAt,
        },
      }),
    ),
  );
  createdTrainingReportIds.push(...fixtures.map((item) => item.id));

  const invalidLimit = await api("/api/training-reports?limit=0", {
    cookie: studentCookie,
  });
  assert.equal(invalidLimit.status, 400);
  const invalidCursor = await api(
    "/api/training-reports?limit=5&cursor=not-a-valid-cursor",
    { cookie: studentCookie },
  );
  assert.equal(invalidCursor.status, 400);

  const firstResponse = await api("/api/training-reports?limit=5", {
    cookie: studentCookie,
  });
  const first = await firstResponse.json();
  assert.equal(firstResponse.status, 200, JSON.stringify(first));
  assert.equal(first.data.items.length, 5);
  assert.equal(typeof first.data.nextCursor, "string");

  const secondResponse = await api(
    `/api/training-reports?limit=5&cursor=${encodeURIComponent(first.data.nextCursor)}`,
    { cookie: studentCookie },
  );
  const second = await secondResponse.json();
  assert.equal(secondResponse.status, 200, JSON.stringify(second));
  assert.equal(second.data.items.length, 5);
  assert.equal(typeof second.data.nextCursor, "string");

  const thirdResponse = await api(
    `/api/training-reports?limit=5&cursor=${encodeURIComponent(second.data.nextCursor)}`,
    { cookie: studentCookie },
  );
  const third = await thirdResponse.json();
  assert.equal(thirdResponse.status, 200, JSON.stringify(third));
  assert.ok(third.data.items.length >= 3);

  const loadedIds = [
    ...first.data.items,
    ...second.data.items,
    ...third.data.items,
  ].map((item) => item.id);
  const expectedIds = (
    await db.trainingReport.findMany({
      where: { id: { in: fixtures.map((item) => item.id) } },
      orderBy: [{ completedAt: "desc" }, { id: "desc" }],
      select: { id: true },
    })
  ).map((item) => item.id);
  assert.deepEqual(loadedIds.slice(0, fixtures.length), expectedIds);
  assert.equal(new Set(loadedIds).size, loadedIds.length, "翻页结果不得重复");
});

test("REPORT-006：过期评价租约可恢复且超大流式响应应立即降级", async () => {
  const report = await createEvaluationReportFixture("流式响应上限测试");
  await db.trainingReport.update({
    where: { id: report.id },
    data: {
      evaluationStatus: "EVALUATING",
      evaluationClaimedAt: new Date(Date.now() - 5 * 60 * 1000),
    },
  });
  modelMockRequests.length = 0;
  modelMockMode = "oversized";
  const startedAt = Date.now();
  try {
    const response = await api(`/api/training-reports/${report.id}/evaluate`, {
      method: "POST",
      cookie: studentCookie,
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.data.evaluationStatus, "FALLBACK");
    assert.equal(body.data.evaluationClaimedAt, null);
    assert.ok(
      Date.now() - startedAt < 2_500,
      "超过 1MB 后应取消响应流，不能等待提供方发送完整的大响应",
    );
    assert.equal(
      modelMockRequests.filter((item) => item.url === "/v1/chat/completions")
        .length,
      1,
    );
  } finally {
    modelMockMode = "success";
  }
});

test("REPORT-007：全站日额度耗尽后重试不得绕过模型调用限制", async () => {
  await rememberModelUsageBaseline();
  const report = await createEvaluationReportFixture("全站模型额度测试");
  const [globalKey, userKey] = trainingEvaluationUsageKeys(studentId);
  const currentGlobal = await db.modelUsageDaily.findUnique({
    where: { key: globalKey },
  });
  const currentUser = await db.modelUsageDaily.findUnique({
    where: { key: userKey },
  });
  const day = new Date(`${globalKey.slice(0, 10)}T00:00:00.000Z`);
  await db.modelUsageDaily.upsert({
    where: { key: globalKey },
    update: { requestCount: 1_000 },
    create: {
      key: globalKey,
      usageDate: day,
      scope: "GLOBAL",
      purpose: "TRAINING_REPORT_EVALUATION",
      requestCount: 1_000,
    },
  });
  modelMockRequests.length = 0;
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await api(
        `/api/training-reports/${report.id}/evaluate`,
        { method: "POST", cookie: studentCookie },
      );
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.data.evaluationStatus, "FALLBACK");
      assert.equal(body.data.evaluationSource, "DATA_RULES");
    }
    assert.equal(modelMockRequests.length, 0);
    const [globalAfter, userAfter] = await Promise.all([
      db.modelUsageDaily.findUniqueOrThrow({ where: { key: globalKey } }),
      db.modelUsageDaily.findUnique({ where: { key: userKey } }),
    ]);
    assert.equal(globalAfter.requestCount, 1_000);
    assert.equal(
      userAfter?.requestCount || 0,
      currentUser?.requestCount || 0,
      "全站额度拒绝时用户额度也不应被部分扣减",
    );
  } finally {
    if (currentGlobal)
      await db.modelUsageDaily.update({
        where: { key: globalKey },
        data: { requestCount: currentGlobal.requestCount },
      });
    else await db.modelUsageDaily.deleteMany({ where: { key: globalKey } });
  }
});

test("FAVORITE-001：收藏应写入数据库并支持取消", async () => {
  const initialResponse = await api("/api/favorites", { cookie: studentCookie });
  const initial = await initialResponse.json();
  favoriteInitiallyExisted = initial.data.some((item) => item.id === targetQuestion.id);
  if (favoriteInitiallyExisted) {
    await api(`/api/favorites/${targetQuestion.id}`, { method: "DELETE", cookie: studentCookie });
  }

  const addResponse = await api("/api/favorites", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({ questionId: targetQuestion.id }),
  });
  const added = await addResponse.json();
  assert.equal(addResponse.status, 200);
  assert.equal(added.data.favorite, true);

  const listResponse = await api("/api/favorites", { cookie: studentCookie });
  const list = await listResponse.json();
  assert.ok(list.data.some((item) => item.id === targetQuestion.id));

  const deleteResponse = await api(`/api/favorites/${targetQuestion.id}`, { method: "DELETE", cookie: studentCookie });
  const deleted = await deleteResponse.json();
  assert.equal(deleteResponse.status, 200);
  assert.equal(deleted.data.favorite, false);
});

test("WRONG-001：完成练习后应按练习批次生成错题集", async () => {
  const wrongAttempt = await db.attempt.findFirst({
    where: {
      id: { in: createdAttemptIds },
      userId: studentId,
      questionId: targetQuestion.id,
      correct: false,
    },
    orderBy: { createdAt: "desc" },
  });
  assert.ok(wrongAttempt, "测试准备阶段应已生成错误作答");
  const report = await db.trainingReport.create({
    data: {
      userId: studentId,
      clientKey: `wrong-set-fixture:${Date.now()}`,
      mode: "PRACTICE",
      title: "错题集成测试练习",
      questionIds: [targetQuestion.id],
      attemptIds: [wrongAttempt.id],
      questionDurations: { [targetQuestion.id]: 12 },
      durationSeconds: 12,
      total: 1,
      answered: 1,
      correct: 0,
      accuracy: 0,
      difficultyScore: targetQuestion.difficultyScore,
      sections: [],
      startedAt: wrongAttempt.createdAt,
      completedAt: new Date(),
    },
  });
  createdTrainingReportIds.push(report.id);

  const response = await api("/api/wrong-questions", { cookie: studentCookie });
  const body = await response.json();
  assert.equal(response.status, 200);
  const wrongSet = body.data.find((item) => item.id === report.id);
  assert.ok(wrongSet);
  assert.equal(wrongSet.title, "错题集成测试练习");
  assert.equal(wrongSet.wrongCount, 1);
  assert.deepEqual(wrongSet.questions.map((item) => item.id), [targetQuestion.id]);
  assert.equal(body.data.some((item) => item.id === targetQuestion.id), false);
});

test("STATS-001：学习统计应与数据库作答记录一致", async () => {
  const beforeResponse = await api("/api/statistics/overview", { cookie: studentCookie });
  const before = await beforeResponse.json();
  const plan = await db.studyPlan.create({
    data: {
      userId: studentId,
      title: "本周系统验收统计测试",
      source: "DATA_RULES",
      summary: "用于验证顶部任务统计口径",
      tasks: [],
      schemaVersion: 5,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  createdStudyPlanIds.push(plan.id);
  await db.studyPlanCheckIn.createMany({
    data: [
      {
        planId: plan.id,
        taskKey: "program-task",
        taskIndex: 0,
        taskTitle: "系统验收任务",
        targetSnapshot: "完成系统验收",
        checkpointSnapshot: "系统核验通过",
        acceptanceMethod: "PROGRAM_VERIFIED",
      },
      {
        planId: plan.id,
        taskKey: "self-task",
        taskIndex: 1,
        taskTitle: "手动确认任务",
        targetSnapshot: "手动完成",
        checkpointSnapshot: "自行确认",
        acceptanceMethod: "SELF_CONFIRMED",
      },
    ],
  });
  const response = await api("/api/statistics/overview", { cookie: studentCookie });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(typeof body.data.total, "number");
  assert.equal(typeof body.data.correct, "number");
  assert.ok(body.data.total >= createdAttemptIds.length);
  assert.ok(body.data.accuracy >= 0 && body.data.accuracy <= 100);
  assert.equal(body.data.daily.length, 7);
  assert.equal(
    body.data.weeklyCompletedTasks,
    before.data.weeklyCompletedTasks + 1,
    "本周完成只统计系统验收通过的任务",
  );
});

test("CHECKIN-001：每日签到幂等生成模型目标并计入本周签到", async () => {
  assert.ok(registeredUserId && registeredCookie, "注册测试账号应先完成登录");
  const beforeResponse = await api("/api/daily-check-in", { cookie: registeredCookie });
  const before = await beforeResponse.json();
  assert.equal(beforeResponse.status, 200);
  assert.equal(before.data.checkedIn, false);

  modelMockRequests.length = 0;
  const firstResponse = await api("/api/daily-check-in", {
    method: "POST",
    cookie: registeredCookie,
  });
  const first = await firstResponse.json();
  assert.equal(firstResponse.status, 200, JSON.stringify(first));
  assert.equal(first.data.checkedIn, true);
  assert.equal(first.data.questionGoal, 35);
  assert.equal(first.data.taskGoal, 3);
  assert.equal(first.data.source, "MODEL_API");
  assert.match(first.data.summary, /35题/);
  const requestCount = modelMockRequests.length;
  assert.ok(requestCount >= 1);

  const secondResponse = await api("/api/daily-check-in", {
    method: "POST",
    cookie: registeredCookie,
  });
  const second = await secondResponse.json();
  assert.equal(secondResponse.status, 200);
  assert.deepEqual(second.data, first.data, "同一天重复签到应返回同一目标");
  assert.equal(modelMockRequests.length, requestCount, "重复签到不得重复调用模型 API");

  const overviewResponse = await api("/api/statistics/overview", { cookie: registeredCookie });
  const overview = await overviewResponse.json();
  assert.equal(overviewResponse.status, 200);
  assert.equal(overview.data.weeklyCheckIns, 1);
  assert.equal(overview.data.checkedInToday, true);
  assert.equal(overview.data.todayQuestionGoal, 35);
  assert.equal(overview.data.todayTaskGoal, 3);
});

test("STATS-002：综合学习分析调用模型 API 并返回长篇结构化结果", async () => {
  await rememberLearningAnalysisUsageBaseline();
  modelMockRequests.length = 0;
  const response = await api("/api/statistics/analysis", {
    method: "POST",
    cookie: studentCookie,
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.source, "MODEL_API");
  assert.ok(body.data.overall.length >= 120);
  assert.ok(body.data.trainingPlan.length >= 160);
  assert.ok(body.data.actions.length >= 4);
  assert.ok(
    modelMockRequests.some(
      (request) =>
        request.url === "/v1/chat/completions" &&
        request.body.includes("资深公务员考试学习分析师"),
    ),
  );
});

test("ROLE-001：学员不能创建题目", async () => {
  const response = await api("/api/questions", {
    method: "POST",
    cookie: studentCookie,
    body: JSON.stringify({}),
  });
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.error?.code, "FORBIDDEN");
});

test("ADMIN-001：管理员可以新增、编辑、发布和停用题目", async () => {
  const loginResponse = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "admin@zhizheng.local", password: "Demo123456" }),
  });
  assert.equal(loginResponse.status, 200);
  const loginBody = await loginResponse.json();
  assert.equal(loginBody.data.user.role, "ADMIN");
  adminCookie = sessionCookie(loginResponse);

  const meResponse = await api("/api/auth/me", { cookie: adminCookie });
  const meBody = await meResponse.json();
  assert.equal(meResponse.status, 200);
  assert.equal(meBody.data.role, "ADMIN");

  const invalidResponse = await api("/api/admin/questions", { method: "POST", cookie: adminCookie, body: JSON.stringify({ stem: "不完整" }) });
  assert.equal(invalidResponse.status, 400);

  const createResponse = await api("/api/admin/questions", {
    method: "POST",
    cookie: adminCookie,
    body: JSON.stringify({ category: "自动化测试分类", type: "单项选择", stem: "用于验证管理端完整流程的测试题目。", options: ["选项一", "选项二", "选项三", "选项四"], answer: 1, explanation: "第二个选项是测试设定的正确答案。", difficulty: "进阶", difficultyScore: 6.4, status: "PUBLISHED" }),
  });
  const created = await createResponse.json();
  assert.equal(createResponse.status, 201);
  assert.equal(created.data.difficultyScore, 6.4);
  createdAdminQuestionId = created.data.id;

  const listResponse = await api(`/api/admin/questions?page=1&pageSize=20&query=${encodeURIComponent("用于验证管理端完整流程")}`, { cookie: adminCookie });
  const listBody = await listResponse.json();
  assert.equal(listResponse.status, 200);
  assert.ok(listBody.data.items.some((item) => item.id === createdAdminQuestionId));

  const publicResponse = await api(`/api/questions/${createdAdminQuestionId}`, { cookie: studentCookie });
  assert.equal(publicResponse.status, 200);

  const updateResponse = await api(`/api/admin/questions/${createdAdminQuestionId}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: JSON.stringify({ category: "自动化测试分类", type: "单项选择", stem: "用于验证管理端编辑流程的更新题目。", options: ["选项一", "选项二", "选项三", "选项四"], answer: 2, explanation: "编辑后第三个选项为正确答案。", difficulty: "困难", difficultyScore: 8.2, status: "PUBLISHED" }),
  });
  const updated = await updateResponse.json();
  assert.equal(updateResponse.status, 200);
  assert.equal(updated.data.answer, 2);
  assert.equal(updated.data.difficulty, "困难");
  assert.equal(updated.data.difficultyScore, 8.2);

  const disableResponse = await api(`/api/admin/questions/${createdAdminQuestionId}`, { method: "DELETE", cookie: adminCookie });
  assert.equal(disableResponse.status, 200);
  const afterDisableResponse = await api(`/api/questions/${createdAdminQuestionId}`, { cookie: studentCookie });
  assert.equal(afterDisableResponse.status, 404);
});

test("ADMIN-USER-001：账号列表支持权限校验、筛选、分页和关联数据计数", async () => {
  const guestResponse = await api("/api/admin/users");
  assert.equal(guestResponse.status, 403);
  const studentResponse = await api("/api/admin/users", { cookie: studentCookie });
  assert.equal(studentResponse.status, 403);

  const invalidResponse = await api("/api/admin/users?role=OWNER", { cookie: adminCookie });
  const invalidBody = await invalidResponse.json();
  assert.equal(invalidResponse.status, 400);
  assert.equal(invalidBody.error?.code, "INVALID_INPUT");

  const managedUser = await db.user.create({
    data: {
      name: "API账号管理测试学员",
      email: adminManagedUserEmail,
      passwordHash: "not-used-by-account-management-test",
      role: "STUDENT",
      targetExam: "广东省考",
    },
  });
  adminManagedUserId = managedUser.id;
  await db.attempt.create({
    data: {
      userId: managedUser.id,
      questionId: targetQuestion.id,
      selected: 0,
      correct: false,
      duration: 9,
    },
  });
  await db.studyPlan.create({
    data: {
      userId: managedUser.id,
      title: "账号管理关联计划",
      source: "RULE_BASED",
      summary: "用于验证账号管理关联数据计数。",
      tasks: [],
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  await db.trainingReport.create({
    data: {
      userId: managedUser.id,
      clientKey: `admin-user-api:${Date.now()}`,
      mode: "PRACTICE",
      title: "账号管理关联报告",
      questionIds: [],
      attemptIds: [],
      questionDurations: {},
      durationSeconds: 9,
      total: 1,
      answered: 1,
      correct: 0,
      accuracy: 0,
      difficultyScore: 5,
      sections: [],
      startedAt: new Date(Date.now() - 9_000),
    },
  });

  const searchResponse = await api(
    `/api/admin/users?page=1&pageSize=1&role=STUDENT&query=${encodeURIComponent(adminManagedUserEmail.toUpperCase())}`,
    { cookie: adminCookie },
  );
  const searchBody = await searchResponse.json();
  assert.equal(searchResponse.status, 200);
  assert.equal(searchBody.data.total, 1);
  assert.equal(searchBody.data.page, 1);
  assert.equal(searchBody.data.totalPages, 1);
  assert.equal(searchBody.data.items[0].id, managedUser.id);
  assert.equal(searchBody.data.items[0].activity.attempts, 1);
  assert.equal(searchBody.data.items[0].activity.studyPlans, 1);
  assert.equal(searchBody.data.items[0].activity.trainingReports, 1);
  assert.equal("passwordHash" in searchBody.data.items[0], false, "账号列表不得回传密码哈希");

  const pagedResponse = await api("/api/admin/users?page=1&pageSize=1&role=STUDENT", { cookie: adminCookie });
  const pagedBody = await pagedResponse.json();
  assert.equal(pagedResponse.status, 200);
  assert.equal(pagedBody.data.items.length, 1);
  assert.ok(pagedBody.data.total >= 1);
  assert.equal(pagedBody.data.totalPages, Math.max(1, Math.ceil(pagedBody.data.total / 1)));
  assert.equal(typeof pagedBody.data.currentUserId, "string");
  assert.ok(pagedBody.data.adminCount >= 1);
});

test("ADMIN-USER-002：删除账号需要管理员权限、禁止自删并级联清理学习数据", async () => {
  const meResponse = await api("/api/auth/me", { cookie: adminCookie });
  const meBody = await meResponse.json();
  assert.equal(meResponse.status, 200);

  const selfDeleteResponse = await api(`/api/admin/users/${meBody.data.id}`, {
    method: "DELETE",
    cookie: adminCookie,
  });
  const selfDeleteBody = await selfDeleteResponse.json();
  assert.equal(selfDeleteResponse.status, 409);
  assert.equal(selfDeleteBody.error?.code, "CANNOT_DELETE_SELF");

  const studentDeleteResponse = await api(`/api/admin/users/${adminManagedUserId}`, {
    method: "DELETE",
    cookie: studentCookie,
  });
  assert.equal(studentDeleteResponse.status, 403);

  adminManagedUsageKey = `admin-user-cleanup:${Date.now()}`;
  await db.modelUsageDaily.create({
    data: {
      key: adminManagedUsageKey,
      usageDate: new Date(),
      scope: "USER",
      userId: adminManagedUserId,
      purpose: "ACCOUNT_DELETE_TEST",
      requestCount: 1,
    },
  });

  const deleteResponse = await api(`/api/admin/users/${adminManagedUserId}`, {
    method: "DELETE",
    cookie: adminCookie,
  });
  const deleteBody = await deleteResponse.json();
  assert.equal(deleteResponse.status, 200);
  assert.equal(deleteBody.data.deleted, true);
  assert.equal(deleteBody.data.user.email, adminManagedUserEmail);
  assert.equal(await db.user.findUnique({ where: { id: adminManagedUserId } }), null);
  assert.equal(await db.modelUsageDaily.findUnique({ where: { key: adminManagedUsageKey } }), null);
  adminManagedUserId = "";
  adminManagedUsageKey = "";

  const missingResponse = await api("/api/admin/users/account-that-does-not-exist", {
    method: "DELETE",
    cookie: adminCookie,
  });
  const missingBody = await missingResponse.json();
  assert.equal(missingResponse.status, 404);
  assert.equal(missingBody.error?.code, "NOT_FOUND");
});

test("AUTH-004：退出登录应清除浏览器会话", async () => {
  const response = await api("/api/auth/logout", { method: "POST", cookie: studentCookie });
  assert.equal(response.status, 200);
  const clearCookie = response.headers.get("set-cookie") || "";
  assert.match(clearCookie, /zx_session=;/);
  assert.match(clearCookie, /(Expires=Thu, 01 Jan 1970|Max-Age=0)/i);

  const meResponse = await api("/api/auth/me", { cookie: "zx_session=" });
  assert.equal(meResponse.status, 401);
});

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import { PrismaClient } from "@prisma/client";

const port = Number(process.env.UI_TEST_PORT || 3108);
const baseUrl = `http://127.0.0.1:${port}`;
const edgePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || (process.platform === "win32" ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" : "/usr/bin/google-chrome");
const db = new PrismaClient();
const startedAt = new Date();
let server;
let browser;
let output = "";
let createdUiQuestionId = "";
let createdRichQuestionId = "";
let createdRichMaterialId = "";
let createdRichMaterialQuestionIds = [];
const createdUiTrainingReportIds = [];
let initialPreference = null;
let initialModelConfig = null;
let initialStateLoaded = false;
const registeredUiEmail = `register.ui.${Date.now()}@example.com`;
const registeredUiPassword = "SecurePass123";
let registeredUiUserId = "";
const managedUiUserEmail = `admin-managed-ui-${Date.now()}@example.com`;
const protectedUiAdminEmail = `admin-protected-ui-${Date.now()}@example.com`;
let managedUiUserId = "";
let protectedUiAdminId = "";

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { const response = await fetch(baseUrl); if (response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`页面测试服务启动失败：${output.slice(-1500)}`);
}

async function login(page, email, password = "Demo123456") {
  await page.goto(baseUrl);
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录学习系统" }).click();
  await page.getByText("继续为目标努力吧").waitFor();
}

async function switchToRegister(page) {
  const switcher = page.getByRole("button", { name: "注册账号", exact: true });
  await switcher.waitFor();
  assert.ok(await switcher.count(), "登录页应提供切换到注册模式的按钮");
  await switcher.click();
  await page.getByRole("button", { name: "注册并开始学习" }).waitFor();
}

async function assertNoHorizontalOverflow(page, scene) {
  const dimensions = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  const actualWidth = Math.max(
    dimensions.documentScrollWidth,
    dimensions.bodyScrollWidth,
  );
  assert.ok(
    actualWidth <= dimensions.viewportWidth + 1,
    `${scene}存在横向溢出：${JSON.stringify(dimensions)}`,
  );
}

async function assertTouchTarget(locator, name) {
  await locator.scrollIntoViewIfNeeded();
  assert.equal(await locator.isVisible(), true, `${name}应在移动端可见`);
  const box = await locator.boundingBox();
  assert.ok(box, `${name}应具有可测量的触控区域`);
  assert.ok(
    box.width >= 43.5 && box.height >= 43.5,
    `${name}触控区域应至少为 44×44 CSS px，实际为 ${box.width.toFixed(1)}×${box.height.toFixed(1)}`,
  );
}

async function openMobileView(page, label) {
  const menuButton = page.getByRole("button", { name: "打开导航", exact: true });
  await assertTouchTarget(menuButton, "移动导航菜单按钮");
  await menuButton.click();
  const navButton = page
    .locator("button.nav-item:visible")
    .filter({ hasText: label });
  await assertTouchTarget(navButton, `移动导航“${label}”`);
  await navButton.click();
}

async function openPracticeScopeSelector(page) {
  const trigger = page.locator('button[aria-controls="practice-scope-options"]');
  await trigger.waitFor();
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
  await page.locator("#practice-scope-options").waitFor();
  return trigger;
}

async function selectOnlyPracticeScopes(page, selections) {
  const trigger = await openPracticeScopeSelector(page);
  await page.getByLabel("全部细分板块", { exact: true }).check();
  for (const { category, type } of selections) {
    const input = page.getByLabel(`选择${category}中的${type}`, { exact: true });
    if (!(await input.count())) {
      const expand = page.getByRole("button", { name: `展开${category}` });
      if (await expand.count()) await expand.click();
    }
    await page.getByLabel(`选择${category}中的${type}`, { exact: true }).check();
  }
  await trigger.click();
}

function planPreferenceGroup(form, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return form.getByRole("group", { name: new RegExp(`^${escapedName}`) });
}

function planOptionInput(form, groupName, optionName) {
  return planPreferenceGroup(form, groupName)
    .locator("label")
    .filter({ hasText: optionName })
    .first()
    .locator("input");
}

async function setPlanOption(form, groupName, optionName, checked = true) {
  const input = planOptionInput(form, groupName, optionName);
  const label = input.locator("..");
  await input.waitFor();
  if (await input.isChecked() !== checked) {
    await label.click();
  }
  assert.equal(await input.isChecked(), checked, `${groupName}中的“${optionName}”点选状态应正确`);
  return input;
}

async function assertStructuredTrainingReport(page, viewportWidth) {
  const breakdown = page.locator('section[aria-labelledby="training-breakdown-title"]');
  await breakdown.waitFor();
  const sections = breakdown.locator("article");
  assert.equal(await sections.count(), 2, "报告应按两个大板块展示，不能把细分题型提升为独立评价卡片");
  assert.equal(await breakdown.locator('[data-report-level="section"]').count(), 2);
  assert.equal(await breakdown.locator('[data-report-level="subtype"]').count(), 3);
  assert.equal(await breakdown.locator('[data-report-level="section-evaluation"]').count(), 2);

  const totalMetrics = (await breakdown.locator("header + div dl").innerText()).replace(/\s+/g, "");
  assert.match(totalMetrics, /共计8题/);
  assert.match(totalMetrics, /答对5题/);
  assert.match(totalMetrics, /答错2题/);
  assert.match(totalMetrics, /未答1题/);
  assert.match(totalMetrics, /用时3分55秒/);

  const logicSection = sections.nth(0);
  const dataSection = sections.nth(1);
  await logicSection.getByRole("heading", { name: "判断推理", exact: true }).waitFor();
  await dataSection.getByRole("heading", { name: "资料分析", exact: true }).waitFor();
  assert.deepEqual(await logicSection.locator("h4").allInnerTexts(), ["图形推理", "定义判断"]);
  assert.deepEqual(await dataSection.locator("h4").allInnerTexts(), ["文字资料"]);

  const logicMetrics = logicSection.locator("dl");
  const dataMetrics = dataSection.locator("dl");
  assert.equal(await logicMetrics.count(), 3, "判断推理应包含一个大板块指标行和两个细分指标行");
  assert.equal(await dataMetrics.count(), 2, "资料分析应包含一个大板块指标行和一个细分指标行");
  assert.equal(
    await logicMetrics.nth(0).evaluate((node) => getComputedStyle(node).display),
    viewportWidth < 640 ? "grid" : "flex",
    "指标在小屏应自动分列换行，在桌面应保持紧凑横排",
  );
  for (const text of await breakdown.locator("article dl").allInnerTexts()) {
    const compact = text.replace(/\s+/g, "");
    for (const label of ["总题数", "答对", "正确率", "用时", "难度"])
      assert.ok(compact.includes(label), `每个板块/细分指标行都应紧凑显示“${label}”：${compact}`);
    assert.equal(compact.includes("作答"), false, "大板块与细分行不应重复显示作答指标");
  }
  const logicSummary = (await logicMetrics.nth(0).innerText()).replace(/\s+/g, "");
  assert.match(logicSummary, /总题数3题/);
  assert.match(logicSummary, /答对2题/);
  assert.match(logicSummary, /正确率66\.7%/);
  assert.match(logicSummary, /用时1分35秒/);
  assert.match(logicSummary, /难度6\.4\/10/);
  const graphSummary = (await logicMetrics.nth(1).innerText()).replace(/\s+/g, "");
  assert.match(graphSummary, /总题数2题/);
  assert.match(graphSummary, /正确率50%/);
  assert.match(graphSummary, /用时1分01秒/);
  assert.match(graphSummary, /难度7\.2\/10/);

  await logicSection.getByText("判断推理板块AI解读：节奏基本稳定，应优先复盘图形推理失分。", { exact: true }).waitFor();
  await dataSection.getByText("资料分析板块AI解读：正确率尚可，下一轮应加强限时计算。", { exact: true }).waitFor();
  assert.equal(await logicSection.getByText("判断推理板块解读", { exact: true }).count(), 1);
  assert.equal(await dataSection.getByText("资料分析板块解读", { exact: true }).count(), 1);
  assert.equal(await page.getByText("不应展示的图形推理AI评价", { exact: true }).count(), 0);
  assert.equal(await page.getByText("不应展示的定义判断AI评价", { exact: true }).count(), 0);
  assert.equal(await page.getByText("不应展示的文字资料AI评价", { exact: true }).count(), 0);
  assert.equal(await page.getByText("练习评价", { exact: true }).count(), 0, "细分题型下不得再渲染评价标题");

  const overall = page.locator('section[aria-labelledby="overall-evaluation-title"]');
  await overall.getByText("本次练习整体解读", { exact: true }).waitFor();
  await overall.getByText("整体AI解读：本轮判断推理与资料分析表现存在差异，应先复盘图形推理，再安排资料分析限时题组。", { exact: true }).waitFor();
  const overallAfterBreakdown = await breakdown.evaluate((node, overallNode) =>
    Boolean(node.compareDocumentPosition(overallNode) & Node.DOCUMENT_POSITION_FOLLOWING),
    await overall.elementHandle(),
  );
  assert.equal(overallAfterBreakdown, true, "整体解读必须位于全部大板块及其解读之后");

  const overflowingMetricRows = await breakdown.locator("dl").evaluateAll((nodes) =>
    nodes.filter((node) => node.scrollWidth > node.clientWidth + 1).length,
  );
  assert.equal(overflowingMetricRows, 0, `${viewportWidth}px 报告指标行不得依赖横向滚动`);
  await assertNoHorizontalOverflow(page, `${viewportWidth}px 板块级训练总结`);
}

before(async () => {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { cwd: process.cwd(), env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", DISABLE_BACKGROUND_REPORT_EVALUATION: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (chunk) => { output += chunk.toString(); });
  server.stderr.on("data", (chunk) => { output += chunk.toString(); });
  await waitForServer();
  browser = await chromium.launch({ executablePath: edgePath, headless: true });
  const student = await db.user.findUnique({ where: { email: "student@zhizheng.local" } });
  if (student) initialPreference = await db.trainingPreference.findUnique({ where: { userId: student.id } });
  initialModelConfig = await db.modelConfig.findUnique({ where: { id: "default" } });
  initialStateLoaded = true;
});

beforeEach(async () => {
  const student = await db.user.findUnique({ where: { email: "student@zhizheng.local" }, select: { id: true } });
  if (!student) return;
  await Promise.all([
    db.practiceSession.updateMany({ where: { userId: student.id, status: "IN_PROGRESS" }, data: { status: "ABANDONED", completedAt: new Date() } }),
    db.examSession.updateMany({ where: { userId: student.id, status: "IN_PROGRESS" }, data: { status: "ABANDONED" } }),
  ]);
});

after(async () => {
  const student = await db.user.findUnique({ where: { email: "student@zhizheng.local" } });
  if (student) {
    if (createdUiTrainingReportIds.length)
      await db.trainingReport.deleteMany({ where: { id: { in: createdUiTrainingReportIds } } });
    await db.trainingReport.deleteMany({ where: { userId: student.id, createdAt: { gte: startedAt } } });
    await db.attempt.deleteMany({ where: { userId: student.id, createdAt: { gte: startedAt } } });
    await db.essaySubmission.deleteMany({ where: { userId: student.id, createdAt: { gte: startedAt } } });
    await db.studyPlan.deleteMany({ where: { userId: student.id, generatedAt: { gte: startedAt } } });
    await db.examSession.deleteMany({ where: { userId: student.id, startedAt: { gte: startedAt } } });
    await db.practiceSession.deleteMany({ where: { userId: student.id, startedAt: { gte: startedAt } } });
    if (initialStateLoaded) {
      if (initialPreference) { const preferenceData = { ...initialPreference }; delete preferenceData.id; delete preferenceData.userId; await db.trainingPreference.upsert({ where: { userId: student.id }, update: preferenceData, create: { userId: student.id, ...preferenceData } }); }
      else await db.trainingPreference.deleteMany({ where: { userId: student.id } });
    }
  }
  if (createdUiQuestionId) await db.question.deleteMany({ where: { id: createdUiQuestionId } });
  if (createdRichQuestionId) await db.question.deleteMany({ where: { id: createdRichQuestionId } });
  if (createdRichMaterialQuestionIds.length) await db.question.deleteMany({ where: { id: { in: createdRichMaterialQuestionIds } } });
  if (createdRichMaterialId) await db.questionMaterial.deleteMany({ where: { id: createdRichMaterialId } });
  await db.category.deleteMany({ where: { name: "页面测试分类", questions: { none: {} } } });
  await db.category.deleteMany({ where: { name: "页面图片测试分类", questions: { none: {} } } });
  await db.category.deleteMany({ where: { name: "页面材料测试分类", questions: { none: {} } } });
  if (registeredUiUserId) await db.user.deleteMany({ where: { id: registeredUiUserId } });
  else await db.user.deleteMany({ where: { email: registeredUiEmail } });
  if (managedUiUserId) await db.user.deleteMany({ where: { id: managedUiUserId } });
  if (protectedUiAdminId) await db.user.deleteMany({ where: { id: protectedUiAdminId } });
  if (initialStateLoaded) {
    if (initialModelConfig) {
      const data = { ...initialModelConfig }; delete data.id;
      await db.modelConfig.upsert({ where: { id: "default" }, update: data, create: { id: "default", ...data } });
    } else await db.modelConfig.deleteMany({ where: { id: "default" } });
  }
  await db.$disconnect();
  await browser?.close();
  server?.kill();
});

test("UI-011：访客可注册学员账号、退出并使用新账号重新登录", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(baseUrl);
  await switchToRegister(page);
  await page.getByLabel("姓名或昵称", { exact: true }).fill("页面注册学员");
  await page.getByLabel("邮箱", { exact: true }).fill(registeredUiEmail.toUpperCase());
  await page.getByLabel("密码", { exact: true }).fill(registeredUiPassword);
  await page.getByLabel("确认密码", { exact: true }).fill(registeredUiPassword);
  const targetExam = page.getByLabel("目标考试", { exact: true });
  if (await targetExam.count()) await targetExam.fill("2027 国家公务员考试");
  await page.getByRole("button", { name: "注册并开始学习" }).click();
  await page.getByText("继续为目标努力吧").waitFor();

  const created = await db.user.findUnique({ where: { email: registeredUiEmail } });
  assert.ok(created, "注册表单应真实创建用户记录");
  assert.equal(created.role, "STUDENT");
  registeredUiUserId = created.id;

  await page.getByRole("button", { name: "退出", exact: true }).click();
  await page.getByRole("button", { name: "登录学习系统" }).waitFor();
  await login(page, registeredUiEmail.toUpperCase(), registeredUiPassword);
  await page.getByText("继续为目标努力吧").waitFor();
  await context.close();
});

test("UI-016：签到生成动态今日目标且桌面、移动统计分开显示", async () => {
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await desktop.newPage();
  await login(page, registeredUiEmail, registeredUiPassword);
  const desktopMetrics = page.locator('[aria-label="本周学习统计"]:visible > div');
  assert.equal(await desktopMetrics.count(), 3, "桌面顶部应显示三个独立的周统计项");
  assert.equal(await page.getByText("签到生成目标", { exact: true }).count(), 1);
  const checkInResponse = page.waitForResponse((response) => response.url().endsWith("/api/daily-check-in") && response.request().method() === "POST");
  await page.getByRole("button", { name: "签到生成目标", exact: true }).click();
  const checkIn = await checkInResponse;
  assert.equal(checkIn.status(), 200, await checkIn.text());
  await page.locator("aside").getByText(/完成 \d+ 题和 \d+ 个任务/).waitFor();
  assert.equal(await page.getByText("签到生成目标", { exact: true }).count(), 0);
  await assertNoHorizontalOverflow(page, "1280px签到后学习首页");
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobile.newPage();
  await login(mobilePage, registeredUiEmail, registeredUiPassword);
  await mobilePage.getByRole("button", { name: "打开导航", exact: true }).click();
  const mobileMetrics = mobilePage.locator('[aria-label="本周学习统计"]:visible > div');
  assert.equal(await mobileMetrics.count(), 3, "移动端菜单应保留三个独立的周统计项");
  await mobilePage.getByRole("dialog", { name: "移动端导航" }).getByText(/完成 \d+ 题和 \d+ 个任务/).waitFor();
  await assertNoHorizontalOverflow(mobilePage, "390px签到目标菜单");
  await mobile.close();
});

test("UI-012：小屏注册页可完整滚动且无横向溢出", async () => {
  const context = await browser.newContext({ viewport: { width: 320, height: 568 } });
  const page = await context.newPage();
  await page.goto(baseUrl);
  await switchToRegister(page);
  const submit = page.getByRole("button", { name: "注册并开始学习" });
  await submit.scrollIntoViewIfNeeded();
  assert.equal(await submit.isVisible(), true, "小屏设备应能滚动到注册提交按钮");
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  assert.ok(Math.max(dimensions.scrollWidth, dimensions.bodyScrollWidth) <= dimensions.width + 1, `注册页横向尺寸异常：${JSON.stringify(dimensions)}`);
  await context.close();
});

test("UI-014：题干和选项中的图片标签应渲染为图片而不是源码", async () => {
  const category = await db.category.upsert({ where: { name: "页面图片测试分类" }, update: {}, create: { name: "页面图片测试分类" } });
  const question = await db.question.create({ data: { categoryId: category.id, type: "图形推理", stem: '请选择正确图形：<img src="/question-images/c0/c04a8fc08853530cec287235.png" alt="图形推理题干图" class="inline-img" style="display:inline;vertical-align:middle;">', options: ['<img src="/question-images/da/da52abe626a1d296a7e19640.png" alt="行内公式选项" style="display:inline;vertical-align:middle;max-height:1.5em;">', "文字选项B", "文字选项C", "文字选项D"], answer: 0, explanation: "图片标签应安全渲染。", difficulty: "基础", difficultyScore: 2, status: "PUBLISHED", externalKey: `ui-rich-question-${Date.now()}` } });
  createdRichQuestionId = question.id;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await login(page, "student@zhizheng.local");
  await openMobileView(page, "专项练习");
  await selectOnlyPracticeScopes(page, [{ category: "页面图片测试分类", type: "图形推理" }]);
  await page.getByLabel("专项题目数量").fill("5");
  await page.getByRole("button", { name: "应用并保存配置" }).click();
  const stemImage = page.getByAltText("图形推理题干图");
  await stemImage.waitFor();
  const formulaImage = page.getByAltText("行内公式选项");
  await formulaImage.waitFor();
  const stemBox = await stemImage.boundingBox();
  assert.ok(stemBox && stemBox.width >= 280, `图形推理题干图应响应式放大，实际宽度 ${stemBox?.width || 0}`);
  const formulaBox = await formulaImage.boundingBox();
  assert.ok(formulaBox && formulaBox.height <= 40, `α、β、分数等行内符号图不应放大，实际高度 ${formulaBox?.height || 0}`);
  await stemImage.click();
  await page.getByRole("dialog", { name: "题目图片大图预览" }).waitFor();
  await page.getByRole("button", { name: "关闭图片预览" }).click();
  assert.equal(await page.getByText(/<img\s+src=/).count(), 0, "页面不得显示原始 img 标签");
  await assertNoHorizontalOverflow(page, "图片选项题目");
  const resetTrigger = await openPracticeScopeSelector(page);
  await page.getByLabel("全部细分板块", { exact: true }).check();
  await resetTrigger.click();
  const resetPreference = page.waitForResponse((response) => response.url().includes("/api/training-preferences") && response.request().method() === "PUT");
  await page.getByRole("button", { name: "应用并保存配置" }).click();
  await resetPreference;
  await context.close();
});

test("UI-015：材料中的百分数小图应保留句内位置且不被放大", async () => {
  const category = await db.category.upsert({ where: { name: "页面材料测试分类" }, update: {}, create: { name: "页面材料测试分类" } });
  const material = await db.questionMaterial.create({
    data: {
      externalKey: `ui-rich-material-${Date.now()}`,
      title: "页面材料行内百分数回归测试",
      content: "2019年，G省完成邮政业务总量4403.44亿元，占全国的27.1%，比上年增长36.9%。",
      blocks: [{
        type: "richText",
        content: '2019年，G省完成邮政业务总量4403.44亿元，占全国的<img src="/question-materials/1609326466046/bala-3-1.png" alt="27.1%" class="inline-img" style="display:inline;vertical-align:middle;">，比上年增长<img src="/question-materials/1609326466046/bala-3-2.png" alt="36.9%" class="inline-img" style="display:inline;vertical-align:middle;">。',
      }],
    },
  });
  createdRichMaterialId = material.id;
  const questions = await Promise.all(Array.from({ length: 5 }, (_, index) => db.question.create({
    data: {
      categoryId: category.id,
      type: "资料分析",
      stem: `材料百分数显示测试题 ${index + 1}`,
      options: ["选项A", "选项B", "选项C", "选项D"],
      answer: 0,
      explanation: "材料中的百分数图片应按行内内容显示。",
      difficulty: "基础",
      difficultyScore: 2,
      status: "PUBLISHED",
      externalKey: `ui-rich-material-question-${Date.now()}-${index}`,
      materialId: material.id,
      materialOrder: index + 1,
    },
  })));
  createdRichMaterialQuestionIds = questions.map((question) => question.id);

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await login(page, "student@zhizheng.local");
  await openMobileView(page, "专项练习");
  await selectOnlyPracticeScopes(page, [{ category: "页面材料测试分类", type: "资料分析" }]);
  await page.getByLabel("专项题目数量").fill("5");
  await page.getByRole("button", { name: "应用并保存配置" }).click();

  const firstPercent = page.getByAltText("27.1%").first();
  const secondPercent = page.getByAltText("36.9%").first();
  await firstPercent.waitFor();
  const [firstBox, secondBox] = await Promise.all([firstPercent.boundingBox(), secondPercent.boundingBox()]);
  assert.ok(firstBox && firstBox.height <= 40, `27.1% 应按行内尺寸显示，实际高度 ${firstBox?.height || 0}`);
  assert.ok(secondBox && secondBox.height <= 40, `36.9% 应按行内尺寸显示，实际高度 ${secondBox?.height || 0}`);
  assert.equal(await firstPercent.evaluate((image) => image.closest("p")?.textContent?.includes("占全国的") && image.closest("p")?.textContent?.includes("比上年增长")), true, "百分数应与前后材料文字保留在同一段落");
  assert.equal(await page.getByText(/<img\s+src=/).count(), 0, "材料页面不得显示原始 img 标签");
  await assertNoHorizontalOverflow(page, "资料分析行内百分数");
  await context.close();
});

test("UI-001：学员可完成登录、练习、统计查看和退出", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await login(page, "student@zhizheng.local");
  assert.equal(await page.locator("aside").getByText("题库管理").count(), 0, "学员不应看到题库管理入口");
  await page.locator("aside").getByRole("button", { name: "专项练习" }).click();
  await page.getByText(/符合条件题库共 \d+ 道/).waitFor();
  await page.getByRole("button", { name: "下一题", exact: true }).click();
  await page.locator(".card").filter({ hasText: "练习进度" }).getByText(/^2\//).waitFor();
  await page.getByRole("button", { name: "上一题", exact: true }).click();
  await page.getByRole("button", { name: /^A\./ }).first().click();
  await page.locator(".card").filter({ hasText: "练习进度" }).getByText(/^2\//).waitFor();
  await page.getByRole("button", { name: "上一题", exact: true }).click();
  assert.equal(await page.getByText(/回答正确|需要再复习一下|正确答案：/).count(), 0, "专项完成前不得显示答案结果");
  assert.equal(await page.getByRole("button", { name: /^A\./ }).first().isDisabled(), true, "已答题应保持锁定");
  await page.locator("aside").getByRole("button", { name: "学习分析" }).click();
  await page.getByText("所有指标均根据当前账号作答记录计算").waitFor();
  await page.getByRole("button", { name: "退出" }).click();
  await page.getByRole("button", { name: "登录学习系统" }).waitFor();
  await context.close();
});

test("UI-002：管理员可进入真实题库管理页面", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await login(page, "admin@zhizheng.local");
  const adminButton = page.locator("aside").getByRole("button", { name: "管理后台" });
  assert.equal(await adminButton.count(), 1);
  await adminButton.click();
  const addButton = page.getByRole("button", { name: /新增题目/ });
  await addButton.waitFor();
  await page.getByPlaceholder("搜索题干、题型或分类").waitFor();
  await addButton.click();
  const stem = `页面表单新增题目 ${Date.now()}`;
  await page.getByLabel("分类").fill("页面测试分类");
  await page.getByLabel("题型").fill("单项选择");
  await page.getByLabel("题干").fill(stem);
  await page.getByLabel("选项 A").fill("甲选项");
  await page.getByLabel("选项 B").fill("乙选项");
  await page.getByLabel("选项 C").fill("丙选项");
  await page.getByLabel("选项 D").fill("丁选项");
  await page.getByLabel("答案解析").fill("该题用于确认管理端页面表单可以真实写入数据库。");
  const saveResponse = page.waitForResponse((response) => response.url().endsWith("/api/admin/questions") && response.request().method() === "POST");
  await page.getByRole("button", { name: "保存题目" }).click();
  const saved = await saveResponse;
  assert.equal(saved.status(), 201, await saved.text());
  await page.getByText(stem).waitFor();
  let created = null;
  for (let attempt = 0; attempt < 10 && !created; attempt += 1) {
    created = await db.question.findFirst({ where: { stem } });
    if (!created) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(created);
  createdUiQuestionId = created.id;
  await context.close();
});

test("UI-013：管理员可通过独立管理后台登录", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/admin`);
  await page.getByRole("heading", { name: "登录管理后台" }).waitFor();
  await page.getByLabel("管理员邮箱").fill("admin@zhizheng.local");
  await page.getByLabel("密码", { exact: true }).fill("Demo123456");
  await page.getByRole("button", { name: "登录管理后台" }).click();
  await page.getByText("题库与模型服务统一管理").waitFor();
  await page.getByPlaceholder("搜索题干、题型或分类").waitFor();
  await context.close();
});

test("UI-014：管理员可保存并重新读取模型 API 配置", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/admin`);
  await page.getByLabel("管理员邮箱").fill("admin@zhizheng.local");
  await page.getByLabel("密码", { exact: true }).fill("Demo123456");
  await page.getByRole("button", { name: "登录管理后台" }).click();
  await page.getByRole("button", { name: "模型 API" }).click();
  await page.getByRole("heading", { name: "模型 API 管理" }).waitFor();
  await page.locator("#model-api-key").fill("ui-test-model-api-key");
  await page.locator("#model-name").fill("ui-test-model");
  await page.locator("#model-base-url").fill("https://api.openai.com/v1");
  const enabled = page.getByRole("checkbox", { name: "启用模型服务" });
  if (!await enabled.isChecked()) await enabled.check();
  await page.getByRole("button", { name: "保存模型配置" }).click();
  await page.getByText("模型 API 配置已保存").waitFor();
  await page.reload();
  await page.getByRole("button", { name: "模型 API" }).click();
  assert.equal(await page.locator("#model-name").inputValue(), "ui-test-model");
  assert.equal(await page.locator("#model-base-url").inputValue(), "https://api.openai.com/v1");
  assert.equal(await page.locator("#model-api-key").inputValue(), "");
  assert.match(await page.locator("#model-api-key").getAttribute("placeholder"), /已配置/);
  await context.close();
  await db.modelConfig.update({ where: { id: "default" }, data: { enabled: false } });
});

test("UI-ADMIN-USER-001：管理员可在移动端筛选、核对并二次确认删除账号", async () => {
  const managedUser = await db.user.create({
    data: {
      name: "页面账号管理测试学员",
      email: managedUiUserEmail,
      passwordHash: "not-used-by-account-management-test",
      role: "STUDENT",
      targetExam: "广东省考",
      studyPlans: {
        create: {
          title: "页面账号关联计划",
          source: "RULE_BASED",
          summary: "用于验证关联数据计数。",
          tasks: [],
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      },
    },
  });
  managedUiUserId = managedUser.id;
  const protectedAdmin = await db.user.create({
    data: {
      name: "页面受保护管理员",
      email: protectedUiAdminEmail,
      passwordHash: "not-used-by-account-management-test",
      role: "ADMIN",
    },
  });
  protectedUiAdminId = protectedAdmin.id;

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/admin`);
  await page.getByLabel("管理员邮箱").fill("admin@zhizheng.local");
  await page.getByLabel("密码", { exact: true }).fill("Demo123456");
  await page.getByRole("button", { name: "登录管理后台" }).click();
  await page.getByRole("button", { name: "账号管理" }).click();
  await page.getByRole("heading", { name: "账号管理" }).waitFor();
  await assertNoHorizontalOverflow(page, "390px 账号管理首页");

  const search = page.getByPlaceholder("输入姓名或邮箱");
  const roleFilter = page.getByLabel("账号角色");
  await roleFilter.selectOption("ADMIN");
  await search.fill("admin@zhizheng.local");
  const currentSearchResponse = page.waitForResponse((response) => response.url().includes("/api/admin/users?") && response.url().includes("query=admin%40zhizheng.local"));
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await currentSearchResponse;
  const currentDelete = page.getByRole("button", { name: "当前账号不可删除" });
  await currentDelete.waitFor();
  assert.equal(await currentDelete.isDisabled(), true, "当前登录管理员的删除入口必须禁用");

  await page.route(`**/api/admin/users/${protectedAdmin.id}`, async (route) => {
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "LAST_ADMIN", message: "系统必须至少保留一个管理员账号", details: null } }),
    });
  });
  await search.fill(protectedUiAdminEmail);
  const protectedSearchResponse = page.waitForResponse((response) => response.url().includes("/api/admin/users?") && response.url().includes("admin-protected-ui-"));
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await protectedSearchResponse;
  const protectedCard = page
    .locator('section[aria-label="账号列表"] article:visible')
    .filter({ hasText: "页面受保护管理员" });
  await protectedCard.getByText("页面受保护管理员", { exact: true }).waitFor();
  await protectedCard
    .getByRole("button", { name: "删除账号 页面受保护管理员" })
    .click();
  const dialog = page.getByRole("dialog", { name: "确认删除账号" });
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "确认永久删除" }).click();
  await dialog.getByRole("alert").getByText("系统必须至少保留一个管理员账号").waitFor();
  assert.equal(await dialog.isVisible(), true, "删除被服务端拒绝时确认框必须保留并显示原因");
  await dialog.getByRole("button", { name: "取消" }).click();
  await page.unroute(`**/api/admin/users/${protectedAdmin.id}`);

  await roleFilter.selectOption("STUDENT");
  await search.fill(managedUiUserEmail);
  const userSearchResponse = page.waitForResponse((response) => response.url().includes("/api/admin/users?") && response.url().includes("admin-managed-ui-"));
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await userSearchResponse;
  const managedCard = page
    .locator('section[aria-label="账号列表"] article:visible')
    .filter({ hasText: "页面账号管理测试学员" });
  await managedCard.getByText("页面账号管理测试学员", { exact: true }).waitFor();
  await managedCard.getByText("计划 1", { exact: true }).waitFor();
  await assertNoHorizontalOverflow(page, "390px 账号筛选结果");

  await managedCard
    .getByRole("button", { name: "删除账号 页面账号管理测试学员" })
    .click();
  const deleteDialog = page.getByRole("dialog", { name: "确认删除账号" });
  await deleteDialog.getByText(/关联数据，此操作无法撤销/).waitFor();
  const deleteResponsePromise = page.waitForResponse((response) => response.url().endsWith(`/api/admin/users/${managedUser.id}`) && response.request().method() === "DELETE");
  await deleteDialog.getByRole("button", { name: "确认永久删除" }).click();
  const deleteResponse = await deleteResponsePromise;
  assert.equal(deleteResponse.status(), 200, await deleteResponse.text());
  await page.getByText(/账号“页面账号管理测试学员”已删除/).waitFor();
  assert.equal(await db.user.findUnique({ where: { id: managedUser.id } }), null);
  managedUiUserId = "";
  await assertNoHorizontalOverflow(page, "390px 删除账号完成状态");
  await context.close();
});

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
]) {
  test(`UI-003：${viewport.width}px 移动端核心学习流程无溢出且可触控`, async () => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await login(page, "student@zhizheng.local");

    await page.getByText("继续为目标努力吧").waitFor();
    await assertNoHorizontalOverflow(page, `${viewport.width}px 学习首页`);

    await openMobileView(page, "专项练习");
    await page.getByText(/符合条件题库共 \d+ 道/).waitFor();
    await assertNoHorizontalOverflow(page, `${viewport.width}px 专项练习配置`);
    const practiceCount = page.getByLabel("专项题目数量");
    await assertTouchTarget(practiceCount, "专项题目数量输入框");
    await practiceCount.fill("5");
    const applyPractice = page.getByRole("button", { name: "应用并保存配置" });
    await assertTouchTarget(applyPractice, "应用专项配置按钮");
    const practiceResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/questions/session?") &&
        response.url().includes("count=5"),
    );
    const practiceSessionResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/practice-sessions") &&
        response.request().method() === "POST",
    );
    await applyPractice.click();
    await Promise.all([practiceResponse, practiceSessionResponse]);
    const practiceOption = page.getByRole("button", { name: /^A\./ }).first();
    await assertTouchTarget(practiceOption, "专项练习答案选项");
    await practiceOption.click();
    await page.locator(".card").filter({ hasText: "练习进度" }).getByText(/^2\/5$/).waitFor();
    assert.equal(await page.getByRole("button", { name: "提交答案" }).count(), 0, "专项练习不应再要求手动提交答案");
    await page.getByRole("button", { name: /展开题号/ }).click();
    const practiceNavigator = page
      .locator(".card")
      .filter({ hasText: "练习进度" })
      .locator(".grid.grid-cols-5 button")
      .first();
    await assertTouchTarget(practiceNavigator, "专项练习题号导航");
    await assertNoHorizontalOverflow(page, `${viewport.width}px 专项练习答题`);
    const lastPracticeQuestion = page
      .locator(".card")
      .filter({ hasText: "练习进度" })
      .locator(".grid.grid-cols-5 button")
      .last();
    await lastPracticeQuestion.click();
    await page.getByRole("button", { name: /^A\./ }).first().click();
    await page.getByText("专项练习已完成").waitFor();
    await page.getByText("本次练习整体解读", { exact: true }).waitFor();
    await assertNoHorizontalOverflow(page, `${viewport.width}px 专项练习总结`);

    await openMobileView(page, "模拟考试");
    await assertNoHorizontalOverflow(page, `${viewport.width}px 模拟考试配置`);
    const provinceTemplate = page.getByRole("button", { name: /省考型/ });
    await assertTouchTarget(provinceTemplate, "省考型卷型按钮");
    await provinceTemplate.click();
    const generatePaper = page.getByRole("button", {
      name: "生成省考型试卷",
    });
    await assertTouchTarget(generatePaper, "生成模拟试卷按钮");
    const paperResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/questions/session?") &&
        response.url().includes("template=GUANGDONG_PROVINCE"),
    );
    await generatePaper.click();
    await paperResponse;
    const startExam = page.getByRole("button", { name: "开始考试" });
    await assertTouchTarget(startExam, "开始考试按钮");
    await startExam.click();
    const examOption = page.getByRole("button", { name: /^A\./ }).first();
    await assertTouchTarget(examOption, "模拟考试答案选项");
    await examOption.click();
    await page.getByText(/已作答 1\/90/).first().waitFor();
    await page.getByText("· 第 2 题", { exact: false }).waitFor();
    await page.getByRole("button", { name: /展开题号/ }).click();
    const examNavigator = page
      .locator(".card")
      .filter({ hasText: "答题导航" })
      .locator(".grid.grid-cols-5 button")
      .last();
    await assertTouchTarget(examNavigator, "模拟考试题号导航");
    await examNavigator.click();
    await page.getByRole("button", { name: /^A\./ }).first().click();
    await page.getByRole("button", { name: "确认交卷" }).waitFor();
    assert.equal(await page.getByText("考试报告", { exact: true }).count(), 0, "模考最后一题作答后仍应等待用户确认交卷");
    await assertNoHorizontalOverflow(page, `${viewport.width}px 模拟考试答题与导航`);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "放弃" }).click();
    await page.getByRole("button", { name: "开始考试" }).waitFor();

    await openMobileView(page, "每日任务");
    await page.getByRole("heading", { name: "每日任务" }).waitFor();
    const adjustButton = page.getByRole("button", { name: "调整设置" });
    if (await adjustButton.count()) await adjustButton.click();
    const planForm = page.getByTestId("study-plan-form");
    await planForm.waitFor();
    const dailyMinutesGroup = planForm.getByRole("group", {
      name: "每日学习分钟",
    });
    await setPlanOption(planForm, "每日学习分钟", "80 分钟");
    await assertTouchTarget(
      dailyMinutesGroup.locator("label").filter({ hasText: "80 分钟" }).first(),
      "80 分钟点选项",
    );
    assert.equal(await page.getByPlaceholder(/Base URL/).count(), 0);
    const generatePlan = page.getByRole("button", {
      name: "生成每日任务",
    });
    await assertTouchTarget(generatePlan, "生成每日任务按钮");
    const overflowingGroups = await planForm.locator("fieldset").evaluateAll(
      (groups) => groups.filter((group) => group.scrollWidth > group.clientWidth + 1).length,
    );
    assert.equal(overflowingGroups, 0, `${viewport.width}px 个性化点选区域不得横向滚动`);
    assert.equal(
      await generatePlan.evaluate((button) => button.scrollWidth <= button.clientWidth + 1),
      true,
      `${viewport.width}px 生成按钮文字不得被截断`,
    );
    await assertNoHorizontalOverflow(page, `${viewport.width}px 智能规划表单`);

    await context.close();
  });
}

test("UI-004：学员可完成模拟考试并查看报告", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await login(page, "student@zhizheng.local");
  await page.locator("aside").getByRole("button", { name: "模拟考试" }).click();
  await page.getByRole("button", { name: /省考型/ }).click();
  const paperResponse = page.waitForResponse((response) => response.url().includes("template=GUANGDONG_PROVINCE"));
  await page.getByRole("button", { name: "生成省考型试卷" }).click();
  await paperResponse;
  await page.getByRole("button", { name: "开始考试" }).click();
  const elapsedClock = page.getByLabel("模拟考试已用时间");
  await elapsedClock.waitFor();
  await elapsedClock.getByText("已用", { exact: true }).waitFor();
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await page.getByText("模拟考试已暂停，继续后才能作答和交卷").waitFor();
  assert.equal(await page.getByRole("button", { name: /^A\./ }).first().isDisabled(), true, "暂停时不得作答");
  await page.reload();
  await page.getByText("继续为目标努力吧").waitFor();
  await page.locator("aside").getByRole("button", { name: "模拟考试" }).click();
  await page.getByRole("button", { name: "继续", exact: true }).waitFor();
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByRole("button", { name: /^A\./ }).first().click();
  await page.getByText("· 第 2 题", { exact: false }).waitFor();
  await page.getByRole("button", { name: "提前交卷" }).click();
  await page.getByText("本次得分").waitFor();
  await page.getByText(/已作答 1 题/).waitFor();
  await page.getByText("考试总历时", { exact: true }).waitFor();
  await page.getByText("本次考试整体解读", { exact: true }).waitFor();
  await page.getByText("综合难度", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "逐题答案与解析" }).waitFor();
  await page.getByText(/模型不可用|由模型 API/).waitFor();
  await context.close();
});

test("UI-018：学习概览刷新失败不应阻断专项作答和模考总结", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await login(page, "student@zhizheng.local");

  await page.route("**/api/favorites", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "测试注入：收藏刷新失败" } }),
    });
  });
  await page.route("**/api/statistics/overview", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "测试注入：统计刷新失败" } }),
    });
  });

  await page.locator("aside").getByRole("button", { name: "专项练习" }).click();
  await page.getByText(/符合条件题库共 \d+ 道/).waitFor();
  const practiceFavoriteFailure = page.waitForResponse(
    (response) => response.url().endsWith("/api/favorites") && response.status() === 503,
  );
  const practiceOverviewFailure = page.waitForResponse(
    (response) => response.url().endsWith("/api/statistics/overview") && response.status() === 503,
  );
  await page.getByRole("button", { name: /^A\./ }).first().click();
  await Promise.all([practiceFavoriteFailure, practiceOverviewFailure]);
  await page.locator(".card").filter({ hasText: "练习进度" }).getByText(/^2\//).waitFor();

  await page.locator("aside").getByRole("button", { name: "模拟考试" }).click();
  await page.getByRole("button", { name: /省考型/ }).click();
  const paperResponse = page.waitForResponse(
    (response) => response.url().includes("template=GUANGDONG_PROVINCE"),
  );
  await page.getByRole("button", { name: "生成省考型试卷" }).click();
  await paperResponse;
  await page.getByRole("button", { name: "开始考试" }).click();
  await page.getByRole("button", { name: /^A\./ }).first().click();
  const examFavoriteFailure = page.waitForResponse(
    (response) => response.url().endsWith("/api/favorites") && response.status() === 503,
  );
  const examOverviewFailure = page.waitForResponse(
    (response) => response.url().endsWith("/api/statistics/overview") && response.status() === 503,
  );
  await page.getByRole("button", { name: "提前交卷" }).click();
  await Promise.all([examFavoriteFailure, examOverviewFailure]);
  await page.getByText("本次得分").waitFor();
  await page.getByText("本次考试整体解读", { exact: true }).waitFor();
  assert.deepEqual(pageErrors, [], "后台概览刷新失败不应产生未处理的页面异常");
  await context.close();
});

test("UI-005：专项练习最后一题应确认交卷且不能重复生成总结", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  let reportRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/training-reports")
      reportRequests += 1;
  });
  await login(page, "student@zhizheng.local");
  await page.locator("aside").getByRole("button", { name: "专项练习" }).click();
  const progressCard = page.locator(".card").filter({ hasText: "练习进度" });
  await progressCard.locator(".grid.grid-cols-5 button").last().click();
  await page.getByRole("button", { name: /^A\./ }).last().click();
  const confirm = page.getByRole("button", { name: /^(确认交卷|提前交卷)$/ });
  await confirm.waitFor();
  assert.equal(await page.getByText("专项练习已完成").count(), 0, "最后一题作答后必须等待用户确认交卷");
  await confirm.evaluate((element) => {
    element.click();
    element.click();
  });
  await page.getByText("专项练习已完成").waitFor();
  assert.equal(reportRequests, 1, "最后一题连续点击也只能生成一次练习总结");
  await page.getByText("练习时长", { exact: true }).waitFor();
  await page.getByText("本次练习整体解读", { exact: true }).waitFor();
  await page.getByText("训练情况", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "逐题答案与解析" }).waitFor();
  await page.locator("details").filter({ hasText: /第 \d+ 题/ }).first().click();
  await page.getByText("正确答案", { exact: true }).first().waitFor();
  await page.getByText(/模型不可用|由模型 API/).waitFor();
  await page.getByRole("button", { name: "重新练习" }).waitFor();
  await page.locator("aside").getByRole("button", { name: "学习分析" }).click();
  await page.getByRole("heading", { name: "最近训练总结" }).waitFor();
  await page.locator("section").filter({ hasText: "最近训练总结" }).locator("button").first().click();
  await page.getByRole("heading", { name: "训练总结详情" }).waitFor();
  await page.getByText("本次练习整体解读", { exact: true }).waitFor();
  await context.close();
});

test("UI-021：训练总结按大板块解读并在桌面与390px紧凑展示完整指标", async () => {
  const student = await db.user.findUnique({
    where: { email: "student@zhizheng.local" },
    select: { id: true },
  });
  assert.ok(student);
  const token = Date.now();
  const completedAt = new Date(Date.now() + 180_000);
  const title = `板块级训练总结测试-${token}`;
  const structuredReport = await db.trainingReport.create({
    data: {
      userId: student.id,
      clientKey: `ui-section-report:${token}`,
      mode: "PRACTICE",
      title,
      questionIds: [],
      attemptIds: [],
      questionDurations: {},
      durationSeconds: 235,
      total: 8,
      answered: 7,
      correct: 5,
      accuracy: 71.4,
      difficultyScore: 6.6,
      sections: [
        {
          key: "logic-reasoning",
          name: "判断推理",
          total: 3,
          answered: 3,
          correct: 2,
          accuracy: 66.7,
          durationSeconds: 95,
          difficultyScore: 6.4,
          evaluation: "判断推理板块AI解读：节奏基本稳定，应优先复盘图形推理失分。",
          subtypes: [
            {
              key: "graphic-reasoning",
              name: "图形推理",
              total: 2,
              answered: 2,
              correct: 1,
              accuracy: 50,
              durationSeconds: 61,
              averageDurationSeconds: 31,
              difficultyScore: 7.2,
              evaluation: "不应展示的图形推理AI评价",
            },
            {
              key: "definition-judgment",
              name: "定义判断",
              total: 1,
              answered: 1,
              correct: 1,
              accuracy: 100,
              durationSeconds: 34,
              averageDurationSeconds: 34,
              difficultyScore: 4.7,
              evaluation: "不应展示的定义判断AI评价",
            },
          ],
        },
        {
          key: "data-analysis",
          name: "资料分析",
          total: 5,
          answered: 4,
          correct: 3,
          accuracy: 75,
          durationSeconds: 140,
          difficultyScore: 6.8,
          evaluation: "资料分析板块AI解读：正确率尚可，下一轮应加强限时计算。",
          subtypes: [
            {
              key: "text-material",
              name: "文字资料",
              total: 5,
              answered: 4,
              correct: 3,
              accuracy: 75,
              durationSeconds: 140,
              averageDurationSeconds: 35,
              difficultyScore: 6.8,
              evaluation: "不应展示的文字资料AI评价",
            },
          ],
        },
      ],
      evaluationStatus: "READY",
      evaluationSource: "MODEL_API",
      overallEvaluation: "整体AI解读：本轮判断推理与资料分析表现存在差异，应先复盘图形推理，再安排资料分析限时题组。",
      startedAt: new Date(completedAt.getTime() - 235_000),
      completedAt,
    },
  });
  createdUiTrainingReportIds.push(structuredReport.id);

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await login(page, "student@zhizheng.local");
    if (viewport.width < 768)
      await openMobileView(page, "学习分析");
    else
      await page.locator("aside").getByRole("button", { name: "学习分析" }).click();
    const history = page.locator('section[aria-labelledby="recent-training-title"]');
    await history.getByText(title, { exact: true }).waitFor();
    await history.locator("button").filter({ hasText: title }).click();
    await page.getByRole("heading", { name: "训练总结详情" }).waitFor();
    await assertStructuredTrainingReport(page, viewport.width);
    await context.close();
  }
});

test("UI-017：学习分析可分页加载十条以外的训练总结", async () => {
  const student = await db.user.findUnique({
    where: { email: "student@zhizheng.local" },
    select: { id: true },
  });
  assert.ok(student);
  const token = Date.now();
  const completedAt = new Date(Date.now() + 120_000);
  const fixtures = await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      db.trainingReport.create({
        data: {
          userId: student.id,
          clientKey: `ui-pagination-test:${token}:${index}`,
          mode: "PRACTICE",
          title: `页面分页训练 ${token}-${String(index + 1).padStart(2, "0")}`,
          questionIds: [],
          attemptIds: [],
          questionDurations: {},
          durationSeconds: 90 + index,
          total: 1,
          answered: 1,
          correct: 1,
          accuracy: 100,
          difficultyScore: 5,
          sections: [],
          evaluationStatus: "FALLBACK",
          evaluationSource: "DATA_RULES",
          overallEvaluation: "用于验证训练总结历史记录加载更多。",
          startedAt: new Date(completedAt.getTime() - 90_000),
          completedAt,
        },
      }),
    ),
  );
  createdUiTrainingReportIds.push(...fixtures.map((item) => item.id));
  const sortedFixtures = await db.trainingReport.findMany({
    where: { id: { in: fixtures.map((item) => item.id) } },
    orderBy: [{ completedAt: "desc" }, { id: "desc" }],
  });
  const firstPageItem = sortedFixtures[0];
  const secondPageItem = sortedFixtures[10];

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await login(page, "student@zhizheng.local");
  await page.locator("aside").getByRole("button", { name: "学习分析" }).click();
  const history = page.locator('section[aria-labelledby="recent-training-title"]');
  await history.getByText(firstPageItem.title, { exact: true }).waitFor();
  assert.equal(
    await history.getByText(secondPageItem.title, { exact: true }).count(),
    0,
    "第 11 条总结不应提前出现在首屏",
  );
  assert.equal(await page.getByText("保留最近 10 次", { exact: true }).count(), 0);

  const nextPageResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/training-reports?") &&
      response.url().includes("cursor="),
  );
  await page
    .getByRole("button", { name: "加载更多训练总结", exact: true })
    .click();
  await nextPageResponse;
  await history.getByText(secondPageItem.title, { exact: true }).waitFor();
  const paginationTitlePattern = new RegExp(`^页面分页训练 ${token}-\\d{2}`);
  const paginationRows = history
    .locator("button")
    .filter({ hasText: paginationTitlePattern });
  assert.equal(
    await paginationRows.count(),
    fixtures.length,
    "加载更多后应展示全部分页测试总结且不重复",
  );
  assert.equal(
    new Set(
      (await paginationRows.allInnerTexts()).map((text) =>
        text.match(new RegExp(`页面分页训练 ${token}-\\d{2}`))?.[0],
      ),
    ).size,
    fixtures.length,
    "分页加载后每条测试总结只能出现一次",
  );
  await context.close();
});

test("UI-016：专项练习返回已答题时保持锁定且不能重复提交", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await login(page, "student@zhizheng.local");
  await page.locator("aside").getByRole("button", { name: "专项练习" }).click();
  const option = page.getByRole("button", { name: /^A\./ }).first();
  const progressSaved = page.waitForResponse((response) =>
    response.url().includes("/api/practice-sessions/") &&
    response.request().method() === "PATCH" &&
    response.request().postData()?.includes('"currentIndex":1'),
  );
  await option.click();
  await progressSaved;
  await page.locator(".card").filter({ hasText: "练习进度" }).getByText(/^2\//).waitFor();
  await page.getByRole("button", { name: "暂停练习", exact: true }).click();
  await page.getByText("练习已暂停，继续后才能作答").waitFor();
  await page.reload();
  await page.getByText("继续为目标努力吧").waitFor();
  await page.locator("aside").getByRole("button", { name: "专项练习" }).click();
  await page.getByText(/本轮 \d+ 道/).waitFor();
  await page.getByRole("button", { name: "继续练习", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /^A\./ }).first().isDisabled(), true, "专项暂停刷新后仍不得作答");
  await page.getByRole("button", { name: "继续练习", exact: true }).click();
  await page.getByRole("button", { name: "上一题", exact: true }).click();
  assert.equal(await page.getByText(/回答正确|需要再复习一下|正确答案：/).count(), 0, "专项交卷前不得显示正误、答案或解析");
  assert.equal(await page.getByRole("button", { name: "提交答案" }).count(), 0, "专项练习不应出现手动提交按钮");
  assert.equal(await page.getByRole("button", { name: /^A\./ }).first().isDisabled(), true, "已答题选项应锁定");
  assert.equal(await page.getByRole("button", { name: /第 1 题，已作答/ }).count(), 1, "已答题导航应保留完成标记");
  await context.close();
});

test("UI-020：专项自动提交失败时停留当前题且可安全重试", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  let answerRequests = 0;
  await page.route("**/api/questions/*", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    answerRequests += 1;
    if (answerRequests === 1) {
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "测试注入：答案保存失败" } }),
      });
    }
    return route.continue();
  });

  await login(page, "student@zhizheng.local");
  await page.locator("aside").getByRole("button", { name: "专项练习" }).click();
  await page.getByText(/符合条件题库共 \d+ 道/).waitFor();
  const progressCard = page.locator(".card").filter({ hasText: "练习进度" });
  const option = page.getByRole("button", { name: /^A\./ }).first();
  await option.evaluate((element) => {
    element.click();
    element.click();
  });
  await page.getByText("测试注入：答案保存失败", { exact: true }).waitFor();
  assert.equal(answerRequests, 1, "连续点击同一选项只能发出一次作答请求");
  assert.equal(await progressCard.getByText(/^1\//).count(), 1, "保存失败后应停留在当前题");
  assert.equal(await option.isEnabled(), true, "保存失败后应允许重新选择并提交");

  const retryResponse = page.waitForResponse((response) =>
    response.url().includes("/api/questions/") &&
    response.request().method() === "POST" &&
    response.status() === 200,
  );
  await option.click();
  await retryResponse;
  await progressCard.getByText(/^2\//).waitFor();
  assert.equal(answerRequests, 2, "用户重试时应发出新的作答请求");
  await context.close();
});

test("UI-010：未交卷模拟考试刷新后恢复进度和答案", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await login(page, "student@zhizheng.local");
  await page.locator("aside").getByRole("button", { name: "模拟考试" }).click();
  await page.getByRole("button", { name: /省考型/ }).click();
  const paperResponse = page.waitForResponse((response) => response.url().includes("template=GUANGDONG_PROVINCE"));
  await page.getByRole("button", { name: "生成省考型试卷" }).click();
  await paperResponse;
  await page.getByRole("button", { name: "开始考试" }).click();
  const answerSaved = page.waitForResponse((response) => response.url().includes("/api/exam-sessions/") && response.request().method() === "PATCH");
  await page.getByRole("button", { name: /^A\./ }).first().click();
  await page.getByText(/已作答 1\/90/).first().waitFor();
  await answerSaved;
  await page.reload();
  await page.getByText("继续为目标努力吧").waitFor();
  await page.locator("aside").getByRole("button", { name: "模拟考试" }).click();
  await page.getByText(/已作答 1\/90/).first().waitFor();
  await page.getByLabel("模拟考试已用时间").waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "放弃" }).click();
  await context.close();
});

test("UI-008：专项练习支持选择板块、难度和题量", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await login(page, "student@zhizheng.local");
  await page.locator("aside").getByRole("button", { name: "专项练习" }).click();
  await page.getByRole("button", { name: "收起设置", exact: true }).click();
  assert.equal(await page.getByLabel("专项题目数量").count(), 0);
  await page.getByRole("button", { name: "展开设置", exact: true }).click();
  const selectedScopes = [
    { category: "数量关系", type: "数学运算" },
    { category: "判断推理", type: "图形推理" },
  ];
  await selectOnlyPracticeScopes(page, selectedScopes);
  await page.getByLabel("专项题目数量").fill("10");
  await page.getByLabel("专项最低难度").selectOption("5");
  await page.getByLabel("专项最高难度").selectOption("8");
  const practiceResponse = page.waitForResponse((response) => response.url().includes("/api/questions/session?") && response.url().includes("count=10"));
  await page.getByRole("button", { name: "应用并保存配置" }).click();
  const practiceBody = await (await practiceResponse).json();
  assert.ok(practiceBody.data.items.every((item) => selectedScopes.some(
    (scope) => scope.category === item.category && scope.type === item.type,
  )));
  await page.getByText(/本轮 10 道/).waitFor();
  await page.getByText("已选 2 个细分板块", { exact: true }).waitFor();
  await page.getByLabel("专项练习已用时间").waitFor();
  await context.close();
});

test("UI-009：资料分析按完整材料五题练习", async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page, "student@zhizheng.local");
  await page.locator("aside").getByRole("button", { name: "专项练习" }).click();
  const trigger = await openPracticeScopeSelector(page);
  await page.getByLabel("全部细分板块", { exact: true }).check();
  await page.getByLabel("选择资料分析全部细分板块", { exact: true }).check();
  await trigger.click();
  await page.getByLabel("专项题目数量").fill("10");
  const response = page.waitForResponse((item) => item.url().includes("scopes="));
  await page.getByRole("button", { name: "应用并保存配置" }).click(); await response;
  await page.getByText("资料分析公共材料").first().waitFor();
  await page.getByText("本材料对应 5 道题").first().waitFor();
  await page.waitForTimeout(500);
  const desktopLayout = await page.locator('[data-testid="material-question-workspace"]').evaluateAll((nodes) => {
    const node = nodes.find((item) => item.getBoundingClientRect().width > 0);
    if (!node) return { articleCount: 0, sideBySide: false, material: null, questions: null };
    const material = node.querySelector(".material-source-pane")?.getBoundingClientRect();
    const questions = node.querySelector(".material-questions-pane")?.getBoundingClientRect();
    return {
      articleCount: node.querySelectorAll(".material-group-question").length,
      sideBySide: Boolean(material && questions && questions.left > material.right),
      material: material ? { left: material.left, right: material.right, top: material.top, bottom: material.bottom } : null,
      questions: questions ? { left: questions.left, right: questions.right, top: questions.top, bottom: questions.bottom } : null,
    };
  });
  assert.equal(desktopLayout.articleCount, 5, "桌面材料题工作区应连续包含完整五题");
  assert.equal(desktopLayout.sideBySide, true, `桌面端材料和题目应左右分栏：${JSON.stringify(desktopLayout)}`);
  const activeWorkspace = page.locator('[data-testid="material-question-workspace"]:visible').first();
  const progressDock = page.locator('[aria-label="练习进度面板"]');
  const dockLayout = await progressDock.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, width: rect.width };
  });
  assert.ok(Math.abs(dockLayout.right - 1440) < 2, `练习进度面板应贴紧视口最右侧：${JSON.stringify(dockLayout)}`);
  assert.ok(Math.abs(dockLayout.top - 72) < 2, `练习进度面板应固定在顶部导航下方：${JSON.stringify(dockLayout)}`);
  const collapse = progressDock.getByRole("button", { name: "收起练习工具" });
  await assertTouchTarget(collapse, "练习进度面板收起按钮");
  await page.evaluate(() => window.scrollTo(0, Math.min(620, document.documentElement.scrollHeight - window.innerHeight)));
  await page.waitForTimeout(150);
  const scrolledToggle = await collapse.boundingBox();
  assert.ok(scrolledToggle && scrolledToggle.y >= 72 && scrolledToggle.y + scrolledToggle.height <= 124, "页面滚动后练习工具收起按钮仍应固定可见");
  await collapse.click();
  await page.waitForTimeout(250);
  const collapsedLayout = await progressDock.evaluate((node) => {
    const dock = node.getBoundingClientRect();
    const workspace = document.querySelector('[data-testid="material-question-workspace"]');
    const questions = workspace?.querySelector(".material-questions-pane")?.getBoundingClientRect();
    return { dockWidth: dock.width, questionWidth: questions?.width || 0, articleCount: workspace?.querySelectorAll(".material-group-question").length || 0 };
  });
  assert.ok(collapsedLayout.dockWidth <= 54, `收起后的练习工具应为窄边栏，实际 ${collapsedLayout.dockWidth}px`);
  assert.ok(collapsedLayout.questionWidth >= 360, `收起练习工具后题目区仍应完整显示，实际 ${collapsedLayout.questionWidth}px`);
  assert.equal(collapsedLayout.articleCount, 5, "收起练习工具不能隐藏材料题");
  await progressDock.getByRole("button", { name: "展开练习工具" }).click();
  await page.waitForTimeout(250);
  const reopenedQuestionWidth = await activeWorkspace.evaluate((node) => {
    const questions = node.querySelector(".material-questions-pane")?.getBoundingClientRect();
    return questions?.width || 0;
  });
  assert.ok(reopenedQuestionWidth >= 360, "重新展开练习工具后题目区仍应保持显示");
  await activeWorkspace.locator(".material-group-question").first().locator(".material-question-option").first().click();
  await activeWorkspace.locator(".material-group-tabs button.is-active").filter({ hasText: "2题" }).waitFor();
  const swapQuestions = progressDock.getByRole("button", { name: "换一组题目", exact: true });
  assert.equal(await swapQuestions.isEnabled(), true, "练习稳定后换题按钮应可点击");
  const replacement = page.waitForResponse((item) => item.url().includes("/api/questions/session?") && item.url().includes("count=10"));
  await swapQuestions.click();
  await progressDock.getByRole("button", { name: "正在换题…", exact: true }).waitFor();
  assert.equal((await replacement).ok(), true, "点击换题应重新请求题组");
  await progressDock.getByRole("button", { name: "换一组题目", exact: true }).waitFor();
  await context.close();

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobileContext.newPage();
  await login(mobilePage, "student@zhizheng.local");
  await openMobileView(mobilePage, "专项练习");
  const mobileWorkspace = mobilePage.locator('[data-testid="material-question-workspace"]:visible').first();
  await mobileWorkspace.waitFor();
  await assertNoHorizontalOverflow(mobilePage, "390px材料题工作区");
  const collapsed = await mobileWorkspace.evaluate((node) => {
    const workspaceRect = node.getBoundingClientRect();
    const material = node.querySelector(".material-source-pane")?.getBoundingClientRect();
    const questions = node.querySelector(".material-questions-pane")?.getBoundingClientRect();
    return {
      articleCount: node.querySelectorAll(".material-group-question").length,
      overlay: Boolean(material && questions && questions.top > material.top && Math.abs(questions.bottom - material.bottom) < 2),
      ratio: questions ? questions.height / workspaceRect.height : 0,
    };
  });
  assert.equal(collapsed.articleCount, 5, "手机题板应保留完整五题");
  assert.equal(collapsed.overlay, true, "手机题板应覆盖在材料区下方");
  assert.ok(collapsed.ratio >= 0.5 && collapsed.ratio <= 0.62, `手机题板默认高度应接近半屏，实际 ${collapsed.ratio}`);
  const expand = mobilePage.getByRole("button", { name: "展开题目面板" });
  await assertTouchTarget(expand, "材料题板展开把手");
  await expand.click();
  await mobilePage.waitForTimeout(250);
  const expandedRatio = await mobileWorkspace.evaluate((node) => {
    const workspaceRect = node.getBoundingClientRect();
    const questions = node.querySelector(".material-questions-pane")?.getBoundingClientRect();
    return questions ? questions.height / workspaceRect.height : 0;
  });
  assert.ok(expandedRatio >= 0.84, `展开后的手机题板应占据主要视口，实际 ${expandedRatio}`);
  await mobileContext.close();
});

test("UI-006：学员可以完成申论作答并查看反馈", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await login(page, "student@zhizheng.local");
  await page.locator("aside").getByRole("button", { name: "申论训练" }).click();
  await page.getByText("阅读材料、限字作答").waitFor();
  const textarea = page.locator("textarea").first();
  await textarea.fill("材料中的主要问题包括老年人数字技能不足、平台适配不足、线上流程复杂和线下服务不足。建议优化产品设计，保留人工窗口，加强人员培训和社区教学，建立用户反馈机制并推动多方协同。\n同时应持续评估改造效果，保障不同群体平等便利地获得公共服务。");
  await page.getByRole("button", { name: "提交评阅" }).click();
  await page.getByText("作答反馈").waitFor();
  await page.getByText("查看参考答案").waitFor();
  await context.close();
});

test("UI-007：学员仅靠点选即可生成方案并在刷新后恢复个性化配置", async () => {
  await db.modelConfig.updateMany({ data: { enabled: false } });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await login(page, "student@zhizheng.local");
  await page.locator("aside").getByRole("button", { name: "每日任务" }).click();
  await page.getByRole("heading", { name: "每日任务" }).waitFor();
  const adjustButton = page.getByRole("button", { name: "调整设置" });
  if (await adjustButton.count()) await adjustButton.click();
  const form = page.getByTestId("study-plan-form");
  await form.waitFor();
  for (const heading of ["考试目标", "时间安排", "训练重点", "偏好限制"])
    await form.getByRole("heading", { name: heading, exact: true }).waitFor();
  for (const groupName of [
    "目标考试",
    "考试周期",
    "当前阶段",
    "每日学习分钟",
    "每周学习日",
    "常用学习时段",
    "优先提升板块",
    "主要提升目标",
    "偏好训练方式",
    "训练强度",
    "整卷模考频率",
    "申论训练频率",
    "验收方式",
    "其他限制",
  ])
    await planPreferenceGroup(form, groupName).waitFor();

  await form.getByLabel("每日最少任务", { exact: true }).waitFor();
  await form.getByLabel("每日最多任务", { exact: true }).waitFor();
  await form.getByLabel("单任务最大题量", { exact: true }).waitFor();

  assert.equal(await form.getByLabel("其他考试名称", { exact: true }).count(), 0);
  assert.equal(await form.getByLabel("考试日期", { exact: true }).count(), 0);
  assert.equal(await form.locator('input[type="number"]:visible').count(), 3);

  await setPlanOption(form, "目标考试", "其他考试");
  await form.getByLabel("其他考试名称", { exact: true }).waitFor();
  await setPlanOption(form, "目标考试", "广东省考");
  assert.equal(await form.getByLabel("其他考试名称", { exact: true }).count(), 0);
  await setPlanOption(form, "考试周期", "已确定日期");
  await form.getByLabel("考试日期", { exact: true }).waitFor();
  await setPlanOption(form, "考试周期", "1-3个月");
  assert.equal(await form.getByLabel("考试日期", { exact: true }).count(), 0);

  await setPlanOption(form, "当前阶段", "强化阶段");
  await setPlanOption(form, "每日学习分钟", "80 分钟");
  for (const day of ["周二", "周四", "周六"])
    await setPlanOption(form, "每周学习日", day, false);
  for (const day of ["周一", "周三", "周五", "周日"])
    await setPlanOption(form, "每周学习日", day);
  await setPlanOption(form, "常用学习时段", "工作日晚间");
  await setPlanOption(form, "常用学习时段", "周末上午");
  await setPlanOption(form, "优先提升板块", "根据表现自动推荐");
  await setPlanOption(form, "优先提升板块", "数量关系");
  await setPlanOption(form, "优先提升板块", "资料分析");
  await setPlanOption(form, "主要提升目标", "提高作答速度");
  await setPlanOption(form, "偏好训练方式", "限时题组");
  await setPlanOption(form, "训练强度", "高强度提升");
  await setPlanOption(form, "整卷模考频率", "每周1次");
  await setPlanOption(form, "申论训练频率", "每周1次");
  await form.getByLabel("每日最少任务", { exact: true }).fill("2");
  await form.getByLabel("每日最多任务", { exact: true }).fill("3");
  await form.getByLabel("单任务最大题量", { exact: true }).fill("15");
  await setPlanOption(form, "验收方式", "自验收", false);
  await setPlanOption(form, "其他限制", "工作日少安排");
  await setPlanOption(form, "其他限制", "每日任务均衡分配");
  await form.getByText("优先 1", { exact: true }).waitFor();
  await form.getByText("优先 2", { exact: true }).waitFor();
  const optionalNotes = form.getByText("补充特殊情况（选填）", { exact: true });
  await optionalNotes.waitFor();
  assert.equal(await optionalNotes.evaluate((node) => node.closest("details")?.open), false);

  assert.equal(await page.getByPlaceholder(/Base URL/).count(), 0);
  assert.equal(await page.getByPlaceholder(/API Key/).count(), 0);
  await page.getByText("模型服务由管理员统一配置").waitFor();
  const generateButton = page.getByRole("button", { name: "生成每日任务" });
  const requestPromise = page.waitForRequest(
    (request) => request.url().endsWith("/api/study-plan") && request.method() === "POST",
  );
  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/study-plan") && response.request().method() === "POST",
  );
  await generateButton.click();
  const [request, response] = await Promise.all([requestPromise, responsePromise]);
  assert.equal(response.status(), 201, await response.text());
  const submitted = JSON.parse(request.postData() || "{}");
  assert.equal(submitted.targetExam, "广东省公务员考试");
  assert.equal(submitted.examWindow, "ONE_TO_THREE_MONTHS");
  assert.equal(submitted.studyStatus, "REINFORCEMENT");
  assert.equal(submitted.dailyMinutes, 80);
  assert.equal(submitted.weeklyDays, 4);
  assert.deepEqual(submitted.activeWeekdays, ["MON", "WED", "FRI", "SUN"]);
  assert.deepEqual(submitted.focusAreas, ["数量关系", "资料分析"]);
  assert.equal(submitted.learningGoal, "SPEED");
  assert.ok(submitted.learningMethods.includes("TIMED_SETS"));
  assert.equal(submitted.intensity, "HIGH");
  assert.equal(submitted.mockExamPreference, "WEEKLY");
  assert.equal(submitted.essayPreference, "WEEKLY");
  assert.equal(submitted.minTasksPerDay, 2);
  assert.equal(submitted.maxTasksPerDay, 3);
  assert.equal(Object.hasOwn(submitted, "maxTaskMinutes"), false);
  assert.equal(submitted.maxQuestionsPerTask, 15);
  assert.deepEqual(submitted.acceptanceMethods, ["SYSTEM"]);
  assert.ok(submitted.constraints.includes("WORKDAY_LIGHT"));
  assert.ok(submitted.constraints.includes("BALANCE_DAILY_TASKS"));

  await page.getByRole("heading", { name: "广东省公务员考试 · 七日行动方案" }).waitFor();
  assert.ok(await page.getByText(/数据规则规划|模型自主规划|模型规划 · 系统补全/).count());
  await page.getByRole("heading", { name: "本周策略" }).waitFor();
  await page.getByText("动态调整规则").waitFor();
  await page.getByRole("heading", { name: "本周行动方案" }).waitFor();
  assert.ok(await page.getByText(/完成标准：/).count());

  await page.reload();
  await page.getByText("继续为目标努力吧").waitFor();
  await page.locator("aside").getByRole("button", { name: "每日任务" }).click();
  await page.getByRole("heading", { name: "每日任务" }).waitFor();
  await page.getByRole("button", { name: "调整设置" }).click();
  const restoredForm = page.getByTestId("study-plan-form");
  await restoredForm.waitFor();
  for (const [groupName, optionName] of [
    ["目标考试", "广东省考"],
    ["考试周期", "1-3个月"],
    ["当前阶段", "强化阶段"],
    ["每日学习分钟", "80 分钟"],
    ["每周学习日", "周日"],
    ["优先提升板块", "数量关系"],
    ["优先提升板块", "资料分析"],
    ["主要提升目标", "提高作答速度"],
    ["偏好训练方式", "限时题组"],
    ["训练强度", "高强度提升"],
    ["验收方式", "系统验收"],
    ["其他限制", "工作日少安排"],
    ["其他限制", "每日任务均衡分配"],
  ])
    assert.equal(
      await planOptionInput(restoredForm, groupName, optionName).isChecked(),
      true,
      `刷新后应恢复 ${groupName} 的“${optionName}”`,
    );
  assert.equal(
    await restoredForm.getByLabel("每日最少任务", { exact: true }).inputValue(),
    "2",
  );
  assert.equal(
    await restoredForm.getByLabel("每日最多任务", { exact: true }).inputValue(),
    "3",
  );
  assert.equal(
    await restoredForm.getByLabel("单任务最大题量", { exact: true }).inputValue(),
    "15",
  );
  assert.equal(
    await planOptionInput(restoredForm, "验收方式", "自验收").isChecked(),
    false,
  );
  await context.close();
});

test("UI-022：任务必须完成两项验收才能打卡并可在刷新后撤销", async () => {
  const student = await db.user.findUnique({
    where: { email: "student@zhizheng.local" },
    select: { id: true },
  });
  assert.ok(student);
  const token = Date.now();
  const task = {
    id: "task-01",
    day: 1,
    title: `任务验收持久化测试-${token}`,
    type: "TIMED_PRACTICE",
    target: "完成一组数量关系限时题并记录正确率与题均用时",
    minutes: 30,
    reason: "验证完成动作必须经过明确验收",
    priority: "HIGH",
    checkpoint: "正确率达到 75%，且没有单题超过 3 分钟",
    module: "数量关系",
    difficulty: "中等",
    questionCount: 10,
  };
  const plan = await db.studyPlan.create({
    data: {
      userId: student.id,
      title: `任务打卡测试计划-${token}`,
      source: "DATA_RULES",
      summary: "用于验证验收、打卡持久化和撤销流程。",
      tasks: [task],
      strategy: null,
      schemaVersion: 2,
      inputSnapshot: { preferences: { targetExam: "任务打卡测试" } },
      generationMeta: { source: "DATA_RULES" },
      generatedAt: new Date(Date.now() + 60_000),
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    },
  });

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await login(page, "student@zhizheng.local");
  await page.locator("aside").getByRole("button", { name: "每日任务" }).click();
  const card = page.getByTestId("study-plan-task-0");
  await card.getByText(task.title, { exact: true }).waitFor();
  const acceptanceToggle = card.getByRole("button", {
    name: "自我验收并打卡",
    exact: true,
  });
  assert.equal(await acceptanceToggle.getAttribute("aria-expanded"), "false");
  await acceptanceToggle.click();
  await card.locator('button[aria-expanded="true"]').waitFor();

  const acceptance = card.getByRole("group", {
    name: `${task.title}任务验收`,
    exact: true,
  });
  const checkboxes = acceptance.getByRole("checkbox");
  assert.equal(await checkboxes.count(), 2, "每项任务应同时验收任务内容与完成标准");
  await acceptance.getByText("任务内容已完成", { exact: true }).waitFor();
  await acceptance.getByText("完成标准已达到", { exact: true }).waitFor();
  await acceptance.getByText(task.target, { exact: true }).waitFor();
  await acceptance.getByText(task.checkpoint, { exact: true }).waitFor();
  const confirm = acceptance.getByRole("button", { name: "确认达标并打卡" });
  assert.equal(await confirm.isDisabled(), true, "未勾选验收步骤时不得打卡");
  await checkboxes.nth(0).check();
  assert.equal(await confirm.isDisabled(), true, "只完成一项验收时仍不得打卡");
  await checkboxes.nth(1).check();
  assert.equal(await confirm.isEnabled(), true);

  let postCount = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/study-plan/check-ins") && request.method() === "POST")
      postCount += 1;
  });
  const checkInResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/study-plan/check-ins") &&
      response.request().method() === "POST",
  );
  await confirm.click();
  const saved = await checkInResponse;
  assert.equal(saved.status(), 200, await saved.text());
  const submitted = JSON.parse(saved.request().postData() || "{}");
  assert.deepEqual(submitted, {
    planId: plan.id,
    taskIndex: 0,
    taskKey: task.id,
    confirmations: { taskCompleted: true, checkpointMet: true },
  });
  const completionStatus = card.getByRole("status");
  await completionStatus.getByText(/已完成 ·/).waitFor();
  assert.equal(postCount, 1, "一次确认动作只能提交一次打卡请求");
  assert.equal(
    await db.studyPlanCheckIn.count({ where: { planId: plan.id, taskKey: task.id } }),
    1,
  );

  await page.reload();
  await page.getByText("继续为目标努力吧").waitFor();
  await page.locator("aside").getByRole("button", { name: "每日任务" }).click();
  const restoredCard = page.getByTestId("study-plan-task-0");
  await restoredCard.getByRole("status").getByText(/已完成 ·/).waitFor();
  assert.equal(
    await restoredCard.getByRole("button", {
      name: "自我验收并打卡",
      exact: true,
    }).count(),
    0,
  );
  const undoResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/study-plan/check-ins") &&
      response.request().method() === "DELETE",
  );
  await restoredCard.getByRole("button", { name: "撤销打卡" }).click();
  const undone = await undoResponse;
  assert.equal(undone.status(), 200, await undone.text());
  assert.deepEqual(JSON.parse(undone.request().postData() || "{}"), {
    planId: plan.id,
    taskIndex: 0,
    taskKey: task.id,
  });
  await restoredCard
    .getByRole("button", { name: "自我验收并打卡", exact: true })
    .waitFor();
  assert.equal(
    await db.studyPlanCheckIn.count({ where: { planId: plan.id, taskKey: task.id } }),
    0,
  );
  await context.close();
});

test("UI-023：320px 与390px任务验收控件可触控且无横向溢出", async () => {
  const student = await db.user.findUnique({
    where: { email: "student@zhizheng.local" },
    select: { id: true },
  });
  assert.ok(student);
  const token = Date.now();
  const taskTitle = `移动端验收测试-${token}`;
  await db.studyPlan.create({
    data: {
      userId: student.id,
      title: `移动端任务打卡测试-${token}`,
      source: "DATA_RULES",
      summary: "用于验证移动端任务验收控件。",
      tasks: [
        {
          id: "task-01",
          day: 1,
          title: taskTitle,
          type: "PRACTICE",
          target: `完成十道资料分析题并记录用时-${"LONGUNBROKENTOKEN".repeat(24)}`,
          minutes: 30,
          reason: "验证移动端验收体验",
          priority: "HIGH",
          checkpoint: "正确率达到 80% 并完成错因记录",
          module: "资料分析",
          difficulty: "中等",
          questionCount: 10,
        },
        {
          id: "task-02",
          day: 2,
          title: `移动端休息任务-${token}`,
          type: "rest",
          target: "休息并调整训练状态",
          minutes: 10,
          reason: "避免连续训练造成疲劳",
          priority: "LOW",
          checkpoint: "完成休整",
          module: null,
          difficulty: null,
          questionCount: null,
        },
      ],
      strategy: null,
      schemaVersion: 2,
      inputSnapshot: { preferences: { targetExam: "移动端任务验收测试" } },
      generationMeta: { source: "DATA_RULES" },
      generatedAt: new Date(Date.now() + 120_000),
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    },
  });

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await login(page, "student@zhizheng.local");
    await openMobileView(page, "每日任务");
    const card = page.getByTestId("study-plan-task-0");
    await card.getByText(taskTitle, { exact: true }).waitFor();
    const openAcceptance = card.getByRole("button", {
      name: "自我验收并打卡",
      exact: true,
    });
    assert.equal(await openAcceptance.getAttribute("aria-expanded"), "false");
    await assertTouchTarget(openAcceptance, `${viewport.width}px 验收并打卡按钮`);
    await openAcceptance.click();
    await card.locator('button[aria-expanded="true"]').waitFor();
    const acceptance = card.getByRole("group", {
      name: `${taskTitle}任务验收`,
      exact: true,
    });
    const checkboxes = acceptance.getByRole("checkbox");
    assert.equal(await checkboxes.count(), 2);
    for (let index = 0; index < 2; index += 1) {
      const label = checkboxes.nth(index).locator("..");
      await assertTouchTarget(label, `${viewport.width}px 第${index + 1}项验收步骤`);
      await label.click();
    }
    const confirm = acceptance.getByRole("button", { name: "确认达标并打卡" });
    assert.equal(await confirm.isEnabled(), true);
    await assertTouchTarget(confirm, `${viewport.width}px 确认打卡按钮`);
    assert.equal(
      await confirm.evaluate((button) => button.scrollWidth <= button.clientWidth + 1),
      true,
      `${viewport.width}px 确认打卡按钮文字不得被截断`,
    );
    await assertNoHorizontalOverflow(page, `${viewport.width}px 任务验收展开状态`);
    await acceptance.getByRole("button", { name: "取消" }).click();
    await card.locator('button[aria-expanded="false"]').waitFor();
    const restCard = page.getByTestId("study-plan-task-1");
    await restCard.getByText(`移动端休息任务-${token}`, { exact: true }).waitFor();
    assert.equal(
      await restCard.getByRole("button", { name: "验收并打卡" }).count(),
      0,
      "REST 任务不得显示打卡入口",
    );
    const progress = page.getByText("本周打卡进度", { exact: true }).locator("..");
    assert.match(
      (await progress.innerText()).replace(/\s+/g, ""),
      /0\/1项/,
      "REST 任务不得进入打卡进度分母",
    );
    await context.close();
  }
});

test("UI-024：计划任务可启动真实专项、刷新恢复并由系统验收", async () => {
  const student = await db.user.findUnique({
    where: { email: "student@zhizheng.local" },
    select: { id: true },
  });
  assert.ok(student);
  await db.studyPlan.deleteMany({
    where: { userId: student.id, generatedAt: { gte: startedAt } },
  });
  const token = Date.now();
  const task = {
    id: "program-task-01",
    day: 1,
    title: `程序验收专项测试-${token}`,
    type: "PRACTICE",
    target: "完成 5 道计划专项题",
    minutes: 20,
    reason: "验证计划启动、证据绑定与系统验收闭环",
    priority: "HIGH",
    checkpoint: "完成 5 题，难度限定 1-10，由系统读取训练报告验收",
    module: null,
    difficulty: "1-10 分",
    questionCount: 5,
    completionSpec: {
      version: 1,
      kind: "PRACTICE",
      method: "PROGRAM",
      launch: {
        kind: "PRACTICE",
        questionCount: 5,
        category: null,
        questionPool: null,
        minDifficulty: 1,
        maxDifficulty: 10,
        durationMinutes: null,
      },
      evidence: { kind: "TRAINING_REPORT", mode: "PRACTICE" },
      minAnswered: 5,
      minAccuracy: null,
      maxElapsedSeconds: null,
      requiredModule: null,
      difficultyRange: { min: 1, max: 10 },
      minCompleteMaterialGroups: 0,
      requiredTemplateId: null,
    },
  };
  const generatedAt = new Date();
  const plan = await db.studyPlan.create({
    data: {
      userId: student.id,
      title: `程序验收测试计划-${token}`,
      source: "DATA_RULES",
      summary: "用于验证程序验收的前端完整流程。",
      tasks: [task],
      strategy: null,
      schemaVersion: 5,
      inputSnapshot: { preferences: { targetExam: "程序验收测试" } },
      generationMeta: { source: "DATA_RULES" },
      generatedAt,
      expiresAt: new Date(generatedAt.getTime() + 7 * 86_400_000),
    },
  });

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.route("**/api/study-plan/check-ins/verify*", async (route) => {
      const request = route.request();
      if (request.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              evidence: {
                id: `preview-evidence-${token}`,
                type: "TRAINING_REPORT",
                completedAt: new Date().toISOString(),
                summary: { answered: 3, accuracy: 60 },
              },
              checkIn: null,
            },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "ACCEPTANCE_NOT_MET",
            message: "本次训练尚未达到完成标准",
            details: {
              evidenceId: `preview-evidence-${token}`,
              criteria: { minAnswered: 5, difficultyRange: { min: 1, max: 10 } },
              actual: { answered: 3, difficultyRange: { min: 2, max: 8 } },
              gaps: [
                {
                  code: "MIN_ANSWERED",
                  field: "answered",
                  expected: 5,
                  actual: 3,
                  message: "还需完成 2 题",
                },
              ],
            },
          },
        }),
      });
    });
    await login(page, "student@zhizheng.local");
    await openMobileView(page, "每日任务");
    const card = page.getByTestId("study-plan-task-0");
    await card.getByText(task.title, { exact: true }).waitFor();
    const startTask = card.getByRole("button", { name: "开始任务", exact: true });
    const verifyTask = card.getByRole("button", { name: "系统验收", exact: true });
    await assertTouchTarget(startTask, `${viewport.width}px 开始计划任务`);
    await assertTouchTarget(verifyTask, `${viewport.width}px 系统验收`);
    assert.equal(
      await card.getByRole("button", { name: "自我验收并打卡", exact: true }).count(),
      0,
      "程序验收任务不得显示自我确认入口",
    );
    await verifyTask.click();
    const gapPanel = card.getByRole("region", { name: "系统验收差距" });
    await gapPanel.getByText("目标值", { exact: true }).waitFor();
    await gapPanel.getByText("实际值", { exact: true }).waitFor();
    await gapPanel.getByText("距离达标", { exact: true }).waitFor();
    await gapPanel.getByText("还需完成 2 题", { exact: true }).waitFor();
    await assertNoHorizontalOverflow(page, `${viewport.width}px 程序验收差距`);

    if (viewport.width === 320) {
      await context.close();
      continue;
    }

    await page.unroute("**/api/study-plan/check-ins/verify*");
    const sessionRequestPromise = page.waitForRequest(
      (request) =>
        request.url().endsWith("/api/practice-sessions") &&
        request.method() === "POST",
    );
    await startTask.click();
    const sessionRequest = await sessionRequestPromise;
    const sessionPayload = JSON.parse(sessionRequest.postData() || "{}");
    assert.deepEqual(sessionPayload.planContext, {
      planId: plan.id,
      taskKey: task.id,
      taskIndex: 0,
    });
    assert.equal(sessionPayload.config.count, 5);
    assert.equal(
      await page.getByLabel("专项题目数量").count(),
      0,
      "计划专项启动后应锁定训练配置",
    );
    await page.getByText(`计划任务：${task.title}`, { exact: true }).waitFor();

    await page.reload();
    await page.getByText(`计划任务：${task.title}`, { exact: true }).waitFor();
    await page.getByText(/本轮 5 道/).waitFor();
    for (let index = 0; index < 5; index += 1) {
      const option = page.getByRole("button", { name: /^A\./ }).first();
      await option.waitFor();
      await option.click();
      if (index < 4)
        await page
          .locator(".card")
          .filter({ hasText: "练习进度" })
          .getByText(new RegExp(`^${index + 2}/5$`))
          .waitFor();
    }
    await page.getByRole("button", { name: "确认交卷", exact: true }).last().click();
    await page.getByText("专项练习已完成").waitFor();
    const storedPlanContext = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("zhizheng:study-plan-task") || "null"),
    );
    assert.ok(storedPlanContext?.evidenceId, "训练完成后应保存报告证据 ID");
    const returnToPlan = page.getByRole("button", {
      name: "返回计划验收",
      exact: true,
    });
    await assertTouchTarget(returnToPlan, "390px 返回计划验收");
    const candidateResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/study-plan/check-ins/verify?") &&
        response.request().method() === "GET",
    );
    await returnToPlan.click();
    const candidateResponse = await candidateResponsePromise;
    assert.equal(candidateResponse.status(), 200, await candidateResponse.text());
    const candidateBody = await candidateResponse.json();
    assert.ok(candidateBody.data?.evidence, `应找到绑定的训练报告：${JSON.stringify(candidateBody)}`);
    assert.equal(candidateBody.data.evidence.id, storedPlanContext.evidenceId);

    const restoredCard = page.getByTestId("study-plan-task-0");
    try {
      await restoredCard.getByText(/已找到训练报告/).waitFor({ timeout: 5_000 });
    } catch {
      assert.fail(`候选证据未显示在任务卡片：${await restoredCard.innerText()}`);
    }
    const acceptanceResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/study-plan/check-ins/verify") &&
        response.request().method() === "POST",
    );
    await restoredCard.getByRole("button", { name: "系统验收", exact: true }).click();
    const acceptanceResponse = await acceptanceResponsePromise;
    assert.equal(acceptanceResponse.status(), 200, await acceptanceResponse.text());
    await restoredCard.getByRole("status").getByText(/系统验收通过/).waitFor();
    await restoredCard.getByText("验收证据摘要", { exact: true }).waitFor();
    assert.equal(
      await restoredCard.getByRole("button", { name: "撤销打卡" }).count(),
      0,
      "程序验收通过后不得由客户端撤销",
    );
    const savedCheckIn = await db.studyPlanCheckIn.findUnique({
      where: { planId_taskKey: { planId: plan.id, taskKey: task.id } },
    });
    assert.equal(savedCheckIn?.acceptanceMethod, "PROGRAM_VERIFIED");
    assert.equal(
      await page.evaluate(() => sessionStorage.getItem("zhizheng:study-plan-task")),
      null,
      "验收通过后应清理当前计划任务上下文",
    );
    await assertNoHorizontalOverflow(page, "390px 程序验收通过状态");
    await context.close();
  }
});

test("UI-025：程序模考与申论提交携带不可伪造的计划任务上下文", async () => {
  const student = await db.user.findUnique({
    where: { email: "student@zhizheng.local" },
    select: { id: true },
  });
  assert.ok(student);
  await db.studyPlan.deleteMany({
    where: { userId: student.id, generatedAt: { gte: startedAt } },
  });
  const token = Date.now();
  const examTask = {
    id: "program-exam-01",
    day: 1,
    title: `程序模考启动测试-${token}`,
    type: "EXAM",
    target: "完成一套国考地市级正式模考",
    minutes: 120,
    reason: "验证正式卷型与计划任务绑定",
    priority: "HIGH",
    checkpoint: "国考地市级 130 题，限时 120 分钟，由系统验收",
    module: null,
    difficulty: "正式卷",
    questionCount: 130,
    completionSpec: {
      version: 1,
      kind: "EXAM",
      method: "PROGRAM",
      launch: {
        kind: "EXAM",
        templateId: "NATIONAL_PREFECTURE",
        questionCount: 130,
        durationMinutes: 120,
      },
      evidence: { kind: "TRAINING_REPORT", mode: "EXAM" },
      minAnswered: 130,
      minAccuracy: null,
      maxElapsedSeconds: 7200,
      requiredModule: null,
      difficultyRange: null,
      minCompleteMaterialGroups: 0,
      requiredTemplateId: "NATIONAL_PREFECTURE",
    },
  };
  const essayTask = {
    id: "program-essay-02",
    day: 2,
    title: `程序申论提交测试-${token}`,
    type: "ESSAY",
    target: "完成一道申论题并提交评阅",
    minutes: 45,
    reason: "验证申论提交与计划任务绑定",
    priority: "MEDIUM",
    checkpoint: "不少于 20 字且不超过题目限字，由系统验收",
    module: "申论",
    difficulty: "基础",
    questionCount: 1,
    completionSpec: {
      version: 1,
      kind: "ESSAY",
      method: "PROGRAM",
      launch: { kind: "ESSAY" },
      evidence: { kind: "ESSAY_SUBMISSION" },
      minWordCount: 20,
      minScore: 0,
      withinWordLimit: true,
      requiredTemplateId: null,
    },
  };
  const generatedAt = new Date();
  const plan = await db.studyPlan.create({
    data: {
      userId: student.id,
      title: `程序多类型启动测试-${token}`,
      source: "DATA_RULES",
      summary: "验证模考和申论前端启动上下文。",
      tasks: [examTask, essayTask],
      strategy: null,
      schemaVersion: 4,
      inputSnapshot: { preferences: { targetExam: "2027 国考" } },
      generationMeta: { source: "DATA_RULES" },
      generatedAt,
      expiresAt: new Date(generatedAt.getTime() + 7 * 86_400_000),
    },
  });

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await login(page, "student@zhizheng.local");
  await openMobileView(page, "每日任务");
  const examCard = page.getByTestId("study-plan-task-0");
  await examCard.getByText(examTask.title, { exact: true }).waitFor();
  await examCard.getByRole("button", { name: "开始任务", exact: true }).click();
  const otherTemplate = page.getByRole("button", { name: /省考型/ });
  await otherTemplate.waitFor();
  assert.equal(await otherTemplate.isDisabled(), true, "程序模考不得切换为其他正式卷型");
  const startExam = page.getByRole("button", { name: "开始考试", exact: true });
  await startExam.waitFor();
  const examSessionRequestPromise = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/exam-sessions") &&
      request.method() === "POST",
  );
  const examSessionResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/exam-sessions") &&
      response.request().method() === "POST",
  );
  await startExam.click();
  const [examSessionRequest, examSessionResponse] = await Promise.all([
    examSessionRequestPromise,
    examSessionResponsePromise,
  ]);
  assert.equal(examSessionResponse.status(), 201, await examSessionResponse.text());
  const examPayload = JSON.parse(examSessionRequest.postData() || "{}");
  assert.deepEqual(examPayload.planContext, {
    planId: plan.id,
    taskKey: examTask.id,
    taskIndex: 0,
  });
  assert.equal(examPayload.config.templateId, "NATIONAL_PREFECTURE");
  assert.equal(examPayload.questionIds.length, 130);
  const examSessionBody = await examSessionResponse.json();
  await page.evaluate(async (sessionId) => {
    await fetch(`/api/exam-sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ABANDONED" }),
    });
  }, examSessionBody.data.id);

  await openMobileView(page, "每日任务");
  const essayCard = page.getByTestId("study-plan-task-1");
  await essayCard.getByText(essayTask.title, { exact: true }).waitFor();
  await essayCard.getByRole("button", { name: "开始任务", exact: true }).click();
  const answer = "一是完善公共服务流程，提高群众办事效率；二是强化协同监督，及时回应实际诉求。";
  await page.getByPlaceholder(/请在此输入申论答案/).fill(answer);
  const essayRequestPromise = page.waitForRequest(
    (request) =>
      request.url().includes("/api/essays/questions/") &&
      request.url().endsWith("/submit") &&
      request.method() === "POST",
  );
  const essayResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/essays/questions/") &&
      response.url().endsWith("/submit") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "提交评阅", exact: true }).click();
  const [essayRequest, essayResponse] = await Promise.all([
    essayRequestPromise,
    essayResponsePromise,
  ]);
  assert.equal(essayResponse.status(), 201, await essayResponse.text());
  const essayPayload = JSON.parse(essayRequest.postData() || "{}");
  assert.equal(essayPayload.content, answer);
  assert.deepEqual(essayPayload.planContext, {
    planId: plan.id,
    taskKey: essayTask.id,
    taskIndex: 1,
  });
  await page.getByRole("button", { name: "返回计划验收", exact: true }).waitFor();
  await assertNoHorizontalOverflow(page, "390px 程序申论提交结果");
  await context.close();
});

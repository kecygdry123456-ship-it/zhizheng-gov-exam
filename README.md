# 知政公考

基于 Next.js、TypeScript、Tailwind CSS、Prisma 与 PostgreSQL 的公考学习系统可用首版。

## 当前能力

学员端：

- 邮箱注册、登录、会话恢复和退出登录；注册成功后自动进入学习系统。
- 公开注册固定创建学员（`STUDENT`）账号，客户端不能借助注册接口创建管理员。
- 数据库题库专项练习。
- 服务端判题和答案解析。
- 收藏、错题复习和跨登录数据同步。
- 真实累计答题、正确率、模块能力和七天趋势。
- 限时模拟考试、统一交卷和成绩报告。
- 12224 道可用行测题，覆盖 160 套公开试卷并展示地区、年份和来源。
- 1035 道资料分析题以 207 份“完整材料 + 5 道题”的不可拆分题组提供，材料文字、表格和图片完整展示。
- 全题库 10 分制难度标注，并可结合真实错误率稳健校准。
- 专项训练可选择板块、题量和难度区间。
- 训练配置保存到账号，提供基础、进阶、困难、个性推荐和自定义档位，并实时显示可用题数。
- 模拟考试采用逐题作答和答题导航，自动保存答案，刷新或重新登录后可恢复未交卷考试。
- 3 套申论材料、6 道申论题、在线作答和反馈。
- 根据个人目标、可用时间、重点模块和真实作答数据生成七天智能学习计划。
- 可选使用用户本次输入的 OpenAI API Key 生成模型增强计划，Key 不写入数据库。
- 模型规划支持自定义 OpenAI 兼容 Base URL，并兼容 Responses 与 Chat Completions 接口。
- 统一重构的现代化桌面端和移动端响应式界面，包含新版登录/注册页、侧边导航、首页数据卡片、训练配置与清晰的加载、空状态和错误反馈。

管理员端：

- 管理员角色入口。
- 题库搜索和状态查看。
- 新增、编辑、发布和停用题目。
- 表单输入校验。
- 发布状态实时影响学员题库。

工程能力：

- PostgreSQL 持久化。
- Prisma 数据访问。
- Zod 输入校验。
- 统一接口错误结构。
- 服务状态检查接口。
- 接口集成测试和真实浏览器流程测试。
- Docker Compose、正式数据库迁移和持续集成配置。

## 技术栈

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS 4
- Prisma 6
- PostgreSQL 17
- Zod
- jose
- bcryptjs
- Node.js Test Runner
- Playwright Core + Microsoft Edge
- 可选 OpenAI 模型增强

## 本地启动

```bash
npm install
npm run db:generate
npx prisma db push
npm run db:seed
npm run db:import:public
npm run db:import:bala
npm run db:score:difficulty
npm run dev
```

访问 `http://localhost:3000`。

## 演示账号

- 学员：`student@zhizheng.local`
- 管理员：`admin@zhizheng.local`
- 初始密码：`Demo123456`

数据库连接和会话配置位于本地 `.env`，示例见 `.env.example`。

本地开发至少应配置 `DATABASE_URL` 和 `SESSION_SECRET`。正式环境必须使用独立的高强度 `SESSION_SECRET`；纯 HTTPS 入口设置 `COOKIE_SECURE=1`，兼容旧 HTTP 客户端的短期迁移阶段可使用 `auto`。公开注册接口始终只创建学员账号；管理员账号应通过受控的种子数据或后台运维流程创建。

移动端已针对 320px～平板宽度完成响应式适配，包含刘海屏安全区、可滚动导航、44px 触控目标、移动考试计时与答题导航、资料图表横向查看、软键盘弹窗和无横向溢出检查。云端推荐使用 Docker Compose + PostgreSQL + Nginx HTTPS，应用默认仅绑定 `127.0.0.1`，迁移容器、Web 容器和题库批处理容器相互分离。完整步骤见 [DEPLOYMENT.md](DEPLOYMENT.md)。

## 验证命令

```bash
npm test
```

该命令依次执行：

1. ESLint。
2. Prisma Schema 校验。
3. Next.js 生产构建与 TypeScript 检查。
4. 真实 PostgreSQL 接口测试。
5. Microsoft Edge 浏览器流程测试。

也可以单独运行：

```bash
npm run test:api
npm run test:ui
npm run lint
npm run build
```

服务状态检查：`GET /api/health`。

## 项目结构

```text
src/components/app/       学员、管理员和布局组件
src/app/api/              服务端接口
src/lib/validations/      共享输入校验
prisma/                   数据模型和种子数据
scripts/                  公开题库导入工具
public/question-materials/ 资料分析材料图片
tests/                    接口与浏览器流程测试
```

## 文档

- [迭代规划](./ITERATION_PLAN.md)
- [测试用例](./TEST_CASES.md)
- [验收报告](./ACCEPTANCE_REPORT.md)
- [部署说明](./DEPLOYMENT.md)
- [Luna 开发提示词](./LUNA_DEVELOPMENT_PLAN.md)
- [题目与套题难度算法](./DIFFICULTY_ALGORITHM.md)

下一阶段建议增加邮箱验证、修改与找回密码、完整试卷编排、错题间隔复习、申论材料管理和运营后台。

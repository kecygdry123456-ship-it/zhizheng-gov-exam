# 知政公考部署说明

## 1. 推荐服务器条件

- 2 核 CPU 或以上。
- 4 GB 内存或以上。
- 20 GB 可用磁盘。
- Linux 服务器。
- Docker Engine 与 Docker Compose。
- 已配置域名和 HTTPS 入口时，可使用现有网关转发到应用端口。

## 2. 准备生产配置

复制环境变量模板：

```bash
cp .env.production.example .env.production
```

编辑 `.env.production`：

```text
POSTGRES_PASSWORD=数据库密码
DATABASE_URL=postgresql://gov_exam:URL编码后的数据库密码@database:5432/gov_exam?schema=public
SESSION_SECRET=至少32位随机字符串
COOKIE_SECURE=auto
APP_PORT=3000
APP_BIND=127.0.0.1
APP_AUTO_SEED=0
QUESTION_MATERIALS_PATH=./public/question-materials
QUESTION_IMAGES_PATH=./public/question-images
OPENAI_API_KEY=可选
OPENAI_MODEL=可选，填写账号实际可用的模型标识
OPENAI_BASE_URL=可选，默认 https://api.openai.com/v1，可填写其他兼容接口地址
MODEL_REQUEST_TIMEOUT_MS=单次模型评价总超时，默认45000毫秒
MODEL_EVALUATION_DAILY_LIMIT=单个学员每日训练评价模型HTTP请求上限，默认50
MODEL_EVALUATION_GLOBAL_DAILY_LIMIT=全站每日训练评价模型HTTP请求上限，默认1000
ALLOW_PRIVATE_MODEL_BASE_URL=0
QUESTION_PROVINCES=可选，公开题库导入地区，使用英文逗号分隔
QUESTION_PAPER_LIMIT=可选，每个地区最多导入试卷数
QUESTION_REQUEST_INTERVAL_MS=可选，导入请求间隔毫秒数
HUATU_TARGET_PUBLISHED=可选，华图公开真题增量导入后的正式题目标数，默认50000
HUATU_REQUEST_CONCURRENCY=可选，华图公开真题详情并发数，默认6
HUATU_REQUEST_INTERVAL_MS=可选，华图单个并发工作线程的请求间隔毫秒数，默认20
```

`SESSION_SECRET` 用于签发登录与注册后的会话，生产环境缺失时应用会拒绝使用不安全的默认值。每个环境应使用独立、不可预测的高强度随机字符串，不要提交到版本库，也不要在多个生产系统之间复用。

`POSTGRES_PASSWORD` 是数据库容器收到的原始密码；`DATABASE_URL` 中的密码必须做 URL 编码。例如密码包含 `@`、`:`、`/`、`?`、`#` 或 `%` 时不能直接拼接，否则 Prisma 无法正确解析连接串。

只提供 HTTPS 的正式站点应设置 `COOKIE_SECURE=1`，使会话 Cookie 仅通过安全连接发送。需要在升级期同时兼容旧 HTTP 客户端时可设置 `COOKIE_SECURE=auto`：应用会依据可信反向代理传入的 `X-Forwarded-Proto`，仅在 HTTPS 请求中签发 Secure Cookie。完成客户端升级后应恢复为 `1`；不要在正式公网入口固定设置为 `0`。

`APP_BIND=127.0.0.1` 会让应用端口只对云服务器本机开放，由 Nginx/Caddy 对外提供 HTTPS，这是推荐配置。只有确实需要绕过反向代理直接访问容器端口时才改成 `0.0.0.0`，并同时配置安全组和防火墙。

全新空数据库首次启动时可以临时设置 `APP_AUTO_SEED=1` 写入基础分类和演示数据；完成首次初始化后应恢复为 `0`。正式更新默认只执行迁移，不会在每次容器重启时重复运行种子程序。

系统提供公开注册入口，但注册接口固定创建 `STUDENT` 学员账号，即使客户端提交管理员角色也不会提升权限。管理员账号应通过受控的种子数据、数据库迁移或后续管理后台创建，不能把公开注册接口作为管理员开户方式。

不配置模型服务时，规划仍会使用真实作答数据生成一周阶段目标；“每日任务”会依据阶段目标、作答记录和用户设置滚动生成当前一天任务。配置后会尝试使用模型增强规划；模型服务不可用时自动回到数据规则结果。

模型请求默认总计 45 秒超时，并拒绝重定向及解析到本机、私网、链路本地和云元数据地址的 Base URL，以避免云服务器 SSRF 风险。训练总结按学员限制每日模型评价次数，超过额度时自动生成规则评价，不影响成绩和统计。只有确实使用受信任的企业内网模型网关时，才可在确认网络边界后设置 `ALLOW_PRIVATE_MODEL_BASE_URL=1`。

## 3. 启动

```bash
docker compose --env-file .env.production up -d --build
```

启动流程会自动：

1. 等待 PostgreSQL 正常运行。
2. 执行 Prisma 正式迁移。
3. 迁移成功后启动非 root 的 Next.js standalone Web 容器。
4. 持续执行应用与数据库健康检查，并限制容器日志文件大小。

基础服务启动后，可在应用容器中独立执行公开题库导入：

```bash
docker compose --env-file .env.production --profile tools run --rm tools npm run db:import:public
docker compose --env-file .env.production --profile tools run --rm tools npm run db:import:bala
docker compose --env-file .env.production --profile tools run --rm tools npm run db:import:huatu
docker compose --env-file .env.production --profile tools run --rm tools npm run db:score:difficulty
```

两个公开题库导入工具都会按原始试卷和题目编号去重，可重复执行。第二来源会补充更完整的答案解析，并使用独立材料编号避免跨来源冲突。难度扫描会为所有题目更新 10 分制难度系数。这些批处理不放在容器自动启动流程中。

资料分析材料图片保存在 `public/question-materials`，题干和选项图片保存在 `public/question-images`。Compose 默认把这两个宿主机目录挂载进 Web 和批处理容器，既保留已有图片，也允许导入工具写入新图片。可通过 `QUESTION_MATERIALS_PATH` 和 `QUESTION_IMAGES_PATH` 改成独立数据盘目录。迁移服务器或备份时，应同时备份 PostgreSQL 数据和这两个目录；多台 Web 服务器部署时应迁移到共享对象存储或共享文件系统。

检查状态：

```bash
docker compose --env-file .env.production ps
curl http://127.0.0.1:3000/api/health
```

## 4. 更新版本

```bash
git pull
docker compose --env-file .env.production up -d --build
```

题目和申论种子使用幂等写入，重复启动不会重复创建相同内容。

## 5. 数据备份

创建备份：

```bash
docker compose --env-file .env.production exec -T database pg_dump -U gov_exam gov_exam > gov_exam_backup.sql
```

建议每天自动备份，并把备份文件复制到服务器之外的存储位置。

恢复前应先停止应用写入，再执行：

```bash
docker compose --env-file .env.production exec -T database psql -U gov_exam gov_exam < gov_exam_backup.sql
```

## 6. 日志和状态

```bash
docker compose --env-file .env.production logs -f app
docker compose --env-file .env.production logs -f database
```

应用和数据库均配置状态检查；进程异常退出时由 Compose 自动重启。单纯变为 `unhealthy` 不会触发 Docker 自动重启，因此云服务器监控还应针对容器健康状态与 `/api/health` 设置告警。该接口返回应用时间和数据库连接状态。

## 7. 正式域名与 HTTPS

仓库提供了可直接修改的 [Nginx 配置模板](deploy/nginx.zhizheng.conf)。推荐流程：

1. 域名 A/AAAA 记录指向云服务器。
2. 云安全组只开放 `22`、`80`、`443`，不要开放 PostgreSQL 的 `5432`。
3. 将模板中的 `example.com` 和证书路径替换为真实值。
4. 使用 Certbot 或云厂商证书服务签发并自动续期 HTTPS 证书。
5. Nginx 转发到 `127.0.0.1:3000` 并传递 `X-Forwarded-Proto`，环境变量保持 `APP_BIND=127.0.0.1`；纯 HTTPS 使用 `COOKIE_SECURE=1`，兼容升级期使用 `auto`。

模板已包含真实客户端 IP/协议转发、连接升级、上传大小限制、代理超时、HSTS 和常用安全响应头。证书生效前不要提前启用 HSTS 到包含其他未启用 HTTPS 的子域名。

若使用 Let's Encrypt 直接 IP 短期证书，证书有效期约 160 小时，必须使用支持 IP 证书的新版 Certbot、启用高频自动续签，并配置续签成功后的 Nginx reload hook。只有完成 `renew --dry-run` 和外网证书链校验后才能把客户端默认入口切到 HTTPS。

部署后应修改或移除演示账号，并根据运营要求决定是否展示公开注册入口。公开注册只提供学员身份；如暂不对外开放注册，应在网关或产品配置层限制注册入口，同时继续保留服务端角色限制。

## 8. 云服务器上线检查

```bash
docker compose --env-file .env.production config
docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production ps
curl -fsS http://127.0.0.1:3000/api/health
curl -I https://你的域名/api/health
```

同时确认：数据库和材料数据卷已加入异机备份；`SESSION_SECRET` 未使用示例值；应用端口没有对公网暴露；服务器时间与 NTP 正常；磁盘、内存和容器健康状态已接入监控告警。

## 9. 2026-07-15 程序验收版本发布记录

- 发布包：`dist/govexam-release-20260715-program-acceptance-r1.tgz`
- SHA-256：`6ef73f57c97c51149d57244b307d1f91db1aa48d45a121142ac58c687becda39`
- 发布脚本：`deploy/deploy-program-acceptance-20260715.sh`
- 新迁移：`20260720_program_acceptance`
- 线上镜像：`sha256:0fac30bb6637ba7a713adf9a671505070c1eb6e48b911b65e30193924ac35bc8`
- 数据库备份：`/opt/govexam/backups/pre-20260715-program-acceptance-r1-20260715-230043.dump`

发布脚本在应用停写后备份数据库，串行构建 migration 与 runner 镜像，迁移前后比较核心数据计数，并在健康检查或镜像核对失败时恢复旧应用镜像。服务器 `.env.production`、题目图片、资料图片和数据库卷不进入发布包，也不会被覆盖。

## 10. 2026-07-17 细分板块练习版本发布记录

- 发布包：`dist/govexam-release-20260717-practice-subtypes-r1.tgz`
- SHA-256：`eb34b7892c54357081235b7ba73f995d79775335d9c71580c81be98aa17e5d1f`
- 发布编号：`20260717-practice-subtypes-r1`
- 新迁移：`20260721_practice_subtype_scopes`
- 线上镜像：`sha256:095a086190f714bc5dd550e0c359877465a8eb903c8ccb4bde6478a651a410ce`
- 数据库备份：`/opt/govexam/backups/pre-20260717-practice-subtypes-r1-20260717-002516.dump`
- 代码备份：`/opt/govexam/backups/pre-20260717-practice-subtypes-r1-20260717-002454-code.tgz`
- 数据核对：迁移前后核心计数均为 `3,20683,180,5,18,6`

发布后应用与数据库容器均为 `healthy`，公网 HTTPS 健康检查、细分板块分类接口、跨板块 scopes 可用量与五题随机组题均已验证通过。

## 11. 2026-07-17 规划约束与正计时版本发布记录

- 发布包：`dist/govexam-release-20260717-planning-timing-r1.tgz`
- SHA-256：`485777cd38737a66e88c37b7d6d79132bab122f87fcdb10e69168ad61793e5c6`
- 发布编号：`20260717-planning-timing-r1`
- 线上镜像：`sha256:45b7b1ea4602bb9527eaf6dfd88c1dd5bac026a03c6a107789b5a4ef17f82d90`
- 数据库备份：`/opt/govexam/backups/pre-20260717-planning-timing-r1-20260717-130727.dump`
- 代码备份：`/opt/govexam/backups/pre-20260717-planning-timing-r1-20260717-130546-code.tgz`
- 数据核对：切换前后核心计数均为 `3,20683,183,5,19,6`

发布后已验证智能规划自定义单日任务上限、单任务最大题量、系统/自验收选择、细分题型动态计时 prompt、专项练习正计时、模拟考试正计时显示、设置折叠和任务操作按钮对齐。线上临时验收账号已删除。

## 12. 2026-07-17 题目级难度、暂停与规划均衡版本发布记录

- 发布包：`dist/govexam-release-20260717-knowledge-pause-planning-r1.tgz`
- SHA-256：`555b72a9cd2bd4de7872eacb59757ab175ba8773c59d8a1d00d16428bd505839`
- 发布编号：`20260717-knowledge-pause-planning-r1`
- 新迁移：`20260722_session_pause_state`
- 线上镜像：`sha256:4777d57f1f856aa93a907c6e2c3ffe50a81eb8217739eb01a9a333fb7eeaf282`
- 数据库备份：`/opt/govexam/backups/pre-20260717-knowledge-pause-planning-r1-20260717-181654.dump`
- 难度重算前备份：`/opt/govexam/backups/pre-knowledge-rescore-20260717-20260717-182340.dump`
- 代码备份：`/opt/govexam/backups/pre-20260717-knowledge-pause-planning-r1-20260717-181524-code.tgz`
- 数据核对：迁移前、迁移后及难度重算后核心计数均为 `3,20683,216,8,22,6`

本次发布按题目知识点数量、题库稀有度、精确记忆标记与真实错误率细化政治理论和普通常识难度；线上重算 4108 道常识题后，政治理论中位数为 6.4，普通常识中位数为 5.8。专项与模考均增加持久化暂停、暂停作答锁定、刷新恢复和有效用时计算；专项交卷前不再下发答案，专项与模考结算均提供逐题答案和解析。随机组题增加近期题目及重复题干过滤。智能规划删除单任务时间上限，改用每日任务数范围与可选均衡分配约束，并保证每周一次或两次模考生成正式固定卷任务。

发布前通过 55 项单元测试、53 项接口测试和 27 项浏览器 UI 测试。发布后应用与数据库容器均为 `healthy`，本机和公网 HTTPS 健康接口均验证通过。

## 13. 2026-07-17 动态正确率与宽松计时验收版本发布记录

- 发布包：`dist/govexam-release-20260717-dynamic-acceptance-r1.tgz`
- SHA-256：`2b3a46b82df2c67625463bdf4ef838c25d5ea3607bdb460fe63ae1cbcdca55dd`
- 发布编号：`20260717-dynamic-acceptance-r1`
- 线上镜像：`sha256:1390bf4d958e4013adfab8679762a7fee8b04c1b998010777aa3519980e32fea`
- 数据库备份：`/opt/govexam/backups/pre-20260717-dynamic-acceptance-r1-20260717-193340.dump`
- 代码备份：`/opt/govexam/backups/pre-20260717-dynamic-acceptance-r1-20260717-193305-code.tgz`
- 数据核对：迁移前后核心计数均为 `3,50402,216,8,23,6`

本次发布将专项任务的最低正确率改为随计划难度动态变化：高难任务降低正确率门槛，基础任务提高掌握要求，诊断测评不设固定正确率门槛。规划分钟数改为“建议用时”，验收最长用时在建议值上按板块增加缓冲：数量关系至少 60%，资料分析至少 50%，其他板块至少 25%，高难任务再追加难度余量。任务摘要和完成标准统一从服务端完成规格生成，不再接受模型输出互相矛盾的固定正确率或时间。

## 14. 2026-07-23 每日任务与一周阶段规划版本发布记录

- 发布包：`dist/govexam-release-20260723-daily-weekly-planning-r1.tgz`
- SHA-256：`fd5349837a984b1163d70c90671ef6c0739594dfc6048aafb8cbbb944975fcbd`
- 发布编号：`20260723-daily-weekly-planning-r1`
- 线上镜像：`sha256:e9248b576257161ee7a5fd03aca5d2b5e9ac17273d7f63c68df5d61ca43976b4`
- 数据库备份：`/opt/govexam/backups/pre-20260723-daily-weekly-planning-r1-20260718-001449.dump`
- 数据核对：迁移前后核心计数均为 `3,50402,216,8,24,6`

本次发布将原“智能规划”拆分为“每日任务”和“规划”：每日任务只生成当前一天，并在整份任务完成后幂等累计次数并自动续下一份；规划只生成未来一周的阶段目标、达成标准、资源分配和调整原则。新增 `WeeklyStudyPlan` 数据表与 `20260723_daily_and_weekly_planning` 迁移，应用和数据库容器均已通过健康检查，公网 `/api/health` 已验证。

## 15. 2026-07-18 普通常识计划任务组题修复发布记录

- 发布包：`dist/govexam-release-20260718-general-knowledge-plan-fix-r1.tgz`
- SHA-256：`c6a2437206902f7715fe109f8c9ffda64f6a69138e62eba946e2f657df193e92`
- 发布编号：`20260718-general-knowledge-plan-fix-r1`
- 线上镜像：`sha256:e38c81da79d4716f1d13f86fbe2d0f883a62744bbc7fc55b027395ac3dc094f8`
- 数据库备份：`/opt/govexam/backups/pre-20260718-general-knowledge-plan-fix-r1-20260718-192810.dump`
- 数据核对：迁移前后核心计数均为 `3,50402,216,8,26,6`

本次修复将通用细分类型“常识判断”纳入普通常识题型池，同时继续按题干关键词排除明显政治理论题目；计划任务组题不足或为空时不再创建无效专项会话。线上按截图对应条件验证，可用题量为 4,155 道并成功抽取 20 道。

发布前通过 56 项单元测试、53 项接口测试和 27 项浏览器 UI 测试。发布脚本完成数据库备份、镜像回滚点、数据计数核对和容器健康检查。

## 16. 2026-07-18 逐题难度与专项答案修改版本发布记录

- 发布包：`dist/govexam-release-20260718-editable-practice-item-difficulty-r2.tgz`
- SHA-256：`db08230e20db27f9e0366c87931817b726b4108ee8ebcc2d52fe4454182d83f8`
- 发布编号：`20260718-editable-practice-item-difficulty-r2`
- 线上镜像：`sha256:779dcf041cd69987b18df54d648a15660d0937dc61ab8566e805945ade54d0d3`
- 数据库备份：`/opt/govexam/backups/pre-20260718-editable-practice-item-difficulty-r2-20260718-203623.dump`
- 难度重算前备份：`/opt/govexam/backups/pre-item-difficulty-rescore-20260718-204019.dump`
- 代码备份：`/opt/govexam/backups/pre-20260718-editable-practice-item-difficulty-r2-20260718-203621-code.tgz`
- 数据核对：重算前后核心计数均为 `3,50402,246,10,26,8`

本次发布不再采用华图来源中按板块或整组材料统一提供的难度值。常识判断按知识点数量、题库稀有度、精确记忆要求、题面结构和真实错误率逐题定档；资料分析材料组进一步按每道小题的直接读数、增长率、增长量、基期、比重、平均数、复合计算与综合判断复杂度分别定档。线上重算常识判断及材料题 14,000 道后，已发布常识题分布在 3.0 至 10.0，共 71 个不同分值，恰好为 6.0 的题目为 260 道；1,030 个有效材料组中 1,008 组具有组内不同难度，逐题计算后恰好同分的组为 22 个。

专项练习同时支持交卷前返回并修改已作答题目的答案；服务端覆盖会话内原作答记录，不新增重复 Attempt，最后一题改为由用户确认交卷。发布前通过 lint、TypeScript、生产构建和 57 项单元测试，线上应用、数据库及公网健康接口均已验证。

## 17. 2026-07-18 全题库逐题难度重算记录

- 发布包：`dist/govexam-release-20260718-full-difficulty-rescore-r3.tgz`
- SHA-256：`7f52a03d69315c90330120947cc4d22716883b0df99b9dd81738b83d23d51c71`
- 发布编号：`20260718-full-difficulty-rescore-r3`
- 线上 Web 镜像：`sha256:779dcf041cd69987b18df54d648a15660d0937dc61ab8566e805945ade54d0d3`
- 线上批处理镜像：`sha256:120073328e0be342bcb6d7dd2b9fc648582b0674c83af0bd4ae957be96eca35c`
- 数据库备份：`/opt/govexam/backups/pre-full-difficulty-rescore-20260718-213403.dump`
- 重算脚本备份：`/opt/govexam/backups/pre-20260718-full-difficulty-rescore-r3-20260718-213129-score-question-difficulty.ts`
- 数据核对：重算前后核心计数均为 `3,50402,266,12,26,9`

本次将逐题难度算法应用到全部 50,402 道题，不再只处理常识判断和材料题。已发布五大板块共 50,269 道题，恰好为 6.0 的题目由两万余道降至 1,081 道，占比 2.15%。重算后各板块的 6.0 题量分别为：常识判断 260、言语理解 207、判断推理 526、数量关系 0、资料分析 88；各板块分别具有 40 至 71 个不同的一位小数分值。

进一步按细分题型审计，所有题量不少于 10 道的细分板块均具有多个不同分值，没有统一为单一难度的细分板块。重算期间唯一进行中的专项会话为零作答、1 至 10 难度范围，会话题目、答案和计划任务未变，整套难度快照已同步刷新。发布前通过 lint、TypeScript 和全库 dry-run，发布后应用、数据库和公网健康接口均正常。

## 18. 2026-07-18 材料题桌面分栏与手机题板版本发布记录

- 发布包：`dist/govexam-release-20260718-material-question-workspace-r4.tgz`
- SHA-256：`50a55286892267f5963dfe3bc21624ae9f4cfcf048e5dcccc4ebe57fc48e87a1`
- 发布编号：`20260718-material-question-workspace-r4`
- 线上镜像：`sha256:84c35e03cea45e65159e9aefe3415f76ec81169c572bd6604885d3b8cc8cb52f`
- 数据库备份：`/opt/govexam/backups/pre-20260718-material-question-workspace-r4-20260718-223319.dump`
- 代码备份：`/opt/govexam/backups/pre-20260718-material-question-workspace-r4-20260718-223319-code.tgz`
- 数据核对：切换前后核心计数均为 `3,50402,266,12,26,9`

本次将专项练习与模拟考试中的材料题统一改为材料题工作区。桌面端采用左右独立滚动分栏，左侧持续显示完整材料，右侧按材料顺序连续展示组内全部小题并提供题号定位；材料图片按容器完整缩放，表格保留横向滚动。手机端采用覆盖在材料下方的底部题板，默认高度 56%，可点击把手或上下滑动展开至 88%，并增加吸顶计时、暂停按钮和组内进度。普通无材料题维持原布局。

发布前通过 lint、TypeScript、生产构建和 57 项单元测试；浏览器验证覆盖完整模考交卷、模考刷新恢复、专项确认交卷防重复以及资料分析桌面/390px 工作区。公网临时账号验证结果为页面宽度 390/390、完整五题、默认题板 56%、展开题板 88%，验证账号及关联数据已删除。应用与数据库容器及公网健康接口均正常。

## 19. 2026-07-18 材料题右侧抽屉与组题内存修复版本发布记录

- 发布包：`dist/govexam-release-20260718-material-question-drawer-r6.tgz`
- SHA-256：`d05e72f187794911ac3202bd122af4067ee5384832bcc5b32153127caa7c5591`
- 发布编号：`20260718-material-question-drawer-r6`
- 线上镜像：`sha256:826e16d05c701b9274696be050b0076258f3160fd41b025e2d0a06dd220ccfbc`
- 数据库备份：`/opt/govexam/backups/pre-20260718-material-question-drawer-r6-20260718-234624.dump`
- 代码备份：`/opt/govexam/backups/pre-20260718-material-question-drawer-r6-20260718-234624-code.tgz`
- 切换前后核心计数：`4,50402,268,12,26,9`；删除临时验收账号后恢复为 `3,50402,268,12,26,9`

桌面端材料题练习区改为最右侧可收放抽屉：展开宽度约 547px，收起后仅保留 52px 控制边栏，材料区由约 545px 自动扩展到 1040px；重新展开后保持完整五题并可继续作答。900px 以下移动端继续使用原有底部题板，不受桌面抽屉状态影响。

公网验收同时暴露并修复了全新账号首次组题的内存风险。组题接口不再一次性加载五万道题的完整选项和材料关系，而是先读取筛选、去重所需的轻量字段，选定最多 150 道后再加载完整题面。1.6GB 云主机重启后发布 r6，全新账号首次进入专项练习约 11.6 秒完成；验收结束时 Web 容器约 87MB、数据库约 69MB，Swap 使用为 0。应用与数据库容器均为 `healthy`，公网健康接口、抽屉收起/展开、完整材料五题和继续作答均验证通过，临时账号及关联数据已删除。

## 20. 2026-07-19 材料题固定右侧抽屉版本发布记录

- 发布包：`dist/govexam-release-20260719-material-fixed-right-drawer-r7.tgz`
- SHA-256：`7c14196063075f0b9f22fe801920a0745acc23cd388ce7584ee93158d5d479c9`
- 发布编号：`20260719-material-fixed-right-drawer-r7`
- 线上镜像：`sha256:387795863a353ff5d45d41bba09dd0cb6064b54065cbab98cb6a8c1df126db0e`
- 数据库备份：`/opt/govexam/backups/pre-20260719-material-fixed-right-drawer-r7-20260719-004304.dump`
- 代码备份：`/opt/govexam/backups/pre-20260719-material-fixed-right-drawer-r7-20260719-004304-code.tgz`
- 数据核对：切换前后及删除临时验收账号后核心计数均为 `3,50402,268,12,26,9`

本次将桌面材料题练习区真正固定到浏览器最右侧，抽屉从 72px 顶部导航下方延伸到视口底部，不再受主内容最大宽度或页面纵向滚动影响。展开时主内容自动为抽屉预留空间，收起后仅保留 52px 固定侧栏并释放材料区宽度；1180px 以下继续使用原分栏或手机底部题板。

发布前通过 lint、TypeScript、生产构建和 UI-009 桌面/手机材料题回归。公网在 2048×1152 视口滚动 620px 后验证：抽屉仍保持 `top=72px`、`right=0`，展开宽 520px、收起宽 52px，材料区由 1208px 扩展到 1676px，重新展开正常并保留完整五题。应用和数据库容器均为 `healthy`，临时验收账号及关联数据已删除。

## 21. 2026-07-19 练习进度右侧工具栏纠正版发布记录

- 发布包：`dist/govexam-release-20260719-practice-progress-dock-r8.tgz`
- SHA-256：`d315836f8c756c31a8d3b6655cdfa2678ea2241dfb9b7acda9545c3ede2e50d4`
- 发布编号：`20260719-practice-progress-dock-r8`
- 线上镜像：`sha256:d7fbaee96d1599bf324be975ac9c99c1f86f92b6ee36c3d522c7547887cd0ee4`
- 数据库备份：`/opt/govexam/backups/pre-20260719-practice-progress-dock-r8-20260719-011553.dump`
- 代码备份：`/opt/govexam/backups/pre-20260719-practice-progress-dock-r8-20260719-011553-code.tgz`
- 数据核对：切换前后及删除临时验收账号后核心计数均为 `3,50402,268,12,26,9`

本版本纠正 r7 对需求的错误理解：材料和题目区不再具有收起逻辑，桌面端始终保持完整左右分栏；改为将包含练习进度、计时、暂停、题号、交卷和换题操作的工具框固定到浏览器最右侧，并允许收起为 52px 侧栏。1360px 以下继续使用原有流式进度卡片，手机材料题板逻辑不变。

发布前通过 lint、TypeScript、生产构建和 UI-009 桌面/手机回归。公网在 2048×1152 视口验证：进度工具展开宽 320px、收起宽 52px，题目区始终保持 520px 且完整五题可见，材料区由 876px 扩展到 1144px，并在进度工具收起状态下成功作答。应用和数据库容器均为 `healthy`，临时验收账号及关联数据已删除。

## 22. 2026-07-19 练习换题按钮状态修复版本发布记录

- 发布包：`dist/govexam-release-20260719-practice-swap-button-r9.tgz`
- SHA-256：`c406ed855098ac80216e09895f3db3b9ab25d41e730b7cbcd98a281062dcbe63`
- 发布编号：`20260719-practice-swap-button-r9`
- 线上镜像：`sha256:2a9ec0aa419f91a693284271d74735e66e64a698126dd65c530ef93d7a49763c`
- 数据库备份：`/opt/govexam/backups/pre-20260719-practice-swap-button-r9-20260719-174448.dump`
- 代码备份：`/opt/govexam/backups/pre-20260719-practice-swap-button-r9-20260719-174448-code.tgz`
- 数据核对：切换前后及删除临时验收账号后核心计数均为 `3,50402,270,12,26,9`

本次修复右侧进度工具中的“换一组题目”无反馈问题。作答正在保存时按钮不再被无提示禁用，而是显示“保存后换题”并等待当前作答完成后自动执行；换题请求期间显示“正在换题…”；计划任务失效或服务端拒绝等错误会直接显示在右侧工具栏内，不再只出现在页面上方不可见位置。

发布前通过 lint、TypeScript、生产构建和 UI-009 换题点击回归，并验证每日任务启动的计划练习可以成功换题。竞态测试中按钮在作答保存期间保持可点击，作答接口返回 200 后组题与新会话分别返回 200/201。公网临时账号复测按钮可用且换题成功，无非空错误提示；应用和数据库容器均为 `healthy`，验收账号及关联数据已删除。

## 23. 2026-07-19 Claude Web/App 前端重构审计版本发布记录

- 发布包：`dist/govexam-release-20260719-frontend-rebuild-audit-r10.tgz`
- SHA-256：`964c1a066edfec47327115fc69ced6aaecb08ab9c7664dc593e203981b2ea482`
- 发布编号：`20260719-frontend-rebuild-audit-r10`
- 线上 Web 镜像：`sha256:26e4d3fa8d35146a6e274e424d95de699576d85acf0ba3e72d7a3fee6e8c8a9e`
- 数据库备份：`/opt/govexam/backups/pre-20260719-frontend-rebuild-audit-r10-20260719-193341.dump`
- 代码备份：`/opt/govexam/backups/pre-20260719-frontend-rebuild-audit-r10-20260719-193341-code.tgz`
- 数据核对：切换前后核心计数均为 `3,50402,270,12,26,9`

本次审计 Claude 重构的 Web 应用外壳、首页、基础 UI 和 Android WebView/提醒桥接，没有发现前后端 API 字段或事件回调断裂。Web 通过 ESLint、TypeScript、Prisma 校验、生产构建和 57 项单元测试；接口复测中认证、组题、作答修改、暂停、模考、报告和管理后台流程通过，剩余旧规划测试仅断言已废弃的七日逐日任务规则。浏览器实测覆盖九个页面入口、桌面/390px 移动菜单、右侧练习工具收放、专项暂停/恢复和模考交卷；Android `test lint assembleDebug assembleRelease` 全部通过。

候选版本采用在线数据库备份、候选 runner 镜像和 Web 容器低停机切换，失败自动恢复 r9 镜像。公网 HTTPS 临时账号已完成注册、移动端菜单、专项组题、作答保存、暂停/恢复验证并删除，应用与数据库容器及 `/api/health` 均为 `healthy`/200。

## 24. 2026-07-19 每日任务训练证据自动匹配修复发布记录

- 发布包：`dist/govexam-release-20260719-plan-evidence-autolink-r11.tgz`
- SHA-256：`084329ccca3e9c803ad50e4addfcdf31d9d985e9052546cd5be567c3edd22904`
- 发布编号：`20260719-plan-evidence-autolink-r11`
- 线上 Web 镜像：`sha256:b986a8b867ad8adeaac11ce9e03ea2d0497afc437922296c3ea76d7abce8a175`
- 数据库备份：`/opt/govexam/backups/pre-20260719-plan-evidence-autolink-r11-20260719-201611.dump`
- 代码备份：`/opt/govexam/backups/pre-20260719-plan-evidence-autolink-r11-20260719-201611-code.tgz`
- 数据核对：切换前后核心计数均为 `3,50402,285,13,26,9`

本次修复系统验收仅查询显式绑定计划任务的训练报告，导致用户从普通专项入口完成同一任务后仍提示“未找到训练记录”的问题。前端优先使用任务完成时返回的证据 ID；服务端同时允许自动匹配同账号、未绑定其他任务的真实训练报告，并严格核验题量、精确细分板块、题目难度、正确率、服务端用时、完整五题材料组、原始会话和作答链。证据占用仍保持全局唯一，已绑定其他任务的报告继续拒绝复用，申论未绑定记录的限制不变。

发布前通过 ESLint、TypeScript、生产构建、57 项单元测试、新增普通专项自动匹配接口回归和每日任务专项系统验收 UI 全流程。完整接口套件 55 项中 49 项通过，剩余 6 项仍为旧七日逐日规划断言。上线后使用截图对应的既有 15 题报告进行只读验收：识别 15 题、正确率 93.3%、用时 783 秒、难度 6.5～9.4、3 组完整材料，返回 `meetsCriteria=true`；未代替用户执行最终打卡。

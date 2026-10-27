# HTML 统一管理平台

公司各部门制作的 HTML 页面统一收纳、统一检索、按可见性分级访问的内部平台。

**核心能力**

- 单一入口：所有 HTML 页面集中在一个门户里，按业务分类导航 + 元数据搜索
- 三档可见性：外网公开 / 仅内网全员 / 指定部门可见
- 三道隔离防线：文件挂载隔离 + 应用层强制过滤 + CSP 沙箱
- 审核闭环：上传 → 提交审核 → 通过发布 / 驳回，全程留审计日志
- 版本管理：每次上传产生不可变版本，可预览、可回滚
- 使用统计：页面浏览量与时间趋势，看板汇总部门与分类分布

---

## 一、本地跑起来（无需 Docker）

需要 Node.js 20 以上。数据库用 SQLite，文件落在 `data/`，零外部依赖。

```bash
pnpm install
pnpm --filter @hmp/server db:push     # 建表
pnpm --filter @hmp/server db:seed     # 灌入演示数据
pnpm dev                              # 一键启动全部服务
```

启动后打开两个地址，这就是内外网隔离的**现场演示**：

| 地址 | 站点 | 演示什么 |
|---|---|---|
| http://localhost:5173 | 内网门户 | 需登录，能看到全部页面、可上传可审核 |
| http://localhost:5174 | 外网门户 | 匿名，只能看到外网公开页面，没有任何管理入口 |

**并排打开这两个标签页**，就是最直观的隔离效果演示：同一个页面在外网入口根本不存在。

### 演示账号

| 角色 | 邮箱 | 密码 |
|---|---|---|
| 管理员 | admin@hmp.local | admin123 |
| 管理员（兼审核） | admin2@hmp.local | admin2_123 |
| 销售部员工 | sales@hmp.local | sales123 |
| 财务部员工 | finance@hmp.local | finance123 |
| 人力资源部员工 | hr@hmp.local | hr123 |

**用不同账号登录，左侧导航会完全不同：**

| 导航模块 | 员工 | 管理员 |
|---|---|---|
| 页面门户 | ✅ | ✅ |
| 上传页面 | ✅ | ✅ |
| 我的页面 | ✅ | — |
| 页面管理 / 审核队列 / 使用统计 / 审计日志 / 基础配置 | ❌ | ✅ |

可以并排开两个浏览器（一个员工、一个管理员）对比，这是权限隔离的现场演示。

演示数据里准备了 4 类页面，方便直接验证隔离：

- `2026 Q1 销售战报` — 外网公开
- `NOVA X1 新品发布页` — 外网公开，ZIP 多文件包
- `成本结构分析` — 仅内网，**外网访问返回 404**
- `招聘需求看板` — 仅人力资源部，其他部门登录返回 403

---

## 二、验证隔离是否真的生效

```bash
pnpm verify:isolation
```

自动化断言覆盖站点角色识别、三道防线、部门鉴权、zip 路径穿越拦截、审核流与审计日志、CSP 沙箱（不透明源、禁止数据外带）等。**断言数量以脚本自身输出的 `结果: N/N 通过` 为准**（随覆盖不断增强），全绿时退出码为 0。

---

## 三、常用命令

```bash
pnpm dev                  # 启动全栈（API + 2 个前端 + 2 个内容服务）
pnpm build                # 构建前后端
pnpm typecheck            # 类型检查
pnpm verify:isolation     # 隔离验收（需 dev 环境在跑）
pnpm verify:preview       # 内容沙箱与包内资源可执行性校验（无头 Chrome）
pnpm verify:layout        # 侧边导航折叠态图标居中校验（需先 build）
pnpm verify:styles        # 颜色 token 守卫（组件禁止硬编码色值）
pnpm verify               # 收尾编排：类型检查 + 构建 + 上面四项（会按需拉起 dev 环境）

pnpm --filter @hmp/server db:reset    # 重置数据库并重新灌演示数据
pnpm db:schema:mysql                  # 生成生产用 MySQL schema（pnpm verify 会校验一致性）
pnpm nginx:config                     # 从 config/sites.json 生成生产 Nginx 配置
```

---

## 四、生产部署

不需要宝塔。用 Docker Compose，一条命令：

```bash
cd deploy
./deploy.sh
```

脚本会校验配置、生成 Nginx 配置、构建镜像（生产用的是 MySQL），然后启动 6 个容器：数据库 / 建表任务 / API / 内网门户 / 外网门户 / 备份。建表任务先跑完，API 才启动。

首次上线如果还没有证书，记得在 `deploy/.env` 里设 `COOKIE_SECURE=false`，否则 HTTP 下登录态不生效。细节见 [部署手册](docs/部署手册.md)。

上线前必读 [`docs/部署手册.md`](docs/部署手册.md)，里面有一份**逐条核验清单**，尤其是 DNS 泄露检查。

---

## 五、目录结构

```
├─ config/          站点策略与安全响应头（唯一事实源）
├─ shared/          前后端共享类型与枚举
├─ server/          NestJS + Prisma 后端
├─ web/             Vue 3 + Element Plus 前端
├─ scripts/         开发编排、内容服务、Nginx 生成、隔离验收
├─ deploy/          Docker Compose 部署包
├─ sample-pages/    示例页面（同时是上传格式参考）
└─ docs/            方案、部署手册、接入规范
```

---

## 六、文档

- [架构方案](docs/方案.md) — 隔离设计、数据模型、安全说明
- [部署手册](docs/部署手册.md) — 生产部署与上线检查清单
- [CentOS 上线落地清单](docs/CentOS上线清单.md) — 在公司 CentOS 服务器上落地、CentOS 特有的坑
- [员工接入规范](docs/接入规范.md) — 怎么把 HTML 交上来
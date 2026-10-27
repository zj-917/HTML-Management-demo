# CentOS 服务器上线落地清单

> 本文只回答一个具体问题：**怎样把平台真正跑到公司那台 CentOS 服务器上，并确认内外网隔离确实生效。**
>
> 通用部署步骤与逐条核验清单见 [部署手册](部署手册.md)，隔离为什么这么设计见 [架构方案](方案.md)，  
> 网络层隔离的规则见 [部署手册 · 3.8 网络层隔离](部署手册.md)。

---

## 一、先分清两台机器

| 机器  | 现状                             | 能不能跑 Docker          | 定位      |
| --- | ------------------------------ | -------------------- | ------- |
| 开发机 | Windows 11（Sangfor aCloud 虚拟机） | ❌ Docker Desktop 起不来 | 只做开发与验收 |
| 上线机 | 公司 CentOS 服务器                  | ✅                    | 正式环境    |

开发机为什么起不来 Docker Desktop：这台 Windows 本身跑在 aCloud 虚拟机上，没有开启嵌套虚拟化  
（`VirtualizationFirmwareEnabled=False`），Hyper-V 用不了；WSL2 也因为没装发行版而起不来。  
而 Docker Desktop 依赖 WSL2 / Hyper-V —— **两个前提都不满足**。

上线机为什么没有这个问题：Linux 上的容器是**共享宿主内核**的进程，不需要 CPU 硬件虚拟化，  
Windows 那台的拦路虎在 Linux 上根本不存在。

> 结论：**上线走 CentOS + Docker Compose，开发机维持现状不动。**

---

## 二、上线前先在 CentOS 上确认这几件事

在服务器上依次执行，把输出记下来 —— 有几项直接决定后面怎么配。

```bash
cat /etc/redhat-release          # CentOS 几？（7 / 8 / 9）
uname -r                         # 内核 ≥ 3.10
free -h ; df -h /                # 内存 ≥ 2G，磁盘 ≥ 40G（页面文件会持续增长）
ip -4 addr                       # 内网网卡地址 —— 后面 INTERNAL_BIND 要用它
```

```bash
docker --version                 # 需要 ≥ 20.10
docker compose version           # 需要 compose v2 插件
getenforce                       # Enforcing / Permissive / Disabled
systemctl is-active firewalld    # active / inactive
```

```bash
# 能不能从 Docker Hub 拉镜像（国内网络常常拉不动）
docker pull hello-world
```

再从**服务器之外**确认一次（决定能不能做"对外"）：

```bash
# 在手机 4G / 家里宽带执行，<公网IP> 换成服务器的对外 IP
curl -I http://<公网IP>:8080/
```

- 能连上 → 已经有公网 IP + 入站端口映射（可能还要在云控制台或路由器上开）
- 连不上 → 对外能力还没有，**外网站点就只能先在内网验证**

> ⚠️ 上面这几项就是"能不能真正对外"的前提，缺一项都别急着宣布上线。

---

## 三、CentOS 特有的坑

这一节是与 Ubuntu 部署差异最大的部分，逐条对照。

### 3.1 SELinux 会让挂载卷读不到文件

CentOS 默认 SELinux `Enforcing`，容器默认**不能访问宿主目录**（`./data`），  
表现为页面 403 / 404，或 API 启动即报 `Permission denied`。

两种处理，任选其一：

```bash
# 方案 A（推荐）：给宿主目录打上容器可读的标签
chcon -Rt svirt_sandbox_file_t data
```

```yaml
# 方案 B：在 docker-compose.yml 的挂载项后加 :z
#   ./data:/app/data        →  ./data:/app/data:z
#   ./data:/srv:ro          →  ./data:/srv:ro,z
```

> `:z` 表示多容器共享同一份数据（`:Z` 是单容器私有），可与 `:ro` 叠加写成 `:ro,z`。  
> 快速定位：`setenforce 0` 后问题消失、改回 `Enforcing` 又出现，就是 SELinux。  
> 注意 `chcon` 不是持久的，之后若跑过 `restorecon` 会被还原，需要长期生效就改用 `semanage fcontext`。

### 3.2 firewalld 管不住 Docker 发布的端口

Docker 启动时会把自己的 iptables 规则插在 firewalld 之前，**凡是 `ports:` 发布出来的端口都会被直接放行，  
`firewall-cmd` 的 zone / 端口规则对它无效**。所以：

- **不要**指望用 `firewall-cmd` 把内网站点"藏"起来
- 内网站点靠 `INTERNAL_BIND` 绑到内网网卡（真·套接字级隔离），而不是靠防火墙规则
- 确实要额外拦截，得写 `DOCKER-USER` 链，但那只是补充，不是替代

### 3.3 镜像拉取与 Docker 安装

- 装 Docker Engine 请用官方 / 国内源的 `docker-ce` 仓库，**不要** `yum install docker`  
  （那是旧版 moby，没有 compose v2）
- 若 `docker pull` 超时，先配镜像加速（`/etc/docker/daemon.json` 的 `registry-mirrors`），  
  否则 `deploy.sh` 会在构建阶段卡住 —— 它要拉 `mysql:8.4`、`node:22-alpine`、  
  `nginx:1.27-alpine`、`alpine:3.20` 四个基础镜像

---

## 四、要改的文件（改动清单）

上线前只需动下面几处，其余保持默认。

| 文件                      | 改什么              | 改成                                                                  |
| ----------------------- | ---------------- | ------------------------------------------------------------------- |
| `config/sites.json`     | `prodHosts`      | 真实域名：内网域名指向内网 IP，公网域名指向公网 IP                                        |
| `config/sites.json`     | `hostPatterns`   | 确认覆盖你们的内网网段（默认已含 `10.*` / `172.16.*` / `192.168.*`）                 |
| `config/sites.json`     | `fallbackSiteId` | **保持 `external`** —— 权限最小；配成 `manageEnabled` 的站点启动就会报错              |
| `deploy/.env`           | `INTERNAL_BIND`  | 内网网卡地址，例如 `10.34.128.193`（默认 `127.0.0.1` 只绑本机，等于内网访问不到）        |
| `deploy/.env`           | `INTERNAL_PORT`  | 内网站点端口（默认 80）                                                       |
| `deploy/.env`           | `EXTERNAL_BIND`  | `0.0.0.0` —— 只把这一侧暴露出去                                              |
| `deploy/.env`           | `EXTERNAL_PORT`  | 对外端口；未完成 ICP 备案前先用 `8080`                                           |
| `deploy/.env`           | `CONTENT_TOKEN_SECRET` | 用户页面静态资源的签名密钥，`deploy.sh` 会随机生成；**不要留空、不要复用 JWT 密钥** |
| `deploy/.env`           | `COOKIE_SECURE`  | 还没有证书、走 HTTP 上线时为 `false`；配好 TLS 后改回 `true`（默认安全值为 `true`） |

> `deploy/.env` 由 `deploy.sh` 从 `deploy/.env.example` 生成。**先生成、后改绑定**，  
> 或先改 `.env.example` 再首次部署。`deploy.sh` 可重复执行，且不会覆盖已存在的 `.env`。  
> `INTERNAL_BIND` 默认是 `127.0.0.1`（失败关闭）：不改的后果是内网门户访问不到；  
> 若把它改回 `0.0.0.0`，在有公网 IP 的机器上等于把内网门户暴露到公网。`deploy.sh` 遇到 `0.0.0.0` 会打警告。
>
> `Dockerfile.web` 已经内置了 `rm -f /etc/nginx/conf.d/default.conf`，不需要再手工改。

改完域名后**必须重新生成 Nginx 配置**（`deploy.sh` 第 3 步会自动做，手工做是）：

```bash
node scripts/gen-nginx-config.mjs
```

---

## 五、部署

```bash
cd deploy
chmod +x deploy.sh backup.sh
./deploy.sh
```

脚本会依次：生成 `.env` → 校验站点配置 → 生成 Nginx 配置（`deploy/nginx/generated/`）→ 建 `data/` 目录 → 构建镜像（镜像内生成 MySQL schema 与 Prisma Client）→ 启动 `api-migrate` 建表 → 启动 `api` 与两个 nginx → 校验 nginx 配置。  
创建管理员、升级、回滚、备份恢复见 [部署手册 · 二、部署](部署手册.md) 与 [四、运维](部署手册.md)。

---

## 六、上线核对（必做）

| 检查         | 章节                    | 要点                                                      |
| ---------- | --------------------- | ------------------------------------------------------- |
| **网络层隔离**  | [部署手册 · 3.8](部署手册.md) | 只映射外网入口一个端口；从公网用 IP 或伪造 `Host` 都拿不到内网站点                 |
| **应用层隔离**  | [部署手册 · 3.1](部署手册.md) | 外网访问内网页面 404、内网未登录 401、外网访问管理接口 404                     |
| **文件系统隔离** | [部署手册 · 3.2](部署手册.md) | `web-external` 容器里看不到 `internal/`、`dept/`               |
| **安全响应头**  | [部署手册 · 3.4](部署手册.md) | CSP sandbox 不含 `allow-same-origin`、`connect-src 'none'` |

> 核心一句话：**API 端口（3000）与内容端口（4000 / 4001）绝不能发布到公网。**  
> 直接打到 API 的请求仍可自称任意 `Host`，这三个端口一旦暴露，等于绕过全部站点隔离。

---

## 七、目前还悬着的问题

| 问题                    | 为什么重要                                     |
| --------------------- | ----------------------------------------- |
| 有没有可对外映射的公网 IP / 入站端口 | 没有就只能先在内网验证，"外网可访问"无从谈起                   |
| CentOS 版本与内核          | 决定 SELinux、cgroup 版本与 Docker 的安装方式        |
| 能否拉取 Docker Hub 镜像    | 拉不动就得先配镜像加速，否则部署卡死                        |
| ICP 备案状态              | 中国大陆对外提供 80 / 443 必须备案，未备案只能用非标端口 + IP 验证 |
| 是否有 SSH / sudo 权限     | 没有就无法在本机远程排查，只能靠对方照着本文回读输出                |

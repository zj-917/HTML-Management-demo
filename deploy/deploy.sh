#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE="docker compose --env-file deploy/.env -f deploy/docker-compose.yml"

echo "=============================================="
echo " HTML 统一管理平台 - 部署脚本"
echo "=============================================="

command -v docker >/dev/null 2>&1 || { echo "未找到 docker，请先安装 Docker Engine 20.10+"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "未找到 docker compose v2 插件"; exit 1; }

# api 依赖 api-migrate 的 service_completed_successfully（Compose 2.17+）。
# 低于这个版本时该条件会被忽略，api 可能在建表前就启动，所以直接拦住。
COMPOSE_VERSION="$(docker compose version --short 2>/dev/null | sed 's/^v//' || true)"
COMPOSE_MAJOR="${COMPOSE_VERSION%%.*}"
COMPOSE_REST="${COMPOSE_VERSION#*.}"
COMPOSE_MINOR="${COMPOSE_REST%%.*}"
case "${COMPOSE_MAJOR}.${COMPOSE_MINOR}" in
  ''|.*|*.|*[!0-9.]*)
    echo "无法解析 docker compose 版本：${COMPOSE_VERSION:-<空>}（请确认已安装 compose v2 插件）"
    exit 1 ;;
esac
if [ "${COMPOSE_MAJOR}" -lt 2 ] || { [ "${COMPOSE_MAJOR}" -eq 2 ] && [ "${COMPOSE_MINOR}" -lt 17 ]; }; then
  echo "需要 Docker Compose >= 2.17（当前 ${COMPOSE_VERSION}）：依赖 service_completed_successfully 保证先建表后起服务"
  exit 1
fi

if [ ! -f deploy/.env ]; then
  echo "[1/6] 生成 deploy/.env ..."
  cp deploy/.env.example deploy/.env
  MYSQL_ROOT_PASSWORD="root-$(head -c 18 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 20)"
  MYSQL_PASSWORD="hmp-$(head -c 18 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 20)"
  JWT_SECRET="$(head -c 48 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 48)"
  CONTENT_TOKEN_SECRET="$(head -c 48 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 48)"

  sed -i "s|^MYSQL_ROOT_PASSWORD=.*|MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}|" deploy/.env
  sed -i "s|^MYSQL_PASSWORD=.*|MYSQL_PASSWORD=${MYSQL_PASSWORD}|" deploy/.env
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" deploy/.env
  sed -i "s|^CONTENT_TOKEN_SECRET=.*|CONTENT_TOKEN_SECRET=${CONTENT_TOKEN_SECRET}|" deploy/.env
  echo "      已生成随机口令，请妥善保存 deploy/.env"
else
  echo "[1/6] deploy/.env 已存在，跳过生成"
fi

env_value() {
  grep -E "^$1=" deploy/.env | tail -n1 | cut -d= -f2- || true
}

INTERNAL_BIND_VALUE="$(env_value INTERNAL_BIND)"
if [ "${INTERNAL_BIND_VALUE}" = "0.0.0.0" ]; then
  echo "      危险: INTERNAL_BIND=0.0.0.0 —— 内网门户会监听所有网卡。"
  echo "            本机若有公网 IP，内网站点会从公网直接可达。"
  echo "            请改成内网网卡地址（例如 10.0.0.5）后重跑本脚本。"
elif [ -z "${INTERNAL_BIND_VALUE}" ] || [ "${INTERNAL_BIND_VALUE}" = "127.0.0.1" ]; then
  echo "      提示: INTERNAL_BIND=${INTERNAL_BIND_VALUE:-<空>} —— 内网门户只有服务器本机能访问。"
  echo "            上线前请改成内网网卡地址（例如 10.0.0.5），否则员工打不开内网站点。"
fi

COOKIE_SECURE_VALUE="$(env_value COOKIE_SECURE)"
if [ "${COOKIE_SECURE_VALUE}" = "false" ]; then
  echo "      提示: COOKIE_SECURE=false —— 登录 Cookie 允许走 HTTP 明文。"
  echo "            仅适用于「还没有证书」的首次上线；配好 TLS 后请改成 true。"
fi

echo "[2/6] 校验站点配置 ..."
node -e "
const s=require('./config/sites.json');
const hosts=Object.values(s.prodHosts||{});
if(!hosts.length) throw new Error('prodHosts 为空');
console.log('      内网:', s.prodHosts.intranet, '/', s.prodHosts.admin);
console.log('      外网:', s.prodHosts.external);
if (hosts.some(h=>h.includes('example.com'))) {
  console.warn('      警告: 仍为示例域名，上线前请在 config/sites.json 修改为真实域名');
}
" || exit 1

echo "[3/6] 生成 Nginx 配置（deploy/nginx/generated/）..."
node scripts/gen-nginx-config.mjs

echo "[4/6] 初始化数据目录 ..."
mkdir -p data/public data/internal data/dept data/versions data/_backups
chmod 755 data data/public data/internal data/dept data/versions 2>/dev/null || true

echo "[5/6] 构建镜像 ..."
# 注意：MySQL 版 Prisma Client 是在镜像内部按 schema.mysql.prisma 生成的。
# 不要把 Windows 上的 node_modules / dist 拷进服务器——Prisma 引擎和 esbuild
# 都是按平台下载的。
$COMPOSE build

echo "[6/6] 启动（api-migrate 先同步表结构，api 等它成功退出后才启动）..."
$COMPOSE up -d

echo ""
echo "等待 API 就绪..."
READY=0
for i in $(seq 1 60); do
  if $COMPOSE exec -T api \
      node -e "fetch('http://127.0.0.1:3000/api/auth/site').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    READY=1
    echo "API 已就绪（约 $((i * 3)) 秒）"
    break
  fi
  sleep 3
done
if [ "$READY" -ne 1 ]; then
  echo ""
  echo "API 未在 180 秒内就绪。排查顺序："
  echo "  1) $COMPOSE ps"
  echo "  2) $COMPOSE logs api-migrate    # 建表是否失败"
  echo "  3) $COMPOSE logs api"
  exit 1
fi

echo ""
echo "校验 nginx 配置（构建阶段解析不了 upstream，只能在实际网络里校验）..."
$COMPOSE exec -T web-internal nginx -t
$COMPOSE exec -T web-external nginx -t

echo ""
echo "=============================================="
echo " 部署完成"
echo "=============================================="
echo " 内网站点  http://<内网IP>:$(env_value INTERNAL_PORT)"
echo " 外网站点  http://<公网IP>:$(env_value EXTERNAL_PORT)"
echo ""
echo " 创建第一个管理员账号（密码至少 8 位）："
echo "   $COMPOSE exec api \\"
echo "     node server/prisma/create-admin.mjs <邮箱> <密码> <姓名>"
echo ""
echo " 部署后必做："
echo "   1. 在 DNS 中把内网域名指向内网 IP，公网域名指向公网 IP"
echo "   2. 确认内网域名未在公网 DNS 泄露（见 docs/部署手册.md 检查清单）"
echo "   3. 配置 HTTPS（ICP 备案完成后），并把 COOKIE_SECURE 改为 true"
echo "=============================================="

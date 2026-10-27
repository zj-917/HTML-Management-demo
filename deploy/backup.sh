#!/bin/sh
# 备份容器入口。
#   backup.sh cron  → 先立刻备份一次，再按 BACKUP_CRON 每天定时（busybox crond）
#   backup.sh once  → 只备份一次（供 cron 调用，也方便手工执行）
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
BACKUP_CRON="${BACKUP_CRON:-17 3 * * *}"

ensure_client() {
  command -v mysqldump >/dev/null 2>&1 || apk add --no-cache mysql-client >/dev/null 2>&1
}

run_backup() {
  ensure_client
  STAMP="$(date +%Y%m%d-%H%M%S)"
  TARGET="${BACKUP_DIR}/${STAMP}"
  mkdir -p "$TARGET"

  echo "[backup] dumping database"
  mysqldump \
    -h "${MYSQL_HOST:-db}" \
    -u "${MYSQL_USER}" \
    -p"${MYSQL_PASSWORD}" \
    --single-transaction --quick --routines \
    "${MYSQL_DATABASE}" > "${TARGET}/db.sql"

  # 只归档已发布的三个桶。versions/ 是不可变原件，体积大且可从备份策略上单独处理
  # （真要恢复历史版本，db.sql + 发布副本已经够重建线上内容）。
  echo "[backup] archiving published content"
  tar czf "${TARGET}/content.tar.gz" -C / app/data/public app/data/internal app/data/dept 2>/dev/null || true

  find "${BACKUP_DIR}" -maxdepth 1 -type d -name '20*' -mtime "+${RETENTION_DAYS}" -exec rm -rf {} + 2>/dev/null || true
  echo "[backup] done -> ${TARGET}"
}

case "${1:-cron}" in
  once)
    run_backup
    ;;
  cron)
    ensure_client
    run_backup
    echo "${BACKUP_CRON} /bin/sh /backup.sh once >> /proc/1/fd/1 2>&1" > /etc/crontabs/root
    echo "[backup] 定时任务已装载：${BACKUP_CRON}（保留 ${RETENTION_DAYS} 天）"
    exec crond -f -l 8
    ;;
  *)
    echo "用法: backup.sh [cron|once]" >&2
    exit 2
    ;;
esac

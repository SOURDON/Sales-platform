#!/usr/bin/env bash
# Экспорт БД Render прямо на VPS (Docker уже установлен). Без Mac и без scp.
#
# На сервере:
#   export RENDER_DATABASE_URL='postgresql://...'   # Render → PostgreSQL → External URL
#   /opt/sales-platform/scripts/timeweb/export-on-server.sh
#   /opt/sales-platform/scripts/timeweb/import-on-server.sh
set -euo pipefail

if [[ -z "${RENDER_DATABASE_URL:-}" ]]; then
  echo "Задайте: export RENDER_DATABASE_URL='postgresql://...'"
  exit 1
fi

OUT="/opt/sales-platform/backup.dump"
# Render = PG 16; нужен pg_dump >= 16 (на зеркалах иногда тянется старый postgres:16-alpine с pg_dump 15)
PG_IMAGE="${PG_DUMP_IMAGE:-postgres:17-alpine}"

echo "Экспорт с Render в $OUT (образ $PG_IMAGE) ..."
docker pull "$PG_IMAGE"

docker run --rm \
  -e RENDER_DATABASE_URL \
  -v /opt/sales-platform:/data \
  "$PG_IMAGE" \
  sh -c 'pg_dump --version && pg_dump "$RENDER_DATABASE_URL" -Fc --no-owner --no-acl -f /data/backup.dump'

ls -lh "$OUT"
echo "Готово. Импорт: /opt/sales-platform/scripts/timeweb/import-on-server.sh"

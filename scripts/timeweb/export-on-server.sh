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
echo "Экспорт с Render в $OUT ..."

docker run --rm \
  -e RENDER_DATABASE_URL \
  -v /opt/sales-platform:/data \
  postgres:16-alpine \
  sh -c 'pg_dump "$RENDER_DATABASE_URL" -Fc --no-owner --no-acl -f /data/backup.dump'

ls -lh "$OUT"
echo "Готово. Импорт: /opt/sales-platform/scripts/timeweb/import-on-server.sh"

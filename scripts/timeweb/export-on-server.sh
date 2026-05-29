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
# Render = PG 16.3. Нужен pg_dump 16.x (17 не дампит 16; зеркало Timeweb иногда отдаёт pg_dump 15 под тегом 16-alpine).
PG_IMAGE="${PG_DUMP_IMAGE:-docker.io/library/postgres:16.6-alpine}"

echo "Экспорт с Render в $OUT (образ $PG_IMAGE) ..."
docker pull "$PG_IMAGE"
docker run --rm "$PG_IMAGE" pg_dump --version

docker run --rm \
  -e RENDER_DATABASE_URL \
  -v /opt/sales-platform:/data \
  "$PG_IMAGE" \
  sh -c 'pg_dump "$RENDER_DATABASE_URL" -Fc --no-owner --no-acl -f /data/backup.dump'

ls -lh "$OUT"
echo "Готово. Импорт: /opt/sales-platform/scripts/timeweb/import-on-server.sh"

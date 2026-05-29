#!/usr/bin/env bash
# Экспорт с Render через Docker (если на Mac нет pg_dump).
#   export RENDER_DATABASE_URL='postgresql://...'
#   ./scripts/timeweb/export-from-render-docker.sh
set -euo pipefail

if [[ -z "${RENDER_DATABASE_URL:-}" ]]; then
  echo "Задайте RENDER_DATABASE_URL (External Database URL из Render)."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Нужен Docker Desktop на Mac."
  exit 1
fi

OUT_DIR="$(cd "$(dirname "$0")/../.." && pwd)/deploy/timeweb/backups"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$OUT_DIR/render-${STAMP}.dump"

PG_IMAGE="${PG_DUMP_IMAGE:-postgres:17-alpine}"
echo "Экспорт в $FILE (через Docker, $PG_IMAGE) ..."
docker pull "$PG_IMAGE"
docker run --rm \
  -e RENDER_DATABASE_URL \
  -v "$OUT_DIR:/backups" \
  "$PG_IMAGE" \
  sh -c 'pg_dump "$RENDER_DATABASE_URL" -Fc --no-owner --no-acl -f "/backups/render-'"$STAMP"'.dump"'

echo "Готово: $FILE"
echo "На сервер:"
echo "  scp $FILE root@77.233.223.48:/opt/sales-platform/backup.dump"

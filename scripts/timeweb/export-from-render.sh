#!/usr/bin/env bash
# Экспорт БД с Render PostgreSQL на ваш Mac/Linux.
# Использование:
#   export RENDER_DATABASE_URL='postgresql://...'   # из Render → PostgreSQL → External URL
#   ./scripts/timeweb/export-from-render.sh
set -euo pipefail

if [[ -z "${RENDER_DATABASE_URL:-}" ]]; then
  echo "Задайте RENDER_DATABASE_URL (External Database URL из Render)."
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "Установите PostgreSQL client (pg_dump). На Mac: brew install libpq && brew link --force libpq"
  exit 1
fi

OUT_DIR="$(cd "$(dirname "$0")/../.." && pwd)/deploy/timeweb/backups"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$OUT_DIR/render-${STAMP}.dump"

echo "Экспорт в $FILE ..."
pg_dump "$RENDER_DATABASE_URL" -Fc --no-owner --no-acl -f "$FILE"
echo "Готово. Загрузите на сервер:"
echo "  scp $FILE root@IP_СЕРВЕРА:/opt/sales-platform/backup.dump"

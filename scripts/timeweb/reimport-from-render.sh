#!/usr/bin/env bash
# Полный повторный перенос с Render на Timeweb (на сервере).
#   export RENDER_DATABASE_URL='postgresql://...'
#   /opt/sales-platform/scripts/timeweb/reimport-from-render.sh
set -euo pipefail

ROOT="/opt/sales-platform"
EXPORT_ON_SERVER="$ROOT/scripts/timeweb/export-on-server.sh"
IMPORT_ON_SERVER="$ROOT/scripts/timeweb/import-on-server.sh"

if [[ -z "${RENDER_DATABASE_URL:-}" ]]; then
  echo "Задайте RENDER_DATABASE_URL (Render → PostgreSQL → External URL)."
  exit 1
fi

echo "1/2 Экспорт с Render..."
bash "$export-on-server"

echo "2/2 Импорт в Timeweb..."
bash "$import-on-server"

echo "Готово. Проверка данных:"
bash "$ROOT/scripts/timeweb/verify-data-on-server.sh"

#!/usr/bin/env bash
# Вставьте в SSH на Timeweb (одна команда). Обновляет API и переносит данные с Render.
set -eo pipefail
cd /opt/sales-platform
git pull
bash scripts/timeweb/fix-cors-for-ip.sh
curl -sf http://127.0.0.1/health && echo ""
cd /opt/sales-platform
bash scripts/timeweb/migrate-via-api-on-server.sh
bash scripts/timeweb/verify-data-on-server.sh

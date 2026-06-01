#!/usr/bin/env bash
# Вставьте в SSH на Timeweb (одна команда). Обновляет API и переносит данные с Render.
set -eo pipefail
cd /opt/sales-platform
git pull
cd deploy/timeweb
docker compose --env-file .env up -d --build api
echo "Ждём API (~2 мин)..."
sleep 120
curl -sf http://127.0.0.1/health && echo ""
cd /opt/sales-platform
bash scripts/timeweb/migrate-via-api-on-server.sh
bash scripts/timeweb/verify-data-on-server.sh

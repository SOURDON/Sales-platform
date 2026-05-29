#!/usr/bin/env bash
# Финиш переноса на сервере: обновить API + перенести данные с Render по HTTP.
set -eo pipefail
ROOT="/opt/sales-platform"
cd "$ROOT"
git pull
cd deploy/timeweb
docker compose --env-file .env up -d --build api
echo "Ждём API 90 сек..."
sleep 90
curl -s http://127.0.0.1/health
echo ""
cd "$ROOT"
export RENDER_URL="${RENDER_URL:-https://sales-platform-1.onrender.com}"
export TIMEWEB_URL="${TIMEWEB_URL:-http://127.0.0.1}"
export RENDER_PASSWORD="${RENDER_PASSWORD:-Bufet000}"
export TIMEWEB_PASSWORD="${TIMEWEB_PASSWORD:-Foto-2026-9kLq}"
bash "$ROOT/scripts/timeweb/migrate-via-api-on-server.sh"

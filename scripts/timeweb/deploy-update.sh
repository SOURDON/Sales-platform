#!/usr/bin/env bash
# Обновление API на сервере после git pull (запускать НА СЕРВЕРЕ).
set -euo pipefail

ROOT="/opt/sales-platform"
cd "$ROOT"

git pull origin main

cd deploy/timeweb
docker compose --env-file .env build api caddy
docker compose --env-file .env up -d

echo "Деплой обновлён."
curl -s http://127.0.0.1/health || true
if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  source .env
  if [[ -n "${SITE_DOMAIN:-}" ]]; then
    echo "Сайт: https://${SITE_DOMAIN}"
  fi
fi

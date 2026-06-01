#!/usr/bin/env bash
# Включить сайт на домене .ru (HTTPS + frontend). Запуск на сервере в /opt/sales-platform.
set -eo pipefail

ROOT="/opt/sales-platform"
ENV_FILE="$ROOT/deploy/timeweb/.env"
COMPOSE="docker compose -f $ROOT/deploy/timeweb/docker-compose.yml --env-file $ENV_FILE"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Создайте $ENV_FILE из env.example"
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

if [[ -z "${SITE_DOMAIN:-}" ]] || [[ "$SITE_DOMAIN" == "localhost" ]] || [[ "$SITE_DOMAIN" == api.example.ru ]]; then
  echo "В $ENV_FILE задайте SITE_DOMAIN=ваш-сайт.ru (без https://)"
  exit 1
fi

if [[ -z "${ACME_EMAIL:-}" ]] || [[ "$ACME_EMAIL" == admin@example.ru ]]; then
  echo "В $ENV_FILE задайте ACME_EMAIL=ваш@email.ru"
  exit 1
fi

cd "$ROOT"
git pull

cp "$ROOT/deploy/timeweb/Caddyfile.site" "$ROOT/deploy/timeweb/Caddyfile"

# CORS: тот же домен + desktop
if ! grep -q "^CORS_ORIGIN=.*${SITE_DOMAIN}" "$ENV_FILE" 2>/dev/null; then
  if grep -q '^CORS_ORIGIN=' "$ENV_FILE"; then
    sed -i "s|^CORS_ORIGIN=.*|CORS_ORIGIN=https://${SITE_DOMAIN},tauri://localhost,https://tauri.localhost|" "$ENV_FILE"
  else
    echo "CORS_ORIGIN=https://${SITE_DOMAIN},tauri://localhost,https://tauri.localhost" >> "$ENV_FILE"
  fi
fi

echo "Домен: https://${SITE_DOMAIN}"
echo "Сборка и запуск (3–8 мин)..."
cd "$ROOT/deploy/timeweb"
$COMPOSE build --no-cache caddy
$COMPOSE up -d --build

echo "Ждём сертификат Let's Encrypt..."
sleep 15
curl -sS "https://${SITE_DOMAIN}/health" || curl -sS "http://${SITE_DOMAIN}/health" || true
echo ""
echo "Откройте в браузере: https://${SITE_DOMAIN}"
echo "Desktop: VITE_API_URL=https://${SITE_DOMAIN} → ./scripts/desktop-build.sh"

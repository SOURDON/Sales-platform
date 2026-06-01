#!/usr/bin/env bash
# Разрешить вход с телефона по IP (CORS). Запуск на сервере: bash scripts/timeweb/fix-cors-for-ip.sh
set -eo pipefail
ROOT="/opt/sales-platform"
ENV="$ROOT/deploy/timeweb/.env"
IP="${PUBLIC_IP:-77.233.223.48}"
ORIGIN="http://${IP}"

if [[ ! -f "$ENV" ]]; then
  echo "Нет $ENV"
  exit 1
fi

if grep -q "^CORS_ORIGIN=.*${ORIGIN}" "$ENV"; then
  echo "CORS уже содержит $ORIGIN"
else
  if grep -q '^CORS_ORIGIN=' "$ENV"; then
    sed -i "s|^CORS_ORIGIN=|CORS_ORIGIN=${ORIGIN},|" "$ENV"
  else
    echo "CORS_ORIGIN=${ORIGIN},tauri://localhost,https://tauri.localhost" >> "$ENV"
  fi
  echo "Добавлено в CORS: $ORIGIN"
fi

cd "$ROOT/deploy/timeweb"
docker compose --env-file .env up -d --build api
sleep 45
curl -s -o /dev/null -w "login_with_origin:%{http_code}\n" \
  -X POST "http://127.0.0.1/auth/login" \
  -H "Content-Type: application/json" \
  -H "Origin: ${ORIGIN}" \
  -d '{"nickname":"director","password":"Bufet000"}'
echo "Готово. На телефоне: ${ORIGIN} → director / Bufet000"

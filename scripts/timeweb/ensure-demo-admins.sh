#!/usr/bin/env bash
# Восстановить демо-пользователей (a1, a2, …) в PostgreSQL на Timeweb.
# Запуск ТОЛЬКО на сервере по SSH:
#   bash /opt/sales-platform/scripts/timeweb/ensure-demo-admins.sh
set -eo pipefail

ROOT="/opt/sales-platform"
ENV_FILE="$ROOT/deploy/timeweb/.env"
COMPOSE_DIR="$ROOT/deploy/timeweb"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Нет $ENV_FILE — сначала настройте deploy/timeweb/.env"
  exit 1
fi

cd "$COMPOSE_DIR"

echo "=== Синхронизация демо-пользователей (a1…a8, director, buh, …) ==="
docker compose --env-file .env exec -T api node -e "
const { PrismaClient } = require('@prisma/client');
const { ensureDemoData } = require('./dist/src/database/ensure-demo-data');
const prisma = new PrismaClient();
ensureDemoData(prisma)
  .then(() => console.log('ensureDemoData: OK'))
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.\$disconnect());
"

echo ""
echo "=== Перезапуск API (подтянуть a1/a2 из БД в память) ==="
docker compose --env-file .env restart api
sleep 12

echo ""
echo "=== Админы в PostgreSQL ==="
set -a
# shellcheck disable=SC1091
source .env
set +a
docker compose --env-file .env exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT nickname, \"storeName\", \"isActive\" FROM \"User\" WHERE role='ADMIN' ORDER BY nickname;"

echo ""
echo "=== Проверка /director/demo-accounts (нужен пароль director) ==="
DIRECTOR_PASSWORD="${DIRECTOR_PASSWORD:-Bufet000}"
TOKEN=$(curl -s -X POST http://127.0.0.1/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"nickname\":\"director\",\"password\":\"$DIRECTOR_PASSWORD\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

if [[ -z "$TOKEN" ]]; then
  echo "Не удалось войти как director — проверьте пароль (DIRECTOR_PASSWORD=...)"
  exit 1
fi

ACCOUNTS_JSON=$(curl -s http://127.0.0.1/director/demo-accounts -H "Authorization: Bearer $TOKEN")
echo "$ACCOUNTS_JSON" | grep -o '"nickname":"a[0-9]*"' | tr -d '"' | sed 's/nickname://' | sort -u | while read -r nick; do
  store=$(echo "$ACCOUNTS_JSON" | grep -o "\"nickname\":\"$nick\"[^}]*\"storeName\":\"[^\"]*\"" | head -1 | sed 's/.*"storeName":"//;s/"$//')
  echo "  $nick → ${store:-?}"
done
if echo "$ACCOUNTS_JSON" | grep -q '"nickname":"a1"'; then
  echo "OK: a1 в API"
else
  echo "MISSING: a1 в API — проверьте вывод PostgreSQL выше"
fi
if echo "$ACCOUNTS_JSON" | grep -q '"nickname":"a2"'; then
  echo "OK: a2 в API"
else
  echo "MISSING: a2 в API"
fi

echo ""
echo "Готово. В десктопе откройте переключатель учёток — должны появиться a1 и a2."

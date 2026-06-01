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
echo "=== Проверка /director/demo-accounts (нужен пароль director) ==="
DIRECTOR_PASSWORD="${DIRECTOR_PASSWORD:-Bufet000}"
TOKEN=$(curl -s -X POST http://127.0.0.1/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"nickname\":\"director\",\"password\":\"$DIRECTOR_PASSWORD\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

if [[ -z "$TOKEN" ]]; then
  echo "Не удалось войти как director — проверьте пароль (DIRECTOR_PASSWORD=...)"
  exit 1
fi

curl -s http://127.0.0.1/director/demo-accounts \
  -H "Authorization: Bearer $TOKEN" \
  | node -e "
const rows = JSON.parse(require('fs').readFileSync(0,'utf8'));
const admins = rows.filter(r => r.role === 'ADMIN').map(r => r.nickname + ' → ' + r.storeName);
console.log('Admin accounts (' + admins.length + '):');
admins.sort().forEach(l => console.log('  ' + l));
const need = ['a1','a2'];
for (const n of need) {
  if (!rows.some(r => r.nickname === n)) console.log('MISSING:', n);
}
" 2>/dev/null || echo "(для списка установите node на сервере или проверьте с Mac: node scripts/repair-missing-demo-admins.mjs)"

echo ""
echo "Готово. В десктопе откройте переключатель учёток — должны появиться a1 и a2."

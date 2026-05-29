#!/usr/bin/env bash
# Сколько записей в БД на Timeweb (запускать на сервере).
set -euo pipefail

ROOT="/opt/sales-platform"
COMPOSE="docker compose -f $ROOT/deploy/timeweb/docker-compose.yml --env-file $ROOT/deploy/timeweb/.env"
cd "$ROOT/deploy/timeweb"
source .env

echo "=== Таблицы в PostgreSQL ==="
$COMPOSE exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
SELECT 'User' AS tbl, count(*) FROM "User"
UNION ALL SELECT 'Sale', count(*) FROM "Sale"
UNION ALL SELECT 'Shift', count(*) FROM "Shift"
UNION ALL SELECT 'StaffMember', count(*) FROM "StaffMember"
UNION ALL SELECT 'FinanceExpense', count(*) FROM "FinanceExpense"
UNION ALL SELECT 'FinanceIncome', count(*) FROM "FinanceIncome"
UNION ALL SELECT 'WriteOff', count(*) FROM "WriteOff"
ORDER BY 1;
SQL

echo ""
SALE_COUNT=$($COMPOSE exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc 'SELECT count(*) FROM "Sale";' | tr -d '[:space:]')
if [[ "${SALE_COUNT:-0}" -lt 1 ]]; then
  echo "⚠️  Sale=0 — импорт с Render не прошёл. Запустите: bash $ROOT/scripts/timeweb/do-everything-on-server.sh"
else
  echo "✓ Продаж в базе: $SALE_COUNT (импорт похоже успешен)"
fi

echo ""
echo "=== Продажи по месяцам (последние 6) ==="
$COMPOSE exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
SELECT to_char("createdAt", 'YYYY-MM') AS month, count(*) AS sales
FROM "Sale"
GROUP BY 1
ORDER BY 1 DESC
LIMIT 6;
SQL

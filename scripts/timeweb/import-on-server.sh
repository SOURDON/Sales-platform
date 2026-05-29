#!/usr/bin/env bash
# Импорт backup.dump в Postgres на Timeweb (запускать НА СЕРВЕРЕ).
set -eo pipefail

ROOT="/opt/sales-platform"
DUMP="${1:-$ROOT/backup.dump}"
COMPOSE="docker compose -f $ROOT/deploy/timeweb/docker-compose.yml --env-file $ROOT/deploy/timeweb/.env"

if [[ ! -f "$DUMP" ]]; then
  echo "Файл не найден: $DUMP"
  exit 1
fi

DUMP_SIZE=$(stat -c%s "$DUMP" 2>/dev/null || stat -f%z "$DUMP")
if [[ "$DUMP_SIZE" -lt 10000 ]]; then
  echo "ОШИБКА: дамп слишком маленький ($DUMP_SIZE байт). Сначала export-on-server.sh"
  exit 1
fi

cd "$ROOT/deploy/timeweb"
source .env

echo "Останавливаем API (чтобы не мешал импорту)..."
$COMPOSE stop api caddy || true
$COMPOSE up -d postgres
sleep 5

echo "Импорт $DUMP ..."
set +e
$COMPOSE exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-acl < "$DUMP" 2>&1 | tee /tmp/pg_restore.log
RESTORE_EXIT=$?
set -e

SALE_COUNT=$($COMPOSE exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc 'SELECT count(*) FROM "Sale";' | tr -d '[:space:]')
echo "Продаж в БД после импорта: ${SALE_COUNT:-0}"

if [[ "${SALE_COUNT:-0}" -lt 1 ]]; then
  echo "ОШИБКА: таблица Sale пуста. См. /tmp/pg_restore.log"
  echo "Попробуйте: bash $ROOT/scripts/timeweb/migrate-via-api-on-server.sh"
  $COMPOSE up -d api caddy || true
  exit 1
fi

echo "Запуск API..."
$COMPOSE up -d --build api caddy
sleep 8
curl -s http://127.0.0.1/health
echo ""
echo "Импорт OK (Sale=$SALE_COUNT). Вход: director / Bufet000"

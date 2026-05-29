#!/usr/bin/env bash
# Импорт backup.dump в Postgres на Timeweb (запускать НА СЕРВЕРЕ в /opt/sales-platform).
set -euo pipefail

ROOT="/opt/sales-platform"
DUMP="${1:-$ROOT/backup.dump}"
COMPOSE="docker compose -f $ROOT/deploy/timeweb/docker-compose.yml --env-file $ROOT/deploy/timeweb/.env"

if [[ ! -f "$DUMP" ]]; then
  echo "Файл не найден: $DUMP"
  echo "Скопируйте dump: scp deploy/timeweb/backups/render-*.dump root@IP:/opt/sales-platform/backup.dump"
  exit 1
fi

cd "$ROOT/deploy/timeweb"
$COMPOSE up -d postgres
echo "Ждём Postgres..."
sleep 8

source .env
$COMPOSE exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-acl < "$DUMP" || {
  echo "pg_restore завершился с предупреждениями (часто это нормально). Проверьте /health."
}

$COMPOSE up -d --build
echo "Импорт завершён. Проверка: curl -s http://127.0.0.1/health"

#!/usr/bin/env bash
# Сброс пароля director в БД на Timeweb (после импорта с Render пароль мог быть другим).
# Запуск на сервере:
#   NEW_PASSWORD='Bufet000' /opt/sales-platform/scripts/timeweb/reset-director-password.sh
set -euo pipefail

ROOT="/opt/sales-platform"
COMPOSE="docker compose -f $ROOT/deploy/timeweb/docker-compose.yml --env-file $ROOT/deploy/timeweb/.env"
NEW_PASSWORD="${NEW_PASSWORD:-Bufet000}"

if [[ ${#NEW_PASSWORD} -lt 8 ]]; then
  echo "Пароль должен быть не короче 8 символов."
  exit 1
fi

cd "$ROOT/deploy/timeweb"
source .env

# Экранирование одинарных кавычек для SQL
SQL_PASSWORD="${NEW_PASSWORD//\'/\'\'}"

$COMPOSE exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 <<SQL
UPDATE "User" SET password = '${SQL_PASSWORD}' WHERE nickname = 'director';
SELECT nickname, left(password, 3) || '***' AS password_mask FROM "User" WHERE nickname = 'director';
SQL

echo "Перезапуск API (подхватит пароль из БД)..."
$COMPOSE restart api
sleep 5
curl -s http://127.0.0.1/health
echo ""
echo "Готово. Войдите: director / ${NEW_PASSWORD}"

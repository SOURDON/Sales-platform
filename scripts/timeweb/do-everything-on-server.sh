#!/usr/bin/env bash
# Один запуск на сервере: повторный импорт с Render + проверка + обновление API.
#
# Подготовка (один раз): сохраните URL базы Render в файл (не коммитьте):
#   nano /opt/sales-platform/.render-database-url
#   # вставьте строку postgresql://... из Render → PostgreSQL → External URL
#
# Запуск:
#   bash /opt/sales-platform/scripts/timeweb/do-everything-on-server.sh
set -eo pipefail

ROOT="/opt/sales-platform"
URL_FILE="$ROOT/.render-database-url"
COMPOSE="docker compose -f $ROOT/deploy/timeweb/docker-compose.yml --env-file $ROOT/deploy/timeweb/.env"

if [[ ! -f "$URL_FILE" ]]; then
  echo "Создайте файл $URL_FILE с External Database URL из Render."
  exit 1
fi

export RENDER_DATABASE_URL="$(tr -d '[:space:]' < "$URL_FILE")"
if [[ "$RENDER_DATABASE_URL" != postgresql://* ]]; then
  echo "В $URL_FILE должна быть строка postgresql://..."
  exit 1
fi

cd "$ROOT"
git pull

echo "=== Импорт с Render (5–15 мин) ==="
bash "$ROOT/scripts/timeweb/reimport-from-render.sh"

DUMP_SIZE=$(stat -c%s "$ROOT/backup.dump" 2>/dev/null || stat -f%z "$ROOT/backup.dump")
if [[ ! -f "$ROOT/backup.dump" ]] || [[ "$DUMP_SIZE" -lt 10000 ]]; then
  echo "ОШИБКА: backup.dump слишком маленький ($DUMP_SIZE байт) — экспорт не удался."
  exit 1
fi
ls -lh "$ROOT/backup.dump"

echo "=== Обновление API (больше истории продаж в памяти) ==="
if ! grep -q '^SALES_MEMORY_DAYS=' "$ROOT/deploy/timeweb/.env" 2>/dev/null; then
  echo 'SALES_MEMORY_DAYS=1825' >> "$ROOT/deploy/timeweb/.env"
fi
cd "$ROOT/deploy/timeweb"
$COMPOSE up -d --build api
sleep 8

echo "=== Проверка ==="
curl -s http://127.0.0.1/health
echo ""
bash "$ROOT/scripts/timeweb/verify-data-on-server.sh"

echo ""
echo "Готово. Desktop: director / пароль как на Render (обычно Bufet000). Проверьте Sale > 0 выше."

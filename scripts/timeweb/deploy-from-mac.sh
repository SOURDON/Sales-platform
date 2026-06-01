#!/usr/bin/env bash
# С Mac: push (если нужно) + деплой API на Timeweb по SSH.
#   bash scripts/timeweb/deploy-from-mac.sh
# SSH: root@77.233.223.48 (пароль из панели Timeweb) или export TIMEWEB_SSH=user@host
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

SERVER="${TIMEWEB_SSH:-root@77.233.223.48}"

echo "=== 1/3 Локально: отправка в GitHub (main) ==="
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Есть незакоммиченные изменения — закоммитьте или отмените деплой."
  git status -sb
  exit 1
fi
git push origin main

echo ""
echo "=== 2/3 Сервер: git pull + docker compose build/up ==="
ssh -o ConnectTimeout=20 "$SERVER" 'bash /opt/sales-platform/scripts/timeweb/deploy-update.sh'

echo ""
echo "=== 3/3 Сервер: точки a1–a8 + перезапуск API (кэш) ==="
ssh -o ConnectTimeout=20 "$SERVER" 'bash /opt/sales-platform/scripts/timeweb/ensure-demo-admins.sh'

echo ""
echo "Проверка health:"
curl -sf --connect-timeout 8 "http://77.233.223.48/health" && echo " OK" || echo " (нет ответа — подождите минуту)"

echo ""
echo "Готово. Десктоп 1.0.24 уже с фильтром смены; API обновлён на сервере."

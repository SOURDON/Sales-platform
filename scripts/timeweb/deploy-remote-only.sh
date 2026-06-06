#!/usr/bin/env bash
# Только обновление API на Timeweb (без git push). Код в main уже должен быть на GitHub.
#   bash scripts/timeweb/deploy-remote-only.sh
# SSH: root@77.233.223.48 — пароль root из панели Timeweb (или export TIMEWEB_SSH=user@host).
set -euo pipefail

SERVER="${TIMEWEB_SSH:-root@77.233.223.48}"

echo "=== Сервер: git pull + docker compose build/up ==="
ssh -o ConnectTimeout=20 "$SERVER" 'bash /opt/sales-platform/scripts/timeweb/deploy-update.sh'

echo ""
echo "=== Сервер: точки a1–a8 + перезапуск API ==="
ssh -o ConnectTimeout=20 "$SERVER" 'bash /opt/sales-platform/scripts/timeweb/ensure-demo-admins.sh'

echo ""
echo "Проверка health:"
curl -sf --connect-timeout 8 "http://77.233.223.48/health" && echo " OK" || echo " (нет ответа — подождите минуту)"

echo ""
echo "Проверка: админ может читать % управляющего (ожидается HTTP 200, не «Only director»):"
TOKEN=$(curl -s -X POST "http://77.233.223.48/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"nickname":"a7","password":"Foto-2026-9kLq"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || true)
if [[ -n "$TOKEN" ]]; then
  curl -s -w "\nHTTP %{http_code}\n" "http://77.233.223.48/admin/manager-store-commissions" \
    -H "Authorization: Bearer $TOKEN" | tail -5
else
  echo "Не удалось войти как a7 для проверки."
fi

echo ""
echo "Готово. В приложении нажмите ↻ (синхронизация)."

#!/usr/bin/env bash
# Двойной клик на Mac: починить a1/a2 на Timeweb + проверка.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SERVER="${TIMEWEB_SSH:-root@77.233.223.48}"

echo "=== 1/2 Сервер: ensure-demo-admins + перезапуск API ==="
ssh -o ConnectTimeout=15 "$SERVER" 'cd /opt/sales-platform && git pull && bash scripts/timeweb/ensure-demo-admins.sh'

echo ""
echo "=== 2/2 Mac: проверка API ==="
bash "$REPO/scripts/repair-missing-demo-admins.sh" && OK=1 || OK=0

echo ""
if [[ "$OK" == 1 ]]; then
  echo "Готово. Закройте Fotografy (Cmd+Q) и откройте снова."
else
  echo "Проверка не прошла — скопируйте вывод выше и отправьте в чат."
fi
echo ""
read -r -p "Нажмите Enter, чтобы закрыть окно…" _

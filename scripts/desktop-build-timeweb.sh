#!/usr/bin/env bash
# Сборка Fotografy для Timeweb (проверка API + .dmg).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
API_URL="${VITE_API_URL:-http://77.233.223.48}"

echo "=== Fotografy → Timeweb ==="
echo "API: $API_URL"
echo ""

printf 'VITE_API_URL=%s\n' "$API_URL" > "$REPO/desktop/.env"

if [[ -x "$REPO/scripts/desktop-smoke.sh" ]]; then
  bash "$REPO/scripts/desktop-smoke.sh" "$API_URL" || {
    echo "API smoke failed. Fix Timeweb before build."
    exit 1
  }
fi

DESKTOP_BUILD_SKIP_CONFIRM=1 DESKTOP_BUILD_SKIP_SMOKE=1 bash "$REPO/scripts/desktop-build.sh"

echo ""
echo "Готово. Установите новый .dmg из desktop/dist/"
echo "Вход: director / Bufet000"
echo "Старый Render можно остановить в панели Render."

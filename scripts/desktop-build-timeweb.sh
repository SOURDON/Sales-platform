#!/usr/bin/env bash
# Сборка Fotografy для Timeweb (только на Mac, не на SSH-сервере).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
API_URL="${VITE_API_URL:-http://77.233.223.48}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Сборка .dmg только на macOS. На сервере Timeweb — только: git pull && bash scripts/timeweb/fix-cors-for-ip.sh"
  exit 1
fi

# Portable Node из репозитория (если нет системного npm)
if [[ -d "$REPO/.node-portable" ]]; then
  NODE_DIR="$(find "$REPO/.node-portable" -maxdepth 1 -type d -name 'node-v*' 2>/dev/null | head -1)"
  if [[ -n "$NODE_DIR" && -x "$NODE_DIR/bin/npm" ]]; then
    export PATH="$NODE_DIR/bin:$PATH"
  fi
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Установите Node.js LTS: https://nodejs.org/"
  echo "Или откройте проект в Cursor — в репозитории есть .node-portable."
  exit 1
fi

echo "=== Fotografy → Timeweb (сборка на Mac) ==="
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
echo "Готово: Fotografy.app и .dmg в ~/Desktop/работа над приложением"
echo "Ярлыки .command (деплой, перезапуск): bash scripts/install-work-folder-shortcuts.sh — только по необходимости"
echo "Вход: director / Bufet000"

#!/usr/bin/env bash
# Перезапуск десктопа в режиме разработки (Vite + окно Tauri).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

if [[ -d "$REPO/.node-portable" ]]; then
  NODE_DIR="$(find "$REPO/.node-portable" -maxdepth 1 -type d -name 'node-v*' 2>/dev/null | head -1)"
  if [[ -n "$NODE_DIR" && -x "$NODE_DIR/bin/npm" ]]; then
    export PATH="$NODE_DIR/bin:$PATH"
  fi
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Не найден npm. Установите Node или проверьте .node-portable в проекте." >&2
  exit 1
fi

API_URL="$(grep -E '^VITE_API_URL=' "$REPO/desktop/.env" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
[[ -z "$API_URL" || "$API_URL" == *onrender* ]] && API_URL="http://77.233.223.48"

echo "=== Перезапуск «Фотографы» (разработка) ==="
echo "API: Timeweb → $API_URL"
echo ""

echo "Останавливаем предыдущий запуск…"
if command -v lsof >/dev/null 2>&1; then
  lsof -ti :5173 2>/dev/null | xargs kill 2>/dev/null || true
fi
pkill -f "tauri dev" 2>/dev/null || true
pkill -f "sales-platform-desktop" 2>/dev/null || true
pkill -f "target/debug/Фотографы" 2>/dev/null || true
pkill -f "target/debug/sales-platform" 2>/dev/null || true
sleep 1

if [[ ! -f "$REPO/desktop/package.json" ]]; then
  echo "Не найден каталог desktop/. Запускайте скрипт из репозитория Sales-platform." >&2
  exit 1
fi

echo "Запускаем… (это окно можно свернуть; закрытие окна остановит приложение)"
echo ""
cd "$REPO/desktop"
exec npm run dev

#!/usr/bin/env bash
# Запуск офлайн-директора Fotografy Director (dev, Mac).
# Не трогает desktop/.env боевого приложения.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

if [[ -d "$REPO/.node-portable" ]]; then
  NODE_DIR="$(find "$REPO/.node-portable" -maxdepth 1 -type d -name 'node-v*' 2>/dev/null | head -1)"
  if [[ -n "$NODE_DIR" && -x "$NODE_DIR/bin/npm" ]]; then
    export PATH="$NODE_DIR/bin:$PATH"
    echo "Используем Node из $NODE_DIR"
  fi
fi

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Не установлено: $1 — $2" >&2
    exit 1
  fi
}

need node "https://nodejs.org/ (LTS)"
need npm "идёт вместе с Node"
need cargo "https://rustup.rs/"
need rustc "rustup default stable"

if [[ ! -f "$REPO/desktop/.env.director-offline" ]]; then
  echo "Не найден desktop/.env.director-offline" >&2
  exit 1
fi

if [[ ! -f "$REPO/desktop/src-tauri/icons-director/icon.icns" ]]; then
  echo "Генерируем иконки офлайн-директора…"
  (cd "$REPO/desktop" && npm run icon:director)
fi

echo "=== Установка зависимостей (первый раз может занять несколько минут) ==="
(cd "$REPO/frontend" && npm install)
(cd "$REPO/desktop" && npm install)

if command -v lsof >/dev/null 2>&1; then
  STALE_PIDS="$(lsof -ti :5173 2>/dev/null || true)"
  if [[ -n "$STALE_PIDS" ]]; then
    echo "=== Порт 5173 занят. Останавливаем старый Vite… ==="
    kill $STALE_PIDS 2>/dev/null || true
    sleep 1
  fi
fi
pkill -f "tauri dev --config src-tauri/tauri.director.conf.json" 2>/dev/null || true
pkill -f "target/debug/Fotografy" 2>/dev/null || true
sleep 1

export DESKTOP_BUILD_PROFILE=director-offline
echo ""
echo "=== Fotografy Director 1.0.0 (офлайн-директор) ==="
echo "Это окно можно свернуть. Закрытие окна остановит приложение."
echo ""

cd "$REPO/desktop"
exec npm run dev:director

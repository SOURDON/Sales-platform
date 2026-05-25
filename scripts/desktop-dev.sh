#!/usr/bin/env bash
# Запуск десктопа для разработки: backend + окно Tauri (нужны Node, Rust, PostgreSQL).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
NODE_DIR=""

# Portable Node в репозитории (если системный npm не установлен)
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

for f in frontend/.env desktop/.env; do
  if [[ ! -f "$REPO/$f" ]]; then
    cp "$REPO/${f}.example" "$REPO/$f"
    echo "Создан $f из примера"
  fi
done

if [[ ! -f "$REPO/backend/.env" ]]; then
  echo ""
  echo "Нужен backend/.env с DATABASE_URL (скопируйте из backend/.env.example и укажите PostgreSQL)."
  echo "Затем: cd backend && npm install && npm run db:sync && npm run start:dev"
  echo ""
fi

if [[ ! -f "$REPO/desktop/src-tauri/icons/icon.icns" ]]; then
  if [[ "$(uname -s)" == "Darwin" ]]; then
    bash "$REPO/desktop/scripts/generate-icons.sh"
  else
    echo "Сначала: cd desktop && npm run icon" >&2
    exit 1
  fi
fi

echo "=== Установка зависимостей (первый раз может занять несколько минут) ==="
(cd "$REPO/frontend" && npm install)
(cd "$REPO/desktop" && npm install)

# Dev: тот же API, что в desktop/.env (иначе frontend/.env часто указывает localhost)
if [[ -f "$REPO/desktop/.env" ]]; then
  DESKTOP_API="$(grep -E '^VITE_API_URL=' "$REPO/desktop/.env" | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
  if [[ -n "$DESKTOP_API" ]]; then
    FE_ENV="$REPO/frontend/.env"
    if [[ -f "$FE_ENV" ]] && grep -q '^VITE_API_URL=' "$FE_ENV"; then
      if [[ "$(uname -s)" == "Darwin" ]]; then
        sed -i '' "s|^VITE_API_URL=.*|VITE_API_URL=$DESKTOP_API|" "$FE_ENV"
      else
        sed -i "s|^VITE_API_URL=.*|VITE_API_URL=$DESKTOP_API|" "$FE_ENV"
      fi
    else
      echo "VITE_API_URL=$DESKTOP_API" >> "$FE_ENV"
    fi
    echo "Для dev: frontend/.env → VITE_API_URL=$DESKTOP_API"
  fi
fi

API_URL="$(grep -E '^VITE_API_URL=' "$REPO/desktop/.env" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
echo ""
if [[ "$API_URL" == *localhost* ]] || [[ -z "$API_URL" ]]; then
  echo "=== Нужен локальный backend (отдельное окно терминала) ==="
  echo "  cd $REPO/backend && npm run start:dev"
  echo ""
  echo "Если во втором терминале «command not found: npm», сначала в ЭТОМ окне выполните:"
  if [[ -n "$NODE_DIR" ]]; then
    echo "  export PATH=\"$NODE_DIR/bin:\$PATH\""
  fi
  echo "  (или установите Node с https://nodejs.org/)"
  echo ""
else
  echo "=== Backend на Mac НЕ нужен ==="
  echo "API: $API_URL"
  echo "Можно сразу запускать десктоп (Enter)."
  echo ""
fi
if command -v lsof >/dev/null 2>&1; then
  STALE_PIDS="$(lsof -ti :5173 2>/dev/null || true)"
  if [[ -n "$STALE_PIDS" ]]; then
    echo "=== Порт 5173 занят (старый Vite?). Останавливаем… ==="
    kill $STALE_PIDS 2>/dev/null || true
    sleep 1
  fi
fi

echo "=== Нажмите Enter для запуска окна «Фотографы» ==="
read -r _

cd "$REPO/desktop"
npm run dev

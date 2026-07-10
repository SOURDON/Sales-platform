#!/usr/bin/env bash
# Сборка установщика .dmg (macOS) или .exe (Windows). Перед сборкой задайте API в desktop/.env
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -d "$REPO/.node-portable" ]]; then
  NODE_DIR="$(find "$REPO/.node-portable" -maxdepth 1 -type d -name 'node-v*' 2>/dev/null | head -1)"
  if [[ -n "$NODE_DIR" && -x "$NODE_DIR/bin/npm" ]]; then
    export PATH="$NODE_DIR/bin:$PATH"
  fi
fi

if [[ ! -f "$REPO/desktop/.env" ]]; then
  cp "$REPO/desktop/.env.example" "$REPO/desktop/.env"
  echo "Создан desktop/.env — укажите VITE_API_URL=URL_вашего_сервера перед прод-сборкой!"
fi

API_URL="$(grep -E '^VITE_API_URL=' "$REPO/desktop/.env" | cut -d= -f2- | tr -d '"' | tr -d "'")"
if [[ "$API_URL" == *localhost* ]]; then
  echo "Внимание: VITE_API_URL=$API_URL — для раздачи сотрудникам укажите боевой URL API в desktop/.env"
  if [[ "${DESKTOP_BUILD_SKIP_CONFIRM:-}" != "1" ]]; then
    read -p "Продолжить? [y/N] " -n 1 -r
    echo
    [[ $REPLY =~ ^[Yy]$ ]] || exit 0
  fi
fi

if [[ -x "$REPO/scripts/desktop-smoke.sh" ]]; then
  bash "$REPO/scripts/desktop-smoke.sh" "$API_URL" || {
    echo "Smoke не прошёл. Исправьте API/CORS или запустите с DESKTOP_BUILD_SKIP_SMOKE=1"
    [[ "${DESKTOP_BUILD_SKIP_SMOKE:-}" == "1" ]] || exit 1
  }
fi

command -v node >/dev/null || { echo "Установите Node.js LTS"; exit 1; }
command -v npm >/dev/null || { echo "Установите npm"; exit 1; }
command -v cargo >/dev/null || { echo "Установите Rust: https://rustup.rs/"; exit 1; }

if [[ ! -f "$REPO/desktop/src-tauri/icons/icon.icns" ]] && [[ "$(uname -s)" == "Darwin" ]]; then
  bash "$REPO/desktop/scripts/generate-icons.sh"
fi

(cd "$REPO/frontend" && npm install)
(cd "$REPO/desktop" && npm install && npm run build)

find_bundle_artifact() {
  local kind="$1"
  local pattern="$2"
  local -a roots=(
    "$REPO/desktop/src-tauri/target"
    "$REPO/desktop/releases"
    "${CARGO_TARGET_DIR:-}"
  )
  local root dmg
  for root in "${roots[@]}"; do
    [[ -n "$root" && -d "$root" ]] || continue
    dmg="$(find "$root" -path "*/bundle/$kind/$pattern" -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null | head -1)"
    [[ -n "$dmg" ]] && { echo "$dmg"; return 0; }
  done
  return 1
}

OUT_DIR="$REPO/desktop/dist"
mkdir -p "$OUT_DIR"
if [[ "$(uname -s)" == "Darwin" ]]; then
  DMG="$(find_bundle_artifact dmg '*.dmg' || true)"
  if [[ -n "$DMG" ]]; then
    cp "$DMG" "$OUT_DIR/"
    echo "Скопировано в $OUT_DIR/$(basename "$DMG")"
  else
    echo "Ошибка: .dmg не найден после tauri build (проверьте target/ или CARGO_TARGET_DIR)"
    exit 1
  fi
else
  EXE="$(find_bundle_artifact nsis '*setup.exe' || true)"
  if [[ -n "$EXE" ]]; then
    cp "$EXE" "$OUT_DIR/"
    echo "Скопировано в $OUT_DIR/$(basename "$EXE")"
  else
    echo "Ошибка: setup.exe не найден после tauri build"
    exit 1
  fi
fi
echo "Инструкция для пользователей: docs/DESKTOP_USER_GUIDE.md"
if [[ "$(uname -s)" == "Darwin" && "${DESKTOP_BUILD_SKIP_WORK_FOLDER:-}" != "1" && "${CI:-}" != "true" ]]; then
  bash "$REPO/scripts/publish-desktop-to-work-folder.sh"
fi

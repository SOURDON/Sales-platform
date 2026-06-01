#!/usr/bin/env bash
# Перезапуск Fotografy.app (ищет приложение или ставит с последнего .dmg).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_SCRIPT="$REPO/scripts/install-fotografy-from-dmg.sh"

find_app() {
  local candidate
  for candidate in \
    "$HOME/Desktop/Fotografy.app" \
    "/Applications/Fotografy.app" \
    "$HOME/Applications/Fotografy.app"; do
    if [[ -d "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  if command -v mdfind >/dev/null 2>&1; then
    local found
    found="$(mdfind "kMDItemCFBundleIdentifier == 'ru.salesplatform.desktop'" 2>/dev/null | head -1)"
    if [[ -n "$found" && -d "$found" ]]; then
      echo "$found"
      return 0
    fi
  fi
  return 1
}

echo "=== Перезапуск Fotografy ==="
echo ""

echo "Закрываем приложение…"
osascript -e 'quit app "Fotografy"' 2>/dev/null || true
pkill -x Fotografy 2>/dev/null || true
sleep 1

APP="$(find_app || true)"
if [[ -z "$APP" ]]; then
  echo "Fotografy.app не найден — ставим на рабочий стол из последнего .dmg…"
  if [[ ! -x "$INSTALL_SCRIPT" ]]; then
    echo "Не найден: $INSTALL_SCRIPT" >&2
    exit 1
  fi
  bash "$INSTALL_SCRIPT" "$HOME/Desktop/Fotografy.app"
  APP="$HOME/Desktop/Fotografy.app"
fi

if [[ ! -d "$APP" ]]; then
  echo "Не удалось найти или установить Fotografy.app." >&2
  echo "Соберите новую версию на Mac:" >&2
  echo "  cd $REPO && bash scripts/desktop-build-timeweb.sh" >&2
  exit 1
fi

echo "Запускаем: $APP"
open "$APP"
echo ""
echo "Готово."

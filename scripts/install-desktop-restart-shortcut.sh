#!/usr/bin/env bash
# Один ярлык перезапуска в «работа над приложением» (macOS).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/desktop-work-dir.sh
source "$REPO/scripts/lib/desktop-work-dir.sh"
TARGET="$DESKTOP_WORK_DIR/Перезапуск-Fotografy.command"
SRC="$REPO/scripts/mac/Перезапуск-Fotografy.command"
RESTART="$REPO/scripts/restart-desktop-installed.sh"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Этот скрипт только для macOS." >&2
  exit 1
fi

chmod +x "$RESTART"
cp "$SRC" "$TARGET"
chmod +x "$TARGET"

# Убираем старые дубликаты, если остались от прошлых установок.
for old in \
  "$DESKTOP_WORK_DIR/Перезапуск Fotografy.command" \
  "$DESKTOP_WORK_DIR/Перезапуск приложения.command" \
  "$DESKTOP_WORK_DIR/Перезапуск Фотографы (dev).command"; do
  [[ -e "$old" ]] && rm -f "$old"
done

echo "Готово: $TARGET"

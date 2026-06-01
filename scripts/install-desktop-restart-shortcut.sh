#!/usr/bin/env bash
# Кладёт ярлыки перезапуска в папку «работа над приложением» (macOS).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/desktop-work-dir.sh
source "$REPO/scripts/lib/desktop-work-dir.sh"
TARGET_DEV="$DESKTOP_WORK_DIR/Перезапуск Фотографы (dev).command"
TARGET_APP="$DESKTOP_WORK_DIR/Перезапуск Fotografy.command"
SRC_APP="$REPO/scripts/mac/Перезапуск-Fotografy.command"
RESTART_DEV="$REPO/scripts/restart-desktop-dev.sh"
RESTART_APP="$REPO/scripts/restart-desktop-installed.sh"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Этот скрипт только для macOS." >&2
  exit 1
fi

for f in "$RESTART_DEV" "$RESTART_APP"; do
  if [[ ! -f "$f" ]]; then
    echo "Не найден: $f" >&2
    exit 1
  fi
  chmod +x "$f"
done

write_shortcut() {
  local target="$1"
  local script="$2"
  cat > "$target" <<EOF
#!/bin/bash
export SALES_PLATFORM_REPO="$REPO"
exec bash "$script"
EOF
  chmod +x "$target"
}

if [[ -f "$SRC_APP" ]]; then
  cp "$SRC_APP" "$TARGET_APP"
  chmod +x "$TARGET_APP"
else
  write_shortcut "$TARGET_APP" "$RESTART_APP"
fi
write_shortcut "$TARGET_DEV" "$RESTART_DEV"

echo "Готово."
echo "  $TARGET_APP — закрыть и снова открыть Fotografy.app"
echo "  $TARGET_DEV — перезапуск в режиме разработки (npm run dev)"
echo "Проект: $REPO"

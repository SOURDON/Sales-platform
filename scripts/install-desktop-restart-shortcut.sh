#!/usr/bin/env bash
# Кладёт ярлык «Перезапуск Фотографы» на рабочий стол (macOS).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$HOME/Desktop/Перезапуск Фотографы.command"
RESTART_SCRIPT="$REPO/scripts/restart-desktop-dev.sh"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Этот скрипт только для macOS." >&2
  exit 1
fi

if [[ ! -f "$RESTART_SCRIPT" ]]; then
  echo "Не найден: $RESTART_SCRIPT" >&2
  exit 1
fi

chmod +x "$RESTART_SCRIPT"

# На рабочем столе нельзя копировать .command «как есть» — dirname будет Desktop, не проект.
cat > "$TARGET" <<EOF
#!/bin/bash
export SALES_PLATFORM_REPO="$REPO"
exec bash "$RESTART_SCRIPT"
EOF
chmod +x "$TARGET"

echo "Готово."
echo "На рабочем столе: $TARGET"
echo "Проект: $REPO"
echo ""
echo "Дважды нажмите на ярлык — откроется терминал и запустится приложение."
echo "Чтобы остановить: закройте окно «Фотографы» и нажмите Ctrl+C в терминале."

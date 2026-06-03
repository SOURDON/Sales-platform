#!/usr/bin/env bash
# Ярлыки .command в «работа над приложением» (один раз или по запросу).
# Сборка десктопа по умолчанию вызывает publish-desktop-to-work-folder.sh (без ярлыков).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/desktop-work-dir.sh
source "$REPO/scripts/lib/desktop-work-dir.sh"
mkdir -p "$DESKTOP_WORK_DIR"

bash "$REPO/scripts/install-desktop-restart-shortcut.sh"
bash "$REPO/scripts/install-fix-a1-desktop-shortcut.sh"

for base in "Перезапуск-Fotografy.command" "Деплой-Timeweb.command" "Отключить-Render-инструкция.command"; do
  src="$REPO/scripts/mac/$base"
  [[ -f "$src" ]] || continue
  cp "$src" "$DESKTOP_WORK_DIR/$base"
  chmod +x "$DESKTOP_WORK_DIR/$base"
done

echo ""
echo "Ярлыки установлены: $DESKTOP_WORK_DIR"
ls -la "$DESKTOP_WORK_DIR"

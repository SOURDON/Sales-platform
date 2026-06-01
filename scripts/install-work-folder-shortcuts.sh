#!/usr/bin/env bash
# Все ярлыки и актуальный Fotografy.app → «работа над приложением» на рабочем столе.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/desktop-work-dir.sh
source "$REPO/scripts/lib/desktop-work-dir.sh"

bash "$REPO/scripts/install-desktop-restart-shortcut.sh"
bash "$REPO/scripts/install-fix-a1-desktop-shortcut.sh"

for base in "Перезапуск-Fotografy.command" "Деплой-Timeweb.command" "Отключить-Render-инструкция.command"; do
  src="$REPO/scripts/mac/$base"
  [[ -f "$src" ]] || continue
  cp "$src" "$DESKTOP_WORK_DIR/$base"
  chmod +x "$DESKTOP_WORK_DIR/$base"
done

DMG="$(ls -t "$REPO/desktop/dist/"Fotografy_*.dmg 2>/dev/null | head -1 || true)"
if [[ -n "$DMG" ]]; then
  cp "$DMG" "$DESKTOP_WORK_DIR/"
  bash "$REPO/scripts/install-fotografy-from-dmg.sh" "$DESKTOP_WORK_DIR/Fotografy.app"
fi

echo ""
echo "Папка артефактов: $DESKTOP_WORK_DIR"
ls -la "$DESKTOP_WORK_DIR"

#!/usr/bin/env bash
# Только релиз десктопа в «работа над приложением»: последний .dmg + Fotografy.app.
# Ярлыки .command не трогаем — их ставит install-work-folder-shortcuts.sh по запросу.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/desktop-work-dir.sh
source "$REPO/scripts/lib/desktop-work-dir.sh"

mkdir -p "$DESKTOP_WORK_DIR"

DMG="$(ls -t "$REPO"/desktop/dist/Fotografy_*.dmg "$REPO"/desktop/releases/Fotografy_*.dmg 2>/dev/null | head -1 || true)"
if [[ -z "$DMG" ]]; then
  echo "Нет .dmg в $REPO/desktop/dist/ или desktop/releases/ — сначала: bash scripts/desktop-build-timeweb.sh"
  exit 1
fi

DMG_NAME="$(basename "$DMG")"
for old in "$DESKTOP_WORK_DIR"/Fotografy_*.dmg; do
  [[ -e "$old" ]] || continue
  [[ "$(basename "$old")" == "$DMG_NAME" ]] && continue
  rm -f "$old"
done
cp "$DMG" "$DESKTOP_WORK_DIR/$DMG_NAME"

bash "$REPO/scripts/install-fotografy-from-dmg.sh" "$DESKTOP_WORK_DIR/Fotografy.app"

DEPLOY_SRC="$REPO/scripts/mac/Деплой-Timeweb.command"
if [[ -f "$DEPLOY_SRC" ]]; then
  cp "$DEPLOY_SRC" "$DESKTOP_WORK_DIR/"
  chmod +x "$DESKTOP_WORK_DIR/Деплой-Timeweb.command"
fi

echo "Готово (приложение + деплой):"
echo "  $DESKTOP_WORK_DIR/$DMG_NAME"
echo "  $DESKTOP_WORK_DIR/Fotografy.app"

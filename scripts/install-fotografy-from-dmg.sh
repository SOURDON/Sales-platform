#!/usr/bin/env bash
# Ставит Fotografy.app в «работа над приложением» из последнего .dmg в desktop/dist.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/desktop-work-dir.sh
source "$REPO/scripts/lib/desktop-work-dir.sh"
DEST="${1:-$DESKTOP_WORK_DIR/Fotografy.app}"
DMG="$(ls -t "$REPO"/desktop/dist/Fotografy_*.dmg "$REPO"/desktop/releases/Fotografy_*.dmg 2>/dev/null | head -1)"

if [[ -z "$DMG" ]]; then
  echo "Нет .dmg в $REPO/desktop/dist/"
  echo "На Mac выполните: bash scripts/desktop-build-timeweb.sh"
  exit 1
fi

echo "Установка из: $(basename "$DMG")"
hdiutil detach "/Volumes/Fotografy" -quiet 2>/dev/null || true

ATTACH_LINE="$(hdiutil attach "$DMG" -nobrowse -readonly | tail -1)"
VOL="$(echo "$ATTACH_LINE" | awk '{print $NF}')"
if [[ ! -d "$VOL" ]]; then
  echo "Не удалось смонтировать образ."
  exit 1
fi

SRC=""
for name in Fotografy.app "Фотографы.app"; do
  if [[ -d "$VOL/$name" ]]; then
    SRC="$VOL/$name"
    break
  fi
done
if [[ -z "$SRC" ]]; then
  SRC="$(find "$VOL" -maxdepth 2 -name '*.app' -type d 2>/dev/null | head -1)"
fi
if [[ -z "$SRC" || ! -d "$SRC" ]]; then
  hdiutil detach "$VOL" -quiet 2>/dev/null || true
  echo "В образе не найден .app"
  exit 1
fi

rm -rf "$DEST"
ditto "$SRC" "$DEST"
hdiutil detach "$VOL" -quiet 2>/dev/null || true
echo "Готово: $DEST"

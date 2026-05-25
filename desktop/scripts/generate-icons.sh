#!/usr/bin/env bash
# Генерация иконок Tauri из frontend/public/app-icon.svg (macOS: qlmanage + sips + iconutil).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"
ICONS="$ROOT/src-tauri/icons"
SVG="$REPO/frontend/public/app-icon.svg"

if [[ ! -f "$SVG" ]]; then
  echo "Не найден $SVG" >&2
  exit 1
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "На macOS: запустите этот скрипт или: cd desktop && npm run icon" >&2
  exit 1
fi

mkdir -p "$ICONS"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

qlmanage -t -s 1024 -o "$TMP" "$SVG" >/dev/null 2>&1
PNG="$(find "$TMP" -name '*.png' | head -1)"
if [[ -z "$PNG" ]]; then
  echo "qlmanage не создал PNG из SVG" >&2
  exit 1
fi

BASE="$TMP/base1024.png"
cp "$PNG" "$BASE"
sips -z 32 32 "$BASE" --out "$ICONS/32x32.png" >/dev/null
sips -z 128 128 "$BASE" --out "$ICONS/128x128.png" >/dev/null
sips -z 256 256 "$BASE" --out "$ICONS/128x128@2x.png" >/dev/null

ICONSET="$TMP/AppIcon.iconset"
mkdir -p "$ICONSET"
sips -z 16 16 "$BASE" --out "$ICONSET/icon_16x16.png" >/dev/null
sips -z 32 32 "$BASE" --out "$ICONSET/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$BASE" --out "$ICONSET/icon_32x32.png" >/dev/null
sips -z 64 64 "$BASE" --out "$ICONSET/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$BASE" --out "$ICONSET/icon_128x128.png" >/dev/null
sips -z 256 256 "$BASE" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$BASE" --out "$ICONSET/icon_256x256.png" >/dev/null
sips -z 512 512 "$BASE" --out "$ICONSET/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$BASE" --out "$ICONSET/icon_512x512.png" >/dev/null
sips -z 1024 1024 "$BASE" --out "$ICONSET/icon_512x512@2x.png" >/dev/null
iconutil -c icns "$ICONSET" -o "$ICONS/icon.icns"

python3 "$(dirname "$0")/make-icon-ico.py"
echo "Иконки готовы: $ICONS"

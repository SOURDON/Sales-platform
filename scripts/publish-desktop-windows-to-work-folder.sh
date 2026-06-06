#!/usr/bin/env bash
# Копирует Windows setup.exe в «работа над приложением» (после download-windows-desktop-artifact.sh).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/desktop-work-dir.sh
source "$REPO/scripts/lib/desktop-work-dir.sh"

EXE="$(ls -t "$REPO/desktop/dist/"*setup.exe 2>/dev/null | head -1 || true)"
if [[ -z "$EXE" ]]; then
  echo "Нет setup.exe в desktop/dist/"
  echo "Сначала: GH_TOKEN=... bash scripts/download-windows-desktop-artifact.sh"
  echo "Или скачайте артефакт: https://github.com/SOURDON/Sales-platform/actions/workflows/desktop-windows.yml"
  exit 1
fi

mkdir -p "$DESKTOP_WORK_DIR"
EXE_NAME="$(basename "$EXE")"
for old in "$DESKTOP_WORK_DIR"/*setup.exe "$DESKTOP_WORK_DIR"/Fotografy_*setup.exe; do
  [[ -e "$old" ]] || continue
  [[ "$(basename "$old")" == "$EXE_NAME" ]] && continue
  rm -f "$old"
done
cp "$EXE" "$DESKTOP_WORK_DIR/$EXE_NAME"

echo "Готово (Windows):"
echo "  $DESKTOP_WORK_DIR/$EXE_NAME"

#!/usr/bin/env bash
# Копирует «Починить точки a1 a2» в папку «работа над приложением».
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/desktop-work-dir.sh
source "$REPO/scripts/lib/desktop-work-dir.sh"
SRC="$REPO/scripts/mac/Починить-точки-a1-a2.command"
DEST="$DESKTOP_WORK_DIR/Починить точки a1 a2.command"
chmod +x "$SRC"
cp "$SRC" "$DEST"
chmod +x "$DEST"
echo "Создано: $DEST"
echo "Дважды кликните — нужен SSH (как в Terminal root@77.233.223.48)."

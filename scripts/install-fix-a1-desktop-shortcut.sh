#!/usr/bin/env bash
# Копирует «Починить точки a1 a2» на рабочий стол.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO/scripts/mac/Починить-точки-a1-a2.command"
DEST="$HOME/Desktop/Починить точки a1 a2.command"
chmod +x "$SRC"
cp "$SRC" "$DEST"
chmod +x "$DEST"
echo "Создано: $DEST"
echo "Дважды кликните — нужен SSH (как в Terminal root@77.233.223.48)."

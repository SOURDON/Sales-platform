#!/usr/bin/env bash
# Двойной клик: закрыть Fotografy и открыть снова.
set -euo pipefail

REPO="${SALES_PLATFORM_REPO:-$HOME/Projects/Sales-platform}"
if [[ ! -f "$REPO/scripts/restart-desktop-installed.sh" ]]; then
  echo "Не найден: $REPO/scripts/restart-desktop-installed.sh" >&2
  echo "Проверьте путь к проекту Sales-platform." >&2
  read -r -p "Enter…" _
  exit 1
fi

export SALES_PLATFORM_REPO="$REPO"
exec bash "$REPO/scripts/restart-desktop-installed.sh"

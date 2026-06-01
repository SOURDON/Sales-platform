#!/usr/bin/env bash
# Двойной клик: закрыть Fotografy и открыть снова (из «работа над приложением»).
set -euo pipefail

REPO="${SALES_PLATFORM_REPO:-$HOME/Projects/Sales-platform}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ ! -f "$REPO/scripts/restart-desktop-installed.sh" ]]; then
  if [[ -f "$SCRIPT_DIR/../../scripts/restart-desktop-installed.sh" ]]; then
    REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
  fi
fi

if [[ ! -f "$REPO/scripts/restart-desktop-installed.sh" ]]; then
  echo "Не найден репозиторий Sales-platform."
  echo "Укажите: export SALES_PLATFORM_REPO=/path/to/Sales-platform"
  read -r -p "Enter…" _
  exit 1
fi

export SALES_PLATFORM_REPO="$REPO"
bash "$REPO/scripts/restart-desktop-installed.sh"

echo ""
read -r -p "Нажмите Enter, чтобы закрыть окно…" _

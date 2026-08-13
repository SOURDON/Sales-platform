#!/usr/bin/env bash
# Двойной клик: запуск офлайн-магазина Fotografy Store 1.1.3.
set -euo pipefail

REPO="${SALES_PLATFORM_REPO:-$HOME/Projects/Sales-platform}"
if [[ ! -f "$REPO/scripts/desktop-dev-store-offline.sh" ]]; then
  echo "Не найден: $REPO/scripts/desktop-dev-store-offline.sh" >&2
  echo "Проверьте путь к проекту Sales-platform." >&2
  read -r -p "Enter…" _
  exit 1
fi

export SALES_PLATFORM_REPO="$REPO"
cd "$REPO"
exec bash "$REPO/scripts/desktop-dev-store-offline.sh"

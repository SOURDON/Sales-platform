#!/bin/bash
# Двойной клик на Mac: перезапуск dev-версии приложения.
# При установке на рабочий стол install-desktop-restart-shortcut.sh подставляет SALES_PLATFORM_REPO.
REPO="${SALES_PLATFORM_REPO:-$HOME/Projects/Sales-platform}"
SCRIPT="$REPO/scripts/restart-desktop-dev.sh"

if [[ ! -f "$SCRIPT" ]]; then
  echo "Не найден скрипт: $SCRIPT" >&2
  echo "Папка проекта должна быть: $HOME/Projects/Sales-platform" >&2
  read -r -p "Введите полный путь к Sales-platform: " REPO
  SCRIPT="$REPO/scripts/restart-desktop-dev.sh"
fi

if [[ ! -f "$SCRIPT" ]]; then
  echo "Ошибка: не найден $SCRIPT" >&2
  read -r -p "Нажмите Enter для выхода…" _
  exit 1
fi

exec bash "$SCRIPT"

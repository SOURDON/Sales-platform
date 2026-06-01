#!/usr/bin/env bash
# Папка на Mac для Fotografy.app, .dmg и ярлыков .command (не корень ~/Desktop).
# Переопределение: export SALES_PLATFORM_WORK_DIR=/другой/путь
if [[ -z "${DESKTOP_WORK_DIR:-}" ]]; then
  DESKTOP_WORK_DIR="${SALES_PLATFORM_WORK_DIR:-$HOME/Desktop/работа над приложением}"
fi
mkdir -p "$DESKTOP_WORK_DIR"
export DESKTOP_WORK_DIR

#!/usr/bin/env bash
set -euo pipefail
REPO="${SALES_PLATFORM_ROOT:-$HOME/Projects/Sales-platform}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ ! -f "$REPO/docs/STOP_RENDER.md" ]]; then
  REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi
open "https://dashboard.render.com"
open "$REPO/docs/STOP_RENDER.md"
echo "Откройте каждый сервис Sales-platform → ⋯ → Suspend"
read -r -p "Enter…" _

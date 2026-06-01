#!/usr/bin/env bash
set -euo pipefail
REPO="${SALES_PLATFORM_ROOT:-$HOME/Projects/Sales-platform}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ ! -f "$REPO/scripts/timeweb/deploy-from-mac.sh" ]]; then
  REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi
cd "$REPO"
chmod +x scripts/timeweb/deploy-from-mac.sh
bash scripts/timeweb/deploy-from-mac.sh
echo ""
read -r -p "Нажмите Enter, чтобы закрыть…" _

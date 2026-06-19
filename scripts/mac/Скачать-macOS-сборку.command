#!/bin/bash
# Скачать последнюю macOS-сборку из GitHub Actions в «работа над приложением».
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -f "$SCRIPT_DIR/../../scripts/lib/desktop-work-dir.sh" ]]; then
  REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
elif [[ -f "$SCRIPT_DIR/../lib/desktop-work-dir.sh" ]]; then
  REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
else
  REPO="${SALES_PLATFORM_REPO:-$HOME/Projects/Sales-platform}"
fi

RUN_URL="$(curl -fsSL "https://api.github.com/repos/SOURDON/Sales-platform/actions/workflows/desktop-macos.yml/runs?status=success&per_page=1" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['workflow_runs'][0]['html_url'])" 2>/dev/null || true)"

if [[ -n "${GH_TOKEN:-${GITHUB_TOKEN:-}}" ]] && [[ -x "$REPO/scripts/download-macos-desktop-artifact.sh" ]]; then
  bash "$REPO/scripts/download-macos-desktop-artifact.sh"
  bash "$REPO/scripts/publish-desktop-to-work-folder.sh"
  osascript -e 'display notification "Fotografy.app и .dmg обновлены" with title "macOS-сборка"'
  open "$HOME/Desktop/работа над приложением"
  exit 0
fi

if [[ -n "$RUN_URL" ]]; then
  open "$RUN_URL"
fi

osascript <<'EOF'
display dialog "В GitHub откройте артефакт desktop-macos-dmg, распакуйте .dmg в desktop/dist/ репозитория и выполните:

bash scripts/publish-desktop-to-work-folder.sh

Или задайте GH_TOKEN и запустите этот ярлык снова — скачается автоматически." buttons {"OK"} default button 1 with title "macOS-сборка"
EOF

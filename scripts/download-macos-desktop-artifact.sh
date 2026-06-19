#!/usr/bin/env bash
# Скачать .dmg из GitHub Actions (артефакт desktop-macos-dmg).
# Нужен токен: export GH_TOKEN=github_pat_...  (repo или actions:read)
# Использование:
#   bash scripts/download-macos-desktop-artifact.sh              # последний успешный run
#   bash scripts/download-macos-desktop-artifact.sh 27842717792  # конкретный run
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"

if [[ -z "$TOKEN" ]]; then
  echo "Нужен GH_TOKEN (или GITHUB_TOKEN) с правом читать Actions artifacts."
  echo "Скачайте вручную: https://github.com/SOURDON/Sales-platform/actions/workflows/desktop-macos.yml"
  exit 1
fi

RUN_ID="${1:-}"
if [[ -z "$RUN_ID" ]]; then
  RUN_ID="$(curl -fsSL \
    -H "Authorization: Bearer $TOKEN" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/SOURDON/Sales-platform/actions/workflows/desktop-macos.yml/runs?status=success&per_page=1" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['workflow_runs'][0]['id'])")"
fi

ARTIFACT_ID="$(curl -fsSL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/SOURDON/Sales-platform/actions/runs/${RUN_ID}/artifacts" \
  | python3 -c "import sys,json; arts=json.load(sys.stdin)['artifacts'];
aid=[a['id'] for a in arts if a['name']=='desktop-macos-dmg'];
print(aid[0] if aid else '')")"

if [[ -z "$ARTIFACT_ID" ]]; then
  echo "Артефакт desktop-macos-dmg не найден для run $RUN_ID"
  exit 1
fi

TMP_ZIP="$(mktemp /tmp/fotografy-mac-XXXXXX.zip)"
trap 'rm -f "$TMP_ZIP"' EXIT

curl -fsSL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -o "$TMP_ZIP" \
  "https://api.github.com/repos/SOURDON/Sales-platform/actions/artifacts/${ARTIFACT_ID}/zip"

OUT_DIR="$REPO_ROOT/desktop/dist"
mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR"/Fotografy_*.dmg
unzip -o -j "$TMP_ZIP" -d "$OUT_DIR"

DMG="$(ls -t "$OUT_DIR"/Fotografy_*.dmg 2>/dev/null | head -1 || true)"
if [[ -z "$DMG" ]]; then
  echo "В архиве нет Fotografy_*.dmg"
  exit 1
fi

echo "Скачано: $DMG"

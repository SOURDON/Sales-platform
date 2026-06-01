#!/usr/bin/env bash
# Проверка a1/a2 на Timeweb с Mac (Node не обязателен в PATH).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"

if command -v node >/dev/null 2>&1; then
  NODE=node
elif [[ -d "$REPO/.node-portable" ]]; then
  NODE_DIR="$(find "$REPO/.node-portable" -maxdepth 1 -type d -name 'node-v*' 2>/dev/null | head -1)"
  if [[ -n "$NODE_DIR" && -x "$NODE_DIR/bin/node" ]]; then
    NODE="$NODE_DIR/bin/node"
  fi
fi

if [[ -z "${NODE:-}" ]]; then
  echo "Node.js не найден. Установите с https://nodejs.org/"
  echo "Или положите portable Node в $REPO/.node-portable/"
  exit 1
fi

exec "$NODE" "$REPO/scripts/repair-missing-demo-admins.mjs" "$@"

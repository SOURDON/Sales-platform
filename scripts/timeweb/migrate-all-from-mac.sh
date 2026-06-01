#!/usr/bin/env bash
# Перенос Render → Timeweb с Mac (нужен свежий API на сервере: git pull + rebuild api).
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
git push origin main 2>/dev/null || true
node scripts/migrate-render-to-timeweb.mjs

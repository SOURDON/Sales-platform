#!/usr/bin/env bash
# Быстрая проверка API перед сборкой/раздачей десктопа (без запуска Tauri).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"

API_URL="${1:-}"
if [[ -z "$API_URL" && -f "$REPO/desktop/.env" ]]; then
  API_URL="$(grep -E '^VITE_API_URL=' "$REPO/desktop/.env" | cut -d= -f2- | tr -d '"' | tr -d "'")"
fi
API_URL="${API_URL%/}"

if [[ -z "$API_URL" ]]; then
  echo "Укажите URL: ./scripts/desktop-smoke.sh https://your-api.example.com"
  exit 1
fi

echo "API: $API_URL"

HEALTH_CODE="$(curl -sS -o /tmp/desktop-smoke-health.json -w '%{http_code}' --max-time 20 "$API_URL/health" || true)"
if [[ "$HEALTH_CODE" != "200" ]]; then
  echo "FAIL /health → HTTP $HEALTH_CODE"
  exit 1
fi
echo "OK   /health → $(cat /tmp/desktop-smoke-health.json)"

# CORS для Tauri webview (типичные origin из tauri.conf / dev)
for ORIGIN in "tauri://localhost" "https://tauri.localhost"; do
  CORS_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 \
    -X OPTIONS "$API_URL/auth/login" \
    -H "Origin: $ORIGIN" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: content-type,authorization" || true)"
  if [[ "$CORS_CODE" == "204" || "$CORS_CODE" == "200" ]]; then
    echo "OK   CORS preflight ($ORIGIN) → $CORS_CODE"
  else
    echo "WARN CORS preflight ($ORIGIN) → HTTP $CORS_CODE (на Render добавьте origin в CORS_ORIGIN)"
  fi
done

echo "Smoke OK — можно собирать desktop (./scripts/desktop-build.sh)"

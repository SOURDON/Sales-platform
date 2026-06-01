#!/usr/bin/env bash
# Перенос Render→Timeweb с самого сервера (curl), после git pull + build api.
set -eo pipefail
ROOT="/opt/sales-platform"
RENDER="${RENDER_URL:-https://sales-platform-1.onrender.com}"
TIMEWEB="${TIMEWEB_URL:-http://127.0.0.1}"
RENDER_PASSWORD="${RENDER_PASSWORD:-Bufet000}"
TIMEWEB_PASSWORD="${TIMEWEB_PASSWORD:-Bufet000}"

login() {
  local base="$1" pwd="$2"
  curl -s -X POST "$base/auth/login" -H "Content-Type: application/json" \
    -d "{\"nickname\":\"director\",\"password\":\"$pwd\"}" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])"
}

fetch() {
  local base="$1" tok="$2" path="$3"
  curl -s "$base$path" -H "Authorization: Bearer $tok"
}

echo "Login Render..."
RTOK=$(login "$RENDER" "$RENDER_PASSWORD")
echo "Login Timeweb..."
TTOK=$(login "$TIMEWEB" "$TIMEWEB_PASSWORD")

export RENDER RTOK
SNAPSHOT=$(python3 << PY
import json, subprocess, os
render = os.environ["RENDER"]
rtok = os.environ["RTOK"]
paths = [
  "/admin/finance/ops",
  "/admin/sales",
  "/admin/sellers",
  "/admin/staff",
  "/admin/shifts",
  "/admin/write-offs",
  "/admin/products",
  "/admin/products/procurement-costs",
]
keys = ["financeOps","sales","sellers","staff","shifts","writeOffs","products","procurementCosts"]
out = {}
for path, key in zip(paths, keys):
    raw = subprocess.check_output(
        ["curl", "-s", f"{render}{path}", "-H", f"Authorization: Bearer {rtok}"]
    )
    out[key] = json.loads(raw)
print(json.dumps(out))
PY
)

echo "$SNAPSHOT" | curl -s -X POST "$TIMEWEB/admin/migrate/render-snapshot" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TTOK" \
  -d @- | python3 -m json.tool

SALES=$(curl -s "$TIMEWEB/admin/sales" -H "Authorization: Bearer $TTOK" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
echo "Timeweb sales: $SALES"
[[ "$SALES" -ge 1 ]] || exit 1
echo "OK. Desktop: director / Bufet000"

#!/usr/bin/env bash
# С Mac: отправить .env на сервер (не коммитьте .env в git!).
#   export TIMWEB_HOST=1.2.3.4
#   cp deploy/timeweb/env.example deploy/timeweb/.env.local
#   nano deploy/timeweb/.env.local
#   ./scripts/timeweb/push-env-to-server.sh deploy/timeweb/.env.local
set -euo pipefail

HOST="${TIMWEB_HOST:-}"
ENV_FILE="${1:-deploy/timeweb/.env.local}"

if [[ -z "$HOST" ]]; then
  echo "Задайте TIMWEB_HOST=IP_сервера"
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Нет файла: $ENV_FILE"
  exit 1
fi

scp "$ENV_FILE" "root@${HOST}:/opt/sales-platform/deploy/timeweb/.env"
echo "Загружено в /opt/sales-platform/deploy/timeweb/.env"

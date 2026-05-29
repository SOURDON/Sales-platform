#!/usr/bin/env bash
# Экспорт БД Render на VPS. Подбирает образ pg_dump под версию сервера.
#
#   export RENDER_DATABASE_URL='postgresql://...'
#   /opt/sales-platform/scripts/timeweb/export-on-server.sh
set -euo pipefail

if [[ -z "${RENDER_DATABASE_URL:-}" ]]; then
  echo "Задайте: export RENDER_DATABASE_URL='postgresql://...'"
  exit 1
fi

OUT="/opt/sales-platform/backup.dump"
PROBE_IMAGE="${PG_PROBE_IMAGE:-docker.io/library/postgres:16.6-alpine}"

pick_dump_image() {
  local major="$1"
  case "$major" in
    10) echo "docker.io/library/postgres:10.23-alpine" ;;
    11) echo "docker.io/library/postgres:11.22-alpine" ;;
    12) echo "docker.io/library/postgres:12.22-alpine" ;;
    13) echo "docker.io/library/postgres:13.16-alpine" ;;
    14) echo "docker.io/library/postgres:14.13-alpine" ;;
    15) echo "docker.io/library/postgres:15.10-alpine" ;;
    16) echo "docker.io/library/postgres:16.6-alpine" ;;
    17) echo "docker.io/library/postgres:17.2-alpine" ;;
    *)
      echo "Неизвестная major-версия: $major" >&2
      exit 1
      ;;
  esac
}

if [[ -n "${PG_DUMP_IMAGE:-}" ]]; then
  PG_IMAGE="$PG_DUMP_IMAGE"
  echo "Используем PG_DUMP_IMAGE=$PG_IMAGE"
else
  echo "Определяем версию PostgreSQL на Render..."
  docker pull "$PROBE_IMAGE" >/dev/null
  VERSION_NUM="$(
    docker run --rm -e RENDER_DATABASE_URL "$PROBE_IMAGE" \
      psql "$RENDER_DATABASE_URL" -tAc "SHOW server_version_num;" | tr -d '[:space:]'
  )"
  VERSION_LABEL="$(
    docker run --rm -e RENDER_DATABASE_URL "$PROBE_IMAGE" \
      psql "$RENDER_DATABASE_URL" -tAc "SHOW server_version;" | head -1 | tr -d '\r'
  )"
  if [[ -z "$VERSION_NUM" ]] || ! [[ "$VERSION_NUM" =~ ^[0-9]+$ ]]; then
    echo "Не удалось подключиться к Render. Проверьте RENDER_DATABASE_URL и что база Available."
    exit 1
  fi
  MAJOR=$((VERSION_NUM / 10000))
  echo "Render PostgreSQL: ${VERSION_LABEL:-$VERSION_NUM} (major $MAJOR)"
  PG_IMAGE="$(pick_dump_image "$MAJOR")"
  echo "Образ для pg_dump: $PG_IMAGE"
fi

echo "Экспорт в $OUT ..."
docker pull "$PG_IMAGE"
docker run --rm "$PG_IMAGE" pg_dump --version

docker run --rm \
  -e RENDER_DATABASE_URL \
  -v /opt/sales-platform:/data \
  "$PG_IMAGE" \
  sh -c 'pg_dump "$RENDER_DATABASE_URL" -Fc --no-owner --no-acl -f /data/backup.dump'

ls -lh "$OUT"
echo "Готово. Импорт: /opt/sales-platform/scripts/timeweb/import-on-server.sh"

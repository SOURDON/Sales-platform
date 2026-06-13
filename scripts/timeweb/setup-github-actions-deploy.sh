#!/usr/bin/env bash
# Одноразовая настройка автодеплоя GitHub Actions → Timeweb.
#   bash scripts/timeweb/setup-github-actions-deploy.sh
#
# Что делает:
#   1) Генерирует отдельный SSH-ключ только для CI (не трогает ~/.ssh/id_ed25519).
#   2) Показывает публичный ключ для сервера.
#   3) Подсказывает, как добавить приватный ключ в GitHub Secret TIMEWEB_SSH_KEY.
#
# Опции:
#   --install-on-server   Добавить pubkey на сервер (нужен рабочий SSH: пароль или ключ).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
KEY_DIR="$ROOT/scripts/timeweb/.deploy-keys"
KEY_FILE="$KEY_DIR/github_actions_ed25519"
PUB_FILE="${KEY_FILE}.pub"
SERVER="${TIMEWEB_SSH:-root@77.233.223.48}"
INSTALL_ON_SERVER=0

for arg in "$@"; do
  case "$arg" in
    --install-on-server) INSTALL_ON_SERVER=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "Неизвестный аргумент: $arg (см. --help)"
      exit 1
      ;;
  esac
done

mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR"

if [[ ! -f "$KEY_FILE" ]]; then
  echo "=== Генерация ключа для GitHub Actions ==="
  ssh-keygen -t ed25519 -f "$KEY_FILE" -N "" -C "github-actions-deploy-sales-platform"
  chmod 600 "$KEY_FILE"
  chmod 644 "$PUB_FILE"
  echo "Создан: $KEY_FILE"
else
  echo "Ключ уже есть: $KEY_FILE"
fi

PUB_LINE="$(cat "$PUB_FILE")"

echo ""
echo "=== Шаг 1/3: Публичный ключ на сервере ==="
echo "Добавьте эту строку в /root/.ssh/authorized_keys на Timeweb:"
echo ""
echo "$PUB_LINE"
echo ""

if [[ "$INSTALL_ON_SERVER" -eq 1 ]]; then
  echo "Пробую установить ключ на сервер ($SERVER)…"
  ssh -o ConnectTimeout=20 "$SERVER" "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && grep -qxF '$PUB_LINE' ~/.ssh/authorized_keys || echo '$PUB_LINE' >> ~/.ssh/authorized_keys"
  echo "Публичный ключ добавлен на сервер."
  echo ""
  echo "Проверка входа deploy-ключом:"
  ssh -i "$KEY_FILE" -o IdentitiesOnly=yes -o ConnectTimeout=15 "$SERVER" 'echo "SSH OK: $(hostname)"'
  echo ""
fi

echo "=== Шаг 2/3: Секрет в GitHub ==="
echo "1. Откройте:"
echo "   https://github.com/SOURDON/Sales-platform/settings/secrets/actions"
echo "2. New repository secret"
echo "   Name:  TIMEWEB_SSH_KEY"
echo "   Value: полное содержимое файла:"
echo "   $KEY_FILE"
echo ""
echo "Скопировать в буфер (macOS):"
echo "   pbcopy < \"$KEY_FILE\""
echo ""

echo "=== Шаг 3/3: Проверка workflow ==="
echo "После сохранения секрета:"
echo "   https://github.com/SOURDON/Sales-platform/actions/workflows/deploy-timeweb.yml"
echo "   → Run workflow (или push в main с изменениями frontend/backend)."
echo ""
echo "Локальная проверка ключа (после шага 1):"
echo "   ssh -i \"$KEY_FILE\" -o IdentitiesOnly=yes $SERVER 'curl -sf http://127.0.0.1/health'"
echo ""

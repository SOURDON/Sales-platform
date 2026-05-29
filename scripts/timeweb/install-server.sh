#!/usr/bin/env bash
# Однократная подготовка свежего Ubuntu 22.04/24.04 на Timeweb VPS (запускать НА СЕРВЕРЕ под root).
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get install -y ca-certificates curl git ufw

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

systemctl enable docker
systemctl start docker

if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y docker-compose-plugin
fi

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

mkdir -p /opt/sales-platform
echo "Docker готов. Клонируйте репозиторий в /opt/sales-platform и настройте deploy/timeweb/.env"

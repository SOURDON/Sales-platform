#!/usr/bin/env bash
# Проверка DNS fotografy.ru и подсказка следующих шагов (запуск на Mac).
set -eo pipefail

VPS_IP="${VPS_IP:-77.233.223.48}"
DOMAIN="${DOMAIN:-fotografy.ru}"

echo "=== DNS ${DOMAIN} ==="
RESOLVED=$(dig +short "$DOMAIN" A | head -1)
echo "A-запись: ${RESOLVED:-не найдена}"
echo "Нужно:     ${VPS_IP}"
echo ""

if [[ "$RESOLVED" == "$VPS_IP" ]]; then
  echo "DNS настроен верно."
  if curl -sf --connect-timeout 10 "https://${DOMAIN}/health" | grep -q '"ok":true'; then
    echo "HTTPS API работает: https://${DOMAIN}/health"
    echo ""
    echo "Пересоберите десктоп:"
    echo "  cd Sales-platform && ./scripts/desktop-build.sh"
    exit 0
  fi
  echo "DNS верный, но HTTPS ещё не поднят. На VPS выполните:"
  echo "  ssh root@${VPS_IP}"
  echo "  bash /opt/sales-platform/scripts/timeweb/enable-site-ru.sh"
  exit 1
fi

echo "DNS указывает не на VPS — приложение без VPN может не работать."
echo ""
echo "1. Яндекс 360 → Домены → ${DOMAIN} → DNS"
echo "   A @ → ${VPS_IP}"
echo "   A www → ${VPS_IP}  (или CNAME www → ${DOMAIN})"
echo "   MX не трогать (почта Yandex)"
echo ""
echo "2. Подождать 15–60 мин, снова запустить этот скрипт"
echo ""
echo "Пока DNS не исправлен, десктоп использует http://${VPS_IP} (авто-выбор при старте)."

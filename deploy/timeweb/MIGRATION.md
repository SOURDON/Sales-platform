# Переезд API с Render на Timeweb Cloud

В репозитории уже есть Docker-стек: PostgreSQL + NestJS API + Caddy.

## Что сделаете вы (я не могу без вашего аккаунта)

1. Зарегистрироваться на [Timeweb Cloud](https://timeweb.cloud).
2. Создать **облачный сервер** (VPS): Ubuntu 22.04/24.04, **2 vCPU, 4 GB RAM**, 40+ GB SSD (~500–900 ₽/мес).
3. Записать **IP сервера** и пароль root (или SSH-ключ).
4. В DNS: **A-запись** `api.ваш-домен.ru` → IP сервера (можно позже).
5. Один раз скопировать **External Database URL** из Render (для переноса данных).

## Часть 1 — сервер (5–10 минут)

Подключитесь по SSH:

```bash
ssh root@IP_СЕРВЕРА
```

Установите Docker (скопируйте скрипт с Mac или выполните команды из `scripts/timeweb/install-server.sh`):

```bash
apt-get update -y && apt-get install -y ca-certificates curl git ufw
curl -fsSL https://get.docker.com | sh
systemctl enable docker && systemctl start docker
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
mkdir -p /opt/sales-platform
```

Клонируйте проект:

```bash
cd /opt
git clone https://github.com/SOURDON/Sales-platform.git sales-platform
cd sales-platform
```

Настройте окружение:

```bash
cp deploy/timeweb/env.example deploy/timeweb/.env
nano deploy/timeweb/.env
```

Обязательно смените `POSTGRES_PASSWORD`. В `CORS_ORIGIN` оставьте origins для desktop:

```text
tauri://localhost,https://tauri.localhost
```

Запустите без старых данных (пустая БД + миграции):

```bash
cd deploy/timeweb
docker compose --env-file .env up -d --build
docker compose --env-file .env exec api npx prisma db seed
```

Проверка:

```bash
curl -s http://127.0.0.1/health
# {"ok":true}
```

С вашего Mac:

```bash
curl -s http://IP_СЕРВЕРА/health
```

## Часть 2 — перенос данных с Render (рекомендуется)

**На Mac** (где есть доступ к Render DB):

```bash
cd Sales-platform
export RENDER_DATABASE_URL='postgresql://...'   # Render → PostgreSQL → External Database URL
chmod +x scripts/timeweb/export-from-render.sh
./scripts/timeweb/export-from-render.sh
scp deploy/timeweb/backups/render-*.dump root@IP_СЕРВЕРА:/opt/sales-platform/backup.dump
```

**На сервере:**

```bash
chmod +x /opt/sales-platform/scripts/timeweb/import-on-server.sh
/opt/sales-platform/scripts/timeweb/import-on-server.sh
```

После импорта сид **не** запускайте повторно — данные уже на месте.

## Часть 3 — HTTPS и домен

Когда A-запись `api.ваш-домен.ru` указывает на IP:

```bash
cd /opt/sales-platform/deploy/timeweb
cp Caddyfile.domain Caddyfile
# в .env: API_DOMAIN=api.ваш-домен.ru и ACME_EMAIL=ваш@email.ru
docker compose --env-file .env up -d caddy
```

Проверка: `https://api.ваш-домен.ru/health`

## Часть 4 — desktop и сотрудники

Пересоберите desktop с новым API:

```bash
# desktop/.env
VITE_API_URL=https://api.ваш-домен.ru
# или пока без домена: http://IP_СЕРВЕРА

./scripts/desktop-build.sh
```

Раздайте новый `.dmg` / `.exe`. Старый Render можно **остановить** после проверки.

## Обновления кода (после правок в GitHub)

На сервере:

```bash
/opt/sales-platform/scripts/timeweb/deploy-update.sh
```

## Бэкап БД на сервере

```bash
cd /opt/sales-platform/deploy/timeweb
docker compose --env-file .env exec -T postgres pg_dump -U sales sales_platform -Fc > /opt/sales-platform/backup-$(date +%F).dump
```

## Если что-то не работает

| Симптом | Решение |
|--------|---------|
| `health` не отвечает | `docker compose logs api --tail 100` |
| Desktop «не достучалось» | Проверьте `CORS_ORIGIN`, URL в сборке, firewall 80/443 |
| Медленно после простоя | На VPS сна нет — это норма Render free, не Timeweb |

Render после успешного переезда можно отключить, чтобы не платить и не путаться.

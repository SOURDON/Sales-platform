# Автодеплой на Timeweb через GitHub Actions

После настройки каждый push в `main` (с изменениями `frontend/`, `backend/`, `deploy/timeweb/`, `scripts/timeweb/`) автоматически обновляет сервер `77.233.223.48`.

Workflow: [`.github/workflows/deploy-timeweb.yml`](../.github/workflows/deploy-timeweb.yml)

## Быстрая настройка (5 минут)

### 1. Сгенерировать deploy-ключ

На Mac в корне репозитория:

```bash
bash scripts/timeweb/setup-github-actions-deploy.sh
```

Ключи сохраняются в `scripts/timeweb/.deploy-keys/` (в git не попадают).

### 2. Добавить публичный ключ на сервер

**Вариант A** — скрипт сам (если SSH с паролем/ключом уже работает):

```bash
bash scripts/timeweb/setup-github-actions-deploy.sh --install-on-server
```

**Вариант B** — вручную через SSH:

```bash
ssh root@77.233.223.48
mkdir -p ~/.ssh && chmod 700 ~/.ssh
nano ~/.ssh/authorized_keys
# вставьте строку из вывода setup-github-actions-deploy.sh (github-actions-deploy-sales-platform)
chmod 600 ~/.ssh/authorized_keys
```

### 3. Секрет в GitHub

1. **Repository secrets** (не Environments): [Settings → Secrets and variables → Actions](https://github.com/SOURDON/Sales-platform/settings/secrets/actions)
2. **New repository secret**
3. Name: `TIMEWEB_SSH_KEY`
4. Value: **приватный** ключ (не `.pub`):

```bash
pbcopy < scripts/timeweb/.deploy-keys/github_actions_ed25519
```

Вставьте целиком, со строками `-----BEGIN OPENSSH PRIVATE KEY-----` / `-----END...`, без лишних пробелов.

### 4. Запустить деплой

- **Вручную:** [Actions → Deploy Timeweb → Run workflow](https://github.com/SOURDON/Sales-platform/actions/workflows/deploy-timeweb.yml)
- **Автоматически:** push в `main` с изменениями в отслеживаемых путях

### 5. Проверка

```bash
curl -s http://77.233.223.48/health
curl -s http://77.233.223.48/deploy-stamp.txt
```

В логе workflow должно быть `health OK`.

## Что выполняется на сервере

```bash
bash /opt/sales-platform/scripts/timeweb/deploy-update.sh   # git pull + docker build/up
bash /opt/sales-platform/scripts/timeweb/ensure-demo-admins.sh
curl -sf http://127.0.0.1/health
```

## Частые ошибки

| Симптом | Причина | Решение |
|--------|---------|---------|
| `secret is not set` / пустой key | Нет `TIMEWEB_SSH_KEY` | Добавить секрет (шаг 3) |
| `Permission denied (publickey)` | Pubkey не на сервере или в секрет вставлен `.pub` | Шаг 2; пересохранить **приватный** ключ |
| Workflow не запускается | Push без изменений в `paths` | Run workflow вручную или изменить `frontend/**` |
| Долгий build | Docker пересобирает caddy/api | Нормально 3–8 мин, смотреть лог job |

## Безопасность

- Используйте **отдельный** ключ только для CI, не личный `~/.ssh/id_ed25519`.
- Не коммитьте приватный ключ и не публикуйте в чатах.
- При компрометации: удалите pubkey с сервера, сгенерируйте новую пару, обновите секрет.

## Ручной деплой (запасной)

```bash
bash scripts/timeweb/deploy-from-mac.sh
```

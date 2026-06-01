# Как перестать получать письма и деплои с Render

Продакшен уже на **Timeweb** (`http://77.233.223.48`).  
Render по-прежнему слушает репозиторий **SOURDON/Sales-platform** на GitHub — при каждом `git push` в `main` он запускает сборку и шлёт письмо об ошибке, если билд падает.

Это **не влияет** на Timeweb и десктоп с `VITE_API_URL=http://77.233.223.48`.

## Вариант 1 — остановить сервисы (рекомендуется)

1. Откройте [dashboard.render.com](https://dashboard.render.com).
2. Для **каждого** сервиса проекта (например `sales-platform-1`, `sales-platform-api-prod`, staging, frontend, если есть):
   - откройте сервис → меню **⋯** → **Suspend** (Приостановить).

После Suspend автодеплои и письма о деплое прекращаются. Данные в Render Postgres (если ещё не удаляли) остаются, пока не удалите БД отдельно.

## Вариант 2 — отключить только автодеплой

На каждом сервисе:

**Settings** → **Build & Deploy** → **Auto-Deploy** → **Off** → Save.

Письма о **failed deploy** могут всё равно приходить при ручном деплое; для полного покоя лучше **Suspend**.

## Вариант 3 — отвязать GitHub

На сервисе: **Settings** → **Build & Deploy** → **Disconnect** репозитория.

Либо на GitHub: репозиторий → **Settings** → **Webhooks** → удалить webhook с `render.com`.

## Уведомления в почте

Render → **Account Settings** → **Notifications** — отключите **Deploy notifications**, если сервисы пока не удаляете, но письма мешают.

## Проверка

После Suspend сделайте тестовый push — письма от Render быть не должно.  
Рабочий API: `curl http://77.233.223.48/health` → `{"ok":true}`.

## Файл `render.yaml` в репозитории

Он описывает старый Blueprint Render и **не** управляет Timeweb.  
Удаление файла из git **не отключает** уже созданные сервисы — только панель Render (Suspend / Delete).

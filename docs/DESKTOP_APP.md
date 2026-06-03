# Десктоп-приложение (Windows + macOS)

**Этот документ — контекст для отдельного чата агента «ПК-версия».**  
Веб на телефоне и в браузере продолжает жить отдельно; здесь только десктоп + офлайн для 4 ролей.

## Цель

- Приложение на **Windows и macOS** (Tauri 2 + тот же `frontend/`).
- Вход **логин + пароль** (тот же `POST /auth/login`, JWT).
- **Онлайн** по умолчанию; **офлайн обязателен** для ролей: `ADMIN`, `DIRECTOR`, `ACCOUNTANT`, `MANAGER`.
- При появлении интернета — **автовыгрузка очереди** на сервер без дублей (`clientId` / идемпотентность).
- **Один backend** с веб-версией; телефон = тот же сайт, без замены.

## Не делать в этом треке

- Не ломать и не блокировать деплой веба.
- Не переписывать UI «с нуля» — оболочка вокруг существующего React.
- Полный офлайн на iPhone — **вне scope** (только PWA позже, опционально).

## Текущее состояние репозитория

- Офлайн: только очередь **продаж админа** — `frontend/src/offlineSalesQueue.ts`, flush в `App.tsx` при `online`.
- Папка `desktop/` — Tauri 2 scaffold (этап 1).
- Sync-слой: `frontend/src/sync/` (IndexedDB outbox, flush, healthcheck) — **этап 2**.

## Этапы (порядок работ)

### Этап 1 — Tauri, онлайн (~2–3 нед)

- [x] `desktop/` — Tauri 2, `devUrl` → Vite `frontend`, `frontendDist` → `frontend/dist`
- [x] Конфиг API: `VITE_API_URL` в `desktop/.env` / `frontend/.env` при сборке
- [x] Сборка: Windows `.exe` / MSI, macOS `.app` / `.dmg` (`npm run build` в `desktop/`, см. `desktop/README.md`)
- [x] Сессия: тот же `SESSION_STORAGE_KEY` (`localStorage` в webview)
- [x] UI: баннер «Нет сети» / «Синхронизация…» (каркас, `frontend/src/desktop/`)

### Этап 2 — Sync core (~2 нед)

- [x] `frontend/src/sync/` — IndexedDB, outbox, `flushOutbox()`, слушатель `online` + healthcheck API
- [x] Миграция `offlineSalesQueue` → outbox (Tauri; localStorage → IndexedDB при старте)
- [x] Backend: идемпотентность `POST /admin/sales` по `saleId` (in-memory + Prisma lookup)

### Этап 3 — ADMIN офлайн (~2–3 нед)

- [x] Кэш: products, sellers, staff, shifts, store inventory, sales (+ globalEmployees)
- [x] Outbox: sales, write-offs, open/close shift, staff ops (Tauri + роль ADMIN)
- [ ] Тест: офлайн → действия → онлайн → данные на сервере и в вебе

### Этап 4 — DIRECTOR + ACCOUNTANT (~2–3 нед)

- [x] Кэш: dashboard, finance ops, inventory overview (+ commissionRequests для директора)
- [x] Outbox: finance mutations, commission/control decisions, set %, demo password patch

### Этап 5 — MANAGER + стабилизация (~1–2 нед)

- [x] Кэш главной (MANAGER dashboard); планы выручки (кэш + outbox для DIRECTOR/ACCOUNTANT)
- [x] Чеклист тестов: `docs/DESKTOP_TEST_CHECKLIST.md`
- [x] Инструкция для пользователей: `docs/DESKTOP_USER_GUIDE.md` (сборка — `desktop/README.md`)

### Этап 6 — Релиз и приёмка

- [x] Smoke API перед сборкой: `scripts/desktop-smoke.sh` (health + CORS для Tauri)
- [x] Процесс релиза: `docs/DESKTOP_RELEASE.md`
- [x] CI macOS (по тегу `desktop-v*`): `.github/workflows/desktop-macos.yml`
- [x] Прод-сборка `.dmg` в `desktop/dist/` (API: Render); `.exe` — на Windows
- [ ] Раздача сотрудникам + ручная приёмка
- [ ] Ручная приёмка по `docs/DESKTOP_TEST_CHECKLIST.md` (закрывает пункт теста этапа 3)

## Структура (целевая)

```
Sales-platform/
  frontend/          # общий UI (веб + Tauri)
  frontend/src/sync/ # очередь + кэш (новое)
  desktop/           # Tauri (новое)
  backend/           # идемпотентность, опционально /sync/*
  docs/DESKTOP_APP.md
```

## Роли — офлайн scope (уточнить с заказчиком)

| Роль | Просмотр без сети | Действия в outbox |
|------|-------------------|-------------------|
| ADMIN | точка, товары, смена | продажи, списания, смена, персонал |
| DIRECTOR | дашборд, финансы | финансы, одобрения %, пароли demo-accounts |
| ACCOUNTANT | финансы, оборудование | доходы/расходы, балансы |
| MANAGER | главная, планы | по согласованию; чат — online only |

## Первое сообщение во втором чате агента

Скопируйте в **новый** Agent-чат:

```
Работаем только над десктоп (Tauri) и офлайн-sync по docs/DESKTOP_APP.md.
Не трогай несвязанные правки веба. Веб-фичи — в другом чате.
Начни с этапа 1: scaffold desktop/ + сборка Win/Mac.
```

## Статус (обновлять в этом файле)

| Дата | Сделано |
|------|---------|
| 2026-05-21 | Этап 6: smoke API, DESKTOP_RELEASE, CI desktop-macos, сборка с prod API |
| 2026-05-21 | Иконки, скрипты desktop-dev/build, portable Node, исправлена сборка frontend (TS) |
| 2026-05-21 | Этап 5: MANAGER dashboard cache, revenue plans cache/outbox, чат online-only, user guide + test checklist |
| 2026-05-21 | Этап 4 DIRECTOR+ACCOUNTANT: кэш dashboard/finance/inventory, outbox финансы и решения директора |
| 2026-05-21 | Этап 3 ADMIN офлайн: кэш IndexedDB, outbox (продажи, списания, смена, персонал), optimistic UI |
| 2026-05-21 | Этап 2 sync core: `frontend/src/sync/`, outbox IndexedDB, healthcheck, flush в Tauri, Prisma idempotency `saleId` |
| 2026-05-21 | Этап 1 scaffold: `desktop/` (Tauri 2), `devUrl`/`frontendDist`, `VITE_API_URL`, README сборки Win/Mac, баннер сети в Tauri |
| — | План зафиксирован |

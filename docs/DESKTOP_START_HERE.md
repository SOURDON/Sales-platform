# С чего начать (десктоп) — минимум действий

Код и документация уже готовы. Ниже — только то, что **нельзя** сделать без вашего компьютера.

## Уже собрано на этом Mac (для проверки)

После `./scripts/desktop-build.sh` установщик лежит в **`desktop/dist/`** (например `Фотографы_1.0.0_aarch64.dmg`).

В `desktop/.env` должен быть **боевой** `VITE_API_URL` (сейчас: Render). Перед сборкой: `./scripts/desktop-smoke.sh`.

Подробнее: [DESKTOP_RELEASE.md](./DESKTOP_RELEASE.md).

---

## Вариант А — вы только пользуетесь приложением

1. Получите от IT файл установки:
   - Mac: `Фотографы_*.dmg`
   - Windows: `Фотографы_*_setup.exe`
2. Установите по [DESKTOP_USER_GUIDE.md](./DESKTOP_USER_GUIDE.md).
3. Войдите тем же логином/паролем, что на сайте.

**Ничего ставить из Node/Rust не нужно.**

---

## Вариант Б — вы собираете и раздаёте приложение (один раз)

### 1. Один раз установить на Mac (для сборки)

| Что | Ссылка |
|-----|--------|
| Node.js LTS | https://nodejs.org/ |
| Rust | https://rustup.rs/ (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh`) |
| Xcode Command Line Tools | В терминале: `xcode-select --install` |

Windows `.exe`: **на Windows** (`.\scripts\desktop-build.ps1`) или **через GitHub** (тег `desktop-v*` → Actions → артефакт). Подробно: [DESKTOP_WINDOWS.md](./DESKTOP_WINDOWS.md).

### 2. Указать адрес сервера

В файле `desktop/.env` (уже может быть создан из примера):

```env
VITE_API_URL=https://ВАШ-РЕАЛЬНЫЙ-API.example.com
```

Без `localhost` — иначе у сотрудников приложение не достучится до сервера.

### 3. Одна команда сборки (macOS)

В терминале (путь замените на свой):

```bash
cd ~/Projects/Sales-platform
chmod +x scripts/desktop-build.sh
./scripts/desktop-build.sh
```

Если Node не установлен в системе, в проекте уже есть portable Node в `.node-portable/` — скрипт подхватит его сам.

Установщик появится в `desktop/src-tauri/target/release/bundle/dmg/`.

### 4. Раздать сотрудникам

- Файл `.dmg` (Mac) или `.exe` (Windows)
- Ссылка на [DESKTOP_USER_GUIDE.md](./DESKTOP_USER_GUIDE.md) (можно PDF/печать)

---

## Ошибка входа в dev (`desktop-dev.sh`): «не достучалось до сервера»

В режиме разработки окно грузится с **`http://localhost:5173`**. Render должен разрешить этот origin.

На [Render](https://dashboard.render.com) → **sales-platform-1** → **Environment** → **`CORS_ORIGIN`** — в конец через запятую:

```text
,http://localhost:5173,http://127.0.0.1:5173
```

**Manual Deploy** → подождите 2–3 минуты → снова «Войти».

Либо без Render: соберите `.dmg` (`./scripts/desktop-build.sh`) — там origin `tauri://localhost`, он уже поддерживается.

---

## Вариант В — проверить у себя до сборки (разработка)

Нужен работающий **PostgreSQL** и backend (как для веба).

```bash
# 1) backend/.env — DATABASE_URL из backend/.env.example
cd backend && npm install && npm run db:sync && npm run start:dev
```

В **втором** терминале:

```bash
cd Sales-platform
chmod +x scripts/desktop-dev.sh
./scripts/desktop-dev.sh
```

Скрипт сам создаст `frontend/.env` и `desktop/.env`, поставит npm-пакеты и откроет окно приложения.

---

## Чеклист приёмки (по желанию)

[DESKTOP_TEST_CHECKLIST.md](./DESKTOP_TEST_CHECKLIST.md) — 3 компьютера, 3 роли. Можно поручить одному сотруднику на роль.

---

## Production API на Render (пока вы настраиваете сервер)

1. **Instance type** — RAM **≥ 1 GB** (не free 512 MB).
2. **Manual Deploy** ветки `main` (последний коммит с `fix(api)` / `fix: стабильная сводка`).
3. **Environment**:
   - `NODE_OPTIONS` = `--max-old-space-size=384` (на 1 GB можно `512`)
   - `CORS_ORIGIN` — URL Vercel + `tauri://localhost` (см. [DESKTOP_USER_GUIDE.md](./DESKTOP_USER_GUIDE.md))
4. Проверка: `https://sales-platform-1.onrender.com/health` → `{"ok":true}`.
5. Пересобрать desktop **1.0.17+** с `desktop/.env` → `VITE_API_URL=https://sales-platform-1.onrender.com`.

---

## Что уже сделано в репозитории (вам не трогать)

- Офлайн-sync для ADMIN, DIRECTOR, ACCOUNTANT, MANAGER
- Чат только онлайн в десктопе
- Иконки приложения в `desktop/src-tauri/icons/`
- Скрипты: `scripts/desktop-dev.sh`, `scripts/desktop-build.sh`, `desktop/scripts/generate-icons.sh`

Полный план: [DESKTOP_APP.md](./DESKTOP_APP.md).

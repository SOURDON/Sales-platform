# Sales Platform — Desktop (Tauri 2)

Оболочка вокруг общего `frontend/`. Онлайн-режим (этап 1); офлайн-sync — `docs/DESKTOP_APP.md`.

## Требования

- [Node.js](https://nodejs.org/) 20+ (npm)
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- macOS: Xcode Command Line Tools
- Windows: Visual Studio Build Tools + WebView2

## Первичная настройка

**Быстрый старт (из корня репозитория):** [docs/DESKTOP_START_HERE.md](../docs/DESKTOP_START_HERE.md)

```bash
cd desktop
npm install
npm run icons:mac   # macOS: icon.icns + icon.ico (или npm run icon при установленном Tauri CLI)
cp .env.example .env   # VITE_API_URL для prod-сборки
```

Иконки уже лежат в `src-tauri/icons/` — пересборка нужна только при смене логотипа.

Для dev API можно использовать `frontend/.env` с `VITE_API_URL=http://localhost:3000`.

## Разработка

Запускает Vite (`frontend`, :5173) и окно Tauri:

```bash
cd desktop
npm run dev
```

Backend отдельно: `cd ../backend && npm run start:dev`.

## Сборка установщиков

```bash
cd desktop
# .env: VITE_API_URL=https://your-api.example.com
npm run build
```

Артефакты:

| Платформа | Путь (типично) |
|-----------|----------------|
| macOS `.app` | `src-tauri/target/release/bundle/macos/*.app` |
| macOS `.dmg` | `src-tauri/target/release/bundle/dmg/*.dmg` |
| Windows `.exe` (NSIS) | `src-tauri/target/release/bundle/nsis/*.exe` |
| Windows MSI | `src-tauri/target/release/bundle/msi/*.msi` |

Кросс-компиляция: macOS — на Mac, Windows — на Windows. Без Windows у себя: тег `desktop-v*` → GitHub Actions → артефакт `.exe` (см. [docs/DESKTOP_WINDOWS.md](../docs/DESKTOP_WINDOWS.md)).

**Windows (PowerShell):** `..\..\scripts\desktop-build.ps1` из корня репозитория.

## Конфигурация

| Переменная | Где | Назначение |
|------------|-----|------------|
| `VITE_API_URL` | `desktop/.env` или `frontend/.env` | URL backend при `tauri build` |
| `devUrl` | `src-tauri/tauri.conf.json` | `http://localhost:5173` |
| `frontendDist` | `src-tauri/tauri.conf.json` | `../frontend/dist` |

Сессия: тот же `localStorage` ключ `sales-platform-session-v1`, что и в вебе.

## Дизайн: десктоп отдельно от веба

- Общий UI: `frontend/src/App.tsx` + `frontend/src/App.css`.
- **Только приложение:** `frontend/src/desktop/desktopShell.css` (класс `app--desktop` на `<main>`).
- В браузере/Vercel класс `app--desktop` **не ставится** — внешний вид сайта не меняется.
- Логика офлайна/sync — `isDesktopShell` / `isTauriRuntime()` в коде, не в CSS.

## Для конечных пользователей

Инструкция по установке и работе (без Node/Rust): **[docs/DESKTOP_USER_GUIDE.md](../docs/DESKTOP_USER_GUIDE.md)**.

Ручной чеклист приёмки: **[docs/DESKTOP_TEST_CHECKLIST.md](../docs/DESKTOP_TEST_CHECKLIST.md)**.

# Windows: открыть проект в Cursor и собрать .exe

Краткая инструкция после `git clone` / `git pull` с Mac.

## 1. Установить один раз

| Компонент | Действие |
|-----------|----------|
| **Git** | https://git-scm.com/download/win |
| **Node.js** LTS 20+ | https://nodejs.org/ |
| **Rust** | https://rustup.rs/ → `rustup-init.exe` |
| **VS Build Tools** | https://visualstudio.microsoft.com/visual-cpp-build-tools/ → workload **Desktop development with C++** |
| **Cursor** | https://cursor.com/ — войти в **тот же аккаунт**, что на Mac |

## 2. Склонировать репозиторий

PowerShell:

```powershell
cd $HOME\Projects
git clone https://github.com/SOURDON/Sales-platform.git
cd Sales-platform
```

(SSH: `git clone git@github.com:SOURDON/Sales-platform.git`)

## 3. Открыть в Cursor

**File → Open Folder** → папка `Sales-platform`.

## 4. Файл API для десктопа

Создайте `desktop\.env` (если нет):

```env
VITE_API_URL=https://sales-platform-1.onrender.com
```

Не коммитьте секреты. Для локального бэкенда — другой URL.

## 5. Промпт для агента Cursor (скопировать в чат)

```
Проект Sales-platform, десктоп Tauri 2 на Windows.
1. Проверь desktop\.env (VITE_API_URL на боевой API).
2. Запусти .\scripts\desktop-smoke.ps1
3. Запусти .\scripts\desktop-build.ps1
4. Если ошибка — исправь и повтори.
5. Напиши полный путь к установщику .exe в desktop\dist или bundle\nsis.
```

Подробнее: [DESKTOP_WINDOWS.md](./DESKTOP_WINDOWS.md).

## 6. Синхронизация Mac ↔ Windows

```text
Mac:     git add → commit → git push
Windows: git pull → работа в Cursor → git push (если меняли код)
```

История чата Cursor **не переносится** — на Windows новый диалог с промптом выше.

## 7. Где лежит установщик

После успешной сборки:

- `desktop\dist\` — удобная копия
- `desktop\src-tauri\target\release\bundle\nsis\` — исходный NSIS

Имя вида: `Фотографы_*_x64-setup.exe`.

## 8. CORS (если не входит в приложение)

На Render в `CORS_ORIGIN` добавить:

```text
,tauri://localhost,https://tauri.localhost
```

Затем Manual Deploy.

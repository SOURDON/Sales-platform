# Релиз десктоп-приложения

Краткий процесс обновления `.dmg` / `.exe` для сотрудников. Дизайн и доработки UI — отдельно; здесь только сборка и раздача.

## Перед каждой сборкой

1. В `desktop/.env` указан **боевой** `VITE_API_URL` (не `localhost`).
2. Проверка API:

```bash
./scripts/desktop-smoke.sh
```

3. При смене версии — обновить `version` в `desktop/src-tauri/tauri.conf.json`.

## Сборка (macOS)

```bash
chmod +x scripts/desktop-build.sh scripts/desktop-smoke.sh
./scripts/desktop-build.sh
```

Установщик: `desktop/dist/Фотографы_<версия>_aarch64.dmg` (Apple Silicon) или в `desktop/src-tauri/target/release/bundle/dmg/`.

Для Intel Mac нужна отдельная сборка на соответствующей машине (`tauri build --target x86_64-apple-darwin`).

## Сборка (Windows)

Только **на Windows**: Node LTS, Rust, [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/), тот же `desktop/.env`, затем:

```bash
cd desktop && npm install && npm run build
```

Файл: `desktop/src-tauri/target/release/bundle/nsis/*setup.exe` → скопировать в `desktop/dist/`.

## Раздача

| Что | Куда |
|-----|------|
| `.dmg` / `.exe` | Общая папка, USB, корпоративный диск |
| Инструкция | [DESKTOP_USER_GUIDE.md](./DESKTOP_USER_GUIDE.md) |

Сотрудникам **не** нужны Node, Rust, git.

## Приёмка (ручная)

[DESKTOP_TEST_CHECKLIST.md](./DESKTOP_TEST_CHECKLIST.md) — минимум 3 ПК и роли ADMIN / DIRECTOR / MANAGER (или ACCOUNTANT).

Отметьте пункты в чеклисте; когда этап 3 в [DESKTOP_APP.md](./DESKTOP_APP.md) пройден — поставьте `[x]` у «Тест: офлайн → …».

## CI (опционально)

При push тега `desktop-v*` GitHub Actions собирает macOS `.dmg` (см. `.github/workflows/desktop-macos.yml`). Секреты не нужны; `VITE_API_URL` берётся из `desktop/.env` в репозитории.

## Обновление у пользователя

1. Закрыть старое приложение.
2. Установить новый `.dmg` / `.exe` поверх (или удалить старую версию — по инструкции IT).
3. Войти снова (сессия в localStorage обычно сохраняется).

Офлайн-очередь в IndexedDB **сохраняется** между обновлениями, если не меняли `identifier` приложения в Tauri.

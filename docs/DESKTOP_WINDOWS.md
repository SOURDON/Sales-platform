# Десктоп на Windows

Приложение — **Tauri 2**, отдельный `.exe` для Windows уже предусмотрен в проекте.

## Вариант 1 — только пользоваться (рекомендуется)

1. Получите файл **`Фотографы_*_x64-setup.exe`** (от IT или из сборки CI).
2. Запустите установщик → «Далее» → готово.
3. Откройте **Фотографы** из меню «Пуск».
4. Войдите тем же логином/паролем, что на сайте.

Подробнее: [DESKTOP_USER_GUIDE.md](./DESKTOP_USER_GUIDE.md).

---

## Вариант 2 — собрать `.exe` на компьютере с Windows

### Что установить один раз

| Компонент | Ссылка |
|-----------|--------|
| **Node.js** LTS (20+) | https://nodejs.org/ |
| **Rust** | https://rustup.rs/ (installer `rustup-init.exe`) |
| **Visual Studio Build Tools** | https://visualstudio.microsoft.com/visual-cpp-build-tools/ — workload «Desktop development with C++» |
| **WebView2** | Обычно уже есть в Windows 10/11; иначе https://developer.microsoft.com/microsoft-edge/webview2/ |

### Настроить API

Файл `desktop/.env`:

```env
VITE_API_URL=https://sales-platform-1.onrender.com
```

(подставьте свой боевой URL, **не** `localhost`.)

### Сборка (пошагово)

1. Склонируйте или скопируйте проект на Windows (папка `Sales-platform`).
2. Откройте **PowerShell** в этой папке (не обязательно от администратора).
3. Проверка API (опционально):

```powershell
.\scripts\desktop-smoke.ps1
```

4. Сборка установщика:

```powershell
.\scripts\desktop-build.ps1
```

Первая сборка занимает **15–40 минут** (Rust качает зависимости).

Или вручную:

```powershell
cd desktop
npm install
npm run icon
npm run build
```

Установщик: `desktop\dist\Фотографы_*_x64-setup.exe`  
(также в `desktop\src-tauri\target\release\bundle\nsis\`).

### CORS на сервере

Чтобы вход работал, в **Render** → Environment → `CORS_ORIGIN` должны быть:

```text
,tauri://localhost,https://tauri.localhost
```

После изменения — **Manual Deploy**, подождать 2–3 минуты.

---

## Вариант 3 — сборка в GitHub (без Windows у себя)

На Mac/Linux можно получить `.exe` через Actions:

```bash
git tag desktop-v1.0.6-win
git push origin desktop-v1.0.6-win
```

Или в GitHub: **Actions** → **Desktop Windows** → **Run workflow** (без тега).

Workflow **Desktop Windows** соберёт артефакт `desktop-windows-setup` (файл `*setup.exe`).  
Скачать: GitHub → **Actions** → последний run → **Artifacts**.

Перед тегом проверьте `desktop/.env` с боевым `VITE_API_URL` (он попадает в сборку).

---

## Разработка на Windows

```powershell
cd backend
npm install
npm run start:dev
```

В другом терминале:

```powershell
cd desktop
npm install
npm run dev
```

Откроется окно приложения + Vite на http://localhost:5173.

---

## Частые проблемы

| Симптом | Решение |
|---------|---------|
| `cargo` / linker not found | Установите Visual Studio Build Tools с C++ |
| Установщик зависает на WebView2 | С v1.0.43 Fotografy ставится без блокировки; WebView2 — по желанию в конце или [вручную](https://developer.microsoft.com/microsoft-edge/webview2/) |
| WebView2 error при запуске | Установите Evergreen WebView2 Runtime |
| «Load failed» при входе | Добавьте `tauri://localhost` в CORS на backend |
| Антивирус блокирует `.exe` | Подпись кода пока нет — добавьте исключение или соберите на доверенном ПК |

С macOS **нельзя** собрать нативный Windows `.exe` — только на Windows или через CI выше.

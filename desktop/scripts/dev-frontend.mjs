/**
 * Запуск Vite (frontend) для Tauri dev.
 * Обычный профиль: VITE_API_URL из desktop/.env.
 * store-offline: desktop/.env.store-offline (VITE_OFFLINE_STORE=1), без сети.
 * Порт 5173 строго фиксирован (как в tauri.conf.json).
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAppVersion } from './read-app-version.mjs';

const DEV_HOST = '127.0.0.1';
const DEV_PORT = 5173;

const TIMEWEB_API = 'http://77.233.223.48';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const frontendDir = path.resolve(repoRoot, 'frontend');
const desktopEnvPath = path.resolve(repoRoot, 'desktop/.env');
const storeEnvPath = path.resolve(repoRoot, 'desktop/.env.store-offline');
const viteBin = path.resolve(frontendDir, 'node_modules/vite/bin/vite.js');
const profile = process.env.DESKTOP_BUILD_PROFILE || '';
const isStoreOffline = profile === 'store-offline';

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }
  const out = {};
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq < 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function readDesktopApiUrl() {
  return loadEnvFile(desktopEnvPath).VITE_API_URL;
}

const storeEnv = isStoreOffline ? loadEnvFile(storeEnvPath) : {};
let apiUrl = isStoreOffline
  ? storeEnv.VITE_API_URL || 'http://127.0.0.1:9'
  : readDesktopApiUrl() || TIMEWEB_API;
if (!isStoreOffline && apiUrl.includes('onrender.com')) {
  console.warn(
    `[dev-frontend] Render отключён — используем Timeweb: ${TIMEWEB_API} (обновите desktop/.env)`,
  );
  apiUrl = TIMEWEB_API;
}

const appVersion = readAppVersion();
const env = {
  ...process.env,
  ...storeEnv,
  VITE_API_URL: apiUrl,
  ...(isStoreOffline ? { VITE_OFFLINE_STORE: '1' } : {}),
  ...(appVersion ? { VITE_APP_VERSION: appVersion } : {}),
};
if (isStoreOffline) {
  console.log('[dev-frontend] Профиль: store-offline (магазин, полный офлайн)');
} else {
  console.log(`[dev-frontend] API Timeweb → ${apiUrl}`);
}
if (appVersion) {
  console.log(`[dev-frontend] Версия: ${appVersion}`);
}

console.log(`[dev-frontend] http://${DEV_HOST}:${DEV_PORT}/ (strictPort — освободите порт, если занят)`);

const child = spawn(
  process.execPath,
  [viteBin, '--host', DEV_HOST, '--port', String(DEV_PORT), '--strictPort'],
  {
    cwd: frontendDir,
    stdio: 'inherit',
    env,
  },
);

child.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(
      `[dev-frontend] Vite завершился с кодом ${code}. Если порт ${DEV_PORT} занят: закройте старый терминал с dev или выполните: lsof -ti :${DEV_PORT} | xargs kill`,
    );
  }
  process.exit(code ?? 1);
});

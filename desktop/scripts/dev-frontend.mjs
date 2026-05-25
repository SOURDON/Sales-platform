/**
 * Запуск Vite (frontend) для Tauri dev.
 * VITE_API_URL — из desktop/.env. Порт 5173 строго фиксирован (как в tauri.conf.json).
 */
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEV_HOST = '127.0.0.1';
const DEV_PORT = 5173;

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const frontendDir = path.resolve(repoRoot, 'frontend');
const desktopEnvPath = path.resolve(repoRoot, 'desktop/.env');
const viteBin = path.resolve(frontendDir, 'node_modules/vite/bin/vite.js');

function readDesktopApiUrl() {
  try {
    const text = readFileSync(desktopEnvPath, 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^VITE_API_URL=(.+)$/);
      if (m) {
        return m[1].trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

const apiUrl = readDesktopApiUrl();
const env = { ...process.env };
if (apiUrl) {
  env.VITE_API_URL = apiUrl;
  console.log(`[dev-frontend] VITE_API_URL=${apiUrl} (из desktop/.env)`);
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

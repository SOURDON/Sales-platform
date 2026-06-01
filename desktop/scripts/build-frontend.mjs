import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, '..');
const frontendRoot = resolve(desktopRoot, '../frontend');

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

// desktop/.env имеет приоритет; Render в .env не используем
const TIMEWEB_API = 'http://77.233.223.48';
const fromFrontend = loadEnvFile(resolve(frontendRoot, '.env'));
const fromDesktop = loadEnvFile(resolve(desktopRoot, '.env'));
let apiUrl = fromDesktop.VITE_API_URL || fromFrontend.VITE_API_URL || TIMEWEB_API;
if (String(apiUrl).includes('onrender.com')) {
  console.warn(`[build-frontend] Render → Timeweb: ${TIMEWEB_API}`);
  apiUrl = TIMEWEB_API;
}
const env = {
  ...process.env,
  ...fromFrontend,
  ...fromDesktop,
  VITE_API_URL: apiUrl,
};

const isWin = process.platform === 'win32';
const result = spawnSync(isWin ? 'npm.cmd' : 'npm', ['run', 'build'], {
  cwd: frontendRoot,
  env,
  stdio: 'inherit',
  shell: isWin,
});

process.exit(result.status ?? 1);

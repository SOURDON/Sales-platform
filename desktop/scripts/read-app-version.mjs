import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const profile = process.env.DESKTOP_BUILD_PROFILE || '';
const configName =
  profile === 'store-offline' ? 'tauri.store.conf.json' : 'tauri.conf.json';
const configPath = resolve(desktopRoot, 'src-tauri', configName);

export function readAppVersion() {
  if (!existsSync(configPath)) {
    return '';
  }
  try {
    const conf = JSON.parse(readFileSync(configPath, 'utf8'));
    return String(conf.version ?? '').trim();
  } catch {
    return '';
  }
}

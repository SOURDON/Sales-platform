import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function readAppVersion() {
  try {
    const conf = JSON.parse(
      readFileSync(resolve(desktopRoot, 'src-tauri/tauri.conf.json'), 'utf8'),
    );
    return String(conf.version ?? '').trim();
  } catch {
    return '';
  }
}

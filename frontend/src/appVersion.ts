/** Версия десктоп-сборки (из tauri.conf.json через VITE_APP_VERSION). */
export function appVersionLabel(): string | null {
  const raw = import.meta.env.VITE_APP_VERSION;
  const version = typeof raw === 'string' ? raw.trim() : '';
  if (!version) {
    return null;
  }
  return `Версия ${version}`;
}

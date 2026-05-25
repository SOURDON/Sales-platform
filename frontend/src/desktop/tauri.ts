/** True when UI runs inside the Tauri webview (not mobile browser / Vercel). */
export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

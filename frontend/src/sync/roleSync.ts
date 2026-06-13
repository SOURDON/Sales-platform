/** Роли с IndexedDB-кэшем и outbox (веб + Tauri). */
export function roleUsesSyncCache(role: string | undefined): boolean {
  return (
    role === 'DIRECTOR' ||
    role === 'ACCOUNTANT' ||
    role === 'MANAGER' ||
    role === 'ADMIN'
  );
}

/** Роли с фоновой синхронизацией outbox при появлении сети (веб + десктоп). */
export function roleUsesSyncEngine(role: string | undefined, _isDesktop = false): boolean {
  return roleUsesSyncCache(role);
}

/** ADMIN: полный outbox (веб и Tauri). */
export function roleUsesAdminDesktopOutbox(role: string | undefined, _isDesktop?: boolean): boolean {
  return role === 'ADMIN';
}

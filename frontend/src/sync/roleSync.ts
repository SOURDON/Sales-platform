/** Роли, для которых в браузере и Tauri используется IndexedDB-кэш и outbox (как на десктопе). */
export function roleUsesSyncCache(role: string | undefined): boolean {
  return role === 'DIRECTOR' || role === 'ACCOUNTANT' || role === 'MANAGER';
}

/** Роли с фоновой синхронизацией outbox (веб + десктоп). */
export function roleUsesSyncEngine(role: string | undefined): boolean {
  return roleUsesSyncCache(role);
}

/** ADMIN: outbox только в Tauri; в веб остаётся legacy sessionStorage-очередь продаж. */
export function roleUsesAdminDesktopOutbox(role: string | undefined, isDesktop: boolean): boolean {
  return isDesktop && role === 'ADMIN';
}

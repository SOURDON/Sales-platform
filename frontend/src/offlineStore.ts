/** Десктоп-сборка магазина: без склада, офлайн-редактирование персонала и названия точки. */
export function isOfflineStoreApp(): boolean {
  return import.meta.env.VITE_OFFLINE_STORE === '1';
}

/** Десктоп-сборка директора: тот же UI, что у аккаунта директора, без сервера. */
export function isOfflineDirectorApp(): boolean {
  return import.meta.env.VITE_OFFLINE_DIRECTOR === '1';
}

export function isLocalOfflineApp(): boolean {
  return isOfflineStoreApp() || isOfflineDirectorApp();
}

export function isFullyOfflineStoreApp(): boolean {
  return isOfflineStoreApp();
}

/** Десктоп-сборка магазина: без склада, офлайн-редактирование персонала и названия точки. */
export function isOfflineStoreApp(): boolean {
  return import.meta.env.VITE_OFFLINE_STORE === '1';
}

export function isFullyOfflineStoreApp(): boolean {
  return isOfflineStoreApp();
}

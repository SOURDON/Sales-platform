import { loadSyncCache, saveSyncCache, syncCacheAgeMs } from '../cache';
import { getApiReachableDisplayed, markApiReachableSuccess } from '../network';
import { outboxCountForUser } from '../outbox';
import type { SyncCacheKey } from '../types';

export type LoadResourceResult<T> = {
  data: T;
  fromCache: boolean;
};

const FETCH_TIMEOUT_MS = 12_000;
/** Дольше не дергаем фоновый fetch — меньше дёргания UI при нестабильной сети. */
const BACKGROUND_STALE_MS = 180_000;

async function shouldDeferNetworkFetch(userId: number): Promise<boolean> {
  if (!getApiReachableDisplayed()) {
    return true;
  }
  return (await outboxCountForUser(userId)) > 0;
}

export type LoadSyncResourceOptions<T> = {
  /** Вызывается, когда с сервера пришли свежие данные (после показа кэша). */
  onFresh?: (data: T) => void;
  /**
   * Текущий userId сессии. Если задан — onFresh вызывается только когда он совпадает
   * с userId запроса (защита от гонки при смене аккаунта/магазина).
   */
  getActiveUserId?: () => number | undefined;
  /** Не ходить в сеть — только IndexedDB (ручное «только кэш»). */
  cacheOnly?: boolean;
  /** Если кэш моложе этого интервала — фоновый fetch не выполняется. */
  staleTimeMs?: number;
  /** Всегда ждать ответ сети (после мутаций), если API доступен и outbox пуст. */
  preferNetwork?: boolean;
};

export async function loadSyncResource<T>(
  _apiBaseUrl: string,
  userId: number,
  cacheKey: SyncCacheKey,
  fetcher: () => Promise<T>,
  fallback: T,
  options?: LoadSyncResourceOptions<T>,
): Promise<LoadResourceResult<T>> {
  const cached = await loadSyncCache<T>(userId, cacheKey);

  const fetchFresh = async (): Promise<LoadResourceResult<T>> => {
    if (await shouldDeferNetworkFetch(userId)) {
      if (cached !== null) {
        return { data: cached, fromCache: true };
      }
      return { data: fallback, fromCache: true };
    }
    try {
      const data = await Promise.race([
        fetcher(),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error('cache fetch timeout')), FETCH_TIMEOUT_MS);
        }),
      ]);
      markApiReachableSuccess();
      const pending = await outboxCountForUser(userId);
      if (pending === 0) {
        await saveSyncCache(userId, cacheKey, data);
      }
      if (options?.onFresh && pending === 0) {
        const activeUserId = options.getActiveUserId?.();
        if (activeUserId === undefined || activeUserId === userId) {
          options.onFresh(data);
        }
      }
      return { data: pending > 0 && cached !== null ? cached : data, fromCache: pending > 0 };
    } catch {
      if (cached !== null) {
        return { data: cached, fromCache: true };
      }
      return { data: fallback, fromCache: true };
    }
  };

  if (options?.cacheOnly) {
    if (cached !== null) {
      return { data: cached, fromCache: true };
    }
    return { data: fallback, fromCache: true };
  }

  if (options?.preferNetwork) {
    if (cached !== null && (await shouldDeferNetworkFetch(userId))) {
      return { data: cached, fromCache: true };
    }
    return fetchFresh();
  }

  if (cached !== null) {
    const staleTimeMs = options?.staleTimeMs ?? BACKGROUND_STALE_MS;
    if (staleTimeMs > 0) {
      const ageMs = await syncCacheAgeMs(userId, cacheKey);
      if (ageMs !== null && ageMs < staleTimeMs) {
        return { data: cached, fromCache: true };
      }
    }
    if (!(await shouldDeferNetworkFetch(userId))) {
      void fetchFresh();
    }
    return { data: cached, fromCache: true };
  }

  return fetchFresh();
}

/** @deprecated use loadSyncResource */
export const loadAdminResource = loadSyncResource;

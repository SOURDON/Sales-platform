/** TTL для повторной загрузки данных при переключении вкладок (веб). */
export const WEB_ROUTE_FETCH_TTL_MS = 60_000;

const lastFetchedAt = new Map<string, number>();
const inFlight = new Map<string, Promise<void>>();

export function shouldFetchRouteData(key: string, ttlMs = WEB_ROUTE_FETCH_TTL_MS): boolean {
  const last = lastFetchedAt.get(key) ?? 0;
  return Date.now() - last >= ttlMs;
}

export function markRouteDataFetched(key: string) {
  lastFetchedAt.set(key, Date.now());
}

export function invalidateRouteData(key: string) {
  lastFetchedAt.delete(key);
}

export function invalidateRouteDataPrefix(prefix: string) {
  for (const key of lastFetchedAt.keys()) {
    if (key.startsWith(prefix)) {
      lastFetchedAt.delete(key);
    }
  }
}

/** Не дублировать параллельные запросы; пропускать, если данные ещё свежие. */
export async function fetchRouteDataIfStale(
  key: string,
  fetcher: () => Promise<void>,
  ttlMs = WEB_ROUTE_FETCH_TTL_MS,
): Promise<void> {
  if (!shouldFetchRouteData(key, ttlMs)) {
    return;
  }
  const running = inFlight.get(key);
  if (running) {
    return running;
  }
  const task = (async () => {
    try {
      await fetcher();
      markRouteDataFetched(key);
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, task);
  return task;
}

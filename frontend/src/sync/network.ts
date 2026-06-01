let cachedReachable: boolean | null = null;
let cachedReachableAt = 0;
const REACHABILITY_TTL_MS = 45_000;

const reachabilityListeners = new Set<(reachable: boolean) => void>();

function emitReachability(reachable: boolean): void {
  cachedReachable = reachable;
  cachedReachableAt = Date.now();
  for (const listener of reachabilityListeners) {
    listener(reachable);
  }
}

/** Подписка на смену доступности API (в т.ч. после успешного запроса без /health). */
export function subscribeReachability(onChange: (reachable: boolean) => void): () => void {
  reachabilityListeners.add(onChange);
  if (cachedReachable !== null) {
    onChange(cachedReachable);
  }
  return () => {
    reachabilityListeners.delete(onChange);
  };
}

/** Успешный API-запрос — считаем сеть доступной (не ждём отдельный /health). */
export function markApiReachableSuccess(): void {
  if (cachedReachable === true && Date.now() - cachedReachableAt < REACHABILITY_TTL_MS) {
    return;
  }
  emitReachability(true);
}

export function resetApiReachabilityCache(): void {
  cachedReachable = null;
  cachedReachableAt = 0;
}

export async function isApiReachable(
  apiBaseUrl: string,
  timeoutMs = 5_000,
): Promise<boolean> {
  const base = apiBaseUrl.replace(/\/$/, '');
  if (!base) {
    return false;
  }

  const now = Date.now();
  if (cachedReachable !== null && now - cachedReachableAt < REACHABILITY_TTL_MS) {
    return cachedReachable;
  }

  const probe = async (): Promise<boolean> => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${base}/health`, {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) {
        return false;
      }
      const body = (await response.json()) as { ok?: boolean };
      return body?.ok === true;
    } catch {
      return false;
    } finally {
      window.clearTimeout(timer);
    }
  };

  const ok = await probe();
  emitReachability(ok);
  return ok;
}

export type NetworkSubscription = {
  reachable: boolean;
  dispose: () => void;
};

/** Периодический healthcheck; старт — оптимистично «онлайн», если браузер onLine. */
export function subscribeNetwork(
  apiBaseUrl: string,
  onChange: (reachable: boolean) => void,
  pollMs = 180_000,
): NetworkSubscription {
  let reachable =
    typeof navigator === 'undefined' ? false : navigator.onLine;
  let disposed = false;

  const emit = (next: boolean) => {
    if (next !== reachable) {
      reachable = next;
      onChange(next);
    }
  };

  const runCheck = async () => {
    if (disposed) {
      return;
    }
    const next = await isApiReachable(apiBaseUrl);
    emit(next);
  };

  const onNavigatorOnline = () => {
    markApiReachableSuccess();
    emit(true);
    void runCheck();
  };
  const onNavigatorOffline = () => emit(false);

  const unsubReachability = subscribeReachability((next) => {
    if (!disposed) {
      emit(next);
    }
  });

  if (reachable) {
    onChange(true);
  } else {
    onChange(false);
  }
  void runCheck();
  window.addEventListener('online', onNavigatorOnline);
  window.addEventListener('offline', onNavigatorOffline);
  const interval = window.setInterval(() => void runCheck(), pollMs);

  return {
    get reachable() {
      return reachable;
    },
    dispose: () => {
      disposed = true;
      unsubReachability();
      window.removeEventListener('online', onNavigatorOnline);
      window.removeEventListener('offline', onNavigatorOffline);
      window.clearInterval(interval);
    },
  };
}

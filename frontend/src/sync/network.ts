let cachedReachable: boolean | null = null;
let cachedReachableAt = 0;
const REACHABILITY_TTL_MS = 30_000;

/** Успешный API-запрос — считаем сеть доступной (не ждём отдельный /health). */
export function markApiReachableSuccess(): void {
  cachedReachable = true;
  cachedReachableAt = Date.now();
}

export function resetApiReachabilityCache(): void {
  cachedReachable = null;
  cachedReachableAt = 0;
}

export async function isApiReachable(
  apiBaseUrl: string,
  timeoutMs = 12_000,
): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return false;
  }
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

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const ok = await probe();
    if (ok) {
      cachedReachable = true;
      cachedReachableAt = Date.now();
      return true;
    }
    if (attempt === 0) {
      await new Promise((r) => window.setTimeout(r, 400));
    }
  }

  cachedReachable = false;
  cachedReachableAt = Date.now();
  return false;
}

export type NetworkSubscription = {
  reachable: boolean;
  dispose: () => void;
};

/** navigator.onLine + периодический healthcheck (без ложного «офлайн» при старте). */
export function subscribeNetwork(
  apiBaseUrl: string,
  onChange: (reachable: boolean) => void,
  pollMs = 120_000,
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
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      emit(false);
      return;
    }
    const next = await isApiReachable(apiBaseUrl);
    emit(next);
  };

  const onNavigatorOnline = () => {
    emit(true);
    void runCheck();
  };
  const onNavigatorOffline = () => emit(false);

  if (reachable) {
    onChange(true);
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
      window.removeEventListener('online', onNavigatorOnline);
      window.removeEventListener('offline', onNavigatorOffline);
      window.clearInterval(interval);
    },
  };
}

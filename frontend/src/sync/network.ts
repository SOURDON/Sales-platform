/**
 * Доступность API для десктопа (Tauri).
 *
 * Принцип: «онлайн» по умолчанию; «офлайн» только после нескольких неудачных проверок
 * и если давно не было успешных запросов. Любой успешный fetch к API снова включает «онлайн».
 */

const SUCCESS_GRACE_MS = 12 * 60_000;
const OFFLINE_AFTER_FAILURES = 8;
const PROBE_TIMEOUT_MS = 12_000;
const DEFAULT_POLL_MS = 900_000;

let lastApiSuccessAt = 0;
let consecutiveProbeFailures = 0;
let displayedReachable = true;

const reachabilityListeners = new Set<(reachable: boolean) => void>();

function shouldTreatAsOffline(): boolean {
  if (Date.now() - lastApiSuccessAt < SUCCESS_GRACE_MS) {
    return false;
  }
  return consecutiveProbeFailures >= OFFLINE_AFTER_FAILURES;
}

function emitReachability(reachable: boolean): void {
  if (displayedReachable === reachable) {
    return;
  }
  displayedReachable = reachable;
  for (const listener of reachabilityListeners) {
    listener(reachable);
  }
}

function reconcileDisplayedReachability(): void {
  emitReachability(!shouldTreatAsOffline());
}

/** Подписка на смену доступности API. */
export function subscribeReachability(onChange: (reachable: boolean) => void): () => void {
  reachabilityListeners.add(onChange);
  onChange(displayedReachable);
  return () => {
    reachabilityListeners.delete(onChange);
  };
}

/** Успешный ответ API — считаем сеть доступной. */
export function markApiReachableSuccess(): void {
  lastApiSuccessAt = Date.now();
  consecutiveProbeFailures = 0;
  reconcileDisplayedReachability();
}

export function resetApiReachabilityCache(): void {
  lastApiSuccessAt = 0;
  consecutiveProbeFailures = 0;
  displayedReachable = true;
  reconcileDisplayedReachability();
}

/** Сразу проверить /health и обновить плашку связи (при старте приложения). */
export async function bootstrapReachability(getBaseUrl: () => string): Promise<boolean> {
  const ok = await probeAnyHealth(getBaseUrl, 6_000);
  if (ok) {
    markApiReachableSuccess();
    return true;
  }
  consecutiveProbeFailures = OFFLINE_AFTER_FAILURES;
  reconcileDisplayedReachability();
  return false;
}

export function getApiReachableDisplayed(): boolean {
  return displayedReachable;
}

async function probeHealth(apiBaseUrl: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  const base = apiBaseUrl.replace(/\/$/, '');
  if (!base) {
    return false;
  }
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
}

async function probeAnyHealth(getBaseUrl: () => string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  if (await probeHealth(getBaseUrl(), timeoutMs)) {
    return true;
  }
  try {
    const { listApiBaseCandidates, setApiBaseUrl } = await import('../apiBase');
    for (const candidate of listApiBaseCandidates()) {
      if (candidate === getBaseUrl()) {
        continue;
      }
      if (await probeHealth(candidate, timeoutMs)) {
        setApiBaseUrl(candidate);
        return true;
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Для outbox: можно ли пробовать отправку (оптимистично при недавнем успехе). */
export async function isApiReachable(getBaseUrl: () => string): Promise<boolean> {
  if (!shouldTreatAsOffline()) {
    return true;
  }
  const ok = await probeAnyHealth(getBaseUrl);
  if (ok) {
    markApiReachableSuccess();
    return true;
  }
  consecutiveProbeFailures += 1;
  reconcileDisplayedReachability();
  return false;
}

/** Патч fetch: любой успешный ответ нашего API → «на связи». */
export function installApiReachabilityHook(getBaseUrl: () => string): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }
  const original = window.fetch.bind(window);
  const patched: typeof fetch = async (input, init) => {
    const response = await original(input, init);
    try {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const bases = [getBaseUrl(), ...(await import('../apiBase')).listApiBaseCandidates()];
      if (bases.some((base) => url.startsWith(base.replace(/\/$/, ''))) && response.ok) {
        markApiReachableSuccess();
      }
    } catch {
      /* ignore */
    }
    return response;
  };
  window.fetch = patched;
  return () => {
    window.fetch = original;
  };
}

export type NetworkSubscription = {
  reachable: boolean;
  dispose: () => void;
};

export type SubscribeNetworkOptions = {
  /** В Tauri navigator.onLine часто врёт — не переводить в офлайн по событию offline. */
  ignoreNavigatorOffline?: boolean;
  pollMs?: number;
};

/**
 * Фоновые healthcheck'и; UI «офлайн» не включается от одного сбоя.
 */
export function subscribeNetwork(
  getBaseUrl: () => string,
  onChange: (reachable: boolean) => void,
  options?: SubscribeNetworkOptions | number,
): NetworkSubscription {
  const opts: SubscribeNetworkOptions =
    typeof options === 'number' ? { pollMs: options } : (options ?? {});
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const ignoreNavigatorOffline = opts.ignoreNavigatorOffline === true;

  let reachable = true;
  let disposed = false;

  const emit = (next: boolean) => {
    if (next !== reachable) {
      reachable = next;
      onChange(next);
    }
  };

  const unsubReachability = subscribeReachability((next) => {
    if (!disposed) {
      emit(next);
    }
  });

  const runCheck = async () => {
    if (disposed) {
      return;
    }
    const ok = await probeAnyHealth(getBaseUrl);
    if (ok) {
      markApiReachableSuccess();
    } else {
      consecutiveProbeFailures += 1;
      reconcileDisplayedReachability();
    }
  };

  const onNavigatorOnline = () => {
    markApiReachableSuccess();
    void runCheck();
  };

  const onNavigatorOffline = () => {
    if (ignoreNavigatorOffline) {
      return;
    }
    consecutiveProbeFailures = OFFLINE_AFTER_FAILURES;
    reconcileDisplayedReachability();
  };

  emit(displayedReachable);
  const initialProbeDelay = window.setTimeout(() => void runCheck(), 4_000);
  window.addEventListener('online', onNavigatorOnline);
  window.addEventListener('offline', onNavigatorOffline);
  const interval = window.setInterval(() => void runCheck(), pollMs);

  return {
    get reachable() {
      return reachable;
    },
    dispose: () => {
      disposed = true;
      window.clearTimeout(initialProbeDelay);
      unsubReachability();
      window.removeEventListener('online', onNavigatorOnline);
      window.removeEventListener('offline', onNavigatorOffline);
      window.clearInterval(interval);
    },
  };
}

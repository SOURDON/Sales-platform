export async function isApiReachable(
  apiBaseUrl: string,
  timeoutMs = 5000,
): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return false;
  }
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

export type NetworkSubscription = {
  reachable: boolean;
  dispose: () => void;
};

/** navigator.onLine + периодический healthcheck. */
export function subscribeNetwork(
  apiBaseUrl: string,
  onChange: (reachable: boolean) => void,
  pollMs = 90_000,
): NetworkSubscription {
  let reachable = false;
  let disposed = false;

  const runCheck = async () => {
    if (disposed) {
      return;
    }
    const next = await isApiReachable(apiBaseUrl);
    if (next !== reachable) {
      reachable = next;
      onChange(next);
    }
  };

  const onNavigatorOnline = () => void runCheck();
  const onNavigatorOffline = () => {
    if (!reachable) {
      return;
    }
    reachable = false;
    onChange(false);
  };

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

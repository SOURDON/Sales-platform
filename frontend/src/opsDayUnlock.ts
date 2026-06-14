const STORAGE_KEY = 'sales-platform-ops-day-unlock-v1';
const DEFAULT_PIN = '7391';

function pinFromEnv(): string {
  const raw = import.meta.env.VITE_OPS_DAY_UNLOCK_PIN;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : DEFAULT_PIN;
}

export function verifyOpsDayUnlockPin(pin: string): boolean {
  return pin.trim() === pinFromEnv();
}

export function readOpsDayUnlock(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return false;
    }
    const parsed = JSON.parse(raw) as { until?: number };
    return typeof parsed.until === 'number' && parsed.until > Date.now();
  } catch {
    return false;
  }
}

export function writeOpsDayUnlock(active: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    if (!active) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ until: Date.now() + 8 * 60 * 60 * 1000 }),
    );
  } catch {
    // ignore
  }
}

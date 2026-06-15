import { readOfflineStoreSettings } from './offlineStoreSettings';
import type { LoginResponse } from './offlineStoreTypes';

const SESSION_KEY = 'sales-platform-session-v1';
const OFFLINE_STORE_USER_ID = 900_001;

export type OfflineStoreLoginResponse = LoginResponse;

function readStoredSessionRaw(): OfflineStoreLoginResponse | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as OfflineStoreLoginResponse;
    if (parsed?.user?.role === 'ADMIN' && typeof parsed.user.id === 'number') {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

export function createOfflineStoreSession(): OfflineStoreLoginResponse {
  const existing = readStoredSessionRaw();
  const settings = readOfflineStoreSettings();
  const storeName = settings.storeName || existing?.user.storeName || 'Моя точка';
  return {
    token: 'offline-store-local',
    user: {
      id: existing?.user.id ?? OFFLINE_STORE_USER_ID,
      nickname: existing?.user.nickname ?? 'store',
      fullName: existing?.user.fullName ?? 'Магазин',
      role: 'ADMIN',
      storeName,
    },
  };
}

export function persistOfflineStoreSession(session: OfflineStoreLoginResponse): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function resolveOfflineStoreSession(): OfflineStoreLoginResponse {
  const session = createOfflineStoreSession();
  persistOfflineStoreSession(session);
  return session;
}

export function effectiveStoreName(sessionStoreName: string | undefined): string {
  const fromSettings = readOfflineStoreSettings().storeName?.trim();
  if (fromSettings) {
    return fromSettings;
  }
  return sessionStoreName?.trim() || 'Моя точка';
}

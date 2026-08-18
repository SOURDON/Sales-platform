import type { LoginResponse } from './offlineStoreTypes';

const SESSION_KEY = 'sales-platform-session-v1';
export const OFFLINE_DIRECTOR_USER_ID = 900_002;

export type OfflineDirectorLoginResponse = LoginResponse;

function readStoredSessionRaw(): OfflineDirectorLoginResponse | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as OfflineDirectorLoginResponse;
    if (parsed?.user?.role === 'DIRECTOR' && typeof parsed.user.id === 'number') {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

export function createOfflineDirectorSession(): OfflineDirectorLoginResponse {
  const existing = readStoredSessionRaw();
  return {
    token: 'offline-director-local',
    user: {
      id: existing?.user.id ?? OFFLINE_DIRECTOR_USER_ID,
      nickname: existing?.user.nickname ?? 'director',
      fullName: existing?.user.fullName ?? 'Директор',
      role: 'DIRECTOR',
      storeName: existing?.user.storeName ?? '',
    },
  };
}

export function persistOfflineDirectorSession(session: OfflineDirectorLoginResponse): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function resolveOfflineDirectorSession(): OfflineDirectorLoginResponse {
  const session = createOfflineDirectorSession();
  persistOfflineDirectorSession(session);
  return session;
}

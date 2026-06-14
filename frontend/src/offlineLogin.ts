import { getApiReachableDisplayed } from './sync/network';

type LoginResponse = {
  token: string;
  user: {
    id: number;
    nickname: string;
    fullName: string;
    role: 'DIRECTOR' | 'MANAGER' | 'ADMIN' | 'SELLER' | 'ACCOUNTANT' | 'RETOUCHER';
    storeName: string;
  };
};

const OFFLINE_CREDS_KEY = 'sales-platform-offline-creds-v1';
const OFFLINE_CRED_LEGACY_KEY = 'sales-platform-offline-cred-v1';
const SESSION_STORAGE_KEY = 'sales-platform-session-v1';

type OfflineCred = {
  nickname: string;
  password: string;
  session: LoginResponse;
};

export function isOfflineLoginFetchError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return true;
  }
  if (error instanceof TypeError) {
    return true;
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }
  if (error instanceof Error) {
    const msg = error.message.trim().toLowerCase();
    return (
      msg === 'load failed' ||
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network request failed')
    );
  }
  return false;
}

export function isOfflineLoginMode(): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return true;
  }
  return !getApiReachableDisplayed();
}

function readCredMap(): Record<string, OfflineCred> {
  if (typeof window === 'undefined') {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(OFFLINE_CREDS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, OfflineCred>;
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  try {
    const legacy = window.localStorage.getItem(OFFLINE_CRED_LEGACY_KEY);
    if (!legacy) {
      return {};
    }
    const cred = JSON.parse(legacy) as OfflineCred;
    if (!cred?.nickname || !cred.session?.token) {
      return {};
    }
    const map = { [cred.nickname.trim().toLowerCase()]: cred };
    window.localStorage.setItem(OFFLINE_CREDS_KEY, JSON.stringify(map));
    window.localStorage.removeItem(OFFLINE_CRED_LEGACY_KEY);
    return map;
  } catch {
    return {};
  }
}

function writeCredMap(map: Record<string, OfflineCred>): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(OFFLINE_CREDS_KEY, JSON.stringify(map));
  } catch {
    // ignore quota errors
  }
}

export function saveOfflineLoginCred(
  nickname: string,
  password: string,
  session: LoginResponse,
): void {
  if (session.user.role !== 'ADMIN') {
    return;
  }
  const nick = nickname.trim().toLowerCase();
  const map = readCredMap();
  map[nick] = { nickname: nick, password, session };
  writeCredMap(map);
  void import('./desktop/desktopLocalBackup').then((module) => {
    module.scheduleDesktopLocalBackup();
  });
}

export function tryOfflineAdminLogin(nickname: string, password: string): LoginResponse | null {
  const nick = nickname.trim().toLowerCase();
  if (!nick || !password) {
    return null;
  }
  const cred = readCredMap()[nick];
  if (!cred) {
    return null;
  }
  if (cred.password !== password) {
    return null;
  }
  if (cred.session?.user?.role !== 'ADMIN' || !cred.session.token) {
    return null;
  }
  return cred.session;
}

export function readLastOfflineNickname(): string {
  const map = readCredMap();
  const adminNick = Object.values(map).find((cred) => cred.session.user.role === 'ADMIN');
  if (adminNick?.nickname) {
    return adminNick.nickname;
  }
  try {
    const raw =
      window.localStorage.getItem(SESSION_STORAGE_KEY) ??
      window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LoginResponse;
      if (parsed?.user?.role === 'ADMIN') {
        return parsed.user.nickname;
      }
    }
  } catch {
    // ignore
  }
  return '';
}

export const OFFLINE_ADMIN_LOGIN_HINT =
  'Нет интернета. Офлайн-вход доступен только для аккаунтов магазинов — нужен хотя бы один успешный вход при сети на этом устройстве.';

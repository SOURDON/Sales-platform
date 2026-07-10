import { isTauriRuntime } from './desktop/tauri';

const STORAGE_KEY = 'sales-platform-api-base-v1';

/** Прямой IP VPS Timeweb — работает без DNS. */
export const PRODUCTION_API_IP = 'http://77.233.223.48';
/** HTTPS-домен — после правки A-записи на 77.233.223.48. */
export const PRODUCTION_API_DOMAIN = 'https://fotografy.ru';

function normalizeUrl(url: string): string {
  return url.replace(/\/$/, '');
}

function readStoredApiBase(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeUrl(raw) : null;
  } catch {
    return null;
  }
}

function writeStoredApiBase(url: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, normalizeUrl(url));
  } catch {
    /* ignore */
  }
}

function envApiUrl(): string {
  return normalizeUrl(((import.meta.env.VITE_API_URL as string | undefined) ?? '').trim());
}

function fallbackApiUrls(): string[] {
  const raw = (import.meta.env.VITE_API_FALLBACKS as string | undefined) ?? '';
  return raw
    .split(',')
    .map((item) => normalizeUrl(item.trim()))
    .filter(Boolean);
}

/** Начальный URL до bootstrap (сборка / localStorage / дефолт). */
function resolveInitialApiBaseUrl(): string {
  const fromEnv = envApiUrl();
  const stored = readStoredApiBase();

  if (import.meta.env.DEV) {
    if (fromEnv) {
      return fromEnv;
    }
    if (typeof window !== 'undefined') {
      return `http://${window.location.hostname}:3000`;
    }
    return 'http://localhost:3000';
  }

  if (typeof window !== 'undefined') {
    if (isTauriRuntime() || import.meta.env.VITE_OFFLINE_STORE === '1') {
      if (stored) {
        return stored;
      }
      if (fromEnv) {
        return fromEnv;
      }
      return PRODUCTION_API_IP;
    }
    return window.location.origin;
  }

  return fromEnv;
}

let activeApiBaseUrl = resolveInitialApiBaseUrl();

export function getApiBaseUrl(): string {
  return activeApiBaseUrl;
}

export function setApiBaseUrl(url: string): void {
  activeApiBaseUrl = normalizeUrl(url);
  writeStoredApiBase(activeApiBaseUrl);
}

export function listApiBaseCandidates(): string[] {
  const items = [
    readStoredApiBase(),
    envApiUrl(),
    ...fallbackApiUrls(),
    ...(isTauriRuntime() ? [PRODUCTION_API_IP, PRODUCTION_API_DOMAIN] : []),
  ];
  return [...new Set(items.filter((item): item is string => Boolean(item)).map(normalizeUrl))];
}

async function probeHealth(baseUrl: string, timeoutMs = 8_000): Promise<boolean> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/health`, {
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

/**
 * На старте десктопа проверяет несколько адресов API и выбирает первый рабочий.
 * Без VPN обычно достаточно http://77.233.223.48; после правки DNS подхватится https://fotografy.ru.
 */
export async function bootstrapApiBaseUrl(): Promise<string> {
  if (!isTauriRuntime() && import.meta.env.VITE_OFFLINE_STORE !== '1') {
    return getApiBaseUrl();
  }

  const candidates = listApiBaseCandidates();
  if (candidates.length === 0) {
    return getApiBaseUrl();
  }

  const probes = await Promise.all(
    candidates.map(async (url) => ({ url, ok: await probeHealth(url) })),
  );
  const winner = probes.find((item) => item.ok);
  if (winner) {
    setApiBaseUrl(winner.url);
    return winner.url;
  }

  return getApiBaseUrl();
}

/** Повторный выбор адреса (кнопка «Обновить» / после долгого офлайна). */
export async function refreshApiBaseUrl(): Promise<string> {
  return bootstrapApiBaseUrl();
}

export function apiServerLabel(baseUrl: string): string {
  try {
    const host = new URL(baseUrl).hostname;
    if (host.includes('onrender.com')) {
      return 'Render (устарело)';
    }
    if (host === '77.233.223.48') {
      return 'Продакшен';
    }
    if (host === 'fotografy.ru' || host === 'www.fotografy.ru') {
      return 'fotografy.ru';
    }
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'Локальный сервер';
    }
    return host;
  } catch {
    return baseUrl;
  }
}

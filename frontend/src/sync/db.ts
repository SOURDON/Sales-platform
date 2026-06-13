import type { OutboxEntry, SyncCacheRow } from './types';

function syncDbName(): string {
  const api =
    (typeof import.meta !== 'undefined' &&
      (import.meta.env.VITE_API_URL as string | undefined)?.trim()) ||
    'same-origin';
  const slug = api.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 48);
  return `sales-platform-sync-v3-${slug}`;
}

const DB_VERSION = 2;
const OUTBOX_STORE = 'outbox';
const CACHE_STORE = 'cache';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable'));
  }
  if (dbPromise) {
    return dbPromise;
  }
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(syncDbName(), DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;
      if (oldVersion < 1 || !db.objectStoreNames.contains(OUTBOX_STORE)) {
        const store = db.createObjectStore(OUTBOX_STORE, { keyPath: 'id' });
        store.createIndex('userId', 'userId', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (oldVersion < 2 || !db.objectStoreNames.contains(CACHE_STORE)) {
        const cache = db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
        cache.createIndex('userId', 'userId', { unique: false });
      }
    };
  });
  return dbPromise;
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IDB request failed'));
  });
}

export async function putOutboxRow(row: OutboxEntry): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(OUTBOX_STORE, 'readwrite');
  await idbRequest(tx.objectStore(OUTBOX_STORE).put(row));
}

export async function deleteOutboxRow(id: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(OUTBOX_STORE, 'readwrite');
  await idbRequest(tx.objectStore(OUTBOX_STORE).delete(id));
}

export async function getAllOutboxRows(): Promise<OutboxEntry[]> {
  const db = await openDatabase();
  const tx = db.transaction(OUTBOX_STORE, 'readonly');
  return idbRequest(tx.objectStore(OUTBOX_STORE).getAll());
}

function cacheKeyFor(userId: number, key: string): string {
  return `${userId}:${key}`;
}

export async function putCacheRow(row: SyncCacheRow): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(CACHE_STORE, 'readwrite');
  await idbRequest(tx.objectStore(CACHE_STORE).put(row));
}

export async function getCacheRow<T>(userId: number, cacheKey: string): Promise<T | null> {
  const row = await getCacheRowRecord<T>(userId, cacheKey);
  return row?.data ?? null;
}

export async function getCacheRowRecord<T>(
  userId: number,
  cacheKey: string,
): Promise<(SyncCacheRow & { data: T }) | null> {
  const db = await openDatabase();
  const tx = db.transaction(CACHE_STORE, 'readonly');
  const row = await idbRequest<SyncCacheRow | undefined>(
    tx.objectStore(CACHE_STORE).get(cacheKeyFor(userId, cacheKey)),
  );
  if (!row) {
    return null;
  }
  return row as SyncCacheRow & { data: T };
}

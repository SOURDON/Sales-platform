import type { OutboxEntry, SyncCacheRow } from './types';
import { isTauriRuntime } from '../desktop/tauri';

const DESKTOP_SYNC_DB = 'sales-platform-sync-v3-desktop';

function notifyLocalDataChanged(): void {
  if (!isTauriRuntime()) {
    return;
  }
  void import('../desktop/desktopLocalBackup').then((module) => {
    module.scheduleDesktopLocalBackup();
  });
}

function syncDbName(): string {
  if (isTauriRuntime()) {
    return DESKTOP_SYNC_DB;
  }
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

function ensureSchema(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1 || !db.objectStoreNames.contains(OUTBOX_STORE)) {
    const store = db.createObjectStore(OUTBOX_STORE, { keyPath: 'id' });
    store.createIndex('userId', 'userId', { unique: false });
    store.createIndex('createdAt', 'createdAt', { unique: false });
  }
  if (oldVersion < 2 || !db.objectStoreNames.contains(CACHE_STORE)) {
    const cache = db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
    cache.createIndex('userId', 'userId', { unique: false });
  }
}

function openNamedDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      ensureSchema(request.result, event.oldVersion);
    };
  });
}

async function readAllOutbox(db: IDBDatabase): Promise<OutboxEntry[]> {
  const tx = db.transaction(OUTBOX_STORE, 'readonly');
  return idbRequest(tx.objectStore(OUTBOX_STORE).getAll());
}

async function readAllCache(db: IDBDatabase): Promise<SyncCacheRow[]> {
  const tx = db.transaction(CACHE_STORE, 'readonly');
  return idbRequest(tx.objectStore(CACHE_STORE).getAll());
}

async function mergeRowsIntoDatabase(
  db: IDBDatabase,
  outbox: OutboxEntry[],
  cache: SyncCacheRow[],
): Promise<void> {
  const tx = db.transaction([OUTBOX_STORE, CACHE_STORE], 'readwrite');
  const outboxStore = tx.objectStore(OUTBOX_STORE);
  const cacheStore = tx.objectStore(CACHE_STORE);
  for (const row of outbox) {
    await idbRequest(outboxStore.put(row));
  }
  for (const row of cache) {
    await idbRequest(cacheStore.put(row));
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IDB transaction aborted'));
  });
}

export async function migrateLegacySyncDatabases(): Promise<void> {
  if (!isTauriRuntime() || typeof indexedDB === 'undefined' || !indexedDB.databases) {
    return;
  }
  const targetName = syncDbName();
  const databases = await indexedDB.databases();
  const legacyNames = databases
    .map((entry) => entry.name)
    .filter(
      (name): name is string =>
        !!name && name.startsWith('sales-platform-sync-v3-') && name !== targetName,
    );
  if (legacyNames.length === 0) {
    return;
  }
  const targetDb = await openNamedDatabase(targetName);
  for (const legacyName of legacyNames) {
    const legacyDb = await openNamedDatabase(legacyName);
    try {
      const outbox = await readAllOutbox(legacyDb);
      const cache = await readAllCache(legacyDb);
      if (outbox.length > 0 || cache.length > 0) {
        await mergeRowsIntoDatabase(targetDb, outbox, cache);
      }
    } finally {
      legacyDb.close();
    }
    indexedDB.deleteDatabase(legacyName);
  }
  targetDb.close();
  dbPromise = null;
}

export async function exportSyncSnapshot(): Promise<{
  outbox: OutboxEntry[];
  cache: SyncCacheRow[];
}> {
  await migrateLegacySyncDatabases();
  const db = await openDatabase();
  return {
    outbox: await readAllOutbox(db),
    cache: await readAllCache(db),
  };
}

export async function importSyncSnapshot(snapshot: {
  outbox: OutboxEntry[];
  cache: SyncCacheRow[];
}): Promise<void> {
  const db = await openDatabase();
  await mergeRowsIntoDatabase(db, snapshot.outbox, snapshot.cache);
  notifyLocalDataChanged();
}

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
      ensureSchema(request.result, event.oldVersion);
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
  notifyLocalDataChanged();
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
  notifyLocalDataChanged();
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

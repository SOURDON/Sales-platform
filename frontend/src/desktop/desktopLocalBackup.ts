import { isTauriRuntime } from './tauri';

const BACKUP_DIR = 'local-backup';
const BACKUP_FILE = `${BACKUP_DIR}/snapshot-v1.json`;
const LOCAL_PREFIX = 'sales-platform';

type DesktopLocalBackup = {
  version: 1;
  savedAt: string;
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  indexedDb: {
    outbox: unknown[];
    cache: unknown[];
  };
};

let backupTimer: ReturnType<typeof setTimeout> | null = null;
let backupInFlight = false;

function collectStorage(storage: Storage): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!key || !key.startsWith(LOCAL_PREFIX)) {
      continue;
    }
    const value = storage.getItem(key);
    if (value != null) {
      out[key] = value;
    }
  }
  return out;
}

function applyStorage(storage: Storage, data: Record<string, string>): void {
  for (const [key, value] of Object.entries(data)) {
    storage.setItem(key, value);
  }
}

function hasStorageData(storage: Storage): boolean {
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key?.startsWith(LOCAL_PREFIX)) {
      return true;
    }
  }
  return false;
}

async function readBackupFile(): Promise<DesktopLocalBackup | null> {
  const { exists, readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
  const present = await exists(BACKUP_FILE, { baseDir: BaseDirectory.AppData });
  if (!present) {
    return null;
  }
  try {
    const raw = await readTextFile(BACKUP_FILE, { baseDir: BaseDirectory.AppData });
    const parsed = JSON.parse(raw) as DesktopLocalBackup;
    if (parsed?.version !== 1 || !parsed.indexedDb) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeBackupFile(payload: DesktopLocalBackup): Promise<void> {
  const { mkdir, writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
  await mkdir(BACKUP_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
  await writeTextFile(BACKUP_FILE, JSON.stringify(payload), {
    baseDir: BaseDirectory.AppData,
  });
}

async function hasMeaningfulLocalData(): Promise<boolean> {
  if (hasStorageData(window.localStorage) || hasStorageData(window.sessionStorage)) {
    return true;
  }
  try {
    const db = await import('../sync/db');
    const snap = await db.exportSyncSnapshot();
    return snap.outbox.length > 0 || snap.cache.length > 0;
  } catch {
    return false;
  }
}

async function restoreFromBackup(backup: DesktopLocalBackup): Promise<void> {
  applyStorage(window.localStorage, backup.localStorage);
  applyStorage(window.sessionStorage, backup.sessionStorage);
  const db = await import('../sync/db');
  await db.importSyncSnapshot({
    outbox: backup.indexedDb.outbox as Awaited<ReturnType<typeof db.exportSyncSnapshot>>['outbox'],
    cache: backup.indexedDb.cache as Awaited<ReturnType<typeof db.exportSyncSnapshot>>['cache'],
  });
}

function snapshotWeight(snapshot: { outbox: unknown[]; cache: unknown[] }): number {
  return snapshot.outbox.length + snapshot.cache.length;
}

export async function ensureDesktopLocalDataRestored(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  const db = await import('../sync/db');
  await db.migrateLegacySyncDatabases();
  const backup = await readBackupFile();
  if (!backup) {
    return;
  }
  const current = await db.exportSyncSnapshot();
  const currentEmpty = snapshotWeight(current) === 0;
  const backupHasData = snapshotWeight(backup.indexedDb) > 0;
  if ((currentEmpty && backupHasData) || !(await hasMeaningfulLocalData())) {
    await restoreFromBackup(backup);
  }
}

export async function flushDesktopLocalBackup(): Promise<void> {
  if (!isTauriRuntime() || backupInFlight) {
    return;
  }
  backupInFlight = true;
  try {
    if (!(await hasMeaningfulLocalData())) {
      return;
    }
    const db = await import('../sync/db');
    const indexedDb = await db.exportSyncSnapshot();
    const payload: DesktopLocalBackup = {
      version: 1,
      savedAt: new Date().toISOString(),
      localStorage: collectStorage(window.localStorage),
      sessionStorage: collectStorage(window.sessionStorage),
      indexedDb,
    };
    await writeBackupFile(payload);
  } catch {
    // ignore backup errors — app must keep working
  } finally {
    backupInFlight = false;
  }
}

export function scheduleDesktopLocalBackup(): void {
  if (!isTauriRuntime()) {
    return;
  }
  if (backupTimer) {
    window.clearTimeout(backupTimer);
  }
  backupTimer = window.setTimeout(() => {
    backupTimer = null;
    void flushDesktopLocalBackup();
  }, 1500);
}

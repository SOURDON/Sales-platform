import type { AcquiringProfile } from './acquiring/acquiringConfig';

const SETTINGS_KEY = 'sales-platform-offline-store-settings-v1';

export type OfflineStoreSettings = {
  storeName: string;
  acquiringPercent: number;
  sellerPercents: Record<string, number>;
};

const DEFAULT_SETTINGS: OfflineStoreSettings = {
  storeName: 'Моя точка',
  acquiringPercent: 1.8,
  sellerPercents: {},
};

export function readOfflineStoreSettings(): OfflineStoreSettings {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }
    const parsed = JSON.parse(raw) as Partial<OfflineStoreSettings>;
    return {
      storeName:
        typeof parsed.storeName === 'string' && parsed.storeName.trim()
          ? parsed.storeName.trim()
          : DEFAULT_SETTINGS.storeName,
      acquiringPercent:
        typeof parsed.acquiringPercent === 'number' && Number.isFinite(parsed.acquiringPercent)
          ? Math.max(0, Math.min(100, parsed.acquiringPercent))
          : DEFAULT_SETTINGS.acquiringPercent,
      sellerPercents:
        parsed.sellerPercents && typeof parsed.sellerPercents === 'object'
          ? Object.fromEntries(
              Object.entries(parsed.sellerPercents).filter(
                ([, value]) => typeof value === 'number' && Number.isFinite(value),
              ),
            )
          : {},
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeOfflineStoreSettings(patch: Partial<OfflineStoreSettings>): OfflineStoreSettings {
  const current = readOfflineStoreSettings();
  const next: OfflineStoreSettings = {
    storeName: patch.storeName?.trim() ? patch.storeName.trim() : current.storeName,
    acquiringPercent:
      patch.acquiringPercent !== undefined
        ? Math.max(0, Math.min(100, patch.acquiringPercent))
        : current.acquiringPercent,
    sellerPercents: patch.sellerPercents ? { ...patch.sellerPercents } : { ...current.sellerPercents },
  };
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  }
  return next;
}

export function setOfflineStoreName(storeName: string): OfflineStoreSettings {
  return writeOfflineStoreSettings({ storeName });
}

export function setOfflineAcquiringPercent(acquiringPercent: number): OfflineStoreSettings {
  return writeOfflineStoreSettings({ acquiringPercent });
}

export function setOfflineSellerPercent(sellerId: number, ratePercent: number): OfflineStoreSettings {
  const current = readOfflineStoreSettings();
  return writeOfflineStoreSettings({
    sellerPercents: {
      ...current.sellerPercents,
      [String(sellerId)]: Math.max(0, Math.min(100, ratePercent)),
    },
  });
}

export function offlineSellerPercent(sellerId: number, fallback: number): number {
  const value = readOfflineStoreSettings().sellerPercents[String(sellerId)];
  return typeof value === 'number' ? value : fallback;
}

export function offlineAcquiringPercentForStore(
  storeName: string,
  profiles: AcquiringProfile[],
  defaultPercent: number,
): number {
  void storeName;
  void profiles;
  return readOfflineStoreSettings().acquiringPercent ?? defaultPercent;
}

import { ALL_DEMO_STORE_NAMES } from '../inventory/normalizeInventoryOverview';

export const ACQUIRING_PROFILE_IDS = [
  'putintsev-vtb',
  'detkov-vtb',
  'putintsev-sber',
  'lyokha-rs',
] as const;

export type AcquiringProfileId = (typeof ACQUIRING_PROFILE_IDS)[number];

export type AcquiringProfile = {
  id: AcquiringProfileId;
  label: string;
  percent: number;
  storeNames: string[];
};

/** Счёт по умолчанию: все точки без явной привязки к другому профилю. */
export const ACQUIRING_DEFAULT_PROFILE_ID: AcquiringProfileId = 'putintsev-vtb';

const PROFILE_LABELS: Record<AcquiringProfileId, string> = {
  'putintsev-vtb': 'Путинцев ВТБ',
  'detkov-vtb': 'Детков ВТБ',
  'putintsev-sber': 'Путинцев Сбербанк',
  'lyokha-rs': 'Р/с Лёха',
};

const DEFAULT_STORES_BY_PROFILE: Record<AcquiringProfileId, readonly string[]> = {
  'putintsev-vtb': [],
  'detkov-vtb': ['Центр Тех. зона', 'Центр пляж', 'Дельфин Тех. зона'],
  'putintsev-sber': [],
  'lyokha-rs': ['Сады морей Тех. зона', 'Сады морей Пляж', 'Метрополь', 'Багамы', 'Спортивнй'],
};

const demoStoreSet = new Set<string>(ALL_DEMO_STORE_NAMES);

function normStoreKey(name: string): string {
  return String(name).toLocaleLowerCase('ru-RU').trim();
}

function clampPercent(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)) * 1000) / 1000;
}

function isProfileId(value: string): value is AcquiringProfileId {
  return (ACQUIRING_PROFILE_IDS as readonly string[]).includes(value);
}

export function defaultAcquiringProfiles(legacy?: {
  putintsevVtb?: number;
  detkovVtb?: number;
  putintsevSber?: number;
  lyokhaRs?: number;
}): AcquiringProfile[] {
  const pct = (id: AcquiringProfileId, fallback: number) => {
    if (id === 'putintsev-vtb' && legacy?.putintsevVtb != null) {
      return clampPercent(legacy.putintsevVtb);
    }
    if (id === 'detkov-vtb' && legacy?.detkovVtb != null) {
      return clampPercent(legacy.detkovVtb);
    }
    if (id === 'putintsev-sber' && legacy?.putintsevSber != null) {
      return clampPercent(legacy.putintsevSber);
    }
    if (id === 'lyokha-rs' && legacy?.lyokhaRs != null) {
      return clampPercent(legacy.lyokhaRs);
    }
    return clampPercent(fallback);
  };
  return ACQUIRING_PROFILE_IDS.map((id) => ({
    id,
    label: PROFILE_LABELS[id],
    percent: pct(id, 1.8),
    storeNames: [...DEFAULT_STORES_BY_PROFILE[id]],
  }));
}

export function normalizeAcquiringProfiles(
  raw: unknown,
  legacy?: {
    putintsevVtb?: number;
    detkovVtb?: number;
    putintsevSber?: number;
    lyokhaRs?: number;
  },
): AcquiringProfile[] {
  const base = defaultAcquiringProfiles(legacy);
  if (!Array.isArray(raw)) {
    return base;
  }
  const byId = new Map(base.map((p) => [p.id, { ...p, storeNames: [...p.storeNames] }]));
  for (const row of raw) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const id = String((row as { id?: string }).id ?? '').trim();
    if (!isProfileId(id)) {
      continue;
    }
    const current = byId.get(id)!;
    const percentRaw = Number((row as { percent?: number }).percent);
    if (Number.isFinite(percentRaw)) {
      current.percent = clampPercent(percentRaw);
    }
    const storesRaw = (row as { storeNames?: unknown }).storeNames;
    if (Array.isArray(storesRaw)) {
      current.storeNames = storesRaw
        .map((s) => String(s).trim())
        .filter((s) => demoStoreSet.has(s));
    }
  }
  const claimed = new Set<string>();
  for (const id of ACQUIRING_PROFILE_IDS) {
    const profile = byId.get(id)!;
    const unique: string[] = [];
    for (const storeName of profile.storeNames) {
      const key = normStoreKey(storeName);
      if (claimed.has(key)) {
        continue;
      }
      claimed.add(key);
      unique.push(storeName);
    }
    profile.storeNames = unique;
  }
  const defaultProfile = byId.get(ACQUIRING_DEFAULT_PROFILE_ID)!;
  defaultProfile.storeNames = [];
  return ACQUIRING_PROFILE_IDS.map((id) => byId.get(id)!);
}

/** Явная привязка к счёту (не счёт по умолчанию). */
export function explicitOwnerProfileId(
  storeName: string,
  profiles: AcquiringProfile[],
): AcquiringProfileId | null {
  const key = normStoreKey(storeName);
  for (const profile of profiles) {
    if (profile.id === ACQUIRING_DEFAULT_PROFILE_ID) {
      continue;
    }
    if (profile.storeNames.some((s) => normStoreKey(s) === key)) {
      return profile.id;
    }
  }
  return null;
}

export function profileIdForStore(storeName: string, profiles: AcquiringProfile[]): AcquiringProfileId {
  return explicitOwnerProfileId(storeName, profiles) ?? ACQUIRING_DEFAULT_PROFILE_ID;
}

export function isStoreOnProfile(
  storeName: string,
  profileId: AcquiringProfileId,
  profiles: AcquiringProfile[],
): boolean {
  return profileIdForStore(storeName, profiles) === profileId;
}

/** Точки, которые реально относятся к счёту (для UI). */
export function storesForProfile(
  profileId: AcquiringProfileId,
  profiles: AcquiringProfile[],
): string[] {
  if (profileId === ACQUIRING_DEFAULT_PROFILE_ID) {
    return ALL_DEMO_STORE_NAMES.filter(
      (storeName) => explicitOwnerProfileId(storeName, profiles) === null,
    ) as string[];
  }
  const profile = profiles.find((item) => item.id === profileId);
  return profile ? [...profile.storeNames] : [];
}

export function canUnassignStoreFromProfile(
  storeName: string,
  profileId: AcquiringProfileId,
  profiles: AcquiringProfile[],
): boolean {
  if (!isStoreOnProfile(storeName, profileId, profiles)) {
    return false;
  }
  if (profileId === ACQUIRING_DEFAULT_PROFILE_ID) {
    return explicitOwnerProfileId(storeName, profiles) !== null;
  }
  return true;
}

export function percentForStore(storeName: string, profiles: AcquiringProfile[]): number {
  const id = profileIdForStore(storeName, profiles);
  const profile = profiles.find((p) => p.id === id);
  return profile?.percent ?? 1.8;
}

/** Короткая подпись точки для компактных чипов в блоке эквайринга. */
export function acquiringStoreChipLabel(storeName: string): string {
  const shortcuts: Record<string, string> = {
    'Сады морей Тех. зона': 'Сады ТЗ',
    'Сады морей Пляж': 'Сады пляж',
    'Метрополь': 'Метрополь',
    'Багамы': 'Багамы',
    'Спортивнй': 'Спортивный',
    'Центр пляж': 'Центр пляж',
    'Центр Тех. зона': 'Центр ТЗ',
    'Дельфин Тех. зона': 'Дельфин',
  };
  return shortcuts[storeName] ?? storeName;
}

export function toggleStoreOnProfile(
  profiles: AcquiringProfile[],
  profileId: AcquiringProfileId,
  storeName: string,
  enabled: boolean,
): AcquiringProfile[] {
  const key = normStoreKey(storeName);

  if (profileId === ACQUIRING_DEFAULT_PROFILE_ID) {
    if (!enabled) {
      return profiles;
    }
    return profiles.map((profile) => {
      if (profile.id === ACQUIRING_DEFAULT_PROFILE_ID) {
        return { ...profile, storeNames: [] };
      }
      return {
        ...profile,
        storeNames: profile.storeNames.filter((s) => normStoreKey(s) !== key),
      };
    });
  }

  if (!enabled) {
    if (!canUnassignStoreFromProfile(storeName, profileId, profiles)) {
      return profiles;
    }
    return profiles.map((profile) => {
      if (profile.id === profileId) {
        return {
          ...profile,
          storeNames: profile.storeNames.filter((s) => normStoreKey(s) !== key),
        };
      }
      return profile;
    });
  }

  return profiles.map((profile) => {
    const without = profile.storeNames.filter((s) => normStoreKey(s) !== key);
    if (profile.id === profileId) {
      return { ...profile, storeNames: [...without, storeName] };
    }
    if (profile.id === ACQUIRING_DEFAULT_PROFILE_ID) {
      return { ...profile, storeNames: [] };
    }
    return { ...profile, storeNames: without };
  });
}

export function setProfilePercent(
  profiles: AcquiringProfile[],
  profileId: AcquiringProfileId,
  percent: number,
): AcquiringProfile[] {
  return profiles.map((p) => (p.id === profileId ? { ...p, percent: clampPercent(percent) } : p));
}

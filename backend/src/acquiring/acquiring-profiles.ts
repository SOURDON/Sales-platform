import { DEMO_STORE_NAMES } from '../auth/demo-stores';

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

const demoStoreSet = new Set<string>(DEMO_STORE_NAMES as readonly string[]);

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
  const defaultProfile = byId.get('putintsev-vtb')!;
  defaultProfile.storeNames = [];
  return ACQUIRING_PROFILE_IDS.map((id) => byId.get(id)!);
}

export function parseAcquiringProfilesJson(
  json: string | null | undefined,
  legacy?: {
    putintsevVtb?: number;
    detkovVtb?: number;
    putintsevSber?: number;
    lyokhaRs?: number;
  },
): AcquiringProfile[] {
  if (!json?.trim()) {
    return defaultAcquiringProfiles(legacy);
  }
  try {
    return normalizeAcquiringProfiles(JSON.parse(json), legacy);
  } catch {
    return defaultAcquiringProfiles(legacy);
  }
}

export function serializeAcquiringProfiles(profiles: AcquiringProfile[]): string {
  return JSON.stringify(
    ACQUIRING_PROFILE_IDS.map((id) => {
      const row = profiles.find((p) => p.id === id);
      return {
        id,
        label: row?.label ?? PROFILE_LABELS[id],
        percent: row?.percent ?? 1.8,
        storeNames:
          id === 'putintsev-vtb' ? [] : (row?.storeNames ?? []),
      };
    }),
  );
}

export function profileIdForStore(storeName: string, profiles: AcquiringProfile[]): AcquiringProfileId {
  const key = normStoreKey(storeName);
  for (const profile of profiles) {
    if (profile.id === 'putintsev-vtb') {
      continue;
    }
    if (profile.storeNames.some((s) => normStoreKey(s) === key)) {
      return profile.id;
    }
  }
  return 'putintsev-vtb';
}

export function percentForStore(storeName: string, profiles: AcquiringProfile[]): number {
  const id = profileIdForStore(storeName, profiles);
  const profile = profiles.find((p) => p.id === id);
  return profile?.percent ?? 1.8;
}

export function syncLegacyPercentsFromProfiles(profiles: AcquiringProfile[]): {
  acquiringPercent: number;
  acquiringPercentDetkov: number;
  acquiringPercentPutintsevSber: number;
  acquiringPercentLyokha: number;
} {
  const pick = (id: AcquiringProfileId) => profiles.find((p) => p.id === id)?.percent ?? 1.8;
  return {
    acquiringPercent: pick('putintsev-vtb'),
    acquiringPercentDetkov: pick('detkov-vtb'),
    acquiringPercentPutintsevSber: pick('putintsev-sber'),
    acquiringPercentLyokha: pick('lyokha-rs'),
  };
}

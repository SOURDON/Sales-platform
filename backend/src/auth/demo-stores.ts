/** @deprecated Один общий склад; остатки переносятся в «Сады моря» при загрузке. */
export const CENTRAL_WAREHOUSE_LOCATION_KEY = '__WAREHOUSE__';

export const WAREHOUSE_SADY_KEY = '__WAREHOUSE_SADY__';
export const WAREHOUSE_CENTER_KEY = '__WAREHOUSE_CENTER__';

export const WAREHOUSE_KEYS = [WAREHOUSE_SADY_KEY, WAREHOUSE_CENTER_KEY] as const;
export type WarehouseKey = (typeof WAREHOUSE_KEYS)[number];

export const WAREHOUSES: ReadonlyArray<{ key: WarehouseKey; label: string }> = [
  { key: WAREHOUSE_SADY_KEY, label: 'Сады моря' },
  { key: WAREHOUSE_CENTER_KEY, label: 'Центр' },
];

/**
 * Справочник торговых точек для демо / теста (названия задаёт заказчик).
 */
export const DEMO_STORE_NAMES = [
  'Сады морей Тех. зона',
  'Сады морей Пляж',
  'Метрополь',
  'Багамы',
  'Спортивнй',
  'Центр пляж',
  'Центр Тех. зона',
  'Дельфин Тех. зона',
] as const;

export type DemoStoreName = (typeof DEMO_STORE_NAMES)[number];

/** Точки, где управляющий отображается как сотрудник (процент с выручки). */
export const MANAGER_ASSIGNED_STORE_NAMES = [
  'Спортивнй',
  'Центр пляж',
  'Центр Тех. зона',
  'Дельфин Тех. зона',
] as const satisfies readonly DemoStoreName[];

export const MANAGER_USER_NICKNAME = 'manager';

/** Точка → склад, с которого списывается товар при приёмке на точку. */
export const STORE_TO_WAREHOUSE: Record<DemoStoreName, WarehouseKey> = {
  'Сады морей Тех. зона': WAREHOUSE_SADY_KEY,
  'Сады морей Пляж': WAREHOUSE_SADY_KEY,
  'Метрополь': WAREHOUSE_SADY_KEY,
  'Багамы': WAREHOUSE_SADY_KEY,
  'Спортивнй': WAREHOUSE_CENTER_KEY,
  'Центр пляж': WAREHOUSE_CENTER_KEY,
  'Центр Тех. зона': WAREHOUSE_CENTER_KEY,
  'Дельфин Тех. зона': WAREHOUSE_CENTER_KEY,
};

export function warehouseKeyForStore(storeName: string): WarehouseKey | null {
  return (STORE_TO_WAREHOUSE as Record<string, WarehouseKey>)[storeName] ?? null;
}

export function warehouseLabelForKey(key: string): string {
  return WAREHOUSES.find((w) => w.key === key)?.label ?? key;
}

export function storesForWarehouse(warehouseKey: WarehouseKey): DemoStoreName[] {
  return DEMO_STORE_NAMES.filter((store) => STORE_TO_WAREHOUSE[store] === warehouseKey);
}

export function isWarehouseKey(key: string): key is WarehouseKey {
  return (WAREHOUSE_KEYS as readonly string[]).includes(key);
}

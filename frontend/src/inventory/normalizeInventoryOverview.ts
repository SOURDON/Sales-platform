/** Согласовано с backend/src/auth/demo-stores.ts */
export const WAREHOUSE_SADY_KEY = '__WAREHOUSE_SADY__';
export const WAREHOUSE_CENTER_KEY = '__WAREHOUSE_CENTER__';

const SADY_STORES = [
  'Сады морей Тех. зона',
  'Сады морей Пляж',
  'Метрополь',
  'Багамы',
] as const;

const CENTER_STORES = ['Спортивнй', 'Центр пляж', 'Центр Тех. зона', 'Дельфин Тех. зона'] as const;

export const DEFAULT_INVENTORY_WAREHOUSES = [
  { key: WAREHOUSE_SADY_KEY, label: 'Сады моря', storeNames: [...SADY_STORES] },
  { key: WAREHOUSE_CENTER_KEY, label: 'Центр', storeNames: [...CENTER_STORES] },
] as const;

export type InventoryWarehouseSection = {
  key: string;
  label: string;
  storeNames: string[];
};

export type InventoryOverviewResponse = {
  warehouses: InventoryWarehouseSection[];
  storeNames: string[];
  products: Array<{
    name: string;
    price: number;
    stockByWarehouse: Record<string, { qtyWarehouse: number; qtyInStores: number }>;
    qtyGrandTotal: number;
  }>;
};

function emptyStockByWarehouse(): Record<string, { qtyWarehouse: number; qtyInStores: number }> {
  return {
    [WAREHOUSE_SADY_KEY]: { qtyWarehouse: 0, qtyInStores: 0 },
    [WAREHOUSE_CENTER_KEY]: { qtyWarehouse: 0, qtyInStores: 0 },
  };
}

/** Приводит ответ API (новый или старый) и кэш к формату с двумя складами. */
export function normalizeInventoryOverview(raw: unknown): InventoryOverviewResponse | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const data = raw as Record<string, unknown>;
  const storeNames = Array.isArray(data.storeNames)
    ? (data.storeNames as string[]).filter((s) => typeof s === 'string')
    : [...SADY_STORES, ...CENTER_STORES];

  const warehousesRaw = data.warehouses;
  const warehouses: InventoryWarehouseSection[] =
    Array.isArray(warehousesRaw) && warehousesRaw.length > 0
      ? warehousesRaw
          .map((w) => {
            const row = w as Record<string, unknown>;
            const key = String(row.key ?? '');
            const label = String(row.label ?? key);
            const names = Array.isArray(row.storeNames)
              ? (row.storeNames as string[]).filter((s) => typeof s === 'string')
              : [];
            return { key, label, storeNames: names };
          })
          .filter((w) => w.key)
      : DEFAULT_INVENTORY_WAREHOUSES.map((w) => ({
          ...w,
          storeNames: w.storeNames.filter((s) => storeNames.includes(s)),
        }));

  const productsRaw = Array.isArray(data.products) ? data.products : [];
  const products = productsRaw
    .map((row) => {
      const p = row as Record<string, unknown>;
      const name = String(p.name ?? '').trim();
      if (!name) {
        return null;
      }
      const price = Number(p.price);
      const stockRaw = p.stockByWarehouse;
      if (stockRaw && typeof stockRaw === 'object' && !Array.isArray(stockRaw)) {
        const stockByWarehouse = { ...emptyStockByWarehouse() };
        for (const w of warehouses) {
          const cell = (stockRaw as Record<string, unknown>)[w.key] as
            | Record<string, unknown>
            | undefined;
          stockByWarehouse[w.key] = {
            qtyWarehouse: Number(cell?.qtyWarehouse) || 0,
            qtyInStores: Number(cell?.qtyInStores) || 0,
          };
        }
        const qtyGrandTotal =
          Number(p.qtyGrandTotal) ||
          Object.values(stockByWarehouse).reduce(
            (sum, cell) => sum + cell.qtyWarehouse + cell.qtyInStores,
            0,
          );
        return { name, price: Number.isFinite(price) ? price : 0, stockByWarehouse, qtyGrandTotal };
      }

      const qtyWarehouse = Number(p.qtyWarehouse) || 0;
      const qtyInStores = Number(p.qtyInStores) || 0;
      const qtyGrandTotal = Number(p.qtyGrandTotal) || qtyWarehouse + qtyInStores;
      const stockByWarehouse = emptyStockByWarehouse();
      stockByWarehouse[WAREHOUSE_SADY_KEY] = { qtyWarehouse, qtyInStores: 0 };
      stockByWarehouse[WAREHOUSE_CENTER_KEY] = { qtyWarehouse: 0, qtyInStores: 0 };
      return { name, price: Number.isFinite(price) ? price : 0, stockByWarehouse, qtyGrandTotal };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  return { warehouses, storeNames, products };
}

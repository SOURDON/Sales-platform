/** Центральный склад (не торговая точка): ключ в БД и в API. */
export const CENTRAL_WAREHOUSE_LOCATION_KEY = '__WAREHOUSE__';

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

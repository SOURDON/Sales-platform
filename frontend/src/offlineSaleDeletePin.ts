/** Пароль для удаления продажи, ещё не отправленной на сервер (офлайн). */
const DEFAULT_OFFLINE_SALE_DELETE_PIN = '4826';

export function verifyOfflineSaleDeletePin(input: string): boolean {
  const fromEnv = import.meta.env.VITE_OFFLINE_SALE_DELETE_PIN;
  const expected =
    typeof fromEnv === 'string' && fromEnv.trim() ? fromEnv.trim() : DEFAULT_OFFLINE_SALE_DELETE_PIN;
  return input.trim() === expected;
}

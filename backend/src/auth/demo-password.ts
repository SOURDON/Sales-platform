/**
 * Пароль по умолчанию для демо-пользователей.
 * В продакшене задайте DEMO_DEFAULT_PASSWORD (не короче 10 символов).
 */
export function getDefaultDemoPassword(): string {
  const fromEnv = process.env.DEMO_DEFAULT_PASSWORD?.trim();
  if (fromEnv && fromEnv.length >= 10) {
    return fromEnv;
  }
  return 'Foto-2026-9kLq';
}

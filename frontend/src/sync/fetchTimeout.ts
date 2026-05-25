const DEFAULT_MS = 20_000;

/** fetch с таймаутом — иначе на Render/Tauri запрос может висеть минутами. */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = DEFAULT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Превышено время ожидания сервера (${Math.round(timeoutMs / 1000)} с)`);
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

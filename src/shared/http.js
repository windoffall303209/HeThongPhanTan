// Sends a JSON HTTP request and throws readable errors for non-2xx responses.
// Includes a timeout to prevent requests from hanging indefinitely.
export async function requestJson(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(options.headers ?? {})
      }
    });

    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    if (!response.ok) {
      const message = body?.error ?? `${response.status} ${response.statusText}`;
      throw new Error(message);
    }

    return body;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

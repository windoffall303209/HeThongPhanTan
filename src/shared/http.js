// Sends a JSON HTTP request and throws readable errors for non-2xx responses.
export async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers ?? {})
    }
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = body?.error ?? `${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  return body;
}

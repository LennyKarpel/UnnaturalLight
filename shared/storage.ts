/**
 * This browser's localStorage, without the throwing: storage may be
 * unavailable (private mode, blocked), full, or hold something that isn't
 * JSON. Reads then come back null/undefined and writes do nothing.
 */

export function readStored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function store(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable or full */ }
}

/** The parsed value under `key`, or undefined when missing, unreadable or not JSON. Check its shape before use. */
export function readStoredJson(key: string): unknown {
  const raw = readStored(key);
  if (raw == null) return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}

export const storeJson = (key: string, value: unknown) => store(key, JSON.stringify(value));

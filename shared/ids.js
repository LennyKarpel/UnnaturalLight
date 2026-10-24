/**
 * A new unique id: a UUID, or (where the browser only offers that on secure
 * pages, e.g. another machine over plain http) `prefix-time-random`.
 *
 * @param {string} [prefix]
 * @returns {string}
 */
export function newId(prefix = "id") {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // non-secure context
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

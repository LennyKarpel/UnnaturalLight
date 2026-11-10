/**
 * Number limits shared by the console and the stage. A value that isn't a
 * number becomes the low end (or the fallback given), never NaN.
 */

/** v limited to min…max (min when v isn't a number). */
export const clamp = (v: number, min: number, max: number): number => (Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : min);

/** v rounded and limited to min…max (min when v isn't a number). */
export const clampInt = (v: number, min: number, max: number): number => clamp(Math.round(v), min, max);

/**
 * A typed or saved number, or null when there's none: empty (e.g. a field
 * cleared mid-edit, which isn't 0), null, or not a number.
 */
export function numberFrom(raw: unknown): number | null {
  if (raw == null || String(raw).trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** A DMX value: a whole number 0–255 (`fallback` when v isn't a number). */
export function clampByte(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? clampInt(n, 0, 255) : fallback;
}

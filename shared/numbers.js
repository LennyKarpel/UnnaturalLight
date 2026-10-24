/**
 * Number limits shared by the console and the stage. A value that isn't a
 * number becomes the low end (or the fallback given), never NaN.
 */

/** v limited to min…max (min when v isn't a number). */
export const clamp = (v, min, max) => (Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : min);

/** v rounded and limited to min…max (min when v isn't a number). */
export const clampInt = (v, min, max) => clamp(Math.round(v), min, max);

/** A DMX value: a whole number 0–255 (`fallback` when v isn't a number). */
export function clampByte(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? clampInt(n, 0, 255) : fallback;
}

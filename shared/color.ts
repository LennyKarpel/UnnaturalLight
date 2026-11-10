/**
 * Hex colors ↔ red / green / blue (0–255), and mixing a color onto a
 * fixture's emitters (red, green, blue, deep red, white, amber, lime, cyan,
 * indigo, UV); shared by the console and the stage.
 */

import { clampByte } from "./numbers.ts";
import { isOneOf } from "./guards.ts";
import type { DmxAttr } from "./attributes.ts";

/** [r, g, b]: 0–255, or 0–1 for an emitter's color. */
export type Rgb = [number, number, number];

/** [r, g, b] 0–255 → "#rrggbb" */
export function hexFromRgb(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => clampByte(c).toString(16).padStart(2, "0")).join("")}`;
}

/** "#rrggbb" → [r, g, b] 0–255 (white if it isn't a color). */
export function rgbFromHex(hex: string): Rgb {
  const n = parseInt(String(hex).slice(1), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [255, 255, 255];
}

/**
 * The color each emitter gives at full, as [r, g, b] 0–1. General values:
 * real LEDs differ a little by manufacturer.
 */
/** Every color channel role (what a color bar spans). */
export const COLOR_ROLES = ["red", "green", "blue", "deepred", "white", "amber", "lime", "cyan", "indigo", "uv"] as const satisfies readonly DmxAttr[];
export type ColorRole = (typeof COLOR_ROLES)[number];
export const isColorRole = (v: unknown): v is ColorRole => isOneOf(COLOR_ROLES, v);

const EMITTERS: Record<ColorRole, Rgb> = {
  red: [1, 0, 0],
  green: [0, 1, 0],
  blue: [0, 0, 1],
  // Deeper than red (≈660 nm vs ≈630 nm): dimmer, and leaning toward
  // crimson, so it's used for deep / crimson reds and red does plain red.
  deepred: [0.7, 0, 0.035],
  white: [1, 1, 1],
  amber: [1, 0.6, 0],
  lime: [0.7, 1, 0],
  cyan: [0, 1, 1],
  indigo: [0.25, 0, 1],
  uv: [0.3, 0, 0.6],
};

/** Swatches for emitters that look the same as another at full brightness. */
const SWATCHES: Partial<Record<ColorRole, string>> = { deepred: "#a8001c" };

/** An emitter's color as hex, at full brightness (e.g. a swatch for its fader). */
export function emitterHex(role: string): string {
  if (!isColorRole(role)) return "#000000";
  const swatch = SWATCHES[role];
  if (swatch) return swatch;
  const vec = EMITTERS[role];
  const max = Math.max(...vec) || 1;
  const [r, g, b] = vec.map((v) => Math.round((v / max) * 255));
  return hexFromRgb(r, g, b);
}

/**
 * Emitters the picker sets besides red, green and blue (which make up
 * what's left). UV isn't mixed: it's barely visible, so it stays on its
 * own fader.
 */
const TINTS = ["deepred", "amber", "lime", "cyan", "indigo"] as const;
export const MIXED_ROLES: readonly ColorRole[] = ["red", "green", "blue", "white", ...TINTS];

/** Hue (0–360) of an [r, g, b] color. */
function hue([r, g, b]: Rgb): number {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** How far apart two hues are around the wheel (0–180). */
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/**
 * Levels (0–255 per role) that make `hex` on a fixture with these emitters.
 * The extras take as much of the color as they can, so the result is the
 * same color as picked: white takes the part shared by red, green and blue,
 * then deep red / amber / lime / cyan / indigo — nearest in hue to what's left first,
 * so e.g. a yellow-green goes to lime, not amber — then red / green / blue
 * the rest.
 * Only roles in MIXED_ROLES are returned; with just red, green and blue
 * this is the hex's own values.
 */
export function levelsFromColor(hex: string, roles: Iterable<string>): Partial<Record<ColorRole, number>> {
  const has = new Set<string>(roles);
  const rest = rgbFromHex(hex).map((c) => c / 255) as Rgb;
  const out: Partial<Record<ColorRole, number>> = {};
  const take = (role: ColorRole) => {
    const vec = EMITTERS[role];
    let level = 1;
    vec.forEach((v, c) => { if (v > 0) level = Math.min(level, rest[c] / v); });
    level = Math.max(0, level);
    vec.forEach((v, c) => { rest[c] = Math.max(0, rest[c] - level * v); });
    out[role] = clampByte(Math.round(level * 255));
  };
  if (has.has("white")) take("white");
  const restHue = hue(rest);
  TINTS.filter((role) => has.has(role))
    .sort((a, b) => hueGap(hue(EMITTERS[a]), restHue) - hueGap(hue(EMITTERS[b]), restHue))
    .forEach(take);
  (["red", "green", "blue"] as const).forEach((role, c) => { if (has.has(role)) out[role] = clampByte(Math.round(rest[c] * 255)); });
  return out;
}

/**
 * The color a mix of emitters gives (0–255 per role; missing = 0), as hex.
 * Scaled down to fit when it's brighter than full white, keeping its hue.
 */
export function colorFromLevels(levels: Record<string, number | undefined>): string {
  const sum: Rgb = [0, 0, 0];
  for (const role of COLOR_ROLES) {
    const level = (levels[role] ?? 0) / 255;
    EMITTERS[role].forEach((v, c) => { sum[c] += level * v; });
  }
  const scale = Math.max(1, ...sum);
  const [r, g, b] = sum.map((v) => Math.round((v / scale) * 255));
  return hexFromRgb(r, g, b);
}

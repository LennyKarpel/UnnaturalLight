/**
 * Hex colors ↔ red / green / blue (0–255), and mixing a color onto a
 * fixture's emitters (red, green, blue, deep red, white, amber, lime, cyan,
 * indigo, UV); shared by the console and the stage.
 */

import { clampByte } from "./numbers.js";

/** [r, g, b] 0–255 → "#rrggbb" */
export function hexFromRgb(r, g, b) {
  return `#${[r, g, b].map((c) => clampByte(c).toString(16).padStart(2, "0")).join("")}`;
}

/** "#rrggbb" → [r, g, b] 0–255 (white if it isn't a color). */
export function rgbFromHex(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [255, 255, 255];
}

/**
 * The color each emitter gives at full, as [r, g, b] 0–1. General values:
 * real LEDs differ a little by manufacturer.
 */
export const EMITTERS = {
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
const SWATCHES = { deepred: "#a8001c" };

/** An emitter's color as hex, at full brightness (e.g. a swatch for its fader). */
export function emitterHex(role) {
  if (SWATCHES[role]) return SWATCHES[role];
  const vec = EMITTERS[role] ?? [0, 0, 0];
  const max = Math.max(...vec) || 1;
  return hexFromRgb(...vec.map((v) => Math.round((v / max) * 255)));
}

/** Every color channel role (what a color bar spans). */
export const COLOR_ROLES = Object.keys(EMITTERS);

/**
 * Emitters the picker sets besides red, green and blue (which make up
 * what's left). UV isn't mixed: it's barely visible, so it stays on its
 * own fader.
 */
const TINTS = ["deepred", "amber", "lime", "cyan", "indigo"];
export const MIXED_ROLES = ["red", "green", "blue", "white", ...TINTS];

/** Hue (0–360) of an [r, g, b] color. */
function hue([r, g, b]) {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** How far apart two hues are around the wheel (0–180). */
const hueGap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/**
 * Levels (0–255 per role) that make `hex` on a fixture with these emitters.
 * The extras take as much of the color as they can, so the result is the
 * same color as picked: white takes the part shared by red, green and blue,
 * then deep red / amber / lime / cyan / indigo — nearest in hue to what's left first,
 * so e.g. a yellow-green goes to lime, not amber — then red / green / blue
 * the rest.
 * Only roles in MIXED_ROLES are returned; with just red, green and blue
 * this is the hex's own values.
 * @param {string} hex
 * @param {Iterable<string>} roles
 * @returns {Record<string, number>}
 */
export function levelsFromColor(hex, roles) {
  const has = new Set(roles);
  const rest = rgbFromHex(hex).map((c) => c / 255);
  const out = {};
  const take = (role) => {
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
  ["red", "green", "blue"].forEach((role, c) => { if (has.has(role)) out[role] = clampByte(Math.round(rest[c] * 255)); });
  return out;
}

/**
 * The color a mix of emitters gives (0–255 per role; missing = 0), as hex.
 * Scaled down to fit when it's brighter than full white, keeping its hue.
 * @param {Record<string, number | undefined>} levels
 */
export function colorFromLevels(levels) {
  const sum = [0, 0, 0];
  for (const role of COLOR_ROLES) {
    const level = (levels[role] ?? 0) / 255;
    EMITTERS[role].forEach((v, c) => { sum[c] += level * v; });
  }
  const scale = Math.max(1, ...sum);
  return hexFromRgb(...sum.map((v) => Math.round((v / scale) * 255)));
}

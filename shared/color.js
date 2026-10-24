/** Hex colors ↔ red / green / blue (0–255), shared by the console and the stage. */

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

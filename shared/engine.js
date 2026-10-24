// Output math shared by the console (meters, stage link) and the show server
// (the DMX it actually sends), so both compute the same levels.

import { FADER_COUNT, scaledLevel } from "../console/patch.js";

/**
 * @typedef {{ master: number, cross: number, fromSub: number, toSub: number, fromRow: number, toRow: number }} Mix
 */

/** Live fader level after submasters + crossfade + master (0–255), before per-channel max. */
export function liveLevel(mix, rows, faderIndex) {
  const a = ((rows[mix.fromRow]?.[faderIndex] ?? 0) * mix.fromSub) / 100;
  const b = ((rows[mix.toRow]?.[faderIndex] ?? 0) * mix.toSub) / 100;
  const t = mix.cross / 100;
  const mixed = a * (1 - t) + b * t;
  return Math.round((mixed * mix.master) / 100);
}

/**
 * DMX channel → output level (highest takes precedence when several faders
 * share a channel).
 * @param {import("../console/patch.js").FaderPatch[]} patch
 * @param {(faderIndex: number) => number} levelOf what each fader sends (0–255)
 * @returns {Map<number, number>}
 */
export function computeChannelLevels(patch, levelOf) {
  const byChannel = new Map();
  for (let i = 0; i < FADER_COUNT; i++) {
    const targets = patch[i];
    if (!targets || targets.length === 0) continue;
    const level = levelOf(i);
    for (const target of targets) {
      const out = scaledLevel(level, target.max);
      const prev = byChannel.get(target.channel) ?? 0;
      if (out > prev) byChannel.set(target.channel, out);
    }
  }
  return byChannel;
}

/** Ease for timed fades (0…1 → 0…1, smooth start and end). */
export const easeFade = (t) => t * t * (3 - 2 * t);

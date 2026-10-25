// Output math shared by the console (meters, stage link) and the show server
// (the DMX it actually sends), so both compute the same levels.

import { FADER_COUNT, scaledLevel } from "../console/patch.js";
import { clampByte } from "./numbers.js";

/**
 * @typedef {{ master: number, cross: number, fromSub: number, toSub: number, fromCue: number, toCue: number }} Mix
 */

/** Live fader level after submasters + crossfade + master (0–255), before per-channel max. */
export function liveLevel(mix, cueLevels, faderIndex) {
  const a = ((cueLevels[mix.fromCue]?.[faderIndex] ?? 0) * mix.fromSub) / 100;
  const b = ((cueLevels[mix.toCue]?.[faderIndex] ?? 0) * mix.toSub) / 100;
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

/**
 * The other way round: move the faders patched to each channel (in the cue(s)
 * on the output) so the channel outputs `value`, allowing for the patch max,
 * master, submasters and crossfade. Returns whether any fader moved.
 * @param {import("../console/patch.js").FaderPatch[]} patch
 * @param {Mix} mix
 * @param {number[][]} cueLevels changed in place
 * @param {{ channel: number, value: number }[]} values
 */
export function setChannelLevels(patch, mix, cueLevels, values) {
  const t = mix.cross / 100;
  let touched = false;
  for (const { channel, value } of values) {
    for (let i = 0; i < patch.length; i++) {
      const target = patch[i].find((p) => p.channel === channel);
      if (!target || target.max <= 0 || mix.master <= 0) continue;
      // Live level the fader needs for this channel to output `value`…
      const level = clampByte((value * 255) / target.max);
      // …and the pre-master mix that gives it (see liveLevel above).
      const mixed = (level * 100) / mix.master;
      if (t < 1 && mix.fromSub > 0) cueLevels[mix.fromCue][i] = clampByte((mixed * 100) / mix.fromSub);
      if (t > 0 && mix.toSub > 0) cueLevels[mix.toCue][i] = clampByte((mixed * 100) / mix.toSub);
      touched = true;
    }
  }
  return touched;
}

/** Ease for timed fades (0…1 → 0…1, smooth start and end). */
export const easeFade = (t) => t * t * (3 - 2 * t);

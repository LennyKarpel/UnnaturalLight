// Output math shared by the console (meters, stage link) and the show server
// (the DMX it actually sends), so both compute the same levels.

import { type FaderPatch, FADER_COUNT, scaledLevel } from "../console/patch.ts";
import { clampByte } from "./numbers.ts";
import type { Channel } from "./address.ts";

/**
 * The looks a GO into a cue passes through before the cue's own (its steps):
 * each one's levels, fade in and hold (seconds), and `fade`, the cue's own
 * fade in after the last step.
 */
export type StepPath = { steps: { levels: number[]; fade: number; hold: number }[]; fade: number };

/**
 * `toLevels`: the look the crossfade goes to, when it isn't cue `toCue`'s
 * (the LIVE cue's next step or own look, or UP NEXT's first step); `toPath`:
 * the steps on the way to it (none, or null: straight to it).
 */
export type Mix = { master: number; cross: number; fromSub: number; toSub: number; fromCue: number; toCue: number; toLevels?: number[] | undefined; toPath?: StepPath | null | undefined };

/** Live fader level after submasters + crossfade + master (0–255), before per-channel max. */
export function liveLevel(mix: Mix, cueLevels: number[][], faderIndex: number): number {
  return Math.round(exactLiveLevel(mix, cueLevels, faderIndex));
}

/** liveLevel before rounding: the in-between level a fade passes through (the stage draws it; DMX can't send it). */
export function exactLiveLevel(mix: Mix, cueLevels: number[][], faderIndex: number): number {
  const a = ((cueLevels[mix.fromCue]?.[faderIndex] ?? 0) * mix.fromSub) / 100;
  const b = (((mix.toLevels ?? cueLevels[mix.toCue])?.[faderIndex] ?? 0) * mix.toSub) / 100;
  const steps = mix.toPath?.steps;
  if (!steps?.length) {
    const t = mix.cross / 100;
    return ((a * (1 - t) + b * t) * mix.master) / 100;
  }
  // Through the steps: every step's look is UP NEXT's, so the to-submaster scales it.
  const looks = [a, ...steps.map((s) => ((s.levels[faderIndex] ?? 0) * mix.toSub) / 100), b];
  return (alongPath(mix.toPath!, mix.cross, looks) * mix.master) / 100;
}

/** Each part of a GO through steps, in order: fade into look k+1, then hold it (seconds; all 0: equal fades). */
function segments(path: StepPath) {
  const parts = [...path.steps.map((s) => ({ fade: s.fade, hold: s.hold })), { fade: path.fade, hold: 0 }];
  return parts.every((p) => p.fade + p.hold <= 0) ? parts.map(() => ({ fade: 1, hold: 0 })) : parts;
}

/**
 * The inverse of easeFade: how far through its time a GO is at crossfade
 * `cross` (0…100), so steps fade on time. (Fades are linear: the same.)
 */
export const timeAt = (cross: number) => Math.min(1, Math.max(0, cross / 100));

/** A value along `looks` (the from look, each step's, the cue's own) at crossfade `cross`; each step's fade follows easeFade on its own. */
function alongPath(path: StepPath, cross: number, looks: number[]): number {
  const parts = segments(path);
  let t = timeAt(cross) * parts.reduce((sum, p) => sum + p.fade + p.hold, 0);
  for (let k = 0; k < parts.length; k++) {
    const { fade, hold } = parts[k];
    if (t < fade) return looks[k] + (looks[k + 1] - looks[k]) * easeFade(t / fade);
    t -= fade;
    if (t < hold) return looks[k + 1];
    t -= hold;
  }
  return looks[looks.length - 1];
}

/**
 * Where a GO through `path` arrives at each look, as crossfade positions
 * (0…100): one per step, then 100 for the cue's own look.
 */
export function stepArrivals(path: StepPath): number[] {
  const parts = segments(path);
  const total = parts.reduce((sum, p) => sum + p.fade + p.hold, 0);
  let t = 0;
  return parts.map((p) => {
    const arrived = t + p.fade;
    t += p.fade + p.hold;
    return Math.min(100, easeFade(arrived / total) * 100);
  });
}

/**
 * Which look a GO through `path` is fading into, or on (arrived or holding),
 * at crossfade `cross`: 0 = the first step … steps.length = the cue's own.
 */
export function stepAt(path: StepPath, cross: number): number {
  const parts = segments(path);
  let t = timeAt(cross) * parts.reduce((sum, p) => sum + p.fade + p.hold, 0);
  for (let k = 0; k < parts.length; k++) {
    t -= parts[k].fade + parts[k].hold;
    if (t < 1e-6) return k;
  }
  return parts.length - 1;
}

/**
 * DMX channel → output level (highest takes precedence when several faders
 * share a channel). `levelOf`: what each fader sends (0–255).
 */
export function computeChannelLevels(
  patch: FaderPatch[],
  levelOf: (faderIndex: number) => number,
  scale: (level: number, max: number) => number = scaledLevel,
): Map<Channel, number> {
  const byChannel = new Map<Channel, number>();
  for (let i = 0; i < FADER_COUNT; i++) {
    const targets = patch[i];
    if (!targets || targets.length === 0) continue;
    const level = levelOf(i);
    for (const target of targets) {
      const out = scale(level, target.max);
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
 * `cueLevels` is changed in place.
 */
/** A channel and the value it should output (0–255). */
export type ChannelValue = { channel: Channel; value: number };

export function setChannelLevels(patch: FaderPatch[], mix: Mix, cueLevels: number[][], values: ChannelValue[]): boolean {
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
      const to = mix.toLevels ?? cueLevels[mix.toCue];
      if (t > 0 && mix.toSub > 0 && to) to[i] = clampByte((mixed * 100) / mix.toSub);
      touched = true;
    }
  }
  return touched;
}

/**
 * The curve of timed fades (0…1 of the time → 0…1 of the way): linear, as a
 * desk's default, so halfway through the time is halfway through the levels.
 * (An S-curve was `t * t * (3 - 2 * t)`; timeAt must stay its inverse.)
 */
export const easeFade = (t: number): number => t;

/**
 * The crossfade `t` (0…1) of the way through a timed fade from `start` to
 * `target` (0…100). From 0 to 100 it's easeFade; from part way (a GO that
 * goes on after a Step, or after the crossfader was moved) it keeps the same
 * pace through time, so steps still fade on time.
 */
export function fadeCross(start: number, target: number, t: number): number {
  if (start <= 0 && target >= 100) return easeFade(Math.min(1, Math.max(0, t))) * 100;
  const from = timeAt(start);
  return easeFade(from + (timeAt(target) - from) * Math.min(1, Math.max(0, t))) * 100;
}

import { clamp, clampByte, clampInt } from "../shared/numbers.ts";
import {
  UNIVERSE_SIZE, MAX_UNIVERSES, DMX_CHANNEL_MAX, universeOf, addressOf, universeStart,
  formatAddress as formatIn, parseAddress as parseIn,
} from "../shared/address.ts";

export { UNIVERSE_SIZE, MAX_UNIVERSES, DMX_CHANNEL_MAX, universeOf, addressOf, universeStart };

export const FADER_COUNT = 256;

let universeCount = 1;
/** The current set's universe count (1…MAX_UNIVERSES); set by app.ts. */
export function setUniverseCount(n: number) {
  universeCount = clampInt(Number(n), 1, MAX_UNIVERSES);
}
/** Highest channel in use with the current universe count. */
export const channelLimit = () => universeCount * UNIVERSE_SIZE;
/** 45 → "45" (one universe) · 557 → "2/45" (several), for the current show. */
export const formatAddress = (channel: number) => formatIn(channel, universeCount);
/** "2/45" → 557 · "45" → 45 · invalid / beyond the show's universes → null. */
export const parseAddress = (text: unknown): number | null => parseIn(text, universeCount);
/** Channels shown on the Channels-tab meter row. */
export const CHANNEL_METER_COUNT = 256;

export type PatchTarget = { channel: number; max: number };
export type FaderPatch = PatchTarget[];

export function defaultPatch(): FaderPatch[] {
  return Array.from({ length: FADER_COUNT }, (): FaderPatch => []);
}

export function identityPatch(): FaderPatch[] {
  return Array.from({ length: FADER_COUNT }, (_, i) => [makeTarget(i + 1, 255)]);
}

export function makeTarget(channel: unknown, max: unknown = 255): PatchTarget {
  const ch = clampChannel(channel);
  if (ch == null) {
    throw new Error(`Invalid DMX channel: ${channel}`);
  }
  return {
    channel: ch,
    max: clampByte(max, 255),
  };
}

export function normalizeFaderPatch(value: unknown): FaderPatch {
  if (value == null || value === "" || value === 0) return [];

  if (!Array.isArray(value)) return [];

  return uniqueByChannel(
    value
      .map((item) => {
        if (item == null) return null;
        const channel = clampChannel(item.channel);
        if (!channel) return null;
        return makeTarget(channel, item.max ?? 255);
      })
      .filter((t) => t != null),
  );
}

export function formatChannelLabel(targets: FaderPatch) {
  const list = normalizeFaderPatch(targets);
  if (list.length === 0) return "—";
  if (list.length === 1) return `Ch${formatAddress(list[0].channel)}`;
  if (list.length === 2) return `${formatAddress(list[0].channel)},${formatAddress(list[1].channel)}`;
  return `${list.length}ch`;
}

export function formatChannelTooltip(targets: FaderPatch) {
  const list = normalizeFaderPatch(targets);
  if (list.length === 0) return "Unpatched";
  return list.map((t) => `Ch${formatAddress(t.channel)}@${t.max}`).join(", ");
}

/** Scale a fader level (0–255) by a target max (0–255). */
export function scaledLevel(faderLevel: unknown, max: unknown): number {
  return Math.round((clampByte(faderLevel, 255) * clampByte(max, 255)) / 255);
}

/** scaledLevel without rounding (for the stage's in-between levels). */
export const exactScaledLevel = (faderLevel: number, max: number): number => (clamp(faderLevel, 0, 255) * clampByte(max, 255)) / 255;

function uniqueByChannel(targets: PatchTarget[]): PatchTarget[] {
  const map = new Map<number, PatchTarget>();
  for (const target of targets) {
    map.set(target.channel, target);
  }
  return [...map.values()].sort((a, b) => a.channel - b.channel);
}

/** A whole channel number 1–DMX_CHANNEL_MAX, or null when it isn't one. */
export function clampChannel(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > DMX_CHANNEL_MAX) return null;
  return n;
}

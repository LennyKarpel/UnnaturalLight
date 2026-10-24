import { clampByte } from "../shared/numbers.js";
import {
  UNIVERSE_SIZE, MAX_UNIVERSES, DMX_CHANNEL_MAX, universeOf, addressOf, universeStart,
  formatAddress as formatIn, parseAddress as parseIn,
} from "../shared/address.js";

export { UNIVERSE_SIZE, MAX_UNIVERSES, DMX_CHANNEL_MAX, universeOf, addressOf, universeStart };

export const FADER_COUNT = 256;

let universeCount = 1;
/** The current set's universe count (1…MAX_UNIVERSES); set by app.js. */
export function setUniverseCount(n) {
  universeCount = Math.max(1, Math.min(MAX_UNIVERSES, Math.round(Number(n)) || 1));
}
/** Highest channel in use with the current universe count. */
export const channelLimit = () => universeCount * UNIVERSE_SIZE;
/** 45 → "45" (one universe) · 557 → "2/45" (several), for the current set. */
export const formatAddress = (channel) => formatIn(channel, universeCount);
/** "2/45" → 557 · "45" → 45 · invalid / beyond the set's universes → null. */
export const parseAddress = (text) => parseIn(text, universeCount);
/** Channels shown on the main-page Channels meter row. */
export const CHANNEL_METER_COUNT = 256;

/**
 * @typedef {{ channel: number, max: number }} PatchTarget
 * @typedef {PatchTarget[]} FaderPatch
 */

/** @returns {FaderPatch[]} */
export function defaultPatch() {
  return Array.from({ length: FADER_COUNT }, () => []);
}

/** @returns {FaderPatch[]} */
export function identityPatch() {
  return Array.from({ length: FADER_COUNT }, (_, i) => [makeTarget(i + 1, 255)]);
}

export function makeTarget(channel, max = 255) {
  const ch = clampChannel(channel);
  if (ch == null) {
    throw new Error(`Invalid DMX channel: ${channel}`);
  }
  return {
    channel: ch,
    max: clampByte(max, 255),
  };
}

/** @returns {FaderPatch} */
export function normalizeFaderPatch(value) {
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
      .filter(Boolean),
  );
}

/** @param {FaderPatch} targets */
export function formatChannelLabel(targets) {
  const list = normalizeFaderPatch(targets);
  if (list.length === 0) return "—";
  if (list.length === 1) return `Ch${formatAddress(list[0].channel)}`;
  if (list.length === 2) return `${formatAddress(list[0].channel)},${formatAddress(list[1].channel)}`;
  return `${list.length}ch`;
}

/** @param {FaderPatch} targets */
export function formatChannelTooltip(targets) {
  const list = normalizeFaderPatch(targets);
  if (list.length === 0) return "Unpatched";
  return list.map((t) => `Ch${formatAddress(t.channel)}@${t.max}`).join(", ");
}

/** Scale a fader level (0–255) by a target max (0–255). */
export function scaledLevel(faderLevel, max) {
  return Math.round((clampByte(faderLevel, 255) * clampByte(max, 255)) / 255);
}

function uniqueByChannel(targets) {
  const map = new Map();
  for (const target of targets) {
    map.set(target.channel, target);
  }
  return [...map.values()].sort((a, b) => a.channel - b.channel);
}

/** A whole channel number 1–DMX_CHANNEL_MAX, or null when it isn't one. */
export function clampChannel(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > DMX_CHANNEL_MAX) return null;
  return n;
}

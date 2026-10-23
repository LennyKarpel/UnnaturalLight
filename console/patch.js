const STORAGE_KEY = "unnaturallight.patch.v1";
const LEGACY_KEYS = [
  "naturallight.patch.v1",
  "sunlight.patch.v3",
  "sunlight.patch.v2",
  "sunlight.patch.v1",
];

export const FADER_COUNT = 256;
/** Channels per DMX universe (one Enttec DMX USB Pro each). */
export const UNIVERSE_SIZE = 512;
/** Most universes a setlist can have. */
export const MAX_UNIVERSES = 8;
/**
 * Channels are numbered continuously across universes: universe 2 channel 1
 * is 513. Shown as "2/1" once there's more than one universe.
 */
export const DMX_CHANNEL_MAX = UNIVERSE_SIZE * MAX_UNIVERSES;

let universeCount = 1;
/** The current setlist's universe count (1…MAX_UNIVERSES); set by app.js. */
export function setUniverseCount(n) {
  universeCount = Math.max(1, Math.min(MAX_UNIVERSES, Math.round(Number(n)) || 1));
}
export const getUniverseCount = () => universeCount;
/** Highest channel in use with the current universe count. */
export const channelLimit = () => universeCount * UNIVERSE_SIZE;
export const universeOf = (channel) => Math.floor((channel - 1) / UNIVERSE_SIZE) + 1;
export const addressOf = (channel) => ((channel - 1) % UNIVERSE_SIZE) + 1;
/** First channel of a universe. */
export const universeStart = (universe) => (universe - 1) * UNIVERSE_SIZE + 1;

/** 45 → "45" (one universe) · 557 → "2/45" (several). */
export function formatAddress(channel) {
  return universeCount > 1 ? `${universeOf(channel)}/${addressOf(channel)}` : String(channel);
}

/** "2/45" → 557 · "45" → 45 · invalid / beyond the universes → null. */
export function parseAddress(text) {
  const m = /^\s*(?:(\d+)\s*\/\s*)?(\d+)\s*$/.exec(String(text));
  if (!m) return null;
  const universe = m[1] ? Number(m[1]) : 1;
  const address = Number(m[2]);
  if (universe < 1 || universe > universeCount || address < 1 || address > UNIVERSE_SIZE) return null;
  return universeStart(universe) + address - 1;
}
/** Channels shown on the main-page Channels meter row. */
export const CHANNEL_METER_COUNT = 256;
export const MIN_ROWS = 2;
export const MAX_ROWS = 24;

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
    max: clampByte(max),
  };
}

export function loadPatch() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    for (const key of LEGACY_KEYS) {
      if (raw) break;
      raw = localStorage.getItem(key);
    }
    if (!raw) return defaultPatch();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultPatch();
    // Older patches had fewer faders: pad with unpatched ones.
    return defaultPatch().map((_, i) => normalizeFaderPatch(parsed[i]));
  } catch {
    return defaultPatch();
  }
}

/** @param {FaderPatch[]} patch */
export function savePatch(patch) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(patch.map(normalizeFaderPatch)));
}

/** @returns {FaderPatch} */
export function normalizeFaderPatch(value) {
  if (value == null || value === "" || value === 0) return [];

  // v1 single channel
  if (typeof value === "number") {
    const channel = clampChannel(value);
    return channel ? [makeTarget(channel, 255)] : [];
  }

  // v2 channel list
  if (Array.isArray(value) && value.every((item) => typeof item === "number" || item == null)) {
    return uniqueByChannel(
      value
        .map((n) => clampChannel(n))
        .filter(Boolean)
        .map((channel) => makeTarget(channel, 255)),
    );
  }

  if (!Array.isArray(value)) return [];

  return uniqueByChannel(
    value
      .map((item) => {
        if (item == null) return null;
        if (typeof item === "number") {
          const channel = clampChannel(item);
          return channel ? makeTarget(channel, 255) : null;
        }
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
  return Math.round((clampByte(faderLevel) * clampByte(max)) / 255);
}

function uniqueByChannel(targets) {
  const map = new Map();
  for (const target of targets) {
    map.set(target.channel, target);
  }
  return [...map.values()].sort((a, b) => a.channel - b.channel);
}

function clampChannel(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > DMX_CHANNEL_MAX) return null;
  return n;
}

function clampByte(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 255;
  return Math.max(0, Math.min(255, Math.round(n)));
}

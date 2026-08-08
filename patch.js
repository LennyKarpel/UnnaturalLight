const STORAGE_KEY = "unnaturallight.patch.v1";
const LEGACY_KEYS = [
  "naturallight.patch.v1",
  "sunlight.patch.v3",
  "sunlight.patch.v2",
  "sunlight.patch.v1",
];

export const FADER_COUNT = 32;
export const DMX_CHANNEL_MAX = 512;
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
    if (!Array.isArray(parsed) || parsed.length !== FADER_COUNT) return defaultPatch();
    return parsed.map(normalizeFaderPatch);
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
  if (list.length === 1) return `Ch${list[0].channel}`;
  if (list.length === 2) return `${list[0].channel},${list[1].channel}`;
  return `${list.length}ch`;
}

/** @param {FaderPatch} targets */
export function formatChannelTooltip(targets) {
  const list = normalizeFaderPatch(targets);
  if (list.length === 0) return "Unpatched";
  return list.map((t) => `Ch${t.channel}@${t.max}`).join(", ");
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

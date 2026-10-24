import { FADER_COUNT } from "./patch.js";
import { newId } from "../shared/ids.js";

export const MAX_SONGS = 32;
export const MIN_CUES = 2;
/** Cues per song: no limit. */
export const MAX_CUES = Infinity;
/** Allowed fade-in seconds to arrive at a cue (GO): 0 (a snap) to 20. */
export const CUE_FADE_TIMES = Array.from({ length: 21 }, (_, i) => i);
export const DEFAULT_CUE_FADE_TIME = 4;

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   levels: number[],
 *   fadeTime: number,
 * }} Cue
 * @typedef {{
 *   id: string,
 *   name: string,
 *   cues: Cue[],
 * }} Song
 */

/** The nearest allowed time (null if not a number). */
function cleanFadeTime(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return CUE_FADE_TIMES.reduce((best, t) => (Math.abs(t - n) < Math.abs(best - n) ? t : best));
}

/** @param {unknown} value @param {number} [fallback] */
export function normalizeCueFadeTime(
  value,
  fallback = DEFAULT_CUE_FADE_TIME,
) {
  return cleanFadeTime(value) ?? cleanFadeTime(fallback) ?? DEFAULT_CUE_FADE_TIME;
}

/** @returns {string} */
function newSongId() {
  return newId("song");
}

/** @returns {string} */
function newCueId() {
  return newId("cue");
}

/** @returns {number[]} */
function blankLevels() {
  return Array.from({ length: FADER_COUNT }, () => 0);
}

/** @param {number} index */
export function defaultSongName(index) {
  return `Song ${index + 1}`;
}

// Cues are shown as "Cue <position>" plus an optional name (new cues have none).
/** @param {unknown} name */
function normalizeCueName(name) {
  return typeof name === "string" ? name.trim().slice(0, 40) : "";
}

/** @param {unknown} name @param {number} [index] */
export function normalizeSongName(name, index = 0) {
  const text = typeof name === "string" ? name.trim().slice(0, 40) : "";
  return text || defaultSongName(index);
}

/**
 * @param {unknown} value
 * @param {number} [index]
 * @param {number} [defaultFadeTime]
 * @returns {Cue | null}
 */
function normalizeCue(
  value,
  index = 0,
  defaultFadeTime = DEFAULT_CUE_FADE_TIME,
) {
  if (!value || typeof value !== "object") return null;
  const obj = /** @type {Record<string, unknown>} */ (value);
  const id =
    typeof obj.id === "string" && obj.id.trim()
      ? obj.id.trim()
      : newCueId();
  const levelsSource = Array.isArray(obj.levels) ? obj.levels : null;
  const levels = Array.from({ length: FADER_COUNT }, (_, i) => {
    const n = Math.round(Number(levelsSource?.[i] ?? 0));
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(255, n));
  });
  return {
    id,
    name: normalizeCueName(obj.name),
    levels,
    fadeTime: normalizeCueFadeTime(obj.fadeTime, defaultFadeTime),
  };
}

/**
 * @param {unknown} list
 * @param {number} [defaultFadeTime]
 * @returns {Cue[]}
 */
function normalizeCues(
  list,
  defaultFadeTime = DEFAULT_CUE_FADE_TIME,
) {
  const source = Array.isArray(list) ? list : [];
  /** @type {Cue[]} */
  const out = [];
  const seen = new Set();
  for (let i = 0; i < source.length && out.length < MAX_CUES; i++) {
    const raw = normalizeCue(source[i], i, defaultFadeTime);
    if (!raw) continue;
    let id = raw.id;
    while (seen.has(id)) id = newCueId();
    seen.add(id);
    out.push({
      id,
      name: raw.name,
      levels: raw.levels,
      fadeTime: raw.fadeTime,
    });
  }
  while (out.length < MIN_CUES) {
    out.push({
      id: newCueId(),
      name: "",
      levels: blankLevels(),
      fadeTime: normalizeCueFadeTime(undefined, defaultFadeTime),
    });
  }
  return out;
}

/**
 * @param {unknown} value
 * @param {number} [index]
 * @param {number} [defaultFadeTime]
 * @returns {Song | null}
 */
function normalizeSong(
  value,
  index = 0,
  defaultFadeTime = DEFAULT_CUE_FADE_TIME,
) {
  if (!value || typeof value !== "object") return null;
  const obj = /** @type {Record<string, unknown>} */ (value);
  const id =
    typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : newSongId();
  return {
    id,
    name: normalizeSongName(obj.name, index),
    cues: normalizeCues(obj.cues, defaultFadeTime),
  };
}

/**
 * @param {unknown} list
 * @param {number} [defaultFadeTime]
 * @returns {Song[]}
 */
export function normalizeSongs(
  list,
  defaultFadeTime = DEFAULT_CUE_FADE_TIME,
) {
  if (!Array.isArray(list) || list.length === 0) {
    return [createSong({ name: defaultSongName(0), defaultFadeTime })];
  }
  /** @type {Song[]} */
  const out = [];
  const seen = new Set();
  for (let i = 0; i < list.length && out.length < MAX_SONGS; i++) {
    const raw = normalizeSong(list[i], i, defaultFadeTime);
    if (!raw) continue;
    let id = raw.id;
    while (seen.has(id)) id = newSongId();
    seen.add(id);
    out.push({ id, name: raw.name, cues: raw.cues });
  }
  if (out.length === 0) {
    return [createSong({ name: defaultSongName(0), defaultFadeTime })];
  }
  return out;
}

/**
 * @param {{
 *   name?: string,
 *   cues?: Cue[],
 *   defaultFadeTime?: number,
 * }} [opts]
 * @returns {Song}
 */
export function createSong(opts = {}) {
  const defaultFadeTime = normalizeCueFadeTime(opts.defaultFadeTime);
  const cues =
    opts.cues && opts.cues.length >= MIN_CUES
      ? normalizeCues(opts.cues, defaultFadeTime)
      : normalizeCues(
          [
            {
              name: "",
              levels: blankLevels(),
              fadeTime: defaultFadeTime,
            },
            {
              name: "",
              levels: blankLevels(),
              fadeTime: defaultFadeTime,
            },
          ],
          defaultFadeTime,
        );
  return {
    id: newSongId(),
    name: normalizeSongName(opts.name, 0),
    cues,
  };
}

/**
 * @param {{ name?: string, levels?: number[], fadeTime?: number }} [opts]
 * @returns {Cue}
 */
export function createCue(opts = {}) {
  return {
    id: newCueId(),
    name: normalizeCueName(opts.name),
    levels: Array.from({ length: FADER_COUNT }, (_, i) => {
      const n = Math.round(Number(opts.levels?.[i] ?? 0));
      if (!Number.isFinite(n)) return 0;
      return Math.max(0, Math.min(255, n));
    }),
    fadeTime: normalizeCueFadeTime(opts.fadeTime),
  };
}

/**
 * @param {Song[]} songs
 * @param {string | null | undefined} activeSongId
 * @returns {Song}
 */
export function resolveActiveSong(songs, activeSongId) {
  // Return the song object from `songs` itself, not from a normalized copy:
  // the console edits the returned song's cues in place, and a copy
  // would make those edits (fader moves, …) miss the saved set.
  const list = Array.isArray(songs) && songs.length > 0 ? songs : normalizeSongs(songs);
  if (activeSongId) {
    const found = list.find((song) => song.id === activeSongId);
    if (found) return found;
  }
  return list[0];
}

/**
 * Reorder songs in place.
 * @param {Song[]} songs
 * @param {string} fromId
 * @param {string} toId
 * @param {boolean} after
 */
export function moveSong(songs, fromId, toId, after) {
  if (!fromId || !toId || fromId === toId) return false;
  const fromIndex = songs.findIndex((song) => song.id === fromId);
  const toIndex = songs.findIndex((song) => song.id === toId);
  if (fromIndex < 0 || toIndex < 0) return false;
  const [item] = songs.splice(fromIndex, 1);
  let insertAt = songs.findIndex((song) => song.id === toId);
  if (insertAt < 0) return false;
  if (after) insertAt += 1;
  songs.splice(insertAt, 0, item);
  return true;
}

/**
 * Reorder cues within a song.
 * @param {Song} song
 * @param {string} fromId
 * @param {string} toId
 * @param {boolean} after
 */
export function moveCue(song, fromId, toId, after) {
  if (!fromId || !toId || fromId === toId) return false;
  const list = song.cues;
  const fromIndex = list.findIndex((item) => item.id === fromId);
  const toIndex = list.findIndex((item) => item.id === toId);
  if (fromIndex < 0 || toIndex < 0) return false;
  const [item] = list.splice(fromIndex, 1);
  let insertAt = list.findIndex((entry) => entry.id === toId);
  if (insertAt < 0) return false;
  if (after) insertAt += 1;
  list.splice(insertAt, 0, item);
  return true;
}

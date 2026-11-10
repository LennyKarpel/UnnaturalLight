// Songs and their cues: limits, In times, creating, checking (as loaded) and
// reordering them. The show holds every song; sets point at them (sets.ts).
import { FADER_COUNT } from "./patch.ts";
import { newId } from "../shared/ids.ts";
import { isRecord } from "../shared/guards.ts";
import { clampByte } from "../shared/numbers.ts";

export const MAX_SONGS = 32;
export const MIN_CUES = 2;
/** Cues per song: no limit. */
export const MAX_CUES = Infinity;
/** Allowed fade-in seconds to arrive at a cue (GO): 0 (a snap) to 20. */
export const CUE_FADE_TIMES = Array.from({ length: 21 }, (_, i) => i);
export const DEFAULT_CUE_FADE_TIME = 4;

export type Cue = {
  id: string;
  name: string;
  levels: number[];
  fadeTime: number;
};
export type Song = {
  id: string;
  name: string;
  cues: Cue[];
};

/** The nearest allowed time (null if not a number). */
function cleanFadeTime(value: unknown): number | null {
  if (value === "" || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return CUE_FADE_TIMES.reduce((best, t) => (Math.abs(t - n) < Math.abs(best - n) ? t : best));
}

export function normalizeCueFadeTime(
  value: unknown,
  fallback = DEFAULT_CUE_FADE_TIME,
) {
  return cleanFadeTime(value) ?? cleanFadeTime(fallback) ?? DEFAULT_CUE_FADE_TIME;
}

function newSongId(): string {
  return newId("song");
}

function newCueId(): string {
  return newId("cue");
}

function blankLevels(): number[] {
  return Array.from({ length: FADER_COUNT }, () => 0);
}

export function defaultSongName(index: number) {
  return `Song ${index + 1}`;
}

// Cues are shown as "Cue <position>" plus an optional name (new cues have none).
function normalizeCueName(name: unknown) {
  return typeof name === "string" ? name.trim().slice(0, 40) : "";
}

export function normalizeSongName(name: unknown, index = 0) {
  const text = typeof name === "string" ? name.trim().slice(0, 40) : "";
  return text || defaultSongName(index);
}

function normalizeCue(
  value: unknown,
  index = 0,
  defaultFadeTime = DEFAULT_CUE_FADE_TIME,
): Cue | null {
  if (!isRecord(value)) return null;
  const obj = value;
  const id =
    typeof obj.id === "string" && obj.id.trim()
      ? obj.id.trim()
      : newCueId();
  const levelsSource = Array.isArray(obj.levels) ? obj.levels : null;
  const levels = Array.from({ length: FADER_COUNT }, (_, i) => {
    return clampByte(levelsSource?.[i] ?? 0);
  });
  return {
    id,
    name: normalizeCueName(obj.name),
    levels,
    fadeTime: normalizeCueFadeTime(obj.fadeTime, defaultFadeTime),
  };
}

function normalizeCues(
  list: unknown,
  defaultFadeTime = DEFAULT_CUE_FADE_TIME,
): Cue[] {
  const source = Array.isArray(list) ? list : [];
  const out: Cue[] = [];
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

function normalizeSong(
  value: unknown,
  index = 0,
  defaultFadeTime = DEFAULT_CUE_FADE_TIME,
): Song | null {
  if (!isRecord(value)) return null;
  const obj = value;
  const id =
    typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : newSongId();
  return {
    id,
    name: normalizeSongName(obj.name, index),
    cues: normalizeCues(obj.cues, defaultFadeTime),
  };
}

export function normalizeSongs(
  list: unknown,
  defaultFadeTime = DEFAULT_CUE_FADE_TIME,
): Song[] {
  if (!Array.isArray(list) || list.length === 0) {
    return [createSong({ name: defaultSongName(0), defaultFadeTime })];
  }
  const out: Song[] = [];
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

export function createSong(opts: {
  name?: string;
  cues?: Cue[];
  defaultFadeTime?: number;
} = {}): Song {
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

export function createCue(opts: { name?: string; levels?: number[]; fadeTime?: number } = {}): Cue {
  return {
    id: newCueId(),
    name: normalizeCueName(opts.name),
    levels: Array.from({ length: FADER_COUNT }, (_, i) => clampByte(opts.levels?.[i] ?? 0)),
    fadeTime: normalizeCueFadeTime(opts.fadeTime),
  };
}

export function resolveActiveSong(songs: Song[], activeSongId: string | null | undefined): Song {
  // Return the song object from `songs` itself, not from a normalized copy:
  // the console edits the returned song's cues in place, and a copy
  // would make those edits (fader moves, …) miss the saved show.
  const list = Array.isArray(songs) && songs.length > 0 ? songs : normalizeSongs(songs);
  if (activeSongId) {
    const found = list.find((song) => song.id === activeSongId);
    if (found) return found;
  }
  return list[0];
}

/** Reorder songs in place. */
export function moveSong(songs: Song[], fromId: string, toId: string, after: boolean) {
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

/** Reorder cues within a song. */
export function moveCue(song: Song, fromId: string, toId: string, after: boolean) {
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

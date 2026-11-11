// Songs and their cues: limits, In times, creating, checking (as loaded) and
// reordering them. The show holds every song; sets point at them (sets.ts).
import { FADER_COUNT } from "./patch.ts";
import { newId } from "../shared/ids.ts";
import { isRecord } from "../shared/guards.ts";
import { clampByte } from "../shared/numbers.ts";
import type { StepPath } from "../shared/engine.ts";

export const MAX_SONGS = 32;
export const MIN_CUES = 2;
/** Cues per song: no limit. */
export const MAX_CUES = Infinity;
/** Allowed fade-in seconds to arrive at a cue (GO): 0 (a snap) to 20. */
export const CUE_FADE_TIMES = Array.from({ length: 21 }, (_, i) => i);
export const DEFAULT_CUE_FADE_TIME = 4;

/** Steps a cue can have before its own look. */
export const MAX_CUE_STEPS = 15;

/**
 * A cue's look: fader levels, and the fixtures it aims at named stage
 * positions (see aims.ts). A cue is one; so is each of its steps.
 */
export type Look = { levels: number[]; aims: CueAim[] };

/**
 * A look GO passes through on the way into a cue: it fades in over
 * `fadeTime`, stays `holdTime`, then the next step (or the cue's own look)
 * fades in. Seconds, as CUE_FADE_TIMES.
 */
export type CueStep = Look & { id: string; fadeTime: number; holdTime: number };

/**
 * A cue: its own look (where GO arrives and stays), its In time, and the steps
 * GO passes through first (none for most cues). The steps play in order, then
 * the cue's own look fades in over `fadeTime`.
 */
export type Cue = Look & {
  id: string;
  name: string;
  fadeTime: number;
  steps: CueStep[];
};
/** In a cue: console fixture `fixture`'s pan / tilt aim at stage position `position`. */
export type CueAim = { fixture: string; position: string };

function normalizeAims(value: unknown): CueAim[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((a) => {
    if (!isRecord(a) || typeof a.fixture !== "string" || typeof a.position !== "string" || seen.has(a.fixture)) return [];
    seen.add(a.fixture);
    return [{ fixture: a.fixture, position: a.position }];
  });
}
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

function newStepId(): string {
  return newId("step");
}

const copyAims = (aims: CueAim[]) => aims.map((a) => ({ ...a }));
const copyLevels = (levels: readonly number[] | undefined) => Array.from({ length: FADER_COUNT }, (_, i) => clampByte(levels?.[i] ?? 0));

/** A new step: a copy of `look` (its levels and aims), with these times. */
export function createStep(look: Partial<Look> = {}, fadeTime = DEFAULT_CUE_FADE_TIME, holdTime = 0): CueStep {
  return { id: newStepId(), levels: copyLevels(look.levels), aims: copyAims(look.aims ?? []), fadeTime: normalizeCueFadeTime(fadeTime), holdTime: normalizeCueFadeTime(holdTime, 0) };
}

/** Steps as loaded: each with a unique id (among `seen`), levels, aims and times. */
function normalizeSteps(value: unknown, seen: Set<string>): CueStep[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_CUE_STEPS).flatMap((raw) => {
    if (!isRecord(raw)) return [];
    let id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : newStepId();
    while (seen.has(id)) id = newStepId();
    seen.add(id);
    const levels = Array.isArray(raw.levels) ? raw.levels : [];
    return [{ id, levels: copyLevels(levels), aims: normalizeAims(raw.aims), fadeTime: normalizeCueFadeTime(raw.fadeTime), holdTime: normalizeCueFadeTime(raw.holdTime, 0) }];
  });
}

/** A cue's look and its steps' looks (everything that holds levels and aims). */
export const looksOf = (cue: Cue): Look[] => [...cue.steps, cue];

/** How long GO into `cue` takes: its steps' fades and holds, then its own fade (seconds). */
export const cueSeconds = (cue: Cue): number => cue.steps.reduce((t, s) => t + s.fadeTime + s.holdTime, 0) + cue.fadeTime;

/**
 * The look shown for a cue that's LIVE on step `step` (-1, or no such step:
 * the cue's own look).
 */
export const stepLook = (cue: Cue, step: number): Look => cue.steps[step] ?? cue;

/** A song's cues' levels as shown: the LIVE cue's (`fromCue`) are its step `liveStep`'s. */
export const shownLevels = (cues: Cue[], fromCue: number, liveStep: number): number[][] => cues.map((c, r) => (r === fromCue ? stepLook(c, liveStep) : c).levels);

/** `liveStep` kept to a step `cue` has (-1: its own look). */
export const clampStep = (cue: Cue | undefined, step: number): number => (Number.isInteger(step) && step >= 0 && step < (cue?.steps.length ?? 0) ? step : -1);

/** The steps a GO into `cue` passes through, for the output math (null: none). */
export const stepPath = (cue: Cue | undefined): StepPath | null =>
  cue?.steps.length ? { steps: cue.steps.map((s) => ({ levels: s.levels, fade: s.fadeTime, hold: s.holdTime })), fade: cue.fadeTime } : null;

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

/** A cue as loaded, its steps still to check (normalizeSteps). */
function normalizeCue(value: unknown, defaultFadeTime = DEFAULT_CUE_FADE_TIME): (Omit<Cue, "steps"> & { steps: unknown[] }) | null {
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
    aims: normalizeAims(obj.aims),
    steps: Array.isArray(obj.steps) ? (obj.steps as unknown[]) : [],
  };
}

function normalizeCues(
  list: unknown,
  defaultFadeTime = DEFAULT_CUE_FADE_TIME,
): Cue[] {
  const source = Array.isArray(list) ? list : [];
  const out: Cue[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < source.length && out.length < MAX_CUES; i++) {
    const raw = normalizeCue(source[i], defaultFadeTime);
    if (!raw) continue;
    let id = raw.id;
    while (seen.has(id)) id = newCueId();
    seen.add(id);
    out.push({
      id,
      name: raw.name,
      levels: raw.levels,
      fadeTime: raw.fadeTime,
      aims: raw.aims,
      steps: normalizeSteps(raw.steps, seen),
    });
  }
  while (out.length < MIN_CUES) {
    out.push({
      id: newCueId(),
      name: "",
      levels: blankLevels(),
      fadeTime: normalizeCueFadeTime(undefined, defaultFadeTime),
      aims: [],
      steps: [],
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

/** A new cue; `steps` are copied (with new ids). */
export function createCue(opts: { name?: string; levels?: number[]; fadeTime?: number; aims?: CueAim[]; steps?: CueStep[] } = {}): Cue {
  return {
    id: newCueId(),
    name: normalizeCueName(opts.name),
    levels: copyLevels(opts.levels),
    fadeTime: normalizeCueFadeTime(opts.fadeTime),
    aims: copyAims(opts.aims ?? []),
    steps: (opts.steps ?? []).slice(0, MAX_CUE_STEPS).map((s) => createStep(s, s.fadeTime, s.holdTime)),
  };
}

/** A copy of `cue` (name, look, In time, steps) with new ids. */
export const copyCue = (cue: Cue): Cue => createCue(cue);

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

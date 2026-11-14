// Sets: the show's running orders, one per event. A set lists songs from the
// show (an entry points at a song, so a song can be in many sets, or twice in
// one); the Run tab runs the active set.
import { newId } from "../shared/ids.ts";
import { cueSeconds, resolveActiveSong, stepPath, type Cue, type Song } from "./songs.ts";
import type { StepPath } from "../shared/engine.ts";
import { isRecord } from "../shared/guards.ts";

export const MAX_SETS = 32;
export const MAX_SET_ENTRIES = 100;

export type SetEntry = { id: string; songId: string };
export type ShowSet = { id: string; name: string; entries: SetEntry[] };

export function defaultSetName(index: number) {
  return `Set ${index + 1}`;
}

export function normalizeSetName(name: unknown, index = 0) {
  const text = typeof name === "string" ? name.trim().slice(0, 40) : "";
  return text || defaultSetName(index);
}

export function createEntry(songId: string): SetEntry {
  return { id: newId("entry"), songId };
}

export function createSet(opts: { name?: string; songIds?: string[] } = {}): ShowSet {
  return {
    id: newId("set"),
    name: normalizeSetName(opts.name),
    entries: (opts.songIds ?? []).slice(0, MAX_SET_ENTRIES).map(createEntry),
  };
}

/**
 * Sets as saved, keeping only entries whose song is in `songs`. No sets: one
 * set with every song.
 */
export function normalizeSets(list: unknown, songs: Song[]): ShowSet[] {
  const songIds = new Set(songs.map((song) => song.id));
  const out: ShowSet[] = [];
  const seen = new Set();
  const source = Array.isArray(list) ? list : [];
  for (let i = 0; i < source.length && out.length < MAX_SETS; i++) {
    const raw = source[i];
    if (!isRecord(raw)) continue;
    let id = typeof raw.id === "string" && raw.id ? raw.id : newId("set");
    while (seen.has(id)) id = newId("set");
    seen.add(id);
    const entries: SetEntry[] = [];
    for (const entry of Array.isArray(raw.entries) ? raw.entries : []) {
      if (entries.length >= MAX_SET_ENTRIES) break;
      if (!entry || !songIds.has(entry.songId)) continue;
      let entryId = typeof entry.id === "string" && entry.id ? entry.id : newId("entry");
      while (seen.has(entryId)) entryId = newId("entry");
      seen.add(entryId);
      entries.push({ id: entryId, songId: entry.songId });
    }
    out.push({ id, name: normalizeSetName(raw.name, out.length), entries });
  }
  if (out.length === 0) {
    out.push(createSet({ name: defaultSetName(0), songIds: songs.map((song) => song.id) }));
  }
  return out;
}

/** The set itself (not a copy: the console edits it in place). */
export function resolveActiveSet(sets: ShowSet[], activeSetId: string | null | undefined): ShowSet {
  return sets.find((set) => set.id === activeSetId) ?? sets[0];
}

/**
 * The entry playing in `set`: `activeEntryId` if it's there and still points
 * at the active song, else null (the song is played from outside the set).
 */
export function resolveActiveEntry(set: ShowSet, activeEntryId: string | null | undefined, activeSongId: string): SetEntry | null {
  const entry = set.entries.find((item) => item.id === activeEntryId);
  return entry && entry.songId === activeSongId ? entry : null;
}

/** The entry after `entryId` in the set, or null (last, or not in the set). */
function nextEntry(set: ShowSet, entryId: string | null | undefined): SetEntry | null {
  const index = set.entries.findIndex((item) => item.id === entryId);
  return index < 0 ? null : (set.entries[index + 1] ?? null);
}

export type Playback = {
  songs: Song[];
  sets: ShowSet[];
  activeSetId: string | null;
  activeEntryId: string | null;
  activeSongId: string;
  fromCue: number;
};

/** The entry after the playing one in the active set, with its song, or null. */
export function nextSetSong(play: Playback) {
  const set = resolveActiveSet(play.sets, play.activeSetId);
  const entry = resolveActiveEntry(set, play.activeEntryId, play.activeSongId);
  const next = entry ? nextEntry(set, entry.id) : null;
  const song = next ? play.songs.find((item) => item.id === next.songId) : null;
  return next && song ? { entry: next, song } : null;
}

/** The entry before the playing one in the active set, with its song, or null (first, or played from outside the set). */
export function previousSetSong(play: Playback) {
  const set = resolveActiveSet(play.sets, play.activeSetId);
  const entry = resolveActiveEntry(set, play.activeEntryId, play.activeSongId);
  const index = entry ? set.entries.indexOf(entry) : -1;
  const prev = index > 0 ? set.entries[index - 1] : null;
  const song = prev ? play.songs.find((item) => item.id === prev.songId) : null;
  return prev && song ? { entry: prev, song } : null;
}

/**
 * The cue UP NEXT after LIVE (`fromCue`): the following cue in the song. After
 * the song's last cue: in the set, the next song's first cue (its index is the
 * song's cue count) or, after the set's last song, nothing (= `fromCue`);
 * played from outside the set, back to the song's first cue.
 */
export function upNextCue(play: Playback) {
  const song = resolveActiveSong(play.songs, play.activeSongId);
  const n = song.cues.length;
  const from = Math.min(Math.max(0, play.fromCue), n - 1);
  if (from < n - 1) return from + 1;
  const set = resolveActiveSet(play.sets, play.activeSetId);
  if (resolveActiveEntry(set, play.activeEntryId, song.id)) {
    return nextSetSong(play) ? n : from;
  }
  return 0;
}

/**
 * The cue at `index` in the active song, or past its last cue the next set
 * song's first cue (undefined if none).
 */
export function playbackCue(play: Playback, index: number) {
  const song = resolveActiveSong(play.songs, play.activeSongId);
  if (index < song.cues.length) return song.cues[index];
  return index === song.cues.length ? nextSetSong(play)?.song.cues[0] : undefined;
}

/**
 * Where GO (or Step) fades to from LIVE. LIVE on one of its cue's steps: the
 * rest of that cue (Step: its next look). LIVE on a cue's own look: UP NEXT
 * (Step, when UP NEXT has steps: its first). `cue` / `step` is where it
 * arrives (the cue's index, and its step or -1 for its own look); `levels`
 * the look faded to; `path` the steps passed through on the way; `seconds`
 * its time; `at` / `total` where it starts in the cue's own time and that
 * cue's whole time (for its timeline). null: nothing to go to.
 */
export type GoTarget = { cue: number; step: number; levels: number[]; path: StepPath | null; seconds: number; at: number; total: number; looks: number; first: number };

export function goTarget(play: Playback & { liveStep: number; toCue: number }, step = false): GoTarget | null {
  const live = playbackCue(play, play.fromCue);
  const k = play.liveStep;
  if (live && k >= 0 && k < live.steps.length) {
    // The rest of the LIVE cue: from step k (once its hold is over).
    const at = live.steps.slice(0, k + 1).reduce((t, s) => t + s.fadeTime + s.holdTime, 0);
    const base = { cue: play.fromCue, at, total: cueSeconds(live), looks: live.steps.length + 1, first: k + 1 };
    const next = live.steps[k + 1];
    if (step && next) return { ...base, step: k + 1, levels: next.levels, path: null, seconds: next.fadeTime };
    const rest = live.steps.slice(k + 1);
    const path = rest.length ? { steps: rest.map((s) => ({ levels: s.levels, fade: s.fadeTime, hold: s.holdTime })), fade: live.fadeTime } : null;
    return { ...base, step: -1, levels: live.levels, path, seconds: base.total - at };
  }
  if (play.toCue === play.fromCue) return null;
  const next: Cue | undefined = playbackCue(play, play.toCue);
  if (!next) return null;
  const base = { cue: play.toCue, at: 0, total: cueSeconds(next), looks: next.steps.length + 1, first: 0 };
  if (step && next.steps.length) return { ...base, step: 0, levels: next.steps[0].levels, path: null, seconds: next.steps[0].fadeTime };
  return { ...base, step: -1, levels: next.levels, path: stepPath(next), seconds: base.total };
}

/**
 * Levels of the cues GO can fade between: the active song's, plus the next
 * set song's first cue at the end (the same arrays, so edits land in the
 * songs).
 * @param play the show's playback (its set, songs and active song)
 * @param cueLevels the active song's
 */
export function playbackLevels(play: Playback, cueLevels: number[][]) {
  const next = nextSetSong(play);
  return next ? [...cueLevels, next.song.cues[0].levels] : cueLevels;
}

/** Reorder a set's entries in place. */
export function moveEntry(set: ShowSet, fromId: string, toId: string, after: boolean) {
  if (!fromId || !toId || fromId === toId) return false;
  const list = set.entries;
  const fromIndex = list.findIndex((item) => item.id === fromId);
  if (fromIndex < 0 || list.findIndex((item) => item.id === toId) < 0) return false;
  const [item] = list.splice(fromIndex, 1);
  let insertAt = list.findIndex((entry) => entry.id === toId);
  if (after) insertAt += 1;
  list.splice(insertAt, 0, item);
  return true;
}

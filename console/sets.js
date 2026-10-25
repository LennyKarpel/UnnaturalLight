// Sets: the show's running orders, one per event. A set lists songs from the
// show (an entry points at a song, so a song can be in many sets, or twice in
// one); the Run page runs the active set.
import { newId } from "../shared/ids.js";
import { resolveActiveSong } from "./songs.js";

export const MAX_SETS = 32;
export const MAX_SET_ENTRIES = 100;

/**
 * @typedef {{ id: string, songId: string }} SetEntry
 * @typedef {{ id: string, name: string, entries: SetEntry[] }} ShowSet
 */

/** @param {number} index */
export function defaultSetName(index) {
  return `Set ${index + 1}`;
}

/** @param {unknown} name @param {number} [index] */
export function normalizeSetName(name, index = 0) {
  const text = typeof name === "string" ? name.trim().slice(0, 40) : "";
  return text || defaultSetName(index);
}

/** @param {string} songId @returns {SetEntry} */
export function createEntry(songId) {
  return { id: newId("entry"), songId };
}

/**
 * @param {{ name?: string, songIds?: string[] }} [opts]
 * @returns {ShowSet}
 */
export function createSet(opts = {}) {
  return {
    id: newId("set"),
    name: normalizeSetName(opts.name),
    entries: (opts.songIds ?? []).slice(0, MAX_SET_ENTRIES).map(createEntry),
  };
}

/**
 * Sets as saved, keeping only entries whose song is in `songs`. No sets: one
 * set with every song.
 * @param {unknown} list
 * @param {import("./songs.js").Song[]} songs
 * @returns {ShowSet[]}
 */
export function normalizeSets(list, songs) {
  const songIds = new Set(songs.map((song) => song.id));
  /** @type {ShowSet[]} */
  const out = [];
  const seen = new Set();
  const source = Array.isArray(list) ? list : [];
  for (let i = 0; i < source.length && out.length < MAX_SETS; i++) {
    const raw = source[i];
    if (!raw || typeof raw !== "object") continue;
    let id = typeof raw.id === "string" && raw.id ? raw.id : newId("set");
    while (seen.has(id)) id = newId("set");
    seen.add(id);
    /** @type {SetEntry[]} */
    const entries = [];
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

/**
 * The set itself (not a copy: the console edits it in place).
 * @param {ShowSet[]} sets
 * @param {string | null | undefined} activeSetId
 * @returns {ShowSet}
 */
export function resolveActiveSet(sets, activeSetId) {
  return sets.find((set) => set.id === activeSetId) ?? sets[0];
}

/**
 * The entry playing in `set`: `activeEntryId` if it's there and still points
 * at the active song, else null (the song is played from outside the set).
 * @param {ShowSet} set
 * @param {string | null | undefined} activeEntryId
 * @param {string} activeSongId
 * @returns {SetEntry | null}
 */
export function resolveActiveEntry(set, activeEntryId, activeSongId) {
  const entry = set.entries.find((item) => item.id === activeEntryId);
  return entry && entry.songId === activeSongId ? entry : null;
}

/**
 * The entry after `entryId` in the set, or null (last, or not in the set).
 * @param {ShowSet} set
 * @param {string | null | undefined} entryId
 * @returns {SetEntry | null}
 */
export function nextEntry(set, entryId) {
  const index = set.entries.findIndex((item) => item.id === entryId);
  return index < 0 ? null : (set.entries[index + 1] ?? null);
}

/**
 * @typedef {{
 *   songs: import("./songs.js").Song[],
 *   sets: ShowSet[],
 *   activeSetId: string | null,
 *   activeEntryId: string | null,
 *   activeSongId: string,
 *   fromCue: number,
 * }} Playback
 */

/** The entry after the playing one in the active set, with its song, or null. */
export function nextSetSong(/** @type {Playback} */ play) {
  const set = resolveActiveSet(play.sets, play.activeSetId);
  const entry = resolveActiveEntry(set, play.activeEntryId, play.activeSongId);
  const next = entry ? nextEntry(set, entry.id) : null;
  const song = next ? play.songs.find((item) => item.id === next.songId) : null;
  return next && song ? { entry: next, song } : null;
}

/**
 * The cue UP NEXT after LIVE (`fromCue`): the following cue in the song. After
 * the song's last cue: in the set, the next song's first cue (its index is the
 * song's cue count) or, after the set's last song, nothing (= `fromCue`);
 * played from outside the set, back to the song's first cue.
 * @param {Playback} play
 */
export function upNextCue(play) {
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
 * @param {Playback} play
 * @param {number} index
 */
export function playbackCue(play, index) {
  const song = resolveActiveSong(play.songs, play.activeSongId);
  if (index < song.cues.length) return song.cues[index];
  return index === song.cues.length ? nextSetSong(play)?.song.cues[0] : undefined;
}

/**
 * Levels of the cues GO can fade between: the active song's, plus the next
 * set song's first cue at the end (the same arrays, so edits land in the
 * songs).
 * @param {Playback} play
 * @param {number[][]} cueLevels the active song's
 */
export function playbackLevels(play, cueLevels) {
  const next = nextSetSong(play);
  return next ? [...cueLevels, next.song.cues[0].levels] : cueLevels;
}

/**
 * Reorder a set's entries in place.
 * @param {ShowSet} set
 * @param {string} fromId
 * @param {string} toId
 * @param {boolean} after
 */
export function moveEntry(set, fromId, toId, after) {
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

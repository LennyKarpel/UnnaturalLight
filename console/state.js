// The console's state: the show being worked on (from the autosaved
// session at first), the active song's cues, and the status line.
import { FADER_COUNT, defaultPatch, setUniverseCount } from "./patch.js";
import { normalizeFixtureGroups, normalizeFixtures } from "./fixtures.js";
import {
  DEFAULT_NAV_ORDER,
  defaultShowName,
  loadSession,
  normalizeFaderNames,
  normalizeNavOrder,
  normalizeShowName,
  saveSession,
  showSnapshot,
  normalizeUniverses,
} from "./show.js";
import {
  defaultSongName,
  createSong,
  normalizeSongs,
  resolveActiveSong,
} from "./songs.js";
import {
  normalizeSets,
  nextSetSong,
  playbackLevels,
  resolveActiveEntry,
  resolveActiveSet,
  upNextCue,
} from "./sets.js";

export function zeros() {
  return new Array(FADER_COUNT).fill(0);
}

/** @param {string} [showName] */
export function blankShowState(showName = defaultShowName()) {
  const song = createSong({ name: defaultSongName(0) });
  const sets = normalizeSets(null, [song]);
  return {
    showName: normalizeShowName(showName),
    navOrder: [...DEFAULT_NAV_ORDER],
    master: 100,
    cross: 0,
    universes: 1,
    fromSub: 100,
    toSub: 100,
    fromCue: 0,
    toCue: 1,
    selectedCue: 0,
    songs: [song],
    activeSongId: song.id,
    sets,
    activeSetId: sets[0].id,
    activeEntryId: sets[0].entries[0].id,
    faderNames: normalizeFaderNames(null),
    fixtureGroups: [],
    fixtures: [],
    patch: defaultPatch(),
  };
}

function initialState() {
  const session = loadSession();
  if (session) return session;
  return blankShowState();
}

const boot = initialState();

const bootSongs = normalizeSongs(boot.songs);
const bootGroups = normalizeFixtureGroups(boot.fixtureGroups);
const bootSets = normalizeSets(boot.sets, bootSongs);

/** The console's working show and the UI state its pages share. */
export const state = {
  /** Link to the show server (created once the page is set up, at the end of app.js). */
  /** @type {ReturnType<typeof createServerLink> | null} */
  serverLink: null,
  /** DMX output per universe as the show server reports it (index 0 = universe 1). */
  outputStatus: [],
  /** @type {string} */
  showName: normalizeShowName(boot.showName),
  /** @type {string[]} */
  navOrder: normalizeNavOrder(boot.navOrder),
  /** Universes in this show (1…MAX_UNIVERSES); channels go up to universes × 512. */
  universes: normalizeUniverses(boot.universes),
  /** @type {import("./songs.js").Song[]} */
  songs: bootSongs,
  /** @type {string} */
  activeSongId: resolveActiveSong(bootSongs, boot.activeSongId).id,
  /** The show's sets; the Run page runs the active one. */
  /** @type {import("./sets.js").ShowSet[]} */
  sets: bootSets,
  /** @type {string} */
  activeSetId: resolveActiveSet(bootSets, boot.activeSetId).id,
  /** The active set's entry that's playing; null = a song played from outside the set. */
  /** @type {string | null} */
  activeEntryId: boot.activeEntryId ?? null,
  /** The active song's cues: each one's levels (the same arrays) and name. */
  /** @type {number[][]} */
  cueLevels: [],
  /** @type {string[]} */
  cueNames: [],
  /** @type {string[]} */
  faderNames: normalizeFaderNames(boot.faderNames),
  /** @type {import("./fixtures.js").FixtureGroup[]} */
  fixtureGroups: bootGroups,
  /** @type {import("./fixtures.js").Fixture[]} */
  fixtures: normalizeFixtures(boot.fixtures, bootGroups),
  /** @type {string | null} */
  fixtureFormGroupId: null,
  patch: boot.patch,
  master: boot.master,
  cross: boot.cross, // 0 = full From, 100 = full To
  fromSub: boot.fromSub ?? 100,
  toSub: boot.toSub ?? 100,
  fromCue: boot.fromCue,
  toCue: boot.toCue,
  selectedCue: boot.selectedCue ?? 0,
  /** @type {number} */
  selectedFader: 0,
  /** The show server's timed fade (it runs there): null = none. */
  /** @type {null | { paused: boolean }} */
  fadeState: null,
  /** @type {number | null} */
  masterBlackoutSnapshot: null,
  /** @type {number | null} */
  fromSubBlackoutSnapshot: null,
  /** @type {number | null} */
  toSubBlackoutSnapshot: null,
  // The show name, show buttons, DMX outputs and status are drawn in the header
  // of the page around the console (../index.html), which calls consoleHeader
  // (app.js) and is told (notifyHeader) when any of it changes.
  /** Last status message (state: idle | connected | error). */
  status: { text: "", state: "idle" },
  serverLive: false,
  /** Dimmer faders blacked out / flashed on any console, as the show server last reported. */
  serverBlackedOut: new Set(),
  serverFlashing: new Set(),
  /** Universe shown by the Channels-tab meters. */
  meterUniverse: 1,
};

setUniverseCount(state.universes);

export function getActiveSong() {
  return resolveActiveSong(state.songs, state.activeSongId);
}

export function getActiveSet() {
  return resolveActiveSet(state.sets, state.activeSetId);
}

/** The active set's entry that's playing, or null (playing from outside the set). */
export function getActiveEntry() {
  return resolveActiveEntry(getActiveSet(), state.activeEntryId, state.activeSongId);
}

/** The next set song (its entry and song), or null. */
export function getNextSetSong() {
  return nextSetSong(state);
}

/**
 * Levels GO fades between: the song's cues, plus the next set song's first cue
 * when that's UP NEXT (otherwise just the song's, with nothing to look up).
 */
export function getPlaybackLevels() {
  return state.toCue < state.cueLevels.length ? state.cueLevels : playbackLevels(state, state.cueLevels);
}

/** Rebind cueLevels / cueNames to the active song and clamp LIVE / UP NEXT / selected indices. */
export function bindActiveSong() {
  const song = getActiveSong();
  state.activeSongId = song.id;
  state.activeSetId = getActiveSet().id;
  state.activeEntryId = getActiveEntry()?.id ?? null;
  state.cueLevels = song.cues.map((t) => t.levels);
  state.cueNames = song.cues.map((t) => t.name);
  const n = state.cueLevels.length;
  state.selectedCue = Math.min(Math.max(0, state.selectedCue), Math.max(0, n - 1));
  state.fromCue = Math.min(Math.max(0, state.fromCue), Math.max(0, n - 1));
  syncPlaybackPair();
}

/** UP NEXT follows LIVE: the next cue in the song, or the next set song's first (see upNextCue). */
export function syncPlaybackPair() {
  const n = state.cueLevels.length;
  state.fromCue = Math.min(Math.max(0, state.fromCue), n - 1);
  state.toCue = upNextCue(state);
}

bindActiveSong();

/** @type {Set<() => void>} */
export const headerListeners = new Set();
export const notifyHeader = () => { for (const fn of headerListeners) fn(); };

/** Snapshot of last explicitly saved/loaded show (or boot state). */
let cleanSnapshot = "";

export function setStatus(text, kind = "idle") {
  state.status = { text, state: kind };
  notifyHeader();
}

export function persistSession() {
  saveSession(currentShowState());
  state.serverLink?.sync();
}

export function currentShowState() {
  // Keep cue names in sync (cueLevels shares the level arrays already).
  const song = getActiveSong();
  for (let i = 0; i < song.cues.length; i++) {
    if (typeof state.cueNames[i] === "string") song.cues[i].name = state.cueNames[i];
  }
  return {
    showName: state.showName,
    navOrder: state.navOrder,
    master: state.master,
    cross: state.cross,
    fromSub: state.fromSub,
    toSub: state.toSub,
    universes: state.universes,
    fromCue: state.fromCue,
    toCue: state.toCue,
    selectedCue: state.selectedCue,
    songs: state.songs,
    activeSongId: state.activeSongId,
    sets: state.sets,
    activeSetId: state.activeSetId,
    activeEntryId: state.activeEntryId,
    faderNames: state.faderNames,
    fixtureGroups: state.fixtureGroups,
    fixtures: state.fixtures,
    patch: state.patch,
  };
}

export function markClean() {
  cleanSnapshot = showSnapshot(currentShowState());
}

export function isDirty() {
  return showSnapshot(currentShowState()) !== cleanSnapshot;
}

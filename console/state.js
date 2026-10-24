// The console's state: the set being worked on (from the autosaved
// session at first), the active song's cues, and the status line.
import { FADER_COUNT, defaultPatch, setUniverseCount } from "./patch.js";
import { normalizeFixtureGroups, normalizeFixtures } from "./fixtures.js";
import {
  DEFAULT_NAV_ORDER,
  defaultSetName,
  loadSession,
  normalizeFaderNames,
  normalizeNavOrder,
  normalizeSetName,
  saveSession,
  setSnapshot,
  normalizeUniverses,
} from "./set.js";
import {
  defaultSongName,
  createSong,
  normalizeSongs,
  resolveActiveSong,
} from "./songs.js";

export function zeros() {
  return new Array(FADER_COUNT).fill(0);
}

/** @param {string} [setName] */
export function blankSetState(setName = defaultSetName()) {
  const song = createSong({ name: defaultSongName(0) });
  return {
    setName: normalizeSetName(setName),
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
    faderNames: normalizeFaderNames(null),
    fixtureGroups: [],
    fixtures: [],
    patch: defaultPatch(),
  };
}

function initialState() {
  const session = loadSession();
  if (session) return session;
  return blankSetState();
}

const boot = initialState();

const bootSongs = normalizeSongs(boot.songs);
const bootGroups = normalizeFixtureGroups(boot.fixtureGroups);

/** The console's working set and the UI state its pages share. */
export const state = {
  /** Link to the show server (created once the page is set up, at the end of app.js). */
  /** @type {ReturnType<typeof createServerLink> | null} */
  serverLink: null,
  /** DMX output per universe as the show server reports it (index 0 = universe 1). */
  outputStatus: [],
  /** @type {string} */
  setName: normalizeSetName(boot.setName),
  /** @type {string[]} */
  navOrder: normalizeNavOrder(boot.navOrder),
  /** Universes in this set (1…MAX_UNIVERSES); channels go up to universes × 512. */
  universes: normalizeUniverses(boot.universes),
  /** @type {import("./songs.js").Song[]} */
  songs: bootSongs,
  /** @type {string} */
  activeSongId: resolveActiveSong(bootSongs, boot.activeSongId).id,
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
  // The set name, set buttons, DMX outputs and status are drawn in the header
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

/** Rebind cueLevels / cueNames to the active song and clamp Current/Next/selected indices. */
export function bindActiveSong() {
  const song = getActiveSong();
  state.activeSongId = song.id;
  state.cueLevels = song.cues.map((t) => t.levels);
  state.cueNames = song.cues.map((t) => t.name);
  const n = state.cueLevels.length;
  state.selectedCue = Math.min(Math.max(0, state.selectedCue), Math.max(0, n - 1));
  state.fromCue = Math.min(Math.max(0, state.fromCue), Math.max(0, n - 1));
  syncPlaybackPair();
}

/** Next is always the following cue in song order (wraps). */
export function syncPlaybackPair() {
  const n = state.cueLevels.length;
  if (n < 2) {
    state.toCue = state.fromCue;
    return;
  }
  state.fromCue = Math.min(Math.max(0, state.fromCue), n - 1);
  state.toCue = (state.fromCue + 1) % n;
}

bindActiveSong();

/** @type {Set<() => void>} */
export const headerListeners = new Set();
export const notifyHeader = () => { for (const fn of headerListeners) fn(); };

/** Snapshot of last explicitly saved/loaded set (or boot state). */
let cleanSnapshot = "";

export function setStatus(text, kind = "idle") {
  state.status = { text, state: kind };
  notifyHeader();
}

export function persistSession() {
  saveSession(currentSetState());
  state.serverLink?.sync();
}

export function currentSetState() {
  // Keep cue names in sync (cueLevels shares the level arrays already).
  const song = getActiveSong();
  for (let i = 0; i < song.cues.length; i++) {
    if (typeof state.cueNames[i] === "string") song.cues[i].name = state.cueNames[i];
  }
  return {
    setName: state.setName,
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
    faderNames: state.faderNames,
    fixtureGroups: state.fixtureGroups,
    fixtures: state.fixtures,
    patch: state.patch,
  };
}

export function markClean() {
  cleanSnapshot = setSnapshot(currentSetState());
}

export function isDirty() {
  return setSnapshot(currentSetState()) !== cleanSnapshot;
}

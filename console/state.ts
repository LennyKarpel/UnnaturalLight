// The console's state: the show being worked on (from the autosaved
// session at first), the active song's cues, and the status line.
import { FADER_COUNT, defaultPatch, setUniverseCount, type FaderPatch } from "./patch.ts";
import { normalizeFixtureGroups, normalizeFixtures, type Fixture, type FixtureGroup } from "./fixtures.ts";
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
  type ShowData,
} from "./show.ts";
import { clampStep, defaultSongName, createSong, normalizeSongs, resolveActiveSong, shownLevels, type Song } from "./songs.ts";
import {
  normalizeSets,
  nextSetSong,
  playbackLevels,
  resolveActiveEntry,
  resolveActiveSet,
  upNextCue,
  type ShowSet,
} from "./sets.ts";
import { must } from "../shared/query.ts";
import { notifyStage } from "./stage-link.ts";
import type { ServerLink } from "./server-link.ts";
import type { OutputStatus } from "../shared/protocol.ts";
import { clamp } from "../shared/numbers.ts";
import type { FadeInfo } from "../server/show.ts";

export function zeros(): number[] {
  return new Array(FADER_COUNT).fill(0);
}

export function blankShowState(showName: string = defaultShowName()): ShowData {
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
    liveStep: -1,
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

export type StatusKind = "idle" | "connected" | "error";

/** The console's working show and the UI state its tabs share. */
export type ConsoleState = {
  /** Link to the show server (created once the page is set up, at the end of app.ts). */
  serverLink: ServerLink | null;
  /** DMX output per universe as the show server reports it (index 0 = universe 1). */
  outputStatus: OutputStatus[];
  showName: string;
  navOrder: string[];
  /** Universes in this show (1…MAX_UNIVERSES); channels go up to universes × 512. */
  universes: number;
  songs: Song[];
  activeSongId: string;
  /** The show's sets; the Run tab runs the active one. */
  sets: ShowSet[];
  activeSetId: string;
  activeEntryId: string | null;
  cueLevels: number[][];
  cueNames: string[];
  faderNames: string[];
  fixtureGroups: FixtureGroup[];
  fixtures: Fixture[];
  fixtureFormGroupId: string | null;
  patch: FaderPatch[];
  master: number;
  /** 0 = full From, 100 = full To. */
  cross: number;
  fromSub: number;
  toSub: number;
  fromCue: number;
  toCue: number;
  selectedCue: number;
  /** The LIVE cue's step shown and edited (-1: its own look). Its row in cueLevels is that step's levels. */
  liveStep: number;
  selectedFader: number;
  /** The show server's timed fade (it runs there): null = none. */
  fadeState: FadeInfo | null;
  /** Last status message. */
  status: { text: string; state: StatusKind };
  serverLive: boolean;
  serverBlackedOut: Set<number>;
  serverFlashing: Set<number>;
  meterUniverse: number;
};

export const state: ConsoleState = {
  serverLink: null,
  outputStatus: [],
  showName: normalizeShowName(boot.showName),
  navOrder: normalizeNavOrder(boot.navOrder),
  universes: normalizeUniverses(boot.universes),
  songs: bootSongs,
  activeSongId: resolveActiveSong(bootSongs, boot.activeSongId).id,
  sets: bootSets,
  activeSetId: resolveActiveSet(bootSets, boot.activeSetId).id,
  activeEntryId: boot.activeEntryId ?? null,
  cueLevels: [],
  cueNames: [],
  faderNames: normalizeFaderNames(boot.faderNames),
  fixtureGroups: bootGroups,
  fixtures: normalizeFixtures(boot.fixtures, bootGroups),
  fixtureFormGroupId: null,
  patch: boot.patch,
  master: boot.master,
  cross: boot.cross,
  fromSub: boot.fromSub ?? 100,
  toSub: boot.toSub ?? 100,
  fromCue: boot.fromCue,
  toCue: boot.toCue,
  selectedCue: boot.selectedCue ?? 0,
  liveStep: boot.liveStep ?? -1,
  selectedFader: 0,
  fadeState: null,
  // The show name, show buttons, DMX outputs and status are drawn in the header
  // of the page around the console (../index.html), which calls consoleHeader
  // (app.ts) and is told (notifyHeader) when any of it changes.
  status: { text: "", state: "idle" },
  serverLive: false,
  serverBlackedOut: new Set(),
  serverFlashing: new Set(),
  meterUniverse: 1,
};

setUniverseCount(state.universes);

/** The show-server link (set up at the end of app.ts, before anything can ask the server). */
export const serverLink = (): ServerLink => must(state.serverLink, "show-server link");

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
  state.cueNames = song.cues.map((t) => t.name);
  const n = song.cues.length;
  state.selectedCue = clamp(state.selectedCue, 0, Math.max(0, n - 1));
  state.fromCue = clamp(state.fromCue, 0, Math.max(0, n - 1));
  syncPlaybackPair();
}

/**
 * UP NEXT follows LIVE: the next cue in the song, or the next set song's
 * first (see upNextCue). Also binds cueLevels: each cue's levels, the LIVE
 * one's those of its step being shown (liveStep), so edits land in the step.
 */
export function syncPlaybackPair() {
  const cues = getActiveSong().cues;
  state.fromCue = Math.min(Math.max(0, state.fromCue), cues.length - 1);
  state.liveStep = clampStep(cues[state.fromCue], state.liveStep);
  state.cueLevels = shownLevels(cues, state.fromCue, state.liveStep);
  state.toCue = upNextCue(state);
}

bindActiveSong();

export const headerListeners: Set<() => void> = new Set();
export const notifyHeader = () => { for (const fn of headerListeners) fn(); };

/** Snapshot of last explicitly saved/loaded show (or boot state). */
let cleanSnapshot = "";

export function setStatus(text: string, kind: StatusKind = "idle") {
  state.status = { text, state: kind };
  notifyHeader();
}

export function persistSession() {
  saveSession(currentShowState());
  state.serverLink?.sync();
  notifyStage(); // the stage header shows cue names and fade times
}

export function currentShowState(): ShowData {
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
    liveStep: state.liveStep,
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

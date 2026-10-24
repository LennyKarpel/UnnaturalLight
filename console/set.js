import {
  FADER_COUNT,
  defaultPatch,
  normalizeFaderPatch,
  MAX_UNIVERSES,
} from "./patch.js";
import {
  normalizeFixtureGroups,
  normalizeFixtures,
} from "./fixtures.js";
import {
  normalizeSongs,
  resolveActiveSong,
} from "./songs.js";
import { CONSOLE_SESSION_KEY as SESSION_KEY } from "../shared/stage-bus.js";
import { clamp, clampInt } from "../shared/numbers.js";

const SET_VERSION = 1;
const SET_APP = "UnnaturalLight";
export const DEFAULT_NAV_ORDER = [
  "set",
  "songs",
  "channels",
  "fixtures",
  "patch",
];

/** @param {unknown} order @returns {string[]} */
export function normalizeNavOrder(order) {
  const allowed = new Set(DEFAULT_NAV_ORDER);
  const source = Array.isArray(order) ? order : [];
  const next = [];
  for (const item of source) {
    if (!allowed.has(item) || next.includes(item)) continue;
    next.push(item);
  }
  for (const page of DEFAULT_NAV_ORDER) {
    if (!next.includes(page)) next.push(page);
  }
  return next;
}

export function defaultSetName() {
  return "Untitled";
}

/** @param {unknown} name */
export function normalizeSetName(name) {
  const text = typeof name === "string" ? name.trim() : "";
  return text || defaultSetName();
}

/** @param {number} index */
export function defaultFaderName(index) {
  return `F${index + 1}`;
}

/**
 * @param {unknown} names
 * @param {number} count
 * @param {(index: number) => string} fallback
 * @returns {string[]}
 */
function normalizeNames(names, count, fallback) {
  const source = Array.isArray(names) ? names : [];
  return Array.from({ length: count }, (_, i) => {
    const raw = source[i];
    const text = typeof raw === "string" ? raw.trim() : "";
    return text || fallback(i);
  });
}

/**
 * @param {unknown} names
 * @returns {string[]}
 */
export function normalizeFaderNames(names) {
  return normalizeNames(names, FADER_COUNT, defaultFaderName);
}

/**
 * @param {{
 *   setName?: string,
 *   navOrder?: string[],
 *   master: number,
 *   cross: number,
 *   fromSub?: number,
 *   toSub?: number,
 *   fromCue: number,
 *   selectedCue?: number,
 *   songs: import("./songs.js").Song[],
 *   activeSongId?: string | null,
 *   faderNames?: string[],
 *   fixtureGroups?: import("./fixtures.js").FixtureGroup[],
 *   fixtures?: import("./fixtures.js").Fixture[],
 *   patch: import("./patch.js").FaderPatch[],
 * }} state
 */
/** Universe count (1…MAX_UNIVERSES). */
export function normalizeUniverses(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(1, Math.min(MAX_UNIVERSES, n)) : 1;
}

export function serializeSet(state) {
  const songs = normalizeSongs(state.songs);
  const active = resolveActiveSong(songs, state.activeSongId);
  const fixtureGroups = normalizeFixtureGroups(state.fixtureGroups);
  return {
    version: SET_VERSION,
    app: SET_APP,
    kind: "set",
    savedAt: new Date().toISOString(),
    setName: normalizeSetName(state.setName),
    navOrder: normalizeNavOrder(state.navOrder),
    master: clamp(state.master, 0, 100),
    cross: clamp(state.cross, 0, 100),
    fromSub: clamp(state.fromSub ?? 100, 0, 100),
    toSub: clamp(state.toSub ?? 100, 0, 100),
    universes: normalizeUniverses(state.universes),
    fromCue: state.fromCue,
    selectedCue: state.selectedCue ?? 0,
    songs,
    activeSongId: active.id,
    faderNames: normalizeFaderNames(state.faderNames),
    fixtureGroups,
    fixtures: normalizeFixtures(state.fixtures, fixtureGroups),
    patch: state.patch.map(normalizeFaderPatch),
  };
}

/** Stable snapshot for dirty checks (ignores savedAt / selectedCue). */
export function setSnapshot(state) {
  const { savedAt: _savedAt, selectedCue: _selectedCue, ...rest } = serializeSet(state);
  return JSON.stringify(rest);
}

/** @param {object | null} [stage] the stage page's layout, saved in the same file */
function setToJson(state, stage = null) {
  const data = serializeSet(state);
  return `${JSON.stringify(stage ? { ...data, stage } : data, null, 2)}\n`;
}

/**
 * @param {unknown} data
 * @returns {{
 *   setName: string,
 *   navOrder: string[],
 *   master: number,
 *   cross: number,
 *   fromSub: number,
 *   toSub: number,
 *   fromCue: number,
 *   toCue: number,
 *   selectedCue: number,
 *   songs: import("./songs.js").Song[],
 *   activeSongId: string,
 *   faderNames: string[],
 *   fixtureGroups: import("./fixtures.js").FixtureGroup[],
 *   fixtures: import("./fixtures.js").Fixture[],
 *   patch: import("./patch.js").FaderPatch[],
 * }}
 */
export function parseSet(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid set file.");
  }

  const obj = /** @type {Record<string, unknown>} */ (data);
  // A set file has these; the console's live state (sent to the server) doesn't.
  if ((obj.app != null && obj.app !== SET_APP) || (obj.kind != null && obj.kind !== "set")) {
    throw new Error("This file is not an UnnaturalLight set.");
  }
  if (obj.version != null && obj.version !== SET_VERSION) {
    throw new Error(`Unsupported set version: ${obj.version}`);
  }

  const patchSource = Array.isArray(obj.patch) ? obj.patch : [];
  const patch = defaultPatch().map((_, i) => normalizeFaderPatch(patchSource[i]));

  const songs = normalizeSongs(obj.songs);
  const active = resolveActiveSong(songs, typeof obj.activeSongId === "string" ? obj.activeSongId : null);
  const cueCount = active.cues.length;

  const setName = normalizeSetName(obj.setName);
  const navOrder = normalizeNavOrder(obj.navOrder);
  const faderNames = normalizeFaderNames(obj.faderNames);
  const fixtureGroups = normalizeFixtureGroups(obj.fixtureGroups);
  const fixtures = normalizeFixtures(obj.fixtures, fixtureGroups);
  const master = clamp(Number(obj.master ?? 100), 0, 100);
  const cross = clamp(Number(obj.cross ?? 0), 0, 100);
  const fromSub = clamp(Number(obj.fromSub ?? 100), 0, 100);
  const toSub = clamp(Number(obj.toSub ?? 100), 0, 100);
  const universes = normalizeUniverses(obj.universes);
  const fromCue = clampInt(Number(obj.fromCue ?? 0), 0, cueCount - 1);
  // Up next is always the cue after the current one (not saved).
  const toCue = (fromCue + 1) % cueCount;
  const selectedCue = clampInt(
    Number(obj.selectedCue ?? 0),
    0,
    cueCount - 1,
  );

  return {
    setName,
    navOrder,
    master,
    cross,
    fromSub,
    toSub,
    universes,
    fromCue,
    toCue,
    selectedCue,
    songs,
    activeSongId: active.id,
    faderNames,
    fixtureGroups,
    fixtures,
    patch,
  };
}

export function downloadSet(state, filename, stage = null) {
  const blob = new Blob([setToJson(state, stage)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || defaultFilename(state.setName);
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** @param {unknown} [setName] */
function defaultFilename(setName) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const base = normalizeSetName(setName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${base || "set"}-${stamp}.json`;
}

/** Autosave full set state for refresh restore (no explicit Save needed). */
export function saveSession(state) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(serializeSet(state)));
  } catch (err) {
    console.warn("Could not autosave session", err);
  }
}

/** @returns {ReturnType<typeof parseSet> | null} */
export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return parseSet(JSON.parse(raw));
  } catch (err) {
    console.warn("Could not load session", err);
    return null;
  }
}

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
import { normalizeSets, resolveActiveEntry, resolveActiveSet, upNextCue } from "./sets.js";
import { CONSOLE_SESSION_KEY as SESSION_KEY } from "../shared/stage-bus.js";
import { clamp, clampInt } from "../shared/numbers.js";

const SHOW_VERSION = 1;
const SHOW_APP = "UnnaturalLight";
export const DEFAULT_NAV_ORDER = [
  "show",
  "set",
  "run",
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
  // A tab the saved order doesn't have goes where it is by default: right
  // after the tab before it there (or first).
  DEFAULT_NAV_ORDER.forEach((page, i) => {
    if (next.includes(page)) return;
    next.splice(i === 0 ? 0 : next.indexOf(DEFAULT_NAV_ORDER[i - 1]) + 1, 0, page);
  });
  return next;
}

export function defaultShowName() {
  return "Untitled";
}

/** @param {unknown} name */
export function normalizeShowName(name) {
  const text = typeof name === "string" ? name.trim() : "";
  return text || defaultShowName();
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

/** Universe count (1…MAX_UNIVERSES). */
export function normalizeUniverses(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(1, Math.min(MAX_UNIVERSES, n)) : 1;
}

/**
 * @param {{
 *   showName?: string,
 *   navOrder?: string[],
 *   master: number,
 *   cross: number,
 *   fromSub?: number,
 *   toSub?: number,
 *   fromCue: number,
 *   selectedCue?: number,
 *   songs: import("./songs.js").Song[],
 *   activeSongId?: string | null,
 *   sets?: import("./sets.js").ShowSet[],
 *   activeSetId?: string | null,
 *   activeEntryId?: string | null,
 *   faderNames?: string[],
 *   fixtureGroups?: import("./fixtures.js").FixtureGroup[],
 *   fixtures?: import("./fixtures.js").Fixture[],
 *   patch: import("./patch.js").FaderPatch[],
 * }} state
 */
export function serializeShow(state) {
  const songs = normalizeSongs(state.songs);
  const active = resolveActiveSong(songs, state.activeSongId);
  const sets = normalizeSets(state.sets, songs);
  const activeSet = resolveActiveSet(sets, state.activeSetId);
  const fixtureGroups = normalizeFixtureGroups(state.fixtureGroups);
  return {
    version: SHOW_VERSION,
    app: SHOW_APP,
    kind: "show",
    savedAt: new Date().toISOString(),
    showName: normalizeShowName(state.showName),
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
    sets,
    activeSetId: activeSet.id,
    activeEntryId: resolveActiveEntry(activeSet, state.activeEntryId, active.id)?.id ?? null,
    faderNames: normalizeFaderNames(state.faderNames),
    fixtureGroups,
    fixtures: normalizeFixtures(state.fixtures, fixtureGroups),
    patch: state.patch.map(normalizeFaderPatch),
  };
}

/** Stable snapshot for dirty checks (ignores savedAt / selectedCue). */
export function showSnapshot(state) {
  const { savedAt: _savedAt, selectedCue: _selectedCue, ...rest } = serializeShow(state);
  return JSON.stringify(rest);
}

/** @param {object | null} [stage] the stage page's layout, saved in the same file */
function showToJson(state, stage = null) {
  const data = serializeShow(state);
  return `${JSON.stringify(stage ? { ...data, stage } : data, null, 2)}\n`;
}

/**
 * @param {unknown} data
 * @returns {{
 *   showName: string,
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
 *   sets: import("./sets.js").ShowSet[],
 *   activeSetId: string,
 *   activeEntryId: string | null,
 *   faderNames: string[],
 *   fixtureGroups: import("./fixtures.js").FixtureGroup[],
 *   fixtures: import("./fixtures.js").Fixture[],
 *   patch: import("./patch.js").FaderPatch[],
 * }}
 */
export function parseShow(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid show file.");
  }

  const obj = /** @type {Record<string, unknown>} */ (data);
  // A show file has these; the console's live state (sent to the server) doesn't.
  if ((obj.app != null && obj.app !== SHOW_APP) || (obj.kind != null && obj.kind !== "show")) {
    throw new Error("This file is not an UnnaturalLight show.");
  }
  if (obj.version != null && obj.version !== SHOW_VERSION) {
    throw new Error(`Unsupported show version: ${obj.version}`);
  }

  const patchSource = Array.isArray(obj.patch) ? obj.patch : [];
  const patch = defaultPatch().map((_, i) => normalizeFaderPatch(patchSource[i]));

  const songs = normalizeSongs(obj.songs);
  const active = resolveActiveSong(songs, typeof obj.activeSongId === "string" ? obj.activeSongId : null);
  const cueCount = active.cues.length;
  const sets = normalizeSets(obj.sets, songs);
  const activeSet = resolveActiveSet(sets, typeof obj.activeSetId === "string" ? obj.activeSetId : null);
  const activeEntryId = resolveActiveEntry(activeSet, typeof obj.activeEntryId === "string" ? obj.activeEntryId : null, active.id)?.id ?? null;

  const showName = normalizeShowName(obj.showName);
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
  // Up next follows from the live cue and the set (not saved).
  const toCue = upNextCue({ songs, sets, activeSetId: activeSet.id, activeEntryId, activeSongId: active.id, fromCue });
  const selectedCue = clampInt(
    Number(obj.selectedCue ?? 0),
    0,
    cueCount - 1,
  );

  return {
    showName,
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
    sets,
    activeSetId: activeSet.id,
    activeEntryId,
    faderNames,
    fixtureGroups,
    fixtures,
    patch,
  };
}

export function downloadShow(state, filename, stage = null) {
  const blob = new Blob([showToJson(state, stage)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || defaultFilename(state.showName);
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** @param {unknown} [showName] */
function defaultFilename(showName) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const base = normalizeShowName(showName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${base || "show"}-${stamp}.json`;
}

/** Autosave full show state for refresh restore (no explicit Save needed). */
export function saveSession(state) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(serializeShow(state)));
  } catch (err) {
    console.warn("Could not autosave session", err);
  }
}

/** @returns {ReturnType<typeof parseShow> | null} */
export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return parseShow(JSON.parse(raw));
  } catch (err) {
    console.warn("Could not load session", err);
    return null;
  }
}

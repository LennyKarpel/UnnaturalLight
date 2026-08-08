import {
  FADER_COUNT,
  MAX_ROWS,
  MIN_ROWS,
  defaultPatch,
  normalizeFaderPatch,
} from "./patch.js";
import {
  normalizeInstrumentGroups,
  normalizeInstruments,
} from "./instruments.js";
import {
  DEFAULT_TRANSITION_FADE_TIME,
  defaultTransitionName,
  normalizeTunes,
  normalizeTransitionFadeTime,
  resolveActiveTune,
  tunesFromLegacyRows,
  TRANSITION_FADE_TIMES,
} from "./tunes.js";

export const SETLIST_VERSION = 2;
export const SETLIST_APP = "UnnaturalLight";
/** @deprecated Prefer TRANSITION_FADE_TIMES / per-transition fadeTime */
export const FADE_TIMES = TRANSITION_FADE_TIMES;
export const DEFAULT_NAV_ORDER = [
  "setlist",
  "tunes",
  "channels",
  "instruments",
  "patch",
];
const SESSION_KEY = "unnaturallight.setlist.session.v1";
const LEGACY_SESSION_KEYS = [
  "unnaturallight.session.v1",
  "naturallight.session.v1",
  "sunlight.session.v1",
];

// Re-export transition naming helpers used by app.js (was scene naming).
export {
  defaultTransitionName,
  defaultTuneName,
  createTune,
  createTransition,
  normalizeTunes,
  normalizeTuneName,
  normalizeTransitionFadeTime,
  moveTune,
  moveTransition,
  MAX_TUNES,
  MIN_TRANSITIONS,
  MAX_TRANSITIONS,
  TRANSITION_FADE_TIMES,
  DEFAULT_TRANSITION_FADE_TIME,
  blankLevels,
  newTuneId,
  newTransitionId,
  resolveActiveTune,
} from "./tunes.js";

/** @deprecated Use defaultTransitionName */
export function defaultSceneName(index) {
  return defaultTransitionName(index);
}

/** @deprecated Use normalizeTransitionNames via tunes */
export function normalizeSceneNames(names, count) {
  const source = Array.isArray(names) ? names : [];
  return Array.from({ length: count }, (_, i) => {
    const raw = source[i];
    const text = typeof raw === "string" ? raw.trim() : "";
    return text || defaultTransitionName(i);
  });
}

/** @param {unknown} order @returns {string[]} */
export function normalizeNavOrder(order) {
  const allowed = new Set(DEFAULT_NAV_ORDER);
  const source = Array.isArray(order) ? order : [];
  const next = [];
  for (const item of source) {
    if (typeof item !== "string") continue;
    // Legacy page ids.
    let page = item;
    if (page === "faders" || page === "songs") page = "tunes";
    if (page === "show") page = "setlist";
    if (!allowed.has(page) || next.includes(page)) continue;
    next.push(page);
  }
  for (const page of DEFAULT_NAV_ORDER) {
    if (!next.includes(page)) next.push(page);
  }
  return next;
}

export function defaultSetlistName() {
  return "Untitled";
}

/** @param {unknown} name */
export function normalizeSetlistName(name) {
  const text = typeof name === "string" ? name.trim() : "";
  return text || defaultSetlistName();
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
 *   setlistName?: string,
 *   navOrder?: string[],
 *   master: number,
 *   cross: number,
 *   fromSub?: number,
 *   toSub?: number,
 *   fadeTime?: number,
 *   fromRow: number,
 *   toRow: number,
 *   selectedRow?: number,
 *   tunes: import("./tunes.js").Tune[],
 *   activeTuneId?: string | null,
 *   faderNames?: string[],
 *   instrumentGroups?: import("./instruments.js").InstrumentGroup[],
 *   instruments?: import("./instruments.js").Instrument[],
 *   patch: import("./patch.js").FaderPatch[],
 * }} state
 */
export function serializeSetlist(state) {
  const tunes = normalizeTunes(state.tunes);
  const active = resolveActiveTune(tunes, state.activeTuneId);
  const instrumentGroups = normalizeInstrumentGroups(state.instrumentGroups);
  return {
    version: SETLIST_VERSION,
    app: SETLIST_APP,
    kind: "setlist",
    savedAt: new Date().toISOString(),
    setlistName: normalizeSetlistName(state.setlistName),
    navOrder: normalizeNavOrder(state.navOrder),
    master: clamp(state.master, 0, 100),
    cross: clamp(state.cross, 0, 100),
    fromSub: clamp(state.fromSub ?? 100, 0, 100),
    toSub: clamp(state.toSub ?? 100, 0, 100),
    fadeTime: FADE_TIMES.includes(Number(state.fadeTime))
      ? Number(state.fadeTime)
      : 4,
    fromRow: state.fromRow,
    toRow: state.toRow,
    selectedRow: state.selectedRow ?? 0,
    tunes,
    activeTuneId: active.id,
    faderNames: normalizeFaderNames(state.faderNames),
    instrumentGroups,
    instruments: normalizeInstruments(state.instruments, instrumentGroups),
    patch: state.patch.map(normalizeFaderPatch),
  };
}

/** Stable snapshot for dirty checks (ignores savedAt / selectedRow). */
export function setlistSnapshot(state) {
  const { savedAt: _savedAt, selectedRow: _selectedRow, ...rest } = serializeSetlist(state);
  return JSON.stringify(rest);
}

export function setlistToJson(state) {
  return `${JSON.stringify(serializeSetlist(state), null, 2)}\n`;
}

/**
 * @param {unknown} data
 * @returns {{
 *   setlistName: string,
 *   navOrder: string[],
 *   master: number,
 *   cross: number,
 *   fromSub: number,
 *   toSub: number,
 *   fadeTime: number,
 *   fromRow: number,
 *   toRow: number,
 *   selectedRow: number,
 *   tunes: import("./tunes.js").Tune[],
 *   activeTuneId: string,
 *   faderNames: string[],
 *   instrumentGroups: import("./instruments.js").InstrumentGroup[],
 *   instruments: import("./instruments.js").Instrument[],
 *   patch: import("./patch.js").FaderPatch[],
 * }}
 */
export function parseSetlist(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid setlist file.");
  }

  const obj = /** @type {Record<string, unknown>} */ (data);
  if (
    obj.app != null &&
    obj.app !== SETLIST_APP &&
    obj.app !== "NaturalLight" &&
    obj.app !== "SunLight"
  ) {
    throw new Error("This file is not an UnnaturalLight setlist.");
  }
  if (obj.kind != null && obj.kind !== "setlist" && obj.kind !== "show") {
    throw new Error("This file is not an UnnaturalLight setlist.");
  }

  const version = obj.version == null ? 1 : Number(obj.version);
  if (version !== 1 && version !== SETLIST_VERSION) {
    throw new Error(`Unsupported setlist version: ${obj.version}`);
  }

  const patchSource = Array.isArray(obj.patch) ? obj.patch : [];
  const patch = defaultPatch().map((_, i) => normalizeFaderPatch(patchSource[i]));

  const legacyFadeTime = normalizeTransitionFadeTime(
    obj.fadeTime,
    DEFAULT_TRANSITION_FADE_TIME,
  );

  /** @type {import("./tunes.js").Tune[]} */
  let tunes;
  const tuneSource = Array.isArray(obj.tunes)
    ? obj.tunes
    : Array.isArray(obj.songs)
      ? obj.songs
      : null;
  if (tuneSource && tuneSource.length > 0) {
    tunes = normalizeTunes(tuneSource, legacyFadeTime);
  } else {
    // v1 flat rows/names → one tune of transitions
    let rows = Array.isArray(obj.rows) ? obj.rows : [];
    rows = rows
      .filter(Array.isArray)
      .slice(0, MAX_ROWS)
      .map((row) =>
        Array.from({ length: FADER_COUNT }, (_, i) => clampByte(row[i] ?? 0)),
      );
    while (rows.length < MIN_ROWS) {
      rows.push(Array.from({ length: FADER_COUNT }, () => 0));
    }
    tunes = tunesFromLegacyRows(rows, obj.names, legacyFadeTime);
  }

  const activeId =
    typeof obj.activeTuneId === "string"
      ? obj.activeTuneId
      : typeof obj.activeSongId === "string"
        ? obj.activeSongId
        : null;
  const active = resolveActiveTune(tunes, activeId);
  const transitionCount = active.transitions.length;

  const setlistName = normalizeSetlistName(
    obj.setlistName ?? obj.showName,
  );
  const navOrder = normalizeNavOrder(obj.navOrder);
  const faderNames = normalizeFaderNames(obj.faderNames);
  const instrumentGroups = normalizeInstrumentGroups(obj.instrumentGroups);
  const instruments = normalizeInstruments(obj.instruments, instrumentGroups);
  const master = clamp(Number(obj.master ?? 100), 0, 100);
  const cross = clamp(Number(obj.cross ?? 0), 0, 100);
  const fromSub = clamp(Number(obj.fromSub ?? 100), 0, 100);
  const toSub = clamp(Number(obj.toSub ?? 100), 0, 100);
  // Legacy setlist-level field; live GO uses each transition’s fadeTime.
  const fadeTime = legacyFadeTime;
  let fromRow = clampInt(Number(obj.fromRow ?? 0), 0, transitionCount - 1);
  let toRow = (fromRow + 1) % transitionCount;
  const selectedRow = clampInt(
    Number(obj.selectedRow ?? 0),
    0,
    transitionCount - 1,
  );

  return {
    setlistName,
    navOrder,
    master,
    cross,
    fromSub,
    toSub,
    fadeTime,
    fromRow,
    toRow,
    selectedRow,
    tunes,
    activeTuneId: active.id,
    faderNames,
    instrumentGroups,
    instruments,
    patch,
  };
}

export function downloadSetlist(state, filename) {
  const blob = new Blob([setlistToJson(state)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || defaultFilename(state.setlistName);
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** @param {unknown} [setlistName] */
export function defaultFilename(setlistName) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const base = normalizeSetlistName(setlistName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${base || "setlist"}-${stamp}.json`;
}

/** Autosave full setlist state for refresh restore (no explicit Save needed). */
export function saveSession(state) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(serializeSetlist(state)));
  } catch (err) {
    console.warn("Could not autosave session", err);
  }
}

/** @returns {ReturnType<typeof parseSetlist> | null} */
export function loadSession() {
  try {
    let raw = localStorage.getItem(SESSION_KEY);
    for (const key of LEGACY_SESSION_KEYS) {
      if (raw) break;
      raw = localStorage.getItem(key);
    }
    if (!raw) return null;
    return parseSetlist(JSON.parse(raw));
  } catch (err) {
    console.warn("Could not load session", err);
    return null;
  }
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function clampInt(value, min, max) {
  return clamp(Math.round(value), min, max);
}

function clampByte(value) {
  return clampInt(Number(value), 0, 255);
}

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

export const SHOW_VERSION = 1;
export const SHOW_APP = "UnnaturalLight";
export const FADE_TIMES = [2, 4, 6, 8, 10];
export const DEFAULT_NAV_ORDER = ["faders", "channels", "instruments", "patch"];
const SESSION_KEY = "unnaturallight.session.v1";
const LEGACY_SESSION_KEYS = ["naturallight.session.v1", "sunlight.session.v1"];

/** @param {unknown} order @returns {string[]} */
export function normalizeNavOrder(order) {
  const allowed = new Set(DEFAULT_NAV_ORDER);
  const source = Array.isArray(order) ? order : [];
  const next = [];
  for (const item of source) {
    if (typeof item !== "string" || !allowed.has(item) || next.includes(item)) continue;
    next.push(item);
  }
  for (const page of DEFAULT_NAV_ORDER) {
    if (!next.includes(page)) next.push(page);
  }
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
export function defaultSceneName(index) {
  if (index >= 0 && index < 26) return String.fromCharCode(65 + index);
  return `Scene ${index + 1}`;
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
 * @param {number} count
 * @returns {string[]}
 */
export function normalizeSceneNames(names, count) {
  return normalizeNames(names, count, defaultSceneName);
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
 *   showName?: string,
 *   navOrder?: string[],
 *   master: number,
 *   cross: number,
 *   fromSub?: number,
 *   toSub?: number,
 *   fadeTime?: number,
 *   fromRow: number,
 *   toRow: number,
 *   selectedRow?: number,
 *   rows: number[][],
 *   names?: string[],
 *   faderNames?: string[],
 *   instrumentGroups?: import("./instruments.js").InstrumentGroup[],
 *   instruments?: import("./instruments.js").Instrument[],
 *   patch: import("./patch.js").FaderPatch[],
 * }} state
 */
export function serializeShow(state) {
  const rows = state.rows.map((row) =>
    Array.from({ length: FADER_COUNT }, (_, i) => clampByte(row[i] ?? 0)),
  );
  const instrumentGroups = normalizeInstrumentGroups(state.instrumentGroups);
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
    fadeTime: FADE_TIMES.includes(Number(state.fadeTime))
      ? Number(state.fadeTime)
      : 4,
    fromRow: state.fromRow,
    toRow: state.toRow,
    selectedRow: state.selectedRow ?? 0,
    rows,
    names: normalizeSceneNames(state.names, rows.length),
    faderNames: normalizeFaderNames(state.faderNames),
    instrumentGroups,
    instruments: normalizeInstruments(state.instruments, instrumentGroups),
    patch: state.patch.map(normalizeFaderPatch),
  };
}

/** Stable snapshot for dirty checks (ignores savedAt / selectedRow). */
export function showSnapshot(state) {
  const { savedAt: _savedAt, selectedRow: _selectedRow, ...rest } = serializeShow(state);
  return JSON.stringify(rest);
}

export function showToJson(state) {
  return `${JSON.stringify(serializeShow(state), null, 2)}\n`;
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
 *   fadeTime: number,
 *   fromRow: number,
 *   toRow: number,
 *   selectedRow: number,
 *   rows: number[][],
 *   names: string[],
 *   faderNames: string[],
 *   instrumentGroups: import("./instruments.js").InstrumentGroup[],
 *   instruments: import("./instruments.js").Instrument[],
 *   patch: import("./patch.js").FaderPatch[],
 * }}
 */
export function parseShow(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid show file.");
  }

  const obj = /** @type {Record<string, unknown>} */ (data);
  if (
    obj.app != null &&
    obj.app !== SHOW_APP &&
    obj.app !== "NaturalLight" &&
    obj.app !== "SunLight"
  ) {
    throw new Error("This file is not an UnnaturalLight show.");
  }
  if (obj.kind != null && obj.kind !== "show") {
    throw new Error("This file is not an UnnaturalLight show.");
  }
  if (obj.version != null && Number(obj.version) !== SHOW_VERSION) {
    throw new Error(`Unsupported show version: ${obj.version}`);
  }

  const patchSource = Array.isArray(obj.patch) ? obj.patch : [];
  const patch = defaultPatch().map((_, i) => normalizeFaderPatch(patchSource[i]));

  let rows = Array.isArray(obj.rows) ? obj.rows : [];
  rows = rows
    .filter(Array.isArray)
    .slice(0, MAX_ROWS)
    .map((row) => Array.from({ length: FADER_COUNT }, (_, i) => clampByte(row[i] ?? 0)));

  while (rows.length < MIN_ROWS) {
    rows.push(Array.from({ length: FADER_COUNT }, () => 0));
  }

  const showName = normalizeShowName(obj.showName);
  const navOrder = normalizeNavOrder(obj.navOrder);
  const names = normalizeSceneNames(obj.names, rows.length);
  const faderNames = normalizeFaderNames(obj.faderNames);
  const instrumentGroups = normalizeInstrumentGroups(obj.instrumentGroups);
  const instruments = normalizeInstruments(obj.instruments, instrumentGroups);
  const master = clamp(Number(obj.master ?? 100), 0, 100);
  const cross = clamp(Number(obj.cross ?? 0), 0, 100);
  const fromSub = clamp(Number(obj.fromSub ?? 100), 0, 100);
  const toSub = clamp(Number(obj.toSub ?? 100), 0, 100);
  const fadeTime = FADE_TIMES.includes(Number(obj.fadeTime))
    ? Number(obj.fadeTime)
    : 4;
  let fromRow = clampInt(Number(obj.fromRow ?? 0), 0, rows.length - 1);
  let toRow = clampInt(Number(obj.toRow ?? 1), 0, rows.length - 1);
  if (fromRow === toRow) {
    toRow = (fromRow + 1) % rows.length;
  }
  const selectedRow = clampInt(Number(obj.selectedRow ?? 0), 0, rows.length - 1);

  return {
    showName,
    navOrder,
    master,
    cross,
    fromSub,
    toSub,
    fadeTime,
    fromRow,
    toRow,
    selectedRow,
    rows,
    names,
    faderNames,
    instrumentGroups,
    instruments,
    patch,
  };
}

export function downloadShow(state, filename) {
  const blob = new Blob([showToJson(state)], { type: "application/json" });
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
export function defaultFilename(showName) {
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
    let raw = localStorage.getItem(SESSION_KEY);
    for (const key of LEGACY_SESSION_KEYS) {
      if (raw) break;
      raw = localStorage.getItem(key);
    }
    if (!raw) return null;
    return parseShow(JSON.parse(raw));
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

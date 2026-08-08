import {
  FADER_COUNT,
  MAX_ROWS,
  MIN_ROWS,
  defaultPatch,
  normalizeFaderPatch,
} from "./patch.js";

export const CONFIG_VERSION = 1;
export const CONFIG_APP = "UnnaturalLight";
export const FADE_TIMES = [2, 4, 6, 8, 10];
const SESSION_KEY = "unnaturallight.session.v1";
const LEGACY_SESSION_KEYS = ["naturallight.session.v1", "sunlight.session.v1"];

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
 *   master: number,
 *   cross: number,
 *   fadeTime?: number,
 *   fromRow: number,
 *   toRow: number,
 *   selectedRow?: number,
 *   rows: number[][],
 *   names?: string[],
 *   faderNames?: string[],
 *   patch: import("./patch.js").FaderPatch[],
 * }} state
 */
export function serializeConfig(state) {
  const rows = state.rows.map((row) =>
    Array.from({ length: FADER_COUNT }, (_, i) => clampByte(row[i] ?? 0)),
  );
  return {
    version: CONFIG_VERSION,
    app: CONFIG_APP,
    savedAt: new Date().toISOString(),
    master: clamp(state.master, 0, 100),
    cross: clamp(state.cross, 0, 100),
    fadeTime: FADE_TIMES.includes(Number(state.fadeTime))
      ? Number(state.fadeTime)
      : 4,
    fromRow: state.fromRow,
    toRow: state.toRow,
    selectedRow: state.selectedRow ?? 0,
    rows,
    names: normalizeSceneNames(state.names, rows.length),
    faderNames: normalizeFaderNames(state.faderNames),
    patch: state.patch.map(normalizeFaderPatch),
  };
}

/** Stable snapshot for dirty checks (ignores savedAt / selectedRow). */
export function configSnapshot(state) {
  const { savedAt: _savedAt, selectedRow: _selectedRow, ...rest } = serializeConfig(state);
  return JSON.stringify(rest);
}

export function configToJson(state) {
  return `${JSON.stringify(serializeConfig(state), null, 2)}\n`;
}

/**
 * @param {unknown} data
 * @returns {{
 *   master: number,
 *   cross: number,
 *   fadeTime: number,
 *   fromRow: number,
 *   toRow: number,
 *   selectedRow: number,
 *   rows: number[][],
 *   names: string[],
 *   faderNames: string[],
 *   patch: import("./patch.js").FaderPatch[],
 * }}
 */
export function parseConfig(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid config file.");
  }

  const obj = /** @type {Record<string, unknown>} */ (data);
  if (
    obj.app != null &&
    obj.app !== CONFIG_APP &&
    obj.app !== "NaturalLight" &&
    obj.app !== "SunLight"
  ) {
    throw new Error("This file is not an UnnaturalLight config.");
  }
  if (obj.version != null && Number(obj.version) !== CONFIG_VERSION) {
    throw new Error(`Unsupported config version: ${obj.version}`);
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

  const names = normalizeSceneNames(obj.names, rows.length);
  const faderNames = normalizeFaderNames(obj.faderNames);
  const master = clamp(Number(obj.master ?? 100), 0, 100);
  const cross = clamp(Number(obj.cross ?? 0), 0, 100);
  const fadeTime = FADE_TIMES.includes(Number(obj.fadeTime))
    ? Number(obj.fadeTime)
    : 4;
  let fromRow = clampInt(Number(obj.fromRow ?? 0), 0, rows.length - 1);
  let toRow = clampInt(Number(obj.toRow ?? 1), 0, rows.length - 1);
  if (fromRow === toRow) {
    toRow = (fromRow + 1) % rows.length;
  }
  const selectedRow = clampInt(Number(obj.selectedRow ?? 0), 0, rows.length - 1);

  return { master, cross, fadeTime, fromRow, toRow, selectedRow, rows, names, faderNames, patch };
}

export function downloadConfig(state, filename) {
  const blob = new Blob([configToJson(state)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || defaultFilename();
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function defaultFilename() {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `unnaturallight-${stamp}.json`;
}

/** Autosave full show state for refresh restore (no explicit Save needed). */
export function saveSession(state) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(serializeConfig(state)));
  } catch (err) {
    console.warn("Could not autosave session", err);
  }
}

/** @returns {ReturnType<typeof parseConfig> | null} */
export function loadSession() {
  try {
    let raw = localStorage.getItem(SESSION_KEY);
    for (const key of LEGACY_SESSION_KEYS) {
      if (raw) break;
      raw = localStorage.getItem(key);
    }
    if (!raw) return null;
    return parseConfig(JSON.parse(raw));
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

import { FADER_COUNT, MAX_ROWS, MIN_ROWS } from "./patch.js";

export const MAX_TUNES = 32;
export const MIN_TRANSITIONS = MIN_ROWS;
export const MAX_TRANSITIONS = MAX_ROWS;
/** Allowed fade-in seconds to arrive at a transition (GO). */
export const TRANSITION_FADE_TIMES = [2, 4, 6, 8, 10];
export const DEFAULT_TRANSITION_FADE_TIME = 4;

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   levels: number[],
 *   fadeTime: number,
 * }} Transition
 * @typedef {{
 *   id: string,
 *   name: string,
 *   transitions: Transition[],
 * }} Tune
 */

/** @param {unknown} value @param {number} [fallback] */
export function normalizeTransitionFadeTime(
  value,
  fallback = DEFAULT_TRANSITION_FADE_TIME,
) {
  const n = Number(value);
  if (TRANSITION_FADE_TIMES.includes(n)) return n;
  if (TRANSITION_FADE_TIMES.includes(fallback)) return fallback;
  return DEFAULT_TRANSITION_FADE_TIME;
}

/** @param {string} prefix @returns {string} */
function newId(prefix) {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // non-secure context
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** @returns {string} */
export function newTuneId() {
  return newId("tune");
}

/** @returns {string} */
export function newTransitionId() {
  return newId("tr");
}

/** @returns {number[]} */
export function blankLevels() {
  return Array.from({ length: FADER_COUNT }, () => 0);
}

/** @param {number} index */
export function defaultTransitionName(index) {
  if (index >= 0 && index < 26) return String.fromCharCode(65 + index);
  return `Transition ${index + 1}`;
}

/** @param {number} index */
export function defaultTuneName(index) {
  return `Tune ${index + 1}`;
}

/** @param {unknown} name @param {number} [index] */
export function normalizeTransitionName(name, index = 0) {
  const text = typeof name === "string" ? name.trim().slice(0, 40) : "";
  return text || defaultTransitionName(index);
}

/** @param {unknown} name @param {number} [index] */
export function normalizeTuneName(name, index = 0) {
  const text = typeof name === "string" ? name.trim().slice(0, 40) : "";
  return text || defaultTuneName(index);
}

/**
 * @param {unknown} value
 * @param {number} [index]
 * @param {number} [defaultFadeTime]
 * @returns {Transition | null}
 */
export function normalizeTransition(
  value,
  index = 0,
  defaultFadeTime = DEFAULT_TRANSITION_FADE_TIME,
) {
  if (!value || typeof value !== "object") return null;
  const obj = /** @type {Record<string, unknown>} */ (value);
  const id =
    typeof obj.id === "string" && obj.id.trim()
      ? obj.id.trim()
      : newTransitionId();
  const levelsSource = Array.isArray(obj.levels)
    ? obj.levels
    : Array.isArray(obj.row)
      ? obj.row
      : null;
  const levels = Array.from({ length: FADER_COUNT }, (_, i) => {
    const n = Math.round(Number(levelsSource?.[i] ?? 0));
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(255, n));
  });
  return {
    id,
    name: normalizeTransitionName(obj.name, index),
    levels,
    fadeTime: normalizeTransitionFadeTime(obj.fadeTime, defaultFadeTime),
  };
}

/**
 * @param {unknown} list
 * @param {number} [defaultFadeTime]
 * @returns {Transition[]}
 */
export function normalizeTransitions(
  list,
  defaultFadeTime = DEFAULT_TRANSITION_FADE_TIME,
) {
  const source = Array.isArray(list) ? list : [];
  /** @type {Transition[]} */
  const out = [];
  const seen = new Set();
  for (let i = 0; i < source.length && out.length < MAX_TRANSITIONS; i++) {
    const raw = normalizeTransition(source[i], i, defaultFadeTime);
    if (!raw) continue;
    let id = raw.id;
    while (seen.has(id)) id = newTransitionId();
    seen.add(id);
    out.push({
      id,
      name: raw.name,
      levels: raw.levels,
      fadeTime: raw.fadeTime,
    });
  }
  while (out.length < MIN_TRANSITIONS) {
    const index = out.length;
    out.push({
      id: newTransitionId(),
      name: defaultTransitionName(index),
      levels: blankLevels(),
      fadeTime: normalizeTransitionFadeTime(undefined, defaultFadeTime),
    });
  }
  return out;
}

/**
 * @param {unknown} value
 * @param {number} [index]
 * @param {number} [defaultFadeTime]
 * @returns {Tune | null}
 */
export function normalizeTune(
  value,
  index = 0,
  defaultFadeTime = DEFAULT_TRANSITION_FADE_TIME,
) {
  if (!value || typeof value !== "object") return null;
  const obj = /** @type {Record<string, unknown>} */ (value);
  const id =
    typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : newTuneId();
  return {
    id,
    name: normalizeTuneName(obj.name, index),
    transitions: normalizeTransitions(obj.transitions, defaultFadeTime),
  };
}

/**
 * @param {unknown} list
 * @param {number} [defaultFadeTime]
 * @returns {Tune[]}
 */
export function normalizeTunes(
  list,
  defaultFadeTime = DEFAULT_TRANSITION_FADE_TIME,
) {
  if (!Array.isArray(list) || list.length === 0) {
    return [createTune({ name: defaultTuneName(0), defaultFadeTime })];
  }
  /** @type {Tune[]} */
  const out = [];
  const seen = new Set();
  for (let i = 0; i < list.length && out.length < MAX_TUNES; i++) {
    const raw = normalizeTune(list[i], i, defaultFadeTime);
    if (!raw) continue;
    let id = raw.id;
    while (seen.has(id)) id = newTuneId();
    seen.add(id);
    out.push({ id, name: raw.name, transitions: raw.transitions });
  }
  if (out.length === 0) {
    return [createTune({ name: defaultTuneName(0), defaultFadeTime })];
  }
  return out;
}

/**
 * @param {{
 *   name?: string,
 *   transitions?: Transition[],
 *   defaultFadeTime?: number,
 * }} [opts]
 * @returns {Tune}
 */
export function createTune(opts = {}) {
  const defaultFadeTime = normalizeTransitionFadeTime(opts.defaultFadeTime);
  const transitions =
    opts.transitions && opts.transitions.length >= MIN_TRANSITIONS
      ? normalizeTransitions(opts.transitions, defaultFadeTime)
      : normalizeTransitions(
          [
            {
              name: defaultTransitionName(0),
              levels: blankLevels(),
              fadeTime: defaultFadeTime,
            },
            {
              name: defaultTransitionName(1),
              levels: blankLevels(),
              fadeTime: defaultFadeTime,
            },
          ],
          defaultFadeTime,
        );
  return {
    id: newTuneId(),
    name: normalizeTuneName(opts.name, 0),
    transitions,
  };
}

/**
 * @param {{ name?: string, levels?: number[], fadeTime?: number }} [opts]
 * @returns {Transition}
 */
export function createTransition(opts = {}) {
  return {
    id: newTransitionId(),
    name: normalizeTransitionName(opts.name, 0),
    levels: Array.from({ length: FADER_COUNT }, (_, i) => {
      const n = Math.round(Number(opts.levels?.[i] ?? 0));
      if (!Number.isFinite(n)) return 0;
      return Math.max(0, Math.min(255, n));
    }),
    fadeTime: normalizeTransitionFadeTime(opts.fadeTime),
  };
}

/**
 * Migrate flat v1 rows/names into a single tune.
 * @param {unknown} rows
 * @param {unknown} names
 * @param {number} [defaultFadeTime]
 * @returns {Tune[]}
 */
export function tunesFromLegacyRows(
  rows,
  names,
  defaultFadeTime = DEFAULT_TRANSITION_FADE_TIME,
) {
  const rowList = Array.isArray(rows) ? rows.filter(Array.isArray) : [];
  const nameList = Array.isArray(names) ? names : [];
  const fade = normalizeTransitionFadeTime(defaultFadeTime);
  const transitions = normalizeTransitions(
    rowList.slice(0, MAX_TRANSITIONS).map((row, i) => ({
      name:
        typeof nameList[i] === "string" && nameList[i].trim()
          ? nameList[i].trim()
          : defaultTransitionName(i),
      levels: row,
      fadeTime: fade,
    })),
    fade,
  );
  return [
    createTune({
      name: defaultTuneName(0),
      transitions,
      defaultFadeTime: fade,
    }),
  ];
}

/**
 * @param {Tune[]} tunes
 * @param {string | null | undefined} activeTuneId
 * @returns {Tune}
 */
export function resolveActiveTune(tunes, activeTuneId) {
  const list = normalizeTunes(tunes);
  if (activeTuneId) {
    const found = list.find((tune) => tune.id === activeTuneId);
    if (found) return found;
  }
  return list[0];
}

/**
 * Reorder tunes in place.
 * @param {Tune[]} tunes
 * @param {string} fromId
 * @param {string} toId
 * @param {boolean} after
 */
export function moveTune(tunes, fromId, toId, after) {
  if (!fromId || !toId || fromId === toId) return false;
  const fromIndex = tunes.findIndex((tune) => tune.id === fromId);
  const toIndex = tunes.findIndex((tune) => tune.id === toId);
  if (fromIndex < 0 || toIndex < 0) return false;
  const [item] = tunes.splice(fromIndex, 1);
  let insertAt = tunes.findIndex((tune) => tune.id === toId);
  if (insertAt < 0) return false;
  if (after) insertAt += 1;
  tunes.splice(insertAt, 0, item);
  return true;
}

/**
 * Reorder transitions within a tune.
 * @param {Tune} tune
 * @param {string} fromId
 * @param {string} toId
 * @param {boolean} after
 */
export function moveTransition(tune, fromId, toId, after) {
  if (!fromId || !toId || fromId === toId) return false;
  const list = tune.transitions;
  const fromIndex = list.findIndex((item) => item.id === fromId);
  const toIndex = list.findIndex((item) => item.id === toId);
  if (fromIndex < 0 || toIndex < 0) return false;
  const [item] = list.splice(fromIndex, 1);
  let insertAt = list.findIndex((entry) => entry.id === toId);
  if (insertAt < 0) return false;
  if (after) insertAt += 1;
  list.splice(insertAt, 0, item);
  return true;
}

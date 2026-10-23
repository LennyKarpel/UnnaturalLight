import { DMX_CHANNEL_MAX } from "./patch.js";

export const MOUNT_TYPES = /** @type {const} */ (["fixed", "movable"]);
export const COLOR_MODES = /** @type {const} */ (["single", "multi"]);
export const MAX_INSTRUMENTS = 64;
export const MAX_INSTRUMENT_GROUPS = 32;
/** Max DMX channels per instrument (UI picker 1…16). */
export const MAX_INSTRUMENT_CHANNELS = 16;
/** Max instruments to create in one add-form submit. */
export const MAX_INSTRUMENT_QTY = 16;

/**
 * @typedef {"fixed" | "movable"} MountType
 * @typedef {"single" | "multi"} ColorMode
 * @typedef {{
 *   id: string,
 *   name: string,
 * }} InstrumentGroup
 * @typedef {{
 *   id: string,
 *   name: string,
 *   mount: MountType,
 *   color: ColorMode,
 *   channelStart: number,
 *   channelEnd: number,
 *   groupId: string | null,
 * }} Instrument
 */

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
export function newInstrumentId() {
  return newId("inst");
}

/** @returns {string} */
export function newGroupId() {
  return newId("grp");
}

/** @param {unknown} value @returns {MountType} */
export function normalizeMount(value) {
  return value === "movable" ? "movable" : "fixed";
}

/** @param {unknown} value @returns {ColorMode} */
export function normalizeColorMode(value) {
  return value === "multi" ? "multi" : "single";
}

/** @param {unknown} value @returns {number | null} */
function clampChannel(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1 || n > DMX_CHANNEL_MAX) return null;
  return n;
}

/**
 * @param {unknown} start
 * @param {unknown} end
 * @returns {{ channelStart: number, channelEnd: number } | null}
 */
export function normalizeChannelRange(start, end) {
  let a = clampChannel(start);
  let b = clampChannel(end);
  if (a == null && b == null) return null;
  if (a == null) a = b;
  if (b == null) b = a;
  if (a == null || b == null) return null;
  return a <= b
    ? { channelStart: a, channelEnd: b }
    : { channelStart: b, channelEnd: a };
}

/**
 * @param {unknown} start
 * @param {unknown} count
 * @returns {{ channelStart: number, channelEnd: number } | null}
 */
export function normalizeChannelSpan(start, count) {
  const channelStart = clampChannel(start);
  const n = Math.round(Number(count));
  if (
    channelStart == null ||
    !Number.isFinite(n) ||
    n < 1 ||
    n > MAX_INSTRUMENT_CHANNELS
  ) {
    return null;
  }
  const channelEnd = channelStart + n - 1;
  if (channelEnd > DMX_CHANNEL_MAX) return null;
  return { channelStart, channelEnd };
}

/** @param {Pick<Instrument, "channelStart" | "channelEnd">} instrument */
export function channelCount(instrument) {
  return instrument.channelEnd - instrument.channelStart + 1;
}

/**
 * @param {number} startA
 * @param {number} endA
 * @param {number} startB
 * @param {number} endB
 */
export function rangesOverlap(startA, endA, startB, endB) {
  return startA <= endB && startB <= endA;
}

/**
 * @param {Pick<Instrument, "channelStart" | "channelEnd" | "id">[]} instruments
 * @param {number} start
 * @param {number} end
 * @param {string} [excludeId]
 * @returns {Instrument | null}
 */
export function findRangeConflict(instruments, start, end, excludeId) {
  for (const instrument of instruments) {
    if (excludeId && instrument.id === excludeId) continue;
    if (
      rangesOverlap(
        start,
        end,
        instrument.channelStart,
        instrument.channelEnd,
      )
    ) {
      return /** @type {Instrument} */ (instrument);
    }
  }
  return null;
}

/**
 * First free contiguous block of `width` channels in 1…512.
 * @param {Pick<Instrument, "channelStart" | "channelEnd">[]} instruments
 * @param {number} [width]
 * @returns {{ channelStart: number, channelEnd: number } | null}
 */
export function nextAvailableRange(instruments, width = 1) {
  const size = Math.max(1, Math.min(DMX_CHANNEL_MAX, Math.round(Number(width) || 1)));
  const occupied = new Array(DMX_CHANNEL_MAX + 1).fill(false);
  for (const instrument of instruments) {
    for (let ch = instrument.channelStart; ch <= instrument.channelEnd; ch++) {
      if (ch >= 1 && ch <= DMX_CHANNEL_MAX) occupied[ch] = true;
    }
  }
  for (let start = 1; start <= DMX_CHANNEL_MAX - size + 1; start++) {
    let free = true;
    for (let ch = start; ch < start + size; ch++) {
      if (occupied[ch]) {
        free = false;
        break;
      }
    }
    if (free) {
      return { channelStart: start, channelEnd: start + size - 1 };
    }
  }
  return null;
}

/** @param {unknown} name @param {number} [index] */
export function normalizeGroupName(name, index = 0) {
  const text = typeof name === "string" ? name.trim().slice(0, 40) : "";
  return text || `Group ${index + 1}`;
}

/**
 * @param {unknown} value
 * @param {number} [index]
 * @returns {InstrumentGroup | null}
 */
export function normalizeInstrumentGroup(value, index = 0) {
  if (!value || typeof value !== "object") return null;
  const obj = /** @type {Record<string, unknown>} */ (value);
  const id =
    typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : newGroupId();
  return {
    id,
    name: normalizeGroupName(obj.name, index),
  };
}

/**
 * @param {unknown} list
 * @returns {InstrumentGroup[]}
 */
export function normalizeInstrumentGroups(list) {
  if (!Array.isArray(list)) return [];
  /** @type {InstrumentGroup[]} */
  const out = [];
  const seen = new Set();
  for (let i = 0; i < list.length && out.length < MAX_INSTRUMENT_GROUPS; i++) {
    const raw = normalizeInstrumentGroup(list[i], i);
    if (!raw) continue;
    let id = raw.id;
    while (seen.has(id)) id = newGroupId();
    seen.add(id);
    out.push({ id, name: raw.name });
  }
  return out;
}

/**
 * @param {{ name: string }} opts
 * @returns {InstrumentGroup}
 */
export function createInstrumentGroup({ name }) {
  return {
    id: newGroupId(),
    name: normalizeGroupName(name),
  };
}

/**
 * @param {Pick<Instrument, "groupId">[]} instruments
 * @param {string | null} groupId
 */
export function instrumentsInGroup(instruments, groupId) {
  return instruments.filter((item) => (item.groupId ?? null) === groupId);
}

/**
 * @param {unknown} value
 * @param {number} [index]
 * @returns {(Omit<Instrument, "channelStart" | "channelEnd" | "groupId"> & {
 *   channelStart?: number,
 *   channelEnd?: number,
 *   groupId?: string | null,
 * }) | null}
 */
export function normalizeInstrument(value, index = 0) {
  if (!value || typeof value !== "object") return null;
  const obj = /** @type {Record<string, unknown>} */ (value);
  const name =
    typeof obj.name === "string" && obj.name.trim()
      ? obj.name.trim().slice(0, 40)
      : `Instrument ${index + 1}`;
  const id =
    typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : newInstrumentId();
  const range = normalizeChannelRange(
    obj.channelStart ?? obj.start,
    obj.channelEnd ?? obj.end,
  );
  const groupId =
    typeof obj.groupId === "string" && obj.groupId.trim()
      ? obj.groupId.trim()
      : null;
  return {
    id,
    name,
    mount: normalizeMount(obj.mount),
    color: normalizeColorMode(obj.color),
    groupId,
    ...(range ?? {}),
  };
}

/**
 * @param {unknown} list
 * @param {InstrumentGroup[]} [groups]
 * @returns {Instrument[]}
 */
export function normalizeInstruments(list, groups = []) {
  if (!Array.isArray(list)) return [];
  const groupIds = new Set(groups.map((group) => group.id));
  /** @type {Instrument[]} */
  const out = [];
  const seen = new Set();

  for (let i = 0; i < list.length && out.length < MAX_INSTRUMENTS; i++) {
    const raw = normalizeInstrument(list[i], i);
    if (!raw) continue;
    let id = raw.id;
    while (seen.has(id)) id = newInstrumentId();
    seen.add(id);

    const width =
      raw.channelStart != null && raw.channelEnd != null
        ? raw.channelEnd - raw.channelStart + 1
        : 1;
    let range =
      raw.channelStart != null && raw.channelEnd != null
        ? { channelStart: raw.channelStart, channelEnd: raw.channelEnd }
        : null;

    if (
      !range ||
      findRangeConflict(out, range.channelStart, range.channelEnd)
    ) {
      range = nextAvailableRange(out, width);
    }
    if (!range) continue;

    const groupId =
      raw.groupId && groupIds.has(raw.groupId) ? raw.groupId : null;

    out.push({
      id,
      name: raw.name,
      mount: raw.mount,
      color: raw.color,
      channelStart: range.channelStart,
      channelEnd: range.channelEnd,
      groupId,
    });
  }

  return out;
}

/**
 * @param {{
 *   name: string,
 *   mount?: MountType,
 *   color?: ColorMode,
 *   channelStart: number,
 *   channelEnd: number,
 *   groupId?: string | null,
 * }} opts
 * @returns {Instrument}
 */
export function createInstrument({
  name,
  mount = "fixed",
  color = "single",
  channelStart,
  channelEnd,
  groupId = null,
}) {
  const text = typeof name === "string" ? name.trim().slice(0, 40) : "";
  const range = normalizeChannelRange(channelStart, channelEnd);
  if (!range) {
    throw new Error("Instrument needs a valid channel range.");
  }
  return {
    id: newInstrumentId(),
    name: text || "Instrument",
    mount: normalizeMount(mount),
    color: normalizeColorMode(color),
    channelStart: range.channelStart,
    channelEnd: range.channelEnd,
    groupId: typeof groupId === "string" && groupId ? groupId : null,
  };
}

/** @param {Pick<Instrument, "channelStart" | "channelEnd">} instrument */
export function formatChannelRange(instrument) {
  const count = channelCount(instrument);
  if (count === 1) return `Ch${instrument.channelStart}`;
  return `Ch${instrument.channelStart}×${count}`;
}

/** @param {MountType} mount */
export function mountLabel(mount) {
  return mount === "movable" ? "Movable" : "Fixed";
}

/** @param {ColorMode} color */
export function colorModeLabel(color) {
  return color === "multi" ? "Multi-color" : "Single color";
}

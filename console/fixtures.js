import { DMX_CHANNEL_MAX, UNIVERSE_SIZE, channelLimit, universeOf, universeStart, formatAddress, clampChannel as wholeChannel } from "./patch.js";
import { newId } from "../shared/ids.js";

export const MAX_FIXTURES = 64;
export const MAX_FIXTURE_GROUPS = 32;
/** Max DMX channels per fixture (UI picker 1…64; real moving lights often use 20–40). */
export const MAX_FIXTURE_CHANNELS = 64;
/** Max fixtures to create in one add-form submit. */
export const MAX_FIXTURE_QTY = 16;

/**
 * @typedef {"fixed" | "movable"} MountType
 * @typedef {"single" | "multi"} ColorMode
 * @typedef {{
 *   id: string,
 *   name: string,
 * }} FixtureGroup
 * @typedef {{
 *   id: string,
 *   name: string,
 *   mount: MountType,
 *   color: ColorMode,
 *   channelStart: number,
 *   channelEnd: number,
 *   groupId: string | null,
 *   roles?: (ChannelRole | null)[],
 * }} Fixture
 * @typedef {"dimmer" | "pan" | "tilt" | "red" | "green" | "blue" | "zoom"} ChannelRole
 * roles: what each channel of the block does, when known (lights registered
 * from the stage); used e.g. to show R/G/B faders as a color picker.
 */

const CHANNEL_ROLES = ["dimmer", "pan", "tilt", "red", "green", "blue", "zoom"];

/** @param {unknown} list @returns {(ChannelRole | null)[]} */
function normalizeRoles(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_FIXTURE_CHANNELS).map((r) => (CHANNEL_ROLES.includes(r) ? r : null));
}

/** @returns {string} */
function newFixtureId() {
  return newId("fixture");
}

/** @returns {string} */
function newGroupId() {
  return newId("group");
}

/** @param {unknown} value @returns {MountType} */
export function normalizeMount(value) {
  return value === "movable" ? "movable" : "fixed";
}

/** @param {unknown} value @returns {ColorMode} */
export function normalizeColorMode(value) {
  return value === "multi" ? "multi" : "single";
}

/** A channel number (rounded), or null when it isn't one. @param {unknown} value @returns {number | null} */
const clampChannel = (value) => wholeChannel(Math.round(Number(value)));

/**
 * @param {unknown} start
 * @param {unknown} end
 * @returns {{ channelStart: number, channelEnd: number } | null}
 */
function normalizeChannelRange(start, end) {
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
    n > MAX_FIXTURE_CHANNELS
  ) {
    return null;
  }
  const channelEnd = channelStart + n - 1;
  if (channelEnd > DMX_CHANNEL_MAX) return null;
  // A block stays inside one universe.
  if (universeOf(channelStart) !== universeOf(channelEnd)) return null;
  return { channelStart, channelEnd };
}

/** @param {Pick<Fixture, "channelStart" | "channelEnd">} fixture */
export function channelCount(fixture) {
  return fixture.channelEnd - fixture.channelStart + 1;
}

/**
 * @param {number} startA
 * @param {number} endA
 * @param {number} startB
 * @param {number} endB
 */
function rangesOverlap(startA, endA, startB, endB) {
  return startA <= endB && startB <= endA;
}

/**
 * @param {Pick<Fixture, "channelStart" | "channelEnd" | "id">[]} fixtures
 * @param {number} start
 * @param {number} end
 * @param {string} [excludeId]
 * @returns {Fixture | null}
 */
export function findRangeConflict(fixtures, start, end, excludeId) {
  for (const fixture of fixtures) {
    if (excludeId && fixture.id === excludeId) continue;
    if (
      rangesOverlap(
        start,
        end,
        fixture.channelStart,
        fixture.channelEnd,
      )
    ) {
      return /** @type {Fixture} */ (fixture);
    }
  }
  return null;
}

/**
 * First free contiguous block of `width` channels, inside one universe
 * (only `universe` if given; else the first universe with room).
 * @param {Pick<Fixture, "channelStart" | "channelEnd">[]} fixtures
 * @param {number} [width]
 * @returns {{ channelStart: number, channelEnd: number } | null}
 */
export function nextAvailableRange(fixtures, width = 1, universe = null) {
  const size = Math.max(1, Math.min(UNIVERSE_SIZE, Math.round(Number(width) || 1)));
  const occupied = new Array(DMX_CHANNEL_MAX + 1).fill(false);
  for (const fixture of fixtures) {
    for (let ch = fixture.channelStart; ch <= fixture.channelEnd; ch++) {
      if (ch >= 1 && ch <= DMX_CHANNEL_MAX) occupied[ch] = true;
    }
  }
  const first = universe ? universeStart(universe) : 1;
  const last = universe ? universeStart(universe) + UNIVERSE_SIZE - 1 : channelLimit();
  for (let start = first; start <= last - size + 1; start++) {
    if (universeOf(start) !== universeOf(start + size - 1)) continue;
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
function normalizeGroupName(name, index = 0) {
  const text = typeof name === "string" ? name.trim().slice(0, 40) : "";
  return text || `Group ${index + 1}`;
}

/**
 * @param {unknown} value
 * @param {number} [index]
 * @returns {FixtureGroup | null}
 */
function normalizeFixtureGroup(value, index = 0) {
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
 * @returns {FixtureGroup[]}
 */
export function normalizeFixtureGroups(list) {
  if (!Array.isArray(list)) return [];
  /** @type {FixtureGroup[]} */
  const out = [];
  const seen = new Set();
  for (let i = 0; i < list.length && out.length < MAX_FIXTURE_GROUPS; i++) {
    const raw = normalizeFixtureGroup(list[i], i);
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
 * @returns {FixtureGroup}
 */
export function createFixtureGroup({ name }) {
  return {
    id: newGroupId(),
    name: normalizeGroupName(name),
  };
}

/**
 * @param {Pick<Fixture, "groupId">[]} fixtures
 * @param {string | null} groupId
 */
export function fixturesInGroup(fixtures, groupId) {
  return fixtures.filter((item) => (item.groupId ?? null) === groupId);
}

/**
 * @param {unknown} value
 * @param {number} [index]
 * @returns {(Omit<Fixture, "channelStart" | "channelEnd" | "groupId"> & {
 *   channelStart?: number,
 *   channelEnd?: number,
 *   groupId?: string | null,
 * }) | null}
 */
export function normalizeFixture(value, index = 0) {
  if (!value || typeof value !== "object") return null;
  const obj = /** @type {Record<string, unknown>} */ (value);
  const name =
    typeof obj.name === "string" && obj.name.trim()
      ? obj.name.trim().slice(0, 40)
      : `Fixture ${index + 1}`;
  const id =
    typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : newFixtureId();
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
    roles: normalizeRoles(obj.roles),
    ...(range ?? {}),
  };
}

/**
 * @param {unknown} list
 * @param {FixtureGroup[]} [groups]
 * @returns {Fixture[]}
 */
export function normalizeFixtures(list, groups = []) {
  if (!Array.isArray(list)) return [];
  const groupIds = new Set(groups.map((group) => group.id));
  /** @type {Fixture[]} */
  const out = [];
  const seen = new Set();

  for (let i = 0; i < list.length && out.length < MAX_FIXTURES; i++) {
    const raw = normalizeFixture(list[i], i);
    if (!raw) continue;
    let id = raw.id;
    while (seen.has(id)) id = newFixtureId();
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
      roles: raw.roles.slice(0, range.channelEnd - range.channelStart + 1),
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
 *   roles?: unknown,
 * }} opts
 * @returns {Fixture}
 */
export function createFixture({
  name,
  mount = "fixed",
  color = "single",
  channelStart,
  channelEnd,
  groupId = null,
  roles = [],
}) {
  const text = typeof name === "string" ? name.trim().slice(0, 40) : "";
  const range = normalizeChannelRange(channelStart, channelEnd);
  if (!range) {
    throw new Error("Fixture needs a valid channel range.");
  }
  return {
    id: newFixtureId(),
    name: text || "Fixture",
    mount: normalizeMount(mount),
    color: normalizeColorMode(color),
    channelStart: range.channelStart,
    channelEnd: range.channelEnd,
    groupId: typeof groupId === "string" && groupId ? groupId : null,
    roles: normalizeRoles(roles),
  };
}

/** @param {Pick<Fixture, "channelStart" | "channelEnd">} fixture */
export function formatChannelRange(fixture) {
  const count = channelCount(fixture);
  if (count === 1) return `Ch${formatAddress(fixture.channelStart)}`;
  return `Ch${formatAddress(fixture.channelStart)}×${count}`;
}

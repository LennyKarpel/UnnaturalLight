import { DMX_CHANNEL_MAX, UNIVERSE_SIZE, channelLimit, universeOf, universeStart, formatAddress, clampChannel as wholeChannel } from "./patch.ts";
import { newId } from "../shared/ids.ts";
import { isDmxAttr, type DmxAttr } from "../shared/attributes.ts";
import { isRecord } from "../shared/guards.ts";
import { clampInt } from "../shared/numbers.ts";

export const MAX_FIXTURES = 64;
export const MAX_FIXTURE_GROUPS = 32;
/** Max DMX channels per fixture (UI picker 1…64; real moving lights often use 20–40). */
export const MAX_FIXTURE_CHANNELS = 64;
/** Max fixtures to create in one add-form submit. */
export const MAX_FIXTURE_QTY = 16;

export type MountType = "fixed" | "movable";
export type ColorMode = "single" | "multi";
export type FixtureGroup = {
  id: string;
  name: string;
};
export type Fixture = {
  id: string;
  name: string;
  mount: MountType;
  color: ColorMode;
  channelStart: number;
  channelEnd: number;
  groupId: string | null;
  roles?: (ChannelRole | null)[];
};
/** roles: what each channel of the block does, when known (fixtures registered
 * from the stage); used e.g. to show a fixture's color faders as a color picker. */
export type ChannelRole = DmxAttr;

export function normalizeRoles(list: unknown): (ChannelRole | null)[] {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_FIXTURE_CHANNELS).map((r) => (isDmxAttr(r) ? r : null));
}

function newFixtureId(): string {
  return newId("fixture");
}

function newGroupId(): string {
  return newId("group");
}

export function normalizeMount(value: unknown): MountType {
  return value === "movable" ? "movable" : "fixed";
}

export function normalizeColorMode(value: unknown): ColorMode {
  return value === "multi" ? "multi" : "single";
}

/** A channel number (rounded), or null when it isn't one. */
const clampChannel = (value: unknown): number | null => wholeChannel(Math.round(Number(value)));

/** A block of channels (first and last, inclusive). */
export type ChannelRange = Pick<Fixture, "channelStart" | "channelEnd">;

function normalizeChannelRange(start: unknown, end: unknown): ChannelRange | null {
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

export function normalizeChannelSpan(start: unknown, count: unknown): ChannelRange | null {
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

export function channelCount(fixture: ChannelRange) {
  return fixture.channelEnd - fixture.channelStart + 1;
}

function rangesOverlap(startA: number, endA: number, startB: number, endB: number) {
  return startA <= endB && startB <= endA;
}

export function findRangeConflict<F extends ChannelRange & { id: string }>(fixtures: F[], start: number, end: number, excludeId?: string): F | null {
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
      return fixture;
    }
  }
  return null;
}

/**
 * First free contiguous block of `width` channels, inside one universe
 * (only `universe` if given; else the first universe with room).
 */
export function nextAvailableRange(fixtures: ChannelRange[], width = 1, universe: number | null = null): ChannelRange | null {
  const size = clampInt(Number(width) || 1, 1, UNIVERSE_SIZE);
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

function normalizeGroupName(name: unknown, index = 0) {
  const text = typeof name === "string" ? name.trim().slice(0, 40) : "";
  return text || `Group ${index + 1}`;
}

function normalizeFixtureGroup(value: unknown, index = 0): FixtureGroup | null {
  if (!isRecord(value)) return null;
  const obj = value;
  const id =
    typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : newGroupId();
  return {
    id,
    name: normalizeGroupName(obj.name, index),
  };
}

export function normalizeFixtureGroups(list: unknown): FixtureGroup[] {
  if (!Array.isArray(list)) return [];
  const out: FixtureGroup[] = [];
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

export function createFixtureGroup({ name }: { name: string }): FixtureGroup {
  return {
    id: newGroupId(),
    name: normalizeGroupName(name),
  };
}

export function fixturesInGroup<F extends Pick<Fixture, "groupId">>(fixtures: F[], groupId: string | null): F[] {
  return fixtures.filter((item) => (item.groupId ?? null) === groupId);
}

export function normalizeFixture(value: unknown, index = 0): (Omit<Fixture, "channelStart" | "channelEnd" | "groupId"> & {
  channelStart?: number;
  channelEnd?: number;
  groupId?: string | null;
}) | null {
  if (!isRecord(value)) return null;
  const obj = value;
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

export function normalizeFixtures(list: unknown, groups: FixtureGroup[] = []): Fixture[] {
  if (!Array.isArray(list)) return [];
  const groupIds = new Set(groups.map((group) => group.id));
  const out: Fixture[] = [];
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
      roles: (raw.roles ?? []).slice(0, range.channelEnd - range.channelStart + 1),
    });
  }

  return out;
}

export function createFixture({
  name,
  mount = "fixed",
  color = "single",
  channelStart,
  channelEnd,
  groupId = null,
  roles = [],
}: {
    name: string;
    mount?: MountType;
    color?: ColorMode;
    channelStart: number;
    channelEnd: number;
    groupId?: string | null;
    roles?: unknown;
  }): Fixture {
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

export function formatChannelRange(fixture: ChannelRange) {
  const count = channelCount(fixture);
  if (count === 1) return `Ch${formatAddress(fixture.channelStart)}`;
  return `Ch${formatAddress(fixture.channelStart)}×${count}`;
}

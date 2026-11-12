// The stage's data (box, fixtures, rigs, selection), saving it, and rig helpers.
import {
  STORAGE_KEY,
  MAX_FIXTURES,
  round,
  createFixture,
  parseStage,
  serializeStage,
  DEFAULT_TRANSPARENT,
  RIG_TYPES,
  applyRig,
  rigLowestY,
  normalizeRig,
  deriveFromDmx,
  zoomFromBeam,
  applyFixture,
  type Box,
  type ConsoleType,
  type DmxValues,
  type Fixture,
  type Rig,
  type RigType,
  type Transparent,
  type StagePosition,
} from "./stage-model.ts";
import type { FixtureProfile } from "./fixture-library.ts";
import type { Riser } from "./risers.ts";
import type { createShowLink } from "./show-link.ts";
import { clamp, numberFrom } from "../shared/numbers.ts";
import { COLOR_ROLES } from "../shared/color.ts";
import { PLACE_OFFSET } from "./view3d.ts";
import { renderInspector } from "./sidebar.ts";
import { changed, setBanner, setPlacing } from "./actions.ts";
import { consoleLink, requestRegistrations } from "./link.ts";
import { readStoredJson, storeJson } from "../shared/storage.ts";

export type { Fixture, Rig };

/** The stage's data. */
export const state: {
  box: Box;
  fixtures: Fixture[];
  /** Selected fixtures' ids. */
  selected: string[];
  /** Which box sides are transparent (floor is always solid). */
  transparent: Transparent;
  rigs: Rig[];
  /** Named spots to aim at. */
  positions: StagePosition[];
  /** Boxes standing on the floor (platforms, drum risers). */
  risers: Riser[];
} = {
  box: { w: 12, d: 8, h: 6 },
  fixtures: [],
  selected: [],
  transparent: { ...DEFAULT_TRANSPARENT },
  rigs: [],
  positions: [],
  risers: [],
};

/** A rig's settings from the Place rig dialog. */
export type RigSettings = {
  type: RigType;
  size: number;
  count: number;
  tilt: number;
  yaw: number;
  consoleType: ConsoleType | null;
  fixture: FixtureProfile | null;
  universe: number | null;
};

/** What the stage is in the middle of, shared by its modules. */
export const ui: {
  placing: boolean;
  /** Placing a position (with `placing`): a click puts a position on the surface it lands on. */
  placingPosition: boolean;
  /** Placing a riser (with `placing`): a click puts a riser's center there, on the floor. */
  placingRiser: boolean;
  /** While placing a rig: its settings from the Place rig dialog (else null). */
  placingRig: RigSettings | null;
  aiming: boolean;
  /** The position being looked at (list, plan, 3D), or null. */
  activePosition: string | null;
  /** The position under the pointer (3D, plan or its row in the list), or null: it's lit up. */
  hoverPosition: string | null;
  /** The fixture / riser under the pointer (3D or plan), or null: it's named (see names.ts). */
  hoverFixture: string | null;
  hoverRiser: string | null;
  /** The riser picked out (list, plan, 3D), or null. */
  activeRiser: string | null;
  /** Set up at boot (stage.ts): keeps the stage with the show on the show server. */
  showLink: ReturnType<typeof createShowLink> | null;
} = {
  placing: false,
  placingPosition: false,
  placingRiser: false,
  placingRig: null,
  aiming: false,
  activePosition: null,
  hoverPosition: null,
  hoverFixture: null,
  hoverRiser: null,
  activeRiser: null,
  showLink: null,
};

export function loadData(data: unknown) {
  const { box, fixtures, transparent, rigs, positions, risers } = parseStage(data);
  state.box = box;
  state.positions = positions;
  state.risers = risers;
  state.transparent = transparent;
  state.rigs = rigs;
  state.fixtures = fixtures;
  state.selected = fixtures.length ? [fixtures[0].id] : [];
}

export const serialize = () => serializeStage(state.box, state.fixtures, state.transparent, state.rigs, state.positions, state.risers);

let saveTimer = 0;
let shareQueued = false;
/**
 * Save the stage in this browser and (`share`: an edit made here) on the
 * show server, for other app windows and the set file. Values that only
 * followed the console aren't shared: the console has them, and every open
 * app window would otherwise send the whole stage many times a second.
 */
export function save({ share = true } = {}) {
  shareQueued ||= share;
  clearTimeout(saveTimer);
  savePending = true;
  saveTimer = window.setTimeout(saveNow, 200);
}

let savePending = false;
function saveNow() {
  clearTimeout(saveTimer);
  savePending = false;
  const data = serialize();
  storeJson(STORAGE_KEY, data);
  if (shareQueued) ui.showLink?.send(data);
  shareQueued = false;
}

// Closing or reloading the window: send a change still waiting out the
// 200 ms above now, so the last edit isn't lost.
window.addEventListener("pagehide", () => { if (savePending) saveNow(); });

export function restore() {
  const saved = readStoredJson(STORAGE_KEY);
  if (saved) {
    try { loadData(saved); return; } catch { /* fall through to demo */ }
  }
  loadData({ box: { w: 12, d: 8, h: 6 } });
  for (const [x, y, z] of [[-3, 5.7, 2.5], [3, 5.7, 2.5], [0, 4.5, 7]]) {
    state.fixtures.push(createFixture(x, y, z, state.fixtures.length, state.box));
  }
  state.fixtures[2].name = "FOH";
  state.selected = [state.fixtures[0].id];
}

export const positionById = (id: string | null | undefined): StagePosition | undefined => state.positions.find((p) => p.id === id);

export const riserById = (id: string | null | undefined): Riser | undefined => state.risers.find((r) => r.id === id);

export const byId = (id: string | null | undefined): Fixture | undefined => state.fixtures.find((i) => i.id === id);
export const selectedFixtures = (): Fixture[] => state.selected.map(byId).filter((f) => f != null);

// ---------------------------------------------------------------------
// Rigs
// ---------------------------------------------------------------------

export const rigById = (id: string | null | undefined): Rig | undefined => state.rigs.find((r) => r.id === id);
export const rigOf = (fixture: Fixture | null | undefined): Rig | null => (fixture?.rigId ? rigById(fixture.rigId) ?? null : null);
export const rigMembers = (rig: Rig): Fixture[] => state.fixtures.filter((i) => i.rigId === rig.id).sort((a, b) => a.rigIndex - b.rigIndex);
export const syncRig = (rig: Rig) => applyRig(rig, rigMembers(rig));

/** The rig every selected fixture belongs to, if they all share one. */
export function commonRig(sel: Fixture[]): Rig | null {
  const rig = rigOf(sel[0]);
  return rig && sel.every((i) => i.rigId === rig.id) ? rig : null;
}

/**
 * Move a fixture. A rig member can't move on its own, so the whole rig
 * shifts by the same amount instead.
 */
export function moveFixture(fixture: Fixture, x: number, y: number, z: number) {
  const rig = rigOf(fixture);
  if (!rig) { fixture.x = x; fixture.y = y; fixture.z = z; return; }
  rig.x = round(rig.x + x - fixture.x, 3);
  rig.y = round(rig.y + y - fixture.y, 3);
  rig.z = round(rig.z + z - fixture.z, 3);
  syncRig(rig);
}

/** Make a member fixture for `rig` at slot `k`, copying the look of `like`. */
type MemberLook = Pick<Fixture, "panLimit" | "tiltLimit" | "zoomMin" | "zoomMax" | "dimmerCurve"> & { dmx: Partial<DmxValues> };

function makeRigMember(rig: Rig, k: number, like: MemberLook): Fixture {
  const fixture = createFixture(0, 0, 0, state.fixtures.length, state.box);
  Object.assign(fixture, {
    name: `${rig.name} · ${k + 1}`,
    rigId: rig.id, rigIndex: k, follow: null,
    panLimit: like.panLimit, tiltLimit: like.tiltLimit, zoomMin: like.zoomMin, zoomMax: like.zoomMax, dimmerCurve: like.dimmerCurve,
  });
  for (const a of ["dimmer", "zoom", ...COLOR_ROLES] as const) fixture.dmx[a] = like.dmx[a] ?? 0;
  deriveFromDmx(fixture);
  fixture.link.register = rig.consoleType ?? null;
  fixture.link.universe = rig.universe ?? null;
  if (rig.fixture) applyFixture(fixture, rig.fixture);
  return fixture;
}

/** Create a rig centered at (x, y, z) from the Place rig dialog's settings. */
export function addRigAt(cfg: RigSettings, x: number, y: number, z: number) {
  const room = MAX_FIXTURES - state.fixtures.length;
  if (cfg.count > room) {
    setPlacing(false);
    setBanner(`Not enough room: this rig needs ${cfg.count} fixtures, ${room} left (max ${MAX_FIXTURES})`, 4000);
    return;
  }
  const n = state.rigs.length;
  const sameType = state.rigs.filter((r) => r.type === cfg.type).length;
  const name = `${RIG_TYPES[cfg.type].prefix} ${sameType + 1}`;
  const rig = normalizeRig({ ...cfg, name, x: round(x, 2), y: round(y, 2), z: round(z, 2) }, n);
  // Keep an upright / tilted rig above the floor.
  const low = rigLowestY(rig);
  if (low < PLACE_OFFSET) rig.y = round(rig.y + PLACE_OFFSET - low, 2);
  const like: MemberLook = {
    dmx: { dimmer: 255, red: 255, green: 255, blue: 255, zoom: zoomFromBeam(24, 5, 60) },
    panLimit: 270, tiltLimit: 135, zoomMin: 5, zoomMax: 60, dimmerCurve: "linear",
  };
  const members = Array.from({ length: rig.count }, (_, k) => makeRigMember(rig, k, like));
  state.rigs.push(rig);
  state.fixtures.push(...members);
  syncRig(rig);
  setPlacing(false);
  state.selected = members.map((m) => m.id);
  renderInspector();
  changed();
  requestRegistrations();
}

/** Change how many fixtures a rig has; extras copy the first member's look. */
function setRigCount(rig: Rig, n: number) {
  const members = rigMembers(rig);
  const max = MAX_FIXTURES - state.fixtures.length + members.length;
  n = clamp(Math.round(n), 2, max);
  if (n === members.length) return;
  if (n < members.length) {
    const dropped = members.slice(n);
    const drop = new Set(dropped.map((m) => m.id));
    state.fixtures = state.fixtures.filter((i) => !drop.has(i.id));
    state.selected = state.selected.filter((id) => !drop.has(id));
    consoleLink.unregister(dropped.flatMap((m) => (m.link.owned && m.link.consoleId ? [m.link.consoleId] : [])));
  } else {
    for (let k = members.length; k < n; k++) state.fixtures.push(makeRigMember(rig, k, members[0]));
  }
  rig.count = n;
  syncRig(rig);
  requestRegistrations();
}

/** The rig fields the inspector edits (its inputs' `data-r`). */
export const RIG_FIELDS = ["name", "x", "y", "z", "size", "count", "tilt", "yaw"] as const;
export type RigField = (typeof RIG_FIELDS)[number];

export function setRigField(rig: Rig, k: RigField, raw: string) {
  if (k === "name") {
    rig.name = raw;
    rigMembers(rig).forEach((m, i) => { m.name = `${raw} · ${i + 1}`; });
    return;
  }
  const v = numberFrom(raw);
  if (v == null) return;
  if (k === "count") setRigCount(rig, v);
  else if (k === "size") rig.size = clamp(v, 0.5, 50);
  else if (k === "tilt") rig.tilt = clamp(v, -90, 90);
  else if (k === "yaw") rig.yaw = ((v + 180) % 360 + 360) % 360 - 180; // −180…180
  else if (k === "x" || k === "y" || k === "z") rig[k] = v;
  syncRig(rig);
}

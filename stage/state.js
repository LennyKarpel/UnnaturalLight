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
  PALETTE,
  applyRig,
  rigLowestY,
  normalizeRig,
  deriveFromDmx,
  zoomFromBeam,
  applyFixture,
} from "./stage-model.js";
import { clamp } from "../shared/numbers.js";
import { COLOR_ROLES, rgbFromHex } from "../shared/color.js";
import { PLACE_OFFSET } from "./view3d.js";
import { renderInspector } from "./sidebar.js";
import { changed, setBanner, setPlacing } from "./actions.js";
import { consoleLink, requestRegistrations } from "./link.js";

/** @typedef {import("./stage-model.js").Fixture} Fixture */
/** @typedef {import("./stage-model.js").Rig} Rig */

export const state = {
  box: { w: 12, d: 8, h: 6 },
  /** @type {Fixture[]} */
  fixtures: [],
  /** @type {string[]} */
  selected: [],
  /** Which box sides are transparent (floor is always solid). */
  transparent: { ...DEFAULT_TRANSPARENT },
  /** @type {Rig[]} */
  rigs: [],
};

/** What the stage is in the middle of, shared by its modules. */
export const ui = {
  placing: false,
  /** While placing a rig: its settings from the Place rig dialog (else null). */
  placingRig: null,
  aiming: false,
  /** Set up at boot (stage.js): keeps the stage with the show on the show server. */
  showLink: null,
};

export function loadData(data) {
  const { box, fixtures, transparent, rigs } = parseStage(data);
  state.box = box;
  state.transparent = transparent;
  state.rigs = rigs;
  state.fixtures = fixtures;
  state.selected = fixtures.length ? [fixtures[0].id] : [];
}

export const serialize = () => serializeStage(state.box, state.fixtures, state.transparent, state.rigs);

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
  saveTimer = setTimeout(() => {
    const data = serialize();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* storage unavailable */ }
    if (shareQueued) ui.showLink?.send(data);
    shareQueued = false;
  }, 200);
}

export function restore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) { loadData(JSON.parse(raw)); return; }
  } catch { /* fall through to demo */ }
  loadData({ box: { w: 12, d: 8, h: 6 } });
  for (const [x, y, z] of [[-3, 5.7, 2.5], [3, 5.7, 2.5], [0, 4.5, 7]]) {
    state.fixtures.push(createFixture(x, y, z, state.fixtures.length, state.box));
  }
  state.fixtures[2].name = "FOH";
  state.selected = [state.fixtures[0].id];
}

export const byId = (id) => state.fixtures.find((i) => i.id === id);
export const selectedFixtures = () => state.selected.map(byId).filter(Boolean);

// ---------------------------------------------------------------------
// Rigs
// ---------------------------------------------------------------------


export const rigById = (id) => state.rigs.find((r) => r.id === id);
export const rigOf = (fixture) => (fixture?.rigId ? rigById(fixture.rigId) : null);
export const rigMembers = (rig) => state.fixtures.filter((i) => i.rigId === rig.id).sort((a, b) => a.rigIndex - b.rigIndex);
export const syncRig = (rig) => applyRig(rig, rigMembers(rig));

/** The rig every selected fixture belongs to, if they all share one. */
export function commonRig(sel) {
  const rig = rigOf(sel[0]);
  return rig && sel.every((i) => i.rigId === rig.id) ? rig : null;
}

/**
 * Move a fixture. A rig member can't move on its own, so the whole rig
 * shifts by the same amount instead.
 */
export function moveFixture(fixture, x, y, z) {
  const rig = rigOf(fixture);
  if (!rig) { fixture.x = x; fixture.y = y; fixture.z = z; return; }
  rig.x = round(rig.x + x - fixture.x, 3);
  rig.y = round(rig.y + y - fixture.y, 3);
  rig.z = round(rig.z + z - fixture.z, 3);
  syncRig(rig);
}

/** Make a member fixture for `rig` at slot `k`, copying the look of `like`. */
function makeRigMember(rig, k, like) {
  const fixture = createFixture(0, 0, 0, state.fixtures.length, state.box);
  Object.assign(fixture, {
    name: `${rig.name} · ${k + 1}`,
    rigId: rig.id, rigIndex: k,
    panLimit: like.panLimit, tiltLimit: like.tiltLimit, zoomMin: like.zoomMin, zoomMax: like.zoomMax,
  });
  for (const a of ["dimmer", "zoom", ...COLOR_ROLES]) fixture.dmx[a] = like.dmx[a] ?? 0;
  deriveFromDmx(fixture);
  fixture.link.register = rig.consoleType ?? null;
  fixture.link.universe = rig.universe ?? null;
  if (rig.fixture) applyFixture(fixture, rig.fixture);
  return fixture;
}

/** Create a rig centered at (x, y, z) from the Place rig dialog's settings. */
export function addRigAt(cfg, x, y, z) {
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
  const [red, green, blue] = rgbFromHex(PALETTE[n % PALETTE.length]);
  const like = {
    dmx: { dimmer: 191, red, green, blue, zoom: zoomFromBeam(24, 5, 60) },
    panLimit: 270, tiltLimit: 135, zoomMin: 5, zoomMax: 60,
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
function setRigCount(rig, n) {
  const members = rigMembers(rig);
  const max = MAX_FIXTURES - state.fixtures.length + members.length;
  n = clamp(Math.round(n), 2, max);
  if (n === members.length) return;
  if (n < members.length) {
    const dropped = members.slice(n);
    const drop = new Set(dropped.map((m) => m.id));
    state.fixtures = state.fixtures.filter((i) => !drop.has(i.id));
    state.selected = state.selected.filter((id) => !drop.has(id));
    consoleLink.unregister(dropped.filter((m) => m.link.owned).map((m) => m.link.consoleId));
  } else {
    for (let k = members.length; k < n; k++) state.fixtures.push(makeRigMember(rig, k, members[0]));
  }
  rig.count = n;
  syncRig(rig);
  requestRegistrations();
}

export function setRigField(rig, k, raw) {
  if (k === "name") {
    rig.name = raw;
    rigMembers(rig).forEach((m, i) => { m.name = `${raw} · ${i + 1}`; });
    return;
  }
  // An emptied field (mid-edit) isn't 0: leave the value as it was.
  if (String(raw).trim() === "") return;
  const v = Number(raw);
  if (!Number.isFinite(v)) return;
  if (k === "count") setRigCount(rig, v);
  else if (k === "size") rig.size = clamp(v, 0.5, 50);
  else if (k === "tilt") rig.tilt = clamp(v, -90, 90);
  else if (k === "yaw") rig.yaw = ((v + 180) % 360 + 360) % 360 - 180; // −180…180
  else if (k === "x" || k === "y" || k === "z") rig[k] = v;
  syncRig(rig);
}

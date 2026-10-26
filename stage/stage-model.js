// Stage model: fixtures, their zero frames, pan/tilt math, and the save
// format. No DOM or rendering here; stage.js owns the view and UI state.

import * as THREE from "three";
import { normalizeProfile } from "./fixture-library.js";
import { clamp, clampByte, numberFrom } from "../shared/numbers.js";
import { COLOR_ROLES, colorFromLevels, levelsFromColor } from "../shared/color.js";
import { newId } from "../shared/ids.js";
import { DMX_ATTRS, DMX_SHORT } from "../shared/attributes.js";

// ---------------------------------------------------------------------
// Coordinates (meters): origin at floor center of the box.
//   x: stage right (−) → stage left (+)   (actor facing the audience)
//   y: floor (0) → up
//   z: upstage (−) → downstage / audience (+)
//
// Each fixture has a "zero" frame (base yaw / pitch / roll). Pan and
// tilt are measured inside that frame, so ← → and ↑ ↓ always mean the
// fixture's own left/right and up/down. Forward is local −Z.
// ---------------------------------------------------------------------

export const STORAGE_KEY = "unnaturallight.stage";
export const MAX_FIXTURES = 32;
export const DEG = Math.PI / 180;
export const FORWARD = new THREE.Vector3(0, 0, -1);

/** @typedef {{ yaw: number, pitch: number, roll: number }} Frame */
/** @typedef {(typeof DMX_ATTRS)[number]} DmxAttr */
/** @typedef {Record<DmxAttr, number>} DmxValues */
/** @typedef {{ mount: "fixed" | "movable", color: "single" | "multi" }} ConsoleType */
/** @typedef {{
 *   consoleId: string | null, start: number | null, layout: (DmxAttr | null)[],
 *   owned?: boolean, type?: ConsoleType | null, register?: ConsoleType | null,
 *   fixture?: import("./fixture-library.js").FixtureProfile | null,
 * }} Link
 * fixture: a real fixture mode (Open Fixture Library) this fixture is; its
 * channels set the console fixture's channels and fader names.
 * owned: the stage registered this console fixture (deleting the stage fixture
 * removes it there too); type: its console type; register: waiting to be
 * registered in the console (e.g. placed while the console was closed).
 */
/** @typedef {{
 *   id: string, name: string,
 *   x: number, y: number, z: number,
 *   base: Frame,
 *   dmx: DmxValues,
 *   panLimit: number, tiltLimit: number, zoomMin: number, zoomMax: number,
 *   link: Link,
 *   color: string, pan: number, tilt: number, intensity: number, beam: number,
 *   rigId: string | null, rigIndex: number,
 * }} Fixture
 * `dmx` (0–255 per attribute) is the source of truth, like a real fixture's
 * channels. color / pan / tilt (°) / intensity (0–1) / beam (°) are derived
 * from it by deriveFromDmx() and only read by the drawing code.
 */

// ---------------------------------------------------------------------
// DMX attributes (each 0–255)
// ---------------------------------------------------------------------

/** Pan / tilt value that means "at zero" (Home). */
const DMX_CENTER = 128;

/** DMX 0–255 → angle −limit…+limit, with 128 exactly 0. */
function angleFromDmx(v, limit) {
  return v >= DMX_CENTER ? ((v - DMX_CENTER) / 127) * limit : ((v - DMX_CENTER) / 128) * limit;
}

/** Angle → nearest DMX 0–255 (inverse of angleFromDmx). */
function dmxFromAngle(deg, limit) {
  if (!limit) return DMX_CENTER;
  return clampByte(deg >= 0 ? DMX_CENTER + (deg / limit) * 127 : DMX_CENTER + (deg / limit) * 128);
}

const beamFromZoom = (v, min, max) => min + (v / 255) * (max - min);
export const zoomFromBeam = (deg, min, max) => (max > min ? clampByte(((deg - min) / (max - min)) * 255) : 0);

/** Recompute the derived look / angles from the fixture's DMX values. */
export function deriveFromDmx(fixture) {
  const d = fixture.dmx;
  fixture.intensity = d.dimmer / 255;
  fixture.pan = round(angleFromDmx(d.pan, fixture.panLimit));
  fixture.tilt = round(angleFromDmx(d.tilt, fixture.tiltLimit));
  fixture.color = colorFromLevels(d);
  fixture.beam = round(beamFromZoom(d.zoom, fixture.zoomMin, fixture.zoomMax), 1);
}

/** Set one DMX attribute (clamped to 0–255) and update the derived values. */
export function setDmx(fixture, attr, v) {
  fixture.dmx[attr] = clampByte(v);
  deriveFromDmx(fixture);
}

/**
 * Set the color as hex (the picker): mixed onto the color channels the
 * fixture is linked with (red / green / blue when it has none of them).
 */
export function setColorHex(fixture, hex) {
  const linked = fixture.link.layout.filter((a) => a && COLOR_ROLES.includes(a));
  Object.assign(fixture.dmx, levelsFromColor(hex, linked.length ? linked : ["red", "green", "blue"]));
  deriveFromDmx(fixture);
}

/**
 * Channel layouts. Presets follow the console's fixture types
 * (Fixed / Movable × Single / Multi-color); `null` = channel not used.
 */
export const LAYOUT_PRESETS = {
  "fixed/single": ["dimmer"],
  "fixed/multi": ["dimmer", "red", "green", "blue"],
  "movable/single": ["dimmer", "pan", "tilt", "zoom"],
  "movable/multi": ["dimmer", "pan", "tilt", "red", "green", "blue", "zoom"],
};

/** Console types offered when placing ("none" = stage only). */
export const CONSOLE_TYPES = [
  { key: "movable/multi", label: "Movable · Multi-color · 7 ch" },
  { key: "movable/single", label: "Movable · Single color · 4 ch" },
  { key: "fixed/multi", label: "Fixed · Multi-color · 4 ch" },
  { key: "fixed/single", label: "Fixed · Single color · 1 ch" },
  { key: "none", label: "Stage only (not in the console)" },
];

/** "movable/multi" → { mount, color }; "none" / unknown → null. */
export function consoleTypeFromKey(key) {
  const [mount, color] = String(key).split("/");
  return LAYOUT_PRESETS[key] ? { mount, color } : null;
}

const consoleTypeKey = (t) => (t ? `${t.mount}/${t.color}` : "none");

/** Preset layout for a console fixture, fitted to its channel count. */
export function layoutFor(mount, color, count) {
  const preset = LAYOUT_PRESETS[`${mount === "movable" ? "movable" : "fixed"}/${color === "multi" ? "multi" : "single"}`];
  return Array.from({ length: Math.max(1, count) }, (_, k) => preset[k] ?? null);
}

/**
 * [{ channel, attr }] second channels of a color (a library fixture's
 * `also` channels, e.g. Red after Deep Red): set along with `attr` when it's
 * changed here, but not listened on (the first channel is the color).
 */
export function followerChannels(fixture) {
  const { start, fixture: profile } = fixture.link;
  if (!start || !profile) return [];
  return profile.channels.flatMap((c, k) => (c.also ? [{ channel: start + k, attr: c.also }] : []));
}

/** [{ channel, attr }] a fixture listens on / sends to (none if unlinked). */
export function linkChannels(fixture) {
  const { start, layout } = fixture.link;
  if (!start) return [];
  return layout.flatMap((attr, k) => (attr ? [{ channel: start + k, attr }] : []));
}


export const round = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;


export function baseQuat(fixture) {
  const { yaw, pitch, roll } = fixture.base;
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * DEG, yaw * DEG, roll * DEG, "YXZ"));
}

export function fullQuat(fixture) {
  const pt = new THREE.Quaternion().setFromEuler(new THREE.Euler(fixture.tilt * DEG, fixture.pan * DEG, 0, "YXZ"));
  return baseQuat(fixture).multiply(pt);
}

export function beamDir(fixture) {
  return FORWARD.clone().applyQuaternion(fullQuat(fixture));
}

/** Yaw/pitch that make local forward point along v. */
function frameFacing(v) {
  const h = Math.hypot(v.x, v.z);
  return { yaw: round(Math.atan2(-v.x, -v.z) / DEG), pitch: round(Math.atan2(v.y, h) / DEG), roll: 0 };
}

/** Where a new fixture's zero points: stage floor center (box center if it sits on the floor). */
export function defaultTarget(fixture, box) {
  return fixture.y < 0.5 ? new THREE.Vector3(0, box.h / 2, 0) : new THREE.Vector3(0, 0, 0);
}

/** Pan / tilt back to zero (DMX 128). */
export function homeFixture(fixture) {
  fixture.dmx.pan = DMX_CENTER;
  fixture.dmx.tilt = DMX_CENTER;
  deriveFromDmx(fixture);
}

export function aimZeroAt(fixture, target) {
  const v = target.clone().sub(new THREE.Vector3(fixture.x, fixture.y, fixture.z));
  if (v.lengthSq() < 1e-6) v.set(0, -1, 0);
  fixture.base = frameFacing(v);
  homeFixture(fixture);
}

export function setZeroHere(fixture) {
  const e = new THREE.Euler().setFromQuaternion(fullQuat(fixture), "YXZ");
  fixture.base = { yaw: round(e.y / DEG), pitch: round(e.x / DEG), roll: round(e.z / DEG) };
  homeFixture(fixture);
}

/**
 * Set pan/tilt (inside the fixture's zero frame) so the beam's center
 * points at `target`. The zero frame is left alone. Pan picks whichever
 * equivalent angle (±360°) is closest to the current pan. Clamped to the
 * limits; returns false if the target is out of reach. The result is
 * stored as DMX 0–255, so it lands on the nearest step.
 */
export function aimAt(fixture, target) {
  const v = target.clone().sub(new THREE.Vector3(fixture.x, fixture.y, fixture.z));
  if (v.lengthSq() < 1e-6) return false;
  v.applyQuaternion(baseQuat(fixture).invert());
  const want = frameFacing(v); // in the zero frame: yaw = pan, pitch = tilt
  let pan = null;
  for (const p of [want.yaw - 360, want.yaw, want.yaw + 360]) {
    if (Math.abs(p) > fixture.panLimit + 1e-6) continue;
    if (pan === null || Math.abs(p - fixture.pan) < Math.abs(pan - fixture.pan)) pan = p;
  }
  let reached = pan !== null;
  if (pan === null) pan = clamp(want.yaw, -fixture.panLimit, fixture.panLimit);
  const tilt = clamp(want.pitch, -fixture.tiltLimit, fixture.tiltLimit);
  if (tilt !== want.pitch) reached = false;
  fixture.dmx.pan = dmxFromAngle(pan, fixture.panLimit);
  fixture.dmx.tilt = dmxFromAngle(tilt, fixture.tiltLimit);
  deriveFromDmx(fixture);
  return reached;
}

export function isInside(fixture, box) {
  const { w, d, h } = box;
  return Math.abs(fixture.x) <= w / 2 && Math.abs(fixture.z) <= d / 2 && fixture.y >= 0 && fixture.y <= h;
}

const FACE_NAMES = {
  "x-": "Stage-right wall", "x+": "Stage-left wall",
  "y-": "Floor", "y+": "Ceiling",
  "z-": "Upstage wall", "z+": "Downstage (audience) plane",
};

/** Ray/box slab test. Returns hits along the beam axis (entry/exit). */
export function axisHits(fixture, box) {
  const { w, d, h } = box;
  const o = [fixture.x, fixture.y, fixture.z];
  const dir = beamDir(fixture);
  const dv = [dir.x, dir.y, dir.z];
  const lo = [-w / 2, 0, -d / 2];
  const hi = [w / 2, h, d / 2];
  let tMin = -Infinity, tMax = Infinity, enterAxis = -1, exitAxis = -1, enterSign = "", exitSign = "";
  for (let a = 0; a < 3; a++) {
    if (Math.abs(dv[a]) < 1e-9) {
      if (o[a] < lo[a] || o[a] > hi[a]) return [];
      continue;
    }
    let t1 = (lo[a] - o[a]) / dv[a], t2 = (hi[a] - o[a]) / dv[a];
    let s1 = "-", s2 = "+";
    if (t1 > t2) { [t1, t2] = [t2, t1]; [s1, s2] = [s2, s1]; }
    if (t1 > tMin) { tMin = t1; enterAxis = a; enterSign = s1; }
    if (t2 < tMax) { tMax = t2; exitAxis = a; exitSign = s2; }
  }
  if (tMax < Math.max(tMin, 0)) return [];
  const axes = "xyz";
  const at = (t, a, s) => ({
    t, face: FACE_NAMES[axes[a] + s],
    point: new THREE.Vector3(o[0] + dv[0] * t, o[1] + dv[1] * t, o[2] + dv[2] * t),
  });
  const hits = [];
  if (tMin > 0 && enterAxis >= 0) hits.push(at(tMin, enterAxis, enterSign));
  if (tMax > 0 && exitAxis >= 0) hits.push(at(tMax, exitAxis, exitSign));
  return hits;
}

/** `n` is the fixture's index, used for its default name. Starts at full, white. */
export function createFixture(x, y, z, n, box) {
  /** @type {Fixture} */
  const fixture = {
    id: newId("fixture"),
    name: `Fixture ${n + 1}`,
    x: round(x), y: round(y), z: round(z),
    base: { yaw: 0, pitch: 0, roll: 0 },
    dmx: { ...Object.fromEntries(DMX_ATTRS.map((a) => [a, 0])), dimmer: 255, pan: DMX_CENTER, tilt: DMX_CENTER, red: 255, green: 255, blue: 255, zoom: zoomFromBeam(24, 5, 60) },
    panLimit: 270, tiltLimit: 135, zoomMin: 5, zoomMax: 60,
    link: { consoleId: null, start: null, layout: [] },
    rigId: null, rigIndex: 0,
  };
  deriveFromDmx(fixture);
  aimZeroAt(fixture, defaultTarget(fixture, box));
  return fixture;
}

function normalizeType(raw) {
  return raw && typeof raw === "object" ? consoleTypeFromKey(consoleTypeKey(raw)) : null;
}

function normalizeLink(raw) {
  const start = Number(raw?.start);
  const layout = Array.isArray(raw?.layout) ? raw.layout.slice(0, 16).map((a) => (DMX_ATTRS.includes(a) ? a : null)) : [];
  const fixture = normalizeProfile(raw?.fixture);
  // A library fixture saved before its color channels had their attr (e.g.
  // amber, deep red): take the profile's color attrs.
  if (fixture) {
    fixture.channels.forEach((c, k) => {
      const color = (a) => COLOR_ROLES.includes(a);
      if (k < layout.length && color(c.attr) && (!layout[k] || color(layout[k]))) layout[k] = c.attr;
    });
  }
  return {
    consoleId: typeof raw?.consoleId === "string" ? raw.consoleId : null,
    // Channels run continuously across universes (513 = universe 2/1), up to 8 universes.
    start: Number.isInteger(start) && start >= 1 && start <= 4096 ? start : null,
    layout,
    /** Universe to register in (null = the console picks the first with room). */
    universe: Number.isInteger(raw?.universe) && raw.universe >= 1 && raw.universe <= 8 ? raw.universe : null,
    owned: raw?.owned === true,
    type: normalizeType(raw?.type),
    register: normalizeType(raw?.register),
    fixture,
  };
}

/** Channel layout (attribute per channel) a link registers with. */
export function registerLayout(link, type) {
  return link.fixture ? link.fixture.channels.map((c) => c.attr) : [...LAYOUT_PRESETS[consoleTypeKey(type)]];
}

/** Console fader name suffix per channel ("Dim", or the fixture's channel name). */
export function registerLabels(link, type) {
  return link.fixture ? link.fixture.channels.map((c) => c.name) : LAYOUT_PRESETS[consoleTypeKey(type)].map((a) => DMX_SHORT[a]);
}

/** Use a fixture's real pan / tilt / zoom ranges (and full dimmer if it has none). */
export function applyFixture(fixture, p) {
  if (p.panLimit != null) fixture.panLimit = clamp(p.panLimit, 0, 360);
  if (p.tiltLimit != null) fixture.tiltLimit = clamp(p.tiltLimit, 0, 180);
  if (p.zoomMin != null && p.zoomMax != null) {
    fixture.zoomMin = clamp(Math.min(p.zoomMin, p.zoomMax), 1, 120);
    fixture.zoomMax = clamp(Math.max(p.zoomMin, p.zoomMax), fixture.zoomMin, 120);
  }
  if (!p.channels.some((c) => c.attr === "dimmer")) fixture.dmx.dimmer = 255;
  fixture.link.fixture = p;
  deriveFromDmx(fixture);
}

export function normalizeFixture(raw, i) {
  const num = (v, fb) => numberFrom(v) ?? fb;
  const b = raw.base || {};
  const panLimit = clamp(num(raw.panLimit, 270), 0, 360);
  const tiltLimit = clamp(num(raw.tiltLimit, 135), 0, 180);
  let zoomMin = clamp(num(raw.zoomMin, 5), 1, 120);
  let zoomMax = clamp(num(raw.zoomMax, 60), 1, 120);
  if (zoomMax < zoomMin) [zoomMin, zoomMax] = [zoomMax, zoomMin];
  const rawDmx = raw.dmx || {};
  const dmx = Object.fromEntries(DMX_ATTRS.map((a) => [a, clampByte(num(rawDmx[a], a === "pan" || a === "tilt" ? DMX_CENTER : 0))]));
  const fixture = {
    id: typeof raw.id === "string" ? raw.id : newId("fixture"),
    name: typeof raw.name === "string" ? raw.name : `Fixture ${i + 1}`,
    x: num(raw.x, 0), y: num(raw.y, 3), z: num(raw.z, 0),
    base: { yaw: num(b.yaw, 0), pitch: num(b.pitch, -45), roll: num(b.roll, 0) },
    dmx,
    panLimit, tiltLimit, zoomMin, zoomMax,
    link: normalizeLink(raw.link),
    rigId: typeof raw.rigId === "string" ? raw.rigId : null,
    rigIndex: Number.isInteger(raw.rigIndex) ? raw.rigIndex : 0,
  };
  deriveFromDmx(fixture);
  return fixture;
}

/** What gets saved for a fixture (the derived look is left out). */
function serializeFixture(fixture) {
  const { color, pan, tilt, intensity, beam, ...saved } = fixture;
  return saved;
}

// ---------------------------------------------------------------------
// Rigs: a group of fixtures with fixed placement relative to the rig.
// Members carry `rigId` / `rigIndex`; their position and zero frame come
// from the rig and are recomputed whenever the rig changes. Pan / tilt,
// intensity, color and beam stay per fixture.
// ---------------------------------------------------------------------

/** @typedef {{
 *   id: string, name: string, type: "circle" | "square" | "line",
 *   x: number, y: number, z: number,
 *   yaw: number, tilt: number,
 *   size: number, count: number,
 * }} Rig */

/**
 * Rig types. `size` is the circle's diameter, the square's side or the
 * line's length. `aim` says where members' zeros point: "center" (circle,
 * square) or "parallel" (line: all the same way, straight down when flat).
 */
export const RIG_TYPES = {
  circle: {
    name: "Circle", prefix: "Ring", sizeLabel: "Diameter", aim: "center",
    defaults: { size: 4, count: 8, tilt: 0, yaw: 0 },
    help: "Fixtures evenly spaced around the ring, each one's zero pointing at the center of the rig. Tilt 0 = flat (a hanging ring); 90 = upright, facing the audience. Yaw turns it about the vertical.",
  },
  square: {
    name: "Square", prefix: "Square", sizeLabel: "Side", aim: "center",
    defaults: { size: 4, count: 8, tilt: 0, yaw: 0 },
    help: "Fixtures evenly spaced around the square's edges (4 = one mid-side each, 8 = two per side), each one's zero pointing at the center. Tilt 0 = flat; 90 = upright, facing the audience. Yaw turns it about the vertical.",
  },
  line: {
    name: "Line", prefix: "Line", sizeLabel: "Length", aim: "parallel",
    defaults: { size: 6, count: 6, tilt: 0, yaw: 0 },
    help: "Fixtures evenly spaced from end to end, all pointing the same way: straight down at tilt 0. Tilt turns the line about its length (+90 = beams aimed upstage, −90 = at the audience). Yaw turns the line about the vertical (0 = running stage right to stage left).",
  },
};

/**
 * The rig's orientation. Its shape lies in the local x–z plane with its
 * axis along local +y; tilt rotates it about x (0 = flat, 90 = upright
 * facing the audience), then yaw turns it about the vertical.
 */
function rigQuat(rig) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(rig.tilt * DEG, rig.yaw * DEG, 0, "YXZ"));
}

/** Member `i`'s position in the rig's own (unrotated) frame. */
function localSlot(rig, i) {
  const n = rig.count, s = rig.size;
  if (rig.type === "line") {
    return new THREE.Vector3(n === 1 ? 0 : -s / 2 + (s * i) / (n - 1), 0, 0);
  }
  if (rig.type === "square") {
    // Walk the perimeter (upstage edge first, left to right, then clockwise
    // from above), one member every 4s/n, half a step in from the corner.
    const h = s / 2;
    const t = ((i + 0.5) / n) * 4 * s;
    const side = Math.min(3, Math.floor(t / s));
    const u = t - side * s;
    return [
      new THREE.Vector3(-h + u, 0, -h),
      new THREE.Vector3(h, 0, -h + u),
      new THREE.Vector3(h - u, 0, h),
      new THREE.Vector3(-h, 0, h - u),
    ][side];
  }
  const r = s / 2;
  const theta = (2 * Math.PI * i) / n;
  return new THREE.Vector3(r * Math.sin(theta), 0, -r * Math.cos(theta));
}

/**
 * Position and zero frame of member `i`.
 *   circle / square: zero points at the center; "up" is the rig's axis
 *     (so tilt moves the beam out of the rig's plane).
 *   line: zero points along −axis (straight down when flat); "up" is local
 *     +z (towards the audience when flat), so pan swings along the line.
 */
function rigSlot(rig, i) {
  const q = rigQuat(rig);
  const c = new THREE.Vector3(rig.x, rig.y, rig.z);
  const pos = localSlot(rig, i).applyQuaternion(q).add(c);
  const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  let back, up; // local +Z (opposite the beam) and local +Y
  if (RIG_TYPES[rig.type].aim === "parallel") {
    back = axis;
    up = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  } else {
    back = pos.clone().sub(c).normalize(); // away from the center
    up = axis.sub(back.clone().multiplyScalar(axis.dot(back))).normalize();
  }
  const right = new THREE.Vector3().crossVectors(up, back);
  const e = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, back), "YXZ");
  return {
    x: round(pos.x, 3), y: round(pos.y, 3), z: round(pos.z, 3),
    base: { yaw: round(e.y / DEG), pitch: round(e.x / DEG), roll: round(e.z / DEG) },
  };
}

/** Put each member back in its slot (members' pan / tilt etc. are kept). */
export function applyRig(rig, members) {
  for (const fixture of members) {
    const slot = rigSlot(rig, fixture.rigIndex);
    fixture.x = slot.x; fixture.y = slot.y; fixture.z = slot.z;
    fixture.base = slot.base;
  }
}

/**
 * The rig's shape in world space, for drawing: a polyline (closed for
 * circle / square).
 */
export function rigOutline(rig) {
  const q = rigQuat(rig);
  const c = new THREE.Vector3(rig.x, rig.y, rig.z);
  const h = rig.size / 2;
  let local;
  if (rig.type === "line") local = [new THREE.Vector3(-h, 0, 0), new THREE.Vector3(h, 0, 0)];
  else if (rig.type === "square") local = [[-h, -h], [h, -h], [h, h], [-h, h], [-h, -h]].map(([x, z]) => new THREE.Vector3(x, 0, z));
  else local = Array.from({ length: 65 }, (_, k) => { const t = (2 * Math.PI * k) / 64; return new THREE.Vector3(h * Math.sin(t), 0, -h * Math.cos(t)); });
  return local.map((p) => p.applyQuaternion(q).add(c));
}

/** Lowest point of the rig, so it can be kept off the floor. */
export function rigLowestY(rig) {
  return Math.min(...rigOutline(rig).map((p) => p.y));
}

export function normalizeRig(raw, i) {
  // Missing or empty (a cleared dialog field) → the default.
  const num = (v, fb) => numberFrom(v) ?? fb;
  const type = RIG_TYPES[raw?.type] ? raw.type : "circle";
  const d = RIG_TYPES[type].defaults;
  return {
    id: typeof raw?.id === "string" ? raw.id : newId("rig"),
    name: typeof raw?.name === "string" ? raw.name : `${RIG_TYPES[type].prefix} ${i + 1}`,
    type,
    x: num(raw?.x, 0), y: num(raw?.y, 5), z: num(raw?.z, 0),
    yaw: num(raw?.yaw, d.yaw),
    tilt: clamp(num(raw?.tilt, d.tilt), -90, 90),
    size: clamp(num(raw?.size, d.size), 0.5, 50),
    count: clamp(Math.round(num(raw?.count, d.count)), 2, MAX_FIXTURES),
    /** Console type its members are registered as (null = stage only). */
    consoleType: normalizeType(raw?.consoleType),
    /** Real fixture its members are (null = generic). */
    fixture: normalizeProfile(raw?.fixture),
    /** Universe its members register in (null = first with room). */
    universe: Number.isInteger(raw?.universe) && raw.universe >= 1 && raw.universe <= 8 ? raw.universe : null,
  };
}

/**
 * Box surfaces, in the order the renderer indexes them (by outward normal:
 * +x, −x, +y, −y, +z, −z). Every side except the floor can be made
 * transparent; the floor is always solid.
 */
export const SURFACES = [
  { key: "sl", name: "Stage-left wall" },
  { key: "sr", name: "Stage-right wall" },
  { key: "ceiling", name: "Ceiling" },
  { key: "floor", name: "Floor", alwaysSolid: true },
  { key: "downstage", name: "Downstage (audience)" },
  { key: "upstage", name: "Upstage wall" },
];

/** Opacity used for a transparent side (faint, so its grid still reads). */
export const TRANSPARENT_OPACITY = 0.1;

/** Which sides are transparent. Default: all of them. */
export const DEFAULT_TRANSPARENT = { sl: true, sr: true, ceiling: true, downstage: true, upstage: true };

function normalizeTransparent(raw) {
  const out = { ...DEFAULT_TRANSPARENT };
  for (const key of Object.keys(out)) {
    if (typeof raw?.[key] === "boolean") out[key] = raw[key];
  }
  return out;
}

/** Parse saved/imported JSON into a clean `{ box, fixtures, transparent, rigs }`. */
export function parseStage(data) {
  const raw = data?.box || {};
  const box = {
    w: clamp(Number(raw.w) || 12, 1, 100),
    d: clamp(Number(raw.d) || 8, 1, 100),
    h: clamp(Number(raw.h) || 6, 1, 50),
  };
  const list = Array.isArray(data?.fixtures) ? data.fixtures : [];
  const fixtures = list.slice(0, MAX_FIXTURES).map(normalizeFixture);
  const rigs = (Array.isArray(data?.rigs) ? data.rigs : []).map(normalizeRig);
  // A member whose rig is gone becomes a free fixture; a rig keeps the
  // count of members it actually has, and they're re-laid-out to match.
  for (const fixture of fixtures) if (fixture.rigId && !rigs.some((r) => r.id === fixture.rigId)) fixture.rigId = null;
  const kept = rigs.filter((rig) => {
    const members = fixtures.filter((i) => i.rigId === rig.id).sort((a, b) => a.rigIndex - b.rigIndex);
    if (members.length < 2) { members.forEach((m) => { m.rigId = null; }); return false; }
    members.forEach((m, k) => { m.rigIndex = k; });
    rig.count = members.length;
    applyRig(rig, members);
    return true;
  });
  return { box, fixtures, transparent: normalizeTransparent(data?.transparent), rigs: kept };
}

export function serializeStage(box, fixtures, transparent, rigs) {
  return { box, transparent, rigs, fixtures: fixtures.map(serializeFixture) };
}

// Stage model: instruments, their zero frames, pan/tilt maths, and the save
// format. No DOM or rendering here; stage.js owns the view and UI state.

import * as THREE from "three";

// ---------------------------------------------------------------------
// Coordinates (metres): origin at floor centre of the box.
//   x: stage right (−) → stage left (+)   (actor facing the audience)
//   y: floor (0) → up
//   z: upstage (−) → downstage / audience (+)
//
// Each instrument has a "zero" frame (base yaw / pitch / roll). Pan and
// tilt are measured inside that frame, so ← → and ↑ ↓ always mean the
// instrument's own left/right and up/down. Forward is local −Z.
// ---------------------------------------------------------------------

export const STORAGE_KEY = "unnaturallight.stage.v1";
export const MAX_INSTRUMENTS = 32;
export const DEG = Math.PI / 180;
export const FORWARD = new THREE.Vector3(0, 0, -1);
export const PALETTE = ["#ffd9a0", "#a0d8ff", "#ff9fb2", "#b6ffa0", "#d5a0ff", "#ffe066", "#7fffe0", "#ffb070"];

/** @typedef {{ yaw: number, pitch: number, roll: number }} Frame */
/** @typedef {"dimmer" | "pan" | "tilt" | "red" | "green" | "blue" | "zoom"} DmxAttr */
/** @typedef {Record<DmxAttr, number>} DmxValues */
/** @typedef {{ mount: "fixed" | "movable", color: "single" | "multi" }} ConsoleType */
/** @typedef {{
 *   consoleId: string | null, start: number | null, layout: (DmxAttr | null)[],
 *   owned?: boolean, type?: ConsoleType | null, register?: ConsoleType | null,
 * }} Link
 * owned: the stage registered this console instrument (deleting the light
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
 * }} Instrument
 * `dmx` (0–255 per attribute) is the source of truth, like a real fixture's
 * channels. color / pan / tilt (°) / intensity (0–1) / beam (°) are derived
 * from it by deriveFromDmx() and only read by the drawing code.
 */

// ---------------------------------------------------------------------
// DMX attributes (each 0–255)
// ---------------------------------------------------------------------

export const DMX_ATTRS = /** @type {const} */ (["dimmer", "pan", "tilt", "red", "green", "blue", "zoom"]);
export const DMX_LABELS = { dimmer: "Dimmer", pan: "Pan", tilt: "Tilt", red: "Red", green: "Green", blue: "Blue", zoom: "Zoom" };
/** Short names used for console fader names, e.g. "Inst 1 Dim". */
export const DMX_SHORT = { dimmer: "Dim", pan: "Pan", tilt: "Tilt", red: "R", green: "G", blue: "B", zoom: "Zoom" };
/** Pan / tilt value that means "at zero" (Home). */
export const DMX_CENTRE = 128;

const toByte = (v) => Math.max(0, Math.min(255, Math.round(Number(v) || 0)));

/** DMX 0–255 → angle −limit…+limit, with 128 exactly 0. */
export function angleFromDmx(v, limit) {
  return v >= DMX_CENTRE ? ((v - DMX_CENTRE) / 127) * limit : ((v - DMX_CENTRE) / 128) * limit;
}

/** Angle → nearest DMX 0–255 (inverse of angleFromDmx). */
export function dmxFromAngle(deg, limit) {
  if (!limit) return DMX_CENTRE;
  return toByte(deg >= 0 ? DMX_CENTRE + (deg / limit) * 127 : DMX_CENTRE + (deg / limit) * 128);
}

export const beamFromZoom = (v, min, max) => min + (v / 255) * (max - min);
export const zoomFromBeam = (deg, min, max) => (max > min ? toByte(((deg - min) / (max - min)) * 255) : 0);

export function hexFromRgb(r, g, b) {
  return `#${[r, g, b].map((c) => toByte(c).toString(16).padStart(2, "0")).join("")}`;
}

export function rgbFromHex(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [255, 255, 255];
}

/** Recompute the derived look / angles from the instrument's DMX values. */
export function deriveFromDmx(inst) {
  const d = inst.dmx;
  inst.intensity = d.dimmer / 255;
  inst.pan = round(angleFromDmx(d.pan, inst.panLimit));
  inst.tilt = round(angleFromDmx(d.tilt, inst.tiltLimit));
  inst.color = hexFromRgb(d.red, d.green, d.blue);
  inst.beam = round(beamFromZoom(d.zoom, inst.zoomMin, inst.zoomMax), 1);
}

/** Set one DMX attribute (clamped to 0–255) and update the derived values. */
export function setDmx(inst, attr, v) {
  inst.dmx[attr] = toByte(v);
  deriveFromDmx(inst);
}

/** Set the color as hex (the picker) by setting red / green / blue. */
export function setColorHex(inst, hex) {
  const [r, g, b] = rgbFromHex(hex);
  Object.assign(inst.dmx, { red: r, green: g, blue: b });
  deriveFromDmx(inst);
}

/**
 * Channel layouts. Presets follow the console's instrument types
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

export const consoleTypeKey = (t) => (t ? `${t.mount}/${t.color}` : "none");

/** Preset layout for a console instrument, fitted to its channel count. */
export function layoutFor(mount, color, count) {
  const preset = LAYOUT_PRESETS[`${mount === "movable" ? "movable" : "fixed"}/${color === "multi" ? "multi" : "single"}`];
  return Array.from({ length: Math.max(1, count) }, (_, k) => preset[k] ?? null);
}

/** [{ channel, attr }] an instrument listens on / sends to (none if unlinked). */
export function linkChannels(inst) {
  const { start, layout } = inst.link;
  if (!start) return [];
  return layout.flatMap((attr, k) => (attr ? [{ channel: start + k, attr }] : []));
}


export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const round = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;

export function newId() {
  try { return crypto.randomUUID(); } catch { return `i-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }
}

export function baseQuat(inst) {
  const { yaw, pitch, roll } = inst.base;
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * DEG, yaw * DEG, roll * DEG, "YXZ"));
}

export function fullQuat(inst) {
  const pt = new THREE.Quaternion().setFromEuler(new THREE.Euler(inst.tilt * DEG, inst.pan * DEG, 0, "YXZ"));
  return baseQuat(inst).multiply(pt);
}

export function beamDir(inst) {
  return FORWARD.clone().applyQuaternion(fullQuat(inst));
}

/** Yaw/pitch that make local forward point along v. */
export function frameFacing(v) {
  const h = Math.hypot(v.x, v.z);
  return { yaw: round(Math.atan2(-v.x, -v.z) / DEG), pitch: round(Math.atan2(v.y, h) / DEG), roll: 0 };
}

/** Where a new instrument's zero points: stage floor centre (box centre if it sits on the floor). */
export function defaultTarget(inst, box) {
  return inst.y < 0.5 ? new THREE.Vector3(0, box.h / 2, 0) : new THREE.Vector3(0, 0, 0);
}

/** Pan / tilt back to zero (DMX 128). */
export function homeInstrument(inst) {
  inst.dmx.pan = DMX_CENTRE;
  inst.dmx.tilt = DMX_CENTRE;
  deriveFromDmx(inst);
}

export function aimZeroAt(inst, target) {
  const v = target.clone().sub(new THREE.Vector3(inst.x, inst.y, inst.z));
  if (v.lengthSq() < 1e-6) v.set(0, -1, 0);
  inst.base = frameFacing(v);
  homeInstrument(inst);
}

export function setZeroHere(inst) {
  const e = new THREE.Euler().setFromQuaternion(fullQuat(inst), "YXZ");
  inst.base = { yaw: round(e.y / DEG), pitch: round(e.x / DEG), roll: round(e.z / DEG) };
  homeInstrument(inst);
}

/**
 * Set pan/tilt (inside the instrument's zero frame) so the beam's centre
 * points at `target`. The zero frame is left alone. Pan picks whichever
 * equivalent angle (±360°) is closest to the current pan. Clamped to the
 * limits; returns false if the target is out of reach. The result is
 * stored as DMX 0–255, so it lands on the nearest step.
 */
export function aimAt(inst, target) {
  const v = target.clone().sub(new THREE.Vector3(inst.x, inst.y, inst.z));
  if (v.lengthSq() < 1e-6) return false;
  v.applyQuaternion(baseQuat(inst).invert());
  const want = frameFacing(v); // in the zero frame: yaw = pan, pitch = tilt
  let pan = null;
  for (const p of [want.yaw - 360, want.yaw, want.yaw + 360]) {
    if (Math.abs(p) > inst.panLimit + 1e-6) continue;
    if (pan === null || Math.abs(p - inst.pan) < Math.abs(pan - inst.pan)) pan = p;
  }
  let reached = pan !== null;
  if (pan === null) pan = clamp(want.yaw, -inst.panLimit, inst.panLimit);
  const tilt = clamp(want.pitch, -inst.tiltLimit, inst.tiltLimit);
  if (tilt !== want.pitch) reached = false;
  inst.dmx.pan = dmxFromAngle(pan, inst.panLimit);
  inst.dmx.tilt = dmxFromAngle(tilt, inst.tiltLimit);
  deriveFromDmx(inst);
  return reached;
}

export function isInside(inst, box) {
  const { w, d, h } = box;
  return Math.abs(inst.x) <= w / 2 && Math.abs(inst.z) <= d / 2 && inst.y >= 0 && inst.y <= h;
}

export const FACE_NAMES = {
  "x-": "Stage-right wall", "x+": "Stage-left wall",
  "y-": "Floor", "y+": "Ceiling",
  "z-": "Upstage wall", "z+": "Downstage (audience) plane",
};

/** Ray/box slab test. Returns hits along the beam axis (entry/exit). */
export function axisHits(inst, box) {
  const { w, d, h } = box;
  const o = [inst.x, inst.y, inst.z];
  const dir = beamDir(inst);
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

/** `n` is the instrument's index, used for its default name and color. */
export function createInstrument(x, y, z, n, box) {
  const [red, green, blue] = rgbFromHex(PALETTE[n % PALETTE.length]);
  /** @type {Instrument} */
  const inst = {
    id: newId(),
    name: `Inst ${n + 1}`,
    x: round(x), y: round(y), z: round(z),
    base: { yaw: 0, pitch: 0, roll: 0 },
    dmx: { dimmer: 191, pan: DMX_CENTRE, tilt: DMX_CENTRE, red, green, blue, zoom: zoomFromBeam(24, 5, 60) },
    panLimit: 270, tiltLimit: 135, zoomMin: 5, zoomMax: 60,
    link: { consoleId: null, start: null, layout: [] },
    rigId: null, rigIndex: 0,
  };
  deriveFromDmx(inst);
  aimZeroAt(inst, defaultTarget(inst, box));
  return inst;
}

function normalizeType(raw) {
  return raw && typeof raw === "object" ? consoleTypeFromKey(consoleTypeKey(raw)) : null;
}

function normalizeLink(raw) {
  const start = Number(raw?.start);
  const layout = Array.isArray(raw?.layout) ? raw.layout.slice(0, 16).map((a) => (DMX_ATTRS.includes(a) ? a : null)) : [];
  return {
    consoleId: typeof raw?.consoleId === "string" ? raw.consoleId : null,
    start: Number.isInteger(start) && start >= 1 && start <= 512 ? start : null,
    layout,
    owned: raw?.owned === true,
    type: normalizeType(raw?.type),
    register: normalizeType(raw?.register),
  };
}

export function normalizeInstrument(raw, i) {
  const num = (v, fb) => (Number.isFinite(Number(v)) ? Number(v) : fb);
  const b = raw.base || {};
  const panLimit = clamp(num(raw.panLimit, 270), 0, 360);
  const tiltLimit = clamp(num(raw.tiltLimit, 135), 0, 180);
  let zoomMin = clamp(num(raw.zoomMin, 5), 1, 120);
  let zoomMax = clamp(num(raw.zoomMax, 60), 1, 120);
  if (zoomMax < zoomMin) [zoomMin, zoomMax] = [zoomMax, zoomMin];
  let dmx;
  if (raw.dmx && typeof raw.dmx === "object") {
    dmx = Object.fromEntries(DMX_ATTRS.map((a) => [a, toByte(num(raw.dmx[a], a === "pan" || a === "tilt" ? DMX_CENTRE : 0))]));
  } else {
    // Older saves stored angles / 0–1 / hex: convert to DMX values.
    const color = /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : PALETTE[i % PALETTE.length];
    const [red, green, blue] = rgbFromHex(color);
    dmx = {
      dimmer: toByte(clamp(num(raw.intensity, 0.75), 0, 1) * 255),
      pan: dmxFromAngle(clamp(num(raw.pan, 0), -panLimit, panLimit), panLimit),
      tilt: dmxFromAngle(clamp(num(raw.tilt, 0), -tiltLimit, tiltLimit), tiltLimit),
      red, green, blue,
      zoom: zoomFromBeam(clamp(num(raw.beam, 24), zoomMin, zoomMax), zoomMin, zoomMax),
    };
  }
  const inst = {
    id: typeof raw.id === "string" ? raw.id : newId(),
    name: typeof raw.name === "string" ? raw.name : `Inst ${i + 1}`,
    x: num(raw.x, 0), y: num(raw.y, 3), z: num(raw.z, 0),
    base: { yaw: num(b.yaw, 0), pitch: num(b.pitch, -45), roll: num(b.roll, 0) },
    dmx,
    panLimit, tiltLimit, zoomMin, zoomMax,
    link: normalizeLink(raw.link),
    rigId: typeof raw.rigId === "string" ? raw.rigId : null,
    rigIndex: Number.isInteger(raw.rigIndex) ? raw.rigIndex : 0,
  };
  deriveFromDmx(inst);
  return inst;
}

/** What gets saved for an instrument (the derived look is left out). */
export function serializeInstrument(inst) {
  const { color, pan, tilt, intensity, beam, ...saved } = inst;
  return saved;
}

// ---------------------------------------------------------------------
// Rigs: a group of instruments with fixed placement relative to the rig.
// Members carry `rigId` / `rigIndex`; their position and zero frame come
// from the rig and are recomputed whenever the rig changes. Pan / tilt,
// intensity, color and beam stay per instrument.
// ---------------------------------------------------------------------

/** @typedef {{
 *   id: string, name: string, type: "circle" | "square" | "line",
 *   x: number, y: number, z: number,
 *   yaw: number, tilt: number,
 *   size: number, count: number,
 * }} Rig */

/**
 * Rig types. `size` is the circle's diameter, the square's side or the
 * line's length. `aim` says where members' zeros point: "centre" (circle,
 * square) or "parallel" (line: all the same way, straight down when flat).
 */
export const RIG_TYPES = {
  circle: {
    name: "Circle", prefix: "Ring", sizeLabel: "Diameter", aim: "centre",
    defaults: { size: 4, count: 8, tilt: 0, yaw: 0 },
    help: "Instruments evenly spaced around the ring, each one's zero pointing at the centre of the rig. Tilt 0 = flat (a hanging ring); 90 = upright, facing the audience. Yaw turns it about the vertical.",
  },
  square: {
    name: "Square", prefix: "Square", sizeLabel: "Side", aim: "centre",
    defaults: { size: 4, count: 8, tilt: 0, yaw: 0 },
    help: "Instruments evenly spaced around the square's edges (4 = one mid-side each, 8 = two per side), each one's zero pointing at the centre. Tilt 0 = flat; 90 = upright, facing the audience. Yaw turns it about the vertical.",
  },
  line: {
    name: "Line", prefix: "Line", sizeLabel: "Length", aim: "parallel",
    defaults: { size: 6, count: 6, tilt: 0, yaw: 0 },
    help: "Instruments evenly spaced from end to end, all pointing the same way: straight down at tilt 0. Tilt turns the line about its length (+90 = beams aimed upstage, −90 = at the audience). Yaw turns the line about the vertical (0 = running stage right to stage left).",
  },
};

/**
 * The rig's orientation. Its shape lies in the local x–z plane with its
 * axis along local +y; tilt rotates it about x (0 = flat, 90 = upright
 * facing the audience), then yaw turns it about the vertical.
 */
export function rigQuat(rig) {
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
 *   circle / square: zero points at the centre; "up" is the rig's axis
 *     (so tilt moves the beam out of the rig's plane).
 *   line: zero points along −axis (straight down when flat); "up" is local
 *     +z (towards the audience when flat), so pan swings along the line.
 */
export function rigSlot(rig, i) {
  const q = rigQuat(rig);
  const c = new THREE.Vector3(rig.x, rig.y, rig.z);
  const pos = localSlot(rig, i).applyQuaternion(q).add(c);
  const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  let back, up; // local +Z (opposite the beam) and local +Y
  if (RIG_TYPES[rig.type].aim === "parallel") {
    back = axis;
    up = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  } else {
    back = pos.clone().sub(c).normalize(); // away from the centre
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
  for (const inst of members) {
    const slot = rigSlot(rig, inst.rigIndex);
    inst.x = slot.x; inst.y = slot.y; inst.z = slot.z;
    inst.base = slot.base;
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
  const num = (v, fb) => (Number.isFinite(Number(v)) ? Number(v) : fb);
  const type = RIG_TYPES[raw?.type] ? raw.type : "circle";
  const d = RIG_TYPES[type].defaults;
  return {
    id: typeof raw?.id === "string" ? raw.id : newId(),
    name: typeof raw?.name === "string" ? raw.name : `${RIG_TYPES[type].prefix} ${i + 1}`,
    type,
    x: num(raw?.x, 0), y: num(raw?.y, 5), z: num(raw?.z, 0),
    yaw: num(raw?.yaw, d.yaw),
    tilt: clamp(num(raw?.tilt, d.tilt), -90, 90),
    // `diameter` is the older name for a circle's size.
    size: clamp(num(raw?.size ?? raw?.diameter, d.size), 0.5, 50),
    count: clamp(Math.round(num(raw?.count, d.count)), 2, MAX_INSTRUMENTS),
    /** Console type its members are registered as (null = stage only). */
    consoleType: normalizeType(raw?.consoleType),
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

export function normalizeTransparent(raw) {
  const out = { ...DEFAULT_TRANSPARENT };
  for (const key of Object.keys(out)) {
    if (typeof raw?.[key] === "boolean") out[key] = raw[key];
  }
  return out;
}

/** Parse saved/imported JSON into a clean `{ box, instruments, transparent, rigs }`. */
export function parseStage(data) {
  const raw = data?.box || {};
  const box = {
    w: clamp(Number(raw.w) || 12, 1, 100),
    d: clamp(Number(raw.d) || 8, 1, 100),
    h: clamp(Number(raw.h) || 6, 1, 50),
  };
  const list = Array.isArray(data?.instruments) ? data.instruments : [];
  const instruments = list.slice(0, MAX_INSTRUMENTS).map(normalizeInstrument);
  const rigs = (Array.isArray(data?.rigs) ? data.rigs : []).map(normalizeRig);
  // A member whose rig is gone becomes a free instrument; a rig keeps the
  // count of members it actually has, and they're re-laid-out to match.
  for (const inst of instruments) if (inst.rigId && !rigs.some((r) => r.id === inst.rigId)) inst.rigId = null;
  const kept = rigs.filter((rig) => {
    const members = instruments.filter((i) => i.rigId === rig.id).sort((a, b) => a.rigIndex - b.rigIndex);
    if (members.length < 2) { members.forEach((m) => { m.rigId = null; }); return false; }
    members.forEach((m, k) => { m.rigIndex = k; });
    rig.count = members.length;
    applyRig(rig, members);
    return true;
  });
  return { box, instruments, transparent: normalizeTransparent(data?.transparent), rigs: kept };
}

export function serializeStage(box, instruments, transparent, rigs) {
  return { app: "UnnaturalLight.stage", version: 2, box, transparent, rigs, instruments: instruments.map(serializeInstrument) };
}

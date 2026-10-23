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
/** @typedef {{
 *   id: string, name: string, color: string,
 *   x: number, y: number, z: number,
 *   base: Frame,
 *   pan: number, tilt: number,
 *   panLimit: number, tiltLimit: number,
 *   intensity: number, beam: number,
 * }} Instrument */


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

export function aimZeroAt(inst, target) {
  const v = target.clone().sub(new THREE.Vector3(inst.x, inst.y, inst.z));
  if (v.lengthSq() < 1e-6) v.set(0, -1, 0);
  inst.base = frameFacing(v);
  inst.pan = 0;
  inst.tilt = 0;
}

export function setZeroHere(inst) {
  const e = new THREE.Euler().setFromQuaternion(fullQuat(inst), "YXZ");
  inst.base = { yaw: round(e.y / DEG), pitch: round(e.x / DEG), roll: round(e.z / DEG) };
  inst.pan = 0;
  inst.tilt = 0;
}

/**
 * Set pan/tilt (inside the instrument's zero frame) so the beam's centre
 * points at `target`. The zero frame is left alone. Pan picks whichever
 * equivalent angle (±360°) is closest to the current pan. Clamped to the
 * limits; returns false if the target is out of reach.
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
  inst.pan = round(pan);
  inst.tilt = round(tilt);
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
  /** @type {Instrument} */
  const inst = {
    id: newId(),
    name: `Inst ${n + 1}`,
    color: PALETTE[n % PALETTE.length],
    x: round(x), y: round(y), z: round(z),
    base: { yaw: 0, pitch: 0, roll: 0 },
    pan: 0, tilt: 0,
    panLimit: 270, tiltLimit: 135,
    intensity: 0.75,
    beam: 24,
  };
  aimZeroAt(inst, defaultTarget(inst, box));
  return inst;
}

export function normalizeInstrument(raw, i) {
  const num = (v, fb) => (Number.isFinite(Number(v)) ? Number(v) : fb);
  const b = raw.base || {};
  return {
    id: typeof raw.id === "string" ? raw.id : newId(),
    name: typeof raw.name === "string" ? raw.name : `Inst ${i + 1}`,
    color: /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : PALETTE[i % PALETTE.length],
    x: num(raw.x, 0), y: num(raw.y, 3), z: num(raw.z, 0),
    base: { yaw: num(b.yaw, 0), pitch: num(b.pitch, -45), roll: num(b.roll, 0) },
    pan: num(raw.pan, 0), tilt: num(raw.tilt, 0),
    panLimit: clamp(num(raw.panLimit, 270), 0, 360),
    tiltLimit: clamp(num(raw.tiltLimit, 135), 0, 180),
    intensity: clamp(num(raw.intensity, 0.75), 0, 1),
    beam: clamp(num(raw.beam, 24), 2, 120),
    rigId: typeof raw.rigId === "string" ? raw.rigId : null,
    rigIndex: Number.isInteger(raw.rigIndex) ? raw.rigIndex : 0,
  };
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
  return { app: "UnnaturalLight.stage", version: 1, box, transparent, rigs, instruments };
}

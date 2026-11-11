// Risers: boxes standing on the stage floor (platforms, drum risers, decks).
// Plain math, no three.js, so Node can test it (test/risers.test.ts).
//
// A riser is centered at (x, z) on the floor, w wide (along x before it's
// turned), d deep (along z) and h tall, turned yaw° about the vertical the
// way three.js turns an object (rotation.y): +yaw is counterclockwise seen
// from above.

import { clamp, numberFrom } from "../shared/numbers.ts";
import { newId } from "../shared/ids.ts";
import { isRecord } from "../shared/guards.ts";

export const MAX_RISERS = 50;
/** A new riser: a standard 8 × 4 ft deck (2.4 × 1.2 m), 0.4 m high. */
export const RISER_DEFAULTS = { w: 2.4, d: 1.2, h: 0.4 } as const;
/** Size limits (meters). */
export const RISER_MIN = 0.1;
export const RISER_MAX_SIDE = 50;
export const RISER_MAX_H = 10;

export type Riser = { id: string; name: string; x: number; z: number; w: number; d: number; h: number; yaw: number };

const round = (v: number, n = 3) => Math.round(v * 10 ** n) / 10 ** n;
const DEG = Math.PI / 180;

/** An angle in −180…180. */
export const wrapYaw = (deg: number) => ((deg + 180) % 360 + 360) % 360 - 180;

/** A saved / imported riser, cleaned up (sizes kept in range, a name and id). */
export function normalizeRiser(saved: unknown, i: number): Riser {
  const raw = isRecord(saved) ? saved : {};
  const num = (v: unknown, fallback: number, lo: number, hi: number) => round(clamp(numberFrom(v) ?? fallback, lo, hi));
  return {
    id: typeof raw.id === "string" ? raw.id : newId("riser"),
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name : `Riser ${i + 1}`,
    x: num(raw.x, 0, -100, 100),
    z: num(raw.z, 0, -100, 100),
    w: num(raw.w, RISER_DEFAULTS.w, RISER_MIN, RISER_MAX_SIDE),
    d: num(raw.d, RISER_DEFAULTS.d, RISER_MIN, RISER_MAX_SIDE),
    h: num(raw.h, RISER_DEFAULTS.h, RISER_MIN, RISER_MAX_H),
    yaw: round(wrapYaw(numberFrom(raw.yaw) ?? 0), 1),
  };
}

/** A point (x, z) in the riser's own frame (centered, unturned). */
function toLocal(r: Riser, x: number, z: number): { u: number; v: number } {
  const c = Math.cos(r.yaw * DEG), s = Math.sin(r.yaw * DEG);
  const dx = x - r.x, dz = z - r.z;
  // Inverse of three.js rotation.y: (u, v) → (u c + v s, −u s + v c).
  return { u: dx * c - dz * s, v: dx * s + dz * c };
}

/** The riser's four floor corners (x, z), in order around it. */
export function riserCorners(r: Riser): { x: number; z: number }[] {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => localToWorld(r, (a * r.w) / 2, (b * r.d) / 2));
}

/** Whether (x, z) is on the riser's footprint (`margin` meters of slack around it). */
export function onRiser(r: Riser, x: number, z: number, margin = 0): boolean {
  const { u, v } = toLocal(r, x, z);
  return Math.abs(u) <= r.w / 2 + margin && Math.abs(v) <= r.d / 2 + margin;
}

/** How high the standing surface is at (x, z): the tallest riser there, else the floor (0). */
export function standingHeight(risers: Riser[], x: number, z: number): number {
  let top = 0;
  for (const r of risers) if (r.h > top && onRiser(r, x, z)) top = r.h;
  return top;
}

/** The riser whose top is the standing surface at (x, z), or null (the floor). */
export function riserAt(risers: Riser[], x: number, z: number): Riser | null {
  let best: Riser | null = null;
  for (const r of risers) if (onRiser(r, x, z) && (!best || r.h > best.h)) best = r;
  return best;
}

// ---------------------------------------------------------------------
// Handles: resizing and turning a riser with the mouse (3D and the plan)
// ---------------------------------------------------------------------

/**
 * A riser's handles. A corner or edge handle is where it sits in the riser's
 * own frame: `su` / `sv` −1, 0 or +1 along its width / depth (an edge has one
 * 0). `turn` sits past the riser's upstage edge (its −depth side); `height`
 * above its top.
 */
export type RiserHandle =
  | { kind: "size"; su: -1 | 0 | 1; sv: -1 | 0 | 1 }
  | { kind: "turn" }
  | { kind: "height" };

/** How far the turn handle sits past the riser's edge (meters). */
export const TURN_HANDLE_GAP = 0.5;

/** The eight size handles: four corners, then four edge middles. */
export const SIZE_HANDLES: Extract<RiserHandle, { kind: "size" }>[] = [
  ...([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([su, sv]) => ({ kind: "size" as const, su, sv })),
  ...([[0, -1], [1, 0], [0, 1], [-1, 0]] as const).map(([su, sv]) => ({ kind: "size" as const, su, sv })),
];

/** The riser fields people and the chat edit (the Risers list's inputs' `data-rk`). */
export const RISER_FIELDS = ["name", "x", "z", "w", "d", "h", "yaw"] as const;
export type RiserField = (typeof RISER_FIELDS)[number];

/** Set one riser field (lengths in meters), kept in range as a saved riser is. False if the value wasn't usable. */
export function setRiserField(riser: Riser, k: RiserField, raw: string | number): boolean {
  if (k === "name") {
    const name = String(raw).trim();
    if (name) riser.name = name;
    return !!name;
  }
  const v = numberFrom(raw);
  if (v == null) return false;
  Object.assign(riser, normalizeRiser({ ...riser, [k]: v }, 0));
  return true;
}

/** A point in the riser's own frame (u along its width, v along its depth) → the world (x, z). */
export function localToWorld(r: Riser, u: number, v: number): { x: number; z: number } {
  const c = Math.cos(r.yaw * DEG), s = Math.sin(r.yaw * DEG);
  return { x: r.x + u * c + v * s, z: r.z - u * s + v * c };
}

/** Where a handle is on the floor plan (x, z): size handles on the riser's edge, the turn handle past it. */
export function handleSpot(r: Riser, h: RiserHandle): { x: number; z: number } {
  if (h.kind === "size") return localToWorld(r, (h.su * r.w) / 2, (h.sv * r.d) / 2);
  if (h.kind === "turn") return localToWorld(r, 0, -(r.d / 2 + TURN_HANDLE_GAP));
  return { x: r.x, z: r.z };
}

/**
 * Drag a size handle to (px, pz): the opposite corner or edge stays put, and
 * the riser grows or shrinks to the pointer (never past the opposite side:
 * it stops at the smallest size). `snap` rounds the new width / depth.
 */
export function resizeTo(r: Riser, su: number, sv: number, px: number, pz: number, snap: (m: number) => number = (m) => m): Pick<Riser, "x" | "z" | "w" | "d"> {
  const { u, v } = toLocal(r, px, pz);
  let w = r.w, d = r.d, cu = 0, cv = 0;
  if (su) {
    const fixed = (-su * r.w) / 2;
    w = clamp(snap(su * (u - fixed)), RISER_MIN, RISER_MAX_SIDE);
    cu = fixed + (su * w) / 2;
  }
  if (sv) {
    const fixed = (-sv * r.d) / 2;
    d = clamp(snap(sv * (v - fixed)), RISER_MIN, RISER_MAX_SIDE);
    cv = fixed + (sv * d) / 2;
  }
  const c = localToWorld(r, cu, cv);
  return { x: round(c.x), z: round(c.z), w: round(w), d: round(d) };
}

/** The turn (degrees) that puts the turn handle toward (px, pz), snapped to `step` degrees; null right on the center. */
export function yawToward(r: Riser, px: number, pz: number, step = 15): number | null {
  const dx = px - r.x, dz = pz - r.z;
  if (Math.hypot(dx, dz) < 1e-6) return null;
  // The turn handle points along the riser's local −v: (−sin yaw, −cos yaw).
  const deg = Math.atan2(-dx, -dz) / DEG;
  return round(wrapYaw(step > 0 ? Math.round(deg / step) * step : deg), 1);
}

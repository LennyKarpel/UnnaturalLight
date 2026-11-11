import { test } from "node:test";
import assert from "node:assert/strict";
import { handleSpot, normalizeRiser, onRiser, resizeTo, riserAt, riserCorners, standingHeight, wrapYaw, yawToward, RISER_DEFAULTS, TURN_HANDLE_GAP } from "../stage/risers.ts";

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test("risers: saved risers are cleaned up (defaults, limits, a name)", () => {
  const r = normalizeRiser({ x: 1, z: "-2", h: 99, yaw: 270 }, 2);
  assert.equal(r.name, "Riser 3");
  assert.equal(r.w, RISER_DEFAULTS.w);
  assert.equal(r.d, RISER_DEFAULTS.d);
  assert.equal(r.h, 10); // tallest allowed
  assert.equal(r.z, -2);
  assert.equal(r.yaw, -90);
  assert.equal(typeof r.id, "string");
  assert.equal(normalizeRiser(null, 0).h, RISER_DEFAULTS.h);
  assert.equal(normalizeRiser({ w: 0 }, 0).w, 0.1); // never flat
  assert.equal(wrapYaw(180), -180);
  assert.equal(wrapYaw(-190), 170);
});

test("risers: corners and footprint follow the turn (three.js rotation.y)", () => {
  const r = normalizeRiser({ id: "a", x: 1, z: 0, w: 4, d: 2, h: 0.5, yaw: 90 }, 0);
  // Turned 90° counterclockwise from above: its width now runs along z.
  const xs = riserCorners(r).map((c) => c.x), zs = riserCorners(r).map((c) => c.z);
  near(Math.min(...xs), 0); near(Math.max(...xs), 2);
  near(Math.min(...zs), -2); near(Math.max(...zs), 2);
  assert.ok(onRiser(r, 1, 1.9));
  assert.ok(!onRiser(r, 2.5, 0));
  assert.ok(onRiser(r, 2.05, 0, 0.1)); // with slack
});

test("risers: the standing height is the tallest riser there, else the floor", () => {
  const low = normalizeRiser({ id: "low", x: 0, z: 0, w: 4, d: 4, h: 0.4 }, 0);
  const high = normalizeRiser({ id: "high", x: 1, z: 1, w: 1, d: 1, h: 1.2 }, 1);
  assert.equal(standingHeight([low, high], 1, 1), 1.2);
  assert.equal(standingHeight([low, high], -1, -1), 0.4);
  assert.equal(standingHeight([low, high], 5, 5), 0);
  assert.equal(riserAt([low, high], 1, 1)?.id, "high");
  assert.equal(riserAt([low, high], 5, 5), null);
});

test("risers: dragging a corner keeps the opposite corner put; an edge changes one side", () => {
  const r = normalizeRiser({ id: "a", x: 0, z: 0, w: 2, d: 1, h: 0.4, yaw: 0 }, 0);
  // Stage-left downstage corner (+u, +v) to (2, 1.5): the corner at (−1, −0.5) stays.
  assert.deepEqual(resizeTo(r, 1, 1, 2, 1.5), { x: 0.5, z: 0.5, w: 3, d: 2 });
  // The upstage edge, dragged past the far side: stops at the smallest depth.
  assert.deepEqual(resizeTo(r, 0, -1, 0, 3), { x: 0, z: 0.45, w: 2, d: 0.1 });
  // Snapping rounds the size, measured from the fixed side.
  assert.deepEqual(resizeTo(r, 1, 0, 1.53, 0, (m) => Math.round(m * 10) / 10), { x: 0.25, z: 0, w: 2.5, d: 1 });
  // Turned 90°: its width runs along z, so dragging its +u edge moves along −z.
  const t = normalizeRiser({ id: "b", x: 0, z: 0, w: 2, d: 1, h: 0.4, yaw: 90 }, 0);
  const grown = resizeTo(t, 1, 0, 0, -3);
  near(grown.w, 4); near(grown.x, 0); near(grown.z, -1);
});

test("risers: the turn handle points the riser's upstage side at the pointer", () => {
  const r = normalizeRiser({ id: "a", x: 1, z: 1, w: 2, d: 1, h: 0.4, yaw: 0 }, 0);
  const at = handleSpot(r, { kind: "turn" });
  near(at.x, 1); near(at.z, 1 - (0.5 + TURN_HANDLE_GAP)); // upstage of it
  assert.equal(yawToward(r, 1, -5), 0);
  assert.equal(yawToward(r, -5, 1), 90); // pointer to stage right: counterclockwise from above
  assert.equal(yawToward(r, 1 - 1, 1 - 0.9), 45); // snapped to 15°
  assert.equal(yawToward(r, 1 - 1, 1 - 0.9, 0), 48);
  assert.equal(yawToward(r, 1, 1), null);
  // At its own turn, the handle is where yawToward says.
  const turned = { ...r, yaw: 30 };
  const h = handleSpot(turned, { kind: "turn" });
  assert.equal(yawToward(turned, h.x, h.z), 30);
});

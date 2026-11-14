// Inputs for the stage model's geometry (pan / tilt, aiming, trusses, loading),
// and what to record from each. stage-model.test.ts compares the model with
// test/data/stage-geometry.json, recorded once from the three.js-based
// version, so the three.js-free math gives the same answers.

import type * as Model from "../stage/stage-model.ts";

type M = typeof Model;

const BASES = [
  { yaw: 0, pitch: 0, roll: 0 },
  { yaw: 30, pitch: -45, roll: 0 },
  { yaw: -120, pitch: 60, roll: 15 },
  { yaw: 180, pitch: -90, roll: 0 },
  { yaw: 45, pitch: 10, roll: -30 },
];
const DMX = [[128, 128], [0, 255], [200, 60], [255, 0], [90, 170]];
const TARGETS = [{ x: 0, y: 0, z: 0 }, { x: 3, y: 1, z: -2 }, { x: -5, y: 4, z: 3 }, { x: 0, y: 10, z: 0 }];
const POSITIONS = [{ x: 0, y: 5, z: 0 }, { x: -3, y: 2, z: 1.5 }, { x: 4, y: 0.2, z: -3 }];
const BOX = { w: 12, d: 8, h: 6 };

const pt = (p: { x: number; y: number; z: number }) => [p.x, p.y, p.z];

function fixtureAt(m: M, at: { x: number; y: number; z: number }, base: { yaw: number; pitch: number; roll: number }, [pan, tilt]: number[]) {
  return m.parseStage({ fixtures: [{ id: "f", name: "F", x: at.x, y: at.y, z: at.z, base, dmx: { pan, tilt, dimmer: 255 }, panLimit: 270, tiltLimit: 135 }] }).fixtures[0];
}

export function runCases(m: M) {
  const out: Record<string, unknown> = {};
  const fixtures: unknown[] = [];
  for (const at of POSITIONS) for (const base of BASES) for (const dmx of DMX) {
    const f = fixtureAt(m, at, base, dmx);
    const row: Record<string, unknown> = { at: pt(at), base, dmx, pan: f.pan, tilt: f.tilt };
    row.beam = pt(m.beamDir(f));
    row.hits = m.axisHits(f, BOX).map((h) => ({ t: h.t, face: h.face, point: pt(h.point) }));
    row.aims = TARGETS.map((t) => m.aimDmx(f, t));
    const z = fixtureAt(m, at, base, dmx);
    m.setZeroHere(z);
    row.zeroHere = z.base;
    const a = fixtureAt(m, at, base, dmx);
    m.aimZeroAt(a, m.defaultTarget(a, BOX));
    row.aimZero = a.base;
    fixtures.push(row);
  }
  out.fixtures = fixtures;
  const trusses: unknown[] = [];
  for (const type of ["circle", "square", "line"]) for (const [tilt, yaw, count] of [[0, 0, 8], [90, 0, 6], [30, 45, 5], [-60, -120, 4]]) {
    const saved = {
      trusses: [{ id: "r", type, x: 1, y: 4, z: -1, tilt, yaw, size: 4, count }],
      fixtures: Array.from({ length: count }, (_, i) => ({ id: `m${i}`, trussId: "r", trussIndex: i, x: 0, y: 0, z: 0 })),
    };
    const st = m.parseStage(saved);
    const truss = st.trusses[0];
    trusses.push({
      type, tilt, yaw, count,
      members: st.fixtures.map((f) => ({ at: [f.x, f.y, f.z], base: f.base })),
      outline: m.trussOutline(truss).map(pt),
      lowest: m.trussLowestY(truss),
    });
  }
  out.trusses = trusses;
  return out;
}

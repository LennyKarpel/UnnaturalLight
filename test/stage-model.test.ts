import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as model from "../stage/stage-model.ts";
import { runCases } from "./stage-cases.ts";

/** Same shape, numbers equal to within `eps` (three.js and ./rotation.ts may differ in the last bits). */
function near(actual: unknown, expected: unknown, where: string, eps = 1e-9): void {
  if (typeof expected === "number") {
    assert.equal(typeof actual, "number", where);
    assert.ok(Math.abs((actual as number) - expected) <= eps, `${where}: ${actual} ≠ ${expected}`);
  } else if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual) && actual.length === expected.length, `${where}: length`);
    expected.forEach((e, i) => near((actual as unknown[])[i], e, `${where}[${i}]`, eps));
  } else if (expected && typeof expected === "object") {
    assert.ok(actual && typeof actual === "object", where);
    assert.deepEqual(Object.keys(actual as object).sort(), Object.keys(expected).sort(), `${where}: keys`);
    for (const [k, e] of Object.entries(expected)) near((actual as Record<string, unknown>)[k], e, `${where}.${k}`, eps);
  } else {
    assert.equal(actual, expected, where);
  }
}

test("stage model: pan / tilt, aiming, beam hits and trusses match what three.js computed", () => {
  const expected = JSON.parse(fs.readFileSync(new URL("./data/stage-geometry.json", import.meta.url), "utf8"));
  near(runCases(model), expected, "stage");
});

test("stage model: aiming at a spot points the beam at it", () => {
  const { fixtures } = model.parseStage({ fixtures: [{ x: 2, y: 5, z: -1, base: { yaw: 30, pitch: -40, roll: 10 }, panLimit: 270, tiltLimit: 135 }] });
  const f = fixtures[0];
  const target = { x: -3, y: 0.5, z: 2 };
  assert.equal(model.aimAt(f, target), true);
  const dir = model.beamDir(f);
  const to = { x: target.x - f.x, y: target.y - f.y, z: target.z - f.z };
  const len = Math.hypot(to.x, to.y, to.z);
  const cos = (dir.x * to.x + dir.y * to.y + dir.z * to.z) / len;
  assert.ok(cos > 0.9995, `beam within ~2° of the target (cos ${cos})`); // DMX steps are ~1°
});

test("stage model: saved stages load with defaults and clean values", () => {
  const st = model.parseStage({ box: { w: "abc", d: 500 }, fixtures: [{ x: "1.5", panLimit: null, dmx: { pan: 999 } }], trusses: [{ type: "circle", size: "" }] });
  assert.deepEqual(st.box, { w: 12, d: 100, h: 6 });
  const f = st.fixtures[0];
  assert.equal(f.x, 1.5);
  assert.equal(f.panLimit, 270); // a saved null is the default, not 0
  assert.equal(f.dmx.pan, 255);
  assert.equal(st.trusses.length, 0); // a truss with no members is dropped
  const again = model.parseStage(model.serializeStage(st.box, st.fixtures, st.transparent, st.trusses, st.positions, st.risers));
  assert.deepEqual(again.fixtures, st.fixtures);
});

test("stage model: loading a show drops fixtures that aren't console fixtures, and a truss keeps the members left", () => {
  const linked = (id: string, k: number) => ({ id, trussId: "t", trussIndex: k, link: { consoleId: `c${id}` } });
  const saved = {
    trusses: [{ id: "t", type: "line", count: 4 }],
    fixtures: [
      linked("a", 0), { id: "b", trussId: "t", trussIndex: 1 }, linked("c", 2), linked("d", 3),
      { id: "manual", link: { start: 45, layout: ["dimmer"] } },
      { id: "pending", link: { register: { mount: "fixed", color: "single" } } },
    ],
  };
  const st = model.parseStage(saved, { linkedOnly: true });
  assert.deepEqual(st.fixtures.map((f) => f.id), ["a", "c", "d", "pending"]);
  assert.deepEqual([st.trusses[0].count, st.fixtures.slice(0, 3).map((f) => f.trussIndex)], [3, [0, 1, 2]]);
  assert.deepEqual(st.trusses[0].consoleType, { mount: "movable", color: "multi" }); // saved without one: the default
  assert.equal(model.parseStage(saved).fixtures.length, 6); // not loading a show (e.g. the model's cases): all kept
});

test("stage model: setZeroHere keeps the beam where it points", () => {
  const { fixtures } = model.parseStage({ fixtures: [{ x: 0, y: 4, z: 0, base: { yaw: 20, pitch: -30, roll: 5 }, dmx: { pan: 170, tilt: 90 } }] });
  const f = fixtures[0];
  const before = model.beamDir(f);
  model.setZeroHere(f);
  assert.equal(f.dmx.pan, 128);
  const after = model.beamDir(f);
  near([after.x, after.y, after.z], [before.x, before.y, before.z], "beam", 1e-3);
});

test("dimmer curves: what the stage draws for a dimmer value, saved with the fixture", () => {
  const box = { w: 12, d: 8, h: 6 };
  const f = model.createFixture(0, 5, 0, 0, box);
  assert.equal(f.dimmerCurve, "linear");
  model.setDmx(f, "dimmer", 128);
  assert.equal(f.intensity, 128 / 255);
  // Square law: half the value is a quarter of the light; dimmer 1 is next to nothing.
  f.dimmerCurve = "square";
  model.deriveFromDmx(f);
  assert.ok(Math.abs(f.intensity - (128 / 255) ** 2) < 1e-12);
  model.setDmx(f, "dimmer", 1);
  assert.ok(f.intensity < 2e-5);
  // Every curve: 0 is off, 255 is full, and more is never less.
  for (const curve of model.DIMMER_CURVES) {
    assert.equal(model.dimmerLight(curve, 0), 0, curve);
    assert.equal(model.dimmerLight(curve, 1), 1, curve);
    for (let v = 1; v <= 255; v++) assert.ok(model.dimmerLight(curve, v / 255) >= model.dimmerLight(curve, (v - 1) / 255), `${curve} at ${v}`);
  }
  assert.ok(model.dimmerLight("inverse-square", 0.25) > 0.25);
  // Saved and read back; anything else reads as linear.
  const { fixtures } = model.parseStage(model.serializeStage(box, [f], model.parseStage({}).transparent, []));
  assert.equal(fixtures[0].dimmerCurve, "square");
  assert.equal(model.normalizeFixture({ dimmerCurve: "bogus" }, 0).dimmerCurve, "linear");
});

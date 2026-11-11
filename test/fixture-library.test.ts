import { test } from "node:test";
import assert from "node:assert/strict";
import { modesOf, normalizeProfile, profileFor, type OflFixture } from "../stage/fixture-library.ts";

/** A made-up moving head in the Open Fixture Library's format. */
const SPOT: OflFixture = {
  name: "Spot 1",
  availableChannels: {
    Pan: { capability: { type: "Pan", angleStart: "0deg", angleEnd: "540deg" } },
    "Pan fine": { capability: { type: "Pan" } },
    Tilt: { capability: { type: "Tilt", angleStart: "0deg", angleEnd: "270deg" } },
    Dimmer: { capability: { type: "Intensity" } },
    Red: { capability: { type: "ColorIntensity", color: "Red" } },
    "Deep Red": { capability: { type: "ColorIntensity", color: "Red" } },
    Green: { capability: { type: "ColorIntensity", color: "Green" } },
    Blue: { capability: { type: "ColorIntensity", color: "Blue" } },
    Zoom: { capability: { type: "Zoom", angleStart: "8deg", angleEnd: "40deg" } },
    Strobe: { capabilities: [{ type: "NoFunction" }, { type: "ShutterStrobe" }] },
  },
  modes: [
    { name: "Basic", channels: ["Pan", "Pan fine", "Tilt", "Dimmer", "Red", "Deep Red", "Green", "Blue", "Zoom", "Strobe", null] },
    { name: "Pixels", channels: [{ insert: "matrixChannels" }] },
    { name: "Huge", channels: Array.from({ length: 70 }, () => "Dimmer") },
  ],
};

test("fixture library: a mode becomes a profile the stage can draw", () => {
  const p = profileFor(SPOT, "Acme", "acme", "spot-1", 0);
  assert.equal(p.key, "acme/spot-1");
  assert.equal(p.mount, "movable");
  assert.equal(p.color, "multi");
  assert.equal(p.panLimit, 270, "half of a 540° pan range");
  assert.equal(p.tiltLimit, 135);
  assert.deepEqual([p.zoomMin, p.zoomMax], [8, 40]);
  assert.deepEqual(p.channels.map((c) => c.attr), ["pan", null, "tilt", "dimmer", "red", "deepred", "green", "blue", "zoom", null, null]);
  assert.equal(p.channels[10].name, "Ch 11 (unused)");
});

test("fixture library: matrix and over-long modes can't be picked", () => {
  const modes = modesOf(SPOT);
  assert.deepEqual(modes.map((m) => m.ok), [true, false, false]);
  assert.match(modes[1].reason, /matrix/);
  assert.match(modes[2].reason, /70 channels/);
});

test("fixture library: saved profiles are checked and old ones upgraded", () => {
  assert.equal(normalizeProfile({ channels: [] }), null);
  assert.equal(normalizeProfile("junk"), null);
  // Saved before deep red and amber had roles: "Deep Red" was red, "Amber" had none.
  const p = normalizeProfile({ model: "Par", channels: [{ name: "Deep Red", attr: "red" }, { name: "Red", also: "red" }, { name: "Amber" }, { name: "Gobo", attr: "nonsense" }], panLimit: "" });
  assert.ok(p);
  assert.deepEqual(p.channels.map((c) => [c.attr, c.also ?? null]), [["deepred", null], ["red", null], ["amber", null], [null, null]]);
  assert.equal(p.panLimit, null, "an empty saved field is unknown, not 0");
});

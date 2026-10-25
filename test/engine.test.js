import { test } from "node:test";
import assert from "node:assert/strict";
import { computeChannelLevels, liveLevel, setChannelLevels } from "../shared/engine.js";
import { FADER_COUNT } from "../console/patch.js";

/** A patch: fader index → [{ channel, max }]. */
function patchOf(entries) {
  const patch = Array.from({ length: FADER_COUNT }, () => []);
  for (const [fader, channel, max = 255] of entries) patch[fader].push({ channel, max });
  return patch;
}
const cues = () => [new Array(FADER_COUNT).fill(0), new Array(FADER_COUNT).fill(0)];
const mixOf = (m) => ({ master: 100, cross: 0, fromSub: 100, toSub: 100, fromCue: 0, toCue: 1, ...m });
const output = (patch, mix, cueLevels) => computeChannelLevels(patch, (i) => liveLevel(mix, cueLevels, i));

test("liveLevel: submasters, crossfade and master", () => {
  const c = cues();
  c[0][0] = 200;
  c[1][0] = 100;
  assert.equal(liveLevel(mixOf({}), c, 0), 200);
  assert.equal(liveLevel(mixOf({ master: 50 }), c, 0), 100);
  assert.equal(liveLevel(mixOf({ cross: 100 }), c, 0), 100);
  assert.equal(liveLevel(mixOf({ cross: 50 }), c, 0), 150);
  assert.equal(liveLevel(mixOf({ fromSub: 50 }), c, 0), 100);
});

test("computeChannelLevels: patch max scales, highest fader wins", () => {
  const patch = patchOf([[0, 1], [1, 1, 128], [2, 2, 128]]);
  const levels = [255, 255, 255];
  const out = computeChannelLevels(patch, (i) => levels[i] ?? 0);
  assert.equal(out.get(1), 255);
  assert.equal(out.get(2), 128);
});

test("setChannelLevels: the channel then outputs the value asked for (when it can reach it)", () => {
  const cases = [
    {},
    { master: 80 },
    { fromSub: 70 },
    { cross: 100, toSub: 50 },
    { cross: 50, master: 90, fromSub: 80, toSub: 60 },
  ];
  for (const m of cases) {
    for (const max of [255, 200]) {
      const patch = patchOf([[4, 10, max]]);
      const mix = mixOf(m);
      const c = cues();
      assert.equal(setChannelLevels(patch, mix, c, [{ channel: 10, value: 90 }]), true);
      const got = output(patch, mix, c).get(10);
      assert.ok(Math.abs(got - 90) <= 2, `${JSON.stringify(m)} max ${max}: ${got}`);
    }
  }
});

test("setChannelLevels: beyond what the mix allows, the cue goes to full", () => {
  // Submaster 70% × patch max 200: at most ~140 out.
  const patch = patchOf([[4, 10, 200]]);
  const mix = mixOf({ fromSub: 70 });
  const c = cues();
  setChannelLevels(patch, mix, c, [{ channel: 10, value: 150 }]);
  assert.equal(c[0][4], 255);
  assert.equal(output(patch, mix, c).get(10), 140);
});

test("setChannelLevels: nothing moves with no fader patched or the master at 0", () => {
  const c = cues();
  assert.equal(setChannelLevels(patchOf([[0, 1]]), mixOf({}), c, [{ channel: 2, value: 100 }]), false);
  assert.equal(setChannelLevels(patchOf([[0, 1]]), mixOf({ master: 0 }), c, [{ channel: 1, value: 100 }]), false);
  assert.deepEqual(c, cues());
});

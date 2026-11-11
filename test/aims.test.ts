import { test } from "node:test";
import assert from "node:assert/strict";
import { allAims, applyAims, applyReaims } from "../console/aims.ts";
import { createCue, createSong } from "../console/songs.ts";
import { parseShow, serializeShow } from "../console/show.ts";
import { FADER_COUNT, type FaderPatch } from "../console/patch.ts";

/** Fader 0 → channel 1 (pan), fader 1 → channel 2 (tilt, at half max). */
function patch(): FaderPatch[] {
  const p: FaderPatch[] = Array.from({ length: FADER_COUNT }, () => []);
  p[0].push({ channel: 1, max: 255 });
  p[1].push({ channel: 2, max: 128 });
  return p;
}
const at = (pan: number, tilt: number) => [{ channel: 1, value: pan }, { channel: 2, value: tilt }];

test("aims: a cue keeps the aim's values and remembers the position", () => {
  const cue = createCue();
  applyAims([cue], patch(), [{ consoleId: "fx", position: "dsc", values: at(100, 64) }]);
  assert.equal(cue.levels[0], 100);
  assert.equal(cue.levels[1], 128); // 64 out of a max of 128
  assert.deepEqual(cue.aims, [{ fixture: "fx", position: "dsc" }]);
  // Aiming again replaces it; position null forgets it (the values stay).
  applyAims([cue], patch(), [{ consoleId: "fx", position: "riser", values: at(90, 64) }]);
  assert.deepEqual(cue.aims, [{ fixture: "fx", position: "riser" }]);
  applyAims([cue], patch(), [{ consoleId: "fx", position: null, values: [] }]);
  assert.deepEqual(cue.aims, []);
  assert.equal(cue.levels[0], 90);
});

test("aims: a moved position re-aims every cue that still has the old values", () => {
  const song = createSong();
  const [a, b] = song.cues;
  const c = createCue();
  song.cues.push(c);
  applyAims([a, b], patch(), [{ consoleId: "fx", position: "dsc", values: at(100, 64) }]);
  b.levels[0] = 30; // changed by hand since: it no longer follows
  assert.equal(applyReaims([song], patch(), [{ consoleId: "fx", position: "dsc", from: at(100, 64), to: at(120, 32) }]), true);
  assert.deepEqual([a.levels[0], a.levels[1]], [120, 64]);
  assert.deepEqual([b.levels[0], b.levels[1]], [30, 128]);
  assert.deepEqual([c.levels[0], c.levels[1]], [0, 0]); // never aimed
  // Nothing more to do the second time.
  assert.equal(applyReaims([song], patch(), [{ consoleId: "fx", position: "dsc", from: at(100, 64), to: at(120, 32) }]), false);
  assert.deepEqual(allAims([song]), [{ fixture: "fx", position: "dsc" }]);
});

test("aims: saved with the show, and copied with a cue", () => {
  const show = parseShow({});
  const cue = show.songs[0].cues[0];
  applyAims([cue], patch(), [{ consoleId: "fx", position: "dsc", values: at(100, 64) }]);
  const back = parseShow(JSON.parse(JSON.stringify(serializeShow(show))));
  assert.deepEqual(back.songs[0].cues[0].aims, [{ fixture: "fx", position: "dsc" }]);
  const copy = createCue({ levels: cue.levels, aims: cue.aims });
  assert.deepEqual(copy.aims, cue.aims);
  assert.notEqual(copy.aims[0], cue.aims[0]);
  // Junk is dropped.
  const junk = parseShow({ ...serializeShow(show), songs: [{ name: "x", cues: [{ aims: [{ fixture: 1 }, "x", { fixture: "a", position: "b" }] }] }] });
  assert.deepEqual(junk.songs[0].cues[0].aims, [{ fixture: "a", position: "b" }]);
});

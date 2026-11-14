// Cue steps (looks a GO passes through before the cue's own): loading,
// the output math through them, and GO / Step on the show server.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FADER_COUNT } from "../console/patch.ts";
import { parseShow, serializeShow } from "../console/show.ts";
import { copyCue, cueSeconds, shownLevels, stepPath } from "../console/songs.ts";
import { easeFade, exactLiveLevel, fadeCross, stepArrivals, stepAt, type Mix } from "../shared/engine.ts";
import { createShow } from "../server/show.ts";
import { asChannel as ch } from "../shared/address.ts";

const level = (first: number) => [first, ...new Array(FADER_COUNT - 1).fill(0)];
const mixOf = (m: Partial<Mix>): Mix => ({ master: 100, cross: 0, fromSub: 100, toSub: 100, fromCue: 0, toCue: 1, ...m });

/** Song: cue A (F1 at 0), then cue B (F1 at 200, In 2 s) with one step (F1 at 100: in 1 s, held 1 s). */
const showData = () => ({
  patch: [[{ channel: 1, max: 255 }]], // F1 → channel 1
  songs: [{
    id: "song",
    name: "Song",
    cues: [
      { id: "a", levels: level(0), fadeTime: 0 },
      { id: "b", levels: level(200), fadeTime: 2, steps: [{ id: "b1", levels: level(100), fadeTime: 1, holdTime: 1 }] },
    ],
  }],
});

test("cues load with their steps; an old cue has none", () => {
  const show = parseShow(showData());
  const [a, b] = show.songs[0].cues;
  assert.deepEqual(a.steps, []);
  assert.equal(b.steps.length, 1);
  assert.deepEqual({ id: b.steps[0].id, fade: b.steps[0].fadeTime, hold: b.steps[0].holdTime, f1: b.steps[0].levels[0] }, { id: "b1", fade: 1, hold: 1, f1: 100 });
  assert.equal(cueSeconds(b), 4);
  // Saved and loaded again: the same.
  const again = parseShow(JSON.parse(JSON.stringify(serializeShow(show))));
  assert.deepEqual(again.songs[0].cues[1].steps, b.steps);
});

test("a step with a cue's id gets a new one; a copied cue's steps get new ids", () => {
  const show = parseShow({ songs: [{ cues: [{ id: "x", levels: [] }, { id: "y", levels: [], steps: [{ id: "x", levels: [] }] }] }] });
  const step = show.songs[0].cues[1].steps[0];
  assert.notEqual(step.id, "x");
  const copy = copyCue(show.songs[0].cues[1]);
  assert.notEqual(copy.steps[0].id, step.id);
  assert.deepEqual(copy.steps[0].levels, step.levels);
});

test("the LIVE cue shows its step's levels (the same array, so edits land in the step)", () => {
  const cues = parseShow(showData()).songs[0].cues;
  const shown = shownLevels(cues, 1, 0);
  assert.equal(shown[1], cues[1].steps[0].levels);
  assert.equal(shownLevels(cues, 1, -1)[1], cues[1].levels);
  assert.equal(shownLevels(cues, 1, 5)[1], cues[1].levels); // no such step
});

test("without steps the crossfade is as before", () => {
  const cues = [level(200), level(100)];
  assert.equal(exactLiveLevel(mixOf({ cross: 50 }), cues, 0), 150);
  assert.equal(exactLiveLevel(mixOf({ cross: 50, toPath: null }), cues, 0), 150);
  assert.equal(fadeCross(0, 100, 0.3), easeFade(0.3) * 100);
});

test("a GO passes through the steps, on time", () => {
  const cue = parseShow(showData()).songs[0].cues[1];
  const path = stepPath(cue)!;
  const cues = [level(0), cue.levels];
  const at = (seconds: number) => exactLiveLevel(mixOf({ cross: fadeCross(0, 100, seconds / 4), toPath: path }), cues, 0);
  assert.equal(at(0), 0);
  assert.ok(Math.abs(at(0.5) - 50) < 1e-6, `half way into the step: ${at(0.5)}`);
  assert.ok(Math.abs(at(1) - 100) < 1e-6);
  assert.ok(Math.abs(at(1.7) - 100) < 1e-6, "held on the step");
  assert.ok(Math.abs(at(3) - 150) < 1e-6, `half way from the step to the cue: ${at(3)}`);
  assert.equal(at(4), 200);
  // Where it arrives at each look, and which one it's on.
  const [step, own] = stepArrivals(path);
  assert.ok(Math.abs(step - easeFade(0.25) * 100) < 1e-9);
  assert.equal(own, 100);
  assert.equal(stepAt(path, fadeCross(0, 100, 0.1)), 0);
  assert.equal(stepAt(path, fadeCross(0, 100, 0.6)), 1);
  assert.equal(stepAt(path, step), 0, "arrived on the step: on it");
});

test("the server: Step lands on the next cue's step, LIVE; GO plays the rest of the cue", () => {
  const show = createShow(serializeShow(parseShow(showData())));
  const f1 = () => show.levels().get(ch(1)) ?? 0;
  show.go(0, { step: true });
  assert.equal(show.live()!.fade!.durationMs, 1000, "the step's fade");
  show.tick(500);
  assert.ok(f1() > 0 && f1() < 100, `fading into the step: ${f1()}`);
  assert.deepEqual(show.tick(1000), { arrived: 1, songChanged: false });
  assert.deepEqual({ live: show.live()!.fromCue, step: show.live()!.liveStep, cross: show.live()!.cross }, { live: 1, step: 0, cross: 0 });
  assert.equal(f1(), 100);
  // GO: the rest of cue B, from its step into its own look, over its In time.
  show.go(2000);
  assert.equal(show.live()!.fade!.durationMs, 2000);
  show.tick(3000);
  assert.ok(Math.abs(f1() - 150) <= 1, `half way to the cue's own look: ${f1()}`);
  assert.deepEqual(show.tick(4000), { arrived: 1, songChanged: false });
  assert.equal(f1(), 200);
  assert.equal(show.live()!.liveStep, -1);
});

test("the server: Step from a cue's last step lands on its own look; with no steps ahead, Step is GO", () => {
  const show = createShow(serializeShow(parseShow(showData())));
  show.applyLive({ fromCue: 1, selectedCue: 1, liveStep: 0 });
  show.go(0, { step: true });
  assert.equal(show.live()!.fade!.durationMs, 2000, "the cue's own In");
  show.tick(2000);
  assert.deepEqual({ live: show.live()!.fromCue, step: show.live()!.liveStep }, { live: 1, step: -1 });
  const data = showData();
  data.songs[0].cues[1].steps = [];
  const plain = createShow(serializeShow(parseShow(data)));
  plain.go(0, { step: true });
  assert.deepEqual(plain.tick(2000), { arrived: 1, songChanged: false });
});

test("the server: a level edit by step id lands in the step", () => {
  const show = createShow(serializeShow(parseShow(showData())));
  show.applyLevels([["b1", 0, 42]]);
  assert.equal(show.serialized()!.songs[0].cues[1].steps[0].levels[0], 42);
  assert.equal(show.serialized()!.songs[0].cues[1].levels[0], 200);
});

test("the server: LIVE on a step outputs the step", () => {
  const show = createShow(serializeShow(parseShow(showData())));
  show.applyLive({ fromCue: 1, selectedCue: 1, liveStep: 0 });
  assert.equal(show.levels().get(ch(1)), 100);
  show.applyLive({ liveStep: 3 }); // no such step: the cue's own look
  assert.equal(show.levels().get(ch(1)), 200);
});

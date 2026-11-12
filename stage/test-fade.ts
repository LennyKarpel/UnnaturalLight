// The 3D view's test fade: replays the fade into the console's LIVE cue (the
// cue before it for a second, then the fade), with the LIVE cue's In time to
// adjust, ‹ › to step through it (after its last step, › goes on to the next
// cue), and « » to step LIVE (the cue the stage edits). On the stage only;
// with Live ticked the buttons are the console's instead, on the lights: GO,
// › Step and ‹ Step. The console plays it (console/stage-link.ts); this shows
// its cues, the console's step, time and clock, and the Test / GO / Stop button.

import { CUE_FADE_TIMES } from "../console/songs.ts";
import { elById } from "../shared/query.ts";
import type { TransitionTest } from "../shared/console-stage.ts";
import { consoleLink } from "./link.ts";

const bar = elById("testFade");
const btn = elById<HTMLButtonElement>("testFadeBtn");
const back = elById<HTMLButtonElement>("cueBackBtn");
const forward = elById<HTMLButtonElement>("cueForwardBtn");
const cues = elById("testFadeCues");
const time = elById<HTMLSelectElement>("testFadeTime");
const clock = elById("testFadeClock");
const live = elById<HTMLInputElement>("testFadeLive");
const stepBtn = elById<HTMLButtonElement>("testStepBtn");
const stepBackBtn = elById<HTMLButtonElement>("testStepBackBtn");
const steps = elById("testFadeSteps");
const progress = elById("testFadeProgress");

const TEST_TITLE = "Test the fade into the LIVE cue on the stage only (the lights don't change): the cue before it for a second, then the fade";
const GO_TITLE = "GO, on the lights (as the console's GO): fade to the cue up next";
const STEP_TITLE = "Test one step at a time: play to the LIVE cue's next step and hold there (after its last step: on to the next cue)";
const LIVE_STEP_TITLE = "Next step, on the lights (as the console's ›)";

/** The latest from the console (null until it says). */
let last: TransitionTest | null = null;

/** The buttons, from the latest test and the Live box. */
function sync() {
  const t = last;
  const running = t?.running ?? null;
  const held = running?.phase === "held";
  const playing = !!running && !held;
  bar.classList.toggle("is-live", live.checked);
  live.disabled = !!running;
  btn.textContent = playing ? "■ Stop" : live.checked ? "GO" : "▶ Test";
  btn.classList.toggle("is-running", playing);
  // GO needs a cue up next.
  btn.disabled = !t || (live.checked && !t.canForward);
  btn.title = live.checked ? (t?.canForward ? GO_TITLE : "Nothing up next to GO to") : TEST_TITLE;
  stepBtn.disabled = !t || playing;
  stepBtn.title = live.checked ? LIVE_STEP_TITLE : STEP_TITLE;
  stepBackBtn.disabled = !t?.canStepBack;
  stepBackBtn.title = running ? "Previous step, in the test" : "Previous step: make the look before LIVE's LIVE now (no fade), as the console's ‹";
}
live.addEventListener("change", sync);

time.append(...CUE_FADE_TIMES.map((s) => new Option(`${s}s`, String(s))));

// Test plays the whole fade (on a test held on a step: the rest of it); while it plays, Stop. Live: GO.
btn.addEventListener("click", () => {
  const running = consoleLink.test?.running;
  consoleLink.testFade(!running || running.phase === "held", live.checked);
});
stepBtn.addEventListener("click", () => consoleLink.testStep(live.checked));
stepBackBtn.addEventListener("click", () => consoleLink.testStepBack(live.checked));
back.addEventListener("click", () => consoleLink.stepCue(-1));
forward.addEventListener("click", () => consoleLink.stepCue(1));
time.addEventListener("change", () => consoleLink.setTestFade(Number(time.value)));

consoleLink.onTest((t) => {
  last = t;
  time.disabled = false;
  back.disabled = !t.canBack;
  forward.disabled = !t.canForward;
  sync();
  // With steps the In time is the console's to set; under the buttons, their count and total time.
  time.classList.toggle("is-off", t.steps > 1);
  time.tabIndex = t.steps > 1 ? -1 : 0;
  steps.hidden = t.steps < 2;
  steps.textContent = `${t.steps} steps · ${t.fadeSeconds}s`;
  cues.textContent = `${t.from} → ${t.to}`;
  cues.title = cues.textContent;
  // The console's step (while a test plays, its clock says the test's).
  progress.hidden = !!t.running || !t.progress;
  progress.textContent = t.progress;
  if (document.activeElement !== time) time.value = String(t.fadeSeconds);
  clock.classList.toggle("is-idle", !t.running);
  if (t.running) {
    const r = t.running;
    const step = r.step && t.steps > 1 ? `step ${r.step}/${t.steps}` : "";
    clock.textContent = r.phase === "hold" ? "hold" : r.phase === "held" ? `on ${step}` : [step, `${r.seconds.toFixed(1)} / ${t.fadeSeconds}s`].filter(Boolean).join(" · ");
  }
});

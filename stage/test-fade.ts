// The 3D view's test fade: replays the fade into the console's LIVE cue (the
// cue before it for a second, then the fade), with the LIVE cue's In time to
// adjust, and ‹ › to step LIVE (the cue the stage edits). On the stage only,
// or with Live ticked on the lights too (a real GO). The console plays it
// (console/stage-link.ts); this shows its cues, time and clock, and the
// Test / Stop button.

import { CUE_FADE_TIMES } from "../console/songs.ts";
import { elById } from "../shared/query.ts";
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
const steps = elById("testFadeSteps");
/** Whether a live test can start: it needs a cue before LIVE to go back to. */
let canLive = true;
const STAGE_ONLY_TITLE = "Test the fade into the LIVE cue on the stage only (the lights don't change): the cue before it for a second, then the fade";
const LIVE_TITLE = "Run the fade into the LIVE cue on the lights: the cue before it is made LIVE, and a second later GO";

function syncTestButton() {
  const running = !!consoleLink.test?.running;
  btn.disabled = !consoleLink.test || (!running && live.checked && !canLive);
  btn.title = live.checked ? (canLive ? LIVE_TITLE : "A live test needs a cue before LIVE to go back to") : STAGE_ONLY_TITLE;
}
live.addEventListener("change", syncTestButton);

time.append(...CUE_FADE_TIMES.map((s) => new Option(`${s}s`, String(s))));

// Test plays the whole fade (on a test held on a step: the rest of it); while it plays, Stop.
btn.addEventListener("click", () => {
  const running = consoleLink.test?.running;
  consoleLink.testFade(!running || running.phase === "held", live.checked);
});
stepBtn.addEventListener("click", () => consoleLink.testStep(live.checked));
back.addEventListener("click", () => consoleLink.stepCue(-1));
forward.addEventListener("click", () => consoleLink.stepCue(1));
time.addEventListener("change", () => consoleLink.setTestFade(Number(time.value)));

consoleLink.onTest((t) => {
  time.disabled = false;
  canLive = t.canBack;
  syncTestButton();
  live.disabled = !!t.running;
  bar.classList.toggle("is-live", !!t.running?.live);
  back.disabled = !t.canBack;
  forward.disabled = !t.canForward;
  const held = t.running?.phase === "held";
  btn.textContent = t.running && !held ? "■ Stop" : "▶ Test";
  btn.classList.toggle("is-running", !!t.running && !held);
  stepBtn.hidden = t.steps < 2;
  stepBtn.disabled = btn.disabled || (!!t.running && !held);
  // With steps the In time is the console's to set; here, their count and total time.
  time.hidden = t.steps > 1;
  steps.hidden = t.steps < 2;
  steps.textContent = `${t.steps} steps · ${t.fadeSeconds}s`;
  cues.textContent = `${t.from} → ${t.to}`;
  cues.title = cues.textContent;
  if (document.activeElement !== time) time.value = String(t.fadeSeconds);
  // Hidden but still taking its room, so the centered bar doesn't shift when a test starts.
  clock.classList.toggle("is-idle", !t.running);
  clock.classList.toggle("has-steps", t.steps > 1);
  if (t.running) {
    const r = t.running;
    const step = r.step && t.steps > 1 ? `step ${r.step}/${t.steps}` : "";
    clock.textContent = r.phase === "hold" ? "hold" : r.phase === "held" ? `on ${step}` : [step, `${r.seconds.toFixed(1)} / ${t.fadeSeconds}s`].filter(Boolean).join(" · ");
  }
});

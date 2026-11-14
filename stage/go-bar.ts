// The 3D view's GO bar: the console's GO area in miniature, at the top of the
// 3D view, laid out as the console's: LIVE | the buttons and the readout | UP
// NEXT and its fade, then the crossfader with UP NEXT's step ticks
// and its buttons « ‹ GO › » and crossfader are the console's: each does
// exactly what the console's own does, on the lights. The console works it all out
// (console/live.ts goArea) and sends it with every output change.

import { elById } from "../shared/query.ts";
import { GO_LABELS, type GoButton } from "../shared/console-stage.ts";
import { consoleLink } from "./link.ts";

const BUTTONS: [GoButton, string][] = [
  ["prevCue", "stageGoPrevCue"],
  ["stepBack", "stageGoStepBack"],
  ["go", "stageGoBtn"],
  ["step", "stageGoStep"],
  ["nextCue", "stageGoNextCue"],
];
const buttons = BUTTONS.map(([key, id]) => {
  const b = elById<HTMLButtonElement>(id);
  b.addEventListener("click", () => consoleLink.goPress(key));
  return [key, b] as const;
});
const goBtn = elById<HTMLButtonElement>("stageGoBtn");
const liveName = elById("stageGoLive");
const nextName = elById("stageGoNext");
const fade = elById("stageGoFade");
const readout = elById("stageGoReadout");
const cross = elById<HTMLInputElement>("stageGoCross");
const ticks = elById("stageGoTicks");

/** Being dragged: the console's updates don't move it from under the pointer. */
let dragging = false;
cross.addEventListener("pointerdown", () => { dragging = true; });
window.addEventListener("pointerup", () => { dragging = false; });
window.addEventListener("pointercancel", () => { dragging = false; });
cross.addEventListener("input", () => {
  showCross(Number(cross.value));
  consoleLink.crossTo(Number(cross.value));
});
// Done: the stage's keys act on fixtures again (as its other sliders).
cross.addEventListener("change", () => cross.blur());

function showCross(pct: number) {
  cross.style.setProperty("--cross-pct", `${pct}%`);
}

let ticksKey = "";

consoleLink.onGo((g) => {
  for (const [key, b] of buttons) {
    b.disabled = !g.buttons[key].enabled;
    b.title = g.buttons[key].title;
  }
  // GO is Pause while its fade plays and Resume once paused, as the console's.
  goBtn.textContent = GO_LABELS[g.goMode];
  goBtn.classList.toggle("is-running", g.goMode === "pause");
  goBtn.classList.toggle("is-paused", g.goMode === "resume");
  liveName.textContent = `${g.live}${g.liveStep}`;
  liveName.title = `LIVE: ${liveName.textContent}`;
  nextName.textContent = `${g.next}${g.nextStep}`;
  nextName.title = `UP NEXT: ${nextName.textContent}`;
  fade.textContent = g.nextFade;
  fade.hidden = !g.nextFade;
  readout.textContent = g.readout;
  if (!dragging) {
    cross.value = String(g.cross);
    showCross(g.cross);
  }
  const key = g.ticks.join(",");
  if (key !== ticksKey) {
    ticksKey = key;
    ticks.replaceChildren(...g.ticks.map((at) => {
      const tick = document.createElement("span");
      tick.className = "step-tick";
      tick.style.setProperty("--at", String(at));
      return tick;
    }));
  }
});

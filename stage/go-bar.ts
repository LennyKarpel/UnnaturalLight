// The 3D view's GO bar: the console's GO area, at the top of the 3D view.
// It shows what the console's shows (LIVE → UP NEXT, UP NEXT's fade, the
// readout) and its buttons « ‹ GO › » are the console's: each does exactly
// what the console's own does, on the lights. The console works it all out
// (console/live.ts goArea) and sends it with every output change.

import { elById } from "../shared/query.ts";
import type { GoButton } from "../shared/console-stage.ts";
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
const cues = elById("stageGoCues");
const fade = elById("stageGoFade");
const readout = elById("stageGoReadout");

consoleLink.onGo((g) => {
  for (const [key, b] of buttons) {
    b.disabled = !g.buttons[key].enabled;
    b.title = g.buttons[key].title;
  }
  goBtn.classList.toggle("is-running", g.running);
  cues.textContent = `${g.live}${g.liveStep} → ${g.next}${g.nextStep}`;
  cues.title = `LIVE: ${g.live}${g.liveStep} · UP NEXT: ${g.next}${g.nextStep}`;
  fade.textContent = g.nextFade;
  fade.hidden = !g.nextFade;
  readout.textContent = g.readout;
});

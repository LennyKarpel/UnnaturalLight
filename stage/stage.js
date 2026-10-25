// The stage (its pane in ../index.html): keeps up with other app windows and the show
// server, ⌥-click traces, and boot. The rest is in the modules imported below.
import { setDmx, linkChannels } from "./stage-model.js";
import { createShowLink } from "./show-link.js";
import { createTracePopover, provideTrace } from "../shared/trace.js";
import { state, loadData, serialize, save, restore, byId, ui } from "./state.js";
import { updateSurfaces, updateBox, resize } from "./view3d.js";
import { planView, setPlanView } from "./plan.js";
import { inspectorEl, renderInspector } from "./sidebar.js";
import { changed } from "./actions.js";
import "./keys.js";
import { syncBoxInputs } from "./dialogs.js";
import { consoleLink, consoleFixtureById, othersRegistering } from "./link.js";

// ---------------------------------------------------------------------
// Other app windows, and the show server
// ---------------------------------------------------------------------
// The show server keeps the stage with the show (show-link.js), and every
// app window saves its whole stage, so without this the last one to save
// would undo the others' edits. When another window saves (the server passes
// it on), take its stage, but keep this window's selection, and for linked
// channels the values this window heard from the console (the other copy may
// be a moment older). A save that changes nothing else is ignored, so console
// moves don't redraw the inspector under your cursor.

/** @param {unknown} data a stage another window saved */
function takeStage(data) {
  const before = JSON.stringify(serialize());
  const mine = new Map(state.fixtures.map((i) => [i.id, i]));
  const selected = state.selected;
  loadData(data);
  for (const fixture of state.fixtures) {
    const was = mine.get(fixture.id);
    if (was) {
      for (const { attr } of linkChannels(fixture)) if (fixture.dmx[attr] !== was.dmx[attr]) setDmx(fixture, attr, was.dmx[attr]);
    } else if (fixture.link.register) {
      othersRegistering.add(fixture.id);
    }
  }
  state.selected = selected.filter((id) => byId(id));
  if (JSON.stringify(serialize()) === before) return false;
  syncBoxInputs();
  updateBox();
  updateSurfaces();
  renderInspector();
  changed({ persist: false });
  return true;
}

// ---------------------------------------------------------------------
// Trace: ⌥-click a fixture (3D, plan, list) or a channel badge in the
// inspector for a card showing what controls it and the current values.
// ---------------------------------------------------------------------

export const trace = createTracePopover();

/** The stage's fixtures as the trace card sees them. */
function traceLights() {
  return state.fixtures.map((i) => ({
    id: i.id,
    name: i.name,
    start: i.link.start,
    layout: i.link.layout,
    dmx: { ...i.dmx },
    notes: { dimmer: `${Math.round(i.intensity * 100)}%`, pan: `${i.pan}°`, tilt: `${i.tilt}°`, zoom: `${i.beam}°` },
    consoleId: i.link.consoleId,
    consoleName: i.link.consoleId ? consoleFixtureById(i.link.consoleId)?.name ?? null : null,
    // Real fixture channel names (per channel, from the start channel), if it's a library fixture.
    channelNames: i.link.fixture ? i.link.fixture.channels.map((c) => c.name) : null,
    fixture: i.link.fixture ? `${i.link.fixture.manufacturer} ${i.link.fixture.model} · ${i.link.fixture.mode}` : null,
  }));
}

provideTrace({ stage: traceLights });

export function showTrace(target, e) {
  trace.show(target, e.clientX, e.clientY);
}

// Tell the console the stage's channel layouts (coalesced).
let publishTimer = 0;
export function publishStage() {
  clearTimeout(publishTimer);
  publishTimer = setTimeout(() => consoleLink.publishStage(state.fixtures.map((i) => ({ consoleId: i.link.consoleId, layout: i.link.layout }))), 80);
}

// ⌥-click a channel badge in the inspector: trace that DMX channel.
inspectorEl.addEventListener("click", (e) => {
  const badge = e.altKey && e.target instanceof Element ? e.target.closest("[data-ch]") : null;
  if (badge) showTrace({ kind: "channel", channel: Number(badge.dataset.ch) }, e);
});

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------

restore();
syncBoxInputs();
updateSurfaces();
setPlanView(planView);
updateBox();
renderInspector();
changed({ persist: false });
resize();
ui.showLink = createShowLink({
  current: serialize,
  // Also keep it in this browser, for the next time it opens.
  onStage: (data) => { if (takeStage(data)) save({ share: false }); },
});

// The stage page (stage.html): keeps up with other stage pages and the show
// server, ⌥-click traces, and boot. The rest is in the modules imported below.
import { STORAGE_KEY, setDmx, linkChannels } from "./stage-model.js";
import { createShowLink } from "./show-link.js";
import { createTracePopover } from "../shared/trace.js";
import { state, loadData, serialize, save, restore, byId, ui } from "./state.js";
import { updateSurfaces, updateBox, resize } from "./view3d.js";
import { planView, setPlanView } from "./plan.js";
import { inspectorEl, renderInspector } from "./sidebar.js";
import { changed } from "./actions.js";
import "./keys.js";
import { syncBoxInputs } from "./dialogs.js";
import { consoleLink, consoleFixtureById, othersRegistering } from "./link.js";

// ---------------------------------------------------------------------
// Other stage pages, and the show server
// ---------------------------------------------------------------------
// The show server keeps the stage with the show (show-link.js), and every
// stage page saves the whole stage, so without this the last one to save
// would undo the others' edits. When another page saves (in this browser,
// or anywhere via the server), take its stage, but keep this page's
// selection, and for linked channels the values this page heard from the
// console (the other copy may be a moment older). A save that changes
// nothing else is ignored, so console moves don't redraw the inspector
// under your cursor.

/** @param {unknown} data a stage another page saved */
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

window.addEventListener("storage", (e) => {
  if (e.key !== STORAGE_KEY || !e.newValue) return;
  try { takeStage(JSON.parse(e.newValue)); } catch { /* not a stage */ }
});

// ---------------------------------------------------------------------
// Trace: ⌥-click a fixture (3D, plan, list) or a channel badge in the
// inspector for a card showing what controls it and the current values.
// ---------------------------------------------------------------------

export const trace = createTracePopover();

/** A stage fixture as the trace card (here and in the console) sees it. */
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

function traceSnapshot() {
  const { levels, faders, mix, universes } = consoleLink.traceInfo();
  return { live: consoleLink.live, levels, faders, mix, universes, consoleFixtures: consoleLink.fixtures(), stageFixtures: traceLights() };
}

export function showTrace(target, e) {
  trace.show(target, e.clientX, e.clientY, traceSnapshot);
}

// Tell the console about the stage's fixtures (coalesced; plus a slow heartbeat).
let publishTimer = 0;
export function publishStage() {
  clearTimeout(publishTimer);
  publishTimer = setTimeout(() => consoleLink.publishStage(traceLights()), 80);
}
setInterval(publishStage, 2000);

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

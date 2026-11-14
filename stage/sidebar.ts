// Sidebar: the fixture list, the inspector and the key strip (HUD).
import { followingOf } from "./follow.ts";
import { fmtLength, fmtNumber, fromShown, inputStep, lengthUnit, onUnitChange, toShown } from "./units.ts";

/** Fields shown in the length unit (meters or feet). */
const isLength = (k: string) => k === "x" || k === "y" || k === "z" || k === "size";
import {
  DIMMER_CURVES,
  DIMMER_CURVE_LABELS,
  MAX_FIXTURES,
  MAX_POSITIONS,
  round,
  beamDir,
  isInside,
  axisHits,
  TRUSS_TYPES,
  setDmx,
  setColorHex,
  deriveFromDmx,
  type Fixture,
  type Frame,
  type Truss,
  type Xyz,
} from "./stage-model.ts";
import { clamp, numberFrom } from "../shared/numbers.ts";
import { applyCollapsed } from "./panel.ts";
import { DMX_LABELS, DMX_SHORT, isDmxAttr, type DmxAttr } from "../shared/attributes.ts";
import { escapeHtml, el } from "../shared/html.ts";
import { bindPanTiltPad } from "../shared/pan-tilt-pad.ts";
import { COLOR_ROLES, emitterHex, isColorRole } from "../shared/color.ts";
import { state, selectedFixtures, trussOf, commonTruss, setTrussField, TRUSS_FIELDS, positionById, riserById, ui } from "./state.ts";
import { MAX_RISERS, RISER_FIELDS, setRiserField } from "./risers.ts";
import { isOneOf, isPresent } from "../shared/guards.ts";
import {
  flashing,
  startFlash,
  stopFlash,
  changed,
  select,
  selectTrussOf,
  holdDimmer,
  openContextMenu,
  openPositionMenu,
  act,
  ACTIONS,
  aimAtPosition,
  deletePosition,
  setActivePosition,
  setHoverPosition,
  setPlacing,
  setActiveRiser,
  deleteRiser,
  openRiserMenu,
} from "./actions.ts";
import { linkSectionHtml, trussLinkHtml, bindLinkControls, syncDmxRows, inspectorAttrs } from "./link.ts";
import { showTrace } from "./stage.ts";
import { $, elById } from "../shared/query.ts";
import { readStored, store } from "../shared/storage.ts";

// ---------------------------------------------------------------------
// Sidebar: list + inspector
// ---------------------------------------------------------------------

const listEl = elById("list");
export const inspectorEl = elById("inspector");
const hudEl = elById("hud");

/** The inspector's heading (it's redrawn with the inspector), with its collapse arrow. */
function inspectorHeading(note = "") {
  return `<h2><span class="h2-title">Inspector<button type="button" class="collapse-btn"></button></span>${note}</h2>`;
}

/** Selection the list last showed, to scroll a newly selected fixture into view. */
let listSelectionKey = "";

// The list part has three tabs: Fixtures, Positions and Risers (remembered in this browser).
const LIST_TAB_KEY = "unnaturallight.stage.listTab";
const LIST_TABS = ["fixtures", "positions", "risers"] as const;
type ListTab = (typeof LIST_TABS)[number];
const savedTab = readStored(LIST_TAB_KEY);
let listTab: ListTab = isOneOf(LIST_TABS, savedTab) ? savedTab : "fixtures";
const positionListEl = elById("positionList");
const riserListEl = elById("riserList");

function setListTab(tab: ListTab) {
  listTab = tab;
  store(LIST_TAB_KEY, tab);
  renderList();
}
document.querySelectorAll<HTMLElement>("[data-list-tab]").forEach((b) => {
  b.addEventListener("click", () => { const tab = b.dataset.listTab; setListTab(isOneOf(LIST_TABS, tab) ? tab : "fixtures"); b.blur(); });
});

/** Show the Positions tab (`rename`: put the cursor in that position's name). */
export function showPositions({ rename }: { rename?: string } = {}) {
  if (listTab !== "positions") setListTab("positions");
  else renderPositionList(true);
  if (rename) {
    const input = positionListEl.querySelector<HTMLInputElement>(`[data-position-row="${rename}"] input[data-pk="name"]`);
    input?.focus();
    input?.select();
  }
}

/** Show the Risers tab (`rename`: put the cursor in that riser's name). */
export function showRisers({ rename }: { rename?: string } = {}) {
  if (listTab !== "risers") setListTab("risers");
  else renderRiserList(true);
  if (rename) {
    const input = riserListEl.querySelector<HTMLInputElement>(`[data-riser-row="${rename}"] input[data-rk="name"]`);
    input?.focus();
    input?.select();
  }
}

/** What the fixture rows show apart from levels: the rows are only rebuilt when this changes. */
let fixtureListKey = "";
const fixtureRowsKey = () =>
  state.fixtures.map((f) => [f.id, f.name, followingOf(f)?.name ?? "", isInside(f, state.box), state.selected.includes(f.id)].join("\u0001")).join("\n");

/** A fixture row's color swatch, dimmer bar and dimmer value. */
function showRowLevels(row: HTMLElement, fixture: Fixture) {
  $(row, ".swatch").style.background = fixture.color;
  $(row, ".bar > div").style.width = `${Math.round(fixture.intensity * 100)}%`;
  $(row, ".pct").textContent = String(fixture.dmx.dimmer);
}

export function renderList() {
  document.querySelectorAll<HTMLElement>("[data-list-tab]").forEach((b) => {
    const on = b.dataset.listTab === listTab;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", String(on));
  });
  listEl.hidden = listTab !== "fixtures";
  positionListEl.hidden = listTab !== "positions";
  riserListEl.hidden = listTab !== "risers";
  if (listTab === "positions") { renderPositionList(); return; }
  if (listTab === "risers") { renderRiserList(); return; }
  elById("count").textContent = `${state.fixtures.length} / ${MAX_FIXTURES}`;
  if (!state.fixtures.length) {
    listEl.innerHTML = `<div class="empty">None yet — press <kbd>P</kbd> or “+ Fixture”.</div>`;
    fixtureListKey = "";
    return;
  }
  // Only the levels changed (a fade, many times a second): update the rows in place.
  const key = fixtureRowsKey();
  if (key === fixtureListKey) {
    state.fixtures.forEach((fixture, i) => { const row = listEl.children[i]; if (row instanceof HTMLElement) showRowLevels(row, fixture); });
    return;
  }
  fixtureListKey = key;
  // The list scrolls on its own; rebuilding it would jump back to the top.
  const scrollTop = listEl.scrollTop;
  listEl.innerHTML = "";
  for (const fixture of state.fixtures) {
    const row = el("div", "item" + (state.selected.includes(fixture.id) ? " sel" : ""));
    row.innerHTML = `
      <span class="swatch"></span>
      <span></span>
      <div class="bar"><div></div></div>
      <span class="pct" title="Dimmer (0–255)"></span>`;
    showRowLevels(row, fixture);
    const follows = followingOf(fixture);
    row.children[1].textContent = fixture.name + (follows ? `  → ${follows.name}` : "") + (isInside(fixture, state.box) ? "" : "  ·  outside");
    row.addEventListener("click", (e) => {
      if (e.altKey) showTrace({ kind: "stageFixture", id: fixture.id }, e);
      // A double-click on a truss's fixture selects the whole truss (⇧ / ⌘: adds it). (Not "dblclick": the first click rebuilds the rows.)
      else if (!(e.detail === 2 && selectTrussOf(fixture.id, e.shiftKey || e.metaKey))) select(fixture.id, e.shiftKey || e.metaKey);
    });
    row.addEventListener("contextmenu", (e) => { e.preventDefault(); openContextMenu(fixture.id, e.clientX, e.clientY); });
    listEl.append(row);
  }
  listEl.scrollTop = scrollTop;
  const selectionKey = state.selected.join(",");
  if (selectionKey !== listSelectionKey) {
    listSelectionKey = selectionKey;
    // Scroll just the list (scrollIntoView could move the whole side panel).
    const row = listEl.querySelector<HTMLElement>(".item.sel");
    if (row) {
      const box = listEl.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      if (r.top < box.top) listEl.scrollTop -= box.top - r.top;
      else if (r.bottom > box.bottom) listEl.scrollTop += r.bottom - box.bottom;
    }
  }
}

/** What the position list last showed (it isn't rebuilt while that's unchanged, so typing in it keeps its place). */
let positionListKey = "";

const POSITION_FIELDS = ["name", "x", "y", "z"] as const;

function renderPositionList(force = false) {
  elById("count").textContent = `${state.positions.length} / ${MAX_POSITIONS}`;
  const hasSel = state.selected.length > 0;
  const key = JSON.stringify([state.positions, ui.activePosition, hasSel, lengthUnit()]);
  if (!force && key === positionListKey) return;
  // Typing in a field: leave the rows alone while the same positions are listed
  // (the field already shows what's typed; rebuilding would drop the cursor).
  const ids = state.positions.map((p) => p.id).join();
  const shownIds = [...positionListEl.querySelectorAll<HTMLElement>("[data-position-row]")].map((r) => r.dataset.positionRow).join();
  if (!force && ids === shownIds && positionListEl.contains(document.activeElement)) return;
  positionListKey = key;
  if (!state.positions.length) {
    positionListEl.innerHTML = `<div class="empty">None yet: “+ Position” puts one on the floor, a wall or the ceiling. Then aim fixtures at it by name (right-click a fixture, or the chat).</div>`;
    return;
  }
  const scrollTop = positionListEl.scrollTop;
  positionListEl.innerHTML = "";
  for (const position of state.positions) {
    const row = el("div", "item position-row" + (ui.activePosition === position.id ? " sel" : ""));
    row.dataset.positionRow = position.id;
    row.innerHTML = `
      <span class="position-mark" aria-hidden="true">◆</span>
      <input type="text" data-pk="name" maxlength="40" title="Position name" />
      <button type="button" data-aim ${hasSel ? 'title="Aim the selected fixtures at this position"' : 'disabled title="Select fixtures first"'}>Aim</button>
      <button type="button" data-del class="danger" title="Delete this position">✕</button>
      <div class="xyz position-xyz">
        <input type="number" step="0.1" data-pk="x" title="x (− SR · + SL)" />
        <input type="number" step="0.1" min="0" data-pk="y" title="height" />
        <input type="number" step="0.1" data-pk="z" title="z (− upstage · + audience)" />
      </div>`;
    for (const input of row.querySelectorAll<HTMLInputElement>("[data-pk]")) {
      const k = input.dataset.pk;
      if (!isOneOf(POSITION_FIELDS, k)) continue;
      input.value = k === "name" ? position.name : String(toShown(position[k]));
      if (k !== "name") input.step = inputStep();
      input.addEventListener("input", () => {
        const p = positionById(position.id);
        if (!p) return;
        if (k === "name") { if (input.value.trim()) p.name = input.value.trim(); }
        else {
          const shown = numberFrom(input.value);
          if (shown == null) return;
          const v = fromShown(shown);
          p[k] = k === "y" ? clamp(v, 0, 100) : clamp(v, -100, 100);
        }
        changed({ list: false, inspector: false });
      });
      input.addEventListener("blur", () => { const p = positionById(position.id); if (p) input.value = k === "name" ? p.name : String(toShown(p[k])); });
      input.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === "Escape") input.blur(); });
    }
    row.querySelector("[data-aim]")?.addEventListener("click", () => aimAtPosition(position.id));
    row.querySelector("[data-del]")?.addEventListener("click", () => deletePosition(position.id));
    // Hovering the row lights the position up in 3D and the plan, to find it.
    row.addEventListener("pointerenter", () => setHoverPosition(position.id));
    row.addEventListener("contextmenu", (e) => { e.preventDefault(); openPositionMenu(position.id, e.clientX, e.clientY); });
    row.addEventListener("pointerleave", () => setHoverPosition(null));
    row.addEventListener("click", (e) => {
      if (e.target instanceof Element && e.target.closest("input, button")) return;
      setActivePosition(ui.activePosition === position.id ? null : position.id);
    });
    positionListEl.append(row);
  }
  positionListEl.scrollTop = scrollTop;
}

elById("positionBtn").addEventListener("click", (e) => {
  (e.currentTarget as HTMLElement).blur();
  if (ui.placing && ui.placingPosition) setPlacing(false);
  else setPlacing(true, null, "position");
});

/** What the riser list last showed (not rebuilt while unchanged, so typing in it keeps its place). */
let riserListKey = "";

/** Riser fields shown in the length unit (the rest: name, and yaw in degrees). */
const isRiserLength = (k: string) => k !== "name" && k !== "yaw";

/** The Risers tab: a row per riser with its name, size, place and turn. */
function renderRiserList(force = false) {
  elById("count").textContent = `${state.risers.length} / ${MAX_RISERS}`;
  const key = JSON.stringify([state.risers, ui.activeRiser, lengthUnit()]);
  if (!force && key === riserListKey) return;
  // Typing in a field: leave the rows alone while the same risers are listed.
  const ids = state.risers.map((r) => r.id).join();
  const shownIds = [...riserListEl.querySelectorAll<HTMLElement>("[data-riser-row]")].map((r) => r.dataset.riserRow).join();
  if (!force && ids === shownIds && riserListEl.contains(document.activeElement)) return;
  riserListKey = key;
  if (!state.risers.length) {
    riserListEl.innerHTML = `<div class="empty">None yet: “+ Riser” puts an 8 × 4 ft deck (2.4 × 1.2 m, 0.4 m high) on the floor where you click. Drag it to move it; set its size and turn here.</div>`;
    return;
  }
  const scrollTop = riserListEl.scrollTop;
  riserListEl.innerHTML = "";
  const u = lengthUnit();
  for (const riser of state.risers) {
    const row = el("div", "item riser-row" + (ui.activeRiser === riser.id ? " sel" : ""));
    row.dataset.riserRow = riser.id;
    row.innerHTML = `
      <span class="riser-mark" aria-hidden="true">▬</span>
      <input type="text" data-rk="name" maxlength="40" title="Riser name" />
      <button type="button" data-del class="danger" title="Delete this riser (⌘Z to undo)">✕</button>
      <div class="riser-fields">
        <label>W · D · H ${u}</label>
        <div class="xyz">
          <input type="number" min="0" data-rk="w" title="width (stage right to left, before it's turned)" />
          <input type="number" min="0" data-rk="d" title="depth (upstage to downstage, before it's turned)" />
          <input type="number" min="0" data-rk="h" title="height" />
        </div>
        <label>x · z ${u} · turn °</label>
        <div class="xyz">
          <input type="number" data-rk="x" title="center x (− SR · + SL)" />
          <input type="number" data-rk="z" title="center z (− upstage · + audience)" />
          <input type="number" step="15" min="-180" max="180" data-rk="yaw" title="turn about the vertical, ° (+ = counterclockwise from above)" />
        </div>
      </div>`;
    for (const input of row.querySelectorAll<HTMLInputElement>("[data-rk]")) {
      const k = input.dataset.rk;
      if (!isOneOf(RISER_FIELDS, k)) continue;
      const shown = () => {
        const r = riserById(riser.id);
        if (!r) return "";
        const v = r[k];
        return typeof v === "string" ? v : String(isRiserLength(k) ? toShown(v) : v);
      };
      input.value = shown();
      if (isRiserLength(k)) input.step = inputStep();
      input.addEventListener("input", () => {
        const r = riserById(riser.id);
        if (!r) return;
        if (k === "name") setRiserField(r, k, input.value);
        else {
          const v = numberFrom(input.value);
          if (v == null) return;
          setRiserField(r, k, isRiserLength(k) ? fromShown(v) : v);
        }
        changed({ list: false, inspector: false });
      });
      input.addEventListener("blur", () => { input.value = shown(); });
      input.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === "Escape") input.blur(); });
    }
    row.querySelector("[data-del]")?.addEventListener("click", () => deleteRiser(riser.id));
    row.addEventListener("contextmenu", (e) => { e.preventDefault(); openRiserMenu(riser.id, e.clientX, e.clientY); });
    row.addEventListener("click", (e) => {
      if (e.target instanceof Element && e.target.closest("input, button")) return;
      setActiveRiser(ui.activeRiser === riser.id ? null : riser.id);
    });
    riserListEl.append(row);
  }
  riserListEl.scrollTop = scrollTop;
}

elById("riserBtn").addEventListener("click", (e) => {
  (e.currentTarget as HTMLElement).blur();
  if (ui.placing && ui.placingRiser) setPlacing(false);
  else setPlacing(true, null, "riser");
});

/** Inspector block for editing a truss (shown when the selection is all one truss). */
function trussSectionHtml(truss: Truss) {
  return `
    <div class="fields truss-fields">
      <div class="subhead">Truss · ${TRUSS_TYPES[truss.type].name}</div>
      <label>Truss name</label><input type="text" data-r="name" />
      <label>Center</label>
      <div class="xyz">
        <input type="number" step="${inputStep()}" data-r="x" title="x (− SR · + SL)" />
        <input type="number" step="${inputStep()}" data-r="y" title="height" />
        <input type="number" step="${inputStep()}" data-r="z" title="z (− upstage · + audience)" />
      </div>
      <label>${TRUSS_TYPES[truss.type].sizeLabel} ${lengthUnit()}</label><input type="number" min="0" step="${inputStep()}" data-r="size" />
      <label>Fixtures</label><input type="number" min="2" max="${MAX_FIXTURES}" step="1" data-r="count" />
      <label>Tilt °</label>
      <div class="slider" title="tilt: 0 = flat, 90 = upright facing the audience">
        <input type="range" min="-90" max="90" step="1" data-r="tilt" />
        <input type="number" min="-90" max="90" step="1" data-r="tilt" />
      </div>
      <label>Yaw °</label>
      <div class="slider" title="yaw: turn about the vertical">
        <input type="range" min="-180" max="180" step="1" data-r="yaw" />
        <input type="number" min="-180" max="180" step="1" data-r="yaw" />
      </div>
    </div>`;
}

/** A DMX value row: its name, slider, number and note, in a box like a console fader. `style` is for its block's grid. */
function dmxLineHtml(a: DmxAttr, style = "") {
  return `
      <div class="dmx-line" data-dl="${a}"${style}>
        <label>${DMX_LABELS[a]}</label>${a === "dimmer" ? `
        <span class="dim-btns"><button type="button" class="dim-btn dim-blackout" data-hold="blackout" title="Blackout: dimmer at 0 while held">B</button><button type="button" class="dim-btn dim-flash" data-hold="flash" title="Flash: full and white while held">F</button></span>` : ""}
        <div ${isColorRole(a) ? `class="dmx-row has-emitter" style="--emitter: ${emitterHex(a)}"` : `class="dmx-row"`}>
          <input type="range" min="0" max="255" step="1" data-d="${a}" />
          <input type="number" min="0" max="255" step="1" data-d="${a}" />
          <span class="dmx-note" data-note="${a}"></span>
        </div>
      </div>`;
}

/**
 * The inspector's DMX rows. Pan and tilt share one block, with the pan / tilt
 * pad standing upright across both, beside their sliders. The color rows
 * share one too, with the fixture's color (click to pick one) upright beside
 * them, like the console's color bar.
 */
function dmxRowsHtml(attrs: DmxAttr[]) {
  const firstColor = attrs.findIndex(isColorRole);
  const lastColor = attrs.findLastIndex(isColorRole);
  /** The lines for attrs[from, to); `rowed` puts each in its own grid row (for the color bar to span). */
  const linesHtml = (from: number, to: number, rowed = false) => {
    let html = "";
    let rows = 0;
    for (let i = from; i < to; i++) {
      const a = attrs[i];
      if (a === "tilt" && attrs[i - 1] === "pan") continue;
      const style = rowed ? ` style="grid-row: ${++rows}"` : "";
      html += a === "pan" && attrs[i + 1] === "tilt" ? `
      <div class="pt-block"${style}>
        <div data-pt title="Hold and move the mouse: left / right = pan, up / down = tilt (⇧ = fine)">✥</div>${dmxLineHtml("pan")}${dmxLineHtml("tilt")}
      </div>` : dmxLineHtml(a, style);
    }
    return { html, rows };
  };
  if (firstColor < 0) return linesHtml(0, attrs.length).html;
  const colors = linesHtml(firstColor, lastColor + 1, true);
  return `${linesHtml(0, firstColor).html}
      <div class="color-block">
        <label class="rgb-bar" data-rgb style="grid-row: 1 / ${colors.rows + 1}" title="Click to pick a color (mixed onto the color channels it's linked with; red / green / blue when none)"><input type="color" data-k="color" aria-label="Color" /></label>${colors.html}
      </div>${linesHtml(lastColor + 1, attrs.length).html}`;
}

/** Rebuild the inspector for the current selection (none, one, or several). */
/** Inspector line for fixtures that follow a position (filled in by showFollow). */
const FOLLOW_NOTE = `<div class="follow-note" data-follow hidden><span></span><select data-follow-pick title="Aim at a named position (they follow it)"></select><button type="button" data-act="unfollow" title="Stay aimed where it is, but stop following the position">Stop following</button></div>`;

export function renderInspector() {
  const sel = selectedFixtures();
  if (!sel.length) {
    inspectorEl.innerHTML = `${inspectorHeading()}<div class="empty">Select a fixture.</div>`;
    wrapInspectorBody();
    return;
  }
  if (sel.length > 1) {
    const selTruss = commonTruss(sel);
    inspectorEl.innerHTML = `
      ${inspectorHeading(`<span>${sel.length} selected</span>`)}
      <div class="fields">
        <label>Dimmer</label>
        <div class="slider"><input type="range" min="0" max="255" step="1" data-multi="dimmer" /><input type="number" min="0" max="255" data-multi="dimmer" /></div>
        <label>Zoom</label>
        <div class="slider"><input type="range" min="0" max="255" step="1" data-multi="zoom" title="Beam angle (each fixture's own zoom range)" /><input type="number" min="0" max="255" data-multi="zoom" /></div>
        <label>Color</label>
        <input type="color" data-multi="color" />
        <label>Dimmer curve</label>
        <select data-multi="dimmerCurve" title="How the real fixtures turn their dimmer value into light (as set in their menus), so the stage draws them as bright: the DMX sent doesn't change"><option value="" hidden>Mixed</option>${DIMMER_CURVES.map((c) => `<option value="${c}">${DIMMER_CURVE_LABELS[c]}</option>`).join("")}</select>
      </div>
      <p class="hint">Sets every selected fixture. Arrow keys, +/− and [ ] step each one's own 0–255 values (⇧ = 10).</p>
      ${selTruss ? trussSectionHtml(selTruss) + trussLinkHtml() : ""}
      ${FOLLOW_NOTE}
      <div class="buttons">
        <button data-flash class="flash" title="Hold to flash white at full intensity (F)">Flash</button>
        <button data-act="aimSpot" title="Point all selected beams at one spot (A)">Aim at spot</button>
        <button data-act="home">Home all</button>
        <button data-act="zero">Set zero here (all)</button>
        <button data-act="aim">Aim zero at stage</button>
        <button data-act="del" class="danger" title="Delete all selected (⌫ or right-click) · ⌘Z to undo">Delete all</button>
      </div>`;
    bindInspector();
    syncInspector();
    return;
  }
  const truss = trussOf(sel[0]);
  const lock = truss ? 'disabled title="Set by the truss"' : "";
  inspectorEl.innerHTML = `
    ${inspectorHeading(truss ? `<span>in ${escapeHtml(truss.name)}</span>` : "")}
    <div class="fields">
      <label>Name</label><input type="text" data-k="name" />
      <label>Location</label>
      <div class="xyz">
        <input type="number" step="${inputStep()}" data-k="x" title="x (− SR · + SL)" ${lock} />
        <input type="number" step="${inputStep()}" data-k="y" title="height" ${lock} />
        <input type="number" step="${inputStep()}" data-k="z" title="z (− upstage · + audience)" ${lock} />
      </div>
      <label></label><div class="hint" style="margin:0">x · height · z (${lengthUnit()})${truss ? " · set by the truss (drag to move the whole truss)" : ""}</div>

      <div class="subhead">DMX values · 0–255</div>
      <div class="fixture-outline dmx-box" data-outline data-attrs="${inspectorAttrs(sel[0]).join(",")}">${dmxRowsHtml(inspectorAttrs(sel[0]))}
      </div>
      <div class="other-chans" data-other hidden></div>

      <div class="subhead">Ranges (what 0 and 255 mean)</div>
      <label>Pan / Tilt ±°</label>
      <div class="xyz">
        <input type="number" min="0" max="360" step="5" data-k="panLimit" title="pan: 0 = −limit, 128 = zero, 255 = +limit" />
        <input type="number" min="0" max="180" step="5" data-k="tiltLimit" title="tilt: 0 = −limit, 128 = zero, 255 = +limit" />
      </div>
      <label>Zoom °</label>
      <div class="xyz">
        <input type="number" min="1" max="120" step="1" data-k="zoomMin" title="beam angle at zoom 0" />
        <input type="number" min="1" max="120" step="1" data-k="zoomMax" title="beam angle at zoom 255" />
      </div>
      <label>Dimmer curve</label>
      <select data-k="dimmerCurve" title="How the real fixture turns its dimmer value into light (set it to match the fixture's menu), so the stage draws it as bright: the DMX sent doesn't change">${DIMMER_CURVES.map((c) => `<option value="${c}">${DIMMER_CURVE_LABELS[c]}</option>`).join("")}</select>

      <div class="subhead">Zero frame (world)</div>
      <label>Yaw/Pitch/Roll</label>
      <div class="xyz">
        <input type="number" step="1" data-k="base.yaw" title="yaw ° (0 = facing upstage, +90 = facing stage right)" ${lock} />
        <input type="number" step="1" data-k="base.pitch" title="pitch ° (−90 = straight down)" ${lock} />
        <input type="number" step="1" data-k="base.roll" title="roll ° (which way is 'up' for the arrow keys)" ${lock} />
      </div>
      <div class="readout" id="readout"></div>
    </div>
    ${linkSectionHtml(sel[0])}
    ${truss ? trussSectionHtml(truss) + trussLinkHtml() : ""}
    ${FOLLOW_NOTE}
    <div class="buttons">
      <button data-flash class="flash" title="Hold to flash white at full intensity (F)">Flash</button>
      <button data-act="aimSpot" title="Point the beam at a spot you click (A)">Aim at spot</button>
      <button data-act="home" title="Pan/tilt back to 0 (H)">Home</button>
      ${truss ? `<button data-act="selectTruss" title="Select every fixture in this truss">Select whole truss</button>` : `
      <button data-act="zero" title="Make the current direction the new zero (Z)">Set zero here</button>
      <button data-act="aim" title="Point zero at the stage center">Aim zero at stage</button>`}
      <button data-act="dup" title="${truss ? "Copy as a free fixture (not part of the truss)" : "Copy"}">Duplicate</button>
      <button data-act="del" class="danger" title="Delete (⌫ or right-click) · double-click a truss's fixture to select the whole truss · ⌘Z to undo">Delete</button>
    </div>`;
  bindInspector();
  syncInspector();
}

/**
 * The position line (when there are named positions): what the selected
 * fixtures follow, with a dropdown to aim them at another (or, when none
 * follow, at one), and Stop following.
 */
function syncFollowNote(sel: Fixture[]) {
  const note = inspectorEl.querySelector<HTMLElement>("[data-follow]");
  const pick = note?.querySelector<HTMLSelectElement>("[data-follow-pick]");
  const text = note?.querySelector("span");
  const stop = note?.querySelector<HTMLElement>('[data-act="unfollow"]');
  if (!note || !pick || !text || !stop) return;
  note.hidden = !state.positions.length;
  if (note.hidden) return;
  const ids = sel.map((f) => followingOf(f)?.id ?? null);
  const n = ids.filter(isPresent).length;
  const one = n === sel.length && new Set(ids).size === 1 ? ids[0] : null;
  text.textContent = !n ? "Aim at" : sel.length === 1 ? "Following" : `${n} of ${sel.length} following`;
  stop.hidden = !n;
  if (!pick.dataset.bound) {
    pick.dataset.bound = "1";
    pick.addEventListener("change", () => {
      if (pick.value) aimAtPosition(pick.value, selectedFixtures());
      pick.blur();
    });
  }
  // Rebuilt only when it would show something else (and not while it's open).
  const key = JSON.stringify([state.positions.map((p) => [p.id, p.name]), one, n > 0]);
  if (pick.dataset.key === key || pick === document.activeElement) return;
  pick.dataset.key = key;
  pick.innerHTML = "";
  if (!one) pick.append(new Option(n ? "(several)" : "Choose a position…", "", true, true));
  for (const p of state.positions) pick.append(new Option(p.name, p.id, false, p.id === one));
}

/** The fixture fields the inspector edits (its inputs' `data-k`). */
const FIXTURE_FIELDS = ["name", "color", "x", "y", "z", "panLimit", "tiltLimit", "zoomMin", "zoomMax", "dimmerCurve", "base.yaw", "base.pitch", "base.roll"] as const;
type FixtureField = (typeof FIXTURE_FIELDS)[number];
/** The zero-frame fields, and the part of `fixture.base` each one is. */
const BASE_FIELDS = { "base.yaw": "yaw", "base.pitch": "pitch", "base.roll": "roll" } as const satisfies Record<string, keyof Frame>;
const isBaseField = (k: FixtureField): k is keyof typeof BASE_FIELDS => k in BASE_FIELDS;

/** An inspector field's value. */
function getField(fixture: Fixture, k: FixtureField): string | number {
  return isBaseField(k) ? fixture.base[BASE_FIELDS[k]] : fixture[k];
}

function setField(fixture: Fixture, k: FixtureField, raw: string) {
  if (k === "name") {
    fixture.name = raw;
    // The inspector isn't re-synced per keystroke; keep the outline's label up to date.
    const box = inspectorEl.querySelector<HTMLElement>("[data-outline]");
    if (box) box.dataset.name = raw;
    return;
  }
  if (k === "color") { setColorHex(fixture, raw); return; }
  // The curve changes how bright the same dimmer value looks, so re-derive.
  if (k === "dimmerCurve") {
    if (isOneOf(DIMMER_CURVES, raw)) { fixture.dimmerCurve = raw; deriveFromDmx(fixture); }
    return;
  }
  const v = numberFrom(raw);
  if (v == null) return;
  // Ranges change what the same 0–255 values mean, so re-derive afterwards.
  if (k === "panLimit") { fixture.panLimit = clamp(v, 0, 360); deriveFromDmx(fixture); }
  else if (k === "tiltLimit") { fixture.tiltLimit = clamp(v, 0, 180); deriveFromDmx(fixture); }
  else if (k === "zoomMin") { fixture.zoomMin = clamp(v, 1, Math.min(120, fixture.zoomMax)); deriveFromDmx(fixture); }
  else if (k === "zoomMax") { fixture.zoomMax = clamp(v, Math.max(1, fixture.zoomMin), 120); deriveFromDmx(fixture); }
  else if (isBaseField(k)) fixture.base[BASE_FIELDS[k]] = v;
  else if (k === "x" || k === "y" || k === "z") fixture[k] = fromShown(v);
}

/** Put everything under the inspector's heading in one block, which scrolls. */
function wrapInspectorBody() {
  const body = el("div", "inspector-body thin-scroll");
  body.append(...[...inspectorEl.children].filter((el) => el.tagName !== "H2"));
  inspectorEl.append(body);
  applyCollapsed(inspectorEl);
}

function bindInspector() {
  wrapInspectorBody();
  inspectorEl.querySelectorAll<HTMLInputElement>("[data-k]").forEach((el) => {
    const k = el.dataset.k;
    if (!isOneOf(FIXTURE_FIELDS, k)) return;
    el.addEventListener("input", () => {
      const fixture = selectedFixtures()[0];
      if (!fixture) return;
      setField(fixture, k, el.value);
      changed({ inspector: k !== "name" });
    });
    // Left empty: show the value it kept.
    if (el.type === "number") el.addEventListener("blur", () => {
      const fixture = selectedFixtures()[0];
      if (fixture && el.value.trim() === "") el.value = String(round(Number(getField(fixture, k))));
    });
    if (el.type === "range") el.addEventListener("change", () => el.blur());
  });
  inspectorEl.querySelectorAll<HTMLInputElement>("[data-d]").forEach((el) => {
    el.addEventListener("input", () => {
      const fixture = selectedFixtures()[0];
      const v = numberFrom(el.value);
      const a = el.dataset.d;
      if (!fixture || v == null || !isDmxAttr(a)) return;
      setDmx(fixture, a, v);
      changed();
    });
    if (el.type === "range") el.addEventListener("change", () => el.blur());
  });
  inspectorEl.querySelectorAll<HTMLInputElement>("[data-multi]").forEach((el) => {
    el.addEventListener("input", () => {
      if (el.dataset.multi === "color") {
        for (const fixture of selectedFixtures()) setColorHex(fixture, el.value);
        changed();
        return;
      }
      if (el.dataset.multi === "dimmerCurve") {
        const curve = el.value;
        if (!isOneOf(DIMMER_CURVES, curve)) return;
        for (const fixture of selectedFixtures()) { fixture.dimmerCurve = curve; deriveFromDmx(fixture); }
        changed();
        return;
      }
      const v = numberFrom(el.value);
      const a = el.dataset.multi;
      if (v == null || !isDmxAttr(a)) return;
      for (const fixture of selectedFixtures()) setDmx(fixture, a, v);
      changed();
    });
    if (el.type === "range") el.addEventListener("change", () => el.blur());
  });
  inspectorEl.querySelectorAll<HTMLElement>("[data-pt]").forEach((el) => bindPanTiltPad(el, {
    get: () => {
      const fixture = selectedFixtures()[0];
      return fixture ? { pan: fixture.dmx.pan, tilt: fixture.dmx.tilt } : null;
    },
    set: (pan, tilt) => {
      const fixture = selectedFixtures()[0];
      setDmx(fixture, "pan", pan);
      setDmx(fixture, "tilt", tilt);
      changed({ list: false, persist: false });
    },
    done: () => changed(),
  }));
  bindLinkControls();
  inspectorEl.querySelectorAll<HTMLInputElement>("[data-r]").forEach((el) => {
    const k = el.dataset.r;
    if (!isOneOf(TRUSS_FIELDS, k)) return;
    // A new count rebuilds the truss's members, so it applies on Enter / leaving
    // the field / the arrows, not per keystroke (typing 12 would pass through 1).
    el.addEventListener(k === "count" ? "change" : "input", () => {
      const truss = commonTruss(selectedFixtures());
      if (!truss) return;
      const before = truss.count;
      // Lengths are typed in the shown unit; the truss keeps meters.
      const shown = isLength(k) ? numberFrom(el.value) : null;
      setTrussField(truss, k, shown != null ? String(fromShown(shown)) : el.value);
      // A new member count changes the list and possibly the selection.
      if (truss.count !== before) { renderInspector(); changed(); return; }
      // Moving / turning the truss can take members inside or outside the box,
      // so the list (with its "outside" marks) is always refreshed.
      changed({ inspector: k !== "name" });
    });
    // Left empty: show the value it kept.
    if (el.type === "number") el.addEventListener("blur", () => {
      const truss = commonTruss(selectedFixtures());
      if (truss && el.value.trim() === "") el.value = String(round(Number(truss[k])));
    });
    if (el.type === "range") el.addEventListener("change", () => el.blur());
  });
  inspectorEl.querySelectorAll<HTMLElement>("[data-flash]").forEach((el) => {
    el.addEventListener("pointerdown", (e) => { e.preventDefault(); startFlash(); });
    for (const t of ["pointerup", "pointerleave", "pointercancel"]) el.addEventListener(t, stopFlash);
  });
  inspectorEl.querySelectorAll<HTMLElement>("[data-act]").forEach((el) => {
    const name = el.dataset.act;
    if (isOneOf(ACTIONS, name)) el.addEventListener("click", () => { act(name); el.blur(); });
  });
  // B / F on the dimmer: only while held.
  inspectorEl.querySelectorAll<HTMLElement>("[data-hold]").forEach((el) => {
    const kind = el.dataset.hold === "flash" ? "flash" : "blackout";
    let fixture: Fixture | null = null;
    const release = () => {
      if (!fixture) return;
      holdDimmer(kind, fixture, false);
      fixture = null;
      el.classList.remove("on");
    };
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      fixture = selectedFixtures()[0] ?? null;
      if (!fixture) return;
      el.setPointerCapture(e.pointerId);
      el.classList.add("on");
      holdDimmer(kind, fixture, true);
    });
    for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) el.addEventListener(t, release);
  });
}

function syncTrussFields(truss: Truss) {
  inspectorEl.querySelectorAll<HTMLInputElement>("[data-r]").forEach((el) => {
    const k = el.dataset.r;
    if (el === document.activeElement || !isOneOf(TRUSS_FIELDS, k)) return;
    const v = truss[k];
    el.value = typeof v === "number" ? String(isLength(k) ? toShown(v) : round(v)) : v;
  });
}

export function syncInspector() {
  const sel = selectedFixtures();
  const truss = commonTruss(sel);
  if (truss) syncTrussFields(truss);
  syncFollowNote(sel);
  if (sel.length > 1) {
    for (const attr of ["dimmer", "zoom"] as const) {
      const avg = Math.round(sel.reduce((s, i) => s + i.dmx[attr], 0) / sel.length);
      inspectorEl.querySelectorAll<HTMLInputElement>(`[data-multi="${attr}"]`).forEach((el) => { if (el !== document.activeElement) el.value = String(avg); });
    }
    const colorEl = inspectorEl.querySelector<HTMLInputElement>('[data-multi="color"]');
    if (colorEl && colorEl !== document.activeElement) colorEl.value = sel[0].color;
    // The curve they share, or "Mixed".
    const curveEl = inspectorEl.querySelector<HTMLSelectElement>('[data-multi="dimmerCurve"]');
    if (curveEl) curveEl.value = sel.every((f) => f.dimmerCurve === sel[0].dimmerCurve) ? sel[0].dimmerCurve : "";
    return;
  }
  const fixture = sel[0];
  if (!fixture) return;
  inspectorEl.querySelectorAll<HTMLInputElement>("[data-k]").forEach((el) => {
    const k = el.dataset.k;
    if ((el === document.activeElement && el.type !== "range") || !isOneOf(FIXTURE_FIELDS, k)) return;
    const v = getField(fixture, k);
    el.value = typeof v === "number" ? String(isLength(k) ? toShown(v) : round(v)) : v;
  });
  syncDmxRows(fixture);
  inspectorEl.querySelector<HTMLElement>("[data-rgb]")?.style.setProperty("--rgb", fixture.color);
  const readout = inspectorEl.querySelector<HTMLElement>("#readout");
  if (readout) {
    const dir = beamDir(fixture);
    const hits = axisHits(fixture, state.box);
    const fmt = (p: Xyz) => `${fmtNumber(p.x)}, ${fmtNumber(p.y)}, ${fmtNumber(p.z)}`;
    let html = `<div>${isInside(fixture, state.box) ? "Inside" : "<b>Outside</b>"} the box · dir ${round(dir.x)}, ${round(dir.y)}, ${round(dir.z)}</div>`;
    if (!hits.length) html += `<div>Beam axis misses the box</div>`;
    hits.forEach((h, idx) => {
      const label = hits.length > 1 ? (idx === 0 ? "Enters" : "Exits") : "Hits";
      html += `<div>${label} <b>${h.face}</b> at ${fmt(h.point)} · ${fmtLength(h.t)}</div>`;
    });
    readout.innerHTML = html;
  }
}

/** Nudge keys (e.code): the DMX value they change and which way. */
/** A key's nudge: which attribute, and which way. */
export type Nudge = readonly [attr: DmxAttr, dir: 1 | -1];

export const NUDGE_KEYS: Record<string, Nudge> = {
  ArrowLeft: ["pan", 1], ArrowRight: ["pan", -1],
  ArrowUp: ["tilt", 1], ArrowDown: ["tilt", -1],
  Equal: ["dimmer", 1], NumpadAdd: ["dimmer", 1],
  Minus: ["dimmer", -1], NumpadSubtract: ["dimmer", -1],
  BracketLeft: ["zoom", -1], BracketRight: ["zoom", 1],
};

/** Can this nudge still change any of these fixtures (0–255)? */
export const canNudge = (sel: Fixture[], [attr, dir]: Nudge): boolean => sel.some((i) => (dir > 0 ? i.dmx[attr] < 255 : i.dmx[attr] > 0));

/** "255 128 0", plus any other emitter that's on ("W 40 · A 200"). */
function colorReadout(fixture: Fixture) {
  const extras = COLOR_ROLES.filter((a) => a !== "red" && a !== "green" && a !== "blue" && fixture.dmx[a] > 0).map((a) => `${DMX_SHORT[a]} ${fixture.dmx[a]}`);
  return [`${fixture.dmx.red} ${fixture.dmx.green} ${fixture.dmx.blue}`, ...extras].join(" · ");
}

export function renderHud() {
  const sel = selectedFixtures();
  // Keep the keys-bar color picker on the selection's color.
  const kc = document.querySelector<HTMLInputElement>("#keysColor");
  if (kc) {
    kc.disabled = !sel.length;
    if (sel.length && document.activeElement !== kc) kc.value = sel[0].color;
  }
  // Keys-bar nudge buttons go dim at 0 / 255 (or with nothing selected).
  for (const btn of document.querySelectorAll<HTMLButtonElement>(".keys [data-repeat]")) {
    const nudge = NUDGE_KEYS[btn.dataset.code ?? ""];
    if (nudge) btn.disabled = !canNudge(sel, nudge);
  }
  if (!sel.length) { hudEl.hidden = true; return; }
  hudEl.hidden = false;
  const flashRow = sel.some((i) => flashing.has(i.id)) ? `<div class="row flash-on"><span>FLASH</span><span>white · 100%</span></div>` : "";
  if (sel.length > 1) {
    hudEl.innerHTML = `<div class="name">${sel.length} fixtures</div><div class="row"><span>keys act on all</span></div>${flashRow}`;
    return;
  }
  const i = sel[0];
  hudEl.innerHTML = `
    <div class="name"></div>
    <div class="row"><span>dimmer</span><span>${i.dmx.dimmer} · ${Math.round(i.intensity * 100)}%</span></div>
    <div class="row"><span>pan</span><span>${i.dmx.pan} · ${i.pan.toFixed(1)}°</span></div>
    <div class="row"><span>tilt</span><span>${i.dmx.tilt} · ${i.tilt.toFixed(1)}°</span></div>
    <div class="row"><span>zoom</span><span>${i.dmx.zoom} · ${i.beam}°</span></div>
    <div class="row"><span>color</span><span><span class="swatch hud-swatch" style="background:${i.color}"></span>${colorReadout(i)}</span></div>
    ${flashRow}`;
  const nameEl = hudEl.querySelector(".name");
  if (nameEl) nameEl.textContent = i.name;
}

// A new length unit (View settings): show everything in it.
onUnitChange(() => {
  renderInspector();
  renderList();
});

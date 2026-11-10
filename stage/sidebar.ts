// Sidebar: the fixture list, the inspector and the key strip (HUD).
import {
  MAX_FIXTURES,
  round,
  beamDir,
  isInside,
  axisHits,
  RIG_TYPES,
  setDmx,
  setColorHex,
  deriveFromDmx,
  type Fixture,
  type Frame,
  type Rig,
} from "./stage-model.ts";
import { clamp, numberFrom } from "../shared/numbers.ts";
import { applyCollapsed } from "./panel.ts";
import { DMX_LABELS, DMX_SHORT, isDmxAttr, type DmxAttr } from "../shared/attributes.ts";
import { escapeHtml, el } from "../shared/html.ts";
import { bindPanTiltPad } from "../shared/pan-tilt-pad.ts";
import { COLOR_ROLES, emitterHex, isColorRole } from "../shared/color.ts";
import { state, selectedFixtures, rigOf, commonRig, setRigField, RIG_FIELDS } from "./state.ts";
import { isOneOf } from "../shared/guards.ts";
import {
  flashing,
  startFlash,
  stopFlash,
  changed,
  select,
  selectRigOf,
  holdDimmer,
  openContextMenu,
  act,
  ACTIONS,
} from "./actions.ts";
import { linkSectionHtml, rigLinkHtml, bindLinkControls, syncDmxRows, inspectorAttrs } from "./link.ts";
import { showTrace } from "./stage.ts";
import type { Vector3 } from "three";
import { elById } from "../shared/query.ts";

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

export function renderList() {
  elById("count").textContent = `${state.fixtures.length} / ${MAX_FIXTURES}`;
  if (!state.fixtures.length) {
    listEl.innerHTML = `<div class="empty">None yet — press <kbd>P</kbd> or “+ Place fixture”.</div>`;
    return;
  }
  // The list scrolls on its own; rebuilding it would jump back to the top.
  const scrollTop = listEl.scrollTop;
  listEl.innerHTML = "";
  for (const fixture of state.fixtures) {
    const row = el("div", "item" + (state.selected.includes(fixture.id) ? " sel" : ""));
    row.innerHTML = `
      <span class="swatch" style="background:${fixture.color}"></span>
      <span></span>
      <div class="bar"><div style="width:${Math.round(fixture.intensity * 100)}%"></div></div>
      <span class="pct" title="Dimmer (0–255)">${fixture.dmx.dimmer}</span>`;
    row.children[1].textContent = fixture.name + (isInside(fixture, state.box) ? "" : "  ·  outside");
    row.addEventListener("click", (e) => {
      if (e.altKey) showTrace({ kind: "stageFixture", id: fixture.id }, e);
      // A double-click on a rig's fixture selects the whole rig. (Not "dblclick": the first click rebuilds the rows.)
      else if (!(e.detail === 2 && selectRigOf(fixture.id))) select(fixture.id, e.shiftKey);
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

/** Inspector block for editing a rig (shown when the selection is all one rig). */
function rigSectionHtml(rig: Rig) {
  return `
    <div class="fields rig-fields">
      <div class="subhead">Rig · ${RIG_TYPES[rig.type].name}</div>
      <label>Rig name</label><input type="text" data-r="name" />
      <label>Center</label>
      <div class="xyz">
        <input type="number" step="0.1" data-r="x" title="x (− SR · + SL)" />
        <input type="number" step="0.1" data-r="y" title="height" />
        <input type="number" step="0.1" data-r="z" title="z (− upstage · + audience)" />
      </div>
      <label>${RIG_TYPES[rig.type].sizeLabel} m</label><input type="number" min="0.5" max="50" step="0.1" data-r="size" />
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
export function renderInspector() {
  const sel = selectedFixtures();
  if (!sel.length) {
    inspectorEl.innerHTML = `${inspectorHeading()}<div class="empty">Select a fixture.</div>`;
    wrapInspectorBody();
    return;
  }
  if (sel.length > 1) {
    const selRig = commonRig(sel);
    inspectorEl.innerHTML = `
      ${inspectorHeading(`<span>${sel.length} selected</span>`)}
      <div class="fields">
        <label>Dimmer</label>
        <div class="slider"><input type="range" min="0" max="255" step="1" data-multi="dimmer" /><input type="number" min="0" max="255" data-multi="dimmer" /></div>
        <label>Zoom</label>
        <div class="slider"><input type="range" min="0" max="255" step="1" data-multi="zoom" title="Beam angle (each fixture's own zoom range)" /><input type="number" min="0" max="255" data-multi="zoom" /></div>
        <label>Color</label>
        <input type="color" data-multi="color" />
      </div>
      <p class="hint">Sets every selected fixture. Arrow keys, +/− and [ ] step each one's own 0–255 values (⇧ = 10).</p>
      ${selRig ? rigSectionHtml(selRig) + rigLinkHtml() : ""}
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
  const rig = rigOf(sel[0]);
  const lock = rig ? 'disabled title="Set by the rig"' : "";
  inspectorEl.innerHTML = `
    ${inspectorHeading(rig ? `<span>in ${escapeHtml(rig.name)}</span>` : "")}
    <div class="fields">
      <label>Name</label><input type="text" data-k="name" />
      <label>Position</label>
      <div class="xyz">
        <input type="number" step="0.1" data-k="x" title="x (− SR · + SL)" ${lock} />
        <input type="number" step="0.1" data-k="y" title="height" ${lock} />
        <input type="number" step="0.1" data-k="z" title="z (− upstage · + audience)" ${lock} />
      </div>
      <label></label><div class="hint" style="margin:0">x · height · z (m)${rig ? " · set by the rig (drag to move the whole rig)" : ""}</div>

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
    ${rig ? rigSectionHtml(rig) + rigLinkHtml() : ""}
    <div class="buttons">
      <button data-flash class="flash" title="Hold to flash white at full intensity (F)">Flash</button>
      <button data-act="aimSpot" title="Point the beam at a spot you click (A)">Aim at spot</button>
      <button data-act="home" title="Pan/tilt back to 0 (H)">Home</button>
      ${rig ? `<button data-act="selectRig" title="Select every fixture in this rig">Select whole rig</button>` : `
      <button data-act="zero" title="Make the current direction the new zero (Z)">Set zero here</button>
      <button data-act="aim" title="Point zero at the stage center">Aim zero at stage</button>`}
      <button data-act="dup" title="${rig ? "Copy as a free fixture (not part of the rig)" : "Copy"}">Duplicate</button>
      <button data-act="del" class="danger" title="${rig ? "Delete the whole rig" : "Delete"} (⌫ or right-click) · ⌘Z to undo">${rig ? "Delete rig" : "Delete"}</button>
    </div>`;
  bindInspector();
  syncInspector();
}

/** The fixture fields the inspector edits (its inputs' `data-k`). */
const FIXTURE_FIELDS = ["name", "color", "x", "y", "z", "panLimit", "tiltLimit", "zoomMin", "zoomMax", "base.yaw", "base.pitch", "base.roll"] as const;
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
  const v = numberFrom(raw);
  if (v == null) return;
  // Ranges change what the same 0–255 values mean, so re-derive afterwards.
  if (k === "panLimit") { fixture.panLimit = clamp(v, 0, 360); deriveFromDmx(fixture); }
  else if (k === "tiltLimit") { fixture.tiltLimit = clamp(v, 0, 180); deriveFromDmx(fixture); }
  else if (k === "zoomMin") { fixture.zoomMin = clamp(v, 1, Math.min(120, fixture.zoomMax)); deriveFromDmx(fixture); }
  else if (k === "zoomMax") { fixture.zoomMax = clamp(v, Math.max(1, fixture.zoomMin), 120); deriveFromDmx(fixture); }
  else if (isBaseField(k)) fixture.base[BASE_FIELDS[k]] = v;
  else if (k === "x" || k === "y" || k === "z") fixture[k] = v;
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
    if (!isOneOf(RIG_FIELDS, k)) return;
    // A new count rebuilds the rig's members, so it applies on Enter / leaving
    // the field / the arrows, not per keystroke (typing 12 would pass through 1).
    el.addEventListener(k === "count" ? "change" : "input", () => {
      const rig = commonRig(selectedFixtures());
      if (!rig) return;
      const before = rig.count;
      setRigField(rig, k, el.value);
      // A new member count changes the list and possibly the selection.
      if (rig.count !== before) { renderInspector(); changed(); return; }
      // Moving / turning the rig can take members inside or outside the box,
      // so the list (with its "outside" marks) is always refreshed.
      changed({ inspector: k !== "name" });
    });
    // Left empty: show the value it kept.
    if (el.type === "number") el.addEventListener("blur", () => {
      const rig = commonRig(selectedFixtures());
      if (rig && el.value.trim() === "") el.value = String(round(Number(rig[k])));
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

function syncRigFields(rig: Rig) {
  inspectorEl.querySelectorAll<HTMLInputElement>("[data-r]").forEach((el) => {
    const k = el.dataset.r;
    if (el === document.activeElement || !isOneOf(RIG_FIELDS, k)) return;
    const v = rig[k];
    el.value = typeof v === "number" ? String(round(v)) : v;
  });
}

export function syncInspector() {
  const sel = selectedFixtures();
  const rig = commonRig(sel);
  if (rig) syncRigFields(rig);
  if (sel.length > 1) {
    for (const attr of ["dimmer", "zoom"] as const) {
      const avg = Math.round(sel.reduce((s, i) => s + i.dmx[attr], 0) / sel.length);
      inspectorEl.querySelectorAll<HTMLInputElement>(`[data-multi="${attr}"]`).forEach((el) => { if (el !== document.activeElement) el.value = String(avg); });
    }
    const colorEl = inspectorEl.querySelector<HTMLInputElement>('[data-multi="color"]');
    if (colorEl && colorEl !== document.activeElement) colorEl.value = sel[0].color;
    return;
  }
  const fixture = sel[0];
  if (!fixture) return;
  inspectorEl.querySelectorAll<HTMLInputElement>("[data-k]").forEach((el) => {
    const k = el.dataset.k;
    if ((el === document.activeElement && el.type !== "range") || !isOneOf(FIXTURE_FIELDS, k)) return;
    const v = getField(fixture, k);
    el.value = typeof v === "number" ? String(round(v)) : v;
  });
  syncDmxRows(fixture);
  inspectorEl.querySelector<HTMLElement>("[data-rgb]")?.style.setProperty("--rgb", fixture.color);
  const readout = inspectorEl.querySelector<HTMLElement>("#readout");
  if (readout) {
    const dir = beamDir(fixture);
    const hits = axisHits(fixture, state.box);
    const fmt = (p: Vector3) => `${round(p.x, 1)}, ${round(p.y, 1)}, ${round(p.z, 1)}`;
    let html = `<div>${isInside(fixture, state.box) ? "Inside" : "<b>Outside</b>"} the box · dir ${round(dir.x)}, ${round(dir.y)}, ${round(dir.z)}</div>`;
    if (!hits.length) html += `<div>Beam axis misses the box</div>`;
    hits.forEach((h, idx) => {
      const label = hits.length > 1 ? (idx === 0 ? "Enters" : "Exits") : "Hits";
      html += `<div>${label} <b>${h.face}</b> at ${fmt(h.point)} · ${round(h.t, 1)} m</div>`;
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

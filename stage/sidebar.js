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
} from "./stage-model.js";
import { clamp } from "../shared/numbers.js";
import { DMX_ATTRS, DMX_LABELS } from "../shared/attributes.js";
import { escapeHtml } from "../shared/html.js";
import { state, selectedFixtures, rigOf, commonRig, setRigField } from "./state.js";
import {
  flashing,
  startFlash,
  stopFlash,
  changed,
  select,
  openContextMenu,
  act,
} from "./actions.js";
import { linkSectionHtml, rigLinkHtml, bindLinkControls, syncDmxRows } from "./link.js";
import { showTrace } from "./stage.js";

// ---------------------------------------------------------------------
// Sidebar: list + inspector
// ---------------------------------------------------------------------

const listEl = document.getElementById("list");
export const inspectorEl = document.getElementById("inspector");
const hudEl = document.getElementById("hud");

export function renderList() {
  document.getElementById("count").textContent = `${state.fixtures.length} / ${MAX_FIXTURES}`;
  if (!state.fixtures.length) {
    listEl.innerHTML = `<div class="empty">None yet — press <kbd>A</kbd> or “+ Place fixture”.</div>`;
    return;
  }
  listEl.innerHTML = "";
  for (const fixture of state.fixtures) {
    const row = document.createElement("div");
    row.className = "item" + (state.selected.includes(fixture.id) ? " sel" : "");
    row.innerHTML = `
      <span class="swatch" style="background:${fixture.color}"></span>
      <span></span>
      <div class="bar"><div style="width:${Math.round(fixture.intensity * 100)}%"></div></div>
      <span class="pct" title="Dimmer (0–255)">${fixture.dmx.dimmer}</span>`;
    row.children[1].textContent = fixture.name + (isInside(fixture, state.box) ? "" : "  ·  outside");
    row.addEventListener("click", (e) => (e.altKey ? showTrace({ kind: "stageFixture", id: fixture.id }, e) : select(fixture.id, e.shiftKey)));
    row.addEventListener("contextmenu", (e) => { e.preventDefault(); openContextMenu(fixture.id, e.clientX, e.clientY); });
    listEl.append(row);
  }
}

/** Inspector block for editing a rig (shown when the selection is all one rig). */
function rigSectionHtml(rig) {
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

/** Rebuild the inspector for the current selection (none, one, or several). */
export function renderInspector() {
  const sel = selectedFixtures();
  if (!sel.length) {
    inspectorEl.innerHTML = `<h2>Inspector</h2><div class="empty">Select a fixture.</div>`;
    return;
  }
  if (sel.length > 1) {
    inspectorEl.innerHTML = `
      <h2>Inspector <span>${sel.length} selected</span></h2>
      <div class="fields">
        <label>Dimmer</label>
        <div class="slider"><input type="range" min="0" max="255" step="1" data-multi="dimmer" /><input type="number" min="0" max="255" data-multi="dimmer" /></div>
        <label>Zoom</label>
        <div class="slider"><input type="range" min="0" max="255" step="1" data-multi="zoom" title="Beam angle (each fixture's own zoom range)" /><input type="number" min="0" max="255" data-multi="zoom" /></div>
        <label>Color</label>
        <input type="color" data-multi="color" />
      </div>
      <p class="hint">Sets every selected fixture. Arrow keys, +/− and [ ] step each one's own 0–255 values (⇧ = 10).</p>
      ${commonRig(sel) ? rigSectionHtml(commonRig(sel)) + rigLinkHtml() : ""}
      <div class="buttons">
        <button data-flash class="flash" title="Hold to flash white at full intensity (F)">Flash</button>
        <button data-act="aimSpot" title="Point all selected beams at one spot (T)">Aim at spot</button>
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
    <h2>Inspector${rig ? ` <span>in ${escapeHtml(rig.name)}</span>` : ""}</h2>
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
      ${DMX_ATTRS.map((a) => `
      <label>${DMX_LABELS[a]}</label>
      <div class="dmx-row">
        <input type="range" min="0" max="255" step="1" data-d="${a}" />
        <input type="number" min="0" max="255" step="1" data-d="${a}" />
        <span class="dmx-note" data-note="${a}"></span>
      </div>`).join("")}
      <label>Color</label>
      <input type="color" data-k="color" title="Sets red / green / blue" />

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
      <button data-act="aimSpot" title="Point the beam at a spot you click (T)">Aim at spot</button>
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

function getField(fixture, k) {
  if (k.startsWith("base.")) return fixture.base[k.slice(5)];
  return fixture[k];
}

function setField(fixture, k, raw) {
  if (k === "name") { fixture.name = raw; return; }
  if (k === "color") { setColorHex(fixture, raw); return; }
  const v = Number(raw);
  if (!Number.isFinite(v)) return;
  // Ranges change what the same 0–255 values mean, so re-derive afterwards.
  if (k === "panLimit") { fixture.panLimit = clamp(v, 0, 360); deriveFromDmx(fixture); }
  else if (k === "tiltLimit") { fixture.tiltLimit = clamp(v, 0, 180); deriveFromDmx(fixture); }
  else if (k === "zoomMin") { fixture.zoomMin = clamp(v, 1, Math.min(120, fixture.zoomMax)); deriveFromDmx(fixture); }
  else if (k === "zoomMax") { fixture.zoomMax = clamp(v, Math.max(1, fixture.zoomMin), 120); deriveFromDmx(fixture); }
  else if (k.startsWith("base.")) fixture.base[k.slice(5)] = v;
  else if (k === "x" || k === "y" || k === "z") fixture[k] = v;
}

function bindInspector() {
  inspectorEl.querySelectorAll("[data-k]").forEach((el) => {
    el.addEventListener("input", () => {
      const fixture = selectedFixtures()[0];
      if (!fixture) return;
      setField(fixture, el.dataset.k, el.value);
      changed({ inspector: el.dataset.k !== "name" });
    });
    if (el.type === "range") el.addEventListener("change", () => el.blur());
  });
  inspectorEl.querySelectorAll("[data-d]").forEach((el) => {
    el.addEventListener("input", () => {
      const fixture = selectedFixtures()[0];
      const v = Number(el.value);
      if (!fixture || el.value === "" || !Number.isFinite(v)) return;
      setDmx(fixture, el.dataset.d, v);
      changed();
    });
    if (el.type === "range") el.addEventListener("change", () => el.blur());
  });
  inspectorEl.querySelectorAll("[data-multi]").forEach((el) => {
    el.addEventListener("input", () => {
      if (el.dataset.multi === "color") {
        for (const fixture of selectedFixtures()) setColorHex(fixture, el.value);
        changed();
        return;
      }
      const v = Number(el.value);
      if (el.value === "" || !Number.isFinite(v)) return;
      for (const fixture of selectedFixtures()) setDmx(fixture, el.dataset.multi, v);
      changed();
    });
    if (el.type === "range") el.addEventListener("change", () => el.blur());
  });
  bindLinkControls();
  inspectorEl.querySelectorAll("[data-r]").forEach((el) => {
    el.addEventListener("input", () => {
      const rig = commonRig(selectedFixtures());
      if (!rig) return;
      const before = rig.count;
      setRigField(rig, el.dataset.r, el.value);
      // A new member count changes the list and possibly the selection.
      if (rig.count !== before) { renderInspector(); changed(); return; }
      // Moving / turning the rig can take members inside or outside the box,
      // so the list (with its "outside" marks) is always refreshed.
      changed({ inspector: el.dataset.r !== "name" });
    });
    if (el.type === "range") el.addEventListener("change", () => el.blur());
  });
  inspectorEl.querySelectorAll("[data-flash]").forEach((el) => {
    el.addEventListener("pointerdown", (e) => { e.preventDefault(); startFlash(); });
    for (const t of ["pointerup", "pointerleave", "pointercancel"]) el.addEventListener(t, stopFlash);
  });
  inspectorEl.querySelectorAll("[data-act]").forEach((el) => {
    el.addEventListener("click", () => { act(el.dataset.act); el.blur(); });
  });
}

function syncRigFields(rig) {
  inspectorEl.querySelectorAll("[data-r]").forEach((el) => {
    if (el === document.activeElement) return;
    const v = rig[el.dataset.r];
    el.value = typeof v === "number" ? String(round(v)) : v;
  });
}

export function syncInspector() {
  const sel = selectedFixtures();
  const rig = commonRig(sel);
  if (rig) syncRigFields(rig);
  if (sel.length > 1) {
    for (const attr of ["dimmer", "zoom"]) {
      const avg = Math.round(sel.reduce((s, i) => s + i.dmx[attr], 0) / sel.length);
      inspectorEl.querySelectorAll(`[data-multi="${attr}"]`).forEach((el) => { if (el !== document.activeElement) el.value = String(avg); });
    }
    const colorEl = inspectorEl.querySelector('[data-multi="color"]');
    if (colorEl && colorEl !== document.activeElement) colorEl.value = sel[0].color;
    return;
  }
  const fixture = sel[0];
  if (!fixture) return;
  inspectorEl.querySelectorAll("[data-k]").forEach((el) => {
    const k = el.dataset.k;
    if (el === document.activeElement && el.type !== "range") return;
    const v = getField(fixture, k);
    el.value = typeof v === "number" ? String(round(v)) : v;
  });
  syncDmxRows(fixture);
  const readout = inspectorEl.querySelector("#readout");
  if (readout) {
    const dir = beamDir(fixture);
    const hits = axisHits(fixture, state.box);
    const fmt = (p) => `${round(p.x, 1)}, ${round(p.y, 1)}, ${round(p.z, 1)}`;
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
export const NUDGE_KEYS = {
  ArrowLeft: ["pan", 1], ArrowRight: ["pan", -1],
  ArrowUp: ["tilt", 1], ArrowDown: ["tilt", -1],
  Equal: ["dimmer", 1], NumpadAdd: ["dimmer", 1],
  Minus: ["dimmer", -1], NumpadSubtract: ["dimmer", -1],
  BracketLeft: ["zoom", -1], BracketRight: ["zoom", 1],
};

/** Can this nudge still change any of these fixtures (0–255)? */
export const canNudge = (sel, [attr, dir]) => sel.some((i) => (dir > 0 ? i.dmx[attr] < 255 : i.dmx[attr] > 0));

export function renderHud() {
  const sel = selectedFixtures();
  // Keep the keys-bar color picker on the selection's color.
  const kc = document.getElementById("keysColor");
  if (kc) {
    kc.disabled = !sel.length;
    if (sel.length && document.activeElement !== kc) kc.value = sel[0].color;
  }
  // Keys-bar nudge buttons go dim at 0 / 255 (or with nothing selected).
  for (const btn of document.querySelectorAll(".keys [data-repeat]")) {
    const nudge = NUDGE_KEYS[btn.dataset.code];
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
    <div class="row"><span>color</span><span><span class="swatch hud-swatch" style="background:${i.color}"></span>${i.dmx.red} ${i.dmx.green} ${i.dmx.blue}</span></div>
    ${flashRow}`;
  hudEl.querySelector(".name").textContent = i.name;
}

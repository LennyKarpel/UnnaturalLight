// Actions on the stage: selecting, placing and aiming, flash, the
// right-click menu, duplicate, delete and undo.
import {
  STORAGE_KEY,
  MAX_FIXTURES,
  round,
  defaultTarget,
  aimZeroAt,
  setZeroHere,
  aimAt,
  createFixture,
  parseStage,
  serializeStage,
  homeFixture,
  applyFixture,
} from "./stage-model.js";
import { newId } from "../shared/ids.js";
import {
  state,
  save,
  byId,
  selectedFixtures,
  rigById,
  rigOf,
  rigMembers,
  syncRig,
  ui,
} from "./state.js";
import { view, syncScene, updateGhost, showAimPreview } from "./view3d.js";
import { drawPlan } from "./plan.js";
import { inspectorEl, renderList, renderInspector, syncInspector, renderHud } from "./sidebar.js";
import { placeType, placeFixture, placeUniverse } from "./dialogs.js";
import { consoleLink, pushToConsole, requestRegistrations } from "./link.js";
import { trace, publishStage } from "./stage.js";

// Flash: while held, the flashed fixtures draw white at full intensity.
// Display-only: their saved color / intensity are untouched.
const FLASH_MIN_MS = 150;
export const flashing = new Set();
let flashStart = 0;
let flashTimer = 0;

/** What a fixture looks like right now (its own settings, or white/full while flashing). */
export const look = (fixture) => (flashing.has(fixture.id) ? { color: "#ffffff", intensity: 1 } : fixture);

function redrawLook() {
  syncScene();
  drawPlan();
  renderHud();
}

/** Flash the selected fixtures, or every fixture if none is selected. */
export function startFlash() {
  clearTimeout(flashTimer);
  const ids = state.selected.length ? state.selected : state.fixtures.map((i) => i.id);
  flashing.clear();
  for (const id of ids) flashing.add(id);
  flashStart = performance.now();
  redrawLook();
}

/** Release; a quick tap still shows for at least FLASH_MIN_MS. */
export function stopFlash() {
  if (!flashing.size) return;
  const wait = Math.max(0, FLASH_MIN_MS - (performance.now() - flashStart));
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flashing.clear(); redrawLook(); }, wait);
}

// ---------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------

/** Console fixtures last told to the console as selected. */
let lastSelectionKey = "";

export function changed({ list = true, inspector = true, persist = true } = {}) {
  pushToConsole();
  publishStage();
  // A new selection: have the console scroll to the selected fixtures' faders
  // and highlight them until the selection changes (none = clear it). Keyed on
  // the console fixtures, so a light that links up while selected is sent too.
  const ids = [...new Set(selectedFixtures().map((i) => i.link.consoleId).filter(Boolean))];
  const selectionKey = ids.join(",");
  if (selectionKey !== lastSelectionKey) {
    lastSelectionKey = selectionKey;
    consoleLink.publishSelection(ids);
  }
  trace?.refresh();
  syncScene();
  drawPlan();
  if (list) renderList();
  if (inspector) syncInspector();
  renderHud();
  if (persist) save();
}

export function select(id, additive = false) {
  if (!id) state.selected = [];
  else if (additive) {
    state.selected = state.selected.includes(id) ? state.selected.filter((s) => s !== id) : [...state.selected, id];
  } else state.selected = [id];
  renderInspector();
  changed({ inspector: false });
}

const bannerEl = document.getElementById("banner");
const PLACE_HINT = bannerEl.textContent;
const RIG_PLACE_HINT = "Click where the rig's centre goes: a surface or the ground in 3D, or the plan · Esc cancels";
const AIM_HINT = "Click a spot on the floor, a wall or the ceiling (or in the plan) to aim the selected fixtures at it · Esc cancels";
let bannerTimer = 0;

/** Show a banner message (null hides it); `ms` auto-hides it. */
export function setBanner(text, ms = 0) {
  clearTimeout(bannerTimer);
  bannerEl.textContent = text ?? "";
  bannerEl.hidden = !text;
  if (ms) bannerTimer = setTimeout(() => setBanner(null), ms);
}

export function setPlacing(on, rigCfg = null) {
  if (on && ui.aiming) setAiming(false);
  ui.placing = on;
  ui.placingRig = on ? rigCfg : null;
  view.classList.toggle("placing", on);
  setBanner(on ? (rigCfg ? RIG_PLACE_HINT : PLACE_HINT) : null);
  document.getElementById("addBtn").classList.toggle("active", on && !rigCfg);
  document.getElementById("rigBtn").classList.toggle("active", on && !!rigCfg);
  if (!on) updateGhost(null);
  drawPlan();
}

export function setAiming(on) {
  if (on && !selectedFixtures().length) {
    setBanner("Select one or more fixtures first, then Aim at spot (T)", 2500);
    return;
  }
  if (on && ui.placing) setPlacing(false);
  ui.aiming = on;
  view.classList.toggle("placing", on);
  setBanner(on ? AIM_HINT : null);
  inspectorEl.querySelectorAll('[data-act="aimSpot"]').forEach((b) => b.classList.toggle("active", on));
  if (!on) showAimPreview(null);
  drawPlan();
}

/** Point every selected fixture's beam at `p` (world, metres). */
export function applyAim(p) {
  const sel = selectedFixtures();
  const missed = sel.filter((fixture) => !aimAt(fixture, p));
  setAiming(false);
  changed();
  if (missed.length) {
    const names = missed.map((i) => i.name).join(", ");
    setBanner(`Out of pan/tilt range, aimed as close as possible: ${names}`, 4000);
  }
}

export function addFixtureAt(x, y, z) {
  if (state.fixtures.length >= MAX_FIXTURES) { setPlacing(false); return; }
  const fixture = createFixture(x, y, z, state.fixtures.length, state.box);
  fixture.link.register = placeType;
  fixture.link.universe = placeUniverse;
  if (placeFixture) {
    applyFixture(fixture, placeFixture);
    const same = state.fixtures.filter((i) => i.link.fixture?.model === placeFixture.model).length;
    fixture.name = `${placeFixture.model} ${same + 1}`;
  }
  state.fixtures.push(fixture);
  setPlacing(false);
  select(fixture.id);
  requestRegistrations();
}

// ---------------------------------------------------------------------
// Right-click menu (fixtures in 3D, plan and list)
// ---------------------------------------------------------------------

export const ctxMenu = document.getElementById("ctxMenu");

/**
 * Open the menu for fixture `id` at a screen point. Right-clicking an
 * fixture that's part of the selection acts on the whole selection;
 * otherwise it selects just that fixture first.
 */
export function openContextMenu(id, x, y) {
  if (!state.selected.includes(id)) select(id);
  const n = state.selected.length;
  const rig = rigOf(byId(id));
  const title = n === 1 ? byId(id)?.name ?? "" : `${n} fixtures`;
  const count = n > 1 ? ` ${n}` : "";
  const delCount = deletionIds().size;
  const delLabel = rig ? `Delete rig${delCount > 1 ? ` (${delCount})` : ""}` : `Delete${count}`;
  const item = (cmd, label, key = "", cls = "") =>
    `<button type="button" data-cmd="${cmd}" class="menu-item ${cls}"><span>${label}</span><kbd>${key}</kbd></button>`;
  ctxMenu.innerHTML = `<div class="menu-title"></div>
    ${item("aimSpot", "Aim at spot…", "T")}
    ${item("home", "Home", "H")}
    ${rig ? item("selectRig", "Select whole rig") : `${item("zero", "Set zero here", "Z")}${item("aim", "Aim zero at stage")}`}
    ${item("flash", "Flash (hold)", "F")}
    <hr />
    ${item("dup", `Duplicate${count}`)}
    ${item("del", delLabel, "⌫", "danger")}`;
  ctxMenu.querySelectorAll("kbd:empty").forEach((k) => k.remove());
  ctxMenu.querySelector(".menu-title").textContent = title;
  ctxMenu.hidden = false;
  const r = ctxMenu.getBoundingClientRect();
  ctxMenu.style.left = `${Math.min(x, window.innerWidth - r.width - 8)}px`;
  ctxMenu.style.top = `${Math.min(y, window.innerHeight - r.height - 8)}px`;
  ctxMenu.querySelector("button").focus();
}

export function closeContextMenu() {
  ctxMenu.hidden = true;
}

const menuCmd = (e) => (e.target instanceof Element ? e.target.closest("[data-cmd]")?.dataset.cmd : null);

ctxMenu.addEventListener("click", (e) => {
  const cmd = menuCmd(e);
  if (!cmd || cmd === "flash") return;
  closeContextMenu();
  act(cmd); // aimSpot, home, zero, aim, dup, del — same as the inspector buttons
});
// Flash lasts while the menu item is held down.
ctxMenu.addEventListener("pointerdown", (e) => { if (menuCmd(e) === "flash") { e.preventDefault(); startFlash(); } });
ctxMenu.addEventListener("pointerup", (e) => { if (menuCmd(e) === "flash") { stopFlash(); closeContextMenu(); } });
ctxMenu.addEventListener("pointerleave", stopFlash);
// Any press outside the menu, or the window losing focus / resizing, closes it.
window.addEventListener("pointerdown", (e) => { if (!ctxMenu.hidden && !ctxMenu.contains(e.target)) closeContextMenu(); }, true);
window.addEventListener("blur", closeContextMenu);
window.addEventListener("resize", closeContextMenu);

/**
 * Copy every selected fixture (all settings, 0.5 m to stage left) and
 * select the copies. Stops at the fixture limit.
 */
function duplicateSelected() {
  const wanted = selectedFixtures();
  const room = MAX_FIXTURES - state.fixtures.length;
  const src = wanted.slice(0, Math.max(0, room));
  if (!src.length) {
    if (wanted.length) setBanner(`Fixture limit reached (${MAX_FIXTURES})`, 2500);
    return;
  }
  // Copies are free fixtures, even when copied from a rig.
  const copies = src.map((fixture) => ({
    ...structuredClone(fixture), id: newId("fixture"), name: `${fixture.name} copy`, x: round(fixture.x + 0.5),
    rigId: null, rigIndex: 0,
    // Copies get their own console fixture if the original came from the stage.
    link: { consoleId: null, start: null, layout: [], owned: false, type: null, register: fixture.link.owned ? fixture.link.type : fixture.link.register, fixture: fixture.link.fixture ?? null, universe: fixture.link.universe ?? null },
  }));
  state.fixtures.push(...copies);
  state.selected = copies.map((c) => c.id);
  renderInspector();
  changed();
  requestRegistrations();
  if (src.length < wanted.length) setBanner(`Fixture limit reached (${MAX_FIXTURES}): copied ${src.length} of ${wanted.length}`, 3000);
}

/**
 * Deleted fixtures (and rigs), newest last, so ⌘Z can put them back. Kept
 * with the saved stage, so ⌘Z in any stage window undoes the last delete
 * made in any of them (in memory only if storage is unavailable).
 * Each entry: { indexes, data } (data = the removed lights as a stage file).
 */
const UNDO_KEY = `${STORAGE_KEY}.undo`;
const MAX_UNDO = 50;
let undoMemory = [];

function readUndo() {
  try {
    const list = JSON.parse(localStorage.getItem(UNDO_KEY) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return undoMemory;
  }
}

function writeUndo(list) {
  undoMemory = list.slice(-MAX_UNDO);
  try { localStorage.setItem(UNDO_KEY, JSON.stringify(undoMemory)); } catch { /* storage unavailable */ }
}

/** What a delete removes: the selection, widened to whole rigs. */
function deletionIds() {
  const ids = new Set(state.selected);
  for (const fixture of selectedFixtures()) {
    const rig = rigOf(fixture);
    if (rig) rigMembers(rig).forEach((m) => ids.add(m.id));
  }
  return ids;
}

export function deleteSelected() {
  const ids = deletionIds();
  const removed = [];
  state.fixtures.forEach((fixture, index) => { if (ids.has(fixture.id)) removed.push({ fixture, index }); });
  if (!removed.length) return;
  const rigIds = new Set(removed.map((r) => r.fixture.rigId).filter(Boolean));
  const rigs = state.rigs.filter((r) => rigIds.has(r.id));
  writeUndo([...readUndo(), {
    indexes: removed.map((r) => r.index),
    data: serializeStage(state.box, removed.map((r) => r.fixture), state.transparent, rigs),
  }]);
  state.fixtures = state.fixtures.filter((i) => !ids.has(i.id));
  state.rigs = state.rigs.filter((r) => !rigIds.has(r.id));
  // Lights the stage registered leave the console too (their faders are freed).
  consoleLink.unregister(removed.filter((r) => r.fixture.link.owned).map((r) => r.fixture.link.consoleId));
  select(null);
  const what = rigs.length === 1 && removed.every((r) => r.fixture.rigId === rigs[0].id)
    ? rigs[0].name
    : removed.length === 1 ? removed[0].fixture.name : `${removed.length} fixtures`;
  setBanner(`Deleted ${what} · ⌘Z to undo`, 4000);
}

export function undoDelete() {
  const list = readUndo();
  const entry = list.pop();
  if (!entry) return;
  const { fixtures, rigs } = parseStage(entry.data);
  // Skip any that are already back (e.g. undone in another window just now).
  const removed = fixtures
    .map((fixture, k) => ({ fixture, index: entry.indexes?.[k] ?? state.fixtures.length }))
    .filter(({ fixture }) => !byId(fixture.id));
  if (state.fixtures.length + removed.length > MAX_FIXTURES) {
    setBanner(`Can't undo: it would go over ${MAX_FIXTURES} fixtures`, 3000);
    return;
  }
  writeUndo(list);
  if (!removed.length) return;
  state.rigs.push(...rigs.filter((r) => !rigById(r.id)));
  // Re-insert in original order so each lands back at its old index.
  for (const { fixture, index } of removed) state.fixtures.splice(Math.min(index, state.fixtures.length), 0, fixture);
  rigs.forEach(syncRig);
  // Their console fixtures were removed on delete: register them again.
  for (const { fixture } of removed) {
    if (!fixture.link.owned) continue;
    fixture.link = { consoleId: null, start: null, layout: [], owned: false, type: null, register: fixture.link.type, fixture: fixture.link.fixture ?? null, universe: fixture.link.universe ?? null };
  }
  requestRegistrations();
  state.selected = removed.map((r) => r.fixture.id).filter((id) => byId(id));
  renderInspector();
  changed();
  const what = rigs.length === 1 ? rigs[0].name : removed.length === 1 ? removed[0].fixture.name : `${removed.length} fixtures`;
  setBanner(`Restored ${what}`, 2000);
}

export function act(name) {
  const sel = selectedFixtures();
  if (name === "home") sel.forEach(homeFixture);
  // A rig member's zero is set by its rig, so these skip rig members.
  const free = sel.filter((i) => !i.rigId);
  if (name === "zero") free.forEach(setZeroHere);
  if (name === "aimSpot") { setAiming(!ui.aiming); return; }
  if (name === "aim") free.forEach((i) => aimZeroAt(i, defaultTarget(i, state.box)));
  if (name === "selectRig") {
    const rig = rigOf(sel[0]);
    if (rig) { state.selected = rigMembers(rig).map((m) => m.id); renderInspector(); }
  }
  if (name === "dup") { duplicateSelected(); return; }
  if (name === "del") { deleteSelected(); return; }
  changed();
}

// Actions on the stage: selecting, placing and aiming, flash, the
// right-click menu, duplicate, delete and undo.
import {
  STORAGE_KEY,
  MAX_FIXTURES,
  MAX_POSITIONS,
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
  linkChannels,
  type Fixture,
  type SavedStage,
} from "./stage-model.ts";
import { newId } from "../shared/ids.ts";
import { MAX_RISERS, RISER_DEFAULTS, normalizeRiser, type Riser } from "./risers.ts";
import {
  state,
  save,
  byId,
  selectedFixtures,
  rigById,
  rigOf,
  rigMembers,
  syncRig,
  positionById,
  riserById,
  ui,
  type RigSettings,
} from "./state.ts";
import { view, syncScene, updateGhost, showAimPreview } from "./view3d.ts";
import { drawPlan } from "./plan.ts";
import { inspectorEl, renderList, renderInspector, syncInspector, renderHud, showPositions, showRisers } from "./sidebar.ts";
import { placeType, placeFixture, placeUniverse } from "./dialogs.ts";
import { consoleLink, pushToConsole, requestRegistrations } from "./link.ts";
import { aimAndFollow, followingOf, stopFollowing, syncFollowing } from "./follow.ts";
import { trace, publishStage } from "./stage.ts";
import * as THREE from "three";
import { describeSpot, lengthUnit, toShown } from "./units.ts";
import { isOneOf, isPresent } from "../shared/guards.ts";
import { elById } from "../shared/query.ts";
import { readStoredJson, storeJson } from "../shared/storage.ts";

// Flash: while held, the flashed fixtures draw white at full intensity.
// Display-only: their saved color / intensity are untouched.
const FLASH_MIN_MS = 150;
export const flashing = new Set();
let flashStart = 0;
let flashTimer = 0;

// Blackout: while the inspector's B is held, a stage-only fixture draws dark.
export const blackedOut = new Set();

/** What a fixture looks like right now (its own settings, white/full while flashing, or dark while blacked out). */
export const look = (fixture: Fixture) => {
  if (flashing.has(fixture.id)) return { color: "#ffffff", intensity: 1 };
  if (blackedOut.has(fixture.id)) return { color: fixture.color, intensity: 0 };
  return fixture;
};

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
  flashTimer = window.setTimeout(() => { flashing.clear(); redrawLook(); }, wait);
}

// ---------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------

/** Console fixtures last told to the console as selected. */
let lastSelectionKey = "";

export function changed({ list = true, inspector = true, persist = true } = {}) {
  syncFollowing();
  pushToConsole();
  publishStage();
  // A new selection: have the console scroll to the selected fixtures' faders
  // and highlight them until the selection changes (none = clear it). Keyed on
  // the console fixtures, so a fixture that links up while selected is sent too.
  const ids = [...new Set(selectedFixtures().map((i) => i.link.consoleId).filter(isPresent))];
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

export function select(id: string | null, additive = false) {
  // Selecting a fixture puts a picked-out riser back (Delete then means the fixture).
  if (id && ui.activeRiser) setActiveRiser(null);
  if (!id) state.selected = [];
  else if (additive) {
    state.selected = state.selected.includes(id) ? state.selected.filter((s) => s !== id) : [...state.selected, id];
  } else state.selected = [id];
  renderInspector();
  changed({ inspector: false });
}

/** Select every fixture in `id`'s rig (double-click); false if it isn't in one. */
export function selectRigOf(id: string): boolean {
  const rig = rigOf(byId(id));
  if (!rig) return false;
  state.selected = rigMembers(rig).map((m) => m.id);
  renderInspector();
  changed({ inspector: false });
  return true;
}

const bannerEl = elById("banner");
const PLACE_HINT = bannerEl.textContent;
const RIG_PLACE_HINT = "Click where the rig's center goes: a surface or the ground in 3D, or the plan · Esc cancels";
const POSITION_PLACE_HINT = "Click a spot on the floor, a wall or the ceiling (or in the plan) to put a position there · Esc cancels";
const RISER_PLACE_HINT = "Click a spot on the floor (or in the plan) for the riser's center · Esc cancels";
const AIM_HINT = "Click a spot on the floor, a wall or the ceiling (or in the plan) to aim the selected fixtures at it · Esc cancels";
let bannerTimer = 0;

/** Show a banner message (null hides it); `ms` auto-hides it. */
export function setBanner(text: string | null, ms = 0) {
  clearTimeout(bannerTimer);
  bannerEl.textContent = text ?? "";
  bannerEl.hidden = !text;
  if (ms) bannerTimer = window.setTimeout(() => setBanner(null), ms);
}

/** Start (`on`) or stop placing: a fixture, a rig (`rigCfg`), or (`kind`) a named position or a riser. */
export function setPlacing(on: boolean, rigCfg: RigSettings | null = null, kind: "position" | "riser" | null = null) {
  if (on && ui.aiming) setAiming(false);
  const position = kind === "position", riser = kind === "riser";
  ui.placing = on;
  ui.placingRig = on ? rigCfg : null;
  ui.placingPosition = on && position;
  ui.placingRiser = on && riser;
  view.classList.toggle("placing", on);
  setBanner(on ? (position ? POSITION_PLACE_HINT : riser ? RISER_PLACE_HINT : rigCfg ? RIG_PLACE_HINT : PLACE_HINT) : null);
  elById("addBtn").classList.toggle("active", on && !rigCfg && !kind);
  elById("rigBtn").classList.toggle("active", on && !!rigCfg);
  elById("positionBtn").classList.toggle("active", on && position);
  elById("riserBtn").classList.toggle("active", on && riser);
  if (!on) { updateGhost(null); showAimPreview(null); }
  drawPlan();
}

export function setAiming(on: boolean) {
  if (on && !selectedFixtures().length) {
    setBanner("Select one or more fixtures first, then Aim at spot (A)", 2500);
    return;
  }
  if (on && ui.placing) setPlacing(false);
  ui.aiming = on;
  view.classList.toggle("placing", on);
  setBanner(on ? AIM_HINT : null);
  inspectorEl.querySelectorAll<HTMLElement>('[data-act="aimSpot"]').forEach((b) => b.classList.toggle("active", on));
  if (!on) showAimPreview(null);
  drawPlan();
}

/** Point every selected fixture's beam at `p` (world, meters). */
export function applyAim(p: THREE.Vector3) {
  const sel = selectedFixtures();
  stopFollowing(sel);
  const missed = sel.filter((fixture) => !aimAt(fixture, p));
  setAiming(false);
  changed();
  if (missed.length) {
    const names = missed.map((i) => i.name).join(", ");
    setBanner(`Out of pan/tilt range, aimed as close as possible: ${names}`, 4000);
  }
}

// ---------------------------------------------------------------------
// Positions: named spots to aim at
// ---------------------------------------------------------------------

/**
 * Say where a position would go in the banner: while placing one, or (`moving`:
 * its name) while dragging one. null: the plain hint while placing, else
 * no banner.
 */
export function showPositionSpot(text: string | null, moving?: string) {
  if (moving != null) { setBanner(text ? `Moving ${moving}: ${text} · ⇧ = straight up / down` : null); return; }
  if (!ui.placingPosition) return;
  setBanner(text ? `New position: ${text} · click to put it here (then ⇧-drag it to raise it) · Esc cancels` : POSITION_PLACE_HINT);
}

/** Position being looked at (highlighted in the list, plan and 3D), or null. */
export function setActivePosition(id: string | null) {
  ui.activePosition = id;
  syncScene();
  drawPlan();
  showPositions();
}

/** The position whose right-click menu is open, or null. */
let menuPosition: string | null = null;

/** Whether the banner shows a hovered position (so leaving it clears only that). */
let hoverBanner = false;

/** Name the fixture or riser under the pointer (3D or plan; null: none). */
export function setHoverItem(fixture: string | null, riser: string | null) {
  if (ui.hoverFixture === fixture && ui.hoverRiser === riser) return;
  ui.hoverFixture = fixture;
  ui.hoverRiser = riser;
  syncScene();
  drawPlan();
}

/**
 * Light up the position under the pointer (3D, plan or the list; null:
 * none): bigger, with a halo and lines from the fixtures following it, and
 * where it is in the banner.
 */
export function setHoverPosition(id: string | null) {
  // A position's right-click menu keeps it lit while it's open.
  if (id == null && menuPosition && !ctxMenu.hidden) id = menuPosition;
  if (ui.hoverPosition === id) return;
  ui.hoverPosition = id;
  syncScene();
  drawPlan();
  const position = positionById(id);
  if (position && !ui.placing && !ui.aiming) {
    const n = state.fixtures.filter((f) => followingOf(f)?.id === position.id).length;
    const follow = n ? ` · ${n} fixture${n > 1 ? "s" : ""} following` : "";
    setBanner(`${position.name}: ${describeSpot(position)}${follow} · drag to move (⇧ up / down)`);
    hoverBanner = true;
  } else if (hoverBanner) {
    hoverBanner = false;
    if (!ui.placing && !ui.aiming) setBanner(null);
  }
}

/** A name like "Position 3" that isn't taken yet. */
/** "Position 3", "Riser 3": the first `<prefix> N` (from one past the count) that isn't taken. */
function nextFreeName(prefix: string, items: { name: string }[]) {
  const taken = new Set(items.map((item) => item.name.toLowerCase()));
  let n = items.length + 1;
  while (taken.has(`${prefix.toLowerCase()} ${n}`)) n++;
  return `${prefix} ${n}`;
}

/**
 * Add a position (from a click while placing one, or the chat); returns it.
 * `rename`: put the cursor in its name, to type one (a click; not the chat,
 * which would lose its own cursor).
 */
export function addPositionAt(x: number, y: number, z: number, name?: string, { rename = true } = {}) {
  setPlacing(false);
  if (state.positions.length >= MAX_POSITIONS) {
    setBanner(`Position limit reached (${MAX_POSITIONS})`, 2500);
    return null;
  }
  const position = { id: newId("position"), name: name?.trim() || nextFreeName("Position", state.positions), x: round(x), y: round(Math.max(0, y)), z: round(z) };
  state.positions.push(position);
  ui.activePosition = position.id;
  changed();
  showPositions(rename ? { rename: position.id } : {});
  return position;
}

export function deletePosition(id: string, { redoing = false } = {}) {
  const index = state.positions.findIndex((p) => p.id === id);
  if (index < 0) return;
  const [position] = state.positions.splice(index, 1);
  writeUndo([...readUndo(), { positionIndex: index, data: serializeStage(state.box, [], state.transparent, [], [position]) }]);
  if (!redoing) writeRedo([]);
  setBanner(`Deleted ${position.name} · ⌘Z to undo`, 4000);
  if (ui.activePosition === id) ui.activePosition = null;
  if (ui.hoverPosition === id) setHoverPosition(null);
  changed();
  showPositions();
}

/** Aim the given fixtures (default: the selected ones) at a position, to follow it (follow.ts). Returns the ones out of reach. */
export function aimAtPosition(id: string, fixtures: Fixture[] = selectedFixtures()) {
  const position = positionById(id);
  if (!position) return [];
  if (!fixtures.length) {
    setBanner("Select one or more fixtures first, then aim them at a position", 2500);
    return [];
  }
  if (ui.aiming) setAiming(false);
  const missed = aimAndFollow(fixtures, id);
  changed();
  if (missed.length) setBanner(`Out of pan/tilt range, aimed as close as possible: ${missed.map((i) => i.name).join(", ")}`, 4000);
  return missed;
}

// ---------------------------------------------------------------------
// Risers: boxes standing on the floor
// ---------------------------------------------------------------------

/** Riser picked out (highlighted in the list, plan and 3D), or null. */
export function setActiveRiser(id: string | null) {
  ui.activeRiser = id;
  // Picking out a riser deselects the fixtures (Delete then means the riser).
  if (id && state.selected.length) {
    state.selected = [];
    renderInspector();
    changed({ inspector: false });
  }
  syncScene();
  drawPlan();
  showRisers();
}

/** Add a riser centered at (x, z) (a click while placing one, or the chat); returns it. `rename`: as for addPositionAt. */
export function addRiserAt(x: number, z: number, opts: Partial<Omit<Riser, "id" | "x" | "z">> = {}, { rename = true } = {}) {
  setPlacing(false);
  if (state.risers.length >= MAX_RISERS) {
    setBanner(`Riser limit reached (${MAX_RISERS})`, 2500);
    return null;
  }
  const riser = normalizeRiser({ ...RISER_DEFAULTS, ...opts, id: newId("riser"), name: opts.name?.trim() || nextFreeName("Riser", state.risers), x, z }, state.risers.length);
  state.risers.push(riser);
  setActiveRiser(riser.id);
  changed();
  showRisers(rename ? { rename: riser.id } : {});
  return riser;
}

/** A riser's size and turn for the banner: "2.4 × 1.2 × 0.4 m · turn 30°". */
export function describeRiser(r: Riser) {
  return `${toShown(r.w)} × ${toShown(r.d)} × ${toShown(r.h)} ${lengthUnit()} · turn ${r.yaw}°`;
}

export function deleteRiser(id: string, { redoing = false } = {}) {
  const index = state.risers.findIndex((r) => r.id === id);
  if (index < 0) return;
  const [riser] = state.risers.splice(index, 1);
  writeUndo([...readUndo(), { riserIndex: index, data: serializeStage(state.box, [], state.transparent, [], [], [riser]) }]);
  if (!redoing) writeRedo([]);
  setBanner(`Deleted ${riser.name} · ⌘Z to undo`, 4000);
  if (ui.activeRiser === id) ui.activeRiser = null;
  changed();
  showRisers();
}

/** Copy a riser beside it (to stage left, by its width), and pick out the copy. */
export function duplicateRiser(id: string) {
  const riser = riserById(id);
  if (!riser) return;
  addRiserAt(riser.x + riser.w, riser.z, { name: `${riser.name} copy`, w: riser.w, d: riser.d, h: riser.h, yaw: riser.yaw });
}

export function addFixtureAt(x: number, y: number, z: number) {
  if (state.fixtures.length >= MAX_FIXTURES) { setPlacing(false); return; }
  const fixture = createFixture(x, y, z, state.fixtures.length, state.box);
  fixture.link.register = placeType;
  fixture.link.universe = placeUniverse;
  const profile = placeFixture;
  if (profile) {
    applyFixture(fixture, profile);
    const same = state.fixtures.filter((i) => i.link.fixture?.model === profile.model).length;
    fixture.name = `${profile.model} ${same + 1}`;
  }
  state.fixtures.push(fixture);
  setPlacing(false);
  select(fixture.id);
  requestRegistrations();
}

/**
 * The inspector's B / F on the dimmer, held (`on`) or released: blackout or
 * full and white. A fixture whose dimmer has a console fader is held in the
 * console, like its B / F there, so the lights do it too (and the stage shows
 * what comes back); a stage-only one just looks it here.
 */
export function holdDimmer(kind: "blackout" | "flash", fixture: Fixture, on: boolean) {
  const channel = linkChannels(fixture).find((c) => c.attr === "dimmer")?.channel;
  if (channel && consoleLink.live && consoleLink.fadersFor(channel).length) {
    consoleLink.hold(kind, channel, on);
    return;
  }
  const set = kind === "blackout" ? blackedOut : flashing;
  if (on) set.add(fixture.id);
  else set.delete(fixture.id);
  redrawLook();
}

// ---------------------------------------------------------------------
// Right-click menu (fixtures in 3D, plan and list)
// ---------------------------------------------------------------------

export const ctxMenu = elById("ctxMenu");

/**
 * Open the menu for fixture `id` at a screen point. Right-clicking an
 * fixture that's part of the selection acts on the whole selection;
 * otherwise it selects just that fixture first.
 */
export function openContextMenu(id: string, x: number, y: number) {
  menuPosition = null;
  if (!state.selected.includes(id)) select(id);
  const n = state.selected.length;
  const rig = rigOf(byId(id));
  const title = n === 1 ? byId(id)?.name ?? "" : `${n} fixtures`;
  const count = n > 1 ? ` ${n}` : "";
  const delCount = deletionIds().size;
  const delLabel = rig ? `Delete rig${delCount > 1 ? ` (${delCount})` : ""}` : `Delete${count}`;
  const item = (cmd: Action | "flash", label: string, key = "", cls = "") =>
    `<button type="button" data-cmd="${cmd}" class="menu-item ${cls}"><span>${label}</span><kbd>${key}</kbd></button>`;
  // Named positions in a sub-menu (opens on hover, focus or a click on it).
  const positions = state.positions.length
    ? `<div class="submenu-wrap">
        <button type="button" class="menu-item" data-submenu aria-haspopup="menu"><span>Aim at position</span><kbd>▸</kbd></button>
        <div class="menu submenu thin-scroll" role="menu">${state.positions.map((p) => `<button type="button" data-position="${p.id}" class="menu-item"><span></span></button>`).join("")}</div>
      </div>`
    : "";
  const following = selectedFixtures().some((f) => followingOf(f));
  ctxMenu.innerHTML = `<div class="menu-title"></div>
    ${item("aimSpot", "Aim at spot…", "A")}
    ${positions}
    ${following ? item("unfollow", "Stop following") : ""}
    ${item("home", "Home", "H")}
    ${rig ? item("selectRig", "Select whole rig") : `${item("zero", "Set zero here", "Z")}${item("aim", "Aim zero at stage")}`}
    ${item("flash", "Flash (hold)", "F")}
    <hr />
    ${item("dup", `Duplicate${count}`)}
    ${item("del", delLabel, "⌫", "danger")}`;
  ctxMenu.querySelectorAll<HTMLElement>("kbd:empty").forEach((k) => k.remove());
  ctxMenu.querySelectorAll<HTMLElement>("[data-position]").forEach((b) => {
    const span = b.querySelector("span");
    if (span) span.textContent = positionById(b.dataset.position)?.name ?? "";
    // Pointing at one lights it up on the stage.
    b.addEventListener("pointerenter", () => setHoverPosition(b.dataset.position ?? null));
    b.addEventListener("focus", () => setHoverPosition(b.dataset.position ?? null));
    b.addEventListener("pointerleave", () => setHoverPosition(null));
  });
  const titleEl = ctxMenu.querySelector(".menu-title");
  if (titleEl) titleEl.textContent = title;
  showMenuAt(x, y);
}

/** The right-click menu for a named position (it stays lit up while the menu is open). */
export function openPositionMenu(id: string, x: number, y: number) {
  const position = positionById(id);
  if (!position) return;
  ctxMenu.innerHTML = `<div class="menu-title"></div>
    <button type="button" data-delete-position="${position.id}" class="menu-item danger"><span>Delete position</span></button>`;
  const titleEl = ctxMenu.querySelector(".menu-title");
  if (titleEl) titleEl.textContent = position.name;
  menuPosition = id;
  showMenuAt(x, y);
  setHoverPosition(id);
}

/** The right-click menu for a riser (it's picked out while the menu is open). */
export function openRiserMenu(id: string, x: number, y: number) {
  const riser = riserById(id);
  if (!riser) return;
  menuPosition = null;
  ctxMenu.innerHTML = `<div class="menu-title"></div>
    <button type="button" data-dup-riser="${riser.id}" class="menu-item"><span>Duplicate riser</span></button>
    <button type="button" data-delete-riser="${riser.id}" class="menu-item danger"><span>Delete riser</span></button>`;
  const titleEl = ctxMenu.querySelector(".menu-title");
  if (titleEl) titleEl.textContent = riser.name;
  if (ui.activeRiser !== id) setActiveRiser(id);
  showMenuAt(x, y);
}

/** Show the menu at (x, y), kept on screen. */
function showMenuAt(x: number, y: number) {
  ctxMenu.hidden = false;
  const r = ctxMenu.getBoundingClientRect();
  ctxMenu.style.left = `${Math.min(x, window.innerWidth - r.width - 8)}px`;
  ctxMenu.style.top = `${Math.min(y, window.innerHeight - r.height - 8)}px`;
  // The sub-menu opens to the left when there's no room on the right.
  const placed = ctxMenu.getBoundingClientRect();
  ctxMenu.querySelector(".submenu-wrap")?.classList.toggle("left", placed.right + 200 > window.innerWidth);
  ctxMenu.querySelector("button")?.focus();
}

export function closeContextMenu() {
  if (ctxMenu.hidden) return;
  ctxMenu.hidden = true;
  menuPosition = null;
  setHoverPosition(null);
}

const menuCmd = (e: PointerEvent) => (e.target instanceof Element ? e.target.closest<HTMLElement>("[data-cmd]")?.dataset.cmd : null);

ctxMenu.addEventListener("click", (e) => {
  const doomed = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-delete-position]")?.dataset.deletePosition : null;
  if (doomed) { closeContextMenu(); deletePosition(doomed); return; }
  const riserCmd = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-delete-riser], [data-dup-riser]") : null;
  if (riserCmd) {
    closeContextMenu();
    if (riserCmd.dataset.deleteRiser) deleteRiser(riserCmd.dataset.deleteRiser);
    else if (riserCmd.dataset.dupRiser) duplicateRiser(riserCmd.dataset.dupRiser);
    return;
  }
  const positionId = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-position]")?.dataset.position : null;
  if (positionId) { closeContextMenu(); aimAtPosition(positionId); return; }
  const sub = e.target instanceof Element ? e.target.closest(".submenu-wrap") : null;
  if (sub && e.target instanceof Element && e.target.closest("[data-submenu]")) {
    // Click (or Enter) on "Aim at position": open it and go to its first position.
    sub.classList.add("open");
    sub.querySelector<HTMLElement>("[data-position]")?.focus();
    return;
  }
  const cmd = menuCmd(e);
  if (!isOneOf(ACTIONS, cmd)) return; // flash works while held (below)
  closeContextMenu();
  act(cmd); // same as the inspector buttons
});
// Flash lasts while the menu item is held down.
ctxMenu.addEventListener("pointerdown", (e) => { if (menuCmd(e) === "flash") { e.preventDefault(); startFlash(); } });
ctxMenu.addEventListener("pointerup", (e) => { if (menuCmd(e) === "flash") { stopFlash(); closeContextMenu(); } });
ctxMenu.addEventListener("pointerleave", stopFlash);
// Any press outside the menu, or the window losing focus / resizing, closes it.
window.addEventListener("pointerdown", (e) => { if (!ctxMenu.hidden && !(e.target instanceof Node && ctxMenu.contains(e.target))) closeContextMenu(); }, true);
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
    rigId: null, rigIndex: 0, follow: null,
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
 * Each entry: { indexes, data } (data = the removed fixtures as a stage file).
 */
const UNDO_KEY = `${STORAGE_KEY}.undo`;
const MAX_UNDO = 50;
/** One delete: where the fixtures (or a named position, or a riser) were in their list, and them (as a stage file). */
type UndoEntry = { indexes?: number[]; positionIndex?: number; riserIndex?: number; data: SavedStage };
let undoMemory: UndoEntry[] = [];

function readUndo(): UndoEntry[] {
  // Storage shares undo between stage windows; memory covers it being unavailable.
  const list = readStoredJson(UNDO_KEY) ?? undoMemory;
  return Array.isArray(list) ? list : [];
}

function writeUndo(list: UndoEntry[]) {
  undoMemory = list.slice(-MAX_UNDO);
  storeJson(UNDO_KEY, undoMemory);
}

/**
 * Deletes undone, newest last, so ⇧⌘Z can delete them again: the fixture
 * (or position) ids each undo put back. Shared like the undo list; a new
 * delete clears it.
 */
const REDO_KEY = `${STORAGE_KEY}.redo`;
type RedoEntry = { fixtures: string[]; positions: string[]; risers: string[] };
let redoMemory: RedoEntry[] = [];

const isIds = (v: unknown): v is string[] => Array.isArray(v) && v.every((id) => typeof id === "string");
function readRedo(): RedoEntry[] {
  const list = readStoredJson(REDO_KEY) ?? redoMemory;
  if (!Array.isArray(list)) return [];
  return list.flatMap((e) => (e && typeof e === "object" && isIds(e.fixtures) && isIds(e.positions) ? [{ fixtures: e.fixtures, positions: e.positions, risers: isIds(e.risers) ? e.risers : [] }] : []));
}

function writeRedo(list: RedoEntry[]) {
  redoMemory = list.slice(-MAX_UNDO);
  storeJson(REDO_KEY, redoMemory);
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

export function deleteSelected({ redoing = false } = {}) {
  const ids = deletionIds();
  const removed: { fixture: Fixture; index: number }[] = [];
  state.fixtures.forEach((fixture, index) => { if (ids.has(fixture.id)) removed.push({ fixture, index }); });
  if (!removed.length) return;
  const rigIds = new Set(removed.map((r) => r.fixture.rigId).filter(isPresent));
  const rigs = state.rigs.filter((r) => rigIds.has(r.id));
  writeUndo([...readUndo(), {
    indexes: removed.map((r) => r.index),
    data: serializeStage(state.box, removed.map((r) => r.fixture), state.transparent, rigs),
  }]);
  state.fixtures = state.fixtures.filter((i) => !ids.has(i.id));
  state.rigs = state.rigs.filter((r) => !rigIds.has(r.id));
  // Fixtures the stage registered leave the console too (their faders are freed).
  consoleLink.unregister(removed.flatMap((r) => (r.fixture.link.owned && r.fixture.link.consoleId ? [r.fixture.link.consoleId] : [])));
  select(null);
  const what = rigs.length === 1 && removed.every((r) => r.fixture.rigId === rigs[0].id)
    ? rigs[0].name
    : removed.length === 1 ? removed[0].fixture.name : `${removed.length} fixtures`;
  if (!redoing) writeRedo([]); // a new delete: nothing to redo any more
  setBanner(`Deleted ${what} · ⌘Z to undo`, 4000);
}

export function undoDelete() {
  const list = readUndo();
  const entry = list.pop();
  if (!entry) return;
  const { fixtures, rigs, positions, risers } = parseStage(entry.data);
  // A deleted riser: put it back where it was in the list.
  if (entry.riserIndex != null) {
    writeUndo(list);
    const back = risers.filter((r) => !riserById(r.id));
    if (!back.length) return;
    state.risers.splice(Math.min(entry.riserIndex, state.risers.length), 0, ...back);
    writeRedo([...readRedo(), { fixtures: [], positions: [], risers: back.map((r) => r.id) }]);
    setActiveRiser(back[0].id);
    changed();
    setBanner(`Restored ${back[0].name} · ⇧⌘Z to delete again`, 2500);
    return;
  }
  // A deleted named position: put it back where it was in the list.
  if (entry.positionIndex != null) {
    writeUndo(list);
    const back = positions.filter((p) => !positionById(p.id));
    if (!back.length) return;
    state.positions.splice(Math.min(entry.positionIndex, state.positions.length), 0, ...back);
    writeRedo([...readRedo(), { fixtures: [], positions: back.map((p) => p.id), risers: [] }]);
    changed();
    showPositions();
    setBanner(`Restored ${back[0].name} · ⇧⌘Z to delete again`, 2500);
    return;
  }
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
  writeRedo([...readRedo(), { fixtures: removed.map((r) => r.fixture.id), positions: [], risers: [] }]);
  const what = rigs.length === 1 ? rigs[0].name : removed.length === 1 ? removed[0].fixture.name : `${removed.length} fixtures`;
  setBanner(`Restored ${what} · ⇧⌘Z to delete again`, 2500);
}

/** Delete again what the last ⌘Z put back (⇧⌘Z). */
export function redoDelete() {
  const list = readRedo();
  const entry = list.pop();
  if (!entry) return;
  writeRedo(list);
  for (const id of entry.positions) if (positionById(id)) deletePosition(id, { redoing: true });
  for (const id of entry.risers) if (riserById(id)) deleteRiser(id, { redoing: true });
  // Only those still on the stage (another window may have deleted them since).
  const still = entry.fixtures.filter((id) => byId(id));
  if (!still.length) return;
  state.selected = still;
  deleteSelected({ redoing: true });
}

/** What the inspector's buttons and the right-click menu do (their `data-act` / `data-cmd`). */
export const ACTIONS = ["home", "zero", "aimSpot", "aim", "selectRig", "dup", "del", "unfollow"] as const;
export type Action = (typeof ACTIONS)[number];

export function act(name: Action) {
  const sel = selectedFixtures();
  if (name === "home") { stopFollowing(sel); sel.forEach(homeFixture); }
  if (name === "unfollow") stopFollowing(sel);
  // A rig member's zero is set by its rig, so these skip rig members.
  const free = sel.filter((i) => !i.rigId);
  if (name === "zero") free.forEach(setZeroHere);
  if (name === "aimSpot") { setAiming(!ui.aiming); return; }
  if (name === "aim") free.forEach((i) => aimZeroAt(i, defaultTarget(i, state.box)));
  if (name === "selectRig") { if (sel[0]) selectRigOf(sel[0].id); return; }
  if (name === "dup") { duplicateSelected(); return; }
  if (name === "del") { deleteSelected(); return; }
  changed();
}

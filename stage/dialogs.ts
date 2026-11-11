// Header controls and dialogs: box size, View settings, Place rig, Place fixture.
import {
  MAX_FIXTURES,
  SURFACES,
  RIG_TYPES,
  RIG_TYPE_KEYS,
  TRANSPARENT_SIDES,
  normalizeRig,
  consoleTypeFromKey,
  type Box,
  type ConsoleType,
} from "./stage-model.ts";
import { clamp, numberFrom } from "../shared/numbers.ts";
import { state, save, ui } from "./state.ts";
import { updateSurfaces, updateBox } from "./view3d.ts";
import { changed, setPlacing } from "./actions.ts";
import {
  rememberConsoleType,
  LIBRARY,
  fillUniverses,
  readUniverse,
  fillConsoleTypes,
  libraryPickerFor,
} from "./link.ts";
import { elById } from "../shared/query.ts";
import { UNITS, convertLength, fromShown, inputStep, lengthUnit, onUnitChange, setLengthUnit, toShown, unitName, type Unit } from "./units.ts";
import { isOneOf } from "../shared/guards.ts";
import type { FixtureProfile } from "./fixture-library.ts";
import { el } from "../shared/html.ts";

// ---------------------------------------------------------------------
// Header: box size, place
// ---------------------------------------------------------------------

const boxInputs: Record<keyof Box, HTMLInputElement> = { w: elById("boxW"), d: elById("boxD"), h: elById("boxH") };
const BOX_KEYS = ["w", "d", "h"] as const;
/** Largest box side, meters. */
const BOX_MAX: Record<keyof Box, number> = { w: 100, d: 100, h: 50 };
export function syncBoxInputs() {
  for (const k of BOX_KEYS) {
    const el = boxInputs[k];
    el.min = String(toShown(1));
    el.max = String(toShown(BOX_MAX[k]));
    if (el !== document.activeElement) el.value = String(toShown(state.box[k]));
  }
  elById("boxUnit").textContent = lengthUnit();
  elById("boxGroup").title = `Performance area size in ${unitName()}`;
}
for (const k of BOX_KEYS) {
  const el = boxInputs[k];
  el.addEventListener("input", () => {
    const shown = numberFrom(el.value);
    if (shown == null) return;
    const v = fromShown(shown);
    if (v < 1) return;
    state.box[k] = clamp(v, 1, BOX_MAX[k]);
    updateBox();
    changed();
  });
}

/** A dialog closes from its close button or a click on its backdrop. */
function closable(dlg: HTMLDialogElement, closeBtnId: string) {
  elById(closeBtnId).addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
}

const addBtn = elById("addBtn");
addBtn.addEventListener("click", () => { addBtn.blur(); togglePlaceFixture(); });

// ---------------------------------------------------------------------
// View settings dialog
// ---------------------------------------------------------------------

export const settingsDlg = elById<HTMLDialogElement>("settings");
const surfaceRows = elById("surfaceRows");

function renderSurfaceRows() {
  surfaceRows.innerHTML = "";
  for (const { key, name, alwaysSolid } of SURFACES) {
    if (alwaysSolid) continue;
    const row = el("label", "check");
    const box = document.createElement("input");
    box.type = "checkbox";
    const label = document.createElement("span");
    label.textContent = name;
    row.append(box, label);
    box.checked = state.transparent[key];
    box.addEventListener("change", () => {
      state.transparent[key] = box.checked;
      updateSurfaces();
      save();
    });
    surfaceRows.append(row);
  }
}

// Units: meters or feet (units.ts).
const unitButtons = [...elById("unitSeg").querySelectorAll<HTMLButtonElement>("[data-unit]")];
const syncUnitButtons = () => unitButtons.forEach((b) => b.classList.toggle("on", b.dataset.unit === lengthUnit()));
for (const b of unitButtons) b.addEventListener("click", () => { if (isOneOf(UNITS, b.dataset.unit)) setLengthUnit(b.dataset.unit); });
onUnitChange(() => {
  syncUnitButtons();
  syncBoxInputs();
  syncRigDialogType({ keepValues: true });
});

const settingsBtn = elById("settingsBtn");
settingsBtn.addEventListener("click", () => {
  settingsBtn.blur();
  syncUnitButtons();
  renderSurfaceRows();
  settingsDlg.showModal();
});
closable(settingsDlg, "settingsClose");
settingsDlg.querySelectorAll<HTMLElement>("[data-all]").forEach((el) => {
  el.addEventListener("click", () => {
    const on = el.dataset.all === "transparent";
    for (const key of TRANSPARENT_SIDES) state.transparent[key] = on;
    updateSurfaces();
    renderSurfaceRows();
    save();
  });
});

// ---------------------------------------------------------------------
// Place rig dialog
// ---------------------------------------------------------------------

export const rigDlg = elById<HTMLDialogElement>("rigDlg");
const rigInputs = {
  type: elById<HTMLSelectElement>("rigType"),
  size: elById<HTMLInputElement>("rigSize"),
  count: elById<HTMLInputElement>("rigCount"),
  tilt: elById<HTMLInputElement>("rigTilt"),
  yaw: elById<HTMLInputElement>("rigYaw"),
  consoleType: elById<HTMLSelectElement>("rigConsoleType"),
};
const rigUniverseEl = elById<HTMLSelectElement>("rigUniverse");
const rigRoomEl = elById("rigRoom");
const rigLib = libraryPickerFor(rigInputs.consoleType, elById("rigLib"));

const rigBtn = elById("rigBtn");
rigBtn.addEventListener("click", () => {
  rigBtn.blur();
  if (ui.placing) setPlacing(false);
  const room = MAX_FIXTURES - state.fixtures.length;
  rigInputs.count.max = String(Math.max(2, room));
  rigRoomEl.textContent = `${room} of ${MAX_FIXTURES} fixture slots free.`;
  fillConsoleTypes(rigInputs.consoleType);
  rigLib.sync();
  fillUniverses(rigUniverseEl);
  rigDlg.showModal();
});
closable(rigDlg, "rigClose");
elById("rigPlace").addEventListener("click", () => {
  const cfg = normalizeRig({
    type: rigInputs.type.value,
    size: fromShown(numberFrom(rigInputs.size.value) ?? NaN),
    count: rigInputs.count.value,
    tilt: rigInputs.tilt.value,
    yaw: rigInputs.yaw.value,
  }, 0);
  const room = MAX_FIXTURES - state.fixtures.length;
  if (cfg.count > room) {
    rigRoomEl.textContent = `Only ${room} fixture slots free; lower the count to ${room} or fewer.`;
    return;
  }
  rigDlg.close();
  let consoleType = consoleTypeFromKey(rigInputs.consoleType.value);
  let fixture: FixtureProfile | null = null;
  if (rigInputs.consoleType.value === LIBRARY) {
    fixture = rigLib.profile();
    if (!fixture) { rigRoomEl.textContent = "Pick a fixture and mode first."; return; }
    consoleType = { mount: fixture.mount, color: fixture.color };
  }
  rememberConsoleType(rigInputs.consoleType.value);
  setPlacing(true, {
    type: cfg.type, size: cfg.size, count: cfg.count, tilt: cfg.tilt, yaw: cfg.yaw,
    consoleType, fixture, universe: readUniverse(rigUniverseEl),
  });
});

/** The unit the rig dialog's size was typed in. */
let rigSizeShownIn: Unit = lengthUnit();

/**
 * Switching type relabels the size and loads that type's defaults and help.
 * `keepValues` (a new unit): only the size's label and number change.
 */
function syncRigDialogType({ keepValues = false } = {}) {
  const type = rigInputs.type.value;
  const t = RIG_TYPES[isOneOf(RIG_TYPE_KEYS, type) ? type : "circle"];
  elById("rigSizeLabel").textContent = `${t.sizeLabel} (${lengthUnit()})`;
  rigInputs.size.step = inputStep();
  if (keepValues) {
    const was = numberFrom(rigInputs.size.value);
    if (was != null) rigInputs.size.value = String(convertLength(was, rigSizeShownIn, lengthUnit()));
    rigSizeShownIn = lengthUnit();
    return;
  }
  rigSizeShownIn = lengthUnit();
  elById("rigHelp").textContent = `${t.name}: ${t.help}`;
  rigInputs.size.value = String(toShown(t.defaults.size));
  rigInputs.count.value = String(t.defaults.count);
  rigInputs.tilt.value = String(t.defaults.tilt);
  rigInputs.yaw.value = String(t.defaults.yaw);
}
rigInputs.type.innerHTML = Object.entries(RIG_TYPES).map(([k, t]) => `<option value="${k}">${t.name}</option>`).join("");
rigInputs.type.addEventListener("change", () => syncRigDialogType());
syncRigDialogType();

// Place fixture: pick its console type first.
export const placeDlg = elById<HTMLDialogElement>("placeDlg");
const placeTypeEl = elById<HTMLSelectElement>("placeType");
const placeUniverseEl = elById<HTMLSelectElement>("placeUniverse");
const placeLibMsg = elById("placeLibMsg");
/** Console type for the fixture being placed (null = stage only). */
export let placeType: ConsoleType | null = null;
/** Real fixture for the fixture being placed (null = generic). */
export let placeFixture: FixtureProfile | null = null;
/** Universe the fixture being placed registers in (null = first with room). */
export let placeUniverse: number | null = null;
const placeLib = libraryPickerFor(placeTypeEl, elById("placeLib"));

export function togglePlaceFixture() {
  if (ui.placing) { setPlacing(false); return; }
  fillConsoleTypes(placeTypeEl);
  placeLib.sync();
  fillUniverses(placeUniverseEl);
  placeDlg.showModal();
}

elById("placeForm").addEventListener("submit", (e) => {
  e.preventDefault();
  placeFixture = null;
  if (placeTypeEl.value === LIBRARY) {
    const p = placeLib.profile();
    if (!p) { placeLibMsg.textContent = "Pick a fixture and mode first."; return; }
    placeFixture = p;
    placeType = { mount: p.mount, color: p.color };
  } else {
    placeType = consoleTypeFromKey(placeTypeEl.value);
  }
  rememberConsoleType(placeTypeEl.value);
  placeUniverse = readUniverse(placeUniverseEl);
  placeLibMsg.textContent = "";
  placeDlg.close();
  setPlacing(true);
});
closable(placeDlg, "placeClose");

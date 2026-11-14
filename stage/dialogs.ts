// Header controls and dialogs: box size, View settings, Place truss, Place fixture.
import {
  MAX_FIXTURES,
  SURFACES,
  TRUSS_TYPES,
  TRUSS_TYPE_KEYS,
  TRANSPARENT_SIDES,
  normalizeTruss,
  consoleTypeFromKey,
  consoleTypeOfMode,
  DEFAULT_CONSOLE_TYPE,
  type Box,
} from "./stage-model.ts";
import { clamp, numberFrom } from "../shared/numbers.ts";
import { state, save, ui, type PlaceChoice } from "./state.ts";
import { updateSurfaces, updateBox } from "./view3d.ts";
import { changed, setPlacing } from "./actions.ts";
import {
  rememberConsoleType,
  LIBRARY,
  EXISTING,
  existingPickerFor,
  fillUniverses,
  readUniverse,
  fillConsoleTypes,
  libraryPickerFor,
} from "./link.ts";
import { elById } from "../shared/query.ts";
import { alwaysShowNames, setAlwaysShowNames } from "./names.ts";
import { UNITS, convertLength, fromShown, inputStep, lengthUnit, onUnitChange, setLengthUnit, toShown, unitName, type Unit } from "./units.ts";
import { isOneOf } from "../shared/guards.ts";
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
  syncTrussDialogType({ keepValues: true });
});

// Names of positions and risers: always, or only the one pointed at / picked out (names.ts).
const alwaysNames = elById<HTMLInputElement>("alwaysNames");
alwaysNames.addEventListener("change", () => setAlwaysShowNames(alwaysNames.checked));

const settingsBtn = elById("settingsBtn");
settingsBtn.addEventListener("click", () => {
  settingsBtn.blur();
  syncUnitButtons();
  alwaysNames.checked = alwaysShowNames();
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
// Place truss dialog
// ---------------------------------------------------------------------

export const trussDlg = elById<HTMLDialogElement>("trussDlg");
const trussInputs = {
  type: elById<HTMLSelectElement>("trussType"),
  size: elById<HTMLInputElement>("trussSize"),
  count: elById<HTMLInputElement>("trussCount"),
  tilt: elById<HTMLInputElement>("trussTilt"),
  yaw: elById<HTMLInputElement>("trussYaw"),
  consoleType: elById<HTMLSelectElement>("trussConsoleType"),
};
const trussUniverseEl = elById<HTMLSelectElement>("trussUniverse");
const trussRoomEl = elById("trussRoom");
const trussLib = libraryPickerFor(trussInputs.consoleType, elById("trussLib"));
const trussExisting = existingPickerFor(trussInputs.consoleType, elById("trussExistingRow"), elById<HTMLSelectElement>("trussExisting"));

const trussBtn = elById("trussBtn");
trussBtn.addEventListener("click", () => {
  trussBtn.blur();
  if (ui.placing) setPlacing(false);
  const room = MAX_FIXTURES - state.fixtures.length;
  trussInputs.count.max = String(Math.max(2, room));
  trussRoomEl.textContent = `${room} of ${MAX_FIXTURES} fixture slots free.`;
  fillConsoleTypes(trussInputs.consoleType);
  trussLib.sync();
  trussExisting.sync();
  fillUniverses(trussUniverseEl);
  trussDlg.showModal();
});
closable(trussDlg, "trussClose");
elById("trussPlace").addEventListener("click", () => {
  const cfg = normalizeTruss({
    type: trussInputs.type.value,
    size: fromShown(numberFrom(trussInputs.size.value) ?? NaN),
    count: trussInputs.count.value,
    tilt: trussInputs.tilt.value,
    yaw: trussInputs.yaw.value,
  }, 0);
  const room = MAX_FIXTURES - state.fixtures.length;
  if (cfg.count > room) {
    trussRoomEl.textContent = `Only ${room} fixture slots free; lower the count to ${room} or fewer.`;
    return;
  }
  const choice = readPlaceChoice(trussInputs.consoleType, trussLib, trussExisting, trussUniverseEl);
  if (typeof choice === "string") { trussRoomEl.textContent = choice; return; }
  trussDlg.close();
  setPlacing(true, { type: cfg.type, size: cfg.size, count: cfg.count, tilt: cfg.tilt, yaw: cfg.yaw, ...choice });
});

/** The unit the truss dialog's size was typed in. */
let trussSizeShownIn: Unit = lengthUnit();

/**
 * Switching type relabels the size and loads that type's defaults and help.
 * `keepValues` (a new unit): only the size's label and number change.
 */
function syncTrussDialogType({ keepValues = false } = {}) {
  const type = trussInputs.type.value;
  const t = TRUSS_TYPES[isOneOf(TRUSS_TYPE_KEYS, type) ? type : "circle"];
  elById("trussSizeLabel").textContent = `${t.sizeLabel} (${lengthUnit()})`;
  trussInputs.size.step = inputStep();
  if (keepValues) {
    const was = numberFrom(trussInputs.size.value);
    if (was != null) trussInputs.size.value = String(convertLength(was, trussSizeShownIn, lengthUnit()));
    trussSizeShownIn = lengthUnit();
    return;
  }
  trussSizeShownIn = lengthUnit();
  elById("trussHelp").textContent = `${t.name}: ${t.help}`;
  trussInputs.size.value = String(toShown(t.defaults.size));
  trussInputs.count.value = String(t.defaults.count);
  trussInputs.tilt.value = String(t.defaults.tilt);
  trussInputs.yaw.value = String(t.defaults.yaw);
}
trussInputs.type.innerHTML = Object.entries(TRUSS_TYPES).map(([k, t]) => `<option value="${k}">${t.name}</option>`).join("");
trussInputs.type.addEventListener("change", () => syncTrussDialogType());
syncTrussDialogType();

/**
 * What a placing dialog's console type (with its library and console fixture
 * pickers, and universe) asks for, remembered for next time; or why it can't
 * be placed yet.
 */
function readPlaceChoice(
  typeEl: HTMLSelectElement,
  lib: ReturnType<typeof libraryPickerFor>,
  existing: ReturnType<typeof existingPickerFor>,
  universeEl: HTMLSelectElement,
): PlaceChoice | string {
  const key = typeEl.value;
  const universe = readUniverse(universeEl);
  let choice: PlaceChoice;
  if (key === LIBRARY) {
    const fixture = lib.profile();
    if (!fixture) return "Pick a fixture and mode first.";
    choice = { consoleType: consoleTypeOfMode(fixture), fixture, universe };
  } else if (key === EXISTING) {
    const ci = existing.picked();
    if (!ci) return "Pick a console fixture first.";
    choice = { consoleType: consoleTypeOfMode(ci), fixture: null, universe, linkFrom: ci.id };
  } else choice = { consoleType: consoleTypeFromKey(key), fixture: null, universe };
  rememberConsoleType(key);
  return choice;
}

// Place fixture: pick its console type first.
export const placeDlg = elById<HTMLDialogElement>("placeDlg");
const placeTypeEl = elById<HTMLSelectElement>("placeType");
const placeUniverseEl = elById<HTMLSelectElement>("placeUniverse");
const placeLibMsg = elById("placeLibMsg");
/** How the fixture being placed gets its console fixture. */
export let placeChoice: PlaceChoice = { consoleType: DEFAULT_CONSOLE_TYPE, fixture: null, universe: null };
const placeLib = libraryPickerFor(placeTypeEl, elById("placeLib"));
const placeExistingPicker = existingPickerFor(placeTypeEl, elById("placeExistingRow"), elById<HTMLSelectElement>("placeExisting"));

export function togglePlaceFixture() {
  if (ui.placing) { setPlacing(false); return; }
  fillConsoleTypes(placeTypeEl);
  placeLib.sync();
  placeExistingPicker.sync();
  fillUniverses(placeUniverseEl);
  placeDlg.showModal();
}

elById("placeForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const choice = readPlaceChoice(placeTypeEl, placeLib, placeExistingPicker, placeUniverseEl);
  if (typeof choice === "string") { placeLibMsg.textContent = choice; return; }
  placeChoice = choice;
  placeLibMsg.textContent = "";
  placeDlg.close();
  setPlacing(true);
});
closable(placeDlg, "placeClose");

// Header controls and dialogs: box size, View settings, Place rig, Place fixture.
import {
  MAX_FIXTURES,
  SURFACES,
  RIG_TYPES,
  normalizeRig,
  consoleTypeFromKey,
} from "./stage-model.js";
import { clamp, numberFrom } from "../shared/numbers.js";
import { state, save, ui } from "./state.js";
import { updateSurfaces, updateBox } from "./view3d.js";
import { changed, setPlacing } from "./actions.js";
import {
  rememberConsoleType,
  LIBRARY,
  sd,
  fillUniverses,
  readUniverse,
  fillConsoleTypes,
  libraryPickerFor,
} from "./link.js";

// ---------------------------------------------------------------------
// Header: box size, place
// ---------------------------------------------------------------------

const boxInputs = { w: document.getElementById("boxW"), d: document.getElementById("boxD"), h: document.getElementById("boxH") };
export function syncBoxInputs() { for (const k in boxInputs) boxInputs[k].value = String(state.box[k]); }
for (const [k, el] of Object.entries(boxInputs)) {
  el.addEventListener("input", () => {
    const v = numberFrom(el.value);
    if (v == null || v < 1) return;
    state.box[k] = clamp(v, 1, 100);
    updateBox();
    changed();
  });
}

document.getElementById("addBtn").addEventListener("click", (e) => { e.currentTarget.blur(); togglePlaceFixture(); });

// ---------------------------------------------------------------------
// View settings dialog
// ---------------------------------------------------------------------

export const settingsDlg = /** @type {HTMLDialogElement} */ (document.getElementById("settings"));
const surfaceRows = document.getElementById("surfaceRows");

function renderSurfaceRows() {
  surfaceRows.innerHTML = "";
  for (const { key, name, alwaysSolid } of SURFACES) {
    if (alwaysSolid) continue;
    const row = document.createElement("label");
    row.className = "check";
    row.innerHTML = `<input type="checkbox" /><span></span>`;
    const box = row.querySelector("input");
    row.querySelector("span").textContent = name;
    box.checked = state.transparent[key];
    box.addEventListener("change", () => {
      state.transparent[key] = box.checked;
      updateSurfaces();
      save();
    });
    surfaceRows.append(row);
  }
}

document.getElementById("settingsBtn").addEventListener("click", (e) => {
  e.currentTarget.blur();
  renderSurfaceRows();
  settingsDlg.showModal();
});
document.getElementById("settingsClose").addEventListener("click", () => settingsDlg.close());
settingsDlg.addEventListener("click", (e) => { if (e.target === settingsDlg) settingsDlg.close(); });
settingsDlg.querySelectorAll("[data-all]").forEach((el) => {
  el.addEventListener("click", () => {
    const on = el.dataset.all === "transparent";
    for (const key of Object.keys(state.transparent)) state.transparent[key] = on;
    updateSurfaces();
    renderSurfaceRows();
    save();
  });
});

// ---------------------------------------------------------------------
// Place rig dialog
// ---------------------------------------------------------------------

export const rigDlg = /** @type {HTMLDialogElement} */ (document.getElementById("rigDlg"));
const rigInputs = {
  type: document.getElementById("rigType"),
  size: document.getElementById("rigSize"),
  count: document.getElementById("rigCount"),
  tilt: document.getElementById("rigTilt"),
  yaw: document.getElementById("rigYaw"),
  consoleType: document.getElementById("rigConsoleType"),
};
const rigRoomEl = document.getElementById("rigRoom");

document.getElementById("rigBtn").addEventListener("click", (e) => {
  e.currentTarget.blur();
  if (ui.placing) setPlacing(false);
  const room = MAX_FIXTURES - state.fixtures.length;
  rigInputs.count.max = String(Math.max(2, room));
  rigRoomEl.textContent = `${room} of ${MAX_FIXTURES} fixture slots free.`;
  fillConsoleTypes(rigInputs.consoleType);
  rigLib.sync();
  fillUniverses(sd("rigUniverse"));
  rigDlg.showModal();
});
document.getElementById("rigClose").addEventListener("click", () => rigDlg.close());
rigDlg.addEventListener("click", (e) => { if (e.target === rigDlg) rigDlg.close(); });
document.getElementById("rigPlace").addEventListener("click", () => {
  const cfg = normalizeRig({
    type: rigInputs.type.value,
    size: rigInputs.size.value,
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
  let fixture = null;
  if (rigInputs.consoleType.value === LIBRARY) {
    fixture = rigLib.profile();
    if (!fixture) { rigRoomEl.textContent = "Pick a fixture and mode first."; return; }
    consoleType = { mount: fixture.mount, color: fixture.color };
  }
  rememberConsoleType(rigInputs.consoleType.value);
  setPlacing(true, {
    type: cfg.type, size: cfg.size, count: cfg.count, tilt: cfg.tilt, yaw: cfg.yaw,
    consoleType, fixture, universe: readUniverse(sd("rigUniverse")),
  });
});

/** Switching type relabels the size and loads that type's defaults and help. */
function syncRigDialogType() {
  const t = RIG_TYPES[rigInputs.type.value];
  document.getElementById("rigSizeLabel").textContent = `${t.sizeLabel} (m)`;
  document.getElementById("rigHelp").textContent = `${t.name}: ${t.help}`;
  rigInputs.size.value = String(t.defaults.size);
  rigInputs.count.value = String(t.defaults.count);
  rigInputs.tilt.value = String(t.defaults.tilt);
  rigInputs.yaw.value = String(t.defaults.yaw);
}
rigInputs.type.innerHTML = Object.entries(RIG_TYPES).map(([k, t]) => `<option value="${k}">${t.name}</option>`).join("");
rigInputs.type.addEventListener("change", syncRigDialogType);
syncRigDialogType();

// Place fixture: pick its console type first.
export const placeDlg = /** @type {HTMLDialogElement} */ (document.getElementById("placeDlg"));
const placeTypeEl = document.getElementById("placeType");
/** Console type for the fixture being placed (null = stage only). */
export let placeType = null;
/** Real fixture for the fixture being placed (null = generic). */
export let placeFixture = null;
/** Universe the fixture being placed registers in (null = first with room). */
export let placeUniverse = null;
const placeLib = libraryPickerFor(placeTypeEl, document.getElementById("placeLib"));

export function togglePlaceFixture() {
  if (ui.placing) { setPlacing(false); return; }
  fillConsoleTypes(placeTypeEl);
  placeLib.sync();
  fillUniverses(sd("placeUniverse"));
  placeDlg.showModal();
}

document.getElementById("placeForm").addEventListener("submit", (e) => {
  e.preventDefault();
  placeFixture = null;
  if (placeTypeEl.value === LIBRARY) {
    const p = placeLib.profile();
    if (!p) { document.getElementById("placeLibMsg").textContent = "Pick a fixture and mode first."; return; }
    placeFixture = p;
    placeType = { mount: p.mount, color: p.color };
  } else {
    placeType = consoleTypeFromKey(placeTypeEl.value);
  }
  rememberConsoleType(placeTypeEl.value);
  placeUniverse = readUniverse(sd("placeUniverse"));
  document.getElementById("placeLibMsg").textContent = "";
  placeDlg.close();
  setPlacing(true);
});
document.getElementById("placeClose").addEventListener("click", () => placeDlg.close());
const rigLib = libraryPickerFor(rigInputs.consoleType, document.getElementById("rigLib"));
placeDlg.addEventListener("click", (e) => { if (e.target === placeDlg) placeDlg.close(); });

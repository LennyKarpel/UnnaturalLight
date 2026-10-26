// Keyboard: shortcuts and the key strip's buttons.
import { setZeroHere, setDmx, setColorHex, homeFixture } from "./stage-model.js";
import { installColorPicker } from "../shared/color-picker.js";
import { activePane } from "../shared/panes.js";
import { state, selectedFixtures, ui } from "./state.js";
import { NUDGE_KEYS, canNudge } from "./sidebar.js";
import {
  startFlash,
  stopFlash,
  changed,
  select,
  setPlacing,
  setAiming,
  ctxMenu,
  closeContextMenu,
  deleteSelected,
  undoDelete,
} from "./actions.js";
import { settingsDlg, rigDlg, placeDlg, togglePlaceFixture } from "./dialogs.js";

// ---------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------

// Keys bar color picker: sets the color of every selected fixture (like
// the inspector's Color); shows the first selected one's color.
const keysColor = /** @type {HTMLInputElement} */ (document.getElementById("keysColor"));
keysColor.addEventListener("input", () => {
  const sel = selectedFixtures();
  if (!sel.length) return;
  for (const fixture of sel) setColorHex(fixture, keysColor.value);
  changed();
});
keysColor.addEventListener("change", () => keysColor.blur());

// Every color input (keys bar, inspector) opens the shared color picker.
installColorPicker({ scope: document.getElementById("stagePane"), usedLabel: "On stage", usedColors: () => state.fixtures.map((i) => i.color) });

// Keys bar under the 3D view: each key is a button that does what the key
// does (it sends the same key press). Hold to repeat; ⇧-click for steps of 10.
document.querySelectorAll(".keys [data-key]").forEach((btn) => {
  const press = (shift) => window.dispatchEvent(new KeyboardEvent("keydown", {
    key: btn.dataset.key, code: btn.dataset.code, shiftKey: shift, metaKey: btn.hasAttribute("data-meta"), bubbles: true,
  }));
  let delay = 0;
  let repeat = 0;
  const stop = () => { clearTimeout(delay); clearInterval(repeat); btn.classList.remove("held"); };
  btn.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); // keep keyboard focus where it was
    press(e.shiftKey);
    if (!btn.hasAttribute("data-repeat") || btn.disabled) return;
    btn.classList.add("held");
    // Stops at 0 / 255: the button is disabled then, and gets no pointerup.
    const again = () => { if (btn.disabled) stop(); else press(e.shiftKey); };
    delay = setTimeout(() => { repeat = setInterval(again, 60); }, 350);
  });
  for (const type of ["pointerup", "pointerleave", "pointercancel"]) btn.addEventListener(type, stop);
  // Keyboard activation (Tab to it, Enter / Space): one press.
  btn.addEventListener("click", (e) => { if (e.detail === 0) press(e.shiftKey); });
});

window.addEventListener("keydown", (e) => {
  // Keys are the stage's only while you're working on it (not in the console).
  if (activePane() !== "stage") return;
  const t = e.target;
  const typing = t instanceof HTMLElement && (t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && t.type !== "range" && t.type !== "color"));
  if (typing) {
    if (e.key === "Escape" || e.key === "Enter") t.blur();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ" && !e.shiftKey && !settingsDlg.open && !rigDlg.open && !placeDlg.open) {
    e.preventDefault();
    undoDelete();
    return;
  }
  if (e.metaKey || e.ctrlKey) return;
  if (settingsDlg.open || rigDlg.open || placeDlg.open) return;

  if (e.key === "Escape") {
    if (!ctxMenu.hidden) closeContextMenu();
    else if (ui.placing) setPlacing(false);
    else if (ui.aiming) setAiming(false);
    else select(null);
    return;
  }
  if (e.code === "KeyA") { setAiming(!ui.aiming); return; }
  // Mac "delete" is Backspace; forward-delete is Delete. ⌘Z undoes it.
  if (e.key === "Backspace" || e.key === "Delete") {
    if (state.selected.length) { e.preventDefault(); deleteSelected(); }
    return;
  }
  if (e.key === "p" || e.key === "P") { togglePlaceFixture(); return; }
  if (e.code === "KeyF") { if (!e.repeat) startFlash(); e.preventDefault(); return; }
  if (e.key === "Tab" && state.fixtures.length) {
    e.preventDefault();
    const cur = state.fixtures.findIndex((i) => i.id === state.selected[state.selected.length - 1]);
    const n = state.fixtures.length;
    const next = state.fixtures[(cur + (e.shiftKey ? -1 : 1) + n) % n];
    select(next.id);
    return;
  }

  const sel = selectedFixtures();
  if (!sel.length) return;

  // Every value is 0–255: one key press = 1 step, ⇧ = 10.
  const step = e.shiftKey ? 10 : 1;
  // e.code is layout-independent; keeps ⇧/⌥ from changing the key we see.
  const nudge = NUDGE_KEYS[e.code];
  if (nudge) {
    e.preventDefault();
    if (!canNudge(sel, nudge)) return; // already at 0 / 255
    const [attr, dir] = nudge;
    sel.forEach((i) => setDmx(i, attr, i.dmx[attr] + dir * step));
    changed();
    return;
  }
  let handled = true;
  switch (e.code) {
    case "KeyH": sel.forEach(homeFixture); break;
    case "KeyZ": sel.filter((i) => !i.rigId).forEach(setZeroHere); break;
    default: handled = false;
  }
  if (handled) { e.preventDefault(); changed(); }
});

window.addEventListener("keyup", (e) => { if (e.code === "KeyF") stopFlash(); });
// Leaving the stage (clicking in the console) ends a held flash.
window.addEventListener("pointerdown", () => { if (activePane() !== "stage") stopFlash(); });
window.addEventListener("blur", stopFlash);

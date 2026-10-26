// The stage's side panel layout: Plan, Fixtures and Inspector, stacked.
// Each part collapses from the arrow beside its heading, the dividers
// between them resize the plan and the fixture list, and the one on its
// left edge the panel's width (styles: stage.css, "Side panel"). All are
// remembered in this browser.

import { clamp } from "../shared/numbers.js";

// Plan, Fixtures and Inspector collapse from the arrow beside their heading;
// which ones are collapsed is remembered in this browser.
const COLLAPSED_KEY = "unnaturallight.stage.collapsed";
const CHEVRON = '<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const collapsed = new Set((() => {
  try { return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]"); } catch { return []; }
})());

/** Show a part collapsed or not, and set its arrow (also after the inspector is redrawn). */
export function applyCollapsed(section) {
  const isCollapsed = collapsed.has(section.id);
  section.classList.toggle("is-collapsed", isCollapsed);
  const btn = section.querySelector(":scope > h2 .collapse-btn");
  if (btn) {
    btn.innerHTML = CHEVRON;
    btn.setAttribute("aria-expanded", String(!isCollapsed));
    btn.title = isCollapsed ? "Expand" : "Collapse";
  }
}

/** The stage's side panel (the console has asides of its own in the same page). */
const asideEl = document.querySelector("#stagePane aside");

for (const section of asideEl.querySelectorAll(":scope > section")) applyCollapsed(section);

asideEl.addEventListener("click", (e) => {
  const btn = e.target instanceof Element ? e.target.closest(".collapse-btn") : null;
  if (!btn) return;
  const section = btn.closest("section");
  if (collapsed.has(section.id)) collapsed.delete(section.id);
  else collapsed.add(section.id);
  try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed])); } catch { /* storage unavailable */ }
  applyCollapsed(section);
  btn.blur();
});

// Dividers: the one on the panel's left edge sets its width; between the
// parts, the one under Plan sets the plan's size, the one under Fixtures the
// list's height (the inspector gets the rest). Sizes are remembered in this
// browser; double-click a divider to reset it.
const PANEL_SIZES_KEY = "unnaturallight.stage.panelSizes";
const panelSizes = (() => {
  try { return JSON.parse(localStorage.getItem(PANEL_SIZES_KEY) ?? "{}") ?? {}; } catch { return {}; }
})();
const SIZE_VARS = { side: "--side-width", plan: "--plan-size", fixtures: "--fixtures-height" };
const MIN_SIZE = { side: 280, plan: 120, fixtures: 80 };
/** Room the 3D view keeps beside the panel. */
const MIN_VIEW_WIDTH = 320;
/** The stage's layout grid (the panel's width is one of its columns). */
const appEl = asideEl.closest(".app");

function applyPanelSize(key) {
  const v = panelSizes[key];
  if (typeof v === "number") appEl.style.setProperty(SIZE_VARS[key], `${v}px`);
  else appEl.style.removeProperty(SIZE_VARS[key]);
}

function savePanelSizes() {
  try { localStorage.setItem(PANEL_SIZES_KEY, JSON.stringify(panelSizes)); } catch { /* storage unavailable */ }
}

for (const key of Object.keys(SIZE_VARS)) applyPanelSize(key);

/** Where a drag starts from, and how far it may go. */
function dragRange(key, divider) {
  if (key === "side") {
    const start = asideEl.getBoundingClientRect().width;
    return { start, max: Math.max(MIN_SIZE.side, appEl.getBoundingClientRect().width - MIN_VIEW_WIDTH) };
  }
  // What the divider sizes: the plan canvas, or the Fixtures section.
  const start = document.getElementById(key === "plan" ? "plan" : "fixtures").getBoundingClientRect().height;
  // Leave the inspector (or what's below) at least a heading's worth of room.
  return { start, max: start + Math.max(0, asideEl.getBoundingClientRect().bottom - divider.getBoundingClientRect().bottom - 60) };
}

for (const divider of asideEl.querySelectorAll("[data-resize]")) {
  const key = divider.dataset.resize;
  const sideways = key === "side";
  const bodyClass = sideways ? "resizing-panel-width" : "resizing-panel";
  divider.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    divider.classList.add("is-dragging");
    document.body.classList.add(bodyClass);
    const from = sideways ? e.clientX : e.clientY;
    const { start, max } = dragRange(key, divider);
    const onMove = (ev) => {
      // The panel is on the right, so dragging its edge left widens it.
      const moved = sideways ? from - ev.clientX : ev.clientY - from;
      panelSizes[key] = Math.round(clamp(start + moved, MIN_SIZE[key], max));
      applyPanelSize(key);
    };
    const onUp = () => {
      divider.removeEventListener("pointermove", onMove);
      divider.removeEventListener("pointerup", onUp);
      divider.removeEventListener("pointercancel", onUp);
      divider.classList.remove("is-dragging");
      document.body.classList.remove(bodyClass);
      savePanelSizes();
    };
    divider.addEventListener("pointermove", onMove);
    divider.addEventListener("pointerup", onUp);
    divider.addEventListener("pointercancel", onUp);
  });
  divider.addEventListener("dblclick", () => {
    delete panelSizes[key];
    applyPanelSize(key);
    savePanelSizes();
  });
}

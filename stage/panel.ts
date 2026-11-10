// The stage's side panel layout: Plan, Fixtures and Inspector, stacked.
// Each part collapses from the arrow beside its heading, the dividers
// between them resize the plan and the fixture list, and the one on its
// left edge the panel's width (styles: stage.css, "Side panel"). All are
// remembered in this browser.

import { clamp } from "../shared/numbers.ts";
import { $, elById, must } from "../shared/query.ts";
import { isOneOf, isRecord } from "../shared/guards.ts";
import { readStoredJson, storeJson } from "../shared/storage.ts";

// Plan, Fixtures and Inspector collapse from the arrow beside their heading;
// which ones are collapsed is remembered in this browser.
const COLLAPSED_KEY = "unnaturallight.stage.collapsed";
const CHEVRON = '<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const savedCollapsed = readStoredJson(COLLAPSED_KEY);
const collapsed = new Set(Array.isArray(savedCollapsed) ? savedCollapsed.filter((id) => typeof id === "string") : []);

/** Show a part collapsed or not, and set its arrow (also after the inspector is redrawn). */
export function applyCollapsed(section: HTMLElement) {
  const isCollapsed = collapsed.has(section.id);
  section.classList.toggle("is-collapsed", isCollapsed);
  const btn = section.querySelector<HTMLElement>(":scope > h2 .collapse-btn");
  if (btn) {
    btn.innerHTML = CHEVRON;
    btn.setAttribute("aria-expanded", String(!isCollapsed));
    btn.title = isCollapsed ? "Expand" : "Collapse";
  }
}

/** The stage's side panel (the console has asides of its own in the same page). */
const asideEl = $(document, "#stagePane aside");

for (const section of asideEl.querySelectorAll<HTMLElement>(":scope > section")) applyCollapsed(section);

asideEl.addEventListener("click", (e) => {
  const btn = e.target instanceof Element ? e.target.closest<HTMLElement>(".collapse-btn") : null;
  if (!btn) return;
  const section = btn.closest("section");
  if (!section) return;
  if (collapsed.has(section.id)) collapsed.delete(section.id);
  else collapsed.add(section.id);
  storeJson(COLLAPSED_KEY, [...collapsed]);
  applyCollapsed(section);
  btn.blur();
});

// Dividers: the one on the panel's left edge sets its width; between the
// parts, the one under Plan sets the plan's size, the one under Fixtures the
// list's height (the inspector gets the rest). Sizes are remembered in this
// browser; double-click a divider to reset it.
const PANEL_SIZES_KEY = "unnaturallight.stage.panelSizes";
const PANEL_KEYS = ["side", "plan", "fixtures"] as const;
type PanelKey = (typeof PANEL_KEYS)[number];
const panelSizes: Partial<Record<PanelKey, number>> = {};
const savedSizes = readStoredJson(PANEL_SIZES_KEY);
if (isRecord(savedSizes)) {
  for (const k of PANEL_KEYS) {
    const v = savedSizes[k];
    if (typeof v === "number") panelSizes[k] = v;
  }
}
const SIZE_VARS: Record<PanelKey, string> = { side: "--side-width", plan: "--plan-size", fixtures: "--fixtures-height" };
const MIN_SIZE: Record<PanelKey, number> = { side: 280, plan: 120, fixtures: 80 };
/** Room the 3D view keeps beside the panel. */
const MIN_VIEW_WIDTH = 320;
/** The stage's layout grid (the panel's width is one of its columns). */
const appEl = must(asideEl.closest<HTMLElement>(".app"), ".app");

function applyPanelSize(key: PanelKey) {
  const v = panelSizes[key];
  if (typeof v === "number") appEl.style.setProperty(SIZE_VARS[key], `${v}px`);
  else appEl.style.removeProperty(SIZE_VARS[key]);
}

const savePanelSizes = () => storeJson(PANEL_SIZES_KEY, panelSizes);

for (const key of PANEL_KEYS) applyPanelSize(key);

/** Where a drag starts from, and how far it may go. */
function dragRange(key: PanelKey, divider: Element) {
  if (key === "side") {
    const start = asideEl.getBoundingClientRect().width;
    return { start, max: Math.max(MIN_SIZE.side, appEl.getBoundingClientRect().width - MIN_VIEW_WIDTH) };
  }
  // What the divider sizes: the plan canvas, or the Fixtures section.
  const start = elById(key === "plan" ? "plan" : "fixtures").getBoundingClientRect().height;
  // Leave the inspector (or what's below) at least a heading's worth of room.
  return { start, max: start + Math.max(0, asideEl.getBoundingClientRect().bottom - divider.getBoundingClientRect().bottom - 60) };
}

for (const divider of asideEl.querySelectorAll<HTMLElement>("[data-resize]")) {
  const name = divider.dataset.resize;
  if (!isOneOf(PANEL_KEYS, name)) continue;
  const key: PanelKey = name;
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
    const onMove = (ev: PointerEvent) => {
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

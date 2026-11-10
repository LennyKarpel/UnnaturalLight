// The console's elements (its pane in ../index.html).

import { elById } from "../shared/query.ts";
import { clamp } from "../shared/numbers.ts";
import { button } from "../shared/html.ts";

/**
 * Place an open (unhidden) popup menu at (left, top), keeping it inside the
 * window: it moves left at the right edge, and opens above `aboveY` (the top
 * of what opened it) when it would run off the bottom. Its real size is used.
 */
export function placePopup(el: HTMLElement, left: number, top: number, aboveY: number) {
  // Measure at the window's corner, so a spot near the edge from last time
  // doesn't squeeze it.
  el.style.left = "0px";
  el.style.top = "0px";
  const { offsetWidth: width, offsetHeight: height } = el;
  left = clamp(left, 8, window.innerWidth - width - 8);
  if (top + height > window.innerHeight - 8) top = Math.max(8, aboveY - height - 6);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

let closeOpen: (() => void) | null = null;

/** Close the console's open popup menu, if any (only one is open at a time). */
export const closePopup = () => closeOpen?.();

/** Where a popup opens: under its anchor (lined up with its left edge, or its right), or at a point such as a right-click. */
export type PopupPlace = { alignRight?: boolean; x?: number; y?: number };

/**
 * Show `popup` by `anchor` until an item calls `finish(value)`, or it's
 * dismissed (Esc, a press outside it and its anchor, another popup opening),
 * which resolves with `dismissed`.
 * - fill: builds the items before it's shown; may return what undoes its setup
 * - shown: runs once it's shown and placed (e.g. scroll to the current item)
 * - ariaExpanded: the anchor is a button that says whether its menu is open
 */
export function openPopup<T, D>(popup: HTMLElement, anchor: HTMLElement, opts: {
  dismissed: D;
  fill: (finish: (value: T | D) => void) => void | (() => void);
  shown?: () => void;
  place?: PopupPlace;
  ariaExpanded?: boolean;
}): Promise<T | D> {
  const { dismissed, fill, shown, place = {}, ariaExpanded = false } = opts;
  closePopup();
  return new Promise<T | D>((resolve) => {
    let settled = false;
    let undoFill: void | (() => void);
    const finish = (value: T | D) => {
      if (settled) return;
      settled = true;
      if (closeOpen === dismiss) closeOpen = null;
      popup.hidden = true;
      if (ariaExpanded) anchor.setAttribute("aria-expanded", "false");
      undoFill?.();
      document.removeEventListener("pointerdown", onDocPointer, true);
      document.removeEventListener("keydown", onDocKeydown, true);
      resolve(value);
    };
    const dismiss = () => finish(dismissed);
    const onDocPointer = (event: PointerEvent) => {
      const t = event.target;
      if (!(t instanceof Node) || popup.contains(t) || anchor.contains(t)) return;
      dismiss();
    };
    const onDocKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };

    closeOpen = dismiss;
    undoFill = fill(finish);
    popup.hidden = false;
    if (ariaExpanded) anchor.setAttribute("aria-expanded", "true");
    const r = anchor.getBoundingClientRect();
    const left = place.x ?? (place.alignRight ? r.right - popup.offsetWidth : r.left);
    placePopup(popup, left, place.y ?? r.bottom + 6, place.y ?? r.top);
    shown?.();
    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onDocKeydown, true);
  });
}

/** A popup menu item; `pick` runs on click (which goes no further). */
export function menuItem(label: string, pick: () => void, { current = false, danger = false, disabled = false } = {}) {
  const item = button("menu-item", label);
  if (current) item.classList.add("is-current");
  if (danger) item.classList.add("danger");
  item.setAttribute("role", "menuitem");
  item.disabled = disabled;
  item.addEventListener("click", (event) => {
    event.stopPropagation();
    pick();
  });
  return item;
}

/** Scroll a menu list to its current item. */
export const scrollToCurrent = (list: HTMLElement) => list.querySelector(".is-current")?.scrollIntoView({ block: "nearest" });

/**
 * Reordering by drag: where the dragged row would land among `rows` — the
 * gap nearest the pointer (0 = before the first row, rows.length = after the
 * last) — or null when it would stay where it is.
 */
export function dropSlot(rows: HTMLElement[], dragged: HTMLElement | undefined, clientY: number) {
  const from = dragged ? rows.indexOf(dragged) : -1;
  let slot = rows.findIndex((row) => {
    const rect = row.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2;
  });
  if (slot < 0) slot = rows.length;
  if (from < 0 || slot === from || slot === from + 1) return null;
  return slot;
}

/** Show the drop line (styles.css) at a slot from dropSlot, or none for null. */
export function showDropLine(rows: HTMLElement[], slot: number | null) {
  for (const row of rows) row.classList.remove("is-drop-before", "is-drop-after");
  if (slot == null) return;
  if (slot < rows.length) rows[slot].classList.add("is-drop-before");
  else rows[rows.length - 1].classList.add("is-drop-after");
}

/** Within this many px of a list's top / bottom, a drag scrolls it… */
const DRAG_SCROLL_EDGE = 56;
/** …by up to this many px a frame (the most at / past the edge). */
const DRAG_SCROLL_MAX = 24;

/** A drag that's scrolling its list: `track` the pointer (from the list's own dragover), `stop` at the end. */
export type DragScroll = { track: (clientY: number) => void; stop: () => void };

/**
 * While a row is dragged: scroll `scroller` when the pointer is near or past
 * its top or bottom, keep the drag alive over the rest of the page, and mark
 * `tab` with `cls`. `active` says whether the drag is still on.
 */
export function startDragScroll(scroller: HTMLElement, tab: HTMLElement, cls: string, active: () => boolean, clientY?: number): DragScroll {
  let y: number | null = clientY ?? null;
  let raf: number | null = null;
  const tick = () => {
    raf = null;
    if (!active()) return;
    if (y != null) {
      const rect = scroller.getBoundingClientRect();
      const ramp = (distance: number) => Math.ceil(Math.max(2, Math.min(1, distance / DRAG_SCROLL_EDGE) * DRAG_SCROLL_MAX));
      let dy = 0;
      if (y < rect.top) dy = -DRAG_SCROLL_MAX;
      else if (y > rect.bottom) dy = DRAG_SCROLL_MAX;
      else if (y < rect.top + DRAG_SCROLL_EDGE) dy = -ramp(rect.top + DRAG_SCROLL_EDGE - y);
      else if (y > rect.bottom - DRAG_SCROLL_EDGE) dy = ramp(y - (rect.bottom - DRAG_SCROLL_EDGE));
      if (dy) scroller.scrollTop = clamp(scroller.scrollTop + dy, 0, scroller.scrollHeight - scroller.clientHeight);
    }
    // Keep the loop alive for the whole drag: early frames often run before any dragover.
    raf = requestAnimationFrame(tick);
  };
  // Over page chrome above / below the list too, so the drag stays alive there.
  const onDragOver = (event: DragEvent) => {
    if (!active()) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    y = event.clientY;
  };
  document.addEventListener("dragover", onDragOver, true);
  raf = requestAnimationFrame(tick);
  tab.classList.add(cls);
  return {
    track: (clientY) => { y = clientY; },
    stop: () => {
      document.removeEventListener("dragover", onDragOver, true);
      if (raf != null) cancelAnimationFrame(raf);
      raf = null;
      y = null;
      tab.classList.remove(cls);
    },
  };
}

/**
 * A row dragged by its handle: the drag is armed by a press on `handle` (so
 * text and controls in the row still work) but `row` is what's draggable
 * (more reliable in Chromium). `start` runs on a real drag start, `end` when
 * it ends; meanwhile the row has `is-dragging` and the drag carries `id`.
 */
export function wireRowDrag(row: HTMLElement, handle: HTMLElement, id: string, start: (event: DragEvent) => void, end: () => void) {
  handle.addEventListener("pointerdown", (event) => {
    if (event.button != null && event.button !== 0) return;
    row.dataset.dragArmed = "1";
    const onUp = () => {
      window.removeEventListener("pointerup", onUp, true);
      // Deferred so dragstart can still see the armed flag.
      requestAnimationFrame(() => {
        if (!row.classList.contains("is-dragging")) delete row.dataset.dragArmed;
      });
    };
    window.addEventListener("pointerup", onUp, true);
  });
  row.draggable = true;
  row.addEventListener("dragstart", (event) => {
    if (row.dataset.dragArmed !== "1") {
      event.preventDefault();
      return;
    }
    delete row.dataset.dragArmed;
    start(event);
    row.classList.add("is-dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", id);
    }
  });
  row.addEventListener("dragend", () => {
    delete row.dataset.dragArmed;
    row.classList.remove("is-dragging");
    end();
  });
}

export const cuesScroll = elById("cuesScroll");
export const cuesEl = elById("cues");
export const cuesHScroll = elById("cuesHScroll");
export const liveFadersEl = elById("liveFaders");
export const channelLevelsEl = elById("channelLevels");
export const selectedGroupFadersEl = elById("selectedGroupFaders");
export let currentCueTitle = elById("currentCueTitle");
export const cuePicker = elById("cuePicker");
export const cuePickerList = elById("cuePickerList");
export const channelsCueMenuBtn = elById("channelsCueMenuBtn", HTMLButtonElement);
export const channelsCueMenu = elById("channelsCueMenu");
export const channelsCueMenuList = elById("channelsCueMenuList");
export const actionMenu = elById("actionMenu");
export const actionMenuList = elById("actionMenuList");
export const faderNameMenu = elById("faderNameMenu");
export const faderNameMenuList = elById("faderNameMenuList");
export const patchTableEl = elById("patchTable");
export const patchConflictsEl = elById("patchConflicts");
export const masterInput = elById("master", HTMLInputElement);
export const masterValue = elById("masterValue", HTMLOutputElement);
export const fromSubInput = elById("fromSub", HTMLInputElement);
export const fromSubValue = elById("fromSubValue", HTMLOutputElement);
export const fromSubLabel = elById("fromSubLabel");
export const toSubInput = elById("toSub", HTMLInputElement);
export const toSubValue = elById("toSubValue", HTMLOutputElement);
export const toSubLabel = elById("toSubLabel");
export const crossfader = elById("crossfader", HTMLInputElement);
export const crossValue = elById("crossValue", HTMLOutputElement);
export const crossFromLabel = elById("crossFromLabel");
export const crossToLabel = elById("crossToLabel");
export const goBtn = elById("goBtn", HTMLButtonElement);
export const prevCueBtn = elById("prevCueBtn", HTMLButtonElement);
export const nextCueBtn = elById("nextCueBtn", HTMLButtonElement);
export const goNextFade = elById("goNextFade");
export const fadePauseBtn = elById("fadePauseBtn", HTMLButtonElement);
export const addCueBtn = elById("addCueBtn", HTMLButtonElement);
export const addSongBtn = elById("addSongBtn", HTMLButtonElement);
export const songScroll = elById("songScroll");
export const songList = elById("songList");
export const songEmpty = elById("songEmpty");
export const activeSongLabel = elById("activeSongLabel");
export const activeSetLabel = elById("activeSetLabel");
export const prevSongBtn = elById("prevSongBtn", HTMLButtonElement);
export const nextSongBtn = elById("nextSongBtn", HTMLButtonElement);
export const setStrip = elById("setStrip");
export const setSelect = elById("setSelect", HTMLSelectElement);
export const setMenuBtn = elById("setMenuBtn", HTMLButtonElement);
export const runSetBtn = elById("runSetBtn", HTMLButtonElement);
export const setSongSearch = elById("setSongSearch", HTMLInputElement);
export const setSourceScroll = elById("setSourceScroll");
export const setSourceList = elById("setSourceList");
export const setEntryScroll = elById("setEntryScroll");
export const setEntryList = elById("setEntryList");
export const setEntryEmpty = elById("setEntryEmpty");
export const setEntryCount = elById("setEntryCount");
export const tabShow = elById("tab-show");
export const tabSet = elById("tab-set");
export const identityBtn = elById("identityBtn", HTMLButtonElement);
export const clearPatchBtn = elById("clearPatchBtn", HTMLButtonElement);
export const channelMenu = elById("channelMenu");
export const channelMenuFilter = elById("channelMenuFilter", HTMLInputElement);
export const channelMenuList = elById("channelMenuList");
export const channelMenuSub = elById("channelMenuSub");
export const channelMenuSubList = elById("channelMenuSubList");
export const channelMenuSubLabel = elById("channelMenuSubLabel");
export const tabRun = elById("tab-run");
export const tabChannels = elById("tab-channels");
export const tabFixtures = elById("tab-fixtures");
export const tabPatch = elById("tab-patch");
export const fixtureForm = elById("fixtureForm", HTMLFormElement);
export const fixtureNameInput = elById("fixtureNameInput", HTMLInputElement);
export const fixtureStartPicker = elById("fixtureStartPicker");
export const fixtureCountPicker = elById("fixtureCountPicker");
export const countMenu = elById("countMenu");
export const countMenuList = elById("countMenuList");
export const fixtureQtyPicker = elById("fixtureQtyPicker");
export const fixtureConflicts = elById("fixtureConflicts");
export const fixtureScroll = elById("fixtureScroll");
export const fixtureEmpty = elById("fixtureEmpty");
export const fixtureList = elById("fixtureList");
export const addFixtureBtn = elById("addFixtureBtn", HTMLButtonElement);
export const addFixtureGroupBtn = elById("addFixtureGroupBtn", HTMLButtonElement);
export const fixtureFormGroupPickerHost = elById(
  "fixtureFormGroupPicker",
  HTMLElement,
);
export const fixtureGroupMenu = elById("fixtureGroupMenu");
export const fixtureGroupMenuList = elById("fixtureGroupMenuList");
export const navEl = elById("nav");
export const tabs: Record<string, HTMLElement> = {
  show: tabShow,
  set: tabSet,
  run: tabRun,
  channels: tabChannels,
  fixtures: tabFixtures,
  patch: tabPatch,
};

export function getNavLinks(): HTMLElement[] {
  return [...navEl.querySelectorAll<HTMLElement>(".nav-link")];
}

/** Channels tab: which universe the meters show. */
export const meterUniverseSelect = document.createElement("select");

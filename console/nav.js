// Tabs: the show name, tab order (drag to reorder) and routing.
import { DEFAULT_NAV_ORDER, normalizeNavOrder, normalizeShowName } from "./show.js";
import { navEl, tabs, getNavLinks } from "./dom.js";
import { notifyHeader, persistSession, state } from "./state.js";
import { abortInlineEdits } from "./faders.js";
import { refreshChannelRow, renderSelectedGroup } from "./live.js";
import { renderShowTab } from "./show-tab.js";
import { renderSetTab } from "./set-tab.js";
import { renderPatchTable } from "./patch-tab.js";
import { renderFixtures } from "./fixtures-tab.js";

export function syncShowNameUi() {
  state.showName = normalizeShowName(state.showName);
  notifyHeader();
}

export function applyShowName(name) {
  const next = normalizeShowName(name);
  if (!next || next === state.showName) return false;
  syncShowNameUi();
  persistSession();
  return true;
}

function readNavOrderFromDom() {
  return normalizeNavOrder(
    getNavLinks().map((link) => link.dataset.tab).filter(Boolean),
  );
}

export function applyNavOrder(order = state.navOrder) {
  state.navOrder = normalizeNavOrder(order);
  const byTab = new Map(
    getNavLinks().map((link) => [link.dataset.tab, link]),
  );
  for (const tab of state.navOrder) {
    const link = byTab.get(tab);
    if (link) navEl.append(link);
  }
}

/** @param {HTMLElement} link @param {DragEvent} event */
function navDropAfter(link, event) {
  const rect = link.getBoundingClientRect();
  return event.clientX > rect.left + rect.width / 2;
}

function clearNavDropMarks() {
  for (const item of getNavLinks()) {
    item.classList.remove("is-drop-before", "is-drop-after");
  }
}

/**
 * @param {string} from
 * @param {string} to
 * @param {boolean} after
 */
function moveNavTab(from, to, after) {
  if (!from || !to || from === to) return false;
  const order = readNavOrderFromDom();
  const fromIndex = order.indexOf(from);
  const toIndex = order.indexOf(to);
  if (fromIndex < 0 || toIndex < 0) return false;

  order.splice(fromIndex, 1);
  let insertAt = order.indexOf(to);
  if (insertAt < 0) return false;
  if (after) insertAt += 1;
  order.splice(insertAt, 0, from);
  applyNavOrder(order);
  return true;
}

export function wireNavReorder() {
  /** @type {string | null} */
  let dragTab = null;
  let didReorder = false;

  for (const link of getNavLinks()) {
    link.addEventListener("dragstart", (event) => {
      dragTab = link.dataset.tab ?? null;
      didReorder = false;
      if (!dragTab || !event.dataTransfer) return;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", dragTab);
      link.classList.add("is-dragging");
    });

    link.addEventListener("dragend", () => {
      link.classList.remove("is-dragging");
      clearNavDropMarks();
      dragTab = null;
      window.setTimeout(() => {
        didReorder = false;
      }, 50);
    });

    link.addEventListener("dragover", (event) => {
      if (!dragTab || dragTab === link.dataset.tab) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      const after = navDropAfter(link, event);
      for (const item of getNavLinks()) {
        item.classList.toggle(
          "is-drop-before",
          item === link && !after,
        );
        item.classList.toggle(
          "is-drop-after",
          item === link && after,
        );
      }
    });

    link.addEventListener("dragleave", () => {
      link.classList.remove("is-drop-before", "is-drop-after");
    });

    link.addEventListener("drop", (event) => {
      event.preventDefault();
      const from = dragTab ?? event.dataTransfer?.getData("text/plain");
      const to = link.dataset.tab;
      const after = navDropAfter(link, event);
      clearNavDropMarks();
      if (!from || !to) return;
      if (!moveNavTab(from, to, after)) return;
      didReorder = true;
      persistSession();
    });

    link.addEventListener("click", (event) => {
      if (!didReorder) return;
      event.preventDefault();
    });
  }
}

// The open tab is remembered in this browser, so a refresh comes back to it
// (the page around the console reloads it without its #tab).
const TAB_KEY = "unnaturallight.console.tab";

export function showTab(name) {
  const tab = tabs[name] ? name : "run";
  abortInlineEdits();
  try { localStorage.setItem(TAB_KEY, tab); } catch { /* storage unavailable */ }

  for (const [key, el] of Object.entries(tabs)) {
    const active = key === tab;
    el.hidden = !active;
    el.classList.toggle("is-active", active);
  }

  for (const link of getNavLinks()) {
    link.classList.toggle("is-active", link.dataset.tab === tab);
  }

  if (tab === "patch") renderPatchTable();
  if (tab === "fixtures") renderFixtures();
  if (tab === "show") renderShowTab();
  if (tab === "set") renderSetTab();
  if (tab === "channels") {
    refreshChannelRow();
    renderSelectedGroup();
  }
}

/** Show the tab in the address (#show, #set, #patch, …), else the one last open. */
export function routeFromHash() {
  let tab = location.hash.replace("#", "");
  if (!DEFAULT_NAV_ORDER.includes(tab)) {
    try { tab = localStorage.getItem(TAB_KEY) ?? ""; } catch { tab = ""; }
    if (!DEFAULT_NAV_ORDER.includes(tab)) tab = "run";
    history.replaceState(null, "", `#${tab}`);
  }
  showTab(tab);
}

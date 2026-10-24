// Page tabs: the set name, tab order (drag to reorder) and routing.
import { DEFAULT_NAV_ORDER, normalizeNavOrder, normalizeSetName } from "./set.js";
import { navEl, pages, getNavLinks } from "./dom.js";
import { notifyHeader, persistSession, state } from "./state.js";
import { abortInlineEdits } from "./faders.js";
import { refreshChannelRow, renderSelectedGroup } from "./live.js";
import { renderSongs } from "./songs-page.js";
import { renderPatchTable } from "./patch-page.js";
import { renderFixtures } from "./fixtures-page.js";

export function syncSetNameUi() {
  state.setName = normalizeSetName(state.setName);
  document.title = `${state.setName} · UnnaturalLight`;
  notifyHeader();
}

export function applySetName(name) {
  const next = normalizeSetName(name);
  if (!next || next === state.setName) return false;
  state.setName = next;
  syncSetNameUi();
  persistSession();
  return true;
}

function readNavOrderFromDom() {
  return normalizeNavOrder(
    getNavLinks().map((link) => link.dataset.page).filter(Boolean),
  );
}

export function applyNavOrder(order = state.navOrder) {
  state.navOrder = normalizeNavOrder(order);
  const byPage = new Map(
    getNavLinks().map((link) => [link.dataset.page, link]),
  );
  for (const page of state.navOrder) {
    const link = byPage.get(page);
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
function moveNavPage(from, to, after) {
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
  let dragPage = null;
  let didReorder = false;

  for (const link of getNavLinks()) {
    link.addEventListener("dragstart", (event) => {
      dragPage = link.dataset.page ?? null;
      didReorder = false;
      if (!dragPage || !event.dataTransfer) return;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", dragPage);
      link.classList.add("is-dragging");
    });

    link.addEventListener("dragend", () => {
      link.classList.remove("is-dragging");
      clearNavDropMarks();
      dragPage = null;
      window.setTimeout(() => {
        didReorder = false;
      }, 50);
    });

    link.addEventListener("dragover", (event) => {
      if (!dragPage || dragPage === link.dataset.page) return;
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
      const from = dragPage ?? event.dataTransfer?.getData("text/plain");
      const to = link.dataset.page;
      const after = navDropAfter(link, event);
      clearNavDropMarks();
      if (!from || !to) return;
      if (!moveNavPage(from, to, after)) return;
      didReorder = true;
      persistSession();
    });

    link.addEventListener("click", (event) => {
      if (!didReorder) return;
      event.preventDefault();
    });
  }
}

export function showPage(name) {
  const page = pages[name] ? name : "songs";
  abortInlineEdits();

  for (const [key, el] of Object.entries(pages)) {
    const active = key === page;
    el.hidden = !active;
    el.classList.toggle("is-active", active);
  }

  for (const link of getNavLinks()) {
    link.classList.toggle("is-active", link.dataset.page === page);
  }

  if (page === "patch") renderPatchTable();
  if (page === "fixtures") renderFixtures();
  if (page === "set") renderSongs();
  if (page === "channels") {
    refreshChannelRow();
    renderSelectedGroup();
  }
}

export function routeFromHash() {
  const hash = location.hash.replace("#", "");
  showPage(DEFAULT_NAV_ORDER.includes(hash) ? hash : "songs");
}

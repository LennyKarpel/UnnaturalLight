// Fixtures tab: the add-fixture form, fixture groups and the fixture list.
import {
  createFixtureGroup,
  findRangeConflict,
  channelCount,
  formatChannelRange,
  fixturesInGroup,
  MAX_FIXTURE_CHANNELS,
  MAX_FIXTURE_GROUPS,
  MAX_FIXTURE_QTY,
  MAX_FIXTURES,
  nextAvailableRange,
  normalizeChannelSpan,
  normalizeColorMode,
  normalizeMount,
} from "./fixtures.js";
import {
  tabFixtures,
  fixtureNameInput,
  fixtureStartPicker,
  fixtureCountPicker,
  fixtureQtyPicker,
  fixtureConflicts,
  fixtureScroll,
  fixtureEmpty,
  fixtureList,
  addFixtureBtn,
  addFixtureGroupBtn,
  fixtureFormGroupPickerHost,
} from "./dom.js";
import { setStatus, persistSession, state } from "./state.js";
import { abortInlineEdits, confirmAction, promptName } from "./faders.js";
import { dmx } from "./live.js";
import {
  makeChannelPickerButton,
  makeCountPickerButton,
  makeFixtureGroupPickerButton,
} from "./patch-tab.js";

/** @type {number} */
export let fixtureFormStart = 1;
/** @type {number} */
export let fixtureFormCount = 1;
/** @type {number} */
export let fixtureFormQty = 1;
/** @type {null | { sync: () => void }} */
export let fixtureFormStartPicker = null;
/** @type {null | { el: HTMLButtonElement, sync: () => void }} */
let fixtureFormCountPicker = null;
/** @type {null | { el: HTMLButtonElement, sync: () => void }} */
let fixtureFormQtyPicker = null;
/** @type {null | { el: HTMLButtonElement, sync: () => void }} */
let fixtureFormGroupPicker = null;

/** @type {null | (() => void)} */
export let endInlineFixtureRename = null;

export function ensureFixtureFormStartPicker() {
  if (fixtureFormStartPicker) {
    fixtureFormStartPicker.sync();
    return;
  }
  fixtureStartPicker.replaceChildren();
  fixtureFormStartPicker = makeChannelPickerButton({
    className: "channel-picker-btn channel-picker-btn-lg",
    getChannel: () => fixtureFormStart,
    setChannel: (channel) => {
      fixtureFormStart = channel;
    },
    ariaLabel: (ch) => `Fixture start channel ${ch}`,
  });
  fixtureStartPicker.append(fixtureFormStartPicker.el);
}

export function ensureFixtureFormCountPicker() {
  if (fixtureFormCountPicker) {
    fixtureFormCountPicker.sync();
    return;
  }
  fixtureCountPicker.replaceChildren();
  fixtureFormCountPicker = makeCountPickerButton({
    className: "channel-picker-btn channel-picker-btn-lg",
    getCount: () => fixtureFormCount,
    setCount: (count) => {
      fixtureFormCount = count;
    },
    ariaLabel: (n) => `Fixture channel count ${n}`,
  });
  fixtureCountPicker.append(fixtureFormCountPicker.el);
}

export function ensureFixtureFormQtyPicker() {
  if (fixtureFormQtyPicker) {
    fixtureFormQtyPicker.sync();
    return;
  }
  fixtureQtyPicker.replaceChildren();
  fixtureFormQtyPicker = makeCountPickerButton({
    className: "channel-picker-btn channel-picker-btn-lg",
    getCount: () => fixtureFormQty,
    setCount: (count) => {
      fixtureFormQty = Math.min(MAX_FIXTURE_QTY, Math.max(1, count));
      syncFixtureFormAddLabel();
    },
    ariaLabel: (n) => `Add ${n} fixtures`,
  });
  fixtureQtyPicker.append(fixtureFormQtyPicker.el);
}

export function ensureFixtureFormGroupPicker() {
  if (fixtureFormGroupPicker) {
    fixtureFormGroupPicker.sync();
    return;
  }
  fixtureFormGroupPickerHost.replaceChildren();
  fixtureFormGroupPicker = makeFixtureGroupPickerButton({
    className: "channel-picker-btn channel-picker-btn-lg",
    getGroupId: () => state.fixtureFormGroupId,
    setGroupId: (groupId) => {
      state.fixtureFormGroupId = groupId;
    },
    ariaLabel: (_id, label) => `Fixture group ${label}`,
  });
  fixtureFormGroupPickerHost.append(fixtureFormGroupPicker.el);
}

function syncFixtureFormAddLabel() {
  const qty = Math.max(1, Math.round(fixtureFormQty) || 1);
  addFixtureBtn.textContent =
    qty === 1 ? "+ Fixture" : `+ ${qty} Fixtures`;
}

/**
 * Names for a batch add. "Wash"→Wash 1…n; "Wash 3"→Wash 3, Wash 4…
 * @param {string} base
 * @param {number} qty
 * @returns {string[]}
 */
export function batchFixtureNames(base, qty) {
  const name = base.trim().slice(0, 40);
  if (qty <= 1) return [name];
  const match = name.match(/^(.*?)(\d+)$/);
  if (match) {
    const prefix = match[1];
    let n = Number(match[2]);
    return Array.from({ length: qty }, () => {
      const next = `${prefix}${n++}`;
      return next.slice(0, 40);
    });
  }
  return Array.from({ length: qty }, (_, i) => `${name} ${i + 1}`.slice(0, 40));
}

function syncFixtureForm() {
  const full = state.fixtures.length >= MAX_FIXTURES;
  const groupsFull = state.fixtureGroups.length >= MAX_FIXTURE_GROUPS;
  addFixtureBtn.disabled = full;
  addFixtureGroupBtn.disabled = groupsFull;
  fixtureNameInput.disabled = full;
  ensureFixtureFormStartPicker();
  ensureFixtureFormCountPicker();
  ensureFixtureFormQtyPicker();
  ensureFixtureFormGroupPicker();
  syncFixtureFormAddLabel();
  if (fixtureFormStartPicker) {
    fixtureFormStartPicker.el.disabled = full;
  }
  if (fixtureFormCountPicker) {
    fixtureFormCountPicker.el.disabled = full;
  }
  if (fixtureFormQtyPicker) {
    fixtureFormQtyPicker.el.disabled = full;
  }
  if (fixtureFormGroupPicker) {
    fixtureFormGroupPicker.el.disabled = full;
  }
}

/** Suggest next free start for the add form (after add / first paint). */
export function suggestFixtureFormStart() {
  const width = Math.max(1, Math.round(fixtureFormCount) || 1);
  const suggested = nextAvailableRange(state.fixtures, width);
  if (!suggested) return;
  fixtureFormStart = suggested.channelStart;
  fixtureFormStartPicker?.sync();
}

function updateFixtureConflicts() {
  /** @type {string[]} */
  const notes = [];
  for (let i = 0; i < state.fixtures.length; i++) {
    const a = state.fixtures[i];
    for (let j = i + 1; j < state.fixtures.length; j++) {
      const b = state.fixtures[j];
      if (
        findRangeConflict([b], a.channelStart, a.channelEnd)
      ) {
        notes.push(
          `${a.name} (${formatChannelRange(a)}) overlaps ${b.name} (${formatChannelRange(b)})`,
        );
      }
    }
  }
  fixtureConflicts.hidden = notes.length === 0;
  fixtureConflicts.textContent = notes.length
    ? `Channel conflicts: ${notes.join(" · ")}`
    : "";
  for (const row of fixtureList.querySelectorAll(".fixture-row")) {
    const id = row.getAttribute("data-id");
    const fixture = state.fixtures.find((item) => item.id === id);
    if (!fixture) continue;
    const conflict = findRangeConflict(
      state.fixtures,
      fixture.channelStart,
      fixture.channelEnd,
      fixture.id,
    );
    row.classList.toggle("is-conflict", Boolean(conflict));
  }
}

/**
 * @param {import("./fixtures.js").Fixture} fixture
 * @param {number} start
 * @param {number} count
 * @param {{ sync: () => void } | null} startPicker
 * @param {{ sync: () => void } | null} countPicker
 * @returns {boolean}
 */
function commitFixtureRange(fixture, start, count, startPicker, countPicker) {
  const range = normalizeChannelSpan(start, count);
  if (!range) {
    startPicker?.sync();
    countPicker?.sync();
    setStatus(
      `Start + channel count (up to ${MAX_FIXTURE_CHANNELS}) must fit inside one universe`,
      "error",
    );
    return false;
  }
  const conflict = findRangeConflict(
    state.fixtures,
    range.channelStart,
    range.channelEnd,
    fixture.id,
  );
  if (conflict) {
    startPicker?.sync();
    countPicker?.sync();
    setStatus(
      `Range overlaps ${conflict.name} (${formatChannelRange(conflict)})`,
      "error",
    );
    updateFixtureConflicts();
    return false;
  }
  fixture.channelStart = range.channelStart;
  fixture.channelEnd = range.channelEnd;
  startPicker?.sync();
  countPicker?.sync();
  updateFixtureConflicts();
  persistSession();
  setStatus(
    `${fixture.name} → ${formatChannelRange(fixture)}`,
    dmx.connected ? "connected" : "idle",
  );
  return true;
}

/** @type {string | null} */
let dragFixtureId = null;
/** @type {number | null} */
let fixtureDragClientY = null;
/** @type {number | null} */
let fixtureDragScrollRaf = null;
/** @type {null | (() => void)} */
let stopFixtureDragSession = null;

/**
 * @typedef {{
 *   kind: "row",
 *   id: string,
 *   groupId: string | null,
 *   after: boolean,
 * } | {
 *   kind: "group",
 *   groupId: string | null,
 * }} FixtureDragHover
 */
/** @type {FixtureDragHover | null} */
let fixtureDragHover = null;

const FIXTURE_DRAG_SCROLL_EDGE = 56;
const FIXTURE_DRAG_SCROLL_MAX = 24;

function clearFixtureDropMarks() {
  for (const el of fixtureList.querySelectorAll(
    ".is-drop-before, .is-drop-after, .is-drop-target",
  )) {
    el.classList.remove("is-drop-before", "is-drop-after", "is-drop-target");
  }
}

/** @param {HTMLElement} row @param {number} clientY */
function fixtureDropAfter(row, clientY) {
  const rect = row.getBoundingClientRect();
  return clientY > rect.top + rect.height / 2;
}

/**
 * Move a fixture in list order and/or into another group.
 * @param {string} fromId
 * @param {{
 *   groupId: string | null,
 *   beforeId?: string | null,
 *   afterId?: string | null,
 * }} opts
 */
function placeFixture(fromId, { groupId, beforeId = null, afterId = null }) {
  const fromIndex = state.fixtures.findIndex((item) => item.id === fromId);
  if (fromIndex < 0) return false;
  if (beforeId === fromId || afterId === fromId) return false;

  const [item] = state.fixtures.splice(fromIndex, 1);
  item.groupId = groupId;

  let insertAt = state.fixtures.length;
  if (beforeId) {
    const idx = state.fixtures.findIndex((entry) => entry.id === beforeId);
    if (idx >= 0) insertAt = idx;
  } else if (afterId) {
    const idx = state.fixtures.findIndex((entry) => entry.id === afterId);
    if (idx >= 0) insertAt = idx + 1;
  } else {
    for (let i = state.fixtures.length - 1; i >= 0; i--) {
      if ((state.fixtures[i].groupId ?? null) === groupId) {
        insertAt = i + 1;
        break;
      }
    }
  }

  state.fixtures.splice(insertAt, 0, item);
  return true;
}

function applyFixtureDragHover() {
  if (!dragFixtureId || !fixtureDragHover) return false;
  const fromId = dragFixtureId;
  const hover = fixtureDragHover;
  if (hover.kind === "row") {
    return placeFixture(fromId, {
      groupId: hover.groupId,
      beforeId: hover.after ? null : hover.id,
      afterId: hover.after ? hover.id : null,
    });
  }
  return placeFixture(fromId, { groupId: hover.groupId });
}

function endFixtureDrag() {
  clearFixtureDropMarks();
  stopFixtureDragSession?.();
  dragFixtureId = null;
  fixtureDragHover = null;
}

/** @param {string | null} groupId */
function finishFixtureDrop(groupId) {
  const moved = applyFixtureDragHover();
  endFixtureDrag();
  if (!moved) return;
  state.fixtureFormGroupId = groupId;
  renderFixtures();
  persistSession();
}

function tickFixtureDragScroll() {
  fixtureDragScrollRaf = null;
  if (!dragFixtureId) return;

  if (fixtureDragClientY != null) {
    const rect = fixtureScroll.getBoundingClientRect();
    const y = fixtureDragClientY;
    let dy = 0;

    if (y < rect.top) {
      dy = -FIXTURE_DRAG_SCROLL_MAX;
    } else if (y > rect.bottom) {
      dy = FIXTURE_DRAG_SCROLL_MAX;
    } else if (y < rect.top + FIXTURE_DRAG_SCROLL_EDGE) {
      const distance = rect.top + FIXTURE_DRAG_SCROLL_EDGE - y;
      const t = Math.min(1, distance / FIXTURE_DRAG_SCROLL_EDGE);
      dy = -Math.ceil(Math.max(2, t * FIXTURE_DRAG_SCROLL_MAX));
    } else if (y > rect.bottom - FIXTURE_DRAG_SCROLL_EDGE) {
      const distance = y - (rect.bottom - FIXTURE_DRAG_SCROLL_EDGE);
      const t = Math.min(1, distance / FIXTURE_DRAG_SCROLL_EDGE);
      dy = Math.ceil(Math.max(2, t * FIXTURE_DRAG_SCROLL_MAX));
    }

    if (dy !== 0) {
      const maxScroll = Math.max(
        0,
        fixtureScroll.scrollHeight - fixtureScroll.clientHeight,
      );
      fixtureScroll.scrollTop = Math.max(
        0,
        Math.min(maxScroll, fixtureScroll.scrollTop + dy),
      );
    }
  }

  // Keep the loop alive for the whole drag — early frames often run before
  // any dragover has set clientY.
  fixtureDragScrollRaf = requestAnimationFrame(tickFixtureDragScroll);
}

/** @param {number} [initialClientY] */
function startFixtureDragSession(initialClientY) {
  stopFixtureDragSession?.();
  fixtureDragClientY =
    typeof initialClientY === "number" ? initialClientY : null;
  fixtureDragHover = null;
  tabFixtures.classList.add("is-dragging-fixture");

  const onDragOver = (event) => {
    if (!dragFixtureId) return;
    // Keep the drag alive over page chrome above/below the list.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    fixtureDragClientY = event.clientY;
  };

  document.addEventListener("dragover", onDragOver, true);
  fixtureDragScrollRaf = requestAnimationFrame(tickFixtureDragScroll);

  stopFixtureDragSession = () => {
    document.removeEventListener("dragover", onDragOver, true);
    if (fixtureDragScrollRaf != null) {
      cancelAnimationFrame(fixtureDragScrollRaf);
      fixtureDragScrollRaf = null;
    }
    fixtureDragClientY = null;
    tabFixtures.classList.remove("is-dragging-fixture");
    stopFixtureDragSession = null;
  };
}

/**
 * @param {HTMLElement} row
 * @param {import("./fixtures.js").Fixture} fixture
 */
function wireFixtureRowDrag(row, fixture) {
  const handle = document.createElement("div");
  handle.className = "fixture-drag-handle";
  handle.title = "Drag to reorder or move between groups";
  handle.setAttribute("aria-hidden", "true");
  handle.textContent = "⋮⋮";

  // Arm drag from the handle; draggable is on the row (more reliable in Chromium).
  handle.addEventListener("pointerdown", (event) => {
    if (event.button != null && event.button !== 0) return;
    row.dataset.dragArmed = "1";
    const onUp = () => {
      window.removeEventListener("pointerup", onUp, true);
      // Defer so dragstart can still see the armed flag.
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
    abortInlineEdits();
    dragFixtureId = fixture.id;
    fixtureDragHover = null;
    row.classList.add("is-dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", fixture.id);
      try {
        event.dataTransfer.setDragImage(row, 24, 16);
      } catch {
        // some browsers reject setDragImage
      }
    }
    startFixtureDragSession(event.clientY);
  });

  row.addEventListener("dragend", () => {
    delete row.dataset.dragArmed;
    row.classList.remove("is-dragging");
    endFixtureDrag();
  });

  row.addEventListener("dragover", (event) => {
    if (!dragFixtureId || dragFixtureId === fixture.id) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    fixtureDragClientY = event.clientY;
    const after = fixtureDropAfter(row, event.clientY);
    clearFixtureDropMarks();
    row.classList.add(after ? "is-drop-after" : "is-drop-before");
    fixtureDragHover = {
      kind: "row",
      id: fixture.id,
      groupId: fixture.groupId ?? null,
      after,
    };
  });

  row.addEventListener("drop", (event) => {
    if (!dragFixtureId || dragFixtureId === fixture.id) return;
    event.preventDefault();
    event.stopPropagation();
    const after = fixtureDropAfter(row, event.clientY);
    const groupId = fixture.groupId ?? null;
    fixtureDragHover = {
      kind: "row",
      id: fixture.id,
      groupId,
      after,
    };
    finishFixtureDrop(groupId);
  });

  row.prepend(handle);
}

/**
 * Drop onto a group (empty body, or card chrome around the body).
 * @param {HTMLElement} el
 * @param {string | null} groupId
 * @param {{
 *   markEl?: HTMLElement,
 *   shouldDefer?: (event: DragEvent) => boolean,
 * }} [opts]
 */
function wireFixtureGroupDropTarget(el, groupId, opts = {}) {
  const markEl = opts.markEl ?? el;
  const shouldDefer = opts.shouldDefer;

  el.addEventListener("dragover", (event) => {
    if (!dragFixtureId) return;
    if (shouldDefer?.(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    fixtureDragClientY = event.clientY;
    clearFixtureDropMarks();
    markEl.classList.add("is-drop-target");
    fixtureDragHover = { kind: "group", groupId };
  });

  el.addEventListener("drop", (event) => {
    if (!dragFixtureId) return;
    if (shouldDefer?.(event)) return;
    event.preventDefault();
    event.stopPropagation();
    fixtureDragHover = { kind: "group", groupId };
    finishFixtureDrop(groupId);
  });
}

/**
 * @param {import("./fixtures.js").Fixture} fixture
 * @returns {HTMLElement}
 */
function renderFixtureRow(fixture) {
  const row = document.createElement("div");
  row.className = "fixture-row";
  row.setAttribute("role", "listitem");
  row.dataset.id = fixture.id;

  const name = document.createElement("h3");
  name.className = "fixture-row-name";
  name.textContent = fixture.name;
  name.title = "Click to rename";
  name.setAttribute("role", "button");
  name.tabIndex = 0;
  name.addEventListener("click", (event) => {
    event.stopPropagation();
    beginInlineFixtureRename(fixture.id, name);
  });
  name.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      beginInlineFixtureRename(fixture.id, name);
    }
  });

  const range = document.createElement("div");
  range.className = "fixture-ch-range";

  /** @type {{ el: HTMLButtonElement, sync: () => void } | null} */
  let startPicker = null;
  /** @type {{ el: HTMLButtonElement, sync: () => void } | null} */
  let countPicker = null;

  startPicker = makeChannelPickerButton({
    className: "channel-picker-btn",
    getChannel: () => fixture.channelStart,
    setChannel: (channel) => {
      commitFixtureRange(
        fixture,
        channel,
        channelCount(fixture),
        startPicker,
        countPicker,
      );
    },
    ariaLabel: (ch) => `${fixture.name} start channel ${ch}`,
  });

  const sep = document.createElement("span");
  sep.textContent = "×";

  countPicker = makeCountPickerButton({
    className: "channel-picker-btn",
    getCount: () => channelCount(fixture),
    setCount: (count) => {
      commitFixtureRange(
        fixture,
        fixture.channelStart,
        count,
        startPicker,
        countPicker,
      );
    },
    ariaLabel: (n) => `${fixture.name} channel count ${n}`,
  });
  range.append(startPicker.el, sep, countPicker.el);

  const groupPicker = makeFixtureGroupPickerButton({
    className: "channel-picker-btn fixture-row-group",
    getGroupId: () => fixture.groupId,
    setGroupId: (groupId) => {
      fixture.groupId = groupId;
      state.fixtureFormGroupId = groupId;
      renderFixtures();
      persistSession();
    },
    ariaLabel: (_id, label) => `${fixture.name} group ${label}`,
  });

  const mount = document.createElement("select");
  mount.setAttribute("aria-label", `${fixture.name} mount`);
  for (const value of ["fixed", "movable"]) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = value === "movable" ? "Movable" : "Fixed";
    mount.append(opt);
  }
  mount.value = fixture.mount;
  mount.addEventListener("change", () => {
    fixture.mount = normalizeMount(mount.value);
    persistSession();
  });

  const color = document.createElement("select");
  color.setAttribute("aria-label", `${fixture.name} color`);
  for (const value of ["single", "multi"]) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = value === "multi" ? "Multi-color" : "Single color";
    color.append(opt);
  }
  color.value = fixture.color;
  color.addEventListener("change", () => {
    fixture.color = normalizeColorMode(color.value);
    persistSession();
  });

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "fixture-remove";
  remove.textContent = "✕";
  remove.title = `Remove ${fixture.name}`;
  remove.setAttribute("aria-label", `Remove ${fixture.name}`);
  remove.addEventListener("click", async () => {
    const ok = await confirmAction({
      title: "Remove fixture?",
      message: `Remove “${fixture.name}” from this show?`,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    state.fixtures = state.fixtures.filter((item) => item.id !== fixture.id);
    renderFixtures();
    persistSession();
  });

  row.append(name, range, groupPicker.el, mount, color, remove);
  wireFixtureRowDrag(row, fixture);
  return row;
}

/**
 * @param {{
 *   title: string,
 *   count: number,
 *   groupId?: string | null,
 *   onRemove?: () => void,
 * }} opts
 */
function renderFixtureGroupHeader({ title, count, groupId = null, onRemove }) {
  const header = document.createElement("div");
  header.className = "fixture-group-header";

  const label = document.createElement("h3");
  label.className = "fixture-group-name";
  label.textContent = title;
  if (groupId) {
    label.title = "Click to rename";
    label.setAttribute("role", "button");
    label.tabIndex = 0;
    label.addEventListener("click", (event) => {
      event.stopPropagation();
      beginInlineFixtureGroupRename(groupId, label);
    });
    label.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        beginInlineFixtureGroupRename(groupId, label);
      }
    });
  }

  const meta = document.createElement("span");
  meta.className = "fixture-group-meta";
  meta.textContent = count === 1 ? "1 fixture" : `${count} fixtures`;

  header.append(label, meta);

  if (onRemove) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "fixture-remove";
    remove.textContent = "✕";
    remove.title = `Remove group ${title}`;
    remove.setAttribute("aria-label", `Remove group ${title}`);
    remove.addEventListener("click", () => onRemove());
    header.append(remove);
  }

  return header;
}

/**
 * @param {{
 *   title: string,
 *   count: number,
 *   groupId?: string | null,
 *   ungrouped?: boolean,
 *   onRemove?: () => void,
 *   members: import("./fixtures.js").Fixture[],
 * }} opts
 */
function renderFixtureGroupCard({
  title,
  count,
  groupId = null,
  ungrouped = false,
  onRemove,
  members,
}) {
  const card = document.createElement("div");
  card.className = "fixture-group-card";
  if (ungrouped) card.classList.add("fixture-group-card-ungrouped");
  if (groupId) card.dataset.groupId = groupId;
  if (ungrouped) card.dataset.ungrouped = "true";

  const dropGroupId = ungrouped ? null : groupId;

  card.append(
    renderFixtureGroupHeader({
      title,
      count,
      groupId: ungrouped ? null : groupId,
      onRemove,
    }),
  );

  const body = document.createElement("div");
  body.className = "fixture-group-body";
  wireFixtureGroupDropTarget(body, dropGroupId, {
    shouldDefer: (event) => {
      const overRow =
        event.target instanceof Element
          ? event.target.closest(".fixture-row")
          : null;
      return Boolean(overRow && body.contains(overRow));
    },
  });
  if (members.length === 0) {
    card.classList.add("is-empty");
    const empty = document.createElement("div");
    empty.className = "fixture-group-empty";
    empty.textContent = ungrouped
      ? "No ungrouped fixtures"
      : "No fixtures in this group";
    body.append(empty);
  } else {
    for (const fixture of members) {
      body.append(renderFixtureRow(fixture));
    }
  }
  card.append(body);

  // Header / empty chrome around the body still accepts drops into the group.
  wireFixtureGroupDropTarget(card, dropGroupId, {
    markEl: body,
    shouldDefer: (event) =>
      event.target instanceof Element &&
      Boolean(event.target.closest(".fixture-row, .fixture-group-body")),
  });

  return card;
}

export function renderFixtures() {
  fixtureList.replaceChildren();
  const hasContent = state.fixtures.length > 0 || state.fixtureGroups.length > 0;
  fixtureEmpty.hidden = hasContent;

  // Always render every group card, including empty ones.
  for (const group of state.fixtureGroups) {
    const members = fixturesInGroup(state.fixtures, group.id);
    fixtureList.append(
      renderFixtureGroupCard({
        title: group.name,
        count: members.length,
        groupId: group.id,
        members,
        onRemove: () => {
          void removeFixtureGroup(group.id);
        },
      }),
    );
  }

  const ungrouped = fixturesInGroup(state.fixtures, null);
  if (state.fixtureGroups.length > 0) {
    fixtureList.append(
      renderFixtureGroupCard({
        title: "Ungrouped",
        count: ungrouped.length,
        ungrouped: true,
        members: ungrouped,
      }),
    );
  } else {
    for (const fixture of ungrouped) {
      fixtureList.append(renderFixtureRow(fixture));
    }
  }

  syncFixtureForm();
  updateFixtureConflicts();
}

/**
 * @param {string} id
 * @param {HTMLElement} [target]
 */
function beginInlineFixtureRename(id, target) {
  const fixture = state.fixtures.find((item) => item.id === id);
  if (!fixture) return;

  abortInlineEdits();

  const title =
    target ??
    fixtureList.querySelector(
      `.fixture-row[data-id="${CSS.escape(id)}"] .fixture-row-name`,
    );
  if (!(title instanceof HTMLElement) || !title.isConnected) return;

  const parent = title.parentElement;
  if (!parent) return;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "cue-title-input fixture-name-input";
  input.maxLength = 40;
  input.value = fixture.name;
  input.setAttribute("aria-label", "Fixture name");
  input.autocomplete = "off";
  input.spellcheck = false;

  title.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = (commit) => {
    if (finished) return;
    finished = true;
    if (endInlineFixtureRename === finishAbort) {
      endInlineFixtureRename = null;
    }
    input.removeEventListener("keydown", onKeydown);
    input.removeEventListener("blur", onBlur);

    const next = input.value.trim().slice(0, 40);
    const changed = Boolean(commit && next && next !== fixture.name);
    if (changed) {
      fixture.name = next;
      persistSession();
    }

    if (changed) {
      renderFixtures();
      return;
    }

    const restored = document.createElement("h3");
    restored.className = "fixture-row-name";
    restored.textContent = fixture.name;
    restored.title = "Click to rename";
    restored.setAttribute("role", "button");
    restored.tabIndex = 0;
    restored.addEventListener("click", (event) => {
      event.stopPropagation();
      beginInlineFixtureRename(id, restored);
    });
    restored.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        beginInlineFixtureRename(id, restored);
      }
    });

    if (input.isConnected) input.replaceWith(restored);
    else parent.prepend(restored);
  };

  const finishAbort = () => finish(false);
  endInlineFixtureRename = finishAbort;

  const onKeydown = (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  };
  const onBlur = () => finish(true);

  input.addEventListener("keydown", onKeydown);
  input.addEventListener("blur", onBlur);
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("pointerdown", (event) => event.stopPropagation());
}

/**
 * @param {string} id
 * @param {HTMLElement} [target]
 */
function beginInlineFixtureGroupRename(id, target) {
  const group = state.fixtureGroups.find((item) => item.id === id);
  if (!group) return;

  abortInlineEdits();

  const title =
    target ??
    fixtureList.querySelector(
      `.fixture-group-card[data-group-id="${CSS.escape(id)}"] .fixture-group-name`,
    );
  if (!(title instanceof HTMLElement) || !title.isConnected) return;

  const parent = title.parentElement;
  if (!parent) return;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "cue-title-input fixture-group-name-input";
  input.maxLength = 40;
  input.value = group.name;
  input.setAttribute("aria-label", "Group name");
  input.autocomplete = "off";
  input.spellcheck = false;

  title.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = (commit) => {
    if (finished) return;
    finished = true;
    if (endInlineFixtureRename === finishAbort) {
      endInlineFixtureRename = null;
    }
    input.removeEventListener("keydown", onKeydown);
    input.removeEventListener("blur", onBlur);

    const next = input.value.trim().slice(0, 40);
    const changed = Boolean(commit && next && next !== group.name);
    if (changed) {
      group.name = next;
      persistSession();
      renderFixtures();
      return;
    }

    const restored = document.createElement("h3");
    restored.className = "fixture-group-name";
    restored.textContent = group.name;
    restored.title = "Click to rename";
    restored.setAttribute("role", "button");
    restored.tabIndex = 0;
    restored.addEventListener("click", (event) => {
      event.stopPropagation();
      beginInlineFixtureGroupRename(id, restored);
    });
    restored.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        beginInlineFixtureGroupRename(id, restored);
      }
    });

    if (input.isConnected) input.replaceWith(restored);
    else parent.prepend(restored);
  };

  const finishAbort = () => finish(false);
  endInlineFixtureRename = finishAbort;

  const onKeydown = (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  };
  const onBlur = () => finish(true);

  input.addEventListener("keydown", onKeydown);
  input.addEventListener("blur", onBlur);
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("pointerdown", (event) => event.stopPropagation());
}

export async function addFixtureGroup() {
  if (state.fixtureGroups.length >= MAX_FIXTURE_GROUPS) return;
  const name = await promptName({
    title: "New group",
    confirmLabel: "Create",
    initial: "",
  });
  if (!name) return;
  const group = createFixtureGroup({ name });
  state.fixtureGroups.push(group);
  state.fixtureFormGroupId = group.id;
  renderFixtures();
  persistSession();
  setStatus(
    `Group “${group.name}” created`,
    dmx.connected ? "connected" : "idle",
  );
}

async function removeFixtureGroup(id) {
  const group = state.fixtureGroups.find((item) => item.id === id);
  if (!group) return;
  const members = fixturesInGroup(state.fixtures, id);
  const ok = await confirmAction({
    title: "Remove group?",
    message:
      members.length > 0
        ? `Remove group “${group.name}”? Its ${members.length} fixture${members.length === 1 ? "" : "s"} will become ungrouped.`
        : `Remove empty group “${group.name}”?`,
    confirmLabel: "Remove",
  });
  if (!ok) return;
  for (const fixture of state.fixtures) {
    if (fixture.groupId === id) fixture.groupId = null;
  }
  state.fixtureGroups = state.fixtureGroups.filter((item) => item.id !== id);
  if (state.fixtureFormGroupId === id) state.fixtureFormGroupId = null;
  renderFixtures();
  persistSession();
}

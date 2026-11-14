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
  type Fixture,
} from "./fixtures.ts";
import {
  tabFixtures,
  fixtureNameInput,
  fixtureStartPicker,
  fixtureCountPicker,
  fixtureQtyPicker,
  fixtureConflicts,
  fixtureScroll,
  startDragScroll,
  wireRowDrag,
  type DragScroll,
  fixtureEmpty,
  fixtureList,
  addFixtureBtn,
  addFixtureGroupBtn,
  fixtureFormGroupPickerHost,
} from "./dom.ts";
import { setStatus, persistSession, state } from "./state.ts";
import { abortInlineEdits, confirmAction, promptName } from "./faders.ts";
import {
  makeChannelPickerButton,
  makeCountPickerButton,
  makeFixtureGroupPickerButton,
  type PickerButton,
} from "./patch-tab.ts";
import { inlineRename, clickToRename } from "./inline-rename.ts";
import { el, button } from "../shared/html.ts";
import { clamp } from "../shared/numbers.ts";

export let fixtureFormStart = 1;
export let fixtureFormCount = 1;
export let fixtureFormQty = 1;
export let fixtureFormStartPicker: PickerButton | null = null;
let fixtureFormCountPicker: PickerButton | null = null;
let fixtureFormQtyPicker: PickerButton | null = null;
let fixtureFormGroupPicker: PickerButton | null = null;

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
      fixtureFormQty = clamp(count, 1, MAX_FIXTURE_QTY);
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

/** Names for a batch add. "Wash"→Wash 1…n; "Wash 3"→Wash 3, Wash 4… */
export function batchFixtureNames(base: string, qty: number): string[] {
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
  const notes: string[] = [];
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
  for (const row of fixtureList.querySelectorAll<HTMLElement>(".fixture-row")) {
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

function commitFixtureRange(
  fixture: Fixture,
  start: number,
  count: number,
  startPicker: PickerButton,
  countPicker: PickerButton,
): boolean {
  const range = normalizeChannelSpan(start, count);
  if (!range) {
    startPicker.sync();
    countPicker.sync();
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
    startPicker.sync();
    countPicker.sync();
    setStatus(
      `Range overlaps ${conflict.name} (${formatChannelRange(conflict)})`,
      "error",
    );
    updateFixtureConflicts();
    return false;
  }
  fixture.channelStart = range.channelStart;
  fixture.channelEnd = range.channelEnd;
  startPicker.sync();
  countPicker.sync();
  updateFixtureConflicts();
  persistSession();
  setStatus(
    `${fixture.name} → ${formatChannelRange(fixture)}`,
    "done",
  );
  return true;
}

let dragFixtureId: string | null = null;
let dragScroll: DragScroll | null = null;

export type FixtureDragHover = {
  kind: "row";
  id: string;
  groupId: string | null;
  after: boolean;
  } | {
  kind: "group";
  groupId: string | null;
};
let fixtureDragHover: FixtureDragHover | null = null;


function clearFixtureDropMarks() {
  for (const el of fixtureList.querySelectorAll(
    ".is-drop-before, .is-drop-after, .is-drop-target",
  )) {
    el.classList.remove("is-drop-before", "is-drop-after", "is-drop-target");
  }
}

function fixtureDropAfter(row: HTMLElement, clientY: number) {
  const rect = row.getBoundingClientRect();
  return clientY > rect.top + rect.height / 2;
}

/** Move a fixture in list order and/or into another group. */
function placeFixture(fromId: string, { groupId, beforeId = null, afterId = null }: {
    groupId: string | null;
    beforeId?: string | null;
    afterId?: string | null;
  }) {
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
  dragScroll?.stop();
  dragFixtureId = null;
  fixtureDragHover = null;
}

function finishFixtureDrop(groupId: string | null) {
  const moved = applyFixtureDragHover();
  endFixtureDrag();
  if (!moved) return;
  state.fixtureFormGroupId = groupId;
  renderFixtures();
  persistSession();
}


function wireFixtureRowDrag(row: HTMLElement, fixture: Fixture) {
  const handle = el("div", "fixture-drag-handle");
  handle.title = "Drag to reorder or move between groups";
  handle.setAttribute("aria-hidden", "true");
  handle.textContent = "⋮⋮";

  wireRowDrag(row, handle, fixture.id, (event) => {
    abortInlineEdits();
    dragFixtureId = fixture.id;
    fixtureDragHover = null;
    try {
      event.dataTransfer?.setDragImage(row, 24, 16);
    } catch {
      // some browsers reject setDragImage
    }
    dragScroll?.stop();
    dragScroll = startDragScroll(fixtureScroll, tabFixtures, "is-dragging-fixture", () => dragFixtureId != null, event.clientY);
  }, endFixtureDrag);

  row.addEventListener("dragover", (event) => {
    if (!dragFixtureId || dragFixtureId === fixture.id) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    dragScroll?.track(event.clientY);
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

/** Drop onto a group (empty body, or card chrome around the body). */
function wireFixtureGroupDropTarget(el: HTMLElement, groupId: string | null, opts: {
  markEl?: HTMLElement;
  shouldDefer?: (event: DragEvent) => boolean;
} = {}) {
  const markEl = opts.markEl ?? el;
  const shouldDefer = opts.shouldDefer;

  el.addEventListener("dragover", (event) => {
    if (!dragFixtureId) return;
    if (shouldDefer?.(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    dragScroll?.track(event.clientY);
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

function renderFixtureRow(fixture: Fixture): HTMLElement {
  const row = el("div", "fixture-row");
  row.setAttribute("role", "listitem");
  row.dataset.id = fixture.id;

  const name = fixtureNameEl(fixture);

  const range = el("div", "fixture-ch-range");

  // Each commits with both pickers (to resync them); the other is made by the time either is used.
  const startPicker = makeChannelPickerButton({
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

  const countPicker = makeCountPickerButton({
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

  const remove = button("fixture-remove", "✕");
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

function renderFixtureGroupHeader({ title, count, groupId = null, onRemove }: {
    title: string;
    count: number;
    groupId?: string | null;
    onRemove?: () => void;
  }) {
  const header = el("div", "fixture-group-header");

  // A real group's name can be renamed ("Ungrouped" can't).
  const label = groupId ? groupNameEl({ id: groupId, name: title }) : el("h3", "fixture-group-name", title);

  const meta = el("span", "fixture-group-meta", count === 1 ? "1 fixture" : `${count} fixtures`);

  header.append(label, meta);

  if (onRemove) {
    const remove = button("fixture-remove", "✕");
    remove.title = `Remove group ${title}`;
    remove.setAttribute("aria-label", `Remove group ${title}`);
    remove.addEventListener("click", () => onRemove());
    header.append(remove);
  }

  return header;
}

function renderFixtureGroupCard({
  title,
  count,
  groupId = null,
  ungrouped = false,
  onRemove,
  members,
}: {
    title: string;
    count: number;
    groupId?: string | null;
    ungrouped?: boolean;
    onRemove?: () => void;
    members: Fixture[];
  }) {
  const card = el("div", "fixture-group-card");
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

  const body = el("div", "fixture-group-body");
  wireFixtureGroupDropTarget(body, dropGroupId, {
    shouldDefer: (event) => {
      const overRow =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(".fixture-row")
          : null;
      return Boolean(overRow && body.contains(overRow));
    },
  });
  if (members.length === 0) {
    card.classList.add("is-empty");
    const empty = el("div", "fixture-group-empty");
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
      Boolean(event.target.closest<HTMLElement>(".fixture-row, .fixture-group-body")),
  });

  return card;
}

export function renderFixtures() {
  fixtureList.replaceChildren();
  fixtureEmpty.hidden = state.fixtures.length > 0 || state.fixtureGroups.length > 0;

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

function beginInlineFixtureRename(id: string, target?: HTMLElement) {
  const fixture = state.fixtures.find((item) => item.id === id);
  if (!fixture) return;

  abortInlineEdits();

  const title =
    target ??
    fixtureList.querySelector(
      `.fixture-row[data-id="${CSS.escape(id)}"] .fixture-row-name`,
    );
  if (!(title instanceof HTMLElement) || !title.isConnected) return;
  renameInList(title, fixture, "Fixture name", "fixture-name-input", fixtureNameEl);
}

/**
 * Rename a fixture or a group in the list: a new name redraws the list;
 * otherwise `nameEl` makes its name again.
 */
function renameInList<T extends { id: string; name: string }>(
  title: HTMLElement,
  item: T,
  label: string,
  inputClass: string,
  nameEl: (item: T) => HTMLElement,
) {
  inlineRename({
    replace: title,
    value: item.name,
    label,
    className: `cue-title-input ${inputClass}`,
    done: (name, putBack) => {
      if (name && name !== item.name) {
        item.name = name;
        persistSession();
        renderFixtures();
      } else putBack(nameEl(item));
    },
  });
}

/** A fixture row's name, click to rename. */
function fixtureNameEl(fixture: Fixture) {
  return clickToRename(el("h3", "fixture-row-name", fixture.name), (name) => beginInlineFixtureRename(fixture.id, name));
}

/** A group card's name, click to rename. */
function groupNameEl(group: { id: string; name: string }) {
  return clickToRename(el("h3", "fixture-group-name", group.name), (name) => beginInlineFixtureGroupRename(group.id, name));
}

function beginInlineFixtureGroupRename(id: string, target?: HTMLElement) {
  const group = state.fixtureGroups.find((item) => item.id === id);
  if (!group) return;

  abortInlineEdits();

  const title =
    target ??
    fixtureList.querySelector(
      `.fixture-group-card[data-group-id="${CSS.escape(id)}"] .fixture-group-name`,
    );
  if (!(title instanceof HTMLElement) || !title.isConnected) return;
  renameInList(title, group, "Group name", "fixture-group-name-input", groupNameEl);
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
    "done",
  );
}

async function removeFixtureGroup(id: string | null) {
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

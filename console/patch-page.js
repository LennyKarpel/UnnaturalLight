// Patch page: which channels each fader drives, and the channel, count
// and group pickers (also used by the Fixtures page).
import {
  FADER_COUNT,
  makeTarget,
  channelLimit,
  universeOf,
  addressOf,
  formatAddress,
  parseAddress,
} from "./patch.js";
import { MAX_FIXTURE_CHANNELS } from "./fixtures.js";
import {
  patchTableEl,
  patchConflictsEl,
  channelMenu,
  channelMenuFilter,
  channelMenuList,
  channelMenuSub,
  channelMenuSubList,
  channelMenuSubLabel,
  countMenu,
  countMenuList,
  fixtureGroupMenu,
  fixtureGroupMenuList,
  placePopup,
} from "./dom.js";
import { state } from "./state.js";
import {
  faderName,
  setSelectedFader,
  abortInlineEdits,
  renameFader,
  wirePatchFaderTitle,
  closeFaderNameMenu,
  isUnpatched,
  confirmClearFaderPatch,
} from "./faders.js";
import { closeCuePicker, persistAndRefresh } from "./live.js";
import { closeChannelsCueMenu, closeActionMenu } from "./cues.js";

const CHANNEL_GROUP_SIZE = 32;
/** Channel-picker groups of 32 across every universe in the set. */
const channelGroupCount = () => Math.ceil(channelLimit() / CHANNEL_GROUP_SIZE);

function conflictChannels() {
  const counts = new Map();
  for (const targets of state.patch) {
    for (const target of targets) {
      counts.set(target.channel, (counts.get(target.channel) ?? 0) + 1);
    }
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([ch]) => ch);
}

export function updateConflictBanner() {
  const conflicts = conflictChannels();
  if (conflicts.length === 0) {
    patchConflictsEl.hidden = true;
    patchConflictsEl.textContent = "";
    return;
  }
  patchConflictsEl.hidden = false;
  patchConflictsEl.textContent = `Shared DMX channels (HTP / highest wins): ${conflicts.join(", ")}`;
}

function nextFreeChannel(used = new Set(state.patch.flatMap((t) => t.map((x) => x.channel)))) {
  for (let ch = 1; ch <= channelLimit(); ch++) {
    if (!used.has(ch)) return ch;
  }
  return 1;
}

function channelGroupRange(groupIndex) {
  const start = groupIndex * CHANNEL_GROUP_SIZE + 1;
  const end = Math.min(start + CHANNEL_GROUP_SIZE - 1, channelLimit());
  return { start, end };
}

/** @type {null | (() => void)} */
export let closeChannelPicker = null;
/** @type {null | (() => void)} */
export let closeCountPicker = null;
/** @type {null | (() => void)} */
export let closeFixtureGroupPicker = null;

/**
 * @param {HTMLButtonElement} btn
 * @param {string} text
 */
function setPickerButtonLabel(btn, text) {
  btn.replaceChildren();
  const label = document.createElement("span");
  label.className = "picker-btn-label";
  label.textContent = text;
  const caret = document.createElement("span");
  caret.className = "picker-btn-caret";
  caret.setAttribute("aria-hidden", "true");
  caret.textContent = "▾";
  btn.append(label, caret);
}

/**
 * Shared DMX channel picker control (groups + search).
 * @param {{
 *   getChannel: () => number,
 *   setChannel: (channel: number) => void | Promise<void>,
 *   className?: string,
 *   ariaLabel?: string | ((channel: number) => string),
 * }} opts
 */
export function makeChannelPickerButton({
  getChannel,
  setChannel,
  className = "channel-picker-btn",
  ariaLabel,
}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.setAttribute("aria-haspopup", "menu");

  const sync = () => {
    const ch = getChannel();
    setPickerButtonLabel(btn, `Ch${formatAddress(ch)}`);
    btn.dataset.channel = String(ch);
    const label =
      typeof ariaLabel === "function"
        ? ariaLabel(ch)
        : ariaLabel || `Channel ${ch}`;
    btn.setAttribute("aria-label", label);
    btn.title = "Choose DMX channel";
  };

  sync();
  btn.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const channel = await pickChannel({
      anchor: btn,
      current: getChannel(),
    });
    if (channel == null) return;
    await setChannel(channel);
    sync();
  });

  return { el: btn, sync };
}

/**
 * Channel-count picker (1…16).
 * @param {{
 *   getCount: () => number,
 *   setCount: (count: number) => void | Promise<void>,
 *   className?: string,
 *   ariaLabel?: string | ((count: number) => string),
 * }} opts
 */
export function makeCountPickerButton({
  getCount,
  setCount,
  className = "channel-picker-btn",
  ariaLabel,
}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.setAttribute("aria-haspopup", "menu");

  const sync = () => {
    const n = getCount();
    setPickerButtonLabel(btn, String(n));
    btn.dataset.count = String(n);
    const label =
      typeof ariaLabel === "function"
        ? ariaLabel(n)
        : ariaLabel || `${n} channels`;
    btn.setAttribute("aria-label", label);
    btn.title = "Number of channels";
  };

  sync();
  btn.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const count = await pickCount({
      anchor: btn,
      current: getCount(),
    });
    if (count == null) return;
    await setCount(count);
    sync();
  });

  return { el: btn, sync };
}

/**
 * Fixture-group picker (Ungrouped + named groups).
 * @param {{
 *   getGroupId: () => string | null,
 *   setGroupId: (groupId: string | null) => void | Promise<void>,
 *   className?: string,
 *   ariaLabel?: string | ((groupId: string | null, label: string) => string),
 * }} opts
 */
export function makeFixtureGroupPickerButton({
  getGroupId,
  setGroupId,
  className = "channel-picker-btn",
  ariaLabel,
}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.setAttribute("aria-haspopup", "menu");

  const sync = () => {
    const groupId = getGroupId();
    const label = groupLabel(groupId);
    setPickerButtonLabel(btn, label);
    if (groupId) btn.dataset.groupId = groupId;
    else delete btn.dataset.groupId;
    const fullLabel =
      typeof ariaLabel === "function"
        ? ariaLabel(groupId, label)
        : ariaLabel || `Group ${label}`;
    btn.setAttribute("aria-label", fullLabel);
    btn.title = "Choose fixture group";
  };

  sync();
  btn.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const groupId = await pickFixtureGroup({
      anchor: btn,
      current: getGroupId(),
    });
    if (groupId === undefined) return; // dismissed
    await setGroupId(groupId);
    sync();
  });

  return { el: btn, sync };
}

/** @param {string | null | undefined} groupId */
function groupLabel(groupId) {
  if (!groupId) return "Ungrouped";
  return state.fixtureGroups.find((group) => group.id === groupId)?.name ?? "Ungrouped";
}

/**
 * @param {{ anchor: HTMLElement, current: string | null }} opts
 * @returns {Promise<string | null | undefined>}
 *   string = group id, null = Ungrouped, undefined = dismissed
 */
function pickFixtureGroup({ anchor, current }) {
  closeFixtureGroupPicker?.();
  closeCountPicker?.();
  closeChannelPicker?.();
  closeChannelsCueMenu?.();
  closeCuePicker?.();
  closeActionMenu?.();
  closeFaderNameMenu?.();

  return new Promise((resolve) => {
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const onDocPointer = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (fixtureGroupMenu.contains(target) || anchor.contains(target)) return;
      finish(undefined);
    };

    const onDocKeydown = (event) => {
      if (event.key === "Escape") finish(undefined);
    };

    const cleanup = () => {
      fixtureGroupMenu.hidden = true;
      if (closeFixtureGroupPicker === finishNull) {
        closeFixtureGroupPicker = null;
      }
      document.removeEventListener("pointerdown", onDocPointer, true);
      document.removeEventListener("keydown", onDocKeydown, true);
    };

    const finishNull = () => finish(undefined);
    closeFixtureGroupPicker = finishNull;

    fixtureGroupMenuList.replaceChildren();

    const addItem = (label, value) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "menu-item";
      const isCurrent = (value ?? null) === (current ?? null);
      if (isCurrent) item.classList.add("is-current");
      item.setAttribute("role", "menuitem");
      item.textContent = label;
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        finish(value);
      });
      fixtureGroupMenuList.append(item);
    };

    addItem("Ungrouped", null);
    for (const group of state.fixtureGroups) {
      addItem(group.name, group.id);
    }

    fixtureGroupMenu.hidden = false;

    const anchorRect = anchor.getBoundingClientRect();
    placePopup(fixtureGroupMenu, anchorRect.left, anchorRect.bottom + 6, anchorRect.top);

    const currentEl = fixtureGroupMenuList.querySelector(".is-current");
    if (currentEl) currentEl.scrollIntoView({ block: "nearest" });

    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onDocKeydown, true);
  });
}

/**
 * @param {{ anchor: HTMLElement, current: number }} opts
 * @returns {Promise<number | null>}
 */
function pickCount({ anchor, current }) {
  closeCountPicker?.();
  closeChannelPicker?.();
  closeFixtureGroupPicker?.();
  closeChannelsCueMenu?.();
  closeCuePicker?.();
  closeActionMenu?.();
  closeFaderNameMenu?.();

  const clamped = Math.min(
    MAX_FIXTURE_CHANNELS,
    Math.max(1, Math.round(Number(current) || 1)),
  );

  return new Promise((resolve) => {
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const onDocPointer = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (countMenu.contains(target) || anchor.contains(target)) return;
      finish(null);
    };

    const onDocKeydown = (event) => {
      if (event.key === "Escape") finish(null);
    };

    const cleanup = () => {
      countMenu.hidden = true;
      if (closeCountPicker === finishNull) closeCountPicker = null;
      document.removeEventListener("pointerdown", onDocPointer, true);
      document.removeEventListener("keydown", onDocKeydown, true);
    };

    const finishNull = () => finish(null);
    closeCountPicker = finishNull;

    countMenuList.replaceChildren();
    for (let n = 1; n <= MAX_FIXTURE_CHANNELS; n++) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "menu-item";
      if (n === clamped) item.classList.add("is-current");
      item.setAttribute("role", "menuitem");
      item.textContent = String(n);
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        finish(n);
      });
      countMenuList.append(item);
    }

    countMenu.hidden = false;

    const anchorRect = anchor.getBoundingClientRect();
    placePopup(countMenu, anchorRect.left, anchorRect.bottom + 6, anchorRect.top);

    const currentEl = countMenuList.querySelector(".is-current");
    if (currentEl) currentEl.scrollIntoView({ block: "nearest" });

    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onDocKeydown, true);
  });
}

/**
 * @param {{ anchor: HTMLElement, current: number }} opts
 * @returns {Promise<number | null>}
 */
function pickChannel({ anchor, current }) {
  closeChannelPicker?.();
  closeCountPicker?.();
  closeFixtureGroupPicker?.();
  closeChannelsCueMenu?.();
  closeCuePicker?.();
  closeActionMenu?.();
  closeFaderNameMenu?.();

  return new Promise((resolve) => {
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const hideSubmenu = () => {
      channelMenuSub.hidden = true;
      channelMenuSubList.replaceChildren();
      for (const el of channelMenuList.querySelectorAll(".is-open")) {
        el.classList.remove("is-open");
      }
    };

    const showSubmenu = (groupIndex, trigger) => {
      const { start, end } = channelGroupRange(groupIndex);
      channelMenuSubLabel.textContent = `${start}–${end}`;
      channelMenuSubList.replaceChildren();

      for (const el of channelMenuList.querySelectorAll(".menu-item")) {
        el.classList.toggle("is-open", el === trigger);
      }

      for (let ch = start; ch <= end; ch++) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "menu-item";
        if (ch === current) item.classList.add("is-current");
        item.setAttribute("role", "menuitem");
        item.textContent = `Ch ${formatAddress(ch)}`;
        item.addEventListener("click", (event) => {
          event.stopPropagation();
          finish(ch);
        });
        channelMenuSubList.append(item);
      }

      channelMenuSub.hidden = false;

      // Prefer submenu to the right; flip left if it would go off-screen.
      const rootRect = channelMenu.getBoundingClientRect();
      const subWidth = 150;
      const spaceRight = window.innerWidth - rootRect.right;
      channelMenu.classList.toggle("flyout-left", spaceRight < subWidth + 8);

      const currentEl = channelMenuSubList.querySelector(".is-current");
      if (currentEl) currentEl.scrollIntoView({ block: "nearest" });
    };

    const renderRoot = () => {
      const q = channelMenuFilter.value.trim();
      channelMenuList.replaceChildren();
      hideSubmenu();

      if (q !== "") {
        // "45" matches channel 45 in every universe; "2/4" matches 2/4, 2/40, …
        const typed = /^(?:(\d+)\s*\/\s*)?(\d+)$/.exec(q);
        if (typed) {
          for (let ch = 1; ch <= channelLimit(); ch++) {
            if (typed[1] && universeOf(ch) !== Number(typed[1])) continue;
            if (!String(addressOf(ch)).startsWith(typed[2])) continue;
            const item = document.createElement("button");
            item.type = "button";
            item.className = "menu-item";
            if (ch === current) item.classList.add("is-current");
            item.textContent = `Ch ${formatAddress(ch)}`;
            item.addEventListener("click", (event) => {
              event.stopPropagation();
              finish(ch);
            });
            channelMenuList.append(item);
          }
        }
        return;
      }

      for (let g = 0; g < channelGroupCount(); g++) {
        const { start, end } = channelGroupRange(g);
        const containsCurrent = current >= start && current <= end;
        const item = document.createElement("button");
        item.type = "button";
        item.className = "menu-item";
        if (containsCurrent) item.classList.add("is-current");
        item.setAttribute("role", "menuitem");
        item.innerHTML = `<span>${formatAddress(start)}–${formatAddress(end)}</span><span class="popup-menu-caret">›</span>`;
        item.addEventListener("pointerenter", () => showSubmenu(g, item));
        item.addEventListener("click", (event) => {
          event.stopPropagation();
          showSubmenu(g, item);
        });
        channelMenuList.append(item);
      }

      const currentGroup = channelMenuList.querySelector(".is-current");
      if (currentGroup instanceof HTMLElement) {
        currentGroup.scrollIntoView({ block: "nearest" });
        showSubmenu(Math.floor((current - 1) / CHANNEL_GROUP_SIZE), currentGroup);
      }
    };

    const onFilterInput = () => renderRoot();

    const onFilterKeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        const n = parseAddress(channelMenuFilter.value.trim());
        if (n != null) finish(n);
        else {
          const first = channelMenuList.querySelector(".menu-item");
          if (first instanceof HTMLElement) first.click();
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      }
    };

    const onDocPointer = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (channelMenu.contains(target) || anchor.contains(target)) return;
      finish(null);
    };

    const onDocKeydown = (event) => {
      if (event.key === "Escape") finish(null);
    };

    const cleanup = () => {
      channelMenu.hidden = true;
      channelMenuSub.hidden = true;
      channelMenu.classList.remove("flyout-left");
      if (closeChannelPicker === finishNull) closeChannelPicker = null;
      channelMenuFilter.removeEventListener("input", onFilterInput);
      channelMenuFilter.removeEventListener("keydown", onFilterKeydown);
      document.removeEventListener("pointerdown", onDocPointer, true);
      document.removeEventListener("keydown", onDocKeydown, true);
    };

    const finishNull = () => finish(null);
    closeChannelPicker = finishNull;

    channelMenuFilter.value = "";
    renderRoot();
    channelMenu.hidden = false;

    const anchorRect = anchor.getBoundingClientRect();
    placePopup(channelMenu, anchorRect.left, anchorRect.bottom + 6, anchorRect.top);

    channelMenuFilter.addEventListener("input", onFilterInput);
    channelMenuFilter.addEventListener("keydown", onFilterKeydown);
    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onDocKeydown, true);

    queueMicrotask(() => channelMenuFilter.focus());
  });
}

function assignChannelToFader(faderIndex, targetIndex, channel) {
  const max = targetIndex == null ? 255 : state.patch[faderIndex][targetIndex].max;
  if (targetIndex == null) {
    state.patch[faderIndex] = [...state.patch[faderIndex], makeTarget(channel, max)];
  } else {
    state.patch[faderIndex][targetIndex] = makeTarget(channel, max);
  }
  const map = new Map();
  for (const t of state.patch[faderIndex]) map.set(t.channel, t);
  state.patch[faderIndex] = [...map.values()].sort((a, b) => a.channel - b.channel);
  persistAndRefresh();
  renderPatchTable();
}

export function renderPatchTable() {
  abortInlineEdits();
  patchTableEl.replaceChildren();

  for (let i = 0; i < FADER_COUNT; i++) {
    const card = document.createElement("article");
    card.className = "patch-card";
    card.dataset.fader = String(i);
    card.setAttribute("aria-selected", i === state.selectedFader ? "true" : "false");
    card.classList.toggle("is-selected", i === state.selectedFader);
    card.addEventListener("pointerdown", () => setSelectedFader(i));

    const head = document.createElement("div");
    head.className = "patch-card-head";

    const title = wirePatchFaderTitle(document.createElement("h3"), i);

    const subtitle = document.createElement("span");
    subtitle.className = "patch-card-sub";
    subtitle.textContent = isUnpatched(state.patch[i])
      ? "Unpatched"
      : `${state.patch[i].length} channel${state.patch[i].length === 1 ? "" : "s"}`;

    const actions = document.createElement("div");
    actions.className = "patch-card-actions";

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "quiet";
    renameBtn.textContent = "Rename";
    renameBtn.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    renameBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void renameFader(i, { preferInline: true });
    });

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "quiet";
    addBtn.textContent = "+ Channel";
    addBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      const used = new Set(state.patch[i].map((t) => t.channel));
      const suggested = nextFreeChannel(used);
      const channel = await pickChannel({
        anchor: addBtn,
        current: suggested,
      });
      if (channel == null) return;
      assignChannelToFader(i, null, channel);
    });

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "quiet";
    clearBtn.textContent = "Clear";
    clearBtn.disabled = isUnpatched(state.patch[i]);
    clearBtn.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    clearBtn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const ok = await confirmClearFaderPatch(faderName(i));
      if (!ok) return;
      state.patch[i] = [];
      persistAndRefresh();
      renderPatchTable();
    });

    actions.append(renameBtn, addBtn, clearBtn);
    head.append(title, subtitle, actions);

    const targets = document.createElement("div");
    targets.className = "patch-targets";

    if (isUnpatched(state.patch[i])) {
      const empty = document.createElement("button");
      empty.type = "button";
      empty.className = "patch-empty";
      empty.textContent = "Add a DMX channel";
      empty.addEventListener("click", () => addBtn.click());
      targets.append(empty);
    } else {
      state.patch[i].forEach((target, targetIndex) => {
        const cell = document.createElement("div");
        cell.className = "patch-fader";

        const channelPicker = makeChannelPickerButton({
          className: "channel-picker-btn patch-ch-btn",
          getChannel: () => state.patch[i][targetIndex].channel,
          setChannel: (channel) => {
            assignChannelToFader(i, targetIndex, channel);
          },
          ariaLabel: (ch) =>
            `${faderName(i)} channel ${ch}, click to change`,
        });

        const maxValue = document.createElement("div");
        maxValue.className = "value";
        maxValue.textContent = String(target.max);

        const maxSlider = document.createElement("input");
        maxSlider.type = "range";
        maxSlider.min = "0";
        maxSlider.max = "255";
        maxSlider.value = String(target.max);
        maxSlider.setAttribute("aria-label", `${faderName(i)} channel ${target.channel} maximum`);
        maxSlider.addEventListener("input", () => {
          const max = Number(maxSlider.value);
          state.patch[i][targetIndex] = makeTarget(target.channel, max);
          maxValue.textContent = String(max);
          persistAndRefresh();
        });

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "patch-remove";
        removeBtn.setAttribute("aria-label", `Remove channel ${target.channel} from ${faderName(i)}`);
        removeBtn.textContent = "✕";
        removeBtn.addEventListener("click", () => {
          state.patch[i] = state.patch[i].filter((_, idx) => idx !== targetIndex);
          persistAndRefresh();
          renderPatchTable();
        });

        cell.append(channelPicker.el, maxValue, maxSlider, removeBtn);
        targets.append(cell);
      });
    }

    card.append(head, targets);
    patchTableEl.append(card);
  }

  updateConflictBanner();
}

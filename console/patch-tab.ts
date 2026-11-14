// Patch tab: which channels each fader drives, and the channel, count
// and group pickers (also used by the Fixtures tab).
import { clampInt } from "../shared/numbers.ts";
import {
  FADER_COUNT,
  makeTarget,
  channelLimit,
  universeOf,
  addressOf,
  formatAddress,
  parseAddress,
} from "./patch.ts";
import { MAX_FIXTURE_CHANNELS } from "./fixtures.ts";
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
  openPopup,
  menuItem,
  scrollToCurrent,
} from "./dom.ts";
import { state } from "./state.ts";
import {
  faderName,
  setSelectedFader,
  abortInlineEdits,
  renameFader,
  wirePatchFaderTitle,
  isUnpatched,
  confirmClearFaderPatch,
} from "./faders.ts";
import { persistAndRefresh } from "./live.ts";
import { el, button } from "../shared/html.ts";
import { asChannel } from "../shared/address.ts";

const CHANNEL_GROUP_SIZE = 32;
/** Channel-picker groups of 32 across every universe in the show. */
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
    if (!used.has(asChannel(ch))) return ch;
  }
  return 1;
}

function channelGroupRange(groupIndex: number) {
  const start = groupIndex * CHANNEL_GROUP_SIZE + 1;
  const end = Math.min(start + CHANNEL_GROUP_SIZE - 1, channelLimit());
  return { start, end };
}


function setPickerButtonLabel(btn: HTMLButtonElement, text: string) {
  btn.replaceChildren();
  const label = el("span", "picker-btn-label", text);
  const caret = el("span", "picker-btn-caret");
  caret.setAttribute("aria-hidden", "true");
  caret.textContent = "▾";
  btn.append(label, caret);
}

/** A picker button and how to redraw it from its value. */
export type PickerButton = { el: HTMLButtonElement; sync: () => void };

/**
 * A button showing a value that picks a new one from a popup menu.
 * - pick: opens the menu; `isPicked` tells a choice from a dismissal
 * - show: puts the value on the button (label, data-, aria-label)
 */
function makePickerButton<V, R>({ className, title, get, set, pick, isPicked, show }: {
  className: string;
  title: string;
  get: () => V;
  set: (value: V) => void | Promise<void>;
  pick: (anchor: HTMLElement, current: V) => Promise<R>;
  isPicked: (result: R) => result is R & V;
  show: (btn: HTMLButtonElement, value: V) => void;
}) {
  const btn = button(className);
  btn.setAttribute("aria-haspopup", "menu");
  btn.title = title;
  const sync = () => show(btn, get());
  sync();
  btn.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const result = await pick(btn, get());
    if (!isPicked(result)) return;
    await set(result);
    sync();
  });
  return { el: btn, sync };
}

const isNumber = (v: number | null): v is number => v != null;

/** Shared DMX channel picker control (groups + search). */
export function makeChannelPickerButton({ getChannel, setChannel, className = "channel-picker-btn", ariaLabel }: {
  getChannel: () => number;
  setChannel: (channel: number) => void | Promise<void>;
  className?: string;
  ariaLabel?: string | ((channel: number) => string);
}) {
  return makePickerButton({
    className,
    title: "Choose DMX channel",
    get: getChannel,
    set: setChannel,
    pick: (anchor, current) => pickChannel({ anchor, current }),
    isPicked: isNumber,
    show: (btn, ch) => {
      setPickerButtonLabel(btn, `Ch${formatAddress(ch)}`);
      btn.dataset.channel = String(ch);
      btn.setAttribute("aria-label", typeof ariaLabel === "function" ? ariaLabel(ch) : ariaLabel || `Channel ${ch}`);
    },
  });
}

/** Channel-count picker (1…MAX_FIXTURE_CHANNELS). */
export function makeCountPickerButton({ getCount, setCount, className = "channel-picker-btn", ariaLabel }: {
  getCount: () => number;
  setCount: (count: number) => void | Promise<void>;
  className?: string;
  ariaLabel?: string | ((count: number) => string);
}) {
  return makePickerButton({
    className,
    title: "Number of channels",
    get: getCount,
    set: setCount,
    pick: (anchor, current) => pickCount({ anchor, current }),
    isPicked: isNumber,
    show: (btn, n) => {
      setPickerButtonLabel(btn, String(n));
      btn.dataset.count = String(n);
      btn.setAttribute("aria-label", typeof ariaLabel === "function" ? ariaLabel(n) : ariaLabel || `${n} channels`);
    },
  });
}

/** Fixture-group picker (Ungrouped + named groups). */
export function makeFixtureGroupPickerButton({ getGroupId, setGroupId, className = "channel-picker-btn", ariaLabel }: {
  getGroupId: () => string | null;
  setGroupId: (groupId: string | null) => void | Promise<void>;
  className?: string;
  ariaLabel?: string | ((groupId: string | null, label: string) => string);
}) {
  return makePickerButton({
    className,
    title: "Choose fixture group",
    get: getGroupId,
    set: setGroupId,
    pick: (anchor, current) => pickFixtureGroup({ anchor, current }),
    isPicked: (v: string | null | undefined) => v !== undefined, // undefined = dismissed
    show: (btn, groupId) => {
      const label = groupLabel(groupId);
      setPickerButtonLabel(btn, label);
      if (groupId) btn.dataset.groupId = groupId;
      else delete btn.dataset.groupId;
      btn.setAttribute("aria-label", typeof ariaLabel === "function" ? ariaLabel(groupId, label) : ariaLabel || `Group ${label}`);
    },
  });
}

function groupLabel(groupId: string | null | undefined) {
  if (!groupId) return "Ungrouped";
  return state.fixtureGroups.find((group) => group.id === groupId)?.name ?? "Ungrouped";
}

/** @returns string = group id, null = Ungrouped, undefined = dismissed */
function pickFixtureGroup({ anchor, current }: { anchor: HTMLElement; current: string | null }): Promise<string | null | undefined> {
  return openPopup<string | null, undefined>(fixtureGroupMenu, anchor, {
    dismissed: undefined,
    fill: (finish) => fixtureGroupMenuList.replaceChildren(
      menuItem("Ungrouped", () => finish(null), { current: current == null }),
      ...state.fixtureGroups.map((group) => menuItem(group.name, () => finish(group.id), { current: group.id === current })),
    ),
    shown: () => scrollToCurrent(fixtureGroupMenuList),
  });
}

function pickCount({ anchor, current }: { anchor: HTMLElement; current: number }): Promise<number | null> {
  const clamped = clampInt(Number(current) || 1, 1, MAX_FIXTURE_CHANNELS);
  return openPopup<number, null>(countMenu, anchor, {
    dismissed: null,
    fill: (finish) => countMenuList.replaceChildren(
      ...Array.from({ length: MAX_FIXTURE_CHANNELS }, (_, i) => menuItem(String(i + 1), () => finish(i + 1), { current: i + 1 === clamped })),
    ),
    shown: () => scrollToCurrent(countMenuList),
  });
}

function pickChannel({ anchor, current }: { anchor: HTMLElement; current: number }): Promise<number | null> {
  return openPopup<number, null>(channelMenu, anchor, {
    dismissed: null,
    fill: (finish) => {
      const channelItem = (ch: number) => menuItem(`Ch ${formatAddress(ch)}`, () => finish(ch), { current: ch === current });

      const hideSubmenu = () => {
        channelMenuSub.hidden = true;
        channelMenuSubList.replaceChildren();
        for (const item of channelMenuList.querySelectorAll<HTMLElement>(".is-open")) item.classList.remove("is-open");
      };

      const showSubmenu = (groupIndex: number, trigger: Element) => {
        const { start, end } = channelGroupRange(groupIndex);
        channelMenuSubLabel.textContent = `${start}–${end}`;
        for (const item of channelMenuList.querySelectorAll<HTMLElement>(".menu-item")) item.classList.toggle("is-open", item === trigger);
        channelMenuSubList.replaceChildren(...Array.from({ length: end - start + 1 }, (_, i) => channelItem(start + i)));
        channelMenuSub.hidden = false;

        // Prefer submenu to the right; flip left if it would go off-screen.
        const rootRect = channelMenu.getBoundingClientRect();
        const subWidth = 150;
        const spaceRight = window.innerWidth - rootRect.right;
        channelMenu.classList.toggle("flyout-left", spaceRight < subWidth + 8);
        scrollToCurrent(channelMenuSubList);
      };

      const renderRoot = () => {
        const q = channelMenuFilter.value.trim();
        channelMenuList.replaceChildren();
        hideSubmenu();

        if (q !== "") {
          // "45" matches channel 45 in every universe; "2/4" matches 2/4, 2/40, …
          const typed = /^(?:(\d+)\s*\/\s*)?(\d+)$/.exec(q);
          if (typed) {
            for (let n = 1; n <= channelLimit(); n++) {
              const ch = asChannel(n);
              if (typed[1] && universeOf(ch) !== Number(typed[1])) continue;
              if (!String(addressOf(ch)).startsWith(typed[2])) continue;
              channelMenuList.append(channelItem(ch));
            }
          }
          return;
        }

        for (let g = 0; g < channelGroupCount(); g++) {
          const { start, end } = channelGroupRange(g);
          const item = menuItem("", () => showSubmenu(g, item), { current: current >= start && current <= end });
          item.innerHTML = `<span>${formatAddress(start)}–${formatAddress(end)}</span><span class="popup-menu-caret">›</span>`;
          item.addEventListener("pointerenter", () => showSubmenu(g, item));
          channelMenuList.append(item);
        }

        const currentGroup = channelMenuList.querySelector<HTMLElement>(".is-current");
        if (currentGroup) {
          currentGroup.scrollIntoView({ block: "nearest" });
          showSubmenu(Math.floor((current - 1) / CHANNEL_GROUP_SIZE), currentGroup);
        }
      };

      const onFilterKeydown = (event: KeyboardEvent) => {
        if (event.key === "Enter") {
          event.preventDefault();
          const n = parseAddress(channelMenuFilter.value.trim());
          if (n != null) finish(n);
          else channelMenuList.querySelector<HTMLElement>(".menu-item")?.click();
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(null);
        }
      };

      channelMenuFilter.value = "";
      renderRoot();
      channelMenuFilter.addEventListener("input", renderRoot);
      channelMenuFilter.addEventListener("keydown", onFilterKeydown);
      queueMicrotask(() => channelMenuFilter.focus());
      return () => {
        channelMenuSub.hidden = true;
        channelMenu.classList.remove("flyout-left");
        channelMenuFilter.removeEventListener("input", renderRoot);
        channelMenuFilter.removeEventListener("keydown", onFilterKeydown);
      };
    },
  });
}

function assignChannelToFader(faderIndex: number, targetIndex: number | null, channel: number) {
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
    const card = el("article", "patch-card");
    card.dataset.fader = String(i);
    card.setAttribute("aria-selected", i === state.selectedFader ? "true" : "false");
    card.classList.toggle("is-selected", i === state.selectedFader);
    card.addEventListener("pointerdown", () => setSelectedFader(i));

    const head = el("div", "patch-card-head");

    const title = wirePatchFaderTitle(document.createElement("h3"), i);

    const subtitle = el("span", "patch-card-sub");
    subtitle.textContent = isUnpatched(state.patch[i])
      ? "Unpatched"
      : `${state.patch[i].length} channel${state.patch[i].length === 1 ? "" : "s"}`;

    const actions = el("div", "patch-card-actions");

    const renameBtn = button("quiet", "Rename");
    renameBtn.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    renameBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void renameFader(i, { preferInline: true });
    });

    const addBtn = button("quiet", "+ Channel");
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

    const clearBtn = button("quiet", "Clear");
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

    const targets = el("div", "patch-targets");

    if (isUnpatched(state.patch[i])) {
      const empty = button("patch-empty", "Add a DMX channel");
      empty.addEventListener("click", () => addBtn.click());
      targets.append(empty);
    } else {
      state.patch[i].forEach((target, targetIndex) => {
        const cell = el("div", "patch-fader");

        const channelPicker = makeChannelPickerButton({
          className: "channel-picker-btn patch-ch-btn",
          getChannel: () => state.patch[i][targetIndex].channel,
          setChannel: (channel) => {
            assignChannelToFader(i, targetIndex, channel);
          },
          ariaLabel: (ch) =>
            `${faderName(i)} channel ${ch}, click to change`,
        });

        const maxValue = el("div", "value", String(target.max));

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

        const removeBtn = button("patch-remove");
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

// Cue rows on the Run tab: drawing, reordering, renaming, cue menus.
import { FADER_COUNT } from "./patch.ts";
import { MAX_CUES, MIN_CUES, createCue, moveCue, normalizeCueFadeTime, CUE_FADE_TIMES } from "./songs.ts";
import {
  cuesScroll,
  startDragScroll,
  wireRowDrag,
  type DragScroll,
  cuesEl,
  currentCueTitle,
  channelsCueMenu,
  channelsCueMenuList,
  actionMenu,
  actionMenuList,
  tabRun,
  dropSlot,
  showDropLine,
  closePopup,
  openPopup,
  menuItem,
} from "./dom.ts";
import { getActiveSong, bindActiveSong, syncPlaybackPair, persistSession, state } from "./state.ts";
import {
  cueName,
  cueLabel,
  fillCueTitle,
  faderName,
  faderCell,
  levelSlider,
  abortInlineEdits,
  addColorBars,
  refreshColorBars,
  confirmRemoveCue,
} from "./faders.ts";
import {
  pushToDmx,
  refreshCueSelects,
  updateCuesButton,
  cueHint,
  setSelectedCue,
  pickCue,
  renderSelectedGroup,
} from "./live.ts";
import { inlineRename, clickToRename } from "./inline-rename.ts";
import { el, button } from "../shared/html.ts";
import { clamp } from "../shared/numbers.ts";

export let cueUi: { valueEls: HTMLElement[]; patchLabelEls: HTMLElement[]; sliders: HTMLInputElement[] }[] = [];

let dragCueId: string | null = null;
let dragScroll: DragScroll | null = null;



function wireCueRowDrag(bank: HTMLElement, handle: HTMLElement, index: number) {
  const cueId = getActiveSong().cues[index]?.id;
  if (!cueId) return;

  wireRowDrag(bank, handle, cueId, (event) => {
    abortInlineEdits();
    dragCueId = cueId;
    bank.dataset.dragCueId = cueId;
    dragScroll?.stop();
    dragScroll = startDragScroll(cuesScroll, tabRun, "is-dragging-cue", () => dragCueId != null, event.clientY);
  }, () => {
    delete bank.dataset.dragCueId;
    clearCueDropMarks();
    dragScroll?.stop();
    dragCueId = null;
  });
}

/** Where the dragged cue would land (see dropSlot), or null. */
function cueDropSlot(clientY: number) {
  const rows = [...cuesEl.querySelectorAll<HTMLElement>(":scope > .fader-row")];
  const slot = dropSlot(rows, rows.find((row) => row.dataset.dragCueId === dragCueId), clientY);
  return slot == null ? null : { rows, slot };
}

// One line in the gap between the two cues the dragged cue will land between.
cuesEl.addEventListener("dragover", (event) => {
  if (!dragCueId) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  dragScroll?.track(event.clientY);
  const drop = cueDropSlot(event.clientY);
  if (drop) showDropLine(drop.rows, drop.slot);
  else clearCueDropMarks();
});

cuesEl.addEventListener("dragleave", (event) => {
  if (!(event.relatedTarget instanceof Node) || !cuesEl.contains(event.relatedTarget)) clearCueDropMarks();
});

cuesEl.addEventListener("drop", (event) => {
  if (!dragCueId) return;
  event.preventDefault();
  const fromId = dragCueId;
  const drop = cueDropSlot(event.clientY);
  clearCueDropMarks();
  dragScroll?.stop();
  dragCueId = null;
  if (!drop) return;
  const { rows, slot } = drop;
  const after = slot === rows.length;
  const targetId = getActiveSong().cues[after ? rows.length - 1 : slot]?.id;
  const song = getActiveSong();
  const selectedId = song.cues[state.selectedCue]?.id;
  const fromSelId = song.cues[state.fromCue]?.id;
  if (!targetId || !moveCue(song, fromId, targetId, after)) return;
  const indexOf = (id: string) =>
    id ? song.cues.findIndex((t) => t.id === id) : -1;
  state.selectedCue = Math.max(0, indexOf(selectedId));
  state.fromCue = Math.max(0, indexOf(fromSelId));
  bindActiveSong();
  renderCues();
  renderSelectedGroup();
  pushToDmx();
  persistSession();
});

function clearCueDropMarks() {
  for (const el of cuesEl.querySelectorAll<HTMLElement>(".is-drop-before, .is-drop-after")) {
    el.classList.remove("is-drop-before", "is-drop-after");
  }
}

export function renderCues() {
  abortInlineEdits();
  cuesEl.replaceChildren();
  cueUi = [];
  state.selectedCue = clamp(state.selectedCue, 0, Math.max(0, state.cueLevels.length - 1));

  syncPlaybackPair();
  for (let r = 0; r < state.cueLevels.length; r++) {
    const bank = el("section", "fader-row");
    bank.dataset.row = String(r);
    bank.classList.toggle("is-selected", r === state.selectedCue);
    bank.classList.toggle("is-current", r === state.fromCue);
    bank.classList.toggle("is-next", r === state.toCue);

    const head = el("div", "fader-row-head");
    head.tabIndex = 0;
    head.setAttribute("role", "button");
    head.setAttribute("aria-pressed", r === state.selectedCue ? "true" : "false");
    head.title = "Click to make this the live cue";

    const dragHandle = el("div", "fader-row-drag-handle");
    dragHandle.title = "Drag to reorder";
    dragHandle.setAttribute("aria-hidden", "true");
    dragHandle.textContent = "⋮⋮";

    const titleGroup = el("div", "cue-title-group");

    const title = el("h3", "cue-title");
    fillCueTitle(title, r, true);
    title.title = "Double-click to name this cue";

    const menuBtn = button("cue-menu-btn");
    menuBtn.innerHTML = '<span class="cue-menu-dots" aria-hidden="true"></span>';
    menuBtn.title = "Cue options";
    menuBtn.setAttribute("aria-label", `Options for ${cueLabel(r)}`);
    menuBtn.setAttribute("aria-haspopup", "menu");
    menuBtn.setAttribute("aria-expanded", "false");
    menuBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      if (menuBtn.getAttribute("aria-expanded") === "true") {
        closePopup();
        return;
      }
      void openCueMenu(menuBtn, r);
    });

    titleGroup.append(title, menuBtn);

    const fadeGroup = el("div", "cue-fade");
    fadeGroup.title = "Fade time into this cue (how long GO takes to fade to it)";
    const fadeLabel = el("span", "cue-fade-label", "In");
    const fadeSelect = el("select", "cue-fade-select");
    fadeSelect.setAttribute(
      "aria-label",
      `Fade time into ${cueLabel(r)}`,
    );
    const cue = getActiveSong().cues[r];
    const fadeValue = normalizeCueFadeTime(cue?.fadeTime);
    for (const sec of CUE_FADE_TIMES) {
      const opt = document.createElement("option");
      opt.value = String(sec);
      opt.textContent = `${sec}s`;
      if (sec === fadeValue) opt.selected = true;
      fadeSelect.append(opt);
    }
    fadeSelect.addEventListener("click", (event) => event.stopPropagation());
    fadeSelect.addEventListener("pointerdown", (event) => event.stopPropagation());
    fadeSelect.addEventListener("change", (event) => {
      event.stopPropagation();
      const next = normalizeCueFadeTime(fadeSelect.value);
      if (cue) cue.fadeTime = next;
      if (r === state.toCue) refreshCueSelects();
      persistSession();
    });
    fadeGroup.append(fadeLabel, fadeSelect);

    const hint = el("span", "fader-row-hint", cueHint(r));

    head.append(dragHandle, titleGroup, fadeGroup, hint);
    wireCueRowDrag(bank, dragHandle, r);
    head.addEventListener("click", (event) => {
      if (
        event.target instanceof Element &&
        event.target.closest(
          ".cue-title-input, .fader-row-drag-handle, .cue-menu-btn, .cue-fade",
        )
      ) {
        return;
      }
      setSelectedCue(r);
    });
    head.addEventListener("keydown", (event) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.target instanceof HTMLSelectElement) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setSelectedCue(r);
      }
    });
    title.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      beginInlineRename(r);
    });

    const grid = el("div", "faders");
    grid.setAttribute("aria-label", `${cueLabel(r)} faders`);

    const valueEls = [];
    const patchLabelEls = [];
    const sliders = [];

    for (let i = 0; i < FADER_COUNT; i++) {
      const { wrap, patched, value } = faderCell(i, state.cueLevels[r][i]);
      patchLabelEls[i] = patched;
      valueEls[i] = value;
      sliders[i] = levelSlider(wrap, i, state.cueLevels[r][i], `${cueLabel(r)} ${faderName(i)}`, (level) => {
        state.cueLevels[r][i] = level;
        value.textContent = String(level);
        pushToDmx();
      });
      grid.append(wrap);
    }

    addColorBars(grid, r);
    bank.append(head, grid);
    cuesEl.append(bank);
    cueUi[r] = { valueEls, patchLabelEls, sliders };
  }

  refreshCueSelects();
  refreshColorBars();
}

function applyCueName(index: number, name: string) {
  // An empty name is fine: the cue is then just "Cue N".
  const next = name.trim();
  if (next === cueName(index)) return false;
  state.cueNames[index] = next;
  const song = getActiveSong();
  if (song.cues[index]) song.cues[index].name = next;
  refreshCueSelects();
  updateCuesButton();
  persistSession();
  return true;
}

/** Edit a cue name in place with a text input. */
function beginInlineRename(index: number, target?: HTMLElement) {
  if (index < 0 || index >= state.cueLevels.length) return;
  abortInlineEdits();

  const title =
    target ??
    cuesEl.querySelector<HTMLElement>(`.fader-row[data-row="${index}"] .cue-title-group .cue-title`) ??
    (index === state.selectedCue ? currentCueTitle : null);
  if (!(title instanceof HTMLElement) || !title.isConnected) return;

  // Only the name is edited: "Cue N" stays in place in front of it.
  fillCueTitle(title, index, true);
  const nameEl = title.querySelector<HTMLElement>(".cue-name");
  if (!nameEl) return;
  inlineRename({
    replace: nameEl,
    value: cueName(index),
    label: "Cue name",
    className: title.id === "currentCueTitle" ? "cue-title-input cue-title-input-lg" : "cue-title-input",
    placeholder: `Cue ${index + 1} name`,
    done: (name) => {
      // An empty name is kept: the cue is then just "Cue N".
      const changed = name != null && applyCueName(index, name);
      fillCueTitle(title, index, true);
      if (changed) {
        // Rebuild the rows so every label picks up the new name.
        renderCues();
        renderSelectedGroup();
      }
    },
  });
}

export function wireCurrentCueTitle(el: HTMLElement) {
  clickToRename(el, () => beginInlineRename(state.selectedCue, el));
}

export function openChannelsCueMenu(anchor: HTMLElement): Promise<"select" | null> {
  return openPopup<"select", null>(channelsCueMenu, anchor, {
    dismissed: null,
    ariaExpanded: true,
    place: { alignRight: true },
    fill: (finish) => channelsCueMenuList.replaceChildren(menuItem("Select cue", () => finish("select"))),
  }).then(async (action) => {
    if (action !== "select") return action;
    const index = await pickCue({ anchor });
    if (index != null) setSelectedCue(index);
    return action;
  });
}

/** An index into a list after the item at `removed` is taken out (it lands on the next item, or the new last). */
function adjustIndexAfterRemove(index: number, removed: number, lengthAfter: number) {
  if (index > removed) return index - 1;
  if (index === removed) return Math.min(removed, lengthAfter - 1);
  return index;
}

async function removeCueAt(index: number) {
  const song = getActiveSong();
  if (song.cues.length <= MIN_CUES) return false;
  if (index < 0 || index >= song.cues.length) return false;
  const ok = await confirmRemoveCue(cueLabel(index));
  if (!ok) return false;
  song.cues.splice(index, 1);
  state.fromCue = adjustIndexAfterRemove(state.fromCue, index, song.cues.length);
  state.selectedCue = adjustIndexAfterRemove(state.selectedCue, index, song.cues.length);
  bindActiveSong();
  renderCues();
  renderSelectedGroup();
  pushToDmx();
  persistSession();
  return true;
}

/** Insert a copy of a cue (levels, name, In time) right after it and make the copy LIVE. */
function duplicateCueAt(index: number) {
  const song = getActiveSong();
  if (song.cues.length >= MAX_CUES) return false;
  const cue = song.cues[index];
  if (!cue) return false;
  song.cues.splice(index + 1, 0, createCue({ name: state.cueNames[index], levels: cue.levels, fadeTime: cue.fadeTime, aims: cue.aims }));
  bindActiveSong();
  state.selectedCue = index + 1;
  state.fromCue = state.selectedCue;
  syncPlaybackPair();
  renderCues();
  renderSelectedGroup();
  pushToDmx();
  persistSession();
  return true;
}

/** One entry in a popup action menu; `action` is what the menu resolves with. */
export type ActionMenuItem = { label: string; action: string; danger?: boolean; disabled?: boolean };

/**
 * A small menu of actions below `anchor` (the ⋮ menus of cues and songs).
 * Resolves with the chosen item's action, or null when it's closed.
 */

export function openActionMenu(anchor: HTMLElement, ariaLabel: string, items: ActionMenuItem[]): Promise<string | null> {
  return openPopup<string, null>(actionMenu, anchor, {
    dismissed: null,
    ariaExpanded: true,
    fill: (finish) => {
      actionMenuList.setAttribute("aria-label", ariaLabel);
      actionMenuList.replaceChildren(...items.map(({ label, action, danger, disabled }) => menuItem(label, () => finish(action), { danger, disabled })));
    },
  });
}

async function openCueMenu(anchor: HTMLElement, index: number) {
  const action = await openActionMenu(anchor, "Cue actions", [
    { label: "Rename", action: "rename" },
    { label: "Duplicate", action: "duplicate" },
    { label: "Remove", action: "remove", danger: true, disabled: state.cueLevels.length <= MIN_CUES },
  ]);
  if (action === "rename") beginInlineRename(index);
  if (action === "duplicate") duplicateCueAt(index);
  if (action === "remove") await removeCueAt(index);
}

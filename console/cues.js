// Cue rows on the Songs page: drawing, reordering, renaming, cue menus.
import { FADER_COUNT, formatChannelLabel, formatChannelTooltip } from "./patch.js";
import { MAX_CUES, MIN_CUES, createCue, moveCue, normalizeCueFadeTime, CUE_FADE_TIMES } from "./songs.js";
import {
  cuesScroll,
  cuesEl,
  currentCueTitle,
  channelsCueMenu,
  channelsCueMenuList,
  cueMenu,
  cueMenuList,
  pageSongs,
} from "./dom.js";
import { getActiveSong, bindActiveSong, syncPlaybackPair, persistSession, state } from "./state.js";
import {
  cueName,
  cueLabel,
  fillCueTitle,
  faderName,
  setSelectedFader,
  makeFaderNameLabel,
  abortInlineEdits,
  closeFaderNameMenu,
  isUnpatched,
  applyFaderPatchState,
  addColorBars,
  refreshColorBars,
  confirmRemoveCue,
} from "./faders.js";
import {
  pushToDmx,
  refreshCueSelects,
  updateCuesButton,
  cueHint,
  setSelectedCue,
  closeCuePicker,
  pickCue,
  renderSelectedGroup,
} from "./live.js";
import { adjustIndexAfterRemove } from "./songs-page.js";
import { closeChannelPicker, closeCountPicker, closeFixtureGroupPicker } from "./patch-page.js";

/** @type {{ valueEls: HTMLElement[], patchLabelEls: HTMLElement[], sliders: HTMLInputElement[] }[]} */
export let cueUi = [];
/** @type {null | (() => void)} */
export let closeChannelsCueMenu = null;

/** @type {string | null} */
let dragCueId = null;
/** @type {number | null} */
let cueDragClientY = null;
/** @type {number | null} */
let cueDragScrollRaf = null;
/** @type {null | (() => void)} */
let stopCueDragSession = null;

const CUE_DRAG_SCROLL_EDGE = 56;
const CUE_DRAG_SCROLL_MAX = 24;

function tickCueDragScroll() {
  cueDragScrollRaf = null;
  if (!dragCueId) return;

  if (cueDragClientY != null) {
    const rect = cuesScroll.getBoundingClientRect();
    const y = cueDragClientY;
    let dy = 0;

    if (y < rect.top) {
      dy = -CUE_DRAG_SCROLL_MAX;
    } else if (y > rect.bottom) {
      dy = CUE_DRAG_SCROLL_MAX;
    } else if (y < rect.top + CUE_DRAG_SCROLL_EDGE) {
      const distance = rect.top + CUE_DRAG_SCROLL_EDGE - y;
      const t = Math.min(1, distance / CUE_DRAG_SCROLL_EDGE);
      dy = -Math.ceil(Math.max(2, t * CUE_DRAG_SCROLL_MAX));
    } else if (y > rect.bottom - CUE_DRAG_SCROLL_EDGE) {
      const distance = y - (rect.bottom - CUE_DRAG_SCROLL_EDGE);
      const t = Math.min(1, distance / CUE_DRAG_SCROLL_EDGE);
      dy = Math.ceil(Math.max(2, t * CUE_DRAG_SCROLL_MAX));
    }

    if (dy !== 0) {
      const maxScroll = Math.max(
        0,
        cuesScroll.scrollHeight - cuesScroll.clientHeight,
      );
      cuesScroll.scrollTop = Math.max(
        0,
        Math.min(maxScroll, cuesScroll.scrollTop + dy),
      );
    }
  }

  cueDragScrollRaf = requestAnimationFrame(tickCueDragScroll);
}

/** @param {number} [initialClientY] */
function startCueDragSession(initialClientY) {
  stopCueDragSession?.();
  cueDragClientY =
    typeof initialClientY === "number" ? initialClientY : null;
  pageSongs.classList.add("is-dragging-cue");

  const onDragOver = (event) => {
    if (!dragCueId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    cueDragClientY = event.clientY;
  };

  document.addEventListener("dragover", onDragOver, true);
  cueDragScrollRaf = requestAnimationFrame(tickCueDragScroll);

  stopCueDragSession = () => {
    document.removeEventListener("dragover", onDragOver, true);
    if (cueDragScrollRaf != null) {
      cancelAnimationFrame(cueDragScrollRaf);
      cueDragScrollRaf = null;
    }
    cueDragClientY = null;
    pageSongs.classList.remove("is-dragging-cue");
    stopCueDragSession = null;
  };
}

/**
 * @param {HTMLElement} bank
 * @param {HTMLElement} handle
 * @param {number} index
 */
function wireCueRowDrag(bank, handle, index) {
  const cueId = getActiveSong().cues[index]?.id;
  if (!cueId) return;

  handle.addEventListener("pointerdown", (event) => {
    if (event.button != null && event.button !== 0) return;
    bank.dataset.dragArmed = "1";
    const onUp = () => {
      window.removeEventListener("pointerup", onUp, true);
      requestAnimationFrame(() => {
        if (!bank.classList.contains("is-dragging")) delete bank.dataset.dragArmed;
      });
    };
    window.addEventListener("pointerup", onUp, true);
  });

  bank.draggable = true;
  bank.addEventListener("dragstart", (event) => {
    if (bank.dataset.dragArmed !== "1") {
      event.preventDefault();
      return;
    }
    delete bank.dataset.dragArmed;
    abortInlineEdits();
    dragCueId = cueId;
    bank.classList.add("is-dragging");
    bank.dataset.dragCueId = cueId;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", cueId);
    }
    startCueDragSession(event.clientY);
  });

  bank.addEventListener("dragend", () => {
    delete bank.dataset.dragArmed;
    delete bank.dataset.dragCueId;
    bank.classList.remove("is-dragging");
    clearCueDropMarks();
    stopCueDragSession?.();
    dragCueId = null;
  });
}

/**
 * Where a dragged cue would land: the slot (0 = before the first cue,
 * n = after the last) nearest the pointer, or null when it would stay put.
 * @param {number} clientY
 */
function cueDropSlot(clientY) {
  const rows = [...cuesEl.querySelectorAll(":scope > .fader-row")];
  const from = rows.findIndex((row) => row.dataset.dragCueId === dragCueId);
  let slot = rows.length;
  for (let i = 0; i < rows.length; i++) {
    const rect = rows[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      slot = i;
      break;
    }
  }
  if (from < 0 || slot === from || slot === from + 1) return null;
  return { rows, slot };
}

// One line in the gap between the two cues the dragged cue will land between.
cuesEl.addEventListener("dragover", (event) => {
  if (!dragCueId) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  cueDragClientY = event.clientY;
  clearCueDropMarks();
  const drop = cueDropSlot(event.clientY);
  if (!drop) return;
  const { rows, slot } = drop;
  if (slot < rows.length) rows[slot].classList.add("is-drop-before");
  else rows[rows.length - 1].classList.add("is-drop-after");
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
  stopCueDragSession?.();
  dragCueId = null;
  if (!drop) return;
  const { rows, slot } = drop;
  const after = slot === rows.length;
  const targetId = getActiveSong().cues[after ? rows.length - 1 : slot]?.id;
  const song = getActiveSong();
  const selectedId = song.cues[state.selectedCue]?.id;
  const fromSelId = song.cues[state.fromCue]?.id;
  const toSelId = song.cues[state.toCue]?.id;
  if (!targetId || !moveCue(song, fromId, targetId, after)) return;
  const indexOf = (id) =>
    id ? song.cues.findIndex((t) => t.id === id) : -1;
  state.selectedCue = Math.max(0, indexOf(selectedId));
  state.fromCue = Math.max(0, indexOf(fromSelId));
  state.toCue = Math.max(0, indexOf(toSelId));
  bindActiveSong();
  if (state.fromCue === state.toCue && state.cueLevels.length > 1) {
    state.toCue = (state.fromCue + 1) % state.cueLevels.length;
  }
  renderCues();
  renderSelectedGroup();
  pushToDmx();
  persistSession();
});

function clearCueDropMarks() {
  for (const el of cuesEl.querySelectorAll(".is-drop-before, .is-drop-after")) {
    el.classList.remove("is-drop-before", "is-drop-after");
  }
}

export function renderCues() {
  abortInlineEdits();
  cuesEl.replaceChildren();
  cueUi = [];
  state.selectedCue = Math.min(Math.max(0, state.selectedCue), Math.max(0, state.cueLevels.length - 1));

  syncPlaybackPair();
  for (let r = 0; r < state.cueLevels.length; r++) {
    const bank = document.createElement("section");
    bank.className = "fader-row";
    bank.dataset.row = String(r);
    bank.classList.toggle("is-selected", r === state.selectedCue);
    bank.classList.toggle("is-current", r === state.fromCue);
    bank.classList.toggle("is-next", r === state.toCue);

    const head = document.createElement("div");
    head.className = "fader-row-head";
    head.tabIndex = 0;
    head.setAttribute("role", "button");
    head.setAttribute("aria-pressed", r === state.selectedCue ? "true" : "false");
    head.title = "Click to make this the live cue";

    const dragHandle = document.createElement("div");
    dragHandle.className = "fader-row-drag-handle";
    dragHandle.title = "Drag to reorder";
    dragHandle.setAttribute("aria-hidden", "true");
    dragHandle.textContent = "⋮⋮";

    const titleGroup = document.createElement("div");
    titleGroup.className = "cue-title-group";

    const title = document.createElement("h3");
    title.className = "cue-title";
    fillCueTitle(title, r, true);
    title.title = "Double-click to name this cue";

    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "cue-menu-btn";
    menuBtn.innerHTML = '<span class="cue-menu-dots" aria-hidden="true"></span>';
    menuBtn.title = "Cue options";
    menuBtn.setAttribute("aria-label", `Options for ${cueLabel(r)}`);
    menuBtn.setAttribute("aria-haspopup", "menu");
    menuBtn.setAttribute("aria-expanded", "false");
    menuBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      if (menuBtn.getAttribute("aria-expanded") === "true") {
        closeCueMenu?.();
        return;
      }
      void openCueMenu(menuBtn, r);
    });

    titleGroup.append(title, menuBtn);

    const fadeGroup = document.createElement("div");
    fadeGroup.className = "cue-fade";
    fadeGroup.title = "Fade time into this cue (how long GO takes to fade to it)";
    const fadeLabel = document.createElement("span");
    fadeLabel.className = "cue-fade-label";
    fadeLabel.textContent = "In";
    const fadeSelect = document.createElement("select");
    fadeSelect.className = "cue-fade-select";
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

    const hint = document.createElement("span");
    hint.className = "fader-row-hint";
    hint.textContent = cueHint(r);

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

    const grid = document.createElement("div");
    grid.className = "faders";
    grid.setAttribute("aria-label", `${cueLabel(r)} faders`);

    const valueEls = [];
    const patchLabelEls = [];
    const sliders = [];

    for (let i = 0; i < FADER_COUNT; i++) {
      const wrap = document.createElement("div");
      wrap.className = "fader";
      wrap.dataset.fader = String(i);
      wrap.classList.toggle("is-selected-fader", i === state.selectedFader);
      wrap.addEventListener("pointerdown", () => setSelectedFader(i));

      const label = makeFaderNameLabel(i);

      const patched = document.createElement("div");
      patched.className = "patch-target";
      patched.textContent = formatChannelLabel(state.patch[i]);
      patched.title = formatChannelTooltip(state.patch[i]);
      if (isUnpatched(state.patch[i])) patched.classList.add("is-unpatched");
      patchLabelEls[i] = patched;

      const value = document.createElement("div");
      value.className = "value";
      value.textContent = String(state.cueLevels[r][i]);
      valueEls[i] = value;

      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = "255";
      slider.value = String(state.cueLevels[r][i]);
      slider.setAttribute("aria-label", `${cueLabel(r)} ${faderName(i)}`);
      applyFaderPatchState(wrap, slider, state.patch[i]);
      slider.addEventListener("input", () => {
        setSelectedFader(i);
        state.cueLevels[r][i] = Number(slider.value);
        value.textContent = String(state.cueLevels[r][i]);
        pushToDmx();
      });
      sliders[i] = slider;

      wrap.append(label, patched, value, slider);
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

/** @type {null | (() => void)} */
export let endInlineRename = null;

function applyCueName(index, name) {
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

/**
 * Edit a cue name in place with a text input.
 * @param {number} index
 * @param {HTMLElement} [target]
 */
function beginInlineRename(index, target) {
  if (index < 0 || index >= state.cueLevels.length) return;
  abortInlineEdits();

  const title =
    target ??
    cuesEl.querySelector(`.fader-row[data-row="${index}"] .cue-title-group .cue-title`) ??
    (index === state.selectedCue ? currentCueTitle : null);
  if (!(title instanceof HTMLElement) || !title.isConnected) return;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "cue-title-input";
  if (title.id === "currentCueTitle") {
    input.classList.add("cue-title-input-lg");
  }
  input.maxLength = 40;
  input.value = cueName(index);
  input.placeholder = `Cue ${index + 1} name`;
  input.setAttribute("aria-label", "Cue name");
  input.autocomplete = "off";
  input.spellcheck = false;

  // Only the name is edited: "Cue N" stays in place in front of it.
  fillCueTitle(title, index, true);
  title.querySelector(".cue-name")?.replaceWith(input);
  for (const type of ["click", "dblclick", "pointerdown"]) input.addEventListener(type, (event) => event.stopPropagation());
  input.focus();
  input.select();

  let finished = false;
  const finish = (commit) => {
    if (finished) return;
    finished = true;
    if (endInlineRename === finishAbort) endInlineRename = null;
    input.removeEventListener("keydown", onKeydown);
    input.removeEventListener("blur", onBlur);

    const next = input.value.trim();
    const changed = Boolean(commit && applyCueName(index, next));

    fillCueTitle(title, index, true);

    if (changed) {
      // Rebuild row UI so every label picks up the new name
      renderCues();
      renderSelectedGroup();
    }
  };

  const finishAbort = () => finish(false);
  endInlineRename = finishAbort;

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

export function wireCurrentCueTitle(el) {
  el.title = "Click to rename";
  el.setAttribute("role", "button");
  el.tabIndex = 0;
  el.addEventListener("click", () => {
    beginInlineRename(state.selectedCue, el);
  });
  el.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      beginInlineRename(state.selectedCue, el);
    }
  });
}

/**
 * @param {HTMLElement} anchor
 * @returns {Promise<"select" | null>}
 */
export function openChannelsCueMenu(anchor) {
  closeChannelsCueMenu?.();
  closeCuePicker?.();
  closeCueMenu?.();
  closeFaderNameMenu?.();
  closeChannelPicker?.();
  closeCountPicker?.();
  closeFixtureGroupPicker?.();

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
      if (channelsCueMenu.contains(target) || anchor.contains(target)) return;
      finish(null);
    };

    const onDocKeydown = (event) => {
      if (event.key === "Escape") finish(null);
    };

    const cleanup = () => {
      channelsCueMenu.hidden = true;
      anchor.setAttribute("aria-expanded", "false");
      if (closeChannelsCueMenu === finishNull) closeChannelsCueMenu = null;
      document.removeEventListener("pointerdown", onDocPointer, true);
      document.removeEventListener("keydown", onDocKeydown, true);
    };

    const finishNull = () => finish(null);
    closeChannelsCueMenu = finishNull;

    channelsCueMenuList.replaceChildren();
    const item = document.createElement("button");
    item.type = "button";
    item.className = "menu-item";
    item.setAttribute("role", "menuitem");
    item.textContent = "Select cue";
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      finish("select");
    });
    channelsCueMenuList.append(item);

    channelsCueMenu.hidden = false;
    anchor.setAttribute("aria-expanded", "true");

    const anchorRect = anchor.getBoundingClientRect();
    const menuWidth = 150;
    const menuHeight = 48;
    let left = anchorRect.right - menuWidth;
    let top = anchorRect.bottom + 6;
    if (left < 8) left = 8;
    if (left + menuWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuWidth - 8);
    }
    if (top + menuHeight > window.innerHeight - 8) {
      top = Math.max(8, anchorRect.top - menuHeight - 6);
    }
    channelsCueMenu.style.left = `${left}px`;
    channelsCueMenu.style.top = `${top}px`;

    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onDocKeydown, true);
  }).then(async (action) => {
    if (action !== "select") return action;
    const index = await pickCue({ anchor });
    if (index != null) setSelectedCue(index);
    return action;
  });
}

export async function removeCueAt(index) {
  const song = getActiveSong();
  if (song.cues.length <= MIN_CUES) return false;
  if (index < 0 || index >= song.cues.length) return false;
  const ok = await confirmRemoveCue(cueLabel(index));
  if (!ok) return false;
  song.cues.splice(index, 1);
  state.fromCue = adjustIndexAfterRemove(state.fromCue, index, song.cues.length);
  state.toCue = adjustIndexAfterRemove(state.toCue, index, song.cues.length);
  state.selectedCue = adjustIndexAfterRemove(state.selectedCue, index, song.cues.length);
  bindActiveSong();
  renderCues();
  renderSelectedGroup();
  pushToDmx();
  persistSession();
  return true;
}

/** Insert a copy of a cue (levels, name, In time) right after it and make the copy LIVE. */
export function duplicateCueAt(index) {
  const song = getActiveSong();
  if (song.cues.length >= MAX_CUES) return false;
  const cue = song.cues[index];
  if (!cue) return false;
  song.cues.splice(index + 1, 0, createCue({ name: state.cueNames[index], levels: cue.levels, fadeTime: cue.fadeTime }));
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

/** @type {null | (() => void)} */
export let closeCueMenu = null;

/**
 * @param {HTMLElement} anchor
 * @param {number} index
 * @returns {Promise<"rename" | "duplicate" | "remove" | null>}
 */
function openCueMenu(anchor, index) {
  closeCueMenu?.();
  closeFaderNameMenu?.();
  closeChannelsCueMenu?.();
  closeCuePicker?.();
  closeChannelPicker?.();
  closeCountPicker?.();
  closeFixtureGroupPicker?.();

  return new Promise((resolve) => {
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const addItem = (label, action, { danger = false, disabled = false } = {}) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "menu-item";
      if (danger) item.classList.add("danger");
      item.setAttribute("role", "menuitem");
      item.textContent = label;
      item.disabled = disabled;
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        finish(action);
      });
      cueMenuList.append(item);
    };

    const onDocPointer = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (cueMenu.contains(target) || anchor.contains(target)) return;
      finish(null);
    };

    const onDocKeydown = (event) => {
      if (event.key === "Escape") finish(null);
    };

    const cleanup = () => {
      cueMenu.hidden = true;
      anchor.setAttribute("aria-expanded", "false");
      if (closeCueMenu === finishNull) closeCueMenu = null;
      document.removeEventListener("pointerdown", onDocPointer, true);
      document.removeEventListener("keydown", onDocKeydown, true);
    };

    const finishNull = () => finish(null);
    closeCueMenu = finishNull;

    cueMenuList.replaceChildren();
    addItem("Rename", "rename");
    addItem("Duplicate", "duplicate");
    addItem("Remove", "remove", {
      danger: true,
      disabled: state.cueLevels.length <= MIN_CUES,
    });

    cueMenu.hidden = false;
    anchor.setAttribute("aria-expanded", "true");

    const anchorRect = anchor.getBoundingClientRect();
    const menuWidth = 140;
    const menuHeight = 128;
    let left = anchorRect.left;
    let top = anchorRect.bottom + 6;
    if (left + menuWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuWidth - 8);
    }
    if (top + menuHeight > window.innerHeight - 8) {
      top = Math.max(8, anchorRect.top - menuHeight - 6);
    }
    cueMenu.style.left = `${left}px`;
    cueMenu.style.top = `${top}px`;

    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onDocKeydown, true);
  }).then(async (action) => {
    if (action === "rename") beginInlineRename(index);
    if (action === "duplicate") duplicateCueAt(index);
    if (action === "remove") await removeCueAt(index);
    return action;
  });
}

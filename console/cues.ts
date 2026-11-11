// Cue rows on the Run tab: drawing, reordering, renaming, cue menus.
import { FADER_COUNT } from "./patch.ts";
import { MAX_CUES, MAX_CUE_STEPS, MIN_CUES, copyCue, createStep, cueSeconds, moveCue, normalizeCueFadeTime, stepLook, CUE_FADE_TIMES, type Cue } from "./songs.ts";
import { timeAt } from "../shared/engine.ts";
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
  confirmAction,
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

    const cue = getActiveSong().cues[r];
    // One look: its In time, as always. With steps: a tab per look, and their total time.
    const timing = cue.steps.length
      ? stepTabs(cue, r)
      : timeSelect("In", `Fade time into ${cueLabel(r)}`, cue.fadeTime, "Fade time into this cue (how long GO takes to fade to it)", (next) => {
        cue.fadeTime = next;
        if (r === state.toCue) refreshCueSelects();
        persistSession();
      });
    const addStepBtn = cue.steps.length ? null : stepButton("+ Step", "Add a step: a look GO passes through on the way into this cue (a copy of it, to change)", () => addStep(r));

    const hint = el("span", "fader-row-hint", cueHint(r));

    head.append(dragHandle, titleGroup, timing, ...(addStepBtn ? [addStepBtn] : []), hint);
    wireCueRowDrag(bank, dragHandle, r);
    head.addEventListener("click", (event) => {
      if (
        event.target instanceof Element &&
        event.target.closest(
          ".cue-title-input, .fader-row-drag-handle, .cue-menu-btn, .cue-fade, .cue-steps, .cue-step-add",
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
    bank.append(head);
    if (cue.steps.length) bank.append(stepTimeline(cue, r));
    if (cue.steps.length && r === state.fromCue) bank.append(stepRow(cue, r));
    bank.append(grid);
    cuesEl.append(bank);
    cueUi[r] = { valueEls, patchLabelEls, sliders };
  }

  refreshCueSelects();
  refreshColorBars();
}

// ---------------------------------------------------------------------
// Steps: looks GO passes through on the way into a cue (Cue.steps). The
// LIVE cue shows and edits one of its looks (state.liveStep); clicking a
// step's tab makes that cue LIVE on that step.
// ---------------------------------------------------------------------

/** Which of `cue`'s looks the row shows: its step, or steps.length for its own look (only the LIVE cue shows a step). */
const shownLook = (cue: Cue, r: number) => (r === state.fromCue && state.liveStep >= 0 ? state.liveStep : cue.steps.length);

/** A labelled seconds picker (In, Fade, Hold), styled like the cue's In time. */
function timeSelect(label: string, ariaLabel: string, value: number, title: string, onChange: (seconds: number) => void, fallback?: number) {
  const group = el("div", "cue-fade");
  group.title = title;
  const select = el("select", "cue-fade-select");
  select.setAttribute("aria-label", ariaLabel);
  const current = normalizeCueFadeTime(value, fallback);
  for (const sec of CUE_FADE_TIMES) {
    const opt = new Option(`${sec}s`, String(sec), false, sec === current);
    select.append(opt);
  }
  select.addEventListener("click", (event) => event.stopPropagation());
  select.addEventListener("pointerdown", (event) => event.stopPropagation());
  select.addEventListener("change", (event) => {
    event.stopPropagation();
    onChange(normalizeCueFadeTime(select.value, fallback));
  });
  group.append(el("span", "cue-fade-label", label), select);
  return group;
}

function stepButton(text: string, title: string, onClick: () => void, className = "cue-step-add") {
  const b = button(className);
  b.textContent = text;
  b.title = title;
  b.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return b;
}

/** Tabs for a cue's looks ("1 · 2s" … its own last), + to add one, and the total time. */
function stepTabs(cue: Cue, r: number) {
  const group = el("div", "cue-steps");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", `Steps of ${cueLabel(r)}`);
  const shown = r === state.fromCue ? shownLook(cue, r) : -1;
  const looks = [...cue.steps.map((s) => s.fadeTime), cue.fadeTime];
  looks.forEach((fade, k) => {
    const own = k === cue.steps.length;
    const tab = stepButton(`${k + 1} · ${fade}s`, own
      ? "The cue's own look, where GO ends: click to make it LIVE and edit it"
      : `Step ${k + 1}: click to make it LIVE (no fade) and edit it`, () => setSelectedCue(r, own ? -1 : k), "cue-step-tab");
    tab.setAttribute("aria-pressed", String(k === shown));
    tab.classList.toggle("is-shown", k === shown);
    group.append(tab);
  });
  if (cue.steps.length < MAX_CUE_STEPS) {
    group.append(stepButton("+ Step", "Add a step after the one shown (a copy of it)", () => addStep(r), "cue-step-tab cue-step-plus"));
  }
  group.append(el("span", "cue-steps-total", `${cueSeconds(cue)}s`));
  return group;
}

/** A bar of the cue's parts sized by their time (fades and holds); it fills as GO runs into the cue. */
function stepTimeline(cue: Cue, r: number) {
  const bar = el("div", "cue-timeline");
  bar.setAttribute("aria-hidden", "true");
  const shown = r === state.fromCue ? shownLook(cue, r) : -1;
  const parts = [...cue.steps.map((s) => ({ fade: s.fadeTime, hold: s.holdTime })), { fade: cue.fadeTime, hold: 0 }];
  parts.forEach(({ fade, hold }, k) => {
    const part = el("span", "cue-timeline-part");
    part.style.flexGrow = String(fade + hold);
    part.classList.toggle("is-shown", k === shown);
    // Click a bar as its tab: that step LIVE (no fade), to edit. (The tabs are the keyboard way.)
    const own = k === cue.steps.length;
    part.title = own ? `${cueLabel(r)}'s own look: click to make it LIVE (no fade) and edit it` : `Step ${k + 1}: click to make it LIVE (no fade) and edit it`;
    part.addEventListener("click", (event) => {
      event.stopPropagation();
      setSelectedCue(r, own ? -1 : k);
    });
    bar.append(part);
  });
  bar.append(el("span", "cue-timeline-fill"));
  return bar;
}

/** How far a GO into UP NEXT has got, on its row's timeline (by time, as its steps play). */
export function syncStepTimeline(cross: number) {
  const bar = cuesEl.querySelector<HTMLElement>(".fader-row.is-next .cue-timeline");
  bar?.style.setProperty("--done", String(cross > 0 && cross < 100 ? timeAt(cross) : 0));
}

/** The LIVE cue's shown look: which it is, its fade and hold, and Remove. */
function stepRow(cue: Cue, r: number) {
  const row = el("div", "cue-step-row");
  const k = shownLook(cue, r);
  const own = k === cue.steps.length;
  const step = cue.steps[k];
  // ‹ ›: the look before / after, at once (no fade), like the cue ◀ ▶.
  const looks = cue.steps.length + 1;
  const go = (to: number) => setSelectedCue(r, to === cue.steps.length ? -1 : to);
  const prev = stepButton("‹", "Previous step: make it LIVE (no fade) and edit it", () => go(k - 1), "cue-step-nav");
  const next = stepButton("›", "Next step: make it LIVE (no fade) and edit it", () => go(k + 1), "cue-step-nav");
  prev.disabled = k === 0;
  next.disabled = k === looks - 1;
  row.append(prev, next);
  row.append(el("span", "cue-step-name", own ? `Step ${k + 1} of ${k + 1}: the cue's own look (GO ends here)` : `Step ${k + 1} of ${cue.steps.length + 1}`));
  const changed = () => {
    if (r === state.toCue) refreshCueSelects();
    persistSession();
    renderCues();
  };
  row.append(timeSelect("Fade", own ? `Fade into ${cueLabel(r)}'s own look` : `Fade into step ${k + 1}`, own ? cue.fadeTime : step.fadeTime, "Fade time into this look", (s) => {
    if (own) cue.fadeTime = s;
    else step.fadeTime = s;
    changed();
  }));
  if (!own) {
    row.append(timeSelect("Hold", `Hold on step ${k + 1}`, step.holdTime, "How long GO stays on this step before the next fades in", (s) => {
      step.holdTime = s;
      changed();
    }, 0));
  }
  if (cue.steps.length < MAX_CUE_STEPS) {
    row.append(stepButton("+ Add step", own ? "Add a step before the cue's own look (a copy of it)" : `Add a step after step ${k + 1} (a copy of it)`, () => addStep(r), "cue-step-remove quiet"));
  }
  if (!own) {
    row.append(stepButton("Remove step", `Remove step ${k + 1}`, () => void removeStep(r, k), "cue-step-remove quiet"));
  }
  row.append(el("span", "cue-step-hint", "The faders below are this look"));
  return row;
}

/** Add a step to cue `r`: a copy of the look shown, after it (before the cue's own look if that's shown), and show it. */
function addStep(r: number) {
  const cue = getActiveSong().cues[r];
  if (!cue || cue.steps.length >= MAX_CUE_STEPS) return;
  const k = shownLook(cue, r);
  const own = k === cue.steps.length;
  const source = cue.steps[k];
  const at = own ? cue.steps.length : k + 1;
  cue.steps.splice(at, 0, createStep(stepLook(cue, own ? -1 : k), own ? cue.fadeTime : source.fadeTime, own ? 0 : source.holdTime));
  setSelectedCue(r, at);
  if (r === state.toCue) refreshCueSelects();
  persistSession();
  renderCues();
}

async function removeStep(r: number, k: number) {
  const cue = getActiveSong().cues[r];
  if (!cue?.steps[k]) return;
  const ok = await confirmAction({ title: "Remove step?", message: `Remove step ${k + 1} of ${cueLabel(r)}? Its fader levels will be lost.`, confirmLabel: "Remove" });
  if (!ok) return;
  cue.steps.splice(k, 1);
  // Show the step before it (or the cue's own look).
  setSelectedCue(r, cue.steps.length ? Math.max(0, k - 1) : -1);
  persistSession();
  renderCues();
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
  if (index === state.fromCue) state.liveStep = -1; // another cue is LIVE now
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
  song.cues.splice(index + 1, 0, copyCue({ ...cue, name: state.cueNames[index] }));
  bindActiveSong();
  state.selectedCue = index + 1;
  state.fromCue = state.selectedCue;
  state.liveStep = -1;
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

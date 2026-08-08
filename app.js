import { EnttecDmxPro } from "./dmx.js";
import {
  FADER_COUNT,
  CHANNEL_METER_COUNT,
  DMX_CHANNEL_MAX,
  identityPatch,
  savePatch,
  defaultPatch,
  formatChannelLabel,
  formatChannelTooltip,
  makeTarget,
  scaledLevel,
} from "./patch.js";
import {
  createInstrument,
  createInstrumentGroup,
  findRangeConflict,
  channelCount,
  formatChannelRange,
  instrumentsInGroup,
  MAX_INSTRUMENT_CHANNELS,
  MAX_INSTRUMENT_GROUPS,
  MAX_INSTRUMENT_QTY,
  MAX_INSTRUMENTS,
  nextAvailableRange,
  normalizeChannelSpan,
  normalizeColorMode,
  normalizeInstrumentGroups,
  normalizeInstruments,
  normalizeMount,
} from "./instruments.js";
import {
  DEFAULT_NAV_ORDER,
  defaultFaderName,
  defaultSetlistName,
  defaultTuneName,
  defaultTransitionName,
  downloadSetlist,
  FADE_TIMES,
  createTune,
  createTransition,
  loadSession,
  MAX_TUNES,
  MAX_TRANSITIONS,
  MIN_TRANSITIONS,
  moveTune,
  moveTransition,
  normalizeFaderNames,
  normalizeNavOrder,
  normalizeTunes,
  normalizeTuneName,
  normalizeSetlistName,
  normalizeTransitionFadeTime,
  parseSetlist,
  resolveActiveTune,
  saveSession,
  setlistSnapshot,
  TRANSITION_FADE_TIMES,
} from "./setlist.js";

const dmx = new EnttecDmxPro();

/**
 * @template {typeof Element} C
 * @param {string} id
 * @param {C} type
 * @returns {InstanceType<C>}
 */
function requireEl(id, type) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  if (!(el instanceof type)) throw new Error(`#${id} is not ${type.name}`);
  return /** @type {InstanceType<C>} */ (el);
}

function zeros() {
  return new Array(FADER_COUNT).fill(0);
}

/** @param {string} [setlistName] */
function blankSetlistState(setlistName = defaultSetlistName()) {
  const tune = createTune({ name: defaultTuneName(0) });
  return {
    setlistName: normalizeSetlistName(setlistName),
    navOrder: [...DEFAULT_NAV_ORDER],
    master: 100,
    cross: 0,
    fromSub: 100,
    toSub: 100,
    fadeTime: 4,
    fromRow: 0,
    toRow: 1,
    selectedRow: 0,
    tunes: [tune],
    activeTuneId: tune.id,
    faderNames: normalizeFaderNames(null),
    instrumentGroups: [],
    instruments: [],
    patch: defaultPatch(),
  };
}

function initialState() {
  const session = loadSession();
  if (session) return session;
  return blankSetlistState();
}

const boot = initialState();
/** @type {string} */
let setlistName = normalizeSetlistName(boot.setlistName);
/** @type {string[]} */
let navOrder = normalizeNavOrder(boot.navOrder);
/** @type {import("./tunes.js").Tune[]} */
let tunes = normalizeTunes(boot.tunes);
/** @type {string} */
let activeTuneId = resolveActiveTune(tunes, boot.activeTuneId).id;
/** Working views into the active tune’s transitions (levels share array refs). */
/** @type {number[][]} */
let rows = [];
/** @type {string[]} */
let names = [];
/** @type {string[]} */
let faderNames = normalizeFaderNames(boot.faderNames);
/** @type {import("./instruments.js").InstrumentGroup[]} */
let instrumentGroups = normalizeInstrumentGroups(boot.instrumentGroups);
/** @type {import("./instruments.js").Instrument[]} */
let instruments = normalizeInstruments(boot.instruments, instrumentGroups);
/** @type {string | null} */
let instrumentFormGroupId = null;
let patch = boot.patch;
let master = boot.master;
let cross = boot.cross; // 0 = full From, 100 = full To
let fromSub = boot.fromSub ?? 100;
let toSub = boot.toSub ?? 100;
let fadeTime = FADE_TIMES.includes(boot.fadeTime) ? boot.fadeTime : 4;
let fromRow = boot.fromRow;
let toRow = boot.toRow;
let selectedRow = boot.selectedRow ?? 0;

function getActiveTune() {
  return resolveActiveTune(tunes, activeTuneId);
}

/** Rebind rows/names to the active tune and clamp Current/Next/selected indices. */
function bindActiveTune() {
  const tune = getActiveTune();
  activeTuneId = tune.id;
  rows = tune.transitions.map((t) => t.levels);
  names = tune.transitions.map((t) => t.name);
  const n = rows.length;
  selectedRow = Math.min(Math.max(0, selectedRow), Math.max(0, n - 1));
  fromRow = Math.min(Math.max(0, fromRow), Math.max(0, n - 1));
  syncPlaybackPair();
}

/** Next is always the following transition in tune order (wraps). */
function syncPlaybackPair() {
  const n = rows.length;
  if (n < 2) {
    toRow = fromRow;
    return;
  }
  fromRow = Math.min(Math.max(0, fromRow), n - 1);
  toRow = (fromRow + 1) % n;
}

bindActiveTune();
/** @type {number} */
let selectedFader = 0;
/** @type {number | null} */
let fadeRaf = null;
/** @type {null | { start: number, target: number, durationMs: number, startedAt: number, pausedAt: number | null, mode?: "go" }} */
let fadeState = null;
/** @type {number | null} */
let masterBlackoutSnapshot = null;
/** @type {number | null} */
let fromSubBlackoutSnapshot = null;
/** @type {number | null} */
let toSubBlackoutSnapshot = null;

/** @type {HTMLElement} */
let setlistNameDisplay = requireEl("setlistNameDisplay", HTMLElement);
const setlistMenuBtn = requireEl("setlistMenuBtn", HTMLButtonElement);
const setlistMenu = requireEl("setlistMenu", HTMLElement);
const setlistMenuList = requireEl("setlistMenuList", HTMLElement);
const rowsScroll = requireEl("rowsScroll", HTMLElement);
const rowsEl = requireEl("rows", HTMLElement);
const liveFadersEl = requireEl("liveFaders", HTMLElement);
const channelLevelsEl = requireEl("channelLevels", HTMLElement);
const selectedGroupFadersEl = requireEl("selectedGroupFaders", HTMLElement);
/** @type {HTMLElement} */
let currentSceneTitle = requireEl("currentSceneTitle", HTMLElement);
const sceneMenu = requireEl("sceneMenu", HTMLElement);
const sceneMenuList = requireEl("sceneMenuList", HTMLElement);
const channelsSceneMenuBtn = requireEl("channelsSceneMenuBtn", HTMLButtonElement);
const channelsSceneMenu = requireEl("channelsSceneMenu", HTMLElement);
const channelsSceneMenuList = requireEl("channelsSceneMenuList", HTMLElement);
const sceneRowMenu = requireEl("sceneRowMenu", HTMLElement);
const sceneRowMenuList = requireEl("sceneRowMenuList", HTMLElement);
const faderNameMenu = requireEl("faderNameMenu", HTMLElement);
const faderNameMenuList = requireEl("faderNameMenuList", HTMLElement);
const patchTableEl = requireEl("patchTable", HTMLElement);
const patchConflictsEl = requireEl("patchConflicts", HTMLElement);
const connectBtn = requireEl("connectBtn", HTMLButtonElement);
const blackoutBtn = requireEl("blackoutBtn", HTMLButtonElement);
const statusEl = requireEl("status", HTMLElement);
const masterInput = requireEl("master", HTMLInputElement);
const masterValue = requireEl("masterValue", HTMLOutputElement);
const fromSubInput = requireEl("fromSub", HTMLInputElement);
const fromSubValue = requireEl("fromSubValue", HTMLOutputElement);
const fromSubLabel = requireEl("fromSubLabel", HTMLElement);
const fromSubBlackoutBtn = requireEl("fromSubBlackoutBtn", HTMLButtonElement);
const toSubInput = requireEl("toSub", HTMLInputElement);
const toSubValue = requireEl("toSubValue", HTMLOutputElement);
const toSubLabel = requireEl("toSubLabel", HTMLElement);
const toSubBlackoutBtn = requireEl("toSubBlackoutBtn", HTMLButtonElement);
const crossfader = requireEl("crossfader", HTMLInputElement);
const crossValue = requireEl("crossValue", HTMLOutputElement);
const crossFromLabel = requireEl("crossFromLabel", HTMLElement);
const crossToLabel = requireEl("crossToLabel", HTMLElement);
const goBtn = requireEl("goBtn", HTMLButtonElement);
const goNextFade = requireEl("goNextFade", HTMLElement);
const fadePauseBtn = requireEl("fadePauseBtn", HTMLButtonElement);
const addRowBtn = requireEl("addRowBtn", HTMLButtonElement);
const removeRowBtn = requireEl("removeRowBtn", HTMLButtonElement);
const addTuneBtn = requireEl("addTuneBtn", HTMLButtonElement);
const tuneScroll = requireEl("tuneScroll", HTMLElement);
const tuneList = requireEl("tuneList", HTMLElement);
const tuneEmpty = requireEl("tuneEmpty", HTMLElement);
const activeTuneLabel = requireEl("activeTuneLabel", HTMLElement);
const pageSetlist = requireEl("page-setlist", HTMLElement);
const identityBtn = requireEl("identityBtn", HTMLButtonElement);
const clearPatchBtn = requireEl("clearPatchBtn", HTMLButtonElement);
const newSetlistBtn = requireEl("newSetlistBtn", HTMLButtonElement);
const saveBtn = requireEl("saveBtn", HTMLButtonElement);
const loadBtn = requireEl("loadBtn", HTMLButtonElement);
const loadFile = requireEl("loadFile", HTMLInputElement);
const dirtyDialog = requireEl("dirtyDialog", HTMLDialogElement);
const confirmDialog = requireEl("confirmDialog", HTMLDialogElement);
const confirmTitle = requireEl("confirmTitle", HTMLElement);
const confirmMessage = requireEl("confirmMessage", HTMLElement);
const confirmConfirmBtn = requireEl("confirmConfirmBtn", HTMLButtonElement);
const sceneNameDialog = requireEl("sceneNameDialog", HTMLDialogElement);
const sceneNameForm = requireEl("sceneNameForm", HTMLFormElement);
const sceneNameDialogTitle = requireEl("sceneNameDialogTitle", HTMLElement);
const sceneNameInput = requireEl("sceneNameInput", HTMLInputElement);
const sceneNameConfirmBtn = requireEl("sceneNameConfirmBtn", HTMLButtonElement);
const channelMenu = requireEl("channelMenu", HTMLElement);
const channelMenuFilter = requireEl("channelMenuFilter", HTMLInputElement);
const channelMenuList = requireEl("channelMenuList", HTMLElement);
const channelMenuSub = requireEl("channelMenuSub", HTMLElement);
const channelMenuSubList = requireEl("channelMenuSubList", HTMLElement);
const channelMenuSubLabel = requireEl("channelMenuSubLabel", HTMLElement);
const CHANNEL_GROUP_SIZE = 32;
const CHANNEL_GROUP_COUNT = Math.ceil(512 / CHANNEL_GROUP_SIZE);
const pageTunes = requireEl("page-tunes", HTMLElement);
const pageChannels = requireEl("page-channels", HTMLElement);
const pageInstruments = requireEl("page-instruments", HTMLElement);
const pagePatch = requireEl("page-patch", HTMLElement);
const instrumentForm = requireEl("instrumentForm", HTMLFormElement);
const instrumentNameInput = requireEl("instrumentNameInput", HTMLInputElement);
const instrumentStartPicker = requireEl("instrumentStartPicker", HTMLElement);
const instrumentCountPicker = requireEl("instrumentCountPicker", HTMLElement);
const countMenu = requireEl("countMenu", HTMLElement);
const countMenuList = requireEl("countMenuList", HTMLElement);
/** @type {number} */
let instrumentFormStart = 1;
/** @type {number} */
let instrumentFormCount = 1;
/** @type {number} */
let instrumentFormQty = 1;
/** @type {null | { sync: () => void }} */
let instrumentFormStartPicker = null;
/** @type {null | { el: HTMLButtonElement, sync: () => void }} */
let instrumentFormCountPicker = null;
/** @type {null | { el: HTMLButtonElement, sync: () => void }} */
let instrumentFormQtyPicker = null;
const instrumentQtyPicker = requireEl("instrumentQtyPicker", HTMLElement);
const instrumentConflicts = requireEl("instrumentConflicts", HTMLElement);
const instrumentScroll = requireEl("instrumentScroll", HTMLElement);
const instrumentEmpty = requireEl("instrumentEmpty", HTMLElement);
const instrumentList = requireEl("instrumentList", HTMLElement);
const addInstrumentBtn = requireEl("addInstrumentBtn", HTMLButtonElement);
const addInstrumentGroupBtn = requireEl("addInstrumentGroupBtn", HTMLButtonElement);
const instrumentFormGroupPickerHost = requireEl(
  "instrumentFormGroupPicker",
  HTMLElement,
);
const instrumentGroupMenu = requireEl("instrumentGroupMenu", HTMLElement);
const instrumentGroupMenuList = requireEl("instrumentGroupMenuList", HTMLElement);
/** @type {null | { el: HTMLButtonElement, sync: () => void }} */
let instrumentFormGroupPicker = null;
const navEl = requireEl("nav", HTMLElement);
/** @type {Record<string, HTMLElement>} */
const pages = {
  setlist: pageSetlist,
  tunes: pageTunes,
  channels: pageChannels,
  instruments: pageInstruments,
  patch: pagePatch,
};

function getNavLinks() {
  return [...navEl.querySelectorAll(".nav-link")];
}

/** Snapshot of last explicitly saved/loaded setlist (or boot state). */
let cleanSnapshot = "";

/** @type {{ valueEls: HTMLElement[], patchLabelEls: HTMLElement[], sliders: HTMLInputElement[] }[]} */
let rowUi = [];
/** @type {{ valueEls: HTMLElement[], patchLabelEls: HTMLElement[], fillEls: HTMLElement[] }} */
let liveUi = { valueEls: [], patchLabelEls: [], fillEls: [] };
/** @type {{ channels: number[], valueEls: Map<number, HTMLElement>, fillEls: Map<number, HTMLElement>, wrapEls: Map<number, HTMLElement> }} */
let channelUi = { channels: [], valueEls: new Map(), fillEls: new Map(), wrapEls: new Map() };
let channelRowKey = "";
/** @type {{ valueEls: HTMLElement[], patchLabelEls: HTMLElement[], sliders: HTMLInputElement[] }} */
let selectedGroupUi = { valueEls: [], patchLabelEls: [], sliders: [] };

function transitionName(index) {
  const name = names[index];
  if (typeof name === "string" && name.trim()) return name.trim();
  return defaultTransitionName(index);
}

/** @deprecated */
function sceneName(index) {
  return transitionName(index);
}

function faderName(index) {
  const name = faderNames[index];
  if (typeof name === "string" && name.trim()) return name.trim();
  return defaultFaderName(index);
}

function setSelectedFader(index) {
  if (!Number.isInteger(index) || index < 0 || index >= FADER_COUNT) return;
  selectedFader = index;
  refreshFaderSelectionUi();
}

function refreshFaderSelectionUi() {
  for (const card of patchTableEl.querySelectorAll(".patch-card")) {
    if (!(card instanceof HTMLElement)) continue;
    const selected = Number(card.dataset.fader) === selectedFader;
    card.classList.toggle("is-selected", selected);
    card.setAttribute("aria-selected", selected ? "true" : "false");
  }
  for (const wrap of document.querySelectorAll(".fader[data-fader]")) {
    if (!(wrap instanceof HTMLElement)) continue;
    wrap.classList.toggle("is-selected-fader", Number(wrap.dataset.fader) === selectedFader);
  }
}

/** @param {number} index */
function makeFaderNameLabel(index) {
  const label = document.createElement("button");
  label.type = "button";
  label.className = "label fader-name";
  label.dataset.fader = String(index);
  const name = faderName(index);
  label.textContent = name;
  label.title = name;
  label.setAttribute("aria-label", `Fader ${index + 1}: ${name}`);
  label.addEventListener("click", (event) => {
    // Avoid selecting scene rows / other parent handlers
    event.stopPropagation();
    setSelectedFader(index);
  });
  label.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedFader(index);
    void openFaderNameMenu(label, index, event.clientX, event.clientY);
  });
  return label;
}

function abortInlineEdits() {
  endInlineFaderRename?.();
  endInlineRename?.();
  endInlineInstrumentRename?.();
  endInlineTuneRename?.();
  closeSetlistMenu?.();
  closeChannelsSceneMenu?.();
  closeScenePicker?.();
  closeSceneRowMenu?.();
  closeFaderNameMenu?.();
  closeChannelPicker?.();
  closeCountPicker?.();
  closeInstrumentGroupPicker?.();
}

/** @type {null | (() => void)} */
let endInlineTuneRename = null;

/** @type {null | (() => void)} */
let endInlineInstrumentRename = null;

async function renameFader(index, { preferInline = false } = {}) {
  if (index < 0 || index >= FADER_COUNT) return;
  setSelectedFader(index);

  if (preferInline) {
    const title = patchTableEl.querySelector(
      `.patch-card[data-fader="${index}"] .patch-fader-name`,
    );
    if (title instanceof HTMLElement) {
      beginInlineFaderRename(index, title);
      return;
    }
  }

  abortInlineEdits();
  // Defer dialog so the triggering click can't dismiss it
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const name = await promptName({
    title: "Rename fader",
    confirmLabel: "Save",
    initial: faderName(index),
  });
  if (!name || name === faderName(index)) return;
  applyFaderName(index, name);
}

function applyFaderName(index, name) {
  const next = name.trim();
  if (!next || next === faderName(index)) return false;
  faderNames[index] = next;
  renderLiveRow();
  renderRows();
  renderSelectedGroup();
  renderPatchTable();
  persistSession();
  return true;
}

/** @type {null | (() => void)} */
let endInlineFaderRename = null;

/** @param {HTMLHeadingElement | HTMLElement} title @param {number} index */
function wirePatchFaderTitle(title, index) {
  title.className = "fader-name patch-fader-name";
  title.dataset.fader = String(index);
  title.textContent = faderName(index);
  title.title = faderName(index);
  title.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedFader(index);
    void openFaderNameMenu(title, index, event.clientX, event.clientY);
  });
  title.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedFader(index);
    beginInlineFaderRename(index, title);
  });
  return title;
}

/**
 * @param {number} index
 * @param {HTMLElement} target
 */
function beginInlineFaderRename(index, target) {
  if (!(target instanceof HTMLElement) || !target.isConnected) return;
  abortInlineEdits();

  const input = document.createElement("input");
  input.type = "text";
  input.className = "scene-title-input fader-title-input";
  input.maxLength = 40;
  input.value = faderName(index);
  input.setAttribute("aria-label", "Fader name");
  input.autocomplete = "off";
  input.spellcheck = false;

  const parent = target.parentElement;
  if (!parent) return;
  target.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = (commit) => {
    if (finished) return;
    finished = true;
    if (endInlineFaderRename === finishAbort) endInlineFaderRename = null;
    input.removeEventListener("keydown", onKeydown);
    input.removeEventListener("blur", onBlur);

    const next = input.value.trim();
    if (commit && next && next !== faderName(index)) {
      applyFaderName(index, next);
      return;
    }

    const restored = document.createElement("h3");
    wirePatchFaderTitle(restored, index);
    if (input.isConnected) input.replaceWith(restored);
    else parent.prepend(restored);
  };

  const finishAbort = () => finish(false);
  endInlineFaderRename = finishAbort;

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

/** @type {null | (() => void)} */
let closeFaderNameMenu = null;
/** @type {null | (() => void)} */
let closeSetlistMenu = null;

/**
 * @param {HTMLElement} anchor
 * @param {number} index
 * @param {number} [clientX]
 * @param {number} [clientY]
 */
function openFaderNameMenu(anchor, index, clientX, clientY) {
  closeFaderNameMenu?.();
  closeSceneRowMenu?.();
  closeSetlistMenu?.();
  closeChannelsSceneMenu?.();
  closeScenePicker?.();
  closeChannelPicker?.();
  closeCountPicker?.();
  closeInstrumentGroupPicker?.();

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
      if (faderNameMenu.contains(target) || anchor.contains(target)) return;
      finish(null);
    };

    const onDocKeydown = (event) => {
      if (event.key === "Escape") finish(null);
    };

    const cleanup = () => {
      faderNameMenu.hidden = true;
      if (closeFaderNameMenu === finishNull) closeFaderNameMenu = null;
      document.removeEventListener("pointerdown", onDocPointer, true);
      document.removeEventListener("keydown", onDocKeydown, true);
    };

    const finishNull = () => finish(null);
    closeFaderNameMenu = finishNull;

    faderNameMenuList.replaceChildren();

    const addItem = (label, action) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "popup-menu-item";
      item.setAttribute("role", "menuitem");
      item.textContent = label;
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        finish(action);
      });
      faderNameMenuList.append(item);
    };

    addItem("Rename", "rename");
    addItem("Show in Patch", "patch");

    faderNameMenu.hidden = false;

    const menuWidth = 160;
    const menuHeight = 84;
    let left = clientX ?? anchor.getBoundingClientRect().left;
    let top = clientY ?? anchor.getBoundingClientRect().bottom + 6;
    if (left + menuWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuWidth - 8);
    }
    if (top + menuHeight > window.innerHeight - 8) {
      top = Math.max(8, (clientY ?? anchor.getBoundingClientRect().top) - menuHeight - 6);
    }
    faderNameMenu.style.left = `${left}px`;
    faderNameMenu.style.top = `${top}px`;

    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onDocKeydown, true);
  }).then(async (action) => {
    if (action === "rename") {
      const onPatch =
        !pagePatch.hidden &&
        Boolean(patchTableEl.querySelector(`.patch-card[data-fader="${index}"] .patch-fader-name`));
      await renameFader(index, { preferInline: onPatch });
    }
    if (action === "patch") showFaderInPatch(index);
    return action;
  });
}

function showFaderInPatch(index) {
  if (index < 0 || index >= FADER_COUNT) return;
  setSelectedFader(index);
  if (location.hash.replace("#", "") !== "patch") {
    location.hash = "patch";
  } else {
    showPage("patch");
  }

  requestAnimationFrame(() => {
    refreshFaderSelectionUi();
    const card = patchTableEl.querySelector(`.patch-card[data-fader="${index}"]`);
    if (!(card instanceof HTMLElement)) return;
    card.classList.remove("is-flash");
    void card.offsetWidth;
    card.classList.add("is-flash");
    card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    window.setTimeout(() => card.classList.remove("is-flash"), 1600);
  });
}

function setStatus(text, state = "idle") {
  statusEl.textContent = text;
  statusEl.dataset.state = state;
}

function isUnpatched(targets) {
  return !targets || targets.length === 0;
}

/** @param {HTMLElement} wrap @param {HTMLInputElement} slider @param {import("./patch.js").FaderPatch} targets */
function applyFaderPatchState(wrap, slider, targets) {
  const unpatched = isUnpatched(targets);
  wrap.classList.toggle("is-unpatched-fader", unpatched);
  slider.disabled = unpatched;
  if (unpatched) {
    slider.title = "No channels patched";
  } else {
    slider.removeAttribute("title");
  }
}

/** Live fader level after submasters + crossfade + master (0–255), before per-channel max */
function liveLevel(faderIndex) {
  const a = (rows[fromRow][faderIndex] * fromSub) / 100;
  const b = (rows[toRow][faderIndex] * toSub) / 100;
  const t = cross / 100;
  const mixed = a * (1 - t) + b * t;
  return Math.round((mixed * master) / 100);
}

function refreshLiveRow() {
  for (let i = 0; i < FADER_COUNT; i++) {
    const level = liveLevel(i);
    liveUi.valueEls[i].textContent = String(level);
    liveUi.fillEls[i].style.height = `${(level / 255) * 100}%`;
    liveUi.patchLabelEls[i].textContent = formatChannelLabel(patch[i]);
    liveUi.patchLabelEls[i].classList.toggle("is-unpatched", isUnpatched(patch[i]));
    liveUi.patchLabelEls[i].title = formatChannelTooltip(patch[i]);
  }
}

/** @returns {Map<number, number>} DMX channel → output level */
function computeChannelLevels() {
  const byChannel = new Map();
  for (let i = 0; i < FADER_COUNT; i++) {
    const targets = patch[i];
    if (isUnpatched(targets)) continue;
    const level = liveLevel(i);
    for (const target of targets) {
      const out = scaledLevel(level, target.max);
      const prev = byChannel.get(target.channel) ?? 0;
      if (out > prev) byChannel.set(target.channel, out);
    }
  }
  return byChannel;
}

function patchedChannelSet() {
  const set = new Set();
  for (const targets of patch) {
    for (const target of targets) set.add(target.channel);
  }
  return set;
}

/** Channels shown on the Channels tab: 1–256, plus any higher patched channels. */
function displayedChannels() {
  const patched = patchedChannelSet();
  let highest = CHANNEL_METER_COUNT;
  for (const channel of patched) {
    if (channel > highest) highest = channel;
  }
  return Array.from({ length: highest }, (_, i) => i + 1);
}

function refreshChannelRow() {
  const levels = computeChannelLevels();
  const patched = patchedChannelSet();
  for (const channel of channelUi.channels) {
    const level = levels.get(channel) ?? 0;
    const valueEl = channelUi.valueEls.get(channel);
    const fillEl = channelUi.fillEls.get(channel);
    const wrap = channelUi.wrapEls.get(channel);
    if (valueEl) valueEl.textContent = String(level);
    if (fillEl) fillEl.style.height = `${(level / 255) * 100}%`;
    if (wrap) wrap.classList.toggle("is-unpatched-channel", !patched.has(channel));
  }
}

function renderChannelRow() {
  const channels = displayedChannels();
  const patched = patchedChannelSet();
  channelRowKey = `${channels.length}:${[...patched].sort((a, b) => a - b).join(",")}`;
  channelLevelsEl.replaceChildren();
  channelLevelsEl.hidden = false;
  channelLevelsEl.style.setProperty("--channel-count", String(channels.length));

  const valueEls = new Map();
  const fillEls = new Map();
  const wrapEls = new Map();

  for (const channel of channels) {
    const wrap = document.createElement("div");
    wrap.className = "fader live-fader channel-fader";
    if (!patched.has(channel)) wrap.classList.add("is-unpatched-channel");
    wrapEls.set(channel, wrap);

    const label = document.createElement("div");
    label.className = "label";
    label.textContent = `Ch${channel}`;

    const value = document.createElement("div");
    value.className = "value";
    value.textContent = "0";
    valueEls.set(channel, value);

    const meter = document.createElement("div");
    meter.className = "live-meter";
    meter.setAttribute("aria-hidden", "true");

    const fill = document.createElement("div");
    fill.className = "live-meter-fill channel-meter-fill";
    fillEls.set(channel, fill);
    meter.append(fill);

    wrap.append(label, value, meter);
    channelLevelsEl.append(wrap);
  }

  channelUi = { channels, valueEls, fillEls, wrapEls };
  refreshChannelRow();
}

function ensureChannelRow() {
  const patched = patchedChannelSet();
  const channels = displayedChannels();
  const key = `${channels.length}:${[...patched].sort((a, b) => a - b).join(",")}`;
  if (key !== channelRowKey) renderChannelRow();
}

function persistSession() {
  saveSession(currentSetlistState());
  savePatch(patch);
}

function pushToDmx({ persist = true } = {}) {
  dmx.blackout();

  const byChannel = computeChannelLevels();
  for (const [channel, level] of byChannel) {
    dmx.setChannel(channel, level);
  }

  refreshLiveRow();
  refreshChannelRow();
  refreshSelectedGroup();
  if (persist) persistSession();
}

function renderLiveRow() {
  liveFadersEl.replaceChildren();
  const valueEls = [];
  const patchLabelEls = [];
  const fillEls = [];

  for (let i = 0; i < FADER_COUNT; i++) {
    const wrap = document.createElement("div");
    wrap.className = "fader live-fader";
    wrap.dataset.fader = String(i);
    wrap.classList.toggle("is-selected-fader", i === selectedFader);
    wrap.addEventListener("pointerdown", () => setSelectedFader(i));

    const label = makeFaderNameLabel(i);

    const patched = document.createElement("div");
    patched.className = "patch-target";
    patched.textContent = formatChannelLabel(patch[i]);
    patched.title = formatChannelTooltip(patch[i]);
    if (isUnpatched(patch[i])) patched.classList.add("is-unpatched");
    patchLabelEls[i] = patched;

    const value = document.createElement("div");
    value.className = "value";
    value.textContent = "0";
    valueEls[i] = value;

    const meter = document.createElement("div");
    meter.className = "live-meter";
    meter.setAttribute("aria-hidden", "true");

    const fill = document.createElement("div");
    fill.className = "live-meter-fill";
    fillEls[i] = fill;
    meter.append(fill);

    wrap.append(label, patched, value, meter);
    liveFadersEl.append(wrap);
  }

  liveUi = { valueEls, patchLabelEls, fillEls };
  refreshLiveRow();
}

function refreshRowSelects() {
  selectedRow = Math.min(Math.max(0, selectedRow), rows.length - 1);
  syncPlaybackPair();
  crossFromLabel.textContent = transitionName(fromRow);
  crossToLabel.textContent = transitionName(toRow);
  const nextFade =
    getActiveTune().transitions[toRow]?.fadeTime ??
    normalizeTransitionFadeTime(fadeTime);
  goNextFade.textContent = `${nextFade}s`;
  goBtn.title = `GO — fade to ${transitionName(toRow)} (${nextFade}s)`;
  goBtn.setAttribute(
    "aria-label",
    `GO to ${transitionName(toRow)} in ${nextFade} seconds`,
  );
  syncSubmasterLabels();
  removeRowBtn.disabled = rows.length <= MIN_TRANSITIONS;
  removeRowBtn.setAttribute(
    "aria-label",
    `Remove transition ${transitionName(selectedRow)}`,
  );
  removeRowBtn.title = `Remove transition ${transitionName(selectedRow)}`;
  addRowBtn.disabled = rows.length >= MAX_TRANSITIONS;
  updateScenesButton();
  syncTuneUi();
}

function updateScenesButton() {
  if (!currentSceneTitle) return;
  currentSceneTitle.textContent = transitionName(selectedRow);
  currentSceneTitle.title = "Click to rename";
  channelsSceneMenuBtn.setAttribute(
    "aria-label",
    `Options for transition ${transitionName(selectedRow)}`,
  );
  channelsSceneMenuBtn.title = `Options for ${transitionName(selectedRow)}`;
}

function setSelectedRow(index) {
  if (index < 0 || index >= rows.length) return;
  stopTimedFade();
  selectedRow = index;
  // Selecting a transition sets Current; Next follows in tune order.
  fromRow = index;
  syncPlaybackPair();
  for (const bank of rowsEl.querySelectorAll(".fader-row")) {
    const r = Number(bank.dataset.row);
    const selected = r === selectedRow;
    bank.classList.toggle("is-selected", selected);
    bank.classList.toggle("is-current", r === fromRow);
    bank.classList.toggle("is-next", r === toRow);
    const head = bank.querySelector(".fader-row-head");
    if (head) head.setAttribute("aria-pressed", selected ? "true" : "false");
  }
  refreshRowSelects();
  renderSelectedGroup();
  pushToDmx();
}

/** @type {null | (() => void)} */
let closeScenePicker = null;
/** @type {null | (() => void)} */
let closeChannelsSceneMenu = null;

/**
 * @param {{ anchor: HTMLElement, clientX?: number, clientY?: number }} opts
 * @returns {Promise<number | null>}
 */
function pickScene({ anchor, clientX, clientY }) {
  closeScenePicker?.();
  closeChannelsSceneMenu?.();
  closeSetlistMenu?.();
  closeSceneRowMenu?.();
  closeFaderNameMenu?.();
  closeChannelPicker?.();
  closeCountPicker?.();
  closeInstrumentGroupPicker?.();

  return new Promise((resolve) => {
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const renderList = () => {
      sceneMenuList.replaceChildren();
      for (let r = 0; r < rows.length; r++) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "popup-menu-item";
        if (r === selectedRow) item.classList.add("is-current");
        item.setAttribute("role", "menuitem");
        item.textContent = sceneName(r);
        item.addEventListener("click", (event) => {
          event.stopPropagation();
          finish(r);
        });
        sceneMenuList.append(item);
      }
      const currentEl = sceneMenuList.querySelector(".is-current");
      if (currentEl) currentEl.scrollIntoView({ block: "nearest" });
    };

    const onDocPointer = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (sceneMenu.contains(target) || anchor.contains(target)) return;
      finish(null);
    };

    const onDocKeydown = (event) => {
      if (event.key === "Escape") finish(null);
    };

    const cleanup = () => {
      sceneMenu.hidden = true;
      if (closeScenePicker === finishNull) closeScenePicker = null;
      document.removeEventListener("pointerdown", onDocPointer, true);
      document.removeEventListener("keydown", onDocKeydown, true);
    };

    const finishNull = () => finish(null);
    closeScenePicker = finishNull;

    renderList();
    sceneMenu.hidden = false;

    const anchorRect = anchor.getBoundingClientRect();
    const menuWidth = 168;
    const menuHeight = 280;
    let left = clientX ?? anchorRect.left;
    let top = clientY ?? anchorRect.bottom + 6;
    if (left + menuWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuWidth - 8);
    }
    if (top + menuHeight > window.innerHeight - 8) {
      top = Math.max(8, (clientY ?? anchorRect.top) - menuHeight - 6);
    }
    sceneMenu.style.left = `${left}px`;
    sceneMenu.style.top = `${top}px`;

    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onDocKeydown, true);
  });
}

function renderSelectedGroup() {
  selectedRow = Math.min(Math.max(0, selectedRow), Math.max(0, rows.length - 1));
  updateScenesButton();
  selectedGroupFadersEl.replaceChildren();

  const valueEls = [];
  const patchLabelEls = [];
  const sliders = [];
  const row = rows[selectedRow] ?? zeros();

  for (let i = 0; i < FADER_COUNT; i++) {
    const wrap = document.createElement("div");
    wrap.className = "fader";
    wrap.dataset.fader = String(i);
    wrap.classList.toggle("is-selected-fader", i === selectedFader);
    wrap.addEventListener("pointerdown", () => setSelectedFader(i));

    const label = makeFaderNameLabel(i);

    const patched = document.createElement("div");
    patched.className = "patch-target";
    patched.textContent = formatChannelLabel(patch[i]);
    patched.title = formatChannelTooltip(patch[i]);
    if (isUnpatched(patch[i])) patched.classList.add("is-unpatched");
    patchLabelEls[i] = patched;

    const value = document.createElement("div");
    value.className = "value";
    value.textContent = String(row[i]);
    valueEls[i] = value;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "255";
    slider.value = String(row[i]);
    slider.setAttribute("aria-label", `${sceneName(selectedRow)} ${faderName(i)}`);
    applyFaderPatchState(wrap, slider, patch[i]);
    slider.addEventListener("input", () => {
      setSelectedFader(i);
      rows[selectedRow][i] = Number(slider.value);
      value.textContent = String(rows[selectedRow][i]);
      // Keep Tunes-page UI in sync if that transition is rendered
      if (rowUi[selectedRow]) {
        rowUi[selectedRow].sliders[i].value = String(rows[selectedRow][i]);
        rowUi[selectedRow].valueEls[i].textContent = String(rows[selectedRow][i]);
      }
      pushToDmx();
    });
    sliders[i] = slider;

    wrap.append(label, patched, value, slider);
    selectedGroupFadersEl.append(wrap);
  }

  selectedGroupUi = { valueEls, patchLabelEls, sliders };
}

function refreshSelectedGroup() {
  if (!selectedGroupUi.sliders.length) return;
  const row = rows[selectedRow];
  if (!row) return;
  updateScenesButton();
  for (let i = 0; i < FADER_COUNT; i++) {
    selectedGroupUi.sliders[i].value = String(row[i]);
    selectedGroupUi.valueEls[i].textContent = String(row[i]);
    selectedGroupUi.patchLabelEls[i].textContent = formatChannelLabel(patch[i]);
    selectedGroupUi.patchLabelEls[i].title = formatChannelTooltip(patch[i]);
    selectedGroupUi.patchLabelEls[i].classList.toggle("is-unpatched", isUnpatched(patch[i]));
    const wrap = selectedGroupUi.sliders[i].closest(".fader");
    if (wrap instanceof HTMLElement) {
      applyFaderPatchState(wrap, selectedGroupUi.sliders[i], patch[i]);
    }
  }
}

function adjustIndexAfterRemove(index, removed, lengthAfter) {
  if (index > removed) return index - 1;
  if (index === removed) return Math.min(removed, lengthAfter - 1);
  return index;
}

function syncTuneUi() {
  const tune = getActiveTune();
  activeTuneLabel.textContent = tune.name;
  activeTuneLabel.title = `${tune.name} · ${tune.transitions.length} transitions`;
  addTuneBtn.disabled = tunes.length >= MAX_TUNES;
  if (!pageSetlist.hidden) renderTunes();
}

function clearTuneDropMarks() {
  for (const el of tuneList.querySelectorAll(".is-drop-before, .is-drop-after")) {
    el.classList.remove("is-drop-before", "is-drop-after");
  }
}

/** @type {string | null} */
let dragTuneId = null;
/** @type {number | null} */
let tuneDragClientY = null;
/** @type {number | null} */
let tuneDragScrollRaf = null;
/** @type {null | (() => void)} */
let stopTuneDragSession = null;

const TUNE_DRAG_SCROLL_EDGE = 56;
const TUNE_DRAG_SCROLL_MAX = 24;

function tickTuneDragScroll() {
  tuneDragScrollRaf = null;
  if (!dragTuneId) return;

  if (tuneDragClientY != null) {
    const rect = tuneScroll.getBoundingClientRect();
    const y = tuneDragClientY;
    let dy = 0;

    if (y < rect.top) {
      dy = -TUNE_DRAG_SCROLL_MAX;
    } else if (y > rect.bottom) {
      dy = TUNE_DRAG_SCROLL_MAX;
    } else if (y < rect.top + TUNE_DRAG_SCROLL_EDGE) {
      const distance = rect.top + TUNE_DRAG_SCROLL_EDGE - y;
      const t = Math.min(1, distance / TUNE_DRAG_SCROLL_EDGE);
      dy = -Math.ceil(Math.max(2, t * TUNE_DRAG_SCROLL_MAX));
    } else if (y > rect.bottom - TUNE_DRAG_SCROLL_EDGE) {
      const distance = y - (rect.bottom - TUNE_DRAG_SCROLL_EDGE);
      const t = Math.min(1, distance / TUNE_DRAG_SCROLL_EDGE);
      dy = Math.ceil(Math.max(2, t * TUNE_DRAG_SCROLL_MAX));
    }

    if (dy !== 0) {
      const maxScroll = Math.max(
        0,
        tuneScroll.scrollHeight - tuneScroll.clientHeight,
      );
      tuneScroll.scrollTop = Math.max(
        0,
        Math.min(maxScroll, tuneScroll.scrollTop + dy),
      );
    }
  }

  // Keep the loop alive for the whole drag — early frames often run before
  // any dragover has set clientY.
  tuneDragScrollRaf = requestAnimationFrame(tickTuneDragScroll);
}

/** @param {number} [initialClientY] */
function startTuneDragSession(initialClientY) {
  stopTuneDragSession?.();
  tuneDragClientY =
    typeof initialClientY === "number" ? initialClientY : null;
  pageSetlist.classList.add("is-dragging-tune");

  const onDragOver = (event) => {
    if (!dragTuneId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    tuneDragClientY = event.clientY;
  };

  document.addEventListener("dragover", onDragOver, true);
  tuneDragScrollRaf = requestAnimationFrame(tickTuneDragScroll);

  stopTuneDragSession = () => {
    document.removeEventListener("dragover", onDragOver, true);
    if (tuneDragScrollRaf != null) {
      cancelAnimationFrame(tuneDragScrollRaf);
      tuneDragScrollRaf = null;
    }
    tuneDragClientY = null;
    pageSetlist.classList.remove("is-dragging-tune");
    stopTuneDragSession = null;
  };
}

function renderTunes() {
  tuneList.replaceChildren();
  tuneEmpty.hidden = tunes.length > 0;
  addTuneBtn.disabled = tunes.length >= MAX_TUNES;

  for (const tune of tunes) {
    const row = document.createElement("div");
    row.className = "tune-row";
    row.setAttribute("role", "listitem");
    row.dataset.tuneId = tune.id;
    if (tune.id === activeTuneId) row.classList.add("is-active");

    const handle = document.createElement("div");
    handle.className = "tune-drag-handle";
    handle.title = "Drag to reorder";
    handle.setAttribute("aria-hidden", "true");
    handle.textContent = "⋮⋮";

    const name = document.createElement("h3");
    name.className = "tune-row-name";
    name.textContent = tune.name;
    name.title = "Click to rename";
    name.setAttribute("role", "button");
    name.tabIndex = 0;
    name.addEventListener("click", (event) => {
      event.stopPropagation();
      beginInlineTuneRename(tune.id, name);
    });
    name.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        beginInlineTuneRename(tune.id, name);
      }
    });

    const meta = document.createElement("span");
    meta.className = "tune-row-meta";
    const n = tune.transitions.length;
    meta.textContent = `${n} transition${n === 1 ? "" : "s"}`;

    const badge = document.createElement("span");
    badge.className = "tune-row-badge";
    badge.textContent = tune.id === activeTuneId ? "Playing" : "Play";

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "instrument-remove";
    removeBtn.textContent = "×";
    removeBtn.title = `Remove ${tune.name}`;
    removeBtn.setAttribute("aria-label", `Remove ${tune.name}`);
    removeBtn.disabled = tunes.length <= 1;
    removeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      void removeTune(tune.id);
    });

    row.append(handle, name, meta, badge, removeBtn);
    wireTuneRowDrag(row, handle, tune.id);
    row.addEventListener("click", (event) => {
      if (
        event.target instanceof Element &&
        event.target.closest(
          ".tune-drag-handle, .tune-row-name, .instrument-remove, .scene-title-input",
        )
      ) {
        return;
      }
      if (tune.id !== activeTuneId) setActiveTune(tune.id);
      else syncTuneUi();
    });
    tuneList.append(row);
  }
}

/**
 * @param {HTMLElement} row
 * @param {HTMLElement} handle
 * @param {string} tuneId
 */
function wireTuneRowDrag(row, handle, tuneId) {
  handle.addEventListener("pointerdown", (event) => {
    if (event.button != null && event.button !== 0) return;
    row.dataset.dragArmed = "1";
    const onUp = () => {
      window.removeEventListener("pointerup", onUp, true);
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
    dragTuneId = tuneId;
    row.classList.add("is-dragging");
    row.dataset.dragTuneId = tuneId;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", tuneId);
    }
    startTuneDragSession(event.clientY);
  });

  row.addEventListener("dragend", () => {
    delete row.dataset.dragArmed;
    delete row.dataset.dragTuneId;
    row.classList.remove("is-dragging");
    clearTuneDropMarks();
    stopTuneDragSession?.();
    dragTuneId = null;
  });

  row.addEventListener("dragover", (event) => {
    if (!dragTuneId || dragTuneId === tuneId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    tuneDragClientY = event.clientY;
    clearTuneDropMarks();
    const rect = row.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    row.classList.add(after ? "is-drop-after" : "is-drop-before");
  });

  row.addEventListener("drop", (event) => {
    if (!dragTuneId || dragTuneId === tuneId) return;
    event.preventDefault();
    event.stopPropagation();
    const fromId = dragTuneId;
    const rect = row.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    clearTuneDropMarks();
    stopTuneDragSession?.();
    dragTuneId = null;
    if (moveTune(tunes, fromId, tuneId, after)) {
      persistSession();
      renderTunes();
      syncTuneUi();
    }
  });
}

/**
 * @param {string} id
 * @param {HTMLElement} target
 */
function beginInlineTuneRename(id, target) {
  const tune = tunes.find((item) => item.id === id);
  if (!tune || !(target instanceof HTMLElement) || !target.isConnected) return;
  abortInlineEdits();

  const input = document.createElement("input");
  input.type = "text";
  input.className = "scene-title-input";
  input.maxLength = 40;
  input.value = tune.name;
  input.setAttribute("aria-label", "Tune name");
  input.autocomplete = "off";
  input.spellcheck = false;

  const parent = target.parentElement;
  if (!parent) return;
  target.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = (commit) => {
    if (finished) return;
    finished = true;
    if (endInlineTuneRename === finishAbort) endInlineTuneRename = null;
    input.removeEventListener("keydown", onKeydown);
    input.removeEventListener("blur", onBlur);

    const next = input.value.trim();
    if (commit && next) {
      tune.name = normalizeTuneName(next);
      persistSession();
    }

    const restored = document.createElement("h3");
    restored.className = "tune-row-name";
    restored.textContent = tune.name;
    restored.title = "Click to rename";
    restored.setAttribute("role", "button");
    restored.tabIndex = 0;
    restored.addEventListener("click", (event) => {
      event.stopPropagation();
      beginInlineTuneRename(id, restored);
    });
    restored.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        beginInlineTuneRename(id, restored);
      }
    });
    if (input.isConnected) input.replaceWith(restored);
    else parent.prepend(restored);
    syncTuneUi();
  };

  const finishAbort = () => finish(false);
  endInlineTuneRename = finishAbort;

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

function setActiveTune(tuneId) {
  const tune = tunes.find((item) => item.id === tuneId);
  if (!tune) return;
  stopTimedFade();
  activeTuneId = tune.id;
  fromRow = 0;
  toRow = Math.min(1, tune.transitions.length - 1);
  selectedRow = 0;
  cross = 0;
  bindActiveTune();
  syncCrossUi();
  syncTuneUi();
  renderRows();
  renderSelectedGroup();
  pushToDmx();
  persistSession();
}

async function addTune() {
  if (tunes.length >= MAX_TUNES) return;
  const name = await promptName({
    title: "New tune",
    confirmLabel: "Create",
    initial: defaultTuneName(tunes.length),
  });
  if (!name) return;
  if (tunes.length >= MAX_TUNES) return;
  const tune = createTune({ name });
  tunes.push(tune);
  setActiveTune(tune.id);
  renderTunes();
}

/** @param {string} id */
async function removeTune(id) {
  if (tunes.length <= 1) return;
  const tune = tunes.find((item) => item.id === id);
  if (!tune) return;
  const ok = await confirmAction({
    title: "Remove tune?",
    message: `Remove “${tune.name}” and all of its transitions?`,
    confirmLabel: "Remove",
  });
  if (!ok) return;
  const index = tunes.findIndex((item) => item.id === id);
  if (index < 0) return;
  const wasActive = tune.id === activeTuneId;
  tunes.splice(index, 1);
  if (wasActive) {
    const next = tunes[Math.min(index, tunes.length - 1)];
    setActiveTune(next.id);
  } else {
    renderTunes();
    persistSession();
  }
}

/** @type {string | null} */
let dragTransitionId = null;
/** @type {number | null} */
let transitionDragClientY = null;
/** @type {number | null} */
let transitionDragScrollRaf = null;
/** @type {null | (() => void)} */
let stopTransitionDragSession = null;

const TRANSITION_DRAG_SCROLL_EDGE = 56;
const TRANSITION_DRAG_SCROLL_MAX = 24;

function tickTransitionDragScroll() {
  transitionDragScrollRaf = null;
  if (!dragTransitionId) return;

  if (transitionDragClientY != null) {
    const rect = rowsScroll.getBoundingClientRect();
    const y = transitionDragClientY;
    let dy = 0;

    if (y < rect.top) {
      dy = -TRANSITION_DRAG_SCROLL_MAX;
    } else if (y > rect.bottom) {
      dy = TRANSITION_DRAG_SCROLL_MAX;
    } else if (y < rect.top + TRANSITION_DRAG_SCROLL_EDGE) {
      const distance = rect.top + TRANSITION_DRAG_SCROLL_EDGE - y;
      const t = Math.min(1, distance / TRANSITION_DRAG_SCROLL_EDGE);
      dy = -Math.ceil(Math.max(2, t * TRANSITION_DRAG_SCROLL_MAX));
    } else if (y > rect.bottom - TRANSITION_DRAG_SCROLL_EDGE) {
      const distance = y - (rect.bottom - TRANSITION_DRAG_SCROLL_EDGE);
      const t = Math.min(1, distance / TRANSITION_DRAG_SCROLL_EDGE);
      dy = Math.ceil(Math.max(2, t * TRANSITION_DRAG_SCROLL_MAX));
    }

    if (dy !== 0) {
      const maxScroll = Math.max(
        0,
        rowsScroll.scrollHeight - rowsScroll.clientHeight,
      );
      rowsScroll.scrollTop = Math.max(
        0,
        Math.min(maxScroll, rowsScroll.scrollTop + dy),
      );
    }
  }

  transitionDragScrollRaf = requestAnimationFrame(tickTransitionDragScroll);
}

/** @param {number} [initialClientY] */
function startTransitionDragSession(initialClientY) {
  stopTransitionDragSession?.();
  transitionDragClientY =
    typeof initialClientY === "number" ? initialClientY : null;
  pageTunes.classList.add("is-dragging-transition");

  const onDragOver = (event) => {
    if (!dragTransitionId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    transitionDragClientY = event.clientY;
  };

  document.addEventListener("dragover", onDragOver, true);
  transitionDragScrollRaf = requestAnimationFrame(tickTransitionDragScroll);

  stopTransitionDragSession = () => {
    document.removeEventListener("dragover", onDragOver, true);
    if (transitionDragScrollRaf != null) {
      cancelAnimationFrame(transitionDragScrollRaf);
      transitionDragScrollRaf = null;
    }
    transitionDragClientY = null;
    pageTunes.classList.remove("is-dragging-transition");
    stopTransitionDragSession = null;
  };
}

/**
 * @param {HTMLElement} bank
 * @param {HTMLElement} handle
 * @param {number} index
 */
function wireTransitionRowDrag(bank, handle, index) {
  const transitionId = getActiveTune().transitions[index]?.id;
  if (!transitionId) return;

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
    dragTransitionId = transitionId;
    bank.classList.add("is-dragging");
    bank.dataset.dragTransitionId = transitionId;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", transitionId);
    }
    startTransitionDragSession(event.clientY);
  });

  bank.addEventListener("dragend", () => {
    delete bank.dataset.dragArmed;
    delete bank.dataset.dragTransitionId;
    bank.classList.remove("is-dragging");
    clearTransitionDropMarks();
    stopTransitionDragSession?.();
    dragTransitionId = null;
  });

  bank.addEventListener("dragover", (event) => {
    if (!dragTransitionId || dragTransitionId === transitionId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    transitionDragClientY = event.clientY;
    clearTransitionDropMarks();
    const rect = bank.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    bank.classList.add(after ? "is-drop-after" : "is-drop-before");
  });

  bank.addEventListener("drop", (event) => {
    if (!dragTransitionId || dragTransitionId === transitionId) return;
    event.preventDefault();
    event.stopPropagation();
    const fromId = dragTransitionId;
    const rect = bank.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    const tune = getActiveTune();
    const selectedId = tune.transitions[selectedRow]?.id;
    const fromSelId = tune.transitions[fromRow]?.id;
    const toSelId = tune.transitions[toRow]?.id;
    clearTransitionDropMarks();
    stopTransitionDragSession?.();
    dragTransitionId = null;
    if (!moveTransition(tune, fromId, transitionId, after)) return;
    const indexOf = (id) =>
      id ? tune.transitions.findIndex((t) => t.id === id) : -1;
    selectedRow = Math.max(0, indexOf(selectedId));
    fromRow = Math.max(0, indexOf(fromSelId));
    toRow = Math.max(0, indexOf(toSelId));
    bindActiveTune();
    if (fromRow === toRow && rows.length > 1) {
      toRow = (fromRow + 1) % rows.length;
    }
    renderRows();
    renderSelectedGroup();
    pushToDmx();
    persistSession();
  });
}

function clearTransitionDropMarks() {
  for (const el of rowsEl.querySelectorAll(".is-drop-before, .is-drop-after")) {
    el.classList.remove("is-drop-before", "is-drop-after");
  }
}

function renderRows() {
  abortInlineEdits();
  rowsEl.replaceChildren();
  rowUi = [];
  selectedRow = Math.min(Math.max(0, selectedRow), Math.max(0, rows.length - 1));

  syncPlaybackPair();
  for (let r = 0; r < rows.length; r++) {
    const bank = document.createElement("section");
    bank.className = "fader-row";
    bank.dataset.row = String(r);
    bank.classList.toggle("is-selected", r === selectedRow);
    bank.classList.toggle("is-current", r === fromRow);
    bank.classList.toggle("is-next", r === toRow);

    const head = document.createElement("div");
    head.className = "fader-row-head";
    head.tabIndex = 0;
    head.setAttribute("role", "button");
    head.setAttribute("aria-pressed", r === selectedRow ? "true" : "false");
    head.title = "Click to set as Current";

    const dragHandle = document.createElement("div");
    dragHandle.className = "fader-row-drag-handle";
    dragHandle.title = "Drag to reorder";
    dragHandle.setAttribute("aria-hidden", "true");
    dragHandle.textContent = "⋮⋮";

    const titleGroup = document.createElement("div");
    titleGroup.className = "scene-title-group";

    const title = document.createElement("h3");
    title.className = "scene-title";
    title.textContent = transitionName(r);
    title.title = "Double-click to rename";

    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "scene-menu-btn";
    menuBtn.innerHTML = '<span class="scene-menu-dots" aria-hidden="true"></span>';
    menuBtn.title = "Transition options";
    menuBtn.setAttribute("aria-label", `Options for ${transitionName(r)}`);
    menuBtn.setAttribute("aria-haspopup", "menu");
    menuBtn.setAttribute("aria-expanded", "false");
    menuBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      if (menuBtn.getAttribute("aria-expanded") === "true") {
        closeSceneRowMenu?.();
        return;
      }
      void openSceneRowMenu(menuBtn, r);
    });

    titleGroup.append(title, menuBtn);

    const fadeGroup = document.createElement("div");
    fadeGroup.className = "transition-fade";
    fadeGroup.title = "Fade time to arrive at this transition";
    const fadeLabel = document.createElement("span");
    fadeLabel.className = "transition-fade-label";
    fadeLabel.textContent = "In";
    const fadeSelect = document.createElement("select");
    fadeSelect.className = "transition-fade-select";
    fadeSelect.setAttribute(
      "aria-label",
      `Fade time into ${transitionName(r)}`,
    );
    const transition = getActiveTune().transitions[r];
    const fadeValue = normalizeTransitionFadeTime(transition?.fadeTime);
    for (const sec of TRANSITION_FADE_TIMES) {
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
      const next = normalizeTransitionFadeTime(fadeSelect.value);
      if (transition) transition.fadeTime = next;
      if (r === toRow) refreshRowSelects();
      persistSession();
    });
    fadeGroup.append(fadeLabel, fadeSelect);

    const hint = document.createElement("span");
    hint.className = "fader-row-hint";
    hint.textContent =
      r === fromRow
        ? "Current"
        : r === toRow
          ? "Next"
          : "Click to set Current";

    head.append(dragHandle, titleGroup, fadeGroup, hint);
    wireTransitionRowDrag(bank, dragHandle, r);
    head.addEventListener("click", (event) => {
      if (
        event.target instanceof Element &&
        event.target.closest(
          ".scene-title-input, .fader-row-drag-handle, .scene-menu-btn, .transition-fade",
        )
      ) {
        return;
      }
      setSelectedRow(r);
    });
    head.addEventListener("keydown", (event) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.target instanceof HTMLSelectElement) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setSelectedRow(r);
      }
    });
    title.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      beginInlineRename(r);
    });

    const grid = document.createElement("div");
    grid.className = "faders";
    grid.setAttribute("aria-label", `${sceneName(r)} faders`);

    const valueEls = [];
    const patchLabelEls = [];
    const sliders = [];

    for (let i = 0; i < FADER_COUNT; i++) {
      const wrap = document.createElement("div");
      wrap.className = "fader";
      wrap.dataset.fader = String(i);
      wrap.classList.toggle("is-selected-fader", i === selectedFader);
      wrap.addEventListener("pointerdown", () => setSelectedFader(i));

      const label = makeFaderNameLabel(i);

      const patched = document.createElement("div");
      patched.className = "patch-target";
      patched.textContent = formatChannelLabel(patch[i]);
      patched.title = formatChannelTooltip(patch[i]);
      if (isUnpatched(patch[i])) patched.classList.add("is-unpatched");
      patchLabelEls[i] = patched;

      const value = document.createElement("div");
      value.className = "value";
      value.textContent = String(rows[r][i]);
      valueEls[i] = value;

      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = "255";
      slider.value = String(rows[r][i]);
      slider.setAttribute("aria-label", `${sceneName(r)} ${faderName(i)}`);
      applyFaderPatchState(wrap, slider, patch[i]);
      slider.addEventListener("input", () => {
        setSelectedFader(i);
        rows[r][i] = Number(slider.value);
        value.textContent = String(rows[r][i]);
        pushToDmx();
      });
      sliders[i] = slider;

      wrap.append(label, patched, value, slider);
      grid.append(wrap);
    }

    bank.append(head, grid);
    rowsEl.append(bank);
    rowUi[r] = { valueEls, patchLabelEls, sliders };
  }

  refreshRowSelects();
}

function refreshFaderPatchLabels() {
  for (const ui of rowUi) {
    for (let i = 0; i < FADER_COUNT; i++) {
      const el = ui.patchLabelEls[i];
      el.textContent = formatChannelLabel(patch[i]);
      el.title = formatChannelTooltip(patch[i]);
      el.classList.toggle("is-unpatched", isUnpatched(patch[i]));
      const wrap = ui.sliders[i].closest(".fader");
      if (wrap instanceof HTMLElement) {
        applyFaderPatchState(wrap, ui.sliders[i], patch[i]);
      }
    }
  }
  refreshLiveRow();
  refreshSelectedGroup();
}

function syncSlidersFromState() {
  for (let r = 0; r < rows.length; r++) {
    for (let i = 0; i < FADER_COUNT; i++) {
      rowUi[r].sliders[i].value = String(rows[r][i]);
      rowUi[r].valueEls[i].textContent = String(rows[r][i]);
    }
  }
  refreshSelectedGroup();
}

function conflictChannels() {
  const counts = new Map();
  for (const targets of patch) {
    for (const target of targets) {
      counts.set(target.channel, (counts.get(target.channel) ?? 0) + 1);
    }
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([ch]) => ch);
}

function updateConflictBanner() {
  const conflicts = conflictChannels();
  if (conflicts.length === 0) {
    patchConflictsEl.hidden = true;
    patchConflictsEl.textContent = "";
    return;
  }
  patchConflictsEl.hidden = false;
  patchConflictsEl.textContent = `Shared DMX channels (HTP / highest wins): ${conflicts.join(", ")}`;
}

function nextFreeChannel(used = new Set(patch.flatMap((t) => t.map((x) => x.channel)))) {
  for (let ch = 1; ch <= 512; ch++) {
    if (!used.has(ch)) return ch;
  }
  return 1;
}

function channelGroupRange(groupIndex) {
  const start = groupIndex * CHANNEL_GROUP_SIZE + 1;
  const end = Math.min(start + CHANNEL_GROUP_SIZE - 1, 512);
  return { start, end };
}

/** @type {null | (() => void)} */
let closeChannelPicker = null;
/** @type {null | (() => void)} */
let closeCountPicker = null;
/** @type {null | (() => void)} */
let closeInstrumentGroupPicker = null;

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
function makeChannelPickerButton({
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
    setPickerButtonLabel(btn, `Ch${ch}`);
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
function makeCountPickerButton({
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
 * Instrument-group picker (Ungrouped + named groups).
 * @param {{
 *   getGroupId: () => string | null,
 *   setGroupId: (groupId: string | null) => void | Promise<void>,
 *   className?: string,
 *   ariaLabel?: string | ((groupId: string | null, label: string) => string),
 * }} opts
 */
function makeInstrumentGroupPickerButton({
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
    btn.title = "Choose instrument group";
  };

  sync();
  btn.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const groupId = await pickInstrumentGroup({
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
  return instrumentGroups.find((group) => group.id === groupId)?.name ?? "Ungrouped";
}

/**
 * @param {{ anchor: HTMLElement, current: string | null }} opts
 * @returns {Promise<string | null | undefined>}
 *   string = group id, null = Ungrouped, undefined = dismissed
 */
function pickInstrumentGroup({ anchor, current }) {
  closeInstrumentGroupPicker?.();
  closeCountPicker?.();
  closeChannelPicker?.();
  closeSetlistMenu?.();
  closeChannelsSceneMenu?.();
  closeScenePicker?.();
  closeSceneRowMenu?.();
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
      if (instrumentGroupMenu.contains(target) || anchor.contains(target)) return;
      finish(undefined);
    };

    const onDocKeydown = (event) => {
      if (event.key === "Escape") finish(undefined);
    };

    const cleanup = () => {
      instrumentGroupMenu.hidden = true;
      if (closeInstrumentGroupPicker === finishNull) {
        closeInstrumentGroupPicker = null;
      }
      document.removeEventListener("pointerdown", onDocPointer, true);
      document.removeEventListener("keydown", onDocKeydown, true);
    };

    const finishNull = () => finish(undefined);
    closeInstrumentGroupPicker = finishNull;

    instrumentGroupMenuList.replaceChildren();

    const addItem = (label, value) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "popup-menu-item";
      const isCurrent = (value ?? null) === (current ?? null);
      if (isCurrent) item.classList.add("is-current");
      item.setAttribute("role", "menuitem");
      item.textContent = label;
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        finish(value);
      });
      instrumentGroupMenuList.append(item);
    };

    addItem("Ungrouped", null);
    for (const group of instrumentGroups) {
      addItem(group.name, group.id);
    }

    instrumentGroupMenu.hidden = false;

    const anchorRect = anchor.getBoundingClientRect();
    const menuWidth = 180;
    const menuHeight = Math.min(320, 48 + (instrumentGroups.length + 1) * 36);
    let left = anchorRect.left;
    let top = anchorRect.bottom + 6;
    if (left + menuWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuWidth - 8);
    }
    if (top + menuHeight > window.innerHeight - 8) {
      top = Math.max(8, anchorRect.top - menuHeight - 6);
    }
    instrumentGroupMenu.style.left = `${left}px`;
    instrumentGroupMenu.style.top = `${top}px`;

    const currentEl = instrumentGroupMenuList.querySelector(".is-current");
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
  closeInstrumentGroupPicker?.();
  closeSetlistMenu?.();
  closeChannelsSceneMenu?.();
  closeScenePicker?.();
  closeSceneRowMenu?.();
  closeFaderNameMenu?.();

  const clamped = Math.min(
    MAX_INSTRUMENT_CHANNELS,
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
    for (let n = 1; n <= MAX_INSTRUMENT_CHANNELS; n++) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "popup-menu-item";
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
    const menuWidth = 100;
    const menuHeight = 280;
    let left = anchorRect.left;
    let top = anchorRect.bottom + 6;
    if (left + menuWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuWidth - 8);
    }
    if (top + menuHeight > window.innerHeight - 8) {
      top = Math.max(8, anchorRect.top - menuHeight - 6);
    }
    countMenu.style.left = `${left}px`;
    countMenu.style.top = `${top}px`;

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
  closeInstrumentGroupPicker?.();
  closeSetlistMenu?.();
  closeChannelsSceneMenu?.();
  closeScenePicker?.();
  closeSceneRowMenu?.();
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

      for (const el of channelMenuList.querySelectorAll(".popup-menu-item")) {
        el.classList.toggle("is-open", el === trigger);
      }

      for (let ch = start; ch <= end; ch++) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "popup-menu-item";
        if (ch === current) item.classList.add("is-current");
        item.setAttribute("role", "menuitem");
        item.textContent = `Ch ${ch}`;
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
        if (/^\d+$/.test(q)) {
          for (let ch = 1; ch <= 512; ch++) {
            if (!String(ch).startsWith(q)) continue;
            const item = document.createElement("button");
            item.type = "button";
            item.className = "popup-menu-item";
            if (ch === current) item.classList.add("is-current");
            item.textContent = `Ch ${ch}`;
            item.addEventListener("click", (event) => {
              event.stopPropagation();
              finish(ch);
            });
            channelMenuList.append(item);
          }
        }
        return;
      }

      for (let g = 0; g < CHANNEL_GROUP_COUNT; g++) {
        const { start, end } = channelGroupRange(g);
        const containsCurrent = current >= start && current <= end;
        const item = document.createElement("button");
        item.type = "button";
        item.className = "popup-menu-item";
        if (containsCurrent) item.classList.add("is-current");
        item.setAttribute("role", "menuitem");
        item.innerHTML = `<span>${start}–${end}</span><span class="popup-menu-caret">›</span>`;
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
        const n = Number(channelMenuFilter.value.trim());
        if (Number.isInteger(n) && n >= 1 && n <= 512) finish(n);
        else {
          const first = channelMenuList.querySelector(".popup-menu-item");
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
    const menuWidth = 320;
    const menuHeight = 320;
    let left = anchorRect.left;
    let top = anchorRect.bottom + 6;
    if (left + menuWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuWidth - 8);
    }
    if (top + menuHeight > window.innerHeight - 8) {
      top = Math.max(8, anchorRect.top - menuHeight - 6);
    }
    channelMenu.style.left = `${left}px`;
    channelMenu.style.top = `${top}px`;

    channelMenuFilter.addEventListener("input", onFilterInput);
    channelMenuFilter.addEventListener("keydown", onFilterKeydown);
    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onDocKeydown, true);

    queueMicrotask(() => channelMenuFilter.focus());
  });
}

function assignChannelToFader(faderIndex, targetIndex, channel) {
  const max = targetIndex == null ? 255 : patch[faderIndex][targetIndex].max;
  if (targetIndex == null) {
    patch[faderIndex] = [...patch[faderIndex], makeTarget(channel, max)];
  } else {
    patch[faderIndex][targetIndex] = makeTarget(channel, max);
  }
  const map = new Map();
  for (const t of patch[faderIndex]) map.set(t.channel, t);
  patch[faderIndex] = [...map.values()].sort((a, b) => a.channel - b.channel);
  persistAndRefresh();
  renderPatchTable();
}

function renderPatchTable() {
  abortInlineEdits();
  patchTableEl.replaceChildren();

  for (let i = 0; i < FADER_COUNT; i++) {
    const card = document.createElement("article");
    card.className = "patch-card";
    card.dataset.fader = String(i);
    card.setAttribute("aria-selected", i === selectedFader ? "true" : "false");
    card.classList.toggle("is-selected", i === selectedFader);
    card.addEventListener("pointerdown", () => setSelectedFader(i));

    const head = document.createElement("div");
    head.className = "patch-card-head";

    const title = wirePatchFaderTitle(document.createElement("h3"), i);

    const subtitle = document.createElement("span");
    subtitle.className = "patch-card-sub";
    subtitle.textContent = isUnpatched(patch[i])
      ? "Unpatched"
      : `${patch[i].length} channel${patch[i].length === 1 ? "" : "s"}`;

    const actions = document.createElement("div");
    actions.className = "patch-card-actions";

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "btn-quiet";
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
    addBtn.className = "btn-quiet";
    addBtn.textContent = "+ Channel";
    addBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      const used = new Set(patch[i].map((t) => t.channel));
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
    clearBtn.className = "btn-quiet";
    clearBtn.textContent = "Clear";
    clearBtn.disabled = isUnpatched(patch[i]);
    clearBtn.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    clearBtn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const ok = await confirmClearFaderPatch(faderName(i));
      if (!ok) return;
      patch[i] = [];
      persistAndRefresh();
      renderPatchTable();
    });

    actions.append(renameBtn, addBtn, clearBtn);
    head.append(title, subtitle, actions);

    const targets = document.createElement("div");
    targets.className = "patch-targets";

    if (isUnpatched(patch[i])) {
      const empty = document.createElement("button");
      empty.type = "button";
      empty.className = "patch-empty";
      empty.textContent = "Add a DMX channel";
      empty.addEventListener("click", () => addBtn.click());
      targets.append(empty);
    } else {
      patch[i].forEach((target, targetIndex) => {
        const cell = document.createElement("div");
        cell.className = "patch-fader";

        const channelPicker = makeChannelPickerButton({
          className: "channel-picker-btn patch-ch-btn",
          getChannel: () => patch[i][targetIndex].channel,
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
          patch[i][targetIndex] = makeTarget(target.channel, max);
          maxValue.textContent = String(max);
          persistAndRefresh();
        });

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "patch-remove";
        removeBtn.setAttribute("aria-label", `Remove channel ${target.channel} from ${faderName(i)}`);
        removeBtn.textContent = "×";
        removeBtn.addEventListener("click", () => {
          patch[i] = patch[i].filter((_, idx) => idx !== targetIndex);
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

function persistAndRefresh() {
  refreshFaderPatchLabels();
  updateConflictBanner();
  ensureChannelRow();
  pushToDmx();
}

function syncCrossUi() {
  const pct = Math.round(cross);
  crossfader.value = String(pct);
  crossfader.style.setProperty("--cross-pct", `${pct}%`);
  crossValue.textContent = `${pct}%`;
}

function syncBlackoutButtons() {
  const masterLatched = masterBlackoutSnapshot != null;
  blackoutBtn.classList.toggle("is-blackout", masterLatched);
  blackoutBtn.title = masterLatched ? "Restore" : "Blackout";
  blackoutBtn.setAttribute("aria-label", masterLatched ? "Restore" : "Blackout");

  const fromLatched = fromSubBlackoutSnapshot != null;
  fromSubBlackoutBtn.classList.toggle("is-blackout", fromLatched);
  fromSubBlackoutBtn.title = fromLatched
    ? `Restore ${sceneName(fromRow)}`
    : `Blackout ${sceneName(fromRow)}`;
  fromSubBlackoutBtn.setAttribute("aria-label", fromSubBlackoutBtn.title);

  const toLatched = toSubBlackoutSnapshot != null;
  toSubBlackoutBtn.classList.toggle("is-blackout", toLatched);
  toSubBlackoutBtn.title = toLatched
    ? `Restore ${sceneName(toRow)}`
    : `Blackout ${sceneName(toRow)}`;
  toSubBlackoutBtn.setAttribute("aria-label", toSubBlackoutBtn.title);
}

function clearBlackoutSnapshots() {
  masterBlackoutSnapshot = null;
  fromSubBlackoutSnapshot = null;
  toSubBlackoutSnapshot = null;
  syncBlackoutButtons();
}

function syncSubmasterLabels() {
  fromSubLabel.textContent = sceneName(fromRow);
  toSubLabel.textContent = sceneName(toRow);
  fromSubInput.setAttribute("aria-label", `${sceneName(fromRow)} submaster`);
  toSubInput.setAttribute("aria-label", `${sceneName(toRow)} submaster`);
  syncBlackoutButtons();
}

function fromCrossWeight() {
  return 1 - cross / 100;
}

function toCrossWeight() {
  return cross / 100;
}

function masterWeight() {
  return master / 100;
}

/** Live contribution = setting × crossfade × master (drives fader thumbs). */
function syncSubmasterLive() {
  const m = masterWeight();
  const fromPct = Math.round(fromSub * fromCrossWeight() * m);
  const toPct = Math.round(toSub * toCrossWeight() * m);

  fromSubInput.value = String(fromPct);
  toSubInput.value = String(toPct);
  fromSubValue.textContent = `${fromPct}%`;
  toSubValue.textContent = `${toPct}%`;
  fromSubValue.title =
    fromPct === Math.round(fromSub) ? "" : `Set ${Math.round(fromSub)}%`;
  toSubValue.title = toPct === Math.round(toSub) ? "" : `Set ${Math.round(toSub)}%`;
}

function syncSubmasterUi() {
  syncSubmasterLive();
  syncSubmasterLabels();
}

function setSubmasterFromLive(which, live) {
  const level = Math.max(0, Math.min(100, Number(live)));
  const weight =
    (which === "from" ? fromCrossWeight() : toCrossWeight()) * masterWeight();
  const setting = weight > 0.001 ? Math.min(100, level / weight) : level;
  if (which === "from") {
    fromSub = setting;
    if (fromSubBlackoutSnapshot != null) {
      fromSubBlackoutSnapshot = null;
      syncBlackoutButtons();
    }
  } else {
    toSub = setting;
    if (toSubBlackoutSnapshot != null) {
      toSubBlackoutSnapshot = null;
      syncBlackoutButtons();
    }
  }
  syncSubmasterLive();
}

function setCross(value, { fromUser = false, persist = true } = {}) {
  cross = Math.max(0, Math.min(100, value));
  syncCrossUi();
  syncSubmasterLive();
  if (fromUser) stopTimedFade();
  pushToDmx({ persist });
}

function updateFadePauseButton() {
  const running = fadeState != null;
  const paused = running && fadeState.pausedAt != null;
  fadePauseBtn.disabled = !running;
  fadePauseBtn.textContent = paused ? "Resume" : "Pause";
  fadePauseBtn.classList.toggle("is-paused", paused);
  goBtn.classList.toggle("is-running", running && !paused);
  goBtn.disabled = rows.length < 2;
}

function stopTimedFade() {
  if (fadeRaf != null) {
    cancelAnimationFrame(fadeRaf);
    fadeRaf = null;
  }
  fadeState = null;
  updateFadePauseButton();
}

/**
 * GO: fade from the current transition’s fader levels to the next transition
 * in tune order (using that next transition’s fadeTime), then advance.
 */
function goNextTransition() {
  if (rows.length < 2) return;

  // Current = the selected transition (the levels you’re on); Next = following.
  stopTimedFade();
  fromRow = Math.min(Math.max(0, selectedRow), rows.length - 1);
  syncPlaybackPair();
  refreshRowSelects();

  const seconds = normalizeTransitionFadeTime(
    getActiveTune().transitions[toRow]?.fadeTime,
  );
  fadeTime = seconds;

  // Park on Current, then timed-fade into Next.
  setCross(0, { persist: false });

  if (fadeRaf != null) cancelAnimationFrame(fadeRaf);

  fadeState = {
    start: 0,
    target: 100,
    durationMs: seconds * 1000,
    startedAt: performance.now(),
    pausedAt: null,
    mode: "go",
  };
  updateFadePauseButton();
  fadeRaf = requestAnimationFrame(tickTimedFade);
  persistSession();
}

function completeGoAdvance() {
  // Capture destination before advancing Current/Next.
  const arrivedAt = toRow;
  stopTimedFade();
  fromRow = arrivedAt;
  selectedRow = arrivedAt;
  syncPlaybackPair();
  setCross(0, { persist: false });
  refreshRowSelects();
  renderRows();
  renderSelectedGroup();
  pushToDmx();
  persistSession();

  const bank = rowsEl.querySelector(`.fader-row[data-row="${arrivedAt}"]`);
  bank?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function tickTimedFade(now) {
  if (!fadeState || fadeState.pausedAt != null) {
    fadeRaf = null;
    return;
  }
  const t = Math.min(1, (now - fadeState.startedAt) / fadeState.durationMs);
  const eased = t * t * (3 - 2 * t);
  setCross(fadeState.start + (fadeState.target - fadeState.start) * eased, {
    persist: false,
  });
  if (t < 1) {
    fadeRaf = requestAnimationFrame(tickTimedFade);
  } else {
    const wasGo = fadeState.mode === "go";
    fadeRaf = null;
    fadeState = null;
    updateFadePauseButton();
    if (wasGo) {
      completeGoAdvance();
    } else {
      setCross(100);
    }
  }
}

function toggleFadePause() {
  if (!fadeState) return;

  if (fadeState.pausedAt == null) {
    fadeState.pausedAt = performance.now();
    if (fadeRaf != null) {
      cancelAnimationFrame(fadeRaf);
      fadeRaf = null;
    }
    updateFadePauseButton();
    return;
  }

  const pausedFor = performance.now() - fadeState.pausedAt;
  fadeState.startedAt += pausedFor;
  fadeState.pausedAt = null;
  updateFadePauseButton();
  fadeRaf = requestAnimationFrame(tickTimedFade);
}

function syncSetlistNameUi() {
  const label = normalizeSetlistName(setlistName);
  setlistName = label;
  if (setlistNameDisplay.isConnected) {
    setlistNameDisplay.hidden = false;
    setlistNameDisplay.textContent = label;
    setlistNameDisplay.title = "Click to rename";
  }
  setlistMenuBtn.hidden = false;
  setlistMenuBtn.setAttribute("aria-label", `Options for setlist ${label}`);
  document.title = `${label} · UnnaturalLight`;
}

function applySetlistName(name) {
  const next = normalizeSetlistName(name);
  if (!next || next === setlistName) return false;
  setlistName = next;
  syncSetlistNameUi();
  persistSession();
  return true;
}

function wireSetlistNameDisplay(el) {
  el.title = "Click to rename";
  el.setAttribute("role", "button");
  el.tabIndex = 0;
  el.addEventListener("click", () => {
    beginInlineSetlistRename();
  });
  el.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      beginInlineSetlistRename();
    }
  });
}

/** Edit the setlist name in place with a text input. */
function beginInlineSetlistRename() {
  abortInlineEdits();
  if (!(setlistNameDisplay instanceof HTMLElement) || !setlistNameDisplay.isConnected) {
    const el = document.getElementById("setlistNameDisplay");
    if (!(el instanceof HTMLElement)) return;
    setlistNameDisplay = el;
  }

  const title = setlistNameDisplay;
  const parent = title.parentElement;
  if (!parent) return;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "scene-title-input setlist-name-input";
  input.maxLength = 40;
  input.value = setlistName;
  input.setAttribute("aria-label", "Setlist name");
  input.autocomplete = "off";
  input.spellcheck = false;

  title.replaceWith(input);
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
    if (commit && next) applySetlistName(next);

    const restored = document.createElement("p");
    restored.id = "setlistNameDisplay";
    restored.className = "setlist-name";
    restored.textContent = setlistName;

    if (input.isConnected) input.replaceWith(restored);
    else parent.prepend(restored);

    setlistNameDisplay = restored;
    wireSetlistNameDisplay(restored);
    syncSetlistNameUi();
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

/**
 * @param {HTMLElement} anchor
 * @returns {Promise<"rename" | null>}
 */
function openSetlistMenu(anchor) {
  closeSetlistMenu?.();
  closeChannelsSceneMenu?.();
  closeScenePicker?.();
  closeSceneRowMenu?.();
  closeFaderNameMenu?.();
  closeChannelPicker?.();
  closeCountPicker?.();
  closeInstrumentGroupPicker?.();

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
      if (setlistMenu.contains(target) || anchor.contains(target)) return;
      finish(null);
    };

    const onDocKeydown = (event) => {
      if (event.key === "Escape") finish(null);
    };

    const cleanup = () => {
      setlistMenu.hidden = true;
      anchor.setAttribute("aria-expanded", "false");
      if (closeSetlistMenu === finishNull) closeSetlistMenu = null;
      document.removeEventListener("pointerdown", onDocPointer, true);
      document.removeEventListener("keydown", onDocKeydown, true);
    };

    const finishNull = () => finish(null);
    closeSetlistMenu = finishNull;

    setlistMenuList.replaceChildren();
    const item = document.createElement("button");
    item.type = "button";
    item.className = "popup-menu-item";
    item.setAttribute("role", "menuitem");
    item.textContent = "Rename";
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      finish("rename");
    });
    setlistMenuList.append(item);

    setlistMenu.hidden = false;
    anchor.setAttribute("aria-expanded", "true");

    const anchorRect = anchor.getBoundingClientRect();
    const menuWidth = 140;
    const menuHeight = 48;
    let left = anchorRect.left;
    let top = anchorRect.bottom + 6;
    if (left + menuWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuWidth - 8);
    }
    if (top + menuHeight > window.innerHeight - 8) {
      top = Math.max(8, anchorRect.top - menuHeight - 6);
    }
    setlistMenu.style.left = `${left}px`;
    setlistMenu.style.top = `${top}px`;

    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onDocKeydown, true);
  }).then((action) => {
    if (action === "rename") beginInlineSetlistRename();
    return action;
  });
}

function currentSetlistState() {
  // Keep transition names in sync (rows share level array refs already).
  const tune = getActiveTune();
  for (let i = 0; i < tune.transitions.length; i++) {
    if (typeof names[i] === "string") tune.transitions[i].name = names[i];
  }
  return {
    setlistName,
    navOrder,
    master,
    cross,
    fromSub,
    toSub,
    fadeTime,
    fromRow,
    toRow,
    selectedRow,
    tunes,
    activeTuneId,
    faderNames,
    instrumentGroups,
    instruments,
    patch,
  };
}

function readNavOrderFromDom() {
  return normalizeNavOrder(
    getNavLinks().map((link) => link.dataset.page).filter(Boolean),
  );
}

function applyNavOrder(order = navOrder) {
  navOrder = normalizeNavOrder(order);
  const byPage = new Map(
    getNavLinks().map((link) => [link.dataset.page, link]),
  );
  for (const page of navOrder) {
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

function wireNavReorder() {
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

function ensureInstrumentFormStartPicker() {
  if (instrumentFormStartPicker) {
    instrumentFormStartPicker.sync();
    return;
  }
  instrumentStartPicker.replaceChildren();
  instrumentFormStartPicker = makeChannelPickerButton({
    className: "channel-picker-btn channel-picker-btn-lg",
    getChannel: () => instrumentFormStart,
    setChannel: (channel) => {
      instrumentFormStart = channel;
    },
    ariaLabel: (ch) => `Instrument start channel ${ch}`,
  });
  instrumentStartPicker.append(instrumentFormStartPicker.el);
}

function ensureInstrumentFormCountPicker() {
  if (instrumentFormCountPicker) {
    instrumentFormCountPicker.sync();
    return;
  }
  instrumentCountPicker.replaceChildren();
  instrumentFormCountPicker = makeCountPickerButton({
    className: "channel-picker-btn channel-picker-btn-lg",
    getCount: () => instrumentFormCount,
    setCount: (count) => {
      instrumentFormCount = count;
    },
    ariaLabel: (n) => `Instrument channel count ${n}`,
  });
  instrumentCountPicker.append(instrumentFormCountPicker.el);
}

function ensureInstrumentFormQtyPicker() {
  if (instrumentFormQtyPicker) {
    instrumentFormQtyPicker.sync();
    return;
  }
  instrumentQtyPicker.replaceChildren();
  instrumentFormQtyPicker = makeCountPickerButton({
    className: "channel-picker-btn channel-picker-btn-lg",
    getCount: () => instrumentFormQty,
    setCount: (count) => {
      instrumentFormQty = Math.min(MAX_INSTRUMENT_QTY, Math.max(1, count));
      syncInstrumentFormAddLabel();
    },
    ariaLabel: (n) => `Add ${n} instruments`,
  });
  instrumentQtyPicker.append(instrumentFormQtyPicker.el);
}

function ensureInstrumentFormGroupPicker() {
  if (instrumentFormGroupPicker) {
    instrumentFormGroupPicker.sync();
    return;
  }
  instrumentFormGroupPickerHost.replaceChildren();
  instrumentFormGroupPicker = makeInstrumentGroupPickerButton({
    className: "channel-picker-btn channel-picker-btn-lg",
    getGroupId: () => instrumentFormGroupId,
    setGroupId: (groupId) => {
      instrumentFormGroupId = groupId;
    },
    ariaLabel: (_id, label) => `Instrument group ${label}`,
  });
  instrumentFormGroupPickerHost.append(instrumentFormGroupPicker.el);
}

function syncInstrumentFormAddLabel() {
  const qty = Math.max(1, Math.round(instrumentFormQty) || 1);
  addInstrumentBtn.textContent =
    qty === 1 ? "+ Instrument" : `+ ${qty} Instruments`;
}

/**
 * Names for a batch add. "Wash"→Wash 1…n; "Wash 3"→Wash 3, Wash 4…
 * @param {string} base
 * @param {number} qty
 * @returns {string[]}
 */
function batchInstrumentNames(base, qty) {
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

function syncInstrumentForm() {
  const full = instruments.length >= MAX_INSTRUMENTS;
  const groupsFull = instrumentGroups.length >= MAX_INSTRUMENT_GROUPS;
  addInstrumentBtn.disabled = full;
  addInstrumentGroupBtn.disabled = groupsFull;
  instrumentNameInput.disabled = full;
  ensureInstrumentFormStartPicker();
  ensureInstrumentFormCountPicker();
  ensureInstrumentFormQtyPicker();
  ensureInstrumentFormGroupPicker();
  syncInstrumentFormAddLabel();
  if (instrumentFormStartPicker) {
    instrumentFormStartPicker.el.disabled = full;
  }
  if (instrumentFormCountPicker) {
    instrumentFormCountPicker.el.disabled = full;
  }
  if (instrumentFormQtyPicker) {
    instrumentFormQtyPicker.el.disabled = full;
  }
  if (instrumentFormGroupPicker) {
    instrumentFormGroupPicker.el.disabled = full;
  }
}

/** Suggest next free start for the add form (after add / first paint). */
function suggestInstrumentFormStart() {
  const width = Math.max(1, Math.round(instrumentFormCount) || 1);
  const suggested = nextAvailableRange(instruments, width);
  if (!suggested) return;
  instrumentFormStart = suggested.channelStart;
  instrumentFormStartPicker?.sync();
}

function updateInstrumentConflicts() {
  /** @type {string[]} */
  const notes = [];
  for (let i = 0; i < instruments.length; i++) {
    const a = instruments[i];
    for (let j = i + 1; j < instruments.length; j++) {
      const b = instruments[j];
      if (
        findRangeConflict([b], a.channelStart, a.channelEnd)
      ) {
        notes.push(
          `${a.name} (${formatChannelRange(a)}) overlaps ${b.name} (${formatChannelRange(b)})`,
        );
      }
    }
  }
  instrumentConflicts.hidden = notes.length === 0;
  instrumentConflicts.textContent = notes.length
    ? `Channel conflicts: ${notes.join(" · ")}`
    : "";
  for (const row of instrumentList.querySelectorAll(".instrument-row")) {
    const id = row.getAttribute("data-id");
    const instrument = instruments.find((item) => item.id === id);
    if (!instrument) continue;
    const conflict = findRangeConflict(
      instruments,
      instrument.channelStart,
      instrument.channelEnd,
      instrument.id,
    );
    row.classList.toggle("is-conflict", Boolean(conflict));
  }
}

/**
 * @param {import("./instruments.js").Instrument} instrument
 * @param {number} start
 * @param {number} count
 * @param {{ sync: () => void } | null} startPicker
 * @param {{ sync: () => void } | null} countPicker
 * @returns {boolean}
 */
function commitInstrumentRange(instrument, start, count, startPicker, countPicker) {
  const range = normalizeChannelSpan(start, count);
  if (!range) {
    startPicker?.sync();
    countPicker?.sync();
    setStatus(
      `Start + channel count must fit in 1–${MAX_INSTRUMENT_CHANNELS} within DMX 1–512`,
      "error",
    );
    return false;
  }
  const conflict = findRangeConflict(
    instruments,
    range.channelStart,
    range.channelEnd,
    instrument.id,
  );
  if (conflict) {
    startPicker?.sync();
    countPicker?.sync();
    setStatus(
      `Range overlaps ${conflict.name} (${formatChannelRange(conflict)})`,
      "error",
    );
    updateInstrumentConflicts();
    return false;
  }
  instrument.channelStart = range.channelStart;
  instrument.channelEnd = range.channelEnd;
  startPicker?.sync();
  countPicker?.sync();
  updateInstrumentConflicts();
  persistSession();
  setStatus(
    `${instrument.name} → ${formatChannelRange(instrument)}`,
    dmx.connected ? "connected" : "idle",
  );
  return true;
}

/** @type {string | null} */
let dragInstrumentId = null;
/** @type {number | null} */
let instrumentDragClientY = null;
/** @type {number | null} */
let instrumentDragScrollRaf = null;
/** @type {null | (() => void)} */
let stopInstrumentDragSession = null;

/**
 * @typedef {{
 *   kind: "row",
 *   id: string,
 *   groupId: string | null,
 *   after: boolean,
 * } | {
 *   kind: "group",
 *   groupId: string | null,
 * }} InstrumentDragHover
 */
/** @type {InstrumentDragHover | null} */
let instrumentDragHover = null;

const INSTRUMENT_DRAG_SCROLL_EDGE = 56;
const INSTRUMENT_DRAG_SCROLL_MAX = 24;

function clearInstrumentDropMarks() {
  for (const el of instrumentList.querySelectorAll(
    ".is-drop-before, .is-drop-after, .is-drop-target",
  )) {
    el.classList.remove("is-drop-before", "is-drop-after", "is-drop-target");
  }
}

/** @param {HTMLElement} row @param {number} clientY */
function instrumentDropAfter(row, clientY) {
  const rect = row.getBoundingClientRect();
  return clientY > rect.top + rect.height / 2;
}

/**
 * Move an instrument in list order and/or into another group.
 * @param {string} fromId
 * @param {{
 *   groupId: string | null,
 *   beforeId?: string | null,
 *   afterId?: string | null,
 * }} opts
 */
function placeInstrument(fromId, { groupId, beforeId = null, afterId = null }) {
  const fromIndex = instruments.findIndex((item) => item.id === fromId);
  if (fromIndex < 0) return false;
  if (beforeId === fromId || afterId === fromId) return false;

  const [item] = instruments.splice(fromIndex, 1);
  item.groupId = groupId;

  let insertAt = instruments.length;
  if (beforeId) {
    const idx = instruments.findIndex((entry) => entry.id === beforeId);
    if (idx >= 0) insertAt = idx;
  } else if (afterId) {
    const idx = instruments.findIndex((entry) => entry.id === afterId);
    if (idx >= 0) insertAt = idx + 1;
  } else {
    for (let i = instruments.length - 1; i >= 0; i--) {
      if ((instruments[i].groupId ?? null) === groupId) {
        insertAt = i + 1;
        break;
      }
    }
  }

  instruments.splice(insertAt, 0, item);
  return true;
}

function applyInstrumentDragHover() {
  if (!dragInstrumentId || !instrumentDragHover) return false;
  const fromId = dragInstrumentId;
  const hover = instrumentDragHover;
  if (hover.kind === "row") {
    return placeInstrument(fromId, {
      groupId: hover.groupId,
      beforeId: hover.after ? null : hover.id,
      afterId: hover.after ? hover.id : null,
    });
  }
  return placeInstrument(fromId, { groupId: hover.groupId });
}

function endInstrumentDrag() {
  clearInstrumentDropMarks();
  stopInstrumentDragSession?.();
  dragInstrumentId = null;
  instrumentDragHover = null;
}

/** @param {string | null} groupId */
function finishInstrumentDrop(groupId) {
  const moved = applyInstrumentDragHover();
  endInstrumentDrag();
  if (!moved) return;
  instrumentFormGroupId = groupId;
  renderInstruments();
  persistSession();
}

function tickInstrumentDragScroll() {
  instrumentDragScrollRaf = null;
  if (!dragInstrumentId) return;

  if (instrumentDragClientY != null) {
    const rect = instrumentScroll.getBoundingClientRect();
    const y = instrumentDragClientY;
    let dy = 0;

    if (y < rect.top) {
      dy = -INSTRUMENT_DRAG_SCROLL_MAX;
    } else if (y > rect.bottom) {
      dy = INSTRUMENT_DRAG_SCROLL_MAX;
    } else if (y < rect.top + INSTRUMENT_DRAG_SCROLL_EDGE) {
      const distance = rect.top + INSTRUMENT_DRAG_SCROLL_EDGE - y;
      const t = Math.min(1, distance / INSTRUMENT_DRAG_SCROLL_EDGE);
      dy = -Math.ceil(Math.max(2, t * INSTRUMENT_DRAG_SCROLL_MAX));
    } else if (y > rect.bottom - INSTRUMENT_DRAG_SCROLL_EDGE) {
      const distance = y - (rect.bottom - INSTRUMENT_DRAG_SCROLL_EDGE);
      const t = Math.min(1, distance / INSTRUMENT_DRAG_SCROLL_EDGE);
      dy = Math.ceil(Math.max(2, t * INSTRUMENT_DRAG_SCROLL_MAX));
    }

    if (dy !== 0) {
      const maxScroll = Math.max(
        0,
        instrumentScroll.scrollHeight - instrumentScroll.clientHeight,
      );
      instrumentScroll.scrollTop = Math.max(
        0,
        Math.min(maxScroll, instrumentScroll.scrollTop + dy),
      );
    }
  }

  // Keep the loop alive for the whole drag — early frames often run before
  // any dragover has set clientY.
  instrumentDragScrollRaf = requestAnimationFrame(tickInstrumentDragScroll);
}

/** @param {number} [initialClientY] */
function startInstrumentDragSession(initialClientY) {
  stopInstrumentDragSession?.();
  instrumentDragClientY =
    typeof initialClientY === "number" ? initialClientY : null;
  instrumentDragHover = null;
  pageInstruments.classList.add("is-dragging-instrument");

  const onDragOver = (event) => {
    if (!dragInstrumentId) return;
    // Keep the drag alive over page chrome above/below the list.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    instrumentDragClientY = event.clientY;
  };

  document.addEventListener("dragover", onDragOver, true);
  instrumentDragScrollRaf = requestAnimationFrame(tickInstrumentDragScroll);

  stopInstrumentDragSession = () => {
    document.removeEventListener("dragover", onDragOver, true);
    if (instrumentDragScrollRaf != null) {
      cancelAnimationFrame(instrumentDragScrollRaf);
      instrumentDragScrollRaf = null;
    }
    instrumentDragClientY = null;
    pageInstruments.classList.remove("is-dragging-instrument");
    stopInstrumentDragSession = null;
  };
}

/**
 * @param {HTMLElement} row
 * @param {import("./instruments.js").Instrument} instrument
 */
function wireInstrumentRowDrag(row, instrument) {
  const handle = document.createElement("div");
  handle.className = "instrument-drag-handle";
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
    dragInstrumentId = instrument.id;
    instrumentDragHover = null;
    row.classList.add("is-dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", instrument.id);
      try {
        event.dataTransfer.setDragImage(row, 24, 16);
      } catch {
        // some browsers reject setDragImage
      }
    }
    startInstrumentDragSession(event.clientY);
  });

  row.addEventListener("dragend", () => {
    delete row.dataset.dragArmed;
    row.classList.remove("is-dragging");
    endInstrumentDrag();
  });

  row.addEventListener("dragover", (event) => {
    if (!dragInstrumentId || dragInstrumentId === instrument.id) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    instrumentDragClientY = event.clientY;
    const after = instrumentDropAfter(row, event.clientY);
    clearInstrumentDropMarks();
    row.classList.add(after ? "is-drop-after" : "is-drop-before");
    instrumentDragHover = {
      kind: "row",
      id: instrument.id,
      groupId: instrument.groupId ?? null,
      after,
    };
  });

  row.addEventListener("drop", (event) => {
    if (!dragInstrumentId || dragInstrumentId === instrument.id) return;
    event.preventDefault();
    event.stopPropagation();
    const after = instrumentDropAfter(row, event.clientY);
    const groupId = instrument.groupId ?? null;
    instrumentDragHover = {
      kind: "row",
      id: instrument.id,
      groupId,
      after,
    };
    finishInstrumentDrop(groupId);
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
function wireInstrumentGroupDropTarget(el, groupId, opts = {}) {
  const markEl = opts.markEl ?? el;
  const shouldDefer = opts.shouldDefer;

  el.addEventListener("dragover", (event) => {
    if (!dragInstrumentId) return;
    if (shouldDefer?.(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    instrumentDragClientY = event.clientY;
    clearInstrumentDropMarks();
    markEl.classList.add("is-drop-target");
    instrumentDragHover = { kind: "group", groupId };
  });

  el.addEventListener("drop", (event) => {
    if (!dragInstrumentId) return;
    if (shouldDefer?.(event)) return;
    event.preventDefault();
    event.stopPropagation();
    instrumentDragHover = { kind: "group", groupId };
    finishInstrumentDrop(groupId);
  });
}

/**
 * @param {import("./instruments.js").Instrument} instrument
 * @returns {HTMLElement}
 */
function renderInstrumentRow(instrument) {
  const row = document.createElement("div");
  row.className = "instrument-row";
  row.setAttribute("role", "listitem");
  row.dataset.id = instrument.id;

  const name = document.createElement("h3");
  name.className = "instrument-row-name";
  name.textContent = instrument.name;
  name.title = "Click to rename";
  name.setAttribute("role", "button");
  name.tabIndex = 0;
  name.addEventListener("click", (event) => {
    event.stopPropagation();
    beginInlineInstrumentRename(instrument.id, name);
  });
  name.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      beginInlineInstrumentRename(instrument.id, name);
    }
  });

  const range = document.createElement("div");
  range.className = "instrument-ch-range";

  /** @type {{ el: HTMLButtonElement, sync: () => void } | null} */
  let startPicker = null;
  /** @type {{ el: HTMLButtonElement, sync: () => void } | null} */
  let countPicker = null;

  startPicker = makeChannelPickerButton({
    className: "channel-picker-btn",
    getChannel: () => instrument.channelStart,
    setChannel: (channel) => {
      commitInstrumentRange(
        instrument,
        channel,
        channelCount(instrument),
        startPicker,
        countPicker,
      );
    },
    ariaLabel: (ch) => `${instrument.name} start channel ${ch}`,
  });

  const sep = document.createElement("span");
  sep.textContent = "×";

  countPicker = makeCountPickerButton({
    className: "channel-picker-btn",
    getCount: () => channelCount(instrument),
    setCount: (count) => {
      commitInstrumentRange(
        instrument,
        instrument.channelStart,
        count,
        startPicker,
        countPicker,
      );
    },
    ariaLabel: (n) => `${instrument.name} channel count ${n}`,
  });
  range.append(startPicker.el, sep, countPicker.el);

  const groupPicker = makeInstrumentGroupPickerButton({
    className: "channel-picker-btn instrument-row-group",
    getGroupId: () => instrument.groupId,
    setGroupId: (groupId) => {
      instrument.groupId = groupId;
      instrumentFormGroupId = groupId;
      renderInstruments();
      persistSession();
    },
    ariaLabel: (_id, label) => `${instrument.name} group ${label}`,
  });

  const mount = document.createElement("select");
  mount.setAttribute("aria-label", `${instrument.name} mount`);
  for (const value of ["fixed", "movable"]) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = value === "movable" ? "Movable" : "Fixed";
    mount.append(opt);
  }
  mount.value = instrument.mount;
  mount.addEventListener("change", () => {
    instrument.mount = normalizeMount(mount.value);
    persistSession();
  });

  const color = document.createElement("select");
  color.setAttribute("aria-label", `${instrument.name} color`);
  for (const value of ["single", "multi"]) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = value === "multi" ? "Multi-color" : "Single color";
    color.append(opt);
  }
  color.value = instrument.color;
  color.addEventListener("change", () => {
    instrument.color = normalizeColorMode(color.value);
    persistSession();
  });

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "instrument-remove";
  remove.textContent = "×";
  remove.title = `Remove ${instrument.name}`;
  remove.setAttribute("aria-label", `Remove ${instrument.name}`);
  remove.addEventListener("click", async () => {
    const ok = await confirmAction({
      title: "Remove instrument?",
      message: `Remove “${instrument.name}” from this setlist?`,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    instruments = instruments.filter((item) => item.id !== instrument.id);
    renderInstruments();
    persistSession();
  });

  row.append(name, range, groupPicker.el, mount, color, remove);
  wireInstrumentRowDrag(row, instrument);
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
function renderInstrumentGroupHeader({ title, count, groupId = null, onRemove }) {
  const header = document.createElement("div");
  header.className = "instrument-group-header";

  const label = document.createElement("h3");
  label.className = "instrument-group-name";
  label.textContent = title;
  if (groupId) {
    label.title = "Click to rename";
    label.setAttribute("role", "button");
    label.tabIndex = 0;
    label.addEventListener("click", (event) => {
      event.stopPropagation();
      beginInlineInstrumentGroupRename(groupId, label);
    });
    label.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        beginInlineInstrumentGroupRename(groupId, label);
      }
    });
  }

  const meta = document.createElement("span");
  meta.className = "instrument-group-meta";
  meta.textContent = count === 1 ? "1 instrument" : `${count} instruments`;

  header.append(label, meta);

  if (onRemove) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "instrument-remove";
    remove.textContent = "×";
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
 *   members: import("./instruments.js").Instrument[],
 * }} opts
 */
function renderInstrumentGroupCard({
  title,
  count,
  groupId = null,
  ungrouped = false,
  onRemove,
  members,
}) {
  const card = document.createElement("div");
  card.className = "instrument-group-card";
  if (ungrouped) card.classList.add("instrument-group-card-ungrouped");
  if (groupId) card.dataset.groupId = groupId;
  if (ungrouped) card.dataset.ungrouped = "true";

  const dropGroupId = ungrouped ? null : groupId;

  card.append(
    renderInstrumentGroupHeader({
      title,
      count,
      groupId: ungrouped ? null : groupId,
      onRemove,
    }),
  );

  const body = document.createElement("div");
  body.className = "instrument-group-body";
  wireInstrumentGroupDropTarget(body, dropGroupId, {
    shouldDefer: (event) => {
      const overRow =
        event.target instanceof Element
          ? event.target.closest(".instrument-row")
          : null;
      return Boolean(overRow && body.contains(overRow));
    },
  });
  if (members.length === 0) {
    card.classList.add("is-empty");
    const empty = document.createElement("div");
    empty.className = "instrument-group-empty";
    empty.textContent = ungrouped
      ? "No ungrouped instruments"
      : "No instruments in this group";
    body.append(empty);
  } else {
    for (const instrument of members) {
      body.append(renderInstrumentRow(instrument));
    }
  }
  card.append(body);

  // Header / empty chrome around the body still accepts drops into the group.
  wireInstrumentGroupDropTarget(card, dropGroupId, {
    markEl: body,
    shouldDefer: (event) =>
      event.target instanceof Element &&
      Boolean(event.target.closest(".instrument-row, .instrument-group-body")),
  });

  return card;
}

function renderInstruments() {
  instrumentList.replaceChildren();
  const hasContent = instruments.length > 0 || instrumentGroups.length > 0;
  instrumentEmpty.hidden = hasContent;

  // Always render every group card, including empty ones.
  for (const group of instrumentGroups) {
    const members = instrumentsInGroup(instruments, group.id);
    instrumentList.append(
      renderInstrumentGroupCard({
        title: group.name,
        count: members.length,
        groupId: group.id,
        members,
        onRemove: () => {
          void removeInstrumentGroup(group.id);
        },
      }),
    );
  }

  const ungrouped = instrumentsInGroup(instruments, null);
  if (instrumentGroups.length > 0) {
    instrumentList.append(
      renderInstrumentGroupCard({
        title: "Ungrouped",
        count: ungrouped.length,
        ungrouped: true,
        members: ungrouped,
      }),
    );
  } else {
    for (const instrument of ungrouped) {
      instrumentList.append(renderInstrumentRow(instrument));
    }
  }

  syncInstrumentForm();
  updateInstrumentConflicts();
}

/**
 * @param {string} id
 * @param {HTMLElement} [target]
 */
function beginInlineInstrumentRename(id, target) {
  const instrument = instruments.find((item) => item.id === id);
  if (!instrument) return;

  abortInlineEdits();

  const title =
    target ??
    instrumentList.querySelector(
      `.instrument-row[data-id="${CSS.escape(id)}"] .instrument-row-name`,
    );
  if (!(title instanceof HTMLElement) || !title.isConnected) return;

  const parent = title.parentElement;
  if (!parent) return;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "scene-title-input instrument-name-input";
  input.maxLength = 40;
  input.value = instrument.name;
  input.setAttribute("aria-label", "Instrument name");
  input.autocomplete = "off";
  input.spellcheck = false;

  title.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = (commit) => {
    if (finished) return;
    finished = true;
    if (endInlineInstrumentRename === finishAbort) {
      endInlineInstrumentRename = null;
    }
    input.removeEventListener("keydown", onKeydown);
    input.removeEventListener("blur", onBlur);

    const next = input.value.trim().slice(0, 40);
    const changed = Boolean(commit && next && next !== instrument.name);
    if (changed) {
      instrument.name = next;
      persistSession();
    }

    if (changed) {
      renderInstruments();
      return;
    }

    const restored = document.createElement("h3");
    restored.className = "instrument-row-name";
    restored.textContent = instrument.name;
    restored.title = "Click to rename";
    restored.setAttribute("role", "button");
    restored.tabIndex = 0;
    restored.addEventListener("click", (event) => {
      event.stopPropagation();
      beginInlineInstrumentRename(id, restored);
    });
    restored.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        beginInlineInstrumentRename(id, restored);
      }
    });

    if (input.isConnected) input.replaceWith(restored);
    else parent.prepend(restored);
  };

  const finishAbort = () => finish(false);
  endInlineInstrumentRename = finishAbort;

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
function beginInlineInstrumentGroupRename(id, target) {
  const group = instrumentGroups.find((item) => item.id === id);
  if (!group) return;

  abortInlineEdits();

  const title =
    target ??
    instrumentList.querySelector(
      `.instrument-group-card[data-group-id="${CSS.escape(id)}"] .instrument-group-name`,
    );
  if (!(title instanceof HTMLElement) || !title.isConnected) return;

  const parent = title.parentElement;
  if (!parent) return;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "scene-title-input instrument-group-name-input";
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
    if (endInlineInstrumentRename === finishAbort) {
      endInlineInstrumentRename = null;
    }
    input.removeEventListener("keydown", onKeydown);
    input.removeEventListener("blur", onBlur);

    const next = input.value.trim().slice(0, 40);
    const changed = Boolean(commit && next && next !== group.name);
    if (changed) {
      group.name = next;
      persistSession();
      renderInstruments();
      return;
    }

    const restored = document.createElement("h3");
    restored.className = "instrument-group-name";
    restored.textContent = group.name;
    restored.title = "Click to rename";
    restored.setAttribute("role", "button");
    restored.tabIndex = 0;
    restored.addEventListener("click", (event) => {
      event.stopPropagation();
      beginInlineInstrumentGroupRename(id, restored);
    });
    restored.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        beginInlineInstrumentGroupRename(id, restored);
      }
    });

    if (input.isConnected) input.replaceWith(restored);
    else parent.prepend(restored);
  };

  const finishAbort = () => finish(false);
  endInlineInstrumentRename = finishAbort;

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

async function addInstrumentGroup() {
  if (instrumentGroups.length >= MAX_INSTRUMENT_GROUPS) return;
  const name = await promptName({
    title: "New group",
    confirmLabel: "Create",
    initial: "",
  });
  if (!name) return;
  const group = createInstrumentGroup({ name });
  instrumentGroups.push(group);
  instrumentFormGroupId = group.id;
  renderInstruments();
  persistSession();
  setStatus(
    `Group “${group.name}” created`,
    dmx.connected ? "connected" : "idle",
  );
}

async function removeInstrumentGroup(id) {
  const group = instrumentGroups.find((item) => item.id === id);
  if (!group) return;
  const members = instrumentsInGroup(instruments, id);
  const ok = await confirmAction({
    title: "Remove group?",
    message:
      members.length > 0
        ? `Remove group “${group.name}”? Its ${members.length} instrument${members.length === 1 ? "" : "s"} will become ungrouped.`
        : `Remove empty group “${group.name}”?`,
    confirmLabel: "Remove",
  });
  if (!ok) return;
  for (const instrument of instruments) {
    if (instrument.groupId === id) instrument.groupId = null;
  }
  instrumentGroups = instrumentGroups.filter((item) => item.id !== id);
  if (instrumentFormGroupId === id) instrumentFormGroupId = null;
  renderInstruments();
  persistSession();
}

function markClean() {
  cleanSnapshot = setlistSnapshot(currentSetlistState());
}

function isDirty() {
  return setlistSnapshot(currentSetlistState()) !== cleanSnapshot;
}

function confirmDiscardLoad() {
  return new Promise((resolve) => {
    const onClose = () => {
      dirtyDialog.removeEventListener("close", onClose);
      resolve(dirtyDialog.returnValue === "confirm");
    };
    dirtyDialog.addEventListener("close", onClose);
    dirtyDialog.returnValue = "";
    dirtyDialog.showModal();
  });
}

/**
 * @param {{ title: string, message: string, confirmLabel?: string }} opts
 * @returns {Promise<boolean>}
 */
function confirmAction({ title, message, confirmLabel = "Confirm" }) {
  confirmTitle.textContent = title;
  confirmMessage.textContent = message;
  confirmConfirmBtn.textContent = confirmLabel;
  return new Promise((resolve) => {
    const onClose = () => {
      confirmDialog.removeEventListener("close", onClose);
      resolve(confirmDialog.returnValue === "confirm");
    };
    confirmDialog.addEventListener("close", onClose);
    confirmDialog.returnValue = "";
    confirmDialog.showModal();
  });
}

function confirmRemoveScene(name) {
  return confirmAction({
    title: "Remove transition?",
    message: `Remove “${name}”? Its fader levels will be lost.`,
    confirmLabel: "Remove",
  });
}

function confirmClearFaderPatch(name) {
  return confirmAction({
    title: "Clear patch?",
    message: `Clear all channels from “${name}”?`,
    confirmLabel: "Clear",
  });
}

/**
 * @param {{ title: string, confirmLabel: string, initial: string }} opts
 * @returns {Promise<string | null>}
 */
function promptName({ title, confirmLabel, initial }) {
  abortInlineEdits();
  sceneNameDialogTitle.textContent = title;
  sceneNameConfirmBtn.textContent = confirmLabel;
  sceneNameInput.value = initial;
  sceneNameInput.setCustomValidity("");
  return new Promise((resolve) => {
    const onSubmit = (event) => {
      const submitter = /** @type {HTMLButtonElement | null} */ (event.submitter);
      if (submitter?.value !== "confirm") return;
      const name = sceneNameInput.value.trim();
      if (!name) {
        event.preventDefault();
        sceneNameInput.setCustomValidity("Enter a name");
        sceneNameInput.reportValidity();
        return;
      }
      sceneNameInput.value = name;
      sceneNameInput.setCustomValidity("");
    };

    const onClose = () => {
      sceneNameDialog.removeEventListener("close", onClose);
      sceneNameForm.removeEventListener("submit", onSubmit);
      if (sceneNameDialog.returnValue !== "confirm") {
        resolve(null);
        return;
      }
      resolve(sceneNameInput.value.trim() || null);
    };

    sceneNameForm.addEventListener("submit", onSubmit);
    sceneNameDialog.addEventListener("close", onClose);
    sceneNameDialog.returnValue = "";
    sceneNameDialog.showModal();
    queueMicrotask(() => {
      sceneNameInput.focus();
      sceneNameInput.select();
    });
  });
}

/** @type {null | (() => void)} */
let endInlineRename = null;

function applySceneName(index, name) {
  const next = name.trim();
  if (!next || next === transitionName(index)) return false;
  names[index] = next;
  const tune = getActiveTune();
  if (tune.transitions[index]) tune.transitions[index].name = next;
  refreshRowSelects();
  updateScenesButton();
  persistSession();
  return true;
}

/**
 * Edit a scene name in place with a text input.
 * @param {number} index
 * @param {HTMLElement} [target]
 */
function beginInlineRename(index, target) {
  if (index < 0 || index >= rows.length) return;
  abortInlineEdits();

  const title =
    target ??
    rowsEl.querySelector(`.fader-row[data-row="${index}"] .scene-title-group .scene-title`) ??
    (index === selectedRow ? currentSceneTitle : null);
  if (!(title instanceof HTMLElement) || !title.isConnected) return;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "scene-title-input";
  if (title.id === "currentSceneTitle") {
    input.classList.add("scene-title-input-lg");
  }
  input.maxLength = 40;
  input.value = sceneName(index);
  input.setAttribute("aria-label", "Transition name");
  input.autocomplete = "off";
  input.spellcheck = false;

  const titleId = title.id;
  const isRowTitle = title.classList.contains("scene-title");
  const parent = title.parentElement;
  if (!parent) return;

  title.replaceWith(input);
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
    const changed = Boolean(commit && next && applySceneName(index, next));

    const restored = document.createElement("h3");
    if (isRowTitle) restored.className = "scene-title";
    if (titleId) restored.id = titleId;
    restored.textContent = sceneName(index);

    if (input.isConnected) input.replaceWith(restored);
    else parent.prepend(restored);

    if (isRowTitle) {
      restored.title = "Double-click to rename";
      restored.addEventListener("dblclick", (event) => {
        event.stopPropagation();
        beginInlineRename(index);
      });
    }

    if (restored.id === "currentSceneTitle") {
      currentSceneTitle = restored;
      wireCurrentSceneTitle(restored);
    }

    if (changed) {
      // Rebuild row UI so every label picks up the new name
      renderRows();
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

function wireCurrentSceneTitle(el) {
  el.title = "Click to rename";
  el.setAttribute("role", "button");
  el.tabIndex = 0;
  el.addEventListener("click", () => {
    beginInlineRename(selectedRow, el);
  });
  el.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      beginInlineRename(selectedRow, el);
    }
  });
}

/**
 * @param {HTMLElement} anchor
 * @returns {Promise<"select" | null>}
 */
function openChannelsSceneMenu(anchor) {
  closeChannelsSceneMenu?.();
  closeScenePicker?.();
  closeSetlistMenu?.();
  closeSceneRowMenu?.();
  closeFaderNameMenu?.();
  closeChannelPicker?.();
  closeCountPicker?.();
  closeInstrumentGroupPicker?.();

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
      if (channelsSceneMenu.contains(target) || anchor.contains(target)) return;
      finish(null);
    };

    const onDocKeydown = (event) => {
      if (event.key === "Escape") finish(null);
    };

    const cleanup = () => {
      channelsSceneMenu.hidden = true;
      anchor.setAttribute("aria-expanded", "false");
      if (closeChannelsSceneMenu === finishNull) closeChannelsSceneMenu = null;
      document.removeEventListener("pointerdown", onDocPointer, true);
      document.removeEventListener("keydown", onDocKeydown, true);
    };

    const finishNull = () => finish(null);
    closeChannelsSceneMenu = finishNull;

    channelsSceneMenuList.replaceChildren();
    const item = document.createElement("button");
    item.type = "button";
    item.className = "popup-menu-item";
    item.setAttribute("role", "menuitem");
    item.textContent = "Select transition";
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      finish("select");
    });
    channelsSceneMenuList.append(item);

    channelsSceneMenu.hidden = false;
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
    channelsSceneMenu.style.left = `${left}px`;
    channelsSceneMenu.style.top = `${top}px`;

    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onDocKeydown, true);
  }).then(async (action) => {
    if (action !== "select") return action;
    const index = await pickScene({ anchor });
    if (index != null) setSelectedRow(index);
    return action;
  });
}

async function removeSceneAt(index) {
  const tune = getActiveTune();
  if (tune.transitions.length <= MIN_TRANSITIONS) return false;
  if (index < 0 || index >= tune.transitions.length) return false;
  const ok = await confirmRemoveScene(transitionName(index));
  if (!ok) return false;
  tune.transitions.splice(index, 1);
  fromRow = adjustIndexAfterRemove(fromRow, index, tune.transitions.length);
  toRow = adjustIndexAfterRemove(toRow, index, tune.transitions.length);
  selectedRow = adjustIndexAfterRemove(selectedRow, index, tune.transitions.length);
  bindActiveTune();
  renderRows();
  renderSelectedGroup();
  pushToDmx();
  persistSession();
  return true;
}

/** @type {null | (() => void)} */
let closeSceneRowMenu = null;

/**
 * @param {HTMLElement} anchor
 * @param {number} index
 * @returns {Promise<"rename" | "remove" | null>}
 */
function openSceneRowMenu(anchor, index) {
  closeSceneRowMenu?.();
  closeFaderNameMenu?.();
  closeSetlistMenu?.();
  closeChannelsSceneMenu?.();
  closeScenePicker?.();
  closeChannelPicker?.();
  closeCountPicker?.();
  closeInstrumentGroupPicker?.();

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
      item.className = "popup-menu-item";
      if (danger) item.classList.add("is-danger");
      item.setAttribute("role", "menuitem");
      item.textContent = label;
      item.disabled = disabled;
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        finish(action);
      });
      sceneRowMenuList.append(item);
    };

    const onDocPointer = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (sceneRowMenu.contains(target) || anchor.contains(target)) return;
      finish(null);
    };

    const onDocKeydown = (event) => {
      if (event.key === "Escape") finish(null);
    };

    const cleanup = () => {
      sceneRowMenu.hidden = true;
      anchor.setAttribute("aria-expanded", "false");
      if (closeSceneRowMenu === finishNull) closeSceneRowMenu = null;
      document.removeEventListener("pointerdown", onDocPointer, true);
      document.removeEventListener("keydown", onDocKeydown, true);
    };

    const finishNull = () => finish(null);
    closeSceneRowMenu = finishNull;

    sceneRowMenuList.replaceChildren();
    addItem("Rename", "rename");
    addItem("Remove", "remove", {
      danger: true,
      disabled: rows.length <= MIN_TRANSITIONS,
    });

    sceneRowMenu.hidden = false;
    anchor.setAttribute("aria-expanded", "true");

    const anchorRect = anchor.getBoundingClientRect();
    const menuWidth = 140;
    const menuHeight = 96;
    let left = anchorRect.left;
    let top = anchorRect.bottom + 6;
    if (left + menuWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuWidth - 8);
    }
    if (top + menuHeight > window.innerHeight - 8) {
      top = Math.max(8, anchorRect.top - menuHeight - 6);
    }
    sceneRowMenu.style.left = `${left}px`;
    sceneRowMenu.style.top = `${top}px`;

    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onDocKeydown, true);
  }).then(async (action) => {
    if (action === "rename") beginInlineRename(index);
    if (action === "remove") await removeSceneAt(index);
    return action;
  });
}

function setUiConnected(connected) {
  connectBtn.textContent = connected ? "Disconnect" : "Connect DMX Pro";
  connectBtn.classList.toggle("connected", connected);
}

function showPage(name) {
  const page = pages[name] ? name : "tunes";
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
  if (page === "instruments") renderInstruments();
  if (page === "setlist") renderTunes();
  if (page === "channels") {
    refreshChannelRow();
    renderSelectedGroup();
  }
}

function routeFromHash() {
  const hash = location.hash.replace("#", "");
  if (hash === "faders" || hash === "songs") {
    showPage("tunes");
    return;
  }
  if (hash === "show") {
    showPage("setlist");
    return;
  }
  if (
    hash === "setlist" ||
    hash === "tunes" ||
    hash === "patch" ||
    hash === "channels" ||
    hash === "instruments"
  ) {
    showPage(hash);
  } else {
    showPage("tunes");
  }
}

connectBtn.addEventListener("click", async () => {
  if (dmx.connected) {
    await dmx.disconnect();
    setUiConnected(false);
    setStatus("Disconnected", "idle");
    return;
  }

  try {
    setStatus("Select the DMX USB Pro…", "idle");
    await dmx.connect();
    pushToDmx();
    setUiConnected(true);
    setStatus("Connected", "connected");
  } catch (err) {
    setUiConnected(false);
    const message = err instanceof Error ? err.message : "Connection failed";
    setStatus(message, "error");
    console.error(err);
  }
});

function syncMasterUi() {
  masterInput.value = String(Math.round(master));
  masterValue.textContent = `${Math.round(master)}%`;
  syncSubmasterLive();
  syncBlackoutButtons();
}

blackoutBtn.addEventListener("click", () => {
  if (masterBlackoutSnapshot != null) {
    master = masterBlackoutSnapshot;
    masterBlackoutSnapshot = null;
  } else {
    masterBlackoutSnapshot = master;
    master = 0;
  }
  syncMasterUi();
  pushToDmx();
});

masterInput.addEventListener("input", () => {
  master = Number(masterInput.value);
  if (masterBlackoutSnapshot != null) {
    masterBlackoutSnapshot = null;
  }
  syncMasterUi();
  pushToDmx();
});

fromSubInput.addEventListener("input", () => {
  setSubmasterFromLive("from", fromSubInput.value);
  pushToDmx();
});

toSubInput.addEventListener("input", () => {
  setSubmasterFromLive("to", toSubInput.value);
  pushToDmx();
});

fromSubBlackoutBtn.addEventListener("click", () => {
  if (fromSubBlackoutSnapshot != null) {
    fromSub = fromSubBlackoutSnapshot;
    fromSubBlackoutSnapshot = null;
  } else {
    fromSubBlackoutSnapshot = fromSub;
    fromSub = 0;
  }
  syncSubmasterUi();
  pushToDmx();
});

toSubBlackoutBtn.addEventListener("click", () => {
  if (toSubBlackoutSnapshot != null) {
    toSub = toSubBlackoutSnapshot;
    toSubBlackoutSnapshot = null;
  } else {
    toSubBlackoutSnapshot = toSub;
    toSub = 0;
  }
  syncSubmasterUi();
  pushToDmx();
});

crossfader.addEventListener("input", () => {
  setCross(Number(crossfader.value), { fromUser: true });
});

goBtn.addEventListener("click", () => {
  goNextTransition();
});

fadePauseBtn.addEventListener("click", () => {
  toggleFadePause();
});

wireCurrentSceneTitle(currentSceneTitle);

channelsSceneMenuBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  if (channelsSceneMenuBtn.getAttribute("aria-expanded") === "true") {
    closeChannelsSceneMenu?.();
    return;
  }
  void openChannelsSceneMenu(channelsSceneMenuBtn);
});

addRowBtn.addEventListener("click", async () => {
  const tune = getActiveTune();
  if (tune.transitions.length >= MAX_TRANSITIONS) return;
  const name = await promptName({
    title: "New transition",
    confirmLabel: "Add",
    initial: defaultTransitionName(tune.transitions.length),
  });
  if (!name) return;
  if (tune.transitions.length >= MAX_TRANSITIONS) return;
  tune.transitions.push(createTransition({ name }));
  bindActiveTune();
  selectedRow = rows.length - 1;
  fromRow = selectedRow;
  syncPlaybackPair();
  renderRows();
  renderSelectedGroup();
  pushToDmx();
  persistSession();
});

removeRowBtn.addEventListener("click", async () => {
  await removeSceneAt(selectedRow);
});

identityBtn.addEventListener("click", () => {
  patch = identityPatch();
  persistAndRefresh();
  renderPatchTable();
});

clearPatchBtn.addEventListener("click", async () => {
  const ok = await confirmAction({
    title: "Unpatch all?",
    message: "Clear every fader’s channel assignments?",
    confirmLabel: "Unpatch all",
  });
  if (!ok) return;
  patch = defaultPatch();
  persistAndRefresh();
  renderPatchTable();
});

function applySetlist(state) {
  stopTimedFade();
  clearBlackoutSnapshots();
  setlistName = normalizeSetlistName(state.setlistName);
  navOrder = normalizeNavOrder(state.navOrder);
  master = state.master;
  cross = state.cross;
  fromSub = state.fromSub ?? 100;
  toSub = state.toSub ?? 100;
  fadeTime = FADE_TIMES.includes(state.fadeTime) ? state.fadeTime : 4;
  fromRow = state.fromRow;
  toRow = state.toRow;
  selectedRow = state.selectedRow ?? 0;
  tunes = normalizeTunes(state.tunes);
  activeTuneId = resolveActiveTune(tunes, state.activeTuneId).id;
  bindActiveTune();
  faderNames = normalizeFaderNames(state.faderNames);
  instrumentGroups = normalizeInstrumentGroups(state.instrumentGroups);
  instruments = normalizeInstruments(state.instruments, instrumentGroups);
  if (
    instrumentFormGroupId &&
    !instrumentGroups.some((group) => group.id === instrumentFormGroupId)
  ) {
    instrumentFormGroupId = null;
  }
  patch = state.patch;

  applyNavOrder(navOrder);
  syncSetlistNameUi();
  syncTuneUi();
  syncMasterUi();
  syncSubmasterUi();
  syncCrossUi();
  updateFadePauseButton();

  renderRows();
  renderLiveRow();
  renderChannelRow();
  renderSelectedGroup();
  renderTunes();
  renderInstruments();
  renderPatchTable();
  pushToDmx();
}

function syncTransportFromState() {
  syncMasterUi();
  syncSubmasterUi();
  syncCrossUi();
  refreshRowSelects();
  updateFadePauseButton();
}

setlistMenuBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  if (setlistMenuBtn.getAttribute("aria-expanded") === "true") {
    closeSetlistMenu?.();
    return;
  }
  void openSetlistMenu(setlistMenuBtn);
});

newSetlistBtn.addEventListener("click", async () => {
  if (isDirty()) {
    const ok = await confirmAction({
      title: "New setlist?",
      message: "Discard unsaved changes and start a blank setlist?",
      confirmLabel: "Continue",
    });
    if (!ok) return;
  }

  const name = await promptName({
    title: "New setlist",
    confirmLabel: "Create",
    initial: "",
  });
  if (!name) return;

  applySetlist(blankSetlistState(name));
  markClean();
  persistSession();
  setStatus(`New setlist · ${setlistName}`, dmx.connected ? "connected" : "idle");
});

saveBtn.addEventListener("click", () => {
  downloadSetlist(currentSetlistState());
  markClean();
  setStatus("Setlist saved", dmx.connected ? "connected" : "idle");
});

loadBtn.addEventListener("click", () => {
  loadFile.value = "";
  loadFile.click();
});

loadFile.addEventListener("change", async () => {
  const file = loadFile.files?.[0];
  if (!file) return;

  if (isDirty()) {
    const ok = await confirmDiscardLoad();
    if (!ok) return;
  }

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    applySetlist(parseSetlist(data));
    markClean();
    setStatus(`Setlist loaded · ${file.name}`, dmx.connected ? "connected" : "idle");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load setlist";
    setStatus(message, "error");
    console.error(err);
  }
});

window.addEventListener("hashchange", routeFromHash);

instrumentForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (instruments.length >= MAX_INSTRUMENTS) return;
  const name = instrumentNameInput.value.trim();
  if (!name) {
    instrumentNameInput.reportValidity();
    return;
  }
  const width = Math.max(1, Math.round(instrumentFormCount) || 1);
  const qty = Math.min(
    MAX_INSTRUMENT_QTY,
    Math.max(1, Math.round(instrumentFormQty) || 1),
    MAX_INSTRUMENTS - instruments.length,
  );
  if (qty < 1) return;

  /** @type {{ channelStart: number, channelEnd: number }[]} */
  const ranges = [];
  let cursor = instrumentFormStart;
  for (let i = 0; i < qty; i++) {
    const range = normalizeChannelSpan(cursor, width);
    if (!range) {
      setStatus(
        qty > 1
          ? `Only room for ${i} of ${qty} — start + channels must fit in DMX 1–512`
          : `Start + channel count must fit in 1–${MAX_INSTRUMENT_CHANNELS} within DMX 1–512`,
        "error",
      );
      instrumentFormStartPicker?.el.focus();
      return;
    }
    const conflict = findRangeConflict(
      instruments,
      range.channelStart,
      range.channelEnd,
    );
    if (conflict) {
      setStatus(
        `Range overlaps ${conflict.name} (${formatChannelRange(conflict)})`,
        "error",
      );
      instrumentFormStartPicker?.el.focus();
      return;
    }
    ranges.push(range);
    cursor = range.channelEnd + 1;
  }

  const mountRadio = instrumentForm.querySelector(
    'input[name="instrumentMount"]:checked',
  );
  const colorRadio = instrumentForm.querySelector(
    'input[name="instrumentColor"]:checked',
  );
  const groupId =
    instrumentFormGroupId &&
    instrumentGroups.some((group) => group.id === instrumentFormGroupId)
      ? instrumentFormGroupId
      : null;
  const mount = normalizeMount(
    mountRadio instanceof HTMLInputElement ? mountRadio.value : "fixed",
  );
  const color = normalizeColorMode(
    colorRadio instanceof HTMLInputElement ? colorRadio.value : "single",
  );
  const names = batchInstrumentNames(name, qty);
  for (let i = 0; i < qty; i++) {
    instruments.push(
      createInstrument({
        name: names[i],
        mount,
        color,
        channelStart: ranges[i].channelStart,
        channelEnd: ranges[i].channelEnd,
        groupId,
      }),
    );
  }
  instrumentFormGroupId = groupId;
  instrumentNameInput.value = "";
  renderInstruments();
  suggestInstrumentFormStart();
  instrumentNameInput.focus();
  persistSession();
  const first = ranges[0];
  const last = ranges[ranges.length - 1];
  setStatus(
    qty === 1
      ? `Added ${names[0]} · ${formatChannelRange(first)}`
      : `Added ${qty} · ${formatChannelRange({ channelStart: first.channelStart, channelEnd: last.channelEnd })}`,
    dmx.connected ? "connected" : "idle",
  );
});

addInstrumentGroupBtn.addEventListener("click", () => {
  void addInstrumentGroup();
});

addTuneBtn.addEventListener("click", () => {
  void addTune();
});

ensureInstrumentFormStartPicker();
ensureInstrumentFormCountPicker();
ensureInstrumentFormQtyPicker();
ensureInstrumentFormGroupPicker();
suggestInstrumentFormStart();
wireNavReorder();
applyNavOrder(navOrder);
wireSetlistNameDisplay(setlistNameDisplay);
syncSetlistNameUi();
syncTuneUi();
syncTransportFromState();
renderLiveRow();
renderChannelRow();
renderSelectedGroup();
renderRows();
renderTunes();
renderInstruments();
renderPatchTable();
routeFromHash();
persistSession();
markClean();

if (!("serial" in navigator)) {
  connectBtn.disabled = true;
  setStatus("Web Serial unavailable — use Chrome/Edge on localhost", "error");
}

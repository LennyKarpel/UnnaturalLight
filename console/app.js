import { notifyStage, startStageLink } from "./stage-link.js";
import { createServerLink, LIVE_FIELDS } from "./server-link.js";
import { computeChannelLevels as channelLevelsFor, liveLevel as mixLevel } from "../shared/engine.js";
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
  UNIVERSE_SIZE,
  MAX_UNIVERSES,
  setUniverseCount,
  channelLimit,
  universeOf,
  addressOf,
  universeStart,
  formatAddress,
  parseAddress,
} from "./patch.js";
import {
  createFixture,
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
  normalizeFixtureGroups,
  normalizeFixtures,
  normalizeMount,
} from "./fixtures.js";
import {
  DEFAULT_NAV_ORDER,
  defaultFaderName,
  defaultSetName,
  defaultTuneName,
  defaultTransitionName,
  downloadSet,
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
  normalizeSetName,
  normalizeTransitionFadeTime,
  parseSet,
  resolveActiveTune,
  saveSession,
  setSnapshot,
  TRANSITION_FADE_TIMES,
  normalizeUniverses,
} from "./set.js";

/** Link to the show server (created once the page is set up; see the end of this file). */
/** @type {ReturnType<typeof createServerLink> | null} */
let serverLink = null;
/** DMX output per universe as the show server reports it (index 0 = universe 1). */
let outputStatus = [];
/** One DMX USB Pro per universe, plugged into the show server's machine (index 0 = universe 1). */
const outputs = Array.from({ length: MAX_UNIVERSES }, (_, i) => ({
  get connected() {
    return outputStatus[i]?.connected ?? false;
  },
  async connect() {
    const reply = await serverLink.request({ type: "dmx-connect", universe: i + 1 });
    if (!reply.ok) throw new Error(reply.error ?? "Connection failed");
  },
  async disconnect() {
    await serverLink.request({ type: "dmx-disconnect", universe: i + 1 });
  },
}));
/** Universe 1's output (status messages ask whether it's connected). */
const dmx = outputs[0];

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

/** @param {string} [setName] */
function blankSetState(setName = defaultSetName()) {
  const tune = createTune({ name: defaultTuneName(0) });
  return {
    setName: normalizeSetName(setName),
    navOrder: [...DEFAULT_NAV_ORDER],
    master: 100,
    cross: 0,
    universes: 1,
    fromSub: 100,
    toSub: 100,
    fadeTime: 4,
    fromRow: 0,
    toRow: 1,
    selectedRow: 0,
    tunes: [tune],
    activeTuneId: tune.id,
    faderNames: normalizeFaderNames(null),
    fixtureGroups: [],
    fixtures: [],
    patch: defaultPatch(),
  };
}

function initialState() {
  const session = loadSession();
  if (session) return session;
  return blankSetState();
}

const boot = initialState();
/** @type {string} */
let setName = normalizeSetName(boot.setName);
/** @type {string[]} */
let navOrder = normalizeNavOrder(boot.navOrder);
/** Universes in this set (1…MAX_UNIVERSES); channels go up to universes × 512. */
let universes = normalizeUniverses(boot.universes);
setUniverseCount(universes);
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
/** @type {import("./fixtures.js").FixtureGroup[]} */
let fixtureGroups = normalizeFixtureGroups(boot.fixtureGroups);
/** @type {import("./fixtures.js").Fixture[]} */
let fixtures = normalizeFixtures(boot.fixtures, fixtureGroups);
/** @type {string | null} */
let fixtureFormGroupId = null;
let patch = boot.patch;
let master = boot.master;
let cross = boot.cross; // 0 = full From, 100 = full To
let fromSub = boot.fromSub ?? 100;
let toSub = boot.toSub ?? 100;
let fadeTime = normalizeTransitionFadeTime(boot.fadeTime);
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
/** The show server's timed fade (it runs there): null = none. */
/** @type {null | { paused: boolean }} */
let fadeState = null;
/** @type {number | null} */
let masterBlackoutSnapshot = null;
/** @type {number | null} */
let fromSubBlackoutSnapshot = null;
/** @type {number | null} */
let toSubBlackoutSnapshot = null;

// The set name, set buttons, DMX outputs and status are drawn in the header
// of the page around the console (../index.html), which calls consoleHeader
// (bottom of this file) and is told here when any of it changes.
/** Last status message (state: idle | connected | error). */
let status = { text: "", state: "idle" };
let serverLive = false;
/** @type {Set<() => void>} */
const headerListeners = new Set();
const notifyHeader = () => { for (const fn of headerListeners) fn(); };

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
const blackoutBtn = requireEl("blackoutBtn", HTMLButtonElement);
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
const pageSet = requireEl("page-set", HTMLElement);
const identityBtn = requireEl("identityBtn", HTMLButtonElement);
const clearPatchBtn = requireEl("clearPatchBtn", HTMLButtonElement);
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
/** Channel-picker groups of 32 across every universe in the set. */
const channelGroupCount = () => Math.ceil(channelLimit() / CHANNEL_GROUP_SIZE);
const pageTunes = requireEl("page-songs", HTMLElement);
const pageChannels = requireEl("page-channels", HTMLElement);
const pageFixtures = requireEl("page-fixtures", HTMLElement);
const pagePatch = requireEl("page-patch", HTMLElement);
const fixtureForm = requireEl("fixtureForm", HTMLFormElement);
const fixtureNameInput = requireEl("fixtureNameInput", HTMLInputElement);
const fixtureStartPicker = requireEl("fixtureStartPicker", HTMLElement);
const fixtureCountPicker = requireEl("fixtureCountPicker", HTMLElement);
const countMenu = requireEl("countMenu", HTMLElement);
const countMenuList = requireEl("countMenuList", HTMLElement);
/** @type {number} */
let fixtureFormStart = 1;
/** @type {number} */
let fixtureFormCount = 1;
/** @type {number} */
let fixtureFormQty = 1;
/** @type {null | { sync: () => void }} */
let fixtureFormStartPicker = null;
/** @type {null | { el: HTMLButtonElement, sync: () => void }} */
let fixtureFormCountPicker = null;
/** @type {null | { el: HTMLButtonElement, sync: () => void }} */
let fixtureFormQtyPicker = null;
const fixtureQtyPicker = requireEl("fixtureQtyPicker", HTMLElement);
const fixtureConflicts = requireEl("fixtureConflicts", HTMLElement);
const fixtureScroll = requireEl("fixtureScroll", HTMLElement);
const fixtureEmpty = requireEl("fixtureEmpty", HTMLElement);
const fixtureList = requireEl("fixtureList", HTMLElement);
const addFixtureBtn = requireEl("addFixtureBtn", HTMLButtonElement);
const addFixtureGroupBtn = requireEl("addFixtureGroupBtn", HTMLButtonElement);
const fixtureFormGroupPickerHost = requireEl(
  "fixtureFormGroupPicker",
  HTMLElement,
);
const fixtureGroupMenu = requireEl("fixtureGroupMenu", HTMLElement);
const fixtureGroupMenuList = requireEl("fixtureGroupMenuList", HTMLElement);
/** @type {null | { el: HTMLButtonElement, sync: () => void }} */
let fixtureFormGroupPicker = null;
const navEl = requireEl("nav", HTMLElement);
/** @type {Record<string, HTMLElement>} */
const pages = {
  set: pageSet,
  songs: pageTunes,
  channels: pageChannels,
  fixtures: pageFixtures,
  patch: pagePatch,
};

function getNavLinks() {
  return [...navEl.querySelectorAll(".nav-link")];
}

/** Snapshot of last explicitly saved/loaded set (or boot state). */
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

/** A cue's own name ("" = none). */
function transitionName(index) {
  const name = names[index];
  return typeof name === "string" ? name.trim() : "";
}

/** "Cue 3: Chorus": cues are numbered by their position in the song. */
function cueLabel(index) {
  const name = transitionName(index);
  return `Cue ${index + 1}${name ? `: ${name}` : ""}`;
}

/** @deprecated */
function sceneName(index) {
  return cueLabel(index);
}

/**
 * Show "Cue N" (its position) and the cue's name in a title element.
 * `editable` titles show a dim "name" placeholder while the cue has none.
 */
function fillCueTitle(el, index, editable = false) {
  const num = document.createElement("span");
  num.className = "cue-number";
  num.textContent = `Cue ${index + 1}`;
  const name = transitionName(index);
  if (!name && !editable) {
    el.replaceChildren(num);
    return;
  }
  num.textContent += ":";
  const label = document.createElement("span");
  label.className = "cue-name";
  label.classList.toggle("is-empty", !name);
  label.textContent = name || "name";
  el.replaceChildren(num, label);
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
  endInlineFixtureRename?.();
  endInlineTuneRename?.();
  closeChannelsSceneMenu?.();
  closeScenePicker?.();
  closeSceneRowMenu?.();
  closeFaderNameMenu?.();
  closeChannelPicker?.();
  closeCountPicker?.();
  closeFixtureGroupPicker?.();
}

/** @type {null | (() => void)} */
let endInlineTuneRename = null;

/** @type {null | (() => void)} */
let endInlineFixtureRename = null;

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

/**
 * @param {HTMLElement} anchor
 * @param {number} index
 * @param {number} [clientX]
 * @param {number} [clientY]
 */
function openFaderNameMenu(anchor, index, clientX, clientY) {
  closeFaderNameMenu?.();
  closeSceneRowMenu?.();
  closeChannelsSceneMenu?.();
  closeScenePicker?.();
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
  status = { text, state };
  notifyHeader();
}

function isUnpatched(targets) {
  return !targets || targets.length === 0;
}

/** @param {HTMLElement} wrap @param {HTMLInputElement} slider @param {import("./patch.js").FaderPatch} targets */
// The refresh functions run on every change (dozens of times a second
// while another console drags or fades), so they only touch the DOM where
// something actually changed: rewriting ~3,000 unchanged sliders and labels
// each time kept a second console window too busy to keep up.
function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}
function setValue(input, value) {
  if (input.value !== value) input.value = value;
}
function setTitle(el, title) {
  if (el.title !== title) el.title = title;
}
/** Fill height last written per element (style.height reads back normalized). */
const fillHeights = new WeakMap();
function setFill(el, level) {
  const height = `${(level / 255) * 100}%`;
  if (fillHeights.get(el) === height) return;
  fillHeights.set(el, height);
  el.style.height = height;
}

function applyFaderPatchState(wrap, slider, targets) {
  const unpatched = isUnpatched(targets);
  wrap.classList.toggle("is-unpatched-fader", unpatched);
  if (slider.disabled !== unpatched) slider.disabled = unpatched;
  if (unpatched) {
    setTitle(slider, "No channels patched");
  } else if (slider.hasAttribute("title")) {
    slider.removeAttribute("title");
  }
}

/** Live fader level after submasters + crossfade + master (0–255), before per-channel max */
function liveLevel(faderIndex) {
  return mixLevel({ master, cross, fromSub, toSub, fromRow, toRow }, rows, faderIndex);
}

function refreshLiveRow() {
  for (let i = 0; i < FADER_COUNT; i++) {
    const level = outputLevel(i);
    setText(liveUi.valueEls[i], String(level));
    setFill(liveUi.fillEls[i], level);
    setText(liveUi.patchLabelEls[i], formatChannelLabel(patch[i]));
    liveUi.patchLabelEls[i].classList.toggle("is-unpatched", isUnpatched(patch[i]));
    setTitle(liveUi.patchLabelEls[i], formatChannelTooltip(patch[i]));
  }
}

/** @returns {Map<number, number>} DMX channel → output level */
// Dimmer-fader overrides (output only, not saved), both momentary: while
// held, blackout puts a fader's output at 0 and flash puts it at full.
// These are the ones held on this console…
const blackedOutFaders = new Set();
const flashingFaders = new Set();
// …and on every console, as the show server last reported.
let serverBlackedOut = new Set();
let serverFlashing = new Set();
const isFlashing = (i) => flashingFaders.has(i) || serverFlashing.has(i);
const isBlackedOut = (i) => blackedOutFaders.has(i) || serverBlackedOut.has(i);

/** What a fader actually sends: its live level, unless flashed (full) or blacked out (0). */
function outputLevel(i) {
  if (isFlashing(i)) return 255;
  if (isBlackedOut(i)) return 0;
  return liveLevel(i);
}

function computeChannelLevels() {
  return channelLevelsFor(patch, outputLevel);
}

function patchedChannelSet() {
  const set = new Set();
  for (const targets of patch) {
    for (const target of targets) set.add(target.channel);
  }
  return set;
}

/** Universe shown by the Channels-tab meters. */
let meterUniverse = 1;

/** Channels shown on the Channels tab: 1–256 of the chosen universe, plus any higher patched channels in it. */
function displayedChannels() {
  const patched = patchedChannelSet();
  const first = universeStart(meterUniverse);
  const lastInUniverse = first + UNIVERSE_SIZE - 1;
  let highest = first + CHANNEL_METER_COUNT - 1;
  for (const channel of patched) {
    if (channel > highest && channel <= lastInUniverse) highest = channel;
  }
  return Array.from({ length: highest - first + 1 }, (_, i) => first + i);
}

function refreshChannelRow() {
  const levels = computeChannelLevels();
  const patched = patchedChannelSet();
  for (const channel of channelUi.channels) {
    const level = levels.get(channel) ?? 0;
    const valueEl = channelUi.valueEls.get(channel);
    const fillEl = channelUi.fillEls.get(channel);
    const wrap = channelUi.wrapEls.get(channel);
    if (valueEl) setText(valueEl, String(level));
    if (fillEl) setFill(fillEl, level);
    if (wrap) wrap.classList.toggle("is-unpatched-channel", !patched.has(channel));
  }
}

function renderChannelRow() {
  const channels = displayedChannels();
  const patched = patchedChannelSet();
  channelRowKey = `${meterUniverse}:${universes}:${channels.length}:${[...patched].sort((a, b) => a - b).join(",")}`;
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
    label.textContent = `Ch${formatAddress(channel)}`;

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
  const key = `${meterUniverse}:${universes}:${channels.length}:${[...patched].sort((a, b) => a - b).join(",")}`;
  if (key !== channelRowKey) renderChannelRow();
}

function persistSession() {
  saveSession(currentSetState());
  savePatch(patch);
  serverLink?.sync();
}

/**
 * Show the new output here and send the change to the show server (which
 * drives the DMX). `fromServer`: the change came from the server, so redraw
 * at the next frame (a burst of messages costs one redraw, and a hidden
 * window waits until it's shown) and let the stage link's leader pass it on.
 */
function pushToDmx({ persist = true, fromServer = false } = {}) {
  serverLink?.sync();
  if (fromServer) refreshOutputSoon();
  else refreshOutput();
  notifyStage({ local: !fromServer });
  if (persist) persistSession();
}

function refreshOutput({ selectedGroup = true } = {}) {
  refreshLiveRow();
  refreshChannelRow();
  if (selectedGroup) refreshSelectedGroup();
  refreshColorBars();
  refreshDimmerButtons();
}

let refreshQueued = false;
function refreshOutputSoon() {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    syncSlidersFromState(); // includes refreshSelectedGroup
    refreshOutput({ selectedGroup: false });
  });
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

  addColorBars(liveFadersEl, null);
  liveUi = { valueEls, patchLabelEls, fillEls };
  refreshLiveRow();
}

function refreshRowSelects() {
  selectedRow = Math.min(Math.max(0, selectedRow), rows.length - 1);
  syncPlaybackPair();
  fillCueTitle(crossFromLabel, fromRow);
  fillCueTitle(crossToLabel, toRow);
  const nextFade =
    getActiveTune().transitions[toRow]?.fadeTime ??
    normalizeTransitionFadeTime(fadeTime);
  goNextFade.textContent = `${nextFade}s`;
  goBtn.title = `GO — transition to ${cueLabel(toRow)} (${nextFade}s)`;
  goBtn.setAttribute(
    "aria-label",
    `GO to ${cueLabel(toRow)} in ${nextFade} seconds`,
  );
  syncSubmasterLabels();
  removeRowBtn.disabled = rows.length <= MIN_TRANSITIONS;
  removeRowBtn.setAttribute(
    "aria-label",
    `Remove ${cueLabel(selectedRow)}`,
  );
  removeRowBtn.title = `Remove ${cueLabel(selectedRow)}`;
  addRowBtn.disabled = rows.length >= MAX_TRANSITIONS;
  updateScenesButton();
  syncTuneUi();
}

/** Cue the scenes button last showed (it's refreshed on every change; redrawing it each time would also close a rename in progress). */
let scenesButtonKey = "";

function updateScenesButton() {
  if (!currentSceneTitle) return;
  const key = `${selectedRow}|${transitionName(selectedRow)}`;
  if (key === scenesButtonKey) return;
  scenesButtonKey = key;
  fillCueTitle(currentSceneTitle, selectedRow, true);
  currentSceneTitle.title = "Click to rename";
  channelsSceneMenuBtn.setAttribute(
    "aria-label",
    `Options for ${cueLabel(selectedRow)}`,
  );
  channelsSceneMenuBtn.title = `Options for ${cueLabel(selectedRow)}`;
}

/** Label at the top right of a cue: CURRENT, UP NEXT, or how to make it current. */
function rowHint(r) {
  return r === fromRow ? "Current" : r === toRow ? "Up next" : "Click to make live";
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
    const hint = bank.querySelector(".fader-row-hint");
    if (hint) hint.textContent = rowHint(r);
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
  closeSceneRowMenu?.();
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

  addColorBars(selectedGroupFadersEl, selectedRow);
  selectedGroupUi = { valueEls, patchLabelEls, sliders };
  refreshColorBars();
}

function refreshSelectedGroup() {
  if (!selectedGroupUi.sliders.length) return;
  const row = rows[selectedRow];
  if (!row) return;
  updateScenesButton();
  for (let i = 0; i < FADER_COUNT; i++) {
    setValue(selectedGroupUi.sliders[i], String(row[i]));
    setText(selectedGroupUi.valueEls[i], String(row[i]));
    setText(selectedGroupUi.patchLabelEls[i], formatChannelLabel(patch[i]));
    setTitle(selectedGroupUi.patchLabelEls[i], formatChannelTooltip(patch[i]));
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
  activeTuneLabel.title = `${tune.name} · ${tune.transitions.length} cues`;
  addTuneBtn.disabled = tunes.length >= MAX_TUNES;
  if (!pageSet.hidden) renderTunes();
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
  pageSet.classList.add("is-dragging-tune");

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
    pageSet.classList.remove("is-dragging-tune");
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
    meta.textContent = `${n} cue${n === 1 ? "" : "s"}`;

    const badge = document.createElement("span");
    badge.className = "tune-row-badge";
    badge.textContent = tune.id === activeTuneId ? "Playing" : "Play";

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "fixture-remove";
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
          ".tune-drag-handle, .tune-row-name, .fixture-remove, .scene-title-input",
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
  input.setAttribute("aria-label", "Song name");
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
    title: "New song",
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
    title: "Remove song?",
    message: `Remove “${tune.name}” and all of its cues?`,
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
    head.title = "Click to make this the live cue";

    const dragHandle = document.createElement("div");
    dragHandle.className = "fader-row-drag-handle";
    dragHandle.title = "Drag to reorder";
    dragHandle.setAttribute("aria-hidden", "true");
    dragHandle.textContent = "⋮⋮";

    const titleGroup = document.createElement("div");
    titleGroup.className = "scene-title-group";

    const title = document.createElement("h3");
    title.className = "scene-title";
    fillCueTitle(title, r, true);
    title.title = "Double-click to name this cue";

    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "scene-menu-btn";
    menuBtn.innerHTML = '<span class="scene-menu-dots" aria-hidden="true"></span>';
    menuBtn.title = "Cue options";
    menuBtn.setAttribute("aria-label", `Options for ${cueLabel(r)}`);
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
    fadeGroup.title = "Transition time into this cue (how long GO takes to fade to it)";
    const fadeLabel = document.createElement("span");
    fadeLabel.className = "transition-fade-label";
    fadeLabel.textContent = "In";
    const fadeSelect = document.createElement("select");
    fadeSelect.className = "transition-fade-select";
    fadeSelect.setAttribute(
      "aria-label",
      `Transition time into ${cueLabel(r)}`,
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
    hint.textContent = rowHint(r);

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

    addColorBars(grid, r);
    bank.append(head, grid);
    rowsEl.append(bank);
    rowUi[r] = { valueEls, patchLabelEls, sliders };
  }

  refreshRowSelects();
  refreshColorBars();
}

// ---------------------------------------------------------------------
// R/G/B color bars: three side-by-side faders driving one light's red,
// green and blue get a color bar under them. In a transition (and the
// Channels-page strip) clicking it opens a color picker that sets all
// three; on the Live strip it just shows the mix going out.
// ---------------------------------------------------------------------

/** What a fader drives, if it's a single channel with a known color role. */
function faderColorRole(fader) {
  const targets = patch[fader];
  if (!targets || targets.length !== 1) return null;
  const ch = targets[0].channel;
  const owner = fixtures.find((i) => ch >= i.channelStart && ch <= i.channelEnd);
  const role = owner?.roles?.[ch - owner.channelStart];
  if (role) return { owner: owner.id, role };
  // Hand-made fixtures: fall back to names ending in R / G / B or Red / Green / Blue.
  const name = faderName(fader).trim();
  const m = /(?:^|[\s·])(r|red|g|green|b|blue)$/i.exec(name);
  if (!m) return null;
  const c = m[1][0].toLowerCase();
  return { owner: owner?.id ?? name.slice(0, -m[1].length).trim(), role: c === "r" ? "red" : c === "g" ? "green" : "blue" };
}

/** First fader of each R, G, B trio (side by side, same light). */
function rgbTrios() {
  const out = [];
  for (let i = 0; i + 2 < FADER_COUNT; i++) {
    const [r, g, b] = [faderColorRole(i), faderColorRole(i + 1), faderColorRole(i + 2)];
    if (r?.role === "red" && g?.role === "green" && b?.role === "blue" && r.owner === g.owner && g.owner === b.owner) {
      out.push(i);
      i += 2;
    }
  }
  return out;
}

/**
 * Pan / tilt fader pairs of the same fixture (by role, or faders named
 * "… Pan" / "… Tilt"): [{ pan, tilt }].
 */
function panTiltPairs() {
  const roleOf = (i) => {
    const r = faderColorRole(i);
    if (r?.role === "pan" || r?.role === "tilt") return r;
    const m = /(?:^|[\s·])(pan|tilt)$/i.exec(faderName(i).trim());
    return m ? { owner: faderOwner(i)?.id ?? faderName(i).slice(0, -m[1].length).trim(), role: m[1].toLowerCase() } : null;
  };
  const roles = Array.from({ length: FADER_COUNT }, (_, i) => roleOf(i));
  const out = [];
  roles.forEach((r, pan) => {
    if (r?.role !== "pan") return;
    const tilt = roles.findIndex((t) => t?.role === "tilt" && t.owner === r.owner);
    if (tilt >= 0) out.push({ pan, tilt });
  });
  return out;
}

const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

// ---------------------------------------------------------------------
// Fixture outlines: a line around each run of side-by-side faders that
// control one fixture, labelled with its name.
// ---------------------------------------------------------------------

/** The fixture a fader controls (all its channels in one fixture), or null. */
function faderOwner(fader) {
  const targets = patch[fader];
  if (!targets?.length) return null;
  const owner = fixtures.find((i) => targets[0].channel >= i.channelStart && targets[0].channel <= i.channelEnd);
  if (!owner) return null;
  return targets.every((t) => t.channel >= owner.channelStart && t.channel <= owner.channelEnd) ? owner : null;
}

/** Runs of side-by-side faders with the same fixture: [{ start, length, fixture }]. */
function fixtureRuns() {
  const runs = [];
  for (let i = 0; i < FADER_COUNT; ) {
    const owner = faderOwner(i);
    let j = i + 1;
    if (owner) while (j < FADER_COUNT && faderOwner(j) === owner) j++;
    if (owner) runs.push({ start: i, length: j - i, fixture: owner });
    i = j;
  }
  return runs;
}

/** Outline colors, alternated so neighbouring fixtures look different. */
const OUTLINE_COLORS = ["#e2a13a", "#5fb7d6", "#9cc76b", "#d68ab4", "#c9b458", "#8a9be0"];

/**
 * Grid columns for a fader block: a narrow spacer column follows each
 * fixture's run of faders, so fixtures sit a little apart.
 * `col[i]` is fader i's (1-based) grid column.
 */
function faderColumns(runs = fixtureRuns()) {
  const ends = new Set(runs.map((run) => run.start + run.length - 1));
  const col = [];
  const template = [];
  for (let i = 0; i < FADER_COUNT; i++) {
    col.push(template.length + 1);
    template.push("40px");
    if (ends.has(i) && i < FADER_COUNT - 1) template.push("var(--fixture-gap)");
  }
  return { col, template: template.join(" ") };
}

/** Fixtures selected on the stage: their outlines stay highlighted. */
let revealedFixtureIds = [];

function addFixtureOutlines(grid, { col, template } = faderColumns()) {
  // Pin each fader to its own column so outlines can sit on top of them.
  grid.style.gridTemplateColumns = template;
  [...grid.children].filter((el) => el.classList.contains("fader")).forEach((el, i) => { el.style.gridColumn = String(col[i]); });
  // When there's a second row (color bars, B / F buttons), outlines reach down
  // over it too, so they sit inside the fixture's box (all outlines, for even heights).
  const withBars = rgbTrios().length > 0 || dimmerFaderList().length > 0 || panTiltPairs().length > 0;
  fixtureRuns().forEach((run, k) => {
    const box = document.createElement("div");
    box.className = "fixture-outline";
    box.style.gridColumn = `${col[run.start]} / ${col[run.start + run.length - 1] + 1}`;
    box.style.gridRow = withBars ? "1 / span 2" : "1";
    box.style.setProperty("--outline", OUTLINE_COLORS[k % OUTLINE_COLORS.length]);
    box.dataset.name = run.fixture.name;
    box.dataset.fixtureId = run.fixture.id;
    box.title = `${run.fixture.name} · ${formatChannelRange(run.fixture)}`;
    box.classList.toggle("is-revealed", revealedFixtureIds.includes(run.fixture.id));
    grid.append(box);
  });
}

/**
 * Scroll the fader rows to show these fixtures' faders (they scroll
 * together) and highlight their outlines until the stage selects something
 * else ([] = nothing: just clear the highlight). Used when fixtures are
 * selected on the stage.
 */
function revealFixtures(ids) {
  revealedFixtureIds = ids;
  for (const box of document.querySelectorAll(".fixture-outline")) {
    box.classList.toggle("is-revealed", ids.includes(box.dataset.fixtureId));
  }
  const runs = fixtureRuns().filter((run) => ids.includes(run.fixture.id));
  if (!runs.length) return;
  const first = Math.min(...runs.map((r) => r.start));
  const last = Math.max(...runs.map((r) => r.start + r.length - 1));
  const strip = liveFadersEl;
  const a = liveUi.valueEls[first]?.closest(".fader");
  const b = liveUi.valueEls[last]?.closest(".fader");
  if (strip && a && b) {
    const left = a.offsetLeft - strip.offsetLeft;
    const right = b.offsetLeft - strip.offsetLeft + b.offsetWidth;
    const view = strip.clientWidth;
    // Only scroll if the group isn't already fully in view; then centre it (or show its start).
    if (left < strip.scrollLeft || right > strip.scrollLeft + view) {
      const target = right - left <= view ? left - (view - (right - left)) / 2 : left - 8;
      // Instant: a smooth scroll gets interrupted by the rows' scroll syncing.
      strip.scrollLeft = Math.max(0, target);
    }
  }
}

// ---------------------------------------------------------------------
// Blackout / flash buttons under dimmer faders
// ---------------------------------------------------------------------

/** Whether a fader drives a fixture's dimmer (roles, or a name ending in Dim / Dimmer / Intensity). */
function isDimmerFader(fader) {
  const targets = patch[fader];
  if (!targets?.length) return false;
  const ch = targets[0].channel;
  const owner = fixtures.find((f) => ch >= f.channelStart && ch <= f.channelEnd);
  if (owner?.roles?.[ch - owner.channelStart] === "dimmer") return true;
  return /(?:^|[\s·])(dim|dimmer|intensity)$/i.test(faderName(fader).trim());
}

/**
 * What a flash drives to full: the dimmer fader plus its fixture's red /
 * green / blue faders (and any "white" one), so the fixture flashes white.
 */
function flashGroup(fader) {
  const target = patch[fader]?.[0];
  const owner = target && fixtures.find((f) => target.channel >= f.channelStart && target.channel <= f.channelEnd);
  if (!owner) return [fader];
  const group = [fader];
  for (let j = 0; j < FADER_COUNT; j++) {
    if (j === fader) continue;
    const color = faderColorRole(j);
    const isRgb = color?.owner === owner.id && ["red", "green", "blue"].includes(color.role);
    if (isRgb || (faderOwner(j) === owner && /white$/i.test(faderName(j).trim()))) group.push(j);
  }
  return group;
}

const dimmerFaderList = () => Array.from({ length: FADER_COUNT }, (_, i) => i).filter(isDimmerFader);

/** While `btn` is held, `faders()` are in `set` (blackout / flash); released, they're out. */
function holdButton(btn, set, faders) {
  let held = [];
  const release = () => {
    if (!held.length) return;
    for (const f of held) set.delete(f);
    held = [];
    pushToDmx({ persist: false });
  };
  btn.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    btn.setPointerCapture(e.pointerId);
    held = faders();
    for (const f of held) set.add(f);
    pushToDmx({ persist: false });
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) btn.addEventListener(type, release);
}

/** B / F buttons for a dimmer fader, placed in the row under the faders (with the color bars). */
function addDimmerButtons(grid, fader, col) {
  const box = document.createElement("div");
  box.className = "dim-btns";
  box.style.gridColumn = String(col[fader]);
  const blackout = document.createElement("button");
  blackout.type = "button";
  blackout.className = "dim-btn dim-blackout";
  blackout.dataset.fader = String(fader);
  blackout.textContent = "B";
  blackout.title = `Blackout ${faderName(fader)}: output 0 while held`;
  holdButton(blackout, blackedOutFaders, () => [fader]);
  const flash = document.createElement("button");
  flash.type = "button";
  flash.className = "dim-btn dim-flash";
  flash.dataset.fader = String(fader);
  flash.textContent = "F";
  flash.title = `Flash ${faderName(fader)}: full and white while held`;
  holdButton(flash, flashingFaders, () => flashGroup(fader));
  box.append(blackout, flash);
  grid.append(box);
}

/** Light up the B / F buttons of every blacked-out / flashing fader (in every block). */
function refreshDimmerButtons() {
  for (const btn of document.querySelectorAll(".dim-btn")) {
    const fader = Number(btn.dataset.fader);
    btn.classList.toggle("on", btn.classList.contains("dim-blackout") ? isBlackedOut(fader) : isFlashing(fader));
  }
}

/** DMX steps per pixel of mouse movement on a pan / tilt pad (⇧ = fine). */
const PAD_SPEED = 0.5;
const PAD_SPEED_FINE = 0.1;

/**
 * A pad under a pan / tilt pair: hold the mouse button on it and move the
 * mouse: left / right = pan, up / down = tilt. The pointer is locked while
 * held, so it can't run off the pad.
 */
function addPanTiltPad(grid, { pan, tilt }, row, col) {
  const pad = document.createElement("div");
  pad.className = "pt-pad";
  pad.textContent = "✥";
  pad.style.gridColumn = tilt === pan + 1 ? `${col[pan]} / ${col[tilt] + 1}` : String(col[pan]);
  pad.title = `Hold and move the mouse: left / right = ${faderName(pan)}, up / down = ${faderName(tilt)} (⇧ = fine)`;
  let held = null;
  const move = (e) => {
    const levels = rows[row];
    if (!held || !levels) return;
    const speed = e.shiftKey ? PAD_SPEED_FINE : PAD_SPEED;
    held.pan = Math.max(0, Math.min(255, held.pan + e.movementX * speed));
    held.tilt = Math.max(0, Math.min(255, held.tilt - e.movementY * speed));
    const p = Math.round(held.pan);
    const t = Math.round(held.tilt);
    if (p === levels[pan] && t === levels[tilt]) return;
    levels[pan] = p;
    levels[tilt] = t;
    syncSlidersFromState();
    pushToDmx({ persist: false });
  };
  const release = () => {
    if (!held) return;
    held = null;
    pad.classList.remove("is-held");
    pad.removeEventListener("pointermove", move);
    if (document.pointerLockElement === pad) document.exitPointerLock();
    pushToDmx();
  };
  pad.addEventListener("pointerdown", (e) => {
    const levels = rows[row];
    if (e.button !== 0 || e.altKey || !levels) return;
    e.preventDefault();
    e.stopPropagation();
    held = { pan: levels[pan], tilt: levels[tilt] };
    pad.classList.add("is-held");
    pad.setPointerCapture(e.pointerId);
    pad.addEventListener("pointermove", move);
    try {
      pad.requestPointerLock()?.catch?.(() => {});
    } catch {
      // No pointer lock: pointer capture still tracks the drag.
    }
  });
  pad.addEventListener("click", (e) => e.stopPropagation());
  for (const type of ["pointerup", "pointercancel"]) pad.addEventListener(type, release);
  grid.append(pad);
}

/** Add color bars to a fader grid: `row` = transition index, or null for Live. */
function addColorBars(grid, row) {
  const columns = faderColumns();
  const { col } = columns;
  addFixtureOutlines(grid, columns);
  for (const fader of dimmerFaderList()) addDimmerButtons(grid, fader, col);
  if (row != null) for (const pair of panTiltPairs()) addPanTiltPad(grid, pair, row, col);
  for (const start of rgbTrios()) {
    const bar = document.createElement("label");
    bar.className = "rgb-bar";
    bar.style.gridColumn = `${col[start]} / ${col[start + 2] + 1}`;
    bar.dataset.start = String(start);
    if (row == null) {
      bar.dataset.live = "1";
      bar.title = `${faderName(start)} / ${faderName(start + 1)} / ${faderName(start + 2)} · live color`;
    } else {
      bar.dataset.row = String(row);
      bar.title = "Click to pick a color (sets these three faders)";
      const input = document.createElement("input");
      input.type = "color";
      input.setAttribute("aria-label", `Color for ${faderName(start)}, ${faderName(start + 1)}, ${faderName(start + 2)}`);
      input.addEventListener("input", () => {
        const levels = rows[row];
        if (!levels) return;
        const v = input.value;
        levels[start] = parseInt(v.slice(1, 3), 16);
        levels[start + 1] = parseInt(v.slice(3, 5), 16);
        levels[start + 2] = parseInt(v.slice(5, 7), 16);
        syncSlidersFromState();
        pushToDmx();
      });
      bar.append(input);
    }
    grid.append(bar);
  }
}

/** Show each bar's current color (transition values, or live output). */
function refreshColorBars() {
  for (const bar of document.querySelectorAll(".rgb-bar")) {
    const start = Number(bar.dataset.start);
    const levels = bar.dataset.live ? [liveLevel(start), liveLevel(start + 1), liveLevel(start + 2)] : (rows[Number(bar.dataset.row)] ?? []).slice(start, start + 3);
    const color = `#${hex2(levels[0] ?? 0)}${hex2(levels[1] ?? 0)}${hex2(levels[2] ?? 0)}`;
    bar.style.setProperty("--rgb", color);
    const input = bar.querySelector("input");
    if (input && document.activeElement !== input) setValue(input, color);
  }
}

/** Trio layout the fader rows were last drawn with (redraw when it changes). */
let colorBarKey = "";

function refreshFaderPatchLabels() {
  // Patch / fixture edits can create or break an R/G/B trio: redraw the rows.
  const key = `${rgbTrios().join(",")}|${fixtureRuns().map((r) => `${r.start}+${r.length}:${r.fixture.id}:${r.fixture.name}`).join(",")}|${dimmerFaderList().join(",")}|${panTiltPairs().map((p) => `${p.pan}:${p.tilt}`).join(",")}`;
  if (key !== colorBarKey) {
    colorBarKey = key;
    renderLiveRow();
    renderRows();
    renderSelectedGroup();
  }
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
      setValue(rowUi[r].sliders[i], String(rows[r][i]));
      setText(rowUi[r].valueEls[i], String(rows[r][i]));
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
let closeChannelPicker = null;
/** @type {null | (() => void)} */
let closeCountPicker = null;
/** @type {null | (() => void)} */
let closeFixtureGroupPicker = null;

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
 * Fixture-group picker (Ungrouped + named groups).
 * @param {{
 *   getGroupId: () => string | null,
 *   setGroupId: (groupId: string | null) => void | Promise<void>,
 *   className?: string,
 *   ariaLabel?: string | ((groupId: string | null, label: string) => string),
 * }} opts
 */
function makeFixtureGroupPickerButton({
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
  return fixtureGroups.find((group) => group.id === groupId)?.name ?? "Ungrouped";
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
      item.className = "popup-menu-item";
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
    for (const group of fixtureGroups) {
      addItem(group.name, group.id);
    }

    fixtureGroupMenu.hidden = false;

    const anchorRect = anchor.getBoundingClientRect();
    const menuWidth = 180;
    const menuHeight = Math.min(320, 48 + (fixtureGroups.length + 1) * 36);
    let left = anchorRect.left;
    let top = anchorRect.bottom + 6;
    if (left + menuWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuWidth - 8);
    }
    if (top + menuHeight > window.innerHeight - 8) {
      top = Math.max(8, anchorRect.top - menuHeight - 6);
    }
    fixtureGroupMenu.style.left = `${left}px`;
    fixtureGroupMenu.style.top = `${top}px`;

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
  closeChannelsSceneMenu?.();
  closeScenePicker?.();
  closeSceneRowMenu?.();
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
  closeFixtureGroupPicker?.();
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
            item.className = "popup-menu-item";
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
        item.className = "popup-menu-item";
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
  const paused = running && fadeState.paused;
  fadePauseBtn.disabled = !running;
  fadePauseBtn.textContent = paused ? "Resume" : "Pause";
  fadePauseBtn.classList.toggle("is-paused", paused);
  goBtn.classList.toggle("is-running", running && !paused);
  goBtn.disabled = rows.length < 2;
}

// Timed fades run on the show server (server/show.js), so a hidden or closed
// tab can't stall them; the console asks for GO / pause / stop and follows
// the crossfade, Current / Next and the cue it arrives on.

function stopTimedFade() {
  if (fadeState) serverLink?.command("stop");
  fadeState = null;
  updateFadePauseButton();
}

/**
 * GO: fade from the current transition’s fader levels to the next transition
 * in tune order (using that next transition’s fadeTime), then advance.
 */
function goNextTransition() {
  if (rows.length < 2) return;
  serverLink?.command("go");
}

/** A GO finished on the server: show the cue it arrived on. */
function showArrivedCue() {
  refreshRowSelects();
  renderRows();
  renderSelectedGroup();
  const bank = rowsEl.querySelector(`.fader-row[data-row="${selectedRow}"]`);
  bank?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function toggleFadePause() {
  if (!fadeState) return;
  serverLink?.command("pause");
}

function syncSetNameUi() {
  setName = normalizeSetName(setName);
  document.title = `${setName} · UnnaturalLight`;
  notifyHeader();
}

function applySetName(name) {
  const next = normalizeSetName(name);
  if (!next || next === setName) return false;
  setName = next;
  syncSetNameUi();
  persistSession();
  return true;
}

function currentSetState() {
  // Keep transition names in sync (rows share level array refs already).
  const tune = getActiveTune();
  for (let i = 0; i < tune.transitions.length; i++) {
    if (typeof names[i] === "string") tune.transitions[i].name = names[i];
  }
  return {
    setName,
    navOrder,
    master,
    cross,
    fromSub,
    toSub,
    fadeTime,
    universes,
    fromRow,
    toRow,
    selectedRow,
    tunes,
    activeTuneId,
    faderNames,
    fixtureGroups,
    fixtures,
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

function ensureFixtureFormStartPicker() {
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

function ensureFixtureFormCountPicker() {
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

function ensureFixtureFormQtyPicker() {
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

function ensureFixtureFormGroupPicker() {
  if (fixtureFormGroupPicker) {
    fixtureFormGroupPicker.sync();
    return;
  }
  fixtureFormGroupPickerHost.replaceChildren();
  fixtureFormGroupPicker = makeFixtureGroupPickerButton({
    className: "channel-picker-btn channel-picker-btn-lg",
    getGroupId: () => fixtureFormGroupId,
    setGroupId: (groupId) => {
      fixtureFormGroupId = groupId;
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
function batchFixtureNames(base, qty) {
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
  const full = fixtures.length >= MAX_FIXTURES;
  const groupsFull = fixtureGroups.length >= MAX_FIXTURE_GROUPS;
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
function suggestFixtureFormStart() {
  const width = Math.max(1, Math.round(fixtureFormCount) || 1);
  const suggested = nextAvailableRange(fixtures, width);
  if (!suggested) return;
  fixtureFormStart = suggested.channelStart;
  fixtureFormStartPicker?.sync();
}

function updateFixtureConflicts() {
  /** @type {string[]} */
  const notes = [];
  for (let i = 0; i < fixtures.length; i++) {
    const a = fixtures[i];
    for (let j = i + 1; j < fixtures.length; j++) {
      const b = fixtures[j];
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
    const fixture = fixtures.find((item) => item.id === id);
    if (!fixture) continue;
    const conflict = findRangeConflict(
      fixtures,
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
    fixtures,
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
  const fromIndex = fixtures.findIndex((item) => item.id === fromId);
  if (fromIndex < 0) return false;
  if (beforeId === fromId || afterId === fromId) return false;

  const [item] = fixtures.splice(fromIndex, 1);
  item.groupId = groupId;

  let insertAt = fixtures.length;
  if (beforeId) {
    const idx = fixtures.findIndex((entry) => entry.id === beforeId);
    if (idx >= 0) insertAt = idx;
  } else if (afterId) {
    const idx = fixtures.findIndex((entry) => entry.id === afterId);
    if (idx >= 0) insertAt = idx + 1;
  } else {
    for (let i = fixtures.length - 1; i >= 0; i--) {
      if ((fixtures[i].groupId ?? null) === groupId) {
        insertAt = i + 1;
        break;
      }
    }
  }

  fixtures.splice(insertAt, 0, item);
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
  fixtureFormGroupId = groupId;
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
  pageFixtures.classList.add("is-dragging-fixture");

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
    pageFixtures.classList.remove("is-dragging-fixture");
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
      fixtureFormGroupId = groupId;
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
  remove.textContent = "×";
  remove.title = `Remove ${fixture.name}`;
  remove.setAttribute("aria-label", `Remove ${fixture.name}`);
  remove.addEventListener("click", async () => {
    const ok = await confirmAction({
      title: "Remove fixture?",
      message: `Remove “${fixture.name}” from this set?`,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    fixtures = fixtures.filter((item) => item.id !== fixture.id);
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

function renderFixtures() {
  fixtureList.replaceChildren();
  const hasContent = fixtures.length > 0 || fixtureGroups.length > 0;
  fixtureEmpty.hidden = hasContent;

  // Always render every group card, including empty ones.
  for (const group of fixtureGroups) {
    const members = fixturesInGroup(fixtures, group.id);
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

  const ungrouped = fixturesInGroup(fixtures, null);
  if (fixtureGroups.length > 0) {
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
  const fixture = fixtures.find((item) => item.id === id);
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
  input.className = "scene-title-input fixture-name-input";
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
  const group = fixtureGroups.find((item) => item.id === id);
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
  input.className = "scene-title-input fixture-group-name-input";
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

async function addFixtureGroup() {
  if (fixtureGroups.length >= MAX_FIXTURE_GROUPS) return;
  const name = await promptName({
    title: "New group",
    confirmLabel: "Create",
    initial: "",
  });
  if (!name) return;
  const group = createFixtureGroup({ name });
  fixtureGroups.push(group);
  fixtureFormGroupId = group.id;
  renderFixtures();
  persistSession();
  setStatus(
    `Group “${group.name}” created`,
    dmx.connected ? "connected" : "idle",
  );
}

async function removeFixtureGroup(id) {
  const group = fixtureGroups.find((item) => item.id === id);
  if (!group) return;
  const members = fixturesInGroup(fixtures, id);
  const ok = await confirmAction({
    title: "Remove group?",
    message:
      members.length > 0
        ? `Remove group “${group.name}”? Its ${members.length} fixture${members.length === 1 ? "" : "s"} will become ungrouped.`
        : `Remove empty group “${group.name}”?`,
    confirmLabel: "Remove",
  });
  if (!ok) return;
  for (const fixture of fixtures) {
    if (fixture.groupId === id) fixture.groupId = null;
  }
  fixtureGroups = fixtureGroups.filter((item) => item.id !== id);
  if (fixtureFormGroupId === id) fixtureFormGroupId = null;
  renderFixtures();
  persistSession();
}

function markClean() {
  cleanSnapshot = setSnapshot(currentSetState());
}

function isDirty() {
  return setSnapshot(currentSetState()) !== cleanSnapshot;
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
    title: "Remove cue?",
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
  // An empty name is fine: the cue is then just "Cue N".
  const next = name.trim();
  if (next === transitionName(index)) return false;
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
  input.value = transitionName(index);
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
    const changed = Boolean(commit && applySceneName(index, next));

    fillCueTitle(title, index, true);

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
  closeSceneRowMenu?.();
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
    item.textContent = "Select cue";
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
  closeChannelsSceneMenu?.();
  closeScenePicker?.();
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

function setUiConnected() {
  renderOutputs();
}

// ---------------------------------------------------------------------
// Universes: count, one DMX USB Pro each, Channels-tab meter universe
// ---------------------------------------------------------------------

/** The DMX outputs changed: redraw the page header and the meters' universe picker. */
function renderOutputs() {
  notifyHeader();
  syncMeterUniverse();
}

async function toggleOutput(u) {
  const out = outputs[u - 1];
  const label = universes > 1 ? `Universe ${u}` : "DMX Pro";
  if (out.connected) {
    await out.disconnect();
    renderOutputs();
    setStatus(`${label} disconnected`, "idle");
    return;
  }
  try {
    setStatus(universes > 1 ? `Looking for the DMX USB Pro for universe ${u}…` : "Looking for the DMX USB Pro…", "idle");
    await out.connect();
    renderOutputs();
    setStatus(`${label} connected`, "connected");
  } catch (err) {
    renderOutputs();
    setStatus(err instanceof Error ? err.message : "Connection failed", "error");
    console.error(err);
  }
}

/** Change the universe count; refuses to drop universes that are in use. */
function setUniverses(n) {
  const next = Math.max(1, Math.min(MAX_UNIVERSES, Math.round(n) || 1));
  if (next < universes) {
    const limit = next * UNIVERSE_SIZE;
    const usedPatch = patch.some((targets) => targets.some((t) => t.channel > limit));
    const usedBy = fixtures.find((i) => i.channelEnd > limit);
    if (usedPatch || usedBy) {
      setStatus(
        `Universe ${next + 1}+ is in use (${usedBy ? usedBy.name : "patched faders"}) — move or remove that first`,
        "error",
      );
      renderOutputs();
      return;
    }
    for (let u = next + 1; u <= MAX_UNIVERSES; u++) if (outputs[u - 1].connected) void outputs[u - 1].disconnect();
  }
  universes = next;
  setUniverseCount(universes);
  if (meterUniverse > universes) meterUniverse = universes;
  renderOutputs();
  renderFixtures();
  suggestFixtureFormStart();
  renderPatchTable();
  refreshFaderPatchLabels();
  renderChannelRow();
  ensureFixtureFormStartPicker();
  pushToDmx();
  setStatus(universes === 1 ? "1 universe" : `${universes} universes · channels shown as universe/channel`, "idle");
}

/** Channels tab: which universe the meters show. */
const meterUniverseSelect = document.createElement("select");
meterUniverseSelect.className = "meter-universe";
meterUniverseSelect.title = "Universe shown by the meters";
meterUniverseSelect.addEventListener("change", () => {
  meterUniverse = Number(meterUniverseSelect.value) || 1;
  renderChannelRow();
});
pageChannels.querySelector(".page-intro")?.append(meterUniverseSelect);

function syncMeterUniverse() {
  meterUniverseSelect.hidden = universes < 2;
  meterUniverseSelect.replaceChildren(
    ...Array.from({ length: universes }, (_, i) => {
      const opt = document.createElement("option");
      opt.value = String(i + 1);
      opt.textContent = `Universe ${i + 1}`;
      return opt;
    }),
  );
  meterUniverseSelect.value = String(meterUniverse);
}

function showPage(name) {
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
  if (page === "set") renderTunes();
  if (page === "channels") {
    refreshChannelRow();
    renderSelectedGroup();
  }
}

function routeFromHash() {
  const hash = location.hash.replace("#", "");
  // The Songs page was called Tunes for a while.
  if (hash === "faders" || hash === "tunes") {
    showPage("songs");
    return;
  }
  if (hash === "show" || hash === "setlist") {
    showPage("set");
    return;
  }
  // The Fixtures page used to be called Instruments.
  if (hash === "instruments") {
    showPage("fixtures");
    return;
  }
  if (
    hash === "set" ||
    hash === "songs" ||
    hash === "patch" ||
    hash === "channels" ||
    hash === "fixtures"
  ) {
    showPage(hash);
  } else {
    showPage("songs");
  }
}

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
  // New cues are just numbered; double-click one to give it a name.
  tune.transitions.push(createTransition({ name: "" }));
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

/**
 * Replace the whole set. `fromServer`: another console (or the server) changed
 * it, so leave the fade, blackouts and held buttons alone.
 */
function applySet(state, { fromServer = false } = {}) {
  if (!fromServer) {
    stopTimedFade();
    clearBlackoutSnapshots();
    blackedOutFaders.clear();
    flashingFaders.clear();
  }
  setName = normalizeSetName(state.setName);
  navOrder = normalizeNavOrder(state.navOrder);
  master = state.master;
  cross = state.cross;
  fromSub = state.fromSub ?? 100;
  toSub = state.toSub ?? 100;
  fadeTime = normalizeTransitionFadeTime(state.fadeTime);
  universes = normalizeUniverses(state.universes);
  setUniverseCount(universes);
  renderOutputs();
  fromRow = state.fromRow;
  toRow = state.toRow;
  selectedRow = state.selectedRow ?? 0;
  tunes = normalizeTunes(state.tunes);
  activeTuneId = resolveActiveTune(tunes, state.activeTuneId).id;
  bindActiveTune();
  faderNames = normalizeFaderNames(state.faderNames);
  fixtureGroups = normalizeFixtureGroups(state.fixtureGroups);
  fixtures = normalizeFixtures(state.fixtures, fixtureGroups);
  if (
    fixtureFormGroupId &&
    !fixtureGroups.some((group) => group.id === fixtureFormGroupId)
  ) {
    fixtureFormGroupId = null;
  }
  patch = state.patch;

  applyNavOrder(navOrder);
  syncSetNameUi();
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
  renderFixtures();
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

/** Start a blank set called `name` (the page header asks first if there are unsaved changes). */
function newSet(name) {
  applySet(blankSetState(name));
  markClean();
  persistSession();
  setStatus(`New set · ${setName}`, dmx.connected ? "connected" : "idle");
}

/** Download the set, with the stage the show server keeps alongside it. */
async function saveSet() {
  const reply = await serverLink.request({ type: "get-stage" });
  downloadSet(currentSetState(), undefined, reply.ok ? reply.stage : null);
  markClean();
  setStatus(reply.ok ? "Set saved" : "Set saved (without the stage: the show server is offline)", dmx.connected ? "connected" : "idle");
}

/**
 * Load a set file's text (the page header asks first if there are unsaved
 * changes). Its stage, if it has one, replaces the stage; a stage file on its
 * own (from the stage's old Export) replaces just the stage.
 */
function loadSet(text, fileName) {
  try {
    const data = JSON.parse(text);
    if (data?.app === "UnnaturalLight.stage") {
      serverLink.sendStage(data);
      setStatus(`Stage loaded · ${fileName}`, dmx.connected ? "connected" : "idle");
      return;
    }
    applySet(parseSet(data));
    markClean();
    if (data.stage && typeof data.stage === "object") serverLink.sendStage(data.stage);
    setStatus(`Set loaded · ${fileName}`, dmx.connected ? "connected" : "idle");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load set";
    setStatus(message, "error");
    console.error(err);
  }
}

window.addEventListener("hashchange", routeFromHash);

fixtureForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (fixtures.length >= MAX_FIXTURES) return;
  const name = fixtureNameInput.value.trim();
  if (!name) {
    fixtureNameInput.reportValidity();
    return;
  }
  const width = Math.max(1, Math.round(fixtureFormCount) || 1);
  const qty = Math.min(
    MAX_FIXTURE_QTY,
    Math.max(1, Math.round(fixtureFormQty) || 1),
    MAX_FIXTURES - fixtures.length,
  );
  if (qty < 1) return;

  /** @type {{ channelStart: number, channelEnd: number }[]} */
  const ranges = [];
  let cursor = fixtureFormStart;
  for (let i = 0; i < qty; i++) {
    const range = normalizeChannelSpan(cursor, width);
    if (!range) {
      setStatus(
        qty > 1
          ? `Only room for ${i} of ${qty} — each fixture must fit inside one universe`
          : `Start + channel count (up to ${MAX_FIXTURE_CHANNELS}) must fit inside one universe`,
        "error",
      );
      fixtureFormStartPicker?.el.focus();
      return;
    }
    const conflict = findRangeConflict(
      fixtures,
      range.channelStart,
      range.channelEnd,
    );
    if (conflict) {
      setStatus(
        `Range overlaps ${conflict.name} (${formatChannelRange(conflict)})`,
        "error",
      );
      fixtureFormStartPicker?.el.focus();
      return;
    }
    ranges.push(range);
    cursor = range.channelEnd + 1;
  }

  const mountRadio = fixtureForm.querySelector(
    'input[name="fixtureMount"]:checked',
  );
  const colorRadio = fixtureForm.querySelector(
    'input[name="fixtureColor"]:checked',
  );
  const groupId =
    fixtureFormGroupId &&
    fixtureGroups.some((group) => group.id === fixtureFormGroupId)
      ? fixtureFormGroupId
      : null;
  const mount = normalizeMount(
    mountRadio instanceof HTMLInputElement ? mountRadio.value : "fixed",
  );
  const color = normalizeColorMode(
    colorRadio instanceof HTMLInputElement ? colorRadio.value : "single",
  );
  const names = batchFixtureNames(name, qty);
  for (let i = 0; i < qty; i++) {
    fixtures.push(
      createFixture({
        name: names[i],
        mount,
        color,
        channelStart: ranges[i].channelStart,
        channelEnd: ranges[i].channelEnd,
        groupId,
      }),
    );
  }
  fixtureFormGroupId = groupId;
  fixtureNameInput.value = "";
  renderFixtures();
  suggestFixtureFormStart();
  fixtureNameInput.focus();
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

addFixtureGroupBtn.addEventListener("click", () => {
  void addFixtureGroup();
});

addTuneBtn.addEventListener("click", () => {
  void addTune();
});

ensureFixtureFormStartPicker();
ensureFixtureFormCountPicker();
ensureFixtureFormQtyPicker();
ensureFixtureFormGroupPicker();
suggestFixtureFormStart();
wireNavReorder();
applyNavOrder(navOrder);
syncSetNameUi();
syncTuneUi();
syncTransportFromState();
renderLiveRow();
renderChannelRow();
renderSelectedGroup();
renderRows();
renderTunes();
renderFixtures();
renderPatchTable();
renderOutputs();
routeFromHash();
persistSession();
markClean();

// ---------------------------------------------------------------------
// Fixtures registered from the Stage page (see stage-link.js)
// ---------------------------------------------------------------------
// Placing a light on the stage registers it here: a console fixture at
// the next free DMX block, one fader per channel (an unnamed fader already
// patched to just that channel, else a free one) named after the light, and
// the fader rows scrolled to them. Deleting it on the stage removes it and
// frees the faders.

/**
 * @param {{ stageId: string, name: string, mount: string, color: string, labels: string[], width: number, group: string | null }[]} requests
 * @returns {{ stageId: string, ok: boolean, error?: string, consoleId?: string, start?: number, faders?: number[] }[]}
 */
function registerFromStage(requests) {
  const results = [];
  for (const req of requests) {
    const fail = (error) => results.push({ stageId: req.stageId, ok: false, error });
    const width = Math.max(1, Math.min(MAX_FIXTURE_CHANNELS, Math.round(req.width) || 1));
    if (fixtures.length >= MAX_FIXTURES) { fail(`the console already has its maximum of ${MAX_FIXTURES} fixtures`); continue; }
    const universe = Number.isInteger(req.universe) && req.universe >= 1 && req.universe <= universes ? req.universe : null;
    const range = nextAvailableRange(fixtures, width, universe);
    if (!range) { fail(`no free block of ${width} DMX channel${width > 1 ? "s" : ""} left${universe ? ` in universe ${universe}` : ""}`); continue; }
    // Per channel: a fader already patched to just that channel and still
    // default-named (e.g. a 1:1 patch) is taken over; otherwise a free one.
    const claimed = new Set();
    const spare = (i) => !claimed.has(i) && patch[i].length === 1 && faderName(i) === defaultFaderName(i);
    const faders = [];
    for (let k = 0; k < width; k++) {
      const channel = range.channelStart + k;
      let fader = patch.findIndex((targets, i) => spare(i) && targets[0].channel === channel);
      if (fader < 0) fader = patch.findIndex((targets, i) => !claimed.has(i) && isUnpatched(targets));
      if (fader < 0) break;
      claimed.add(fader);
      faders.push(fader);
    }
    if (faders.length < width) { fail(`needs ${width} free fader${width > 1 ? "s" : ""}, only ${faders.length} left`); continue; }

    let groupId = null;
    if (req.group) {
      let group = fixtureGroups.find((g) => g.name === req.group);
      if (!group && fixtureGroups.length < MAX_FIXTURE_GROUPS) {
        group = createFixtureGroup({ name: req.group });
        fixtureGroups.push(group);
      }
      groupId = group?.id ?? null;
    }
    const fixture = createFixture({
      name: req.name,
      mount: normalizeMount(req.mount),
      color: normalizeColorMode(req.color),
      channelStart: range.channelStart,
      channelEnd: range.channelEnd,
      groupId,
      roles: req.roles,
    });
    fixtures.push(fixture);
    faders.forEach((fader, k) => {
      patch[fader] = [makeTarget(range.channelStart + k, 255)];
      faderNames[fader] = `${req.name} ${req.labels[k] ?? k + 1}`.slice(0, 40);
    });
    results.push({ stageId: req.stageId, ok: true, consoleId: fixture.id, start: range.channelStart, faders: faders.map((f) => f + 1) });
  }
  if (results.some((r) => r.ok)) {
    afterStageFixturesChanged();
    revealFixtures(results.filter((r) => r.ok).map((r) => r.consoleId));
  }
  return results;
}

/** Remove stage-registered fixtures: unpatch, rename and zero their faders. */
function unregisterFromStage(consoleIds) {
  let removed = 0;
  for (const id of consoleIds) {
    const fixture = fixtures.find((item) => item.id === id);
    if (!fixture) continue;
    const inBlock = (t) => t.channel >= fixture.channelStart && t.channel <= fixture.channelEnd;
    for (let i = 0; i < FADER_COUNT; i++) {
      if (!patch[i].some(inBlock)) continue;
      patch[i] = patch[i].filter((t) => !inBlock(t));
      if (patch[i].length) continue;
      // Fader is free again: default name, 0 in every transition of every tune.
      faderNames[i] = "";
      for (const tune of tunes) for (const transition of tune.transitions) transition.levels[i] = 0;
    }
    fixtures = fixtures.filter((item) => item.id !== id);
    const { groupId } = fixture;
    if (groupId && !fixtures.some((item) => item.groupId === groupId)) {
      fixtureGroups = fixtureGroups.filter((g) => g.id !== groupId);
      if (fixtureFormGroupId === groupId) fixtureFormGroupId = null;
    }
    removed++;
  }
  if (removed) afterStageFixturesChanged();
}

function afterStageFixturesChanged() {
  renderFixtures();
  suggestFixtureFormStart();
  renderLiveRow();
  renderRows();
  renderSelectedGroup();
  renderPatchTable();
  ensureChannelRow();
  pushToDmx();
}

// Fader blocks scroll sideways (256 faders): keep them lined up, so the Live
// strip and every transition row show the same faders.
let syncingFaderScroll = false;
document.addEventListener(
  "scroll",
  (event) => {
    const el = event.target;
    if (syncingFaderScroll || !(el instanceof HTMLElement)) return;
    if (!el.classList.contains("faders") || el.classList.contains("channel-faders")) return;
    syncingFaderScroll = true;
    for (const other of document.querySelectorAll(".faders:not(.channel-faders)")) {
      if (other !== el) other.scrollLeft = el.scrollLeft;
    }
    syncingFaderScroll = false;
  },
  true,
);

// For the page header (../index.html): what it shows, and the actions it offers.
const consoleHeader = {
  state: () => ({
    setName,
    status,
    serverLive,
    serverHost: location.host,
    universes,
    maxUniverses: MAX_UNIVERSES,
    outputs: outputs.slice(0, universes).map((out) => out.connected),
  }),
  /** Call `fn` now and whenever the header's state changes; returns an unsubscribe. */
  subscribe(fn) {
    headerListeners.add(fn);
    fn();
    return () => headerListeners.delete(fn);
  },
  isDirty,
  rename: applySetName,
  newSet,
  saveSet,
  loadSet,
  toggleOutput: (u) => void toggleOutput(u),
  setUniverses,
};
window.consoleHeader = consoleHeader;
try { if (window.parent !== window) window.parent.onConsoleHeader?.(consoleHeader); } catch { /* not the same origin */ }

// Live link to the Stage page: send output levels, apply fader moves made there.
startStageLink({
  levels: computeChannelLevels,
  patch: () => patch,
  live: () => ({ rows, fromRow, toRow, fromSub, toSub, cross, master }),
  fixtures: () => fixtures,
  groups: () => fixtureGroups,
  faderInfo: () => Array.from({ length: FADER_COUNT }, (_, i) => ({
    num: i + 1,
    name: faderName(i),
    live: liveLevel(i),
    from: rows[fromRow]?.[i] ?? 0,
    to: rows[toRow]?.[i] ?? 0,
    patch: patch[i],
  })),
  mix: () => ({ master, fromSub, toSub, cross, fromName: sceneName(fromRow), toName: sceneName(toRow) }),
  universes: () => universes,
  // Which fader / channel meter / Patch card / fixture row an element
  // belongs to (for ⌥-click trace).
  traceTarget: (el) => {
    if (!(el instanceof Element)) return null;
    const card = el.closest(".patch-card[data-fader]");
    if (card) return { kind: "fader", fader: Number(card.dataset.fader) + 1 };
    const fixtureRow = el.closest(".fixture-row[data-id]");
    if (fixtureRow) return { kind: "fixture", id: fixtureRow.dataset.id };
    const wrap = el.closest(".fader");
    if (!wrap) return null;
    for (const [channel, w] of channelUi.wrapEls) if (w === wrap) return { kind: "channel", channel };
    const hit = (els) => els.findIndex((x) => x?.closest(".fader") === wrap);
    for (const els of [liveUi.valueEls, selectedGroupUi.sliders, ...rowUi.map((ui) => ui.sliders)]) {
      const i = hit(els);
      if (i >= 0) return { kind: "fader", fader: i + 1 };
    }
    return null;
  },
  afterSet: () => {
    syncSlidersFromState();
    pushToDmx();
  },
  register: registerFromStage,
  unregister: unregisterFromStage,
  reveal: revealFixtures,
});

// ---------------------------------------------------------------------
// Show server (see server-link.js): it holds the show, runs fades and
// drives the DMX; this console mirrors it and sends its edits there.
// ---------------------------------------------------------------------

const offlineCover = document.createElement("div");
offlineCover.className = "server-offline";
offlineCover.innerHTML = "<div><strong>Connecting to the show server…</strong><span>Start it with <code>./server.sh</code> on the machine the DMX USB Pro is plugged into.</span></div>";
document.body.append(offlineCover);

/** Set fields the server sent that are live values (it sends these separately). */
function withLive(set, live) {
  const state = parseSet(set);
  const current = currentSetState();
  // A live value missing here was just changed on this console: keep ours.
  for (const f of LIVE_FIELDS) state[f] = f in live ? live[f] : current[f];
  return state;
}

/** Live mix from the server (fade steps, other consoles' moves, GO arriving). */
function applyServerLive(live) {
  const before = { fromRow, selectedRow };
  if ("master" in live) master = live.master;
  if ("cross" in live) cross = live.cross;
  if ("fromSub" in live) fromSub = live.fromSub;
  if ("toSub" in live) toSub = live.toSub;
  if ("fadeTime" in live) fadeTime = live.fadeTime;
  if ("fromRow" in live) fromRow = live.fromRow;
  if ("selectedRow" in live) selectedRow = live.selectedRow;
  syncPlaybackPair();
  if ("masterBlackoutSnapshot" in live) masterBlackoutSnapshot = live.masterBlackoutSnapshot;
  if ("fromSubBlackoutSnapshot" in live) fromSubBlackoutSnapshot = live.fromSubBlackoutSnapshot;
  if ("toSubBlackoutSnapshot" in live) toSubBlackoutSnapshot = live.toSubBlackoutSnapshot;
  fadeState = live.fade ?? null;
  serverFlashing = new Set(live.flashing ?? []);
  serverBlackedOut = new Set(live.blackedOut ?? []);

  syncMasterUi();
  syncSubmasterUi();
  syncCrossUi();
  updateFadePauseButton();
  if (fromRow !== before.fromRow || selectedRow !== before.selectedRow) showArrivedCue();
  pushToDmx({ persist: false, fromServer: true });
}

serverLink = createServerLink({
  view: () => ({
    set: currentSetState(),
    snapshots: { masterBlackoutSnapshot, fromSubBlackoutSnapshot, toSubBlackoutSnapshot },
    flashing: flashingFaders,
    blackedOut: blackedOutFaders,
  }),
  onHello: ({ set, live, outputs: list }) => {
    outputStatus = list ?? [];
    if (set) {
      applySet(withLive(set, live ?? {}), { fromServer: true });
      applyServerLive(live ?? {});
      markClean();
    }
    renderOutputs();
  },
  onSet: (set, live) => {
    applySet(withLive(set, live), { fromServer: true });
    applyServerLive(live);
  },
  onLive: applyServerLive,
  onLevels: (cells) => {
    if (!cells.length) return;
    const byId = new Map();
    for (const tune of tunes) for (const t of tune.transitions) byId.set(t.id, t);
    for (const [id, fader, value] of cells) {
      const t = byId.get(id);
      if (t) t.levels[fader] = value;
    }
    pushToDmx({ fromServer: true });
  },
  onOutputs: (list) => {
    outputStatus = list;
    renderOutputs();
  },
  onConnection: (connected) => {
    offlineCover.classList.toggle("is-connected", connected);
    serverLive = connected;
    renderOutputs();
    if (connected) {
      // The Server pill shows the connection; clear an "offline" message.
      setStatus("", "idle");
    } else {
      setStatus("Show server offline — reconnecting…", "error");
    }
  },
});

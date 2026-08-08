import { EnttecDmxPro } from "./dmx.js";
import {
  FADER_COUNT,
  CHANNEL_METER_COUNT,
  MIN_ROWS,
  MAX_ROWS,
  identityPatch,
  loadPatch,
  savePatch,
  defaultPatch,
  formatChannelLabel,
  formatChannelTooltip,
  makeTarget,
  scaledLevel,
} from "./patch.js";
import {
  configSnapshot,
  defaultFaderName,
  defaultSceneName,
  downloadConfig,
  FADE_TIMES,
  loadSession,
  normalizeFaderNames,
  normalizeSceneNames,
  parseConfig,
  saveSession,
} from "./config.js";

const dmx = new EnttecDmxPro();

function zeros() {
  return new Array(FADER_COUNT).fill(0);
}

function initialState() {
  const session = loadSession();
  if (session) return session;
  return {
    master: 100,
    cross: 0,
    fadeTime: 4,
    fromRow: 0,
    toRow: 1,
    selectedRow: 0,
    rows: [zeros(), zeros()],
    names: [defaultSceneName(0), defaultSceneName(1)],
    faderNames: normalizeFaderNames(null),
    patch: loadPatch(),
  };
}

const boot = initialState();
/** @type {number[][]} */
let rows = boot.rows;
/** @type {string[]} */
let names = normalizeSceneNames(boot.names, rows.length);
/** @type {string[]} */
let faderNames = normalizeFaderNames(boot.faderNames);
let patch = boot.patch;
let master = boot.master;
let cross = boot.cross; // 0 = full From, 100 = full To
let fadeTime = FADE_TIMES.includes(boot.fadeTime) ? boot.fadeTime : 4;
let fromRow = boot.fromRow;
let toRow = boot.toRow;
let selectedRow = boot.selectedRow ?? 0;
/** @type {number} */
let selectedFader = 0;
/** @type {number | null} */
let fadeRaf = null;
/** @type {null | { start: number, target: number, durationMs: number, startedAt: number, pausedAt: number | null }} */
let fadeState = null;

const rowsEl = document.getElementById("rows");
const liveFadersEl = document.getElementById("liveFaders");
const channelLevelsEl = document.getElementById("channelLevels");
const selectedGroupFadersEl = document.getElementById("selectedGroupFaders");
/** @type {HTMLElement} */
let currentSceneTitle = document.getElementById("currentSceneTitle");
const scenesBtn = document.getElementById("scenesBtn");
const sceneMenu = document.getElementById("sceneMenu");
const sceneMenuList = document.getElementById("sceneMenuList");
const sceneRowMenu = document.getElementById("sceneRowMenu");
const sceneRowMenuList = document.getElementById("sceneRowMenuList");
const faderNameMenu = document.getElementById("faderNameMenu");
const faderNameMenuList = document.getElementById("faderNameMenuList");
const patchTableEl = document.getElementById("patchTable");
const patchConflictsEl = document.getElementById("patchConflicts");
const connectBtn = document.getElementById("connectBtn");
const blackoutBtn = document.getElementById("blackoutBtn");
const statusEl = document.getElementById("status");
const masterInput = document.getElementById("master");
const masterValue = document.getElementById("masterValue");
const crossfader = document.getElementById("crossfader");
const crossValue = document.getElementById("crossValue");
const crossFrom = document.getElementById("crossFrom");
const crossTo = document.getElementById("crossTo");
const crossFromLabel = document.getElementById("crossFromLabel");
const crossToLabel = document.getElementById("crossToLabel");
const fadeTimeBtns = document.getElementById("fadeTimeBtns");
const fadePauseBtn = document.getElementById("fadePauseBtn");
const addRowBtn = document.getElementById("addRowBtn");
const removeRowBtn = document.getElementById("removeRowBtn");
const identityBtn = document.getElementById("identityBtn");
const clearPatchBtn = document.getElementById("clearPatchBtn");
const saveBtn = document.getElementById("saveBtn");
const loadBtn = document.getElementById("loadBtn");
const loadFile = document.getElementById("loadFile");
const dirtyDialog = document.getElementById("dirtyDialog");
const confirmDialog = document.getElementById("confirmDialog");
const confirmTitle = document.getElementById("confirmTitle");
const confirmMessage = document.getElementById("confirmMessage");
const confirmConfirmBtn = document.getElementById("confirmConfirmBtn");
const sceneNameDialog = document.getElementById("sceneNameDialog");
const sceneNameForm = document.getElementById("sceneNameForm");
const sceneNameDialogTitle = document.getElementById("sceneNameDialogTitle");
const sceneNameInput = document.getElementById("sceneNameInput");
const sceneNameConfirmBtn = document.getElementById("sceneNameConfirmBtn");
const channelMenu = document.getElementById("channelMenu");
const channelMenuFilter = document.getElementById("channelMenuFilter");
const channelMenuList = document.getElementById("channelMenuList");
const channelMenuSub = document.getElementById("channelMenuSub");
const channelMenuSubList = document.getElementById("channelMenuSubList");
const channelMenuSubLabel = document.getElementById("channelMenuSubLabel");
const CHANNEL_GROUP_SIZE = 32;
const CHANNEL_GROUP_COUNT = Math.ceil(512 / CHANNEL_GROUP_SIZE);
const pageFaders = document.getElementById("page-faders");
const pageChannels = document.getElementById("page-channels");
const pagePatch = document.getElementById("page-patch");
const navLinks = document.querySelectorAll(".nav-link");
const pages = {
  faders: pageFaders,
  channels: pageChannels,
  patch: pagePatch,
};

/** Snapshot of last explicitly saved/loaded config (or boot state). */
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

function sceneName(index) {
  const name = names[index];
  if (typeof name === "string" && name.trim()) return name.trim();
  return defaultSceneName(index);
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
}

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

/** Live fader level after crossfade + master (0–255), before per-channel max */
function liveLevel(faderIndex) {
  const a = rows[fromRow][faderIndex];
  const b = rows[toRow][faderIndex];
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
  saveSession(currentConfigState());
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

  for (const select of [crossFrom, crossTo]) {
    const current = select === crossFrom ? fromRow : toRow;
    select.replaceChildren();
    for (let r = 0; r < rows.length; r++) {
      const opt = document.createElement("option");
      opt.value = String(r);
      opt.textContent = sceneName(r);
      select.append(opt);
    }
    select.value = String(Math.min(current, rows.length - 1));
  }
  fromRow = Number(crossFrom.value);
  toRow = Number(crossTo.value);
  crossFromLabel.textContent = sceneName(fromRow);
  crossToLabel.textContent = sceneName(toRow);
  removeRowBtn.disabled = rows.length <= MIN_ROWS;
  removeRowBtn.setAttribute("aria-label", `Remove scene ${sceneName(selectedRow)}`);
  removeRowBtn.title = `Remove scene ${sceneName(selectedRow)}`;
  addRowBtn.disabled = rows.length >= MAX_ROWS;
  updateScenesButton();
}

function updateScenesButton() {
  if (currentSceneTitle) currentSceneTitle.textContent = sceneName(selectedRow);
}

function setSelectedRow(index) {
  if (index < 0 || index >= rows.length) return;
  selectedRow = index;
  for (const bank of rowsEl.querySelectorAll(".fader-row")) {
    const r = Number(bank.dataset.row);
    const selected = r === selectedRow;
    bank.classList.toggle("is-selected", selected);
    const head = bank.querySelector(".fader-row-head");
    if (head) head.setAttribute("aria-pressed", selected ? "true" : "false");
  }
  removeRowBtn.setAttribute("aria-label", `Remove scene ${sceneName(selectedRow)}`);
  removeRowBtn.title = `Remove scene ${sceneName(selectedRow)}`;
  updateScenesButton();
  renderSelectedGroup();
  persistSession();
}

/**
 * @param {{ anchor: HTMLElement }} opts
 * @returns {Promise<number | null>}
 */
function pickScene({ anchor }) {
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
      document.removeEventListener("pointerdown", onDocPointer, true);
      document.removeEventListener("keydown", onDocKeydown, true);
    };

    renderList();
    sceneMenu.hidden = false;

    const anchorRect = anchor.getBoundingClientRect();
    const menuWidth = 168;
    const menuHeight = 280;
    let left = anchorRect.left;
    let top = anchorRect.bottom + 6;
    if (left + menuWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuWidth - 8);
    }
    if (top + menuHeight > window.innerHeight - 8) {
      top = Math.max(8, anchorRect.top - menuHeight - 6);
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
    slider.addEventListener("input", () => {
      setSelectedFader(i);
      rows[selectedRow][i] = Number(slider.value);
      value.textContent = String(rows[selectedRow][i]);
      // Keep Faders-page UI in sync if that scene is rendered
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
  }
}

function adjustIndexAfterRemove(index, removed, lengthAfter) {
  if (index > removed) return index - 1;
  if (index === removed) return Math.min(removed, lengthAfter - 1);
  return index;
}

function renderRows() {
  abortInlineEdits();
  rowsEl.replaceChildren();
  rowUi = [];
  selectedRow = Math.min(Math.max(0, selectedRow), Math.max(0, rows.length - 1));

  for (let r = 0; r < rows.length; r++) {
    const bank = document.createElement("section");
    bank.className = "fader-row";
    bank.dataset.row = String(r);
    bank.classList.toggle("is-selected", r === selectedRow);

    const head = document.createElement("div");
    head.className = "fader-row-head";
    head.tabIndex = 0;
    head.setAttribute("role", "button");
    head.setAttribute("aria-pressed", r === selectedRow ? "true" : "false");
    head.title = "Click to select this scene";

    const titleGroup = document.createElement("div");
    titleGroup.className = "scene-title-group";

    const title = document.createElement("h3");
    title.className = "scene-title";
    title.textContent = sceneName(r);
    title.title = "Double-click to rename";

    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "scene-menu-btn";
    menuBtn.innerHTML = '<span class="scene-menu-dots" aria-hidden="true"></span>';
    menuBtn.title = "Scene options";
    menuBtn.setAttribute("aria-label", `Options for ${sceneName(r)}`);
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

    const hint = document.createElement("span");
    hint.className = "fader-row-hint";
    hint.textContent = "Click to select";

    head.append(titleGroup, hint);
    head.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest(".scene-title-input")) return;
      setSelectedRow(r);
    });
    head.addEventListener("keydown", (event) => {
      if (event.target instanceof HTMLInputElement) return;
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

/**
 * @param {{ anchor: HTMLElement, current: number }} opts
 * @returns {Promise<number | null>}
 */
function pickChannel({ anchor, current }) {
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
      channelMenuFilter.removeEventListener("input", onFilterInput);
      channelMenuFilter.removeEventListener("keydown", onFilterKeydown);
      document.removeEventListener("pointerdown", onDocPointer, true);
      document.removeEventListener("keydown", onDocKeydown, true);
    };

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

        const channelBtn = document.createElement("button");
        channelBtn.type = "button";
        channelBtn.className = "patch-ch-btn";
        channelBtn.textContent = `Ch${target.channel}`;
        channelBtn.title = "Change DMX channel";
        channelBtn.setAttribute("aria-label", `${faderName(i)} channel ${target.channel}, click to change`);
        channelBtn.addEventListener("click", async (event) => {
          event.stopPropagation();
          const channel = await pickChannel({
            anchor: channelBtn,
            current: target.channel,
          });
          if (channel == null) return;
          assignChannelToFader(i, targetIndex, channel);
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

        cell.append(channelBtn, maxValue, maxSlider, removeBtn);
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

function setCross(value, { fromUser = false, persist = true } = {}) {
  cross = Math.max(0, Math.min(100, value));
  syncCrossUi();
  if (fromUser) stopTimedFade();
  pushToDmx({ persist });
}

function updateFadeTimeButtons() {
  for (const btn of fadeTimeBtns.querySelectorAll("button[data-fade]")) {
    btn.classList.toggle("is-active", Number(btn.dataset.fade) === fadeTime);
  }
}

function updateFadePauseButton() {
  const running = fadeState != null;
  const paused = running && fadeState.pausedAt != null;
  fadePauseBtn.disabled = !running;
  fadePauseBtn.textContent = paused ? "Resume" : "Pause";
  fadePauseBtn.classList.toggle("is-paused", paused);
}

function stopTimedFade() {
  if (fadeRaf != null) {
    cancelAnimationFrame(fadeRaf);
    fadeRaf = null;
  }
  fadeState = null;
  updateFadePauseButton();
}

function startTimedFade(seconds) {
  fadeTime = seconds;
  updateFadeTimeButtons();

  const start = cross;
  const target = start >= 99.5 ? 0 : 100;
  const distance = Math.abs(target - start);
  if (distance < 0.05) {
    persistSession();
    return;
  }

  if (fadeRaf != null) cancelAnimationFrame(fadeRaf);

  fadeState = {
    start,
    target,
    durationMs: (fadeTime * distance) / 100 * 1000,
    startedAt: performance.now(),
    pausedAt: null,
  };
  updateFadePauseButton();
  fadeRaf = requestAnimationFrame(tickTimedFade);
  persistSession();
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
    const end = fadeState.target;
    fadeRaf = null;
    fadeState = null;
    setCross(end);
    updateFadePauseButton();
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

function currentConfigState() {
  return { master, cross, fadeTime, fromRow, toRow, selectedRow, rows, names, faderNames, patch };
}

function markClean() {
  cleanSnapshot = configSnapshot(currentConfigState());
}

function isDirty() {
  return configSnapshot(currentConfigState()) !== cleanSnapshot;
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
    title: "Remove scene?",
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
  if (!next || next === sceneName(index)) return false;
  names[index] = next;
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
  input.setAttribute("aria-label", "Scene name");
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

async function removeSceneAt(index) {
  if (rows.length <= MIN_ROWS) return false;
  if (index < 0 || index >= rows.length) return false;
  const ok = await confirmRemoveScene(sceneName(index));
  if (!ok) return false;
  rows.splice(index, 1);
  names.splice(index, 1);
  fromRow = adjustIndexAfterRemove(fromRow, index, rows.length);
  toRow = adjustIndexAfterRemove(toRow, index, rows.length);
  selectedRow = adjustIndexAfterRemove(selectedRow, index, rows.length);
  if (fromRow === toRow) toRow = (fromRow + 1) % rows.length;
  renderRows();
  renderSelectedGroup();
  pushToDmx();
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
      disabled: rows.length <= MIN_ROWS,
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
  blackoutBtn.disabled = !connected;
}

function showPage(name) {
  const page = pages[name] ? name : "faders";
  abortInlineEdits();

  for (const [key, el] of Object.entries(pages)) {
    const active = key === page;
    el.hidden = !active;
    el.classList.toggle("is-active", active);
  }

  for (const link of navLinks) {
    link.classList.toggle("is-active", link.dataset.page === page);
  }

  if (page === "patch") renderPatchTable();
  if (page === "channels") {
    refreshChannelRow();
    renderSelectedGroup();
  }
}

function routeFromHash() {
  const hash = location.hash.replace("#", "");
  if (hash === "patch" || hash === "channels") showPage(hash);
  else showPage("faders");
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

blackoutBtn.addEventListener("click", () => {
  for (const row of rows) row.fill(0);
  syncSlidersFromState();
  dmx.blackout();
  refreshLiveRow();
  refreshChannelRow();
  persistSession();
});

masterInput.addEventListener("input", () => {
  master = Number(masterInput.value);
  masterValue.textContent = `${master}%`;
  pushToDmx();
});

crossfader.addEventListener("input", () => {
  setCross(Number(crossfader.value), { fromUser: true });
});

fadeTimeBtns.addEventListener("click", (event) => {
  const btn = event.target instanceof Element ? event.target.closest("button[data-fade]") : null;
  if (!btn) return;
  startTimedFade(Number(btn.dataset.fade));
});

fadePauseBtn.addEventListener("click", () => {
  toggleFadePause();
});

crossFrom.addEventListener("change", () => {
  stopTimedFade();
  fromRow = Number(crossFrom.value);
  if (fromRow === toRow) {
    toRow = (fromRow + 1) % rows.length;
    crossTo.value = String(toRow);
  }
  crossFromLabel.textContent = sceneName(fromRow);
  crossToLabel.textContent = sceneName(toRow);
  pushToDmx();
});

crossTo.addEventListener("change", () => {
  stopTimedFade();
  toRow = Number(crossTo.value);
  if (toRow === fromRow) {
    fromRow = (toRow + 1) % rows.length;
    crossFrom.value = String(fromRow);
  }
  crossFromLabel.textContent = sceneName(fromRow);
  crossToLabel.textContent = sceneName(toRow);
  pushToDmx();
});

scenesBtn.addEventListener("click", async (event) => {
  event.stopPropagation();
  const index = await pickScene({ anchor: scenesBtn });
  if (index == null) return;
  setSelectedRow(index);
});

wireCurrentSceneTitle(currentSceneTitle);

addRowBtn.addEventListener("click", async () => {
  if (rows.length >= MAX_ROWS) return;
  const name = await promptName({
    title: "New scene",
    confirmLabel: "Add",
    initial: defaultSceneName(rows.length),
  });
  if (!name) return;
  if (rows.length >= MAX_ROWS) return;
  rows.push(zeros());
  names.push(name);
  selectedRow = rows.length - 1;
  renderRows();
  renderSelectedGroup();
  pushToDmx();
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

function applyConfig(state) {
  stopTimedFade();
  master = state.master;
  cross = state.cross;
  fadeTime = FADE_TIMES.includes(state.fadeTime) ? state.fadeTime : 4;
  fromRow = state.fromRow;
  toRow = state.toRow;
  selectedRow = state.selectedRow ?? 0;
  rows = state.rows;
  names = normalizeSceneNames(state.names, rows.length);
  faderNames = normalizeFaderNames(state.faderNames);
  patch = state.patch;

  masterInput.value = String(master);
  masterValue.textContent = `${master}%`;
  syncCrossUi();
  updateFadeTimeButtons();
  updateFadePauseButton();

  renderRows();
  renderLiveRow();
  renderChannelRow();
  renderSelectedGroup();
  renderPatchTable();
  pushToDmx();
}

function syncTransportFromState() {
  masterInput.value = String(master);
  masterValue.textContent = `${master}%`;
  syncCrossUi();
  updateFadeTimeButtons();
  updateFadePauseButton();
}

saveBtn.addEventListener("click", () => {
  downloadConfig(currentConfigState());
  markClean();
  setStatus("Config saved", dmx.connected ? "connected" : "idle");
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
    applyConfig(parseConfig(data));
    markClean();
    setStatus(`Loaded ${file.name}`, dmx.connected ? "connected" : "idle");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load config";
    setStatus(message, "error");
    console.error(err);
  }
});

window.addEventListener("hashchange", routeFromHash);

syncTransportFromState();
renderLiveRow();
renderChannelRow();
renderSelectedGroup();
renderRows();
renderPatchTable();
routeFromHash();
persistSession();
markClean();

if (!("serial" in navigator)) {
  connectBtn.disabled = true;
  setStatus("Web Serial unavailable — use Chrome/Edge on localhost", "error");
}

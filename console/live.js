// Live: output levels, the Live strip and channel meters, LIVE / UP NEXT,
// GO, crossfade, submasters and master, and the DMX output.
import { notifyStage } from "./stage-link.js";
import { computeChannelLevels as channelLevelsFor } from "../shared/engine.js";
import {
  FADER_COUNT,
  CHANNEL_METER_COUNT,
  formatChannelLabel,
  formatChannelTooltip,
  UNIVERSE_SIZE,
  MAX_UNIVERSES,
  universeStart,
  formatAddress,
} from "./patch.js";
import { DEFAULT_CUE_FADE_TIME, MAX_CUES } from "./songs.js";
import { playbackCue } from "./sets.js";
import {
  cuesEl,
  liveFadersEl,
  channelLevelsEl,
  selectedGroupFadersEl,
  currentCueTitle,
  cuePicker,
  cuePickerList,
  channelsCueMenuBtn,
  blackoutBtn,
  fromSubInput,
  fromSubValue,
  fromSubLabel,
  fromSubBlackoutBtn,
  toSubInput,
  toSubValue,
  toSubLabel,
  toSubBlackoutBtn,
  crossfader,
  crossValue,
  crossFromLabel,
  crossToLabel,
  goBtn,
  goNextFade,
  fadePauseBtn,
  addCueBtn,
  placePopup,
} from "./dom.js";
import { zeros, syncPlaybackPair, persistSession, state } from "./state.js";
import {
  cueName,
  cueLabel,
  fillCueTitle,
  faderName,
  setSelectedFader,
  makeFaderNameLabel,
  closeFaderNameMenu,
  isUnpatched,
  setText,
  setValue,
  setTitle,
  setFill,
  applyFaderPatchState,
  liveLevel,
  refreshLiveRow,
  refreshDimmerButtons,
  addColorBars,
  refreshColorBars,
  refreshFaderPatchLabels,
  syncSlidersFromState,
} from "./faders.js";
import { syncSongUi } from "./show-page.js";
import { cueUi, closeChannelsCueMenu, renderCues, closeActionMenu } from "./cues.js";
import {
  updateConflictBanner,
  closeChannelPicker,
  closeCountPicker,
  closeFixtureGroupPicker,
} from "./patch-page.js";

/**
 * Each universe's outputs from the show server (index 0 = universe 1): a DMX
 * USB Pro plugged into its machine, and / or an Art-Net or sACN node.
 */
export const outputs = Array.from({ length: MAX_UNIVERSES }, (_, i) => ({
  /** The DMX USB Pro is connected. */
  get connected() {
    return state.outputStatus[i]?.connected ?? false;
  },
  /** The network output ("Art-Net 0 → 192.168.1.50"), or null. */
  get network() {
    return state.outputStatus[i]?.network ?? null;
  },
  /** @param {{ protocol: "artnet" | "sacn", netUniverse?: number, host?: string } | null} output null stops it */
  async setNetwork(output) {
    const reply = await state.serverLink.request({ type: "net-set", universe: i + 1, output });
    if (!reply.ok) throw new Error(reply.error ?? "Couldn't set the network output");
  },
  async connect() {
    const reply = await state.serverLink.request({ type: "dmx-connect", universe: i + 1 });
    if (!reply.ok) throw new Error(reply.error ?? "Connection failed");
  },
  async disconnect() {
    await state.serverLink.request({ type: "dmx-disconnect", universe: i + 1 });
  },
}));
/** Universe 1's output (status messages ask whether it's connected). */
export const dmx = outputs[0];
/** @type {{ valueEls: HTMLElement[], patchLabelEls: HTMLElement[], fillEls: HTMLElement[] }} */
export let liveUi = { valueEls: [], patchLabelEls: [], fillEls: [] };
/** @type {{ channels: number[], valueEls: Map<number, HTMLElement>, fillEls: Map<number, HTMLElement>, wrapEls: Map<number, HTMLElement> }} */
export let channelUi = { channels: [], valueEls: new Map(), fillEls: new Map(), wrapEls: new Map() };
let channelRowKey = "";
/** @type {{ valueEls: HTMLElement[], patchLabelEls: HTMLElement[], sliders: HTMLInputElement[] }} */
export let selectedGroupUi = { valueEls: [], patchLabelEls: [], sliders: [] };

// Dimmer-fader overrides (output only, not saved), both momentary: while
// held, blackout puts a fader's output at 0 and flash puts it at full.
// These are the ones held on this console (state.serverBlackedOut and
// state.serverFlashing: on any console).
export const blackedOutFaders = new Set();
export const flashingFaders = new Set();
export const isFlashing = (i) => flashingFaders.has(i) || state.serverFlashing.has(i);
export const isBlackedOut = (i) => blackedOutFaders.has(i) || state.serverBlackedOut.has(i);

/** What a fader actually sends: its live level, unless flashed (full) or blacked out (0). */
export function outputLevel(i) {
  if (isFlashing(i)) return 255;
  if (isBlackedOut(i)) return 0;
  return liveLevel(i);
}

export function computeChannelLevels() {
  return channelLevelsFor(state.patch, outputLevel);
}

function patchedChannelSet() {
  const set = new Set();
  for (const targets of state.patch) {
    for (const target of targets) set.add(target.channel);
  }
  return set;
}

/** Channels shown on the Channels tab: 1–256 of the chosen universe, plus any higher patched channels in it. */
function displayedChannels() {
  const patched = patchedChannelSet();
  const first = universeStart(state.meterUniverse);
  const lastInUniverse = first + UNIVERSE_SIZE - 1;
  let highest = first + CHANNEL_METER_COUNT - 1;
  for (const channel of patched) {
    if (channel > highest && channel <= lastInUniverse) highest = channel;
  }
  return Array.from({ length: highest - first + 1 }, (_, i) => first + i);
}

export function refreshChannelRow() {
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

export function renderChannelRow() {
  const channels = displayedChannels();
  const patched = patchedChannelSet();
  channelRowKey = `${state.meterUniverse}:${state.universes}:${channels.length}:${[...patched].sort((a, b) => a - b).join(",")}`;
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

export function ensureChannelRow() {
  const patched = patchedChannelSet();
  const channels = displayedChannels();
  const key = `${state.meterUniverse}:${state.universes}:${channels.length}:${[...patched].sort((a, b) => a - b).join(",")}`;
  if (key !== channelRowKey) renderChannelRow();
}

/**
 * Show the new output here and send the change to the show server (which
 * drives the DMX). `fromServer`: the change came from the server, so redraw
 * at the next frame (a burst of messages costs one redraw, and a hidden
 * window waits until it's shown) and let the stage link's leader pass it on.
 */
export function pushToDmx({ persist = true, fromServer = false } = {}) {
  state.serverLink?.sync();
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

export function renderLiveRow() {
  liveFadersEl.replaceChildren();
  const valueEls = [];
  const patchLabelEls = [];
  const fillEls = [];

  for (let i = 0; i < FADER_COUNT; i++) {
    const wrap = document.createElement("div");
    wrap.className = "fader live-fader";
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

export function refreshCueSelects() {
  state.selectedCue = Math.min(Math.max(0, state.selectedCue), state.cueLevels.length - 1);
  syncPlaybackPair();
  fillCueTitle(crossFromLabel, state.fromCue);
  if (state.toCue === state.fromCue) {
    // Nothing up next: the set's last song's last cue.
    crossToLabel.textContent = "End of set";
  } else {
    fillCueTitle(crossToLabel, state.toCue);
  }
  goBtn.disabled = state.toCue === state.fromCue;
  const nextFade = playbackCue(state, state.toCue)?.fadeTime ?? DEFAULT_CUE_FADE_TIME;
  goNextFade.textContent = state.toCue === state.fromCue ? "" : `${nextFade}s`;
  goBtn.title = `GO — fade to ${cueLabel(state.toCue)} (${nextFade}s)`;
  goBtn.setAttribute(
    "aria-label",
    `GO to ${cueLabel(state.toCue)} in ${nextFade} seconds`,
  );
  syncSubmasterLabels();
  addCueBtn.disabled = state.cueLevels.length >= MAX_CUES;
  updateCuesButton();
  syncSongUi();
}

/** Cue the cues button last showed (it's refreshed on every change; redrawing it each time would also close a rename in progress). */
let cuesButtonKey = "";

export function updateCuesButton() {
  if (!currentCueTitle) return;
  const key = `${state.selectedCue}|${cueName(state.selectedCue)}`;
  if (key === cuesButtonKey) return;
  cuesButtonKey = key;
  fillCueTitle(currentCueTitle, state.selectedCue, true);
  currentCueTitle.title = "Click to rename";
  channelsCueMenuBtn.setAttribute(
    "aria-label",
    `Options for ${cueLabel(state.selectedCue)}`,
  );
  channelsCueMenuBtn.title = `Options for ${cueLabel(state.selectedCue)}`;
}

/** Label at the top right of a cue: LIVE, UP NEXT, or how to make it live. */
export function cueHint(r) {
  return r === state.fromCue ? "Live" : r === state.toCue ? "Up next" : "Click to make live";
}

export function setSelectedCue(index) {
  if (index < 0 || index >= state.cueLevels.length) return;
  stopTimedFade();
  state.selectedCue = index;
  // Selecting a cue makes it LIVE; UP NEXT follows from it (and the set).
  state.fromCue = index;
  syncPlaybackPair();
  for (const bank of cuesEl.querySelectorAll(".fader-row")) {
    const r = Number(bank.dataset.row);
    const selected = r === state.selectedCue;
    bank.classList.toggle("is-selected", selected);
    bank.classList.toggle("is-current", r === state.fromCue);
    bank.classList.toggle("is-next", r === state.toCue);
    const hint = bank.querySelector(".fader-row-hint");
    if (hint) hint.textContent = cueHint(r);
    const head = bank.querySelector(".fader-row-head");
    if (head) head.setAttribute("aria-pressed", selected ? "true" : "false");
  }
  refreshCueSelects();
  renderSelectedGroup();
  pushToDmx();
}

/** @type {null | (() => void)} */
export let closeCuePicker = null;

/**
 * @param {{ anchor: HTMLElement, clientX?: number, clientY?: number }} opts
 * @returns {Promise<number | null>}
 */
export function pickCue({ anchor, clientX, clientY }) {
  closeCuePicker?.();
  closeChannelsCueMenu?.();
  closeActionMenu?.();
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
      cuePickerList.replaceChildren();
      for (let r = 0; r < state.cueLevels.length; r++) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "menu-item";
        if (r === state.selectedCue) item.classList.add("is-current");
        item.setAttribute("role", "menuitem");
        item.textContent = cueLabel(r);
        item.addEventListener("click", (event) => {
          event.stopPropagation();
          finish(r);
        });
        cuePickerList.append(item);
      }
      const currentEl = cuePickerList.querySelector(".is-current");
      if (currentEl) currentEl.scrollIntoView({ block: "nearest" });
    };

    const onDocPointer = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (cuePicker.contains(target) || anchor.contains(target)) return;
      finish(null);
    };

    const onDocKeydown = (event) => {
      if (event.key === "Escape") finish(null);
    };

    const cleanup = () => {
      cuePicker.hidden = true;
      if (closeCuePicker === finishNull) closeCuePicker = null;
      document.removeEventListener("pointerdown", onDocPointer, true);
      document.removeEventListener("keydown", onDocKeydown, true);
    };

    const finishNull = () => finish(null);
    closeCuePicker = finishNull;

    renderList();
    cuePicker.hidden = false;

    const anchorRect = anchor.getBoundingClientRect();
    placePopup(cuePicker, clientX ?? anchorRect.left, clientY ?? anchorRect.bottom + 6, clientY ?? anchorRect.top);

    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onDocKeydown, true);
  });
}

export function renderSelectedGroup() {
  state.selectedCue = Math.min(Math.max(0, state.selectedCue), Math.max(0, state.cueLevels.length - 1));
  updateCuesButton();
  selectedGroupFadersEl.replaceChildren();

  const valueEls = [];
  const patchLabelEls = [];
  const sliders = [];
  const row = state.cueLevels[state.selectedCue] ?? zeros();

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
    value.textContent = String(row[i]);
    valueEls[i] = value;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "255";
    slider.value = String(row[i]);
    slider.setAttribute("aria-label", `${cueLabel(state.selectedCue)} ${faderName(i)}`);
    applyFaderPatchState(wrap, slider, state.patch[i]);
    slider.addEventListener("input", () => {
      setSelectedFader(i);
      state.cueLevels[state.selectedCue][i] = Number(slider.value);
      value.textContent = String(state.cueLevels[state.selectedCue][i]);
      // Keep the Run page UI in sync if that cue is rendered
      if (cueUi[state.selectedCue]) {
        cueUi[state.selectedCue].sliders[i].value = String(state.cueLevels[state.selectedCue][i]);
        cueUi[state.selectedCue].valueEls[i].textContent = String(state.cueLevels[state.selectedCue][i]);
      }
      pushToDmx();
    });
    sliders[i] = slider;

    wrap.append(label, patched, value, slider);
    selectedGroupFadersEl.append(wrap);
  }

  addColorBars(selectedGroupFadersEl, state.selectedCue);
  selectedGroupUi = { valueEls, patchLabelEls, sliders };
  refreshColorBars();
}

export function refreshSelectedGroup() {
  if (!selectedGroupUi.sliders.length) return;
  const row = state.cueLevels[state.selectedCue];
  if (!row) return;
  updateCuesButton();
  for (let i = 0; i < FADER_COUNT; i++) {
    setValue(selectedGroupUi.sliders[i], String(row[i]));
    setText(selectedGroupUi.valueEls[i], String(row[i]));
    setText(selectedGroupUi.patchLabelEls[i], formatChannelLabel(state.patch[i]));
    setTitle(selectedGroupUi.patchLabelEls[i], formatChannelTooltip(state.patch[i]));
    selectedGroupUi.patchLabelEls[i].classList.toggle("is-unpatched", isUnpatched(state.patch[i]));
    const wrap = selectedGroupUi.sliders[i].closest(".fader");
    if (wrap instanceof HTMLElement) {
      applyFaderPatchState(wrap, selectedGroupUi.sliders[i], state.patch[i]);
    }
  }
}

export function persistAndRefresh() {
  refreshFaderPatchLabels();
  updateConflictBanner();
  ensureChannelRow();
  pushToDmx();
}

export function syncCrossUi() {
  const pct = Math.round(state.cross);
  crossfader.value = String(pct);
  crossfader.style.setProperty("--cross-pct", `${pct}%`);
  crossValue.textContent = `${pct}%`;
}

export function syncBlackoutButtons() {
  const masterLatched = state.masterBlackoutSnapshot != null;
  blackoutBtn.classList.toggle("is-blackout", masterLatched);
  blackoutBtn.title = masterLatched ? "Restore" : "Blackout";
  blackoutBtn.setAttribute("aria-label", masterLatched ? "Restore" : "Blackout");

  const fromLatched = state.fromSubBlackoutSnapshot != null;
  fromSubBlackoutBtn.classList.toggle("is-blackout", fromLatched);
  fromSubBlackoutBtn.title = fromLatched
    ? `Restore ${cueLabel(state.fromCue)}`
    : `Blackout ${cueLabel(state.fromCue)}`;
  fromSubBlackoutBtn.setAttribute("aria-label", fromSubBlackoutBtn.title);

  const toLatched = state.toSubBlackoutSnapshot != null;
  toSubBlackoutBtn.classList.toggle("is-blackout", toLatched);
  toSubBlackoutBtn.title = toLatched
    ? `Restore ${cueLabel(state.toCue)}`
    : `Blackout ${cueLabel(state.toCue)}`;
  toSubBlackoutBtn.setAttribute("aria-label", toSubBlackoutBtn.title);
}

export function clearBlackoutSnapshots() {
  state.masterBlackoutSnapshot = null;
  state.fromSubBlackoutSnapshot = null;
  state.toSubBlackoutSnapshot = null;
  syncBlackoutButtons();
}

function syncSubmasterLabels() {
  fromSubLabel.textContent = cueLabel(state.fromCue);
  toSubLabel.textContent = cueLabel(state.toCue);
  fromSubInput.setAttribute("aria-label", `${cueLabel(state.fromCue)} submaster`);
  toSubInput.setAttribute("aria-label", `${cueLabel(state.toCue)} submaster`);
  syncBlackoutButtons();
}

function fromCrossWeight() {
  return 1 - state.cross / 100;
}

function toCrossWeight() {
  return state.cross / 100;
}

function masterWeight() {
  return state.master / 100;
}

/** Live contribution = setting × crossfade × master (drives fader thumbs). */
export function syncSubmasterLive() {
  const m = masterWeight();
  const fromPct = Math.round(state.fromSub * fromCrossWeight() * m);
  const toPct = Math.round(state.toSub * toCrossWeight() * m);

  fromSubInput.value = String(fromPct);
  toSubInput.value = String(toPct);
  fromSubValue.textContent = `${fromPct}%`;
  toSubValue.textContent = `${toPct}%`;
  fromSubValue.title =
    fromPct === Math.round(state.fromSub) ? "" : `Set ${Math.round(state.fromSub)}%`;
  toSubValue.title = toPct === Math.round(state.toSub) ? "" : `Set ${Math.round(state.toSub)}%`;
}

export function syncSubmasterUi() {
  syncSubmasterLive();
  syncSubmasterLabels();
}

export function setSubmasterFromLive(which, live) {
  const level = Math.max(0, Math.min(100, Number(live)));
  const weight =
    (which === "from" ? fromCrossWeight() : toCrossWeight()) * masterWeight();
  const setting = weight > 0.001 ? Math.min(100, level / weight) : level;
  if (which === "from") {
    state.fromSub = setting;
    if (state.fromSubBlackoutSnapshot != null) {
      state.fromSubBlackoutSnapshot = null;
      syncBlackoutButtons();
    }
  } else {
    state.toSub = setting;
    if (state.toSubBlackoutSnapshot != null) {
      state.toSubBlackoutSnapshot = null;
      syncBlackoutButtons();
    }
  }
  syncSubmasterLive();
}

export function setCross(value, { fromUser = false, persist = true } = {}) {
  state.cross = Math.max(0, Math.min(100, value));
  syncCrossUi();
  syncSubmasterLive();
  if (fromUser) stopTimedFade();
  pushToDmx({ persist });
}

export function updateFadePauseButton() {
  const running = state.fadeState != null;
  const paused = running && state.fadeState.paused;
  fadePauseBtn.disabled = !running;
  fadePauseBtn.textContent = paused ? "Resume" : "Pause";
  fadePauseBtn.classList.toggle("is-paused", paused);
  goBtn.classList.toggle("is-running", running && !paused);
  // Nothing up next: the set's last song's last cue.
  goBtn.disabled = state.toCue === state.fromCue;
}

// Timed fades run on the show server (server/show.js), so a hidden or closed
// tab can't stall them; the console asks for GO / pause / stop and follows
// the crossfade, LIVE / UP NEXT and the cue it arrives on.

export function stopTimedFade() {
  if (state.fadeState) state.serverLink?.command("stop");
  state.fadeState = null;
  updateFadePauseButton();
}

/**
 * GO: fade from LIVE to UP NEXT (the next cue, or the next set song's first)
 * over UP NEXT's fadeTime, then advance.
 */
export function goNextCue() {
  if (state.toCue === state.fromCue) return;
  state.serverLink?.command("go");
}

/** A GO finished on the server: show the cue it arrived on. */
export function showArrivedCue() {
  refreshCueSelects();
  renderCues();
  renderSelectedGroup();
  const bank = cuesEl.querySelector(`.fader-row[data-row="${state.selectedCue}"]`);
  bank?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

export function toggleFadePause() {
  if (!state.fadeState) return;
  state.serverLink?.command("pause");
}

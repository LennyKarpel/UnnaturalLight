// Live: output levels, the Live strip and channel meters, LIVE / UP NEXT,
// GO, crossfade, submasters and master, and the DMX output.
import { notifyStage } from "./stage-link.ts";
import { computeChannelLevels as channelLevelsFor, fadeCross, stepArrivals, stepAt } from "../shared/engine.ts";
import type { FadeInfo } from "../server/show.ts";
import {
  FADER_COUNT,
  CHANNEL_METER_COUNT,
  formatChannelLabel,
  formatChannelTooltip,
  UNIVERSE_SIZE,
  MAX_UNIVERSES,
  universeStart,
  formatAddress,
  exactScaledLevel,
} from "./patch.ts";
import { MAX_CUES } from "./songs.ts";
import { goTarget } from "./sets.ts";
import { GO_LABELS, type GoArea, type GoMode } from "../shared/console-stage.ts";
import {
  cuesEl,
  liveFadersEl,
  channelLevelsEl,
  selectedGroupFadersEl,
  currentCueTitle,
  cuePicker,
  cuePickerList,
  channelsCueMenuBtn,
  fromSubInput,
  fromSubValue,
  fromSubLabel,
  toSubInput,
  toSubValue,
  toSubLabel,
  crossfader,
  crossValue,
  crossFromLabel,
  crossToLabel,
  goBtn,
  prevCueBtn,
  nextCueBtn,
  goNextFade,
  addCueBtn,
  openPopup,
  menuItem,
  scrollToCurrent,
  goStepBtn,
  goStepBackBtn,
  crossTicks,
} from "./dom.ts";
import { zeros, syncPlaybackPair, persistSession, getActiveEntry, getActiveSet, getActiveSong, serverLink, state } from "./state.ts";
import type { NetOutputSetting } from "../shared/protocol.ts";
import {
  cueName,
  cueLabel,
  fillCueTitle,
  faderName,
  faderCell,
  levelSlider,
  isUnpatched,
  setText,
  setValue,
  setTitle,
  setFill,
  applyFaderPatchState,
  liveLevel,
  exactLiveLevel,
  refreshLiveRow,
  refreshDimmerButtons,
  addColorBars,
  refreshColorBars,
  refreshFaderPatchLabels,
  syncSlidersFromState,
} from "./faders.ts";
import { syncSongUi, setActiveSong } from "./show-tab.ts";
import { cueUi, renderCues, syncStepTimeline } from "./cues.ts";
import {
  updateConflictBanner,
} from "./patch-tab.ts";
import { el } from "../shared/html.ts";
import { clamp } from "../shared/numbers.ts";

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
  /** @param output null stops it */
  async setNetwork(output: NetOutputSetting | null) {
    const reply = await serverLink().request({ type: "net-set", universe: i + 1, output });
    if (!reply.ok) throw new Error(reply.error);
  },
  async connect() {
    const reply = await serverLink().request({ type: "dmx-connect", universe: i + 1 });
    if (!reply.ok) throw new Error(reply.error);
  },
  async disconnect() {
    await serverLink().request({ type: "dmx-disconnect", universe: i + 1 });
  },
}));
/** Universe 1's output (status messages ask whether it's connected). */
export const dmx = outputs[0];
export let liveUi: { valueEls: HTMLElement[]; patchLabelEls: HTMLElement[]; fillEls: HTMLElement[] } = { valueEls: [], patchLabelEls: [], fillEls: [] };
export let channelUi: { channels: number[]; valueEls: Map<number, HTMLElement>; fillEls: Map<number, HTMLElement>; wrapEls: Map<number, HTMLElement> } = { channels: [], valueEls: new Map(), fillEls: new Map(), wrapEls: new Map() };
let channelRowKey = "";
export let selectedGroupUi: { valueEls: HTMLElement[]; patchLabelEls: HTMLElement[]; sliders: HTMLInputElement[] } = { valueEls: [], patchLabelEls: [], sliders: [] };

// Dimmer-fader overrides (output only, not saved), both momentary: while
// held, blackout puts a fader's output at 0 and flash puts it at full.
// These are the ones held on this console (state.serverBlackedOut and
// state.serverFlashing: on any console).
export const blackedOutFaders = new Set<number>();
export const flashingFaders = new Set<number>();
export const isFlashing = (i: number): boolean => flashingFaders.has(i) || state.serverFlashing.has(i);
export const isBlackedOut = (i: number): boolean => blackedOutFaders.has(i) || state.serverBlackedOut.has(i);

/**
 * What a fader actually sends: its live level, unless flashed (full) or
 * blacked out (0). `exact`: not rounded, as the stage draws it.
 */
export function outputLevel(i: number, exact = false) {
  if (isFlashing(i)) return 255;
  if (isBlackedOut(i)) return 0;
  return exact ? exactLiveLevel(i) : liveLevel(i);
}

/** DMX channel → level. `exact`: not rounded (the stage's in-between levels; DMX sends the rounded ones). */
export function computeChannelLevels({ exact = false } = {}) {
  return exact
    ? channelLevelsFor(state.patch, (i) => outputLevel(i, true), exactScaledLevel)
    : channelLevelsFor(state.patch, (i) => outputLevel(i));
}

function patchedChannelSet(): Set<number> {
  const set = new Set<number>();
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
    const wrap = el("div", "fader live-fader channel-fader");
    if (!patched.has(channel)) wrap.classList.add("is-unpatched-channel");
    wrapEls.set(channel, wrap);

    const label = el("div", "label", `Ch${formatAddress(channel)}`);

    const value = el("div", "value", "0");
    valueEls.set(channel, value);

    const meter = el("div", "live-meter");
    meter.setAttribute("aria-hidden", "true");

    const fill = el("div", "live-meter-fill channel-meter-fill");
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
  notifyStage();
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
    const { wrap, patched, value } = faderCell(i, 0, "fader live-fader");
    patchLabelEls[i] = patched;
    valueEls[i] = value;
    const meter = el("div", "live-meter");
    meter.setAttribute("aria-hidden", "true");
    const fill = el("div", "live-meter-fill");
    fillEls[i] = fill;
    meter.append(fill);
    wrap.append(meter);
    liveFadersEl.append(wrap);
  }

  addColorBars(liveFadersEl, null);
  liveUi = { valueEls, patchLabelEls, fillEls };
  refreshLiveRow();
}

export function refreshCueSelects() {
  state.selectedCue = Math.min(Math.max(0, state.selectedCue), state.cueLevels.length - 1);
  syncPlaybackPair();
  // LIVE / UP NEXT and the buttons, from goArea (the 3D view's GO bar shows the same).
  const go = goTarget(state);
  const area = goArea();
  fillCueTitle(crossFromLabel, state.fromCue);
  if (area.liveStep) crossFromLabel.append(el("span", "go-slot-step", area.liveStep));
  if (!go) crossToLabel.textContent = area.next;
  else {
    fillCueTitle(crossToLabel, go.cue);
    if (area.nextStep) crossToLabel.append(el("span", "go-slot-step", area.nextStep));
  }
  goNextFade.textContent = area.nextFade;
  for (const [btn, key] of [[prevCueBtn, "prevCue"], [goStepBackBtn, "stepBack"], [goBtn, "go"], [goStepBtn, "step"], [nextCueBtn, "nextCue"]] as const) {
    btn.disabled = !area.buttons[key].enabled;
    btn.title = area.buttons[key].title;
  }
  // Tick marks where each step lands (not the last look, at the end).
  crossTicks.replaceChildren(...(go?.path ? stepArrivals(go.path).slice(0, -1) : []).map((at) => {
    const tick = el("span", "step-tick");
    tick.style.setProperty("--at", String(at / 100));
    return tick;
  }));
  syncGoButton();
  // The readout says where in the steps LIVE is: it changes with LIVE too.
  syncCrossUi();
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
export function cueHint(r: number) {
  return r === state.fromCue ? "Live" : r === state.toCue ? "Up next" : "Click to make live";
}

/**
 * Make cue `index` LIVE at once (no fade), showing step `step` (-1: its own
 * look). Selecting a cue makes it LIVE; UP NEXT follows from it (and the set).
 */
export function setSelectedCue(index: number, step = -1) {
  if (index < 0 || index >= state.cueLevels.length) return;
  stopTimedFade();
  // A row showing a step before or after: the rows' faders are other levels now.
  const rebind = state.liveStep >= 0 || step >= 0;
  state.selectedCue = index;
  // A different cue (or step) LIVE now, all of it: the crossfade starts over.
  if (index !== state.fromCue || step !== state.liveStep) state.cross = 0;
  state.fromCue = index;
  state.liveStep = step;
  syncPlaybackPair();
  if (rebind) renderCues();
  for (const bank of cuesEl.querySelectorAll<HTMLElement>(".fader-row")) {
    const r = Number(bank.dataset.row);
    const selected = r === state.selectedCue;
    bank.classList.toggle("is-selected", selected);
    bank.classList.toggle("is-current", r === state.fromCue);
    bank.classList.toggle("is-next", r === state.toCue);
    const hint = bank.querySelector<HTMLElement>(".fader-row-hint");
    if (hint) hint.textContent = cueHint(r);
    const head = bank.querySelector<HTMLElement>(".fader-row-head");
    if (head) head.setAttribute("aria-pressed", selected ? "true" : "false");
  }
  refreshCueSelects();
  renderSelectedGroup();
  pushToDmx();
}

export function pickCue({ anchor, clientX, clientY }: { anchor: HTMLElement; clientX?: number; clientY?: number }): Promise<number | null> {
  return openPopup<number, null>(cuePicker, anchor, {
    dismissed: null,
    place: { x: clientX, y: clientY },
    fill: (finish) => cuePickerList.replaceChildren(
      ...state.cueLevels.map((_, r) => menuItem(cueLabel(r), () => finish(r), { current: r === state.selectedCue })),
    ),
    shown: () => scrollToCurrent(cuePickerList),
  });
}

export function renderSelectedGroup() {
  state.selectedCue = clamp(state.selectedCue, 0, Math.max(0, state.cueLevels.length - 1));
  updateCuesButton();
  selectedGroupFadersEl.replaceChildren();

  const valueEls = [];
  const patchLabelEls = [];
  const sliders = [];
  const row = state.cueLevels[state.selectedCue] ?? zeros();

  for (let i = 0; i < FADER_COUNT; i++) {
    const { wrap, patched, value } = faderCell(i, row[i]);
    patchLabelEls[i] = patched;
    valueEls[i] = value;
    sliders[i] = levelSlider(wrap, i, row[i], `${cueLabel(state.selectedCue)} ${faderName(i)}`, (level) => {
      state.cueLevels[state.selectedCue][i] = level;
      value.textContent = String(level);
      // Keep the Run tab's row for this cue in step, if it's drawn.
      const cueRow = cueUi[state.selectedCue];
      if (cueRow) {
        cueRow.sliders[i].value = String(level);
        cueRow.valueEls[i].textContent = String(level);
      }
      pushToDmx();
    });
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
    const wrap = selectedGroupUi.sliders[i].closest<HTMLElement>(".fader");
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
  crossValue.textContent = crossReadout();
  syncStepTimeline(state.cross);
}

function syncSubmasterLabels() {
  fromSubLabel.textContent = cueLabel(state.fromCue);
  toSubLabel.textContent = cueLabel(state.toCue);
  fromSubInput.setAttribute("aria-label", `${cueLabel(state.fromCue)} submaster`);
  toSubInput.setAttribute("aria-label", `${cueLabel(state.toCue)} submaster`);
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

export function setSubmasterFromLive(which: string, live: string) {
  const level = clamp(Number(live), 0, 100);
  const weight =
    (which === "from" ? fromCrossWeight() : toCrossWeight()) * masterWeight();
  const setting = weight > 0.001 ? Math.min(100, level / weight) : level;
  if (which === "from") {
    state.fromSub = setting;
  } else {
    state.toSub = setting;
  }
  syncSubmasterLive();
}

export function setCross(value: number, { fromUser = false, persist = true } = {}) {
  state.cross = clamp(value, 0, 100);
  syncCrossUi();
  syncSubmasterLive();
  if (fromUser) stopTimedFade();
  pushToDmx({ persist });
}

/** The GO button: GO, or Pause while its fade plays and Resume once paused (goArea). */
export function syncGoButton() {
  const area = goArea();
  const go = goTarget(state);
  goBtn.textContent = GO_LABELS[area.goMode];
  goBtn.classList.toggle("is-running", area.goMode === "pause");
  goBtn.classList.toggle("is-paused", area.goMode === "resume");
  // Nothing up next (the set's last song's last cue) and no fade: off.
  goBtn.disabled = !area.buttons.go.enabled;
  goBtn.title = area.buttons.go.title;
  goBtn.setAttribute("aria-label", area.goMode === "pause" ? "Pause the fade" : area.goMode === "resume" ? "Resume the fade"
    : go ? `GO to ${goAreaName(go)} in ${go.seconds} seconds` : "GO: nothing up next");
  notifyStage(); // the 3D view's GO bar shows the same
}

// Timed fades run on the show server (server/show.ts), so a hidden or closed
// tab can't stall them; the console asks for GO / pause / stop and follows
// the crossfade, LIVE / UP NEXT and the cue it arrives on.

export function stopTimedFade() {
  if (state.fadeState) state.serverLink?.command("stop");
  followFade(null);
  syncGoButton();
}

// The server steps a fade 40 times a second and its updates arrive
// unevenly, so between them the console works the crossfade out itself,
// every screen frame, for what it shows (the stage view, meters). Only what's
// shown: state.cross, what's synced with the server, stays the server's.

/** Local time (performance.now) the running fade counts from; null = paused or none. */
let fadeAnchor: number | null = null;
/** How far in a paused fade is shown (where it was when the pause arrived). */
let frozenElapsed: number | null = null;
let fadeFrame = 0;

/** The crossfade to show: the running or paused fade's as of now, else state.cross. */
export function shownCross(): number {
  const f = state.fadeState;
  const elapsed = fadeAnchor != null ? performance.now() - fadeAnchor : frozenElapsed;
  if (!f || elapsed == null) return state.cross;
  const t = f.durationMs > 0 ? Math.min(1, elapsed / f.durationMs) : 1;
  return fadeCross(f.start, f.target, t);
}

/** Take the server's word on the fade (with each live update). */
export function followFade(fade: FadeInfo | null) {
  const was = state.fadeState;
  const now = performance.now();
  state.fadeState = fade;
  if (!fade) {
    fadeAnchor = frozenElapsed = null;
    return;
  }
  if (fade.paused) {
    // Hold where it's shown, which may be a moment past the server's pause point.
    if (fadeAnchor != null) frozenElapsed = now - fadeAnchor;
    else frozenElapsed ??= fade.elapsedMs;
    fadeAnchor = null;
    return;
  }
  // Updates arrive late, never early: the earliest start one implies is the truest.
  const implied = now - fade.elapsedMs;
  const resumed = was?.paused && Math.abs(fade.elapsedMs - was.elapsedMs) < 100;
  if (resumed && frozenElapsed != null) fadeAnchor = Math.min(implied, now - frozenElapsed); // go on from where it was held
  else if (fadeAnchor == null || was?.id !== fade.id) fadeAnchor = implied;
  else fadeAnchor = Math.min(fadeAnchor, implied);
  frozenElapsed = null;
  if (!fadeFrame) fadeFrame = requestAnimationFrame(animateFade);
}

function animateFade() {
  fadeFrame = 0;
  if (fadeAnchor == null) return;
  notifyStage();
  fadeFrame = requestAnimationFrame(animateFade);
}

/**
 * GO: fade from LIVE to UP NEXT (the next cue, or the next set song's first)
 * over UP NEXT's fadeTime, then advance.
 */
export function goNextCue() {
  if (!goTarget(state)) return;
  state.serverLink?.command("go");
}

/** Step ›: fade to the next look (the LIVE cue's next step, or UP NEXT's first) and make it LIVE. No steps: GO. */
export function stepNextCue() {
  if (!goTarget(state, true)) return;
  state.serverLink?.command("step");
}

/** A cue's look by name: "Cue 2 · step 1" (its own look: its last step), or just the cue's label without steps. */
function lookName(cue: number, step: number, looks: number) {
  return looks > 1 ? `${cueLabel(cue)} · step ${step < 0 ? looks : step + 1}` : cueLabel(cue);
}

/**
 * ‹ Step: the look before LIVE's: its cue's step before, or (from its first
 * step, or a cue without steps) the cue before's own look, across set songs
 * as ◀ does. null at the start of the set.
 */
export function previousLook(): { cue: number; step: number; label: string; song?: { songId: string; entryId: string } } | null {
  const live = getActiveSong().cues[state.fromCue];
  const k = state.liveStep;
  const looks = live ? live.steps.length + 1 : 1;
  if (live && k > 0) return { cue: state.fromCue, step: k - 1, label: lookName(state.fromCue, k - 1, looks) };
  if (live && k < 0 && live.steps.length) return { cue: state.fromCue, step: live.steps.length - 1, label: lookName(state.fromCue, live.steps.length - 1, looks) };
  const before = stepTarget(-1);
  return before && { cue: before.cue, step: -1, label: before.label, song: before.song };
}

/** ‹ Step: make the look before LIVE's LIVE at once (no fade). */
export function stepBackCue() {
  const back = previousLook();
  if (!back) return;
  if (back.song) setActiveSong(back.song.songId, back.song.entryId, back.cue);
  else setSelectedCue(back.cue, back.step);
  cuesEl.querySelector<HTMLElement>(`.fader-row[data-row="${state.selectedCue}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

/** Under GO: how far the crossfade is, and the step ("9% · into step 1 of 3"). */
function crossReadout(): string {
  const pct = Math.round(state.cross);
  const step = stepProgress();
  return step ? `${pct}% · ${step}` : `${pct}%`;
}

const goAreaName = (go: NonNullable<ReturnType<typeof goTarget>>) => cueLabel(go.cue) + (go.cue === state.fromCue ? " (the rest of it)" : "");

/**
 * The GO area: LIVE / UP NEXT, the readout, and what each button can do. The
 * console draws its GO area from it, and the 3D view's GO bar shows the same
 * (console/stage-link.ts), so the two always agree.
 */
export function goArea(): GoArea {
  const go = goTarget(state);
  const goMode: GoMode = !state.fadeState ? "go" : state.fadeState.paused ? "resume" : "pause";
  const stepTo = goTarget(state, true);
  const live = getActiveSong().cues[state.fromCue];
  const liveLooks = live ? live.steps.length + 1 : 1;
  const looksLeft = go?.path ? go.path.steps.length + 1 : 1;
  const back = previousLook();
  const cueStep = (step: -1 | 1, word: string) => {
    const target = stepTarget(step);
    return { enabled: !!target, title: target ? `${word} cue: make ${target.label} live now (no fade)` : `${word} cue — nothing ${step < 0 ? "before" : "after"}` };
  };
  return {
    live: cueLabel(state.fromCue),
    liveStep: state.liveStep >= 0 ? ` · step ${state.liveStep + 1} of ${liveLooks}` : "",
    next: go ? cueLabel(go.cue) : "End of set",
    // LIVE on a step: what's next is the rest of the LIVE cue.
    nextStep: go && go.cue === state.fromCue ? ` · step ${go.first + 1}${go.looks - go.first > 1 ? `–${go.looks}` : ""}` : "",
    nextFade: !go ? "" : looksLeft > 1 ? `${looksLeft} steps · ${go.seconds}s` : `${go.seconds}s`,
    readout: crossReadout(),
    running: state.fadeState != null && !state.fadeState.paused,
    goMode,
    cross: shownCross(),
    ticks: go?.path ? stepArrivals(go.path).slice(0, -1).map((at) => at / 100) : [],
    buttons: {
      prevCue: cueStep(-1, "Previous"),
      // ‹ / ›: the look before (at once) / the next look (a fade, as GO's but one step).
      stepBack: { enabled: !!back, title: back ? `Previous step — make ${back.label} LIVE now (no fade)` : "Previous step — nothing before" },
      // While its fade plays GO is Pause, and Resume once paused.
      go: goMode === "pause" ? { enabled: true, title: "Pause the fade where it is (press again to resume)" }
        : goMode === "resume" ? { enabled: true, title: "Resume the paused fade" }
        : { enabled: !!go, title: go ? `GO — fade to ${goAreaName(go)} (${go.seconds}s${looksLeft > 1 ? `, through ${looksLeft} steps` : ""})` : "GO — nothing up next" },
      step: { enabled: !!stepTo, title: stepTo ? `Next step — fade to ${lookName(stepTo.cue, stepTo.step, stepTo.looks)} (${stepTo.seconds}s) and make it LIVE` : "Next step — nothing up next" },
      nextCue: cueStep(1, "Next"),
    },
  };
}

/** "into step 2 of 3" while a crossfade runs into a cue's steps, "on step 1 of 3" with LIVE on a step ("" otherwise). */
export function stepProgress(): string {
  const go = goTarget(state, state.fadeState?.step);
  const cross = shownCross();
  if (go && go.looks > 1 && cross > 0 && cross < 100) {
    const k = go.path ? stepAt(go.path, cross) + go.first : go.step < 0 ? go.looks - 1 : go.step;
    return `into step ${k + 1} of ${go.looks}`;
  }
  const live = getActiveSong().cues[state.fromCue];
  return state.liveStep >= 0 && live ? `on step ${state.liveStep + 1} of ${live.steps.length + 1}` : "";
}

/**
 * The cue ◀ / ▶ beside GO go to: the previous / next cue of the song, or past
 * its first / last cue the previous set song's last cue / the next set
 * song's first. null at the ends of the set (or a song not in the set).
 */
export function stepTarget(step: -1 | 1): { cue: number; label: string; song?: { songId: string; entryId: string } } | null {
  const cue = state.fromCue + step;
  if (cue >= 0 && cue < state.cueLevels.length) return { cue, label: cueLabel(cue) };
  const set = getActiveSet();
  const entry = getActiveEntry();
  const next = entry ? set.entries[set.entries.indexOf(entry) + step] : null;
  const song = next && state.songs.find((s) => s.id === next.songId);
  if (!next || !song?.cues.length) return null;
  const songCue = step < 0 ? song.cues.length - 1 : 0;
  const name = song.cues[songCue].name;
  return {
    cue: songCue,
    label: `${song.name} · Cue ${songCue + 1}${name ? `: ${name}` : ""}`,
    song: { songId: song.id, entryId: next.id },
  };
}

/**
 * ◀ / ▶ beside GO: make the previous / next cue LIVE at once (no fade), as
 * clicking it does; across songs too, in the active set's order.
 */
export function stepLiveCue(step: -1 | 1) {
  const target = stepTarget(step);
  if (!target) return;
  if (target.song) setActiveSong(target.song.songId, target.song.entryId, target.cue);
  else setSelectedCue(target.cue);
  cuesEl.querySelector<HTMLElement>(`.fader-row[data-row="${state.selectedCue}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

/** A GO finished on the server: show the cue it arrived on. */
export function showArrivedCue() {
  refreshCueSelects();
  renderCues();
  renderSelectedGroup();
  const bank = cuesEl.querySelector<HTMLElement>(`.fader-row[data-row="${state.selectedCue}"]`);
  bank?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

export function toggleFadePause() {
  if (!state.fadeState) return;
  state.serverLink?.command("pause");
}

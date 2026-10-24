// Faders: names and renaming, the fader menu, value labels, and the
// extras drawn on fader rows (color bars, pan/tilt pads, blackout and
// flash buttons, fixture outlines).
import { liveLevel as mixLevel } from "../shared/engine.js";
import { installColorPicker } from "../shared/color-picker.js";
import { ask } from "../shared/ask.js";
import { hexFromRgb, rgbFromHex } from "../shared/color.js";
import { FADER_COUNT, formatChannelLabel, formatChannelTooltip } from "./patch.js";
import { formatChannelRange } from "./fixtures.js";
import { defaultFaderName } from "./set.js";
import { liveFadersEl, faderNameMenu, faderNameMenuList, patchTableEl, pagePatch } from "./dom.js";
import { persistSession, state } from "./state.js";
import {
  liveUi,
  blackedOutFaders,
  flashingFaders,
  isFlashing,
  isBlackedOut,
  outputLevel,
  pushToDmx,
  renderLiveRow,
  closeCuePicker,
  renderSelectedGroup,
  refreshSelectedGroup,
} from "./live.js";
import { endInlineSongRename } from "./songs-page.js";
import { cueUi, closeChannelsCueMenu, renderCues, endInlineRename, closeCueMenu } from "./cues.js";
import {
  closeChannelPicker,
  closeCountPicker,
  closeFixtureGroupPicker,
  renderPatchTable,
} from "./patch-page.js";
import { showPage } from "./nav.js";
import { endInlineFixtureRename } from "./fixtures-page.js";

/** A cue's own name ("" = none). */
export function cueName(index) {
  const name = state.cueNames[index];
  return typeof name === "string" ? name.trim() : "";
}

/** "Cue 3: Chorus": cues are numbered by their position in the song. */
export function cueLabel(index) {
  const name = cueName(index);
  return `Cue ${index + 1}${name ? `: ${name}` : ""}`;
}

/**
 * Show "Cue N" (its position) and the cue's name in a title element.
 * `editable` titles show a dim "name" placeholder while the cue has none.
 */
export function fillCueTitle(el, index, editable = false) {
  const num = document.createElement("span");
  num.className = "cue-number";
  num.textContent = `Cue ${index + 1}`;
  const name = cueName(index);
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

export function faderName(index) {
  const name = state.faderNames[index];
  if (typeof name === "string" && name.trim()) return name.trim();
  return defaultFaderName(index);
}

export function setSelectedFader(index) {
  if (!Number.isInteger(index) || index < 0 || index >= FADER_COUNT) return;
  state.selectedFader = index;
  refreshFaderSelectionUi();
}

function refreshFaderSelectionUi() {
  for (const card of patchTableEl.querySelectorAll(".patch-card")) {
    if (!(card instanceof HTMLElement)) continue;
    const selected = Number(card.dataset.fader) === state.selectedFader;
    card.classList.toggle("is-selected", selected);
    card.setAttribute("aria-selected", selected ? "true" : "false");
  }
  for (const wrap of document.querySelectorAll(".fader[data-fader]")) {
    if (!(wrap instanceof HTMLElement)) continue;
    wrap.classList.toggle("is-selected-fader", Number(wrap.dataset.fader) === state.selectedFader);
  }
}

/** @param {number} index */
export function makeFaderNameLabel(index) {
  const label = document.createElement("button");
  label.type = "button";
  label.className = "label fader-name";
  label.dataset.fader = String(index);
  const name = faderName(index);
  label.textContent = name;
  label.title = name;
  label.setAttribute("aria-label", `Fader ${index + 1}: ${name}`);
  label.addEventListener("click", (event) => {
    // Avoid selecting cue rows / other parent handlers
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

export function abortInlineEdits() {
  endInlineFaderRename?.();
  endInlineRename?.();
  endInlineFixtureRename?.();
  endInlineSongRename?.();
  closeChannelsCueMenu?.();
  closeCuePicker?.();
  closeCueMenu?.();
  closeFaderNameMenu?.();
  closeChannelPicker?.();
  closeCountPicker?.();
  closeFixtureGroupPicker?.();
}

export async function renameFader(index, { preferInline = false } = {}) {
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
  state.faderNames[index] = next;
  renderLiveRow();
  renderCues();
  renderSelectedGroup();
  renderPatchTable();
  persistSession();
  return true;
}

/** @type {null | (() => void)} */
let endInlineFaderRename = null;

/** @param {HTMLHeadingElement | HTMLElement} title @param {number} index */
export function wirePatchFaderTitle(title, index) {
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
  input.className = "cue-title-input fader-title-input";
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
export let closeFaderNameMenu = null;

/**
 * @param {HTMLElement} anchor
 * @param {number} index
 * @param {number} [clientX]
 * @param {number} [clientY]
 */
function openFaderNameMenu(anchor, index, clientX, clientY) {
  closeFaderNameMenu?.();
  closeCueMenu?.();
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
      item.className = "menu-item";
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

export function isUnpatched(targets) {
  return !targets || targets.length === 0;
}

/** @param {HTMLElement} wrap @param {HTMLInputElement} slider @param {import("./patch.js").FaderPatch} targets */
// The refresh functions run on every change (dozens of times a second
// while another console drags or fades), so they only touch the DOM where
// something actually changed: rewriting ~3,000 unchanged sliders and labels
// each time kept a second console window too busy to keep up.
export function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}
export function setValue(input, value) {
  if (input.value !== value) input.value = value;
}
export function setTitle(el, title) {
  if (el.title !== title) el.title = title;
}
/** Fill height last written per element (style.height reads back normalized). */
const fillHeights = new WeakMap();
export function setFill(el, level) {
  const height = `${(level / 255) * 100}%`;
  if (fillHeights.get(el) === height) return;
  fillHeights.set(el, height);
  el.style.height = height;
}

export function applyFaderPatchState(wrap, slider, targets) {
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
export function liveLevel(faderIndex) {
  return mixLevel({ master: state.master, cross: state.cross, fromSub: state.fromSub, toSub: state.toSub, fromCue: state.fromCue, toCue: state.toCue }, state.cueLevels, faderIndex);
}

export function refreshLiveRow() {
  for (let i = 0; i < FADER_COUNT; i++) {
    const level = outputLevel(i);
    setText(liveUi.valueEls[i], String(level));
    setFill(liveUi.fillEls[i], level);
    setText(liveUi.patchLabelEls[i], formatChannelLabel(state.patch[i]));
    liveUi.patchLabelEls[i].classList.toggle("is-unpatched", isUnpatched(state.patch[i]));
    setTitle(liveUi.patchLabelEls[i], formatChannelTooltip(state.patch[i]));
  }
}

// ---------------------------------------------------------------------
// R/G/B color bars: three side-by-side faders driving one fixture's red,
// green and blue get a color bar under them. In a cue (and the
// Channels-page strip) clicking it opens a color picker that sets all
// three; on the Live strip it just shows the mix going out.
// ---------------------------------------------------------------------

/** What a fader drives, if it's a single channel with a known color role. */
function faderColorRole(fader) {
  const targets = state.patch[fader];
  if (!targets || targets.length !== 1) return null;
  const ch = targets[0].channel;
  const owner = state.fixtures.find((i) => ch >= i.channelStart && ch <= i.channelEnd);
  const role = owner?.roles?.[ch - owner.channelStart];
  if (role) return { owner: owner.id, role };
  // Hand-made fixtures: fall back to names ending in R / G / B or Red / Green / Blue.
  const name = faderName(fader).trim();
  const m = /(?:^|[\s·])(r|red|g|green|b|blue)$/i.exec(name);
  if (!m) return null;
  const c = m[1][0].toLowerCase();
  return { owner: owner?.id ?? name.slice(0, -m[1].length).trim(), role: c === "r" ? "red" : c === "g" ? "green" : "blue" };
}

/** First fader of each R, G, B trio (side by side, same fixture). */
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

// ---------------------------------------------------------------------
// Fixture outlines: a line around each run of side-by-side faders that
// control one fixture, labeled with its name.
// ---------------------------------------------------------------------

/** The fixture a fader controls (all its channels in one fixture), or null. */
function faderOwner(fader) {
  const targets = state.patch[fader];
  if (!targets?.length) return null;
  const owner = state.fixtures.find((i) => targets[0].channel >= i.channelStart && targets[0].channel <= i.channelEnd);
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

/** Outline colors, alternated so neighboring fixtures look different. */
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
export function revealFixtures(ids) {
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
    // Only scroll if the group isn't already fully in view; then center it (or show its start).
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
  const targets = state.patch[fader];
  if (!targets?.length) return false;
  const ch = targets[0].channel;
  const owner = state.fixtures.find((f) => ch >= f.channelStart && ch <= f.channelEnd);
  if (owner?.roles?.[ch - owner.channelStart] === "dimmer") return true;
  return /(?:^|[\s·])(dim|dimmer|intensity)$/i.test(faderName(fader).trim());
}

/**
 * What a flash drives to full: the dimmer fader plus its fixture's red /
 * green / blue faders (and any "white" one), so the fixture flashes white.
 */
function flashGroup(fader) {
  const target = state.patch[fader]?.[0];
  const owner = target && state.fixtures.find((f) => target.channel >= f.channelStart && target.channel <= f.channelEnd);
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

/**
 * While `btn` is held, `faders()` are in `set` (blackout / flash); released,
 * they're out. `serverSet()` is the server's copy, which still has them until
 * it hears the release: drop them there too, so the output (and the stage)
 * let go at once.
 */
function holdButton(btn, set, serverSet, faders) {
  let held = [];
  const release = () => {
    if (!held.length) return;
    for (const f of held) {
      set.delete(f);
      serverSet().delete(f);
    }
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
  holdButton(blackout, blackedOutFaders, () => state.serverBlackedOut, () => [fader]);
  const flash = document.createElement("button");
  flash.type = "button";
  flash.className = "dim-btn dim-flash";
  flash.dataset.fader = String(fader);
  flash.textContent = "F";
  flash.title = `Flash ${faderName(fader)}: full and white while held`;
  holdButton(flash, flashingFaders, () => state.serverFlashing, () => flashGroup(fader));
  box.append(blackout, flash);
  grid.append(box);
}

/** Light up the B / F buttons of every blacked-out / flashing fader (in every block). */
export function refreshDimmerButtons() {
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
    const levels = state.cueLevels[row];
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
    const levels = state.cueLevels[row];
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

/** Add color bars to a fader grid: `row` = cue index, or null for Live. */
export function addColorBars(grid, row) {
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
        const levels = state.cueLevels[row];
        if (!levels) return;
        [levels[start], levels[start + 1], levels[start + 2]] = rgbFromHex(input.value);
        syncSlidersFromState();
        pushToDmx();
      });
      bar.append(input);
    }
    grid.append(bar);
  }
}

/** Show each bar's current color (cue values, or live output). */
export function refreshColorBars() {
  for (const bar of document.querySelectorAll(".rgb-bar")) {
    const start = Number(bar.dataset.start);
    const levels = bar.dataset.live ? [liveLevel(start), liveLevel(start + 1), liveLevel(start + 2)] : (state.cueLevels[Number(bar.dataset.row)] ?? []).slice(start, start + 3);
    const color = hexFromRgb(levels[0] ?? 0, levels[1] ?? 0, levels[2] ?? 0);
    bar.style.setProperty("--rgb", color);
    const input = bar.querySelector("input");
    if (input && document.activeElement !== input) setValue(input, color);
  }
}

// Color bars open the shared color picker (also used by the stage).
installColorPicker({
  usedLabel: "In use",
  usedColors: () => [...document.querySelectorAll(".rgb-bar")].map((bar) => bar.style.getPropertyValue("--rgb")),
});

/** Trio layout the fader rows were last drawn with (redraw when it changes). */
let colorBarKey = "";

export function refreshFaderPatchLabels() {
  // Patch / fixture edits can create or break an R/G/B trio: redraw the rows.
  const key = `${rgbTrios().join(",")}|${fixtureRuns().map((r) => `${r.start}+${r.length}:${r.fixture.id}:${r.fixture.name}`).join(",")}|${dimmerFaderList().join(",")}|${panTiltPairs().map((p) => `${p.pan}:${p.tilt}`).join(",")}`;
  if (key !== colorBarKey) {
    colorBarKey = key;
    renderLiveRow();
    renderCues();
    renderSelectedGroup();
  }
  for (const ui of cueUi) {
    for (let i = 0; i < FADER_COUNT; i++) {
      const el = ui.patchLabelEls[i];
      el.textContent = formatChannelLabel(state.patch[i]);
      el.title = formatChannelTooltip(state.patch[i]);
      el.classList.toggle("is-unpatched", isUnpatched(state.patch[i]));
      const wrap = ui.sliders[i].closest(".fader");
      if (wrap instanceof HTMLElement) {
        applyFaderPatchState(wrap, ui.sliders[i], state.patch[i]);
      }
    }
  }
  refreshLiveRow();
  refreshSelectedGroup();
}

export function syncSlidersFromState() {
  for (let r = 0; r < state.cueLevels.length; r++) {
    for (let i = 0; i < FADER_COUNT; i++) {
      setValue(cueUi[r].sliders[i], String(state.cueLevels[r][i]));
      setText(cueUi[r].valueEls[i], String(state.cueLevels[r][i]));
    }
  }
  refreshSelectedGroup();
}

/**
 * @param {{ title: string, message: string, confirmLabel?: string }} opts
 * @returns {Promise<boolean>}
 */
export async function confirmAction({ title, message, confirmLabel = "Confirm" }) {
  return (await ask({ title, message, confirmLabel })) === true;
}

export function confirmRemoveCue(label) {
  return confirmAction({
    title: "Remove cue?",
    message: `Remove ${label}? Its fader levels will be lost.`,
    confirmLabel: "Remove",
  });
}

export function confirmClearFaderPatch(name) {
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
export function promptName({ title, confirmLabel, initial }) {
  abortInlineEdits();
  return /** @type {Promise<string | null>} */ (ask({ title, confirmLabel, initial }));
}

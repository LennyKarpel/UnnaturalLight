// Faders: names and renaming, the fader menu, value labels, and the
// extras drawn on fader rows (color bars, pan/tilt pads, blackout and
// flash buttons, fixture outlines).
import { liveLevel as mixLevel, exactLiveLevel as exactMixLevel, type Mix } from "../shared/engine.ts";
import { goTarget } from "./sets.ts";
import { installColorPicker } from "../shared/color-picker.ts";
import { bindPanTiltPad, type PanTilt } from "../shared/pan-tilt-pad.ts";
import { ask, type AskOptions } from "../shared/ask.ts";
import { elById } from "../shared/query.ts";
import { COLOR_ROLES, MIXED_ROLES, colorFromLevels, emitterHex, isColorRole, levelsFromColor } from "../shared/color.ts";
import { isOneOf } from "../shared/guards.ts";
import { FADER_COUNT, formatChannelLabel, formatChannelTooltip, type FaderPatch } from "./patch.ts";
import { formatChannelRange, type Fixture } from "./fixtures.ts";
import { defaultFaderName } from "./show.ts";
import { liveFadersEl, faderNameMenu, faderNameMenuList, patchTableEl, tabPatch, closePopup, openPopup, menuItem } from "./dom.ts";
import { getNextSetSong, getPlaybackLevels, persistSession, state } from "./state.ts";
import {
  liveUi,
  blackedOutFaders,
  flashingFaders,
  isFlashing,
  isBlackedOut,
  outputLevel,
  pushToDmx,
  renderLiveRow,
  shownCross,
  renderSelectedGroup,
  refreshSelectedGroup,
} from "./live.ts";
import { cueUi, renderCues } from "./cues.ts";
import { renderPatchTable } from "./patch-tab.ts";
import { showTab } from "./nav.ts";
import { abortInlineRename, inlineRename } from "./inline-rename.ts";
import { el, button } from "../shared/html.ts";

/**
 * The cue at `index` in the active song; the index past its last cue is the
 * next set song's first cue (UP NEXT after a song's last cue).
 */
function cueAt(index: number) {
  if (index < state.cueNames.length) return { song: null, number: index + 1, name: state.cueNames[index] };
  const next = getNextSetSong();
  return { song: next?.song.name ?? null, number: 1, name: next?.song.cues[0].name };
}

/** A cue's own name ("" = none). */
export function cueName(index: number) {
  const name = cueAt(index).name;
  return typeof name === "string" ? name.trim() : "";
}

/** "Cue 3: Chorus", or with another song's name: "Song 2 · Cue 1". */
export function formatCueLabel(number: number, name: string | undefined, song?: string | null) {
  const own = name?.trim();
  return `${song ? `${song} · ` : ""}Cue ${number}${own ? `: ${own}` : ""}`;
}

/** "Cue 3: Chorus": cues are numbered by their position in the song (another song's start: "Song 2 · Cue 1"). */
export function cueLabel(index: number) {
  const { song, number } = cueAt(index);
  return formatCueLabel(number, cueName(index), song);
}

/**
 * Show "Cue N" (its position) and the cue's name in a title element.
 * `editable` titles show a dim "name" placeholder while the cue has none.
 */
export function fillCueTitle(target: HTMLElement, index: number, editable = false) {
  const num = el("span", "cue-number");
  const { song, number } = cueAt(index);
  num.textContent = `${song ? `${song} · ` : ""}Cue ${number}`;
  const name = cueName(index);
  if (!name && !editable) {
    target.replaceChildren(num);
    return;
  }
  num.textContent += ":";
  const label = el("span", "cue-name");
  label.classList.toggle("is-empty", !name);
  label.textContent = name || "name";
  target.replaceChildren(num, label);
}

export function faderName(index: number) {
  const name = state.faderNames[index];
  if (typeof name === "string" && name.trim()) return name.trim();
  return defaultFaderName(index);
}

export function setSelectedFader(index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= FADER_COUNT) return;
  state.selectedFader = index;
  refreshFaderSelectionUi();
}

function refreshFaderSelectionUi() {
  for (const card of patchTableEl.querySelectorAll<HTMLElement>(".patch-card")) {
    if (!(card instanceof HTMLElement)) continue;
    const selected = Number(card.dataset.fader) === state.selectedFader;
    card.classList.toggle("is-selected", selected);
    card.setAttribute("aria-selected", selected ? "true" : "false");
  }
  for (const wrap of document.querySelectorAll<HTMLElement>(".fader[data-fader]")) {
    if (!(wrap instanceof HTMLElement)) continue;
    wrap.classList.toggle("is-selected-fader", Number(wrap.dataset.fader) === state.selectedFader);
  }
}

export function makeFaderNameLabel(index: number) {
  const label = button("label fader-name");
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

/** End a rename in progress (without saving) and close any open menu. */
export function abortInlineEdits() {
  abortInlineRename();
  closePopup();
}

export async function renameFader(index: number, { preferInline = false } = {}) {
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

function applyFaderName(index: number, name: string) {
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

export function wirePatchFaderTitle(title: HTMLElement, index: number): HTMLElement {
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

function beginInlineFaderRename(index: number, target: HTMLElement) {
  if (!target.isConnected) return;
  abortInlineEdits();
  inlineRename({
    replace: target,
    value: faderName(index),
    label: "Fader name",
    className: "cue-title-input fader-title-input",
    done: (name, putBack) => {
      // A new name redraws every fader title; otherwise put this one back.
      if (name && applyFaderName(index, name)) return;
      putBack(wirePatchFaderTitle(document.createElement("h3"), index));
    },
  });
}

function openFaderNameMenu(anchor: HTMLElement, index: number, clientX?: number, clientY?: number) {
  return openPopup<string, null>(faderNameMenu, anchor, {
    dismissed: null,
    place: { x: clientX, y: clientY },
    fill: (finish) => faderNameMenuList.replaceChildren(
      menuItem("Rename", () => finish("rename")),
      menuItem("Show in Patch", () => finish("patch")),
    ),
  }).then(async (action) => {
    if (action === "rename") {
      const onPatch =
        !tabPatch.hidden &&
        Boolean(patchTableEl.querySelector<HTMLElement>(`.patch-card[data-fader="${index}"] .patch-fader-name`));
      await renameFader(index, { preferInline: onPatch });
    }
    if (action === "patch") showFaderInPatch(index);
    return action;
  });
}

function showFaderInPatch(index: number) {
  if (index < 0 || index >= FADER_COUNT) return;
  setSelectedFader(index);
  if (location.hash.replace("#", "") !== "patch") {
    location.hash = "patch";
  } else {
    showTab("patch");
  }

  requestAnimationFrame(() => {
    refreshFaderSelectionUi();
    const card = patchTableEl.querySelector<HTMLElement>(`.patch-card[data-fader="${index}"]`);
    if (!(card instanceof HTMLElement)) return;
    card.classList.remove("is-flash");
    void card.offsetWidth;
    card.classList.add("is-flash");
    card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    window.setTimeout(() => card.classList.remove("is-flash"), 1600);
  });
}

export function isUnpatched(targets: FaderPatch | null | undefined): boolean {
  return !targets || targets.length === 0;
}

// The refresh functions run on every change (dozens of times a second
// while another console drags or fades), so they only touch the DOM where
// something actually changed: rewriting ~3,000 unchanged sliders and labels
// each time kept a second console window too busy to keep up.
export function setText(el: HTMLElement, text: string) {
  if (el.textContent !== text) el.textContent = text;
}
export function setValue(input: HTMLInputElement, value: string) {
  if (input.value !== value) input.value = value;
}
export function setTitle(el: HTMLElement, title: string) {
  if (el.title !== title) el.title = title;
}
/** Fill height last written per element (style.height reads back normalized). */
const fillHeights = new WeakMap<HTMLElement, string>();
export function setFill(el: HTMLElement, level: number) {
  const height = `${(level / 255) * 100}%`;
  if (fillHeights.get(el) === height) return;
  fillHeights.set(el, height);
  el.style.height = height;
}

export function applyFaderPatchState(wrap: HTMLElement, slider: HTMLInputElement, targets: FaderPatch) {
  const unpatched = isUnpatched(targets);
  wrap.classList.toggle("is-unpatched-fader", unpatched);
  if (slider.disabled !== unpatched) slider.disabled = unpatched;
  if (unpatched) {
    setTitle(slider, "No channels patched");
  } else if (slider.hasAttribute("title")) {
    slider.removeAttribute("title");
  }
}

/**
 * Fader `i`'s cell in a row of faders (the live row, a cue's row, the
 * selected cue): its name, what it's patched to and its value, lit up when
 * it's the selected fader. Pressing it selects the fader.
 */
export function faderCell(i: number, level: number, className = "fader") {
  const wrap = el("div", className);
  wrap.dataset.fader = String(i);
  wrap.classList.toggle("is-selected-fader", i === state.selectedFader);
  wrap.addEventListener("pointerdown", () => setSelectedFader(i));
  const patched = el("div", "patch-target", formatChannelLabel(state.patch[i]));
  patched.title = formatChannelTooltip(state.patch[i]);
  if (isUnpatched(state.patch[i])) patched.classList.add("is-unpatched");
  const value = el("div", "value", String(level));
  wrap.append(makeFaderNameLabel(i), patched, value);
  return { wrap, patched, value };
}

/** A cue level slider (0–255) for fader `i`, added to its cell; `onInput` gets each new level. */
export function levelSlider(wrap: HTMLElement, i: number, level: number, label: string, onInput: (level: number) => void) {
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "255";
  slider.value = String(level);
  slider.setAttribute("aria-label", label);
  applyFaderPatchState(wrap, slider, state.patch[i]);
  slider.addEventListener("input", () => {
    setSelectedFader(i);
    onInput(Number(slider.value));
  });
  wrap.append(slider);
  return slider;
}

/** Live fader level after submasters + crossfade + master (0–255), before per-channel max */
const shownMix = (): Mix => {
  const to = goTarget(state, state.fadeState?.step);
  return { master: state.master, cross: shownCross(), fromSub: state.fromSub, toSub: state.toSub, fromCue: state.fromCue, toCue: state.toCue, toLevels: to?.levels, toPath: to?.path };
};

export function liveLevel(faderIndex: number) {
  return mixLevel(shownMix(), getPlaybackLevels(), faderIndex);
}

/** liveLevel before rounding (what the stage draws mid-fade). */
export function exactLiveLevel(faderIndex: number) {
  return exactMixLevel(shownMix(), getPlaybackLevels(), faderIndex);
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
// Color bars: side-by-side faders driving one fixture's color emitters
// (red, green and blue, plus any white / amber / lime / cyan / indigo / UV) get a
// color bar under them. In a cue (and the Channels-tab strip) clicking it
// opens a color picker that mixes the color onto them (shared/color.ts);
// on the Live strip it just shows the mix going out.
// ---------------------------------------------------------------------

/** What a fader drives, if it's a single channel with a known color role. */
type FaderColor = { owner: string; role: string };

function faderColorRole(fader: number): FaderColor | null {
  const targets = state.patch[fader];
  if (!targets || targets.length !== 1) return null;
  const ch = targets[0].channel;
  const owner = state.fixtures.find((i) => ch >= i.channelStart && ch <= i.channelEnd);
  const role = owner?.roles?.[ch - owner.channelStart];
  if (role) return { owner: owner.id, role };
  // Hand-made fixtures: fall back to names ending in a color (R / Red, W / White, UV, …).
  const name = faderName(fader).trim();
  const m = /(?:^|[\s·])(r|red|g|green|b|blue|w|white|a|amber|l|lime|c|cyan|i|indigo|uv)$/i.exec(name);
  if (!m) return null;
  const word = m[1].toLowerCase();
  return { owner: owner?.id ?? name.slice(0, -m[1].length).trim(), role: COLOR_ROLES.find((r) => r === word || r[0] === word) ?? word };
}

const hasColorRole = (r: FaderColor | null): r is FaderColor => r != null && isColorRole(r.role);

/**
 * Runs of side-by-side color faders of one fixture that include red, green
 * and blue: [{ start, end, faders: [{ fader, role }] }].
 */
type ColorGroup = { start: number; end: number; faders: { fader: number; role: string }[] };

function colorGroups(): ColorGroup[] {
  const out: ColorGroup[] = [];
  for (let i = 0; i < FADER_COUNT; ) {
    const first = faderColorRole(i);
    if (!hasColorRole(first)) { i++; continue; }
    const faders = [{ fader: i, role: first.role }];
    let j = i + 1;
    while (j < FADER_COUNT) {
      const r = faderColorRole(j);
      if (!hasColorRole(r) || r.owner !== first.owner) break;
      faders.push({ fader: j, role: r.role });
      j++;
    }
    if (["red", "green", "blue"].every((role) => faders.some((f) => f.role === role))) out.push({ start: i, end: j - 1, faders });
    i = j;
  }
  return out;
}

/**
 * Pan / tilt fader pairs of the same fixture (by role, or faders named
 * "… Pan" / "… Tilt"): [{ pan, tilt }].
 */
function panTiltPairs(): PanTilt[] {
  const roleOf = (i: number): FaderColor | null => {
    const r = faderColorRole(i);
    if (r?.role === "pan" || r?.role === "tilt") return r;
    const m = /(?:^|[\s·])(pan|tilt)$/i.exec(faderName(i).trim());
    return m ? { owner: faderOwner(i)?.id ?? faderName(i).slice(0, -m[1].length).trim(), role: m[1].toLowerCase() } : null;
  };
  const roles = Array.from({ length: FADER_COUNT }, (_, i) => roleOf(i));
  const out: PanTilt[] = [];
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
function faderOwner(fader: number) {
  const targets = state.patch[fader];
  if (!targets?.length) return null;
  const owner = state.fixtures.find((i) => targets[0].channel >= i.channelStart && targets[0].channel <= i.channelEnd);
  if (!owner) return null;
  return targets.every((t) => t.channel >= owner.channelStart && t.channel <= owner.channelEnd) ? owner : null;
}

/** Runs of side-by-side faders with the same fixture: [{ start, length, fixture }]. */
type FixtureRun = { start: number; length: number; fixture: Fixture };

function fixtureRuns(): FixtureRun[] {
  const runs: FixtureRun[] = [];
  for (let i = 0; i < FADER_COUNT; ) {
    const owner = faderOwner(i);
    let j = i + 1;
    if (owner) while (j < FADER_COUNT && faderOwner(j) === owner) j++;
    if (owner) runs.push({ start: i, length: j - i, fixture: owner });
    i = j;
  }
  return runs;
}

/** The console's pane: the page also holds the stage, which uses some of the same classes (.rgb-bar, .fixture-outline). */
const consolePane = elById("consolePane");

/** Outline colors, alternated so neighboring fixtures look different. */
const OUTLINE_COLORS = ["#e2a13a", "#5fb7d6", "#9cc76b", "#d68ab4", "#c9b458", "#8a9be0"];

/** Each fixture's outline color (fixture id → color), as drawn around its faders. */
export function fixtureOutlineColors(): Map<string, string> {
  const colors = new Map<string, string>();
  fixtureRuns().forEach((run, k) => {
    if (!colors.has(run.fixture.id)) colors.set(run.fixture.id, OUTLINE_COLORS[k % OUTLINE_COLORS.length]);
  });
  return colors;
}

/**
 * Grid columns for a fader block: a narrow spacer column follows each
 * fixture's run of faders, so fixtures sit a little apart.
 * `col[i]` is fader i's (1-based) grid column.
 */
function faderColumns(runs = fixtureRuns()): { col: number[]; template: string } {
  const ends = new Set(runs.map((run) => run.start + run.length - 1));
  const col: number[] = [];
  const template: string[] = [];
  for (let i = 0; i < FADER_COUNT; i++) {
    col.push(template.length + 1);
    template.push("40px");
    if (ends.has(i) && i < FADER_COUNT - 1) template.push("var(--fixture-gap)");
  }
  return { col, template: template.join(" ") };
}

/** Fixtures selected on the stage: their outlines stay highlighted. */
let revealedFixtureIds: string[] = [];

/** A fader grid's faders (it also holds outlines, bars, buttons …). */
const faderEls = (grid: HTMLElement) => [...grid.querySelectorAll<HTMLElement>(":scope > .fader")];

function addFixtureOutlines(grid: HTMLElement, { col, template } = faderColumns()) {
  // Pin each fader to its own column so outlines can sit on top of them.
  grid.style.gridTemplateColumns = template;
  faderEls(grid).forEach((el, i) => { el.style.gridColumn = String(col[i]); });
  // When there's a second row (color bars, B / F buttons), outlines reach down
  // over it too, so they sit inside the fixture's box (all outlines, for even heights).
  const withBars = colorGroups().length > 0 || dimmerFaderList().length > 0 || panTiltPairs().length > 0;
  fixtureRuns().forEach((run, k) => {
    const box = el("div", "fixture-outline");
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
export function revealFixtures(ids: string[]) {
  revealedFixtureIds = ids;
  for (const box of consolePane.querySelectorAll<HTMLElement>(".fixture-outline")) {
    box.classList.toggle("is-revealed", ids.includes(box.dataset.fixtureId ?? ""));
  }
  const runs = fixtureRuns().filter((run) => ids.includes(run.fixture.id));
  if (!runs.length) return;
  const first = Math.min(...runs.map((r) => r.start));
  const last = Math.max(...runs.map((r) => r.start + r.length - 1));
  const strip = liveFadersEl;
  const a = liveUi.valueEls[first]?.closest<HTMLElement>(".fader");
  const b = liveUi.valueEls[last]?.closest<HTMLElement>(".fader");
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
function isDimmerFader(fader: number): boolean {
  const targets = state.patch[fader];
  if (!targets?.length) return false;
  const ch = targets[0].channel;
  const owner = state.fixtures.find((f) => ch >= f.channelStart && ch <= f.channelEnd);
  if (owner?.roles?.[ch - owner.channelStart] === "dimmer") return true;
  return /(?:^|[\s·])(dim|dimmer|intensity)$/i.test(faderName(fader).trim());
}

/**
 * What a flash drives to full: the dimmer fader plus its fixture's color
 * faders (red, green, blue, white, amber, lime, cyan, indigo; not UV), so the
 * fixture flashes bright and white.
 */
function flashGroup(fader: number) {
  const target = state.patch[fader]?.[0];
  const owner = target && state.fixtures.find((f) => target.channel >= f.channelStart && target.channel <= f.channelEnd);
  if (!owner) return [fader];
  const group = [fader];
  for (let j = 0; j < FADER_COUNT; j++) {
    if (j === fader) continue;
    const color = faderColorRole(j);
    if (color?.owner === owner.id && isOneOf(MIXED_ROLES, color.role)) group.push(j);
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
function holdButton(btn: HTMLButtonElement, set: Set<number>, serverSet: () => Set<number>, faders: () => number[]) {
  let held: number[] = [];
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
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) btn.addEventListener(type, release);
}

/** Faders held from the stage's B / F buttons: "blackout:channel" / "flash:channel" → faders. */
const stageHolds = new Map<string, number[]>();

/**
 * The stage's B / F buttons (stage-link.ts): while `on`, the dimmer fader(s)
 * patched to `channel` are blacked out, or flashed full and white, like
 * holding their B / F here.
 */
export function holdFromStage(kind: "blackout" | "flash", channel: number, on: boolean) {
  const key = `${kind}:${channel}`;
  const set = kind === "blackout" ? blackedOutFaders : flashingFaders;
  const serverSet = kind === "blackout" ? state.serverBlackedOut : state.serverFlashing;
  for (const f of stageHolds.get(key) ?? []) {
    set.delete(f);
    serverSet.delete(f);
  }
  stageHolds.delete(key);
  if (on) {
    const dimmers = dimmerFaderList().filter((f) => state.patch[f].some((t) => t.channel === channel));
    const held = kind === "blackout" ? dimmers : [...new Set(dimmers.flatMap(flashGroup))];
    for (const f of held) set.add(f);
    stageHolds.set(key, held);
  }
  pushToDmx({ persist: false });
}

/** B / F buttons for a dimmer fader, placed in the row under the faders (with the color bars). */
function addDimmerButtons(grid: HTMLElement, fader: number, col: number[]) {
  const box = el("div", "dim-btns");
  box.style.gridColumn = String(col[fader]);
  const blackout = button("dim-btn dim-blackout");
  blackout.dataset.fader = String(fader);
  blackout.textContent = "B";
  blackout.title = `Blackout ${faderName(fader)}: output 0 while held`;
  holdButton(blackout, blackedOutFaders, () => state.serverBlackedOut, () => [fader]);
  const flash = button("dim-btn dim-flash");
  flash.dataset.fader = String(fader);
  flash.textContent = "F";
  flash.title = `Flash ${faderName(fader)}: full and white while held`;
  holdButton(flash, flashingFaders, () => state.serverFlashing, () => flashGroup(fader));
  box.append(blackout, flash);
  grid.append(box);
}

/** Light up the B / F buttons of every blacked-out / flashing fader (in every block). */
export function refreshDimmerButtons() {
  for (const btn of document.querySelectorAll<HTMLElement>(".dim-btn")) {
    const fader = Number(btn.dataset.fader);
    btn.classList.toggle("on", btn.classList.contains("dim-blackout") ? isBlackedOut(fader) : isFlashing(fader));
  }
}

/**
 * A pad under a pan / tilt pair (shared/pan-tilt-pad.ts): hold and move the
 * mouse to change the cue's pan / tilt.
 */
function addPanTiltPad(grid: HTMLElement, { pan, tilt }: PanTilt, row: number, col: number[]) {
  const pad = document.createElement("div");
  pad.textContent = "✥";
  pad.style.gridColumn = tilt === pan + 1 ? `${col[pan]} / ${col[tilt] + 1}` : String(col[pan]);
  pad.title = `Hold and move the mouse: left / right = ${faderName(pan)}, up / down = ${faderName(tilt)} (⇧ = fine)`;
  bindPanTiltPad(pad, {
    get: () => {
      const levels = state.cueLevels[row];
      return levels ? { pan: levels[pan], tilt: levels[tilt] } : null;
    },
    set: (p, t) => {
      const levels = state.cueLevels[row];
      if (!levels) return;
      levels[pan] = p;
      levels[tilt] = t;
      syncSlidersFromState();
      pushToDmx({ persist: false });
    },
    done: () => pushToDmx(),
  });
  grid.append(pad);
}

/** Add color bars to a fader grid: `row` = cue index, or null for Live. */
export function addColorBars(grid: HTMLElement, row: number | null) {
  const columns = faderColumns();
  const { col } = columns;
  addFixtureOutlines(grid, columns);
  for (const fader of dimmerFaderList()) addDimmerButtons(grid, fader, col);
  if (row != null) for (const pair of panTiltPairs()) addPanTiltPad(grid, pair, row, col);
  // A strip along the bottom of each color fader, in its emitter's color.
  const faders = faderEls(grid);
  for (const { fader, role } of colorGroups().flatMap((g) => g.faders)) {
    const el = faders[fader];
    if (!el) continue;
    el.classList.add("has-emitter");
    el.style.setProperty("--emitter", emitterHex(role));
  }
  for (const group of colorGroups()) {
    const bar = el("label", "rgb-bar");
    bar.style.gridColumn = `${col[group.start]} / ${col[group.end] + 1}`;
    bar.dataset.faders = group.faders.map((f) => `${f.fader}:${f.role}`).join(",");
    const names = group.faders.map((f) => faderName(f.fader)).join(" / ");
    if (row == null) {
      bar.dataset.live = "1";
      bar.title = `${names} · live color`;
    } else {
      bar.dataset.row = String(row);
      bar.title = group.faders.length === 3 ? "Click to pick a color (sets these three faders)" : "Click to pick a color (mixed onto these faders; UV stays as it is)";
      const input = document.createElement("input");
      input.type = "color";
      input.setAttribute("aria-label", `Color for ${names}`);
      input.addEventListener("input", () => {
        const levels = state.cueLevels[row];
        if (!levels) return;
        const mix = levelsFromColor(input.value, group.faders.map((f) => f.role));
        // Faders with the same role (e.g. Deep Red and Red) move together.
        for (const { fader, role } of group.faders) {
          const level = isColorRole(role) ? mix[role] : undefined;
          if (level != null) levels[fader] = level;
        }
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
  for (const bar of consolePane.querySelectorAll<HTMLElement>(".rgb-bar")) {
    const cue = bar.dataset.live ? null : state.cueLevels[Number(bar.dataset.row)] ?? [];
    const levels: Record<string, number> = {};
    for (const item of (bar.dataset.faders ?? "").split(",")) {
      const [fader, role] = item.split(":");
      // Same role twice (Deep Red and Red): shown as the brighter one.
      levels[role] = Math.max(levels[role] ?? 0, cue ? cue[Number(fader)] ?? 0 : liveLevel(Number(fader)));
    }
    const color = colorFromLevels(levels);
    if (bar.style.getPropertyValue("--rgb") === color) continue; // unchanged: skip the style write
    bar.style.setProperty("--rgb", color);
    const input = bar.querySelector("input");
    if (input && document.activeElement !== input) setValue(input, color);
  }
}

// Color bars open the shared color picker (also used by the stage).
installColorPicker({
  scope: consolePane,
  usedLabel: "In use",
  usedColors: () => [...consolePane.querySelectorAll<HTMLElement>(".rgb-bar")].map((bar) => bar.style.getPropertyValue("--rgb")),
});

/** Color group layout the fader rows were last drawn with (redraw when it changes). */
let colorBarKey = "";

export function refreshFaderPatchLabels() {
  // Patch / fixture edits can create or break a color group: redraw the rows.
  const key = `${colorGroups().map((g) => g.faders.map((f) => `${f.fader}:${f.role}`).join(",")).join(";")}|${fixtureRuns().map((r) => `${r.start}+${r.length}:${r.fixture.id}:${r.fixture.name}`).join(",")}|${dimmerFaderList().join(",")}|${panTiltPairs().map((p) => `${p.pan}:${p.tilt}`).join(",")}`;
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
      const wrap = ui.sliders[i].closest<HTMLElement>(".fader");
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

export async function confirmAction({ title, message, confirmLabel = "Confirm" }: AskOptions): Promise<boolean> {
  return (await ask({ title, message, confirmLabel })) === true;
}

export function confirmRemoveCue(label: string) {
  return confirmAction({
    title: "Remove cue?",
    message: `Remove ${label}? Its fader levels will be lost.`,
    confirmLabel: "Remove",
  });
}

export function confirmClearFaderPatch(name: string) {
  return confirmAction({
    title: "Clear patch?",
    message: `Clear all channels from “${name}”?`,
    confirmLabel: "Clear",
  });
}

export function promptName({ title, confirmLabel, initial }: { title: string; confirmLabel: string; initial: string }): Promise<string | null> {
  abortInlineEdits();
  return ask({ title, confirmLabel, initial });
}

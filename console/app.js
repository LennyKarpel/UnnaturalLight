// The console (its pane in ../index.html): starts it up and wires its controls;
// show new / load / save, universes and DMX outputs, fixtures placed on the
// stage, the app header's hooks (consoleHeader), and the link to the show
// server. The console's pages themselves are in the modules imported below.
import { startStageLink } from "./stage-link.js";
import { createServerLink } from "./server-link.js";
import { LIVE_FIELDS } from "../shared/live-fields.js";
import { COLOR_ROLES } from "../shared/color.js";
import {
  FADER_COUNT,
  identityPatch,
  defaultPatch,
  makeTarget,
  UNIVERSE_SIZE,
  MAX_UNIVERSES,
  setUniverseCount,
} from "./patch.js";
import {
  createFixture,
  createFixtureGroup,
  findRangeConflict,
  formatChannelRange,
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
  normalizeRoles,
} from "./fixtures.js";
import {
  defaultFaderName,
  downloadShow,
  normalizeFaderNames,
  normalizeNavOrder,
  normalizeShowName,
  parseShow,
  normalizeUniverses,
} from "./show.js";
import {
  createCue,
  MAX_CUES,
  normalizeSongs,
  resolveActiveSong,
} from "./songs.js";
import { normalizeSets } from "./sets.js";
import {
  currentCueTitle,
  channelsCueMenuBtn,
  masterInput,
  masterValue,
  fromSubInput,
  toSubInput,
  crossfader,
  goBtn,
  prevCueBtn,
  nextCueBtn,
  fadePauseBtn,
  addCueBtn,
  addSongBtn,
  identityBtn,
  clearPatchBtn,
  pageChannels,
  fixtureForm,
  fixtureNameInput,
  addFixtureGroupBtn,
  meterUniverseSelect,
  cuesScroll,
  cuesEl,
  cuesHScroll,
} from "./dom.js";
import {
  blankShowState,
  getActiveSong,
  getPlaybackLevels,
  bindActiveSong,
  syncPlaybackPair,
  headerListeners,
  notifyHeader,
  setStatus,
  persistSession,
  currentShowState,
  markClean,
  isDirty,
  state,
} from "./state.js";
import {
  cueLabel,
  faderName,
  isUnpatched,
  liveLevel,
  revealFixtures,
  refreshFaderPatchLabels,
  syncSlidersFromState,
  confirmAction,
} from "./faders.js";
import {
  outputs,
  dmx,
  liveUi,
  channelUi,
  selectedGroupUi,
  blackedOutFaders,
  flashingFaders,
  computeChannelLevels,
  renderChannelRow,
  ensureChannelRow,
  pushToDmx,
  renderLiveRow,
  refreshCueSelects,
  renderSelectedGroup,
  persistAndRefresh,
  syncCrossUi,
  syncSubmasterLive,
  syncSubmasterUi,
  setSubmasterFromLive,
  setCross,
  updateFadePauseButton,
  stopTimedFade,
  goNextCue,
  stepLiveCue,
  showArrivedCue,
  toggleFadePause,
} from "./live.js";
import { syncSongUi, renderShowPage, addSong } from "./show-page.js";
import { renderSetPage } from "./set-page.js";
import {
  cueUi,
  closeChannelsCueMenu,
  renderCues,
  wireCurrentCueTitle,
  openChannelsCueMenu,
} from "./cues.js";
import { renderPatchTable } from "./patch-page.js";
import {
  syncShowNameUi,
  applyShowName,
  applyNavOrder,
  wireNavReorder,
  routeFromHash,
} from "./nav.js";
import {
  fixtureFormStart,
  fixtureFormCount,
  fixtureFormQty,
  fixtureFormStartPicker,
  ensureFixtureFormStartPicker,
  ensureFixtureFormCountPicker,
  ensureFixtureFormQtyPicker,
  ensureFixtureFormGroupPicker,
  batchFixtureNames,
  suggestFixtureFormStart,
  renderFixtures,
  addFixtureGroup,
} from "./fixtures-page.js";

// ---------------------------------------------------------------------
// Universes: count, outputs (DMX USB Pro / Art-Net / sACN), Channels-tab meter universe
// ---------------------------------------------------------------------

/** The DMX outputs changed: redraw the page header and the meters' universe picker. */
function renderOutputs() {
  notifyHeader();
  syncMeterUniverse();
}

async function toggleOutput(u) {
  const out = outputs[u - 1];
  const label = state.universes > 1 ? `Universe ${u}` : "DMX Pro";
  if (out.connected) {
    await out.disconnect();
    renderOutputs();
    setStatus(`${label} disconnected`, "idle");
    return;
  }
  try {
    setStatus(state.universes > 1 ? `Looking for the DMX USB Pro for universe ${u}…` : "Looking for the DMX USB Pro…", "idle");
    await out.connect();
    renderOutputs();
    setStatus(`${label} connected`, "connected");
  } catch (err) {
    renderOutputs();
    setStatus(err instanceof Error ? err.message : "Connection failed", "error");
    console.error(err);
  }
}

/** Send universe u to an Art-Net / sACN node, or stop that (null). */
async function setNetworkOutput(u, output) {
  const out = outputs[u - 1];
  const label = state.universes > 1 ? `Universe ${u}` : "DMX";
  try {
    await out.setNetwork(output);
    renderOutputs();
    setStatus(out.network ? `${label} → ${out.network}` : `${label}: network output stopped`, out.network ? "connected" : "idle");
  } catch (err) {
    setStatus(err instanceof Error ? err.message : "Couldn't set the network output", "error");
  }
}

/** Art-Net nodes on the show server's network: [{ ip, name, ports: [{ port, netUniverse }] }]. */
async function discoverNodes() {
  const reply = await state.serverLink.request({ type: "net-discover" });
  if (!reply.ok) throw new Error(reply.error ?? "Search failed");
  return reply.nodes;
}

/** Change the universe count; refuses to drop universes that are in use. */
function setUniverses(n) {
  const next = Math.max(1, Math.min(MAX_UNIVERSES, Math.round(n) || 1));
  if (next < state.universes) {
    const limit = next * UNIVERSE_SIZE;
    const usedPatch = state.patch.some((targets) => targets.some((t) => t.channel > limit));
    const usedBy = state.fixtures.find((i) => i.channelEnd > limit);
    if (usedPatch || usedBy) {
      setStatus(
        `Universe ${next + 1}+ is in use (${usedBy ? usedBy.name : "patched faders"}) — move or remove that first`,
        "error",
      );
      renderOutputs();
      return;
    }
    for (let u = next + 1; u <= MAX_UNIVERSES; u++) {
      if (outputs[u - 1].connected) void outputs[u - 1].disconnect();
      if (outputs[u - 1].network) void outputs[u - 1].setNetwork(null);
    }
  }
  state.universes = next;
  setUniverseCount(state.universes);
  if (state.meterUniverse > state.universes) state.meterUniverse = state.universes;
  renderOutputs();
  renderFixtures();
  suggestFixtureFormStart();
  renderPatchTable();
  refreshFaderPatchLabels();
  renderChannelRow();
  ensureFixtureFormStartPicker();
  pushToDmx();
  setStatus(state.universes === 1 ? "1 universe" : `${state.universes} universes · channels shown as universe/channel`, "idle");
}
meterUniverseSelect.className = "meter-universe";
meterUniverseSelect.title = "Universe shown by the meters";
meterUniverseSelect.addEventListener("change", () => {
  state.meterUniverse = Number(meterUniverseSelect.value) || 1;
  renderChannelRow();
});
pageChannels.querySelector(".page-intro")?.append(meterUniverseSelect);

function syncMeterUniverse() {
  meterUniverseSelect.hidden = state.universes < 2;
  meterUniverseSelect.replaceChildren(
    ...Array.from({ length: state.universes }, (_, i) => {
      const opt = document.createElement("option");
      opt.value = String(i + 1);
      opt.textContent = `Universe ${i + 1}`;
      return opt;
    }),
  );
  meterUniverseSelect.value = String(state.meterUniverse);
}

function syncMasterUi() {
  masterInput.value = String(Math.round(state.master));
  masterValue.textContent = `${Math.round(state.master)}%`;
  syncSubmasterLive();
}

masterInput.addEventListener("input", () => {
  state.master = Number(masterInput.value);
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

crossfader.addEventListener("input", () => {
  setCross(Number(crossfader.value), { fromUser: true });
});

goBtn.addEventListener("click", () => {
  goNextCue();
});
prevCueBtn.addEventListener("click", () => stepLiveCue(-1));
nextCueBtn.addEventListener("click", () => stepLiveCue(1));

fadePauseBtn.addEventListener("click", () => {
  toggleFadePause();
});

wireCurrentCueTitle(currentCueTitle);

channelsCueMenuBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  if (channelsCueMenuBtn.getAttribute("aria-expanded") === "true") {
    closeChannelsCueMenu?.();
    return;
  }
  void openChannelsCueMenu(channelsCueMenuBtn);
});

addCueBtn.addEventListener("click", async () => {
  const song = getActiveSong();
  if (song.cues.length >= MAX_CUES) return;
  // New cues are just numbered; double-click one to give it a name.
  song.cues.push(createCue({ name: "" }));
  bindActiveSong();
  state.selectedCue = state.cueLevels.length - 1;
  state.fromCue = state.selectedCue;
  syncPlaybackPair();
  renderCues();
  renderSelectedGroup();
  pushToDmx();
  persistSession();
});

identityBtn.addEventListener("click", () => {
  state.patch = identityPatch();
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
  state.patch = defaultPatch();
  persistAndRefresh();
  renderPatchTable();
});

/**
 * Replace the whole show. `fromServer`: another console (or the server) changed
 * it, so leave the fade and held buttons alone.
 */
function applyShow(next, { fromServer = false } = {}) {
  if (!fromServer) {
    stopTimedFade();
    blackedOutFaders.clear();
    flashingFaders.clear();
  }
  state.showName = normalizeShowName(next.showName);
  state.navOrder = normalizeNavOrder(next.navOrder);
  state.master = next.master;
  state.cross = next.cross;
  state.fromSub = next.fromSub ?? 100;
  state.toSub = next.toSub ?? 100;
  state.universes = normalizeUniverses(next.universes);
  setUniverseCount(state.universes);
  renderOutputs();
  state.fromCue = next.fromCue;
  state.toCue = next.toCue;
  state.selectedCue = next.selectedCue ?? 0;
  state.songs = normalizeSongs(next.songs);
  state.activeSongId = resolveActiveSong(state.songs, next.activeSongId).id;
  state.sets = normalizeSets(next.sets, state.songs);
  state.activeSetId = next.activeSetId;
  state.activeEntryId = next.activeEntryId;
  bindActiveSong();
  state.faderNames = normalizeFaderNames(next.faderNames);
  state.fixtureGroups = normalizeFixtureGroups(next.fixtureGroups);
  state.fixtures = normalizeFixtures(next.fixtures, state.fixtureGroups);
  if (
    state.fixtureFormGroupId &&
    !state.fixtureGroups.some((group) => group.id === state.fixtureFormGroupId)
  ) {
    state.fixtureFormGroupId = null;
  }
  state.patch = next.patch;

  applyNavOrder(state.navOrder);
  syncShowNameUi();
  syncSongUi();
  syncMasterUi();
  syncSubmasterUi();
  syncCrossUi();
  updateFadePauseButton();

  renderCues();
  renderLiveRow();
  renderChannelRow();
  renderSelectedGroup();
  renderShowPage();
  renderSetPage();
  renderFixtures();
  renderPatchTable();
  pushToDmx();
}

function syncTransportFromState() {
  syncMasterUi();
  syncSubmasterUi();
  syncCrossUi();
  refreshCueSelects();
  updateFadePauseButton();
}

/** Start a blank show called `name` (the page header asks first if there are unsaved changes). */
function newShow(name) {
  applyShow(blankShowState(name));
  markClean();
  persistSession();
  setStatus(`New show · ${state.showName}`, dmx.connected ? "connected" : "idle");
}

/** Download the show, with the stage the show server keeps alongside it. */
async function saveShow() {
  const reply = await state.serverLink.request({ type: "get-stage" });
  downloadShow(currentShowState(), undefined, reply.ok ? reply.stage : null);
  markClean();
  setStatus(reply.ok ? "Show saved" : "Show saved (without the stage: the show server is offline)", dmx.connected ? "connected" : "idle");
}

/**
 * Load a show file's text (the page header asks first if there are unsaved
 * changes). Its stage, if it has one, replaces the stage.
 */
function loadShow(text, fileName) {
  try {
    const data = JSON.parse(text);
    applyShow(parseShow(data));
    markClean();
    if (data.stage && typeof data.stage === "object") state.serverLink.sendStage(data.stage);
    setStatus(`Show loaded · ${fileName}`, dmx.connected ? "connected" : "idle");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load show";
    setStatus(message, "error");
    console.error(err);
  }
}

window.addEventListener("hashchange", routeFromHash);

fixtureForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (state.fixtures.length >= MAX_FIXTURES) return;
  const name = fixtureNameInput.value.trim();
  if (!name) {
    fixtureNameInput.reportValidity();
    return;
  }
  const width = Math.max(1, Math.round(fixtureFormCount) || 1);
  const qty = Math.min(
    MAX_FIXTURE_QTY,
    Math.max(1, Math.round(fixtureFormQty) || 1),
    MAX_FIXTURES - state.fixtures.length,
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
      state.fixtures,
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
    state.fixtureFormGroupId &&
    state.fixtureGroups.some((group) => group.id === state.fixtureFormGroupId)
      ? state.fixtureFormGroupId
      : null;
  const mount = normalizeMount(
    mountRadio instanceof HTMLInputElement ? mountRadio.value : "fixed",
  );
  const color = normalizeColorMode(
    colorRadio instanceof HTMLInputElement ? colorRadio.value : "single",
  );
  const names = batchFixtureNames(name, qty);
  for (let i = 0; i < qty; i++) {
    state.fixtures.push(
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
  state.fixtureFormGroupId = groupId;
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

addSongBtn.addEventListener("click", () => {
  void addSong();
});

ensureFixtureFormStartPicker();
ensureFixtureFormCountPicker();
ensureFixtureFormQtyPicker();
ensureFixtureFormGroupPicker();
suggestFixtureFormStart();
wireNavReorder();
applyNavOrder(state.navOrder);
syncShowNameUi();
syncSongUi();
syncTransportFromState();
renderLiveRow();
renderChannelRow();
renderSelectedGroup();
renderCues();
renderShowPage();
renderFixtures();
renderPatchTable();
renderOutputs();
routeFromHash();
persistSession();
markClean();

// ---------------------------------------------------------------------
// Fixtures registered from the stage (see stage-link.js)
// ---------------------------------------------------------------------
// Placing a fixture on the stage registers it here: a console fixture at
// the next free DMX block, one fader per channel (an unnamed fader already
// patched to just that channel, else a free one) named after the stage fixture, and
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
    if (state.fixtures.length >= MAX_FIXTURES) { fail(`the console already has its maximum of ${MAX_FIXTURES} fixtures`); continue; }
    const universe = Number.isInteger(req.universe) && req.universe >= 1 && req.universe <= state.universes ? req.universe : null;
    const range = nextAvailableRange(state.fixtures, width, universe);
    if (!range) { fail(`no free block of ${width} DMX channel${width > 1 ? "s" : ""} left${universe ? ` in universe ${universe}` : ""}`); continue; }
    // Per channel: a fader already patched to just that channel and still
    // default-named (e.g. a 1:1 patch) is taken over; otherwise a free one.
    const claimed = new Set();
    const spare = (i) => !claimed.has(i) && state.patch[i].length === 1 && faderName(i) === defaultFaderName(i);
    const faders = [];
    for (let k = 0; k < width; k++) {
      const channel = range.channelStart + k;
      let fader = state.patch.findIndex((targets, i) => spare(i) && targets[0].channel === channel);
      if (fader < 0) fader = state.patch.findIndex((targets, i) => !claimed.has(i) && isUnpatched(targets));
      if (fader < 0) break;
      claimed.add(fader);
      faders.push(fader);
    }
    if (faders.length < width) { fail(`needs ${width} free fader${width > 1 ? "s" : ""}, only ${faders.length} left`); continue; }

    let groupId = null;
    if (req.group) {
      let group = state.fixtureGroups.find((g) => g.name === req.group);
      if (!group && state.fixtureGroups.length < MAX_FIXTURE_GROUPS) {
        group = createFixtureGroup({ name: req.group });
        state.fixtureGroups.push(group);
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
    state.fixtures.push(fixture);
    faders.forEach((fader, k) => {
      state.patch[fader] = [makeTarget(range.channelStart + k, 255)];
      state.faderNames[fader] = `${req.name} ${req.labels[k] ?? k + 1}`.slice(0, 40);
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
    const fixture = state.fixtures.find((item) => item.id === id);
    if (!fixture) continue;
    const inBlock = (t) => t.channel >= fixture.channelStart && t.channel <= fixture.channelEnd;
    for (let i = 0; i < FADER_COUNT; i++) {
      if (!state.patch[i].some(inBlock)) continue;
      state.patch[i] = state.patch[i].filter((t) => !inBlock(t));
      if (state.patch[i].length) continue;
      // Fader is free again: default name, 0 in every cue of every song.
      state.faderNames[i] = "";
      for (const song of state.songs) for (const cue of song.cues) cue.levels[i] = 0;
    }
    state.fixtures = state.fixtures.filter((item) => item.id !== id);
    const { groupId } = fixture;
    if (groupId && !state.fixtures.some((item) => item.groupId === groupId)) {
      state.fixtureGroups = state.fixtureGroups.filter((g) => g.id !== groupId);
      if (state.fixtureFormGroupId === groupId) state.fixtureFormGroupId = null;
    }
    removed++;
  }
  if (removed) afterStageFixturesChanged();
}

/**
 * Take channel roles from the stage that a console fixture it linked is
 * missing (e.g. amber on a fixture registered before amber was a role) and
 * its color roles (e.g. deep red, once it had its own), so its color bar
 * covers every emitter. Other roles the console has are kept.
 * @param {{ consoleId?: string | null, layout?: (string | null)[] }[]} stageFixtures
 */
function adoptRolesFromStage(stageFixtures) {
  let changed = false;
  for (const sf of stageFixtures) {
    const fixture = sf.consoleId && state.fixtures.find((f) => f.id === sf.consoleId);
    if (!fixture || !Array.isArray(sf.layout) || !fixture.roles?.length) continue;
    const roles = normalizeRoles(sf.layout);
    const color = (r) => COLOR_ROLES.includes(r);
    roles.forEach((role, k) => {
      if (!role || k >= fixture.roles.length || fixture.roles[k] === role) return;
      if (fixture.roles[k] ? !(color(role) && color(fixture.roles[k])) : fixture.roles.includes(role) && !color(role)) return;
      fixture.roles[k] = role;
      changed = true;
    });
  }
  if (changed) afterStageFixturesChanged();
}

function afterStageFixturesChanged() {
  renderFixtures();
  suggestFixtureFormStart();
  renderLiveRow();
  renderCues();
  renderSelectedGroup();
  renderPatchTable();
  ensureChannelRow();
  pushToDmx();
}

// Fader blocks scroll sideways (256 faders): keep them lined up, so the Live
// strip and every cue row show the same faders. The cue rows and the Live
// strip have no scrollbar of their own: one bar at the bottom of the cue
// area (cuesHScroll) scrolls them all.
let syncingFaderScroll = false;
document.addEventListener(
  "scroll",
  (event) => {
    const el = event.target;
    if (syncingFaderScroll || !(el instanceof HTMLElement)) return;
    const isFaders = el.classList.contains("faders") && !el.classList.contains("channel-faders");
    if (!isFaders && el !== cuesHScroll) return;
    syncingFaderScroll = true;
    for (const other of [...document.querySelectorAll(".faders:not(.channel-faders)"), cuesHScroll]) {
      if (other !== el) other.scrollLeft = el.scrollLeft;
    }
    syncingFaderScroll = false;
  },
  true,
);

/** Give the cue-area scrollbar the same scroll range as a cue row (hidden when nothing overflows). */
function fitCuesHScroll() {
  const row = cuesEl.querySelector(".faders");
  const extra = row ? row.scrollWidth - row.clientWidth : 0;
  cuesHScroll.hidden = extra <= 0;
  if (extra <= 0) return;
  /** @type {HTMLElement} */ (cuesHScroll.firstElementChild).style.width = `${cuesHScroll.clientWidth + extra}px`;
  cuesHScroll.scrollLeft = row.scrollLeft;
}
new ResizeObserver(fitCuesHScroll).observe(cuesScroll);
new MutationObserver(fitCuesHScroll).observe(cuesEl, { childList: true });

// For the page header (../index.html): what it shows, and the actions it offers.
const consoleHeader = {
  state: () => ({
    showName: state.showName,
    status: state.status,
    serverLive: state.serverLive,
    serverHost: location.host,
    universes: state.universes,
    maxUniverses: MAX_UNIVERSES,
    outputs: outputs.slice(0, state.universes).map((out) => ({ usb: out.connected, network: out.network })),
  }),
  /** Call `fn` now and whenever the header's state changes; returns an unsubscribe. */
  subscribe(fn) {
    headerListeners.add(fn);
    fn();
    return () => headerListeners.delete(fn);
  },
  isDirty,
  rename: applyShowName,
  newShow,
  saveShow,
  loadShow,
  toggleOutput: (u) => void toggleOutput(u),
  setNetworkOutput: (u, output) => void setNetworkOutput(u, output),
  discoverNodes,
  setUniverses,
};
window.consoleHeader = consoleHeader;
window.onConsoleHeader?.(consoleHeader);

// Live link to the stage: send output levels, apply fader moves made there.
startStageLink({
  levels: computeChannelLevels,
  patch: () => state.patch,
  live: () => ({ cueLevels: getPlaybackLevels(), fromCue: state.fromCue, toCue: state.toCue, fromSub: state.fromSub, toSub: state.toSub, cross: state.cross, master: state.master }),
  fixtures: () => state.fixtures,
  groups: () => state.fixtureGroups,
  faderInfo: () => Array.from({ length: FADER_COUNT }, (_, i) => ({
    num: i + 1,
    name: faderName(i),
    live: liveLevel(i),
    from: state.cueLevels[state.fromCue]?.[i] ?? 0,
    to: getPlaybackLevels()[state.toCue]?.[i] ?? 0,
    patch: state.patch[i],
  })),
  mix: () => ({ master: state.master, fromSub: state.fromSub, toSub: state.toSub, cross: state.cross, fromName: cueLabel(state.fromCue), toName: cueLabel(state.toCue) }),
  universes: () => state.universes,
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
    for (const els of [liveUi.valueEls, selectedGroupUi.sliders, ...cueUi.map((ui) => ui.sliders)]) {
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
  adoptRoles: adoptRolesFromStage,
  reveal: revealFixtures,
});

// ---------------------------------------------------------------------
// Show server (see server-link.js): it holds the show, runs fades and
// drives the DMX; this console mirrors it and sends its edits there.
// ---------------------------------------------------------------------

const offlineCover = document.createElement("div");
offlineCover.className = "server-offline";
offlineCover.innerHTML = "<div><strong>Connecting to the show server…</strong><span>Start it with <code>./server.sh</code> on the machine the DMX USB Pro is plugged into.</span></div>";
document.getElementById("consolePane").append(offlineCover);

/** Show fields the server sent that are live values (it sends these separately). */
function withLive(show, live) {
  const state = parseShow(show);
  const current = currentShowState();
  // A live value missing here was just changed on this console: keep ours.
  for (const f of LIVE_FIELDS) state[f] = f in live ? live[f] : current[f];
  return state;
}

/** Live mix from the server (fade steps, other consoles' moves, GO arriving). */
function applyServerLive(live) {
  const before = { fromCue: state.fromCue, selectedCue: state.selectedCue };
  if ("master" in live) state.master = live.master;
  if ("cross" in live) state.cross = live.cross;
  if ("fromSub" in live) state.fromSub = live.fromSub;
  if ("toSub" in live) state.toSub = live.toSub;
  if ("fromCue" in live) state.fromCue = live.fromCue;
  if ("selectedCue" in live) state.selectedCue = live.selectedCue;
  syncPlaybackPair();
  state.fadeState = live.fade ?? null;
  state.serverFlashing = new Set(live.flashing ?? []);
  state.serverBlackedOut = new Set(live.blackedOut ?? []);

  syncMasterUi();
  syncSubmasterUi();
  syncCrossUi();
  updateFadePauseButton();
  if (state.fromCue !== before.fromCue || state.selectedCue !== before.selectedCue) showArrivedCue();
  pushToDmx({ persist: false, fromServer: true });
}

state.serverLink = createServerLink({
  view: () => ({
    show: currentShowState(),
    flashing: flashingFaders,
    blackedOut: blackedOutFaders,
  }),
  onHello: ({ show, live, outputs: list }) => {
    state.outputStatus = list ?? [];
    if (show) {
      applyShow(withLive(show, live ?? {}), { fromServer: true });
      applyServerLive(live ?? {});
      markClean();
    }
    renderOutputs();
  },
  onShow: (show, live) => {
    applyShow(withLive(show, live), { fromServer: true });
    applyServerLive(live);
  },
  onLive: applyServerLive,
  onLevels: (cells) => {
    if (!cells.length) return;
    const byId = new Map();
    for (const song of state.songs) for (const t of song.cues) byId.set(t.id, t);
    for (const [id, fader, value] of cells) {
      const t = byId.get(id);
      if (t) t.levels[fader] = value;
    }
    pushToDmx({ fromServer: true });
  },
  onOutputs: (list) => {
    state.outputStatus = list;
    renderOutputs();
  },
  onConnection: (connected) => {
    offlineCover.classList.toggle("is-connected", connected);
    state.serverLive = connected;
    renderOutputs();
    if (connected) {
      // The Server pill shows the connection; clear an "offline" message.
      setStatus("", "idle");
    } else {
      setStatus("Show server offline — reconnecting…", "error");
    }
  },
});

// The console (its pane in ../index.html): starts it up and wires its controls;
// show new / load / save, universes and DMX outputs, fixtures placed on the
// stage, the app header's hooks (consoleHeader), and the link to the show
// server. The console's tabs themselves are in the modules imported below.
import { startStageLink } from "./stage-link.ts";
import { blankStage } from "../stage/stage-model.ts";
import type { GoButton, RegisterRequest, RegisterResult, StageLayout } from "../shared/console-stage.ts";
import { createServerLink } from "./server-link.ts";
import { LIVE_FIELDS } from "../shared/live-fields.ts";
import { DMX_SHORT, type DmxAttr } from "../shared/attributes.ts";
import { isColorRole } from "../shared/color.ts";
import { $, elById } from "../shared/query.ts";
import type { ArtNetNode, Live, NetOutputSetting } from "../shared/protocol.ts";
import {
  type ShowData,
  defaultFaderName,
  downloadShow,
  normalizeFaderNames,
  normalizeNavOrder,
  normalizeShowName,
  parseShow,
  serializeShow,
  normalizeUniverses,
} from "./show.ts";
import { type Look, type Song, createCue, createStep, stepLook, createSong, MAX_CUES, MAX_CUE_STEPS, MAX_SONGS, MIN_CUES, moveCue, normalizeCueFadeTime, normalizeSongName, normalizeSongs, resolveActiveSong } from "./songs.ts";
import {
  type PatchTarget,
  FADER_COUNT,
  identityPatch,
  defaultPatch,
  makeTarget,
  UNIVERSE_SIZE,
  MAX_UNIVERSES,
  setUniverseCount,
  parseAddress,
  formatAddress,
} from "./patch.ts";
import {
  createFixture,
  createFixtureGroup,
  findRangeConflict,
  formatChannelRange,
  type ChannelRange,
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
} from "./fixtures.ts";
import { goTarget, MAX_SET_ENTRIES, normalizeSets, playbackCue, type ShowSet } from "./sets.ts";
import { allAims, applyAims, applyReaims } from "./aims.ts";
import {
  currentCueTitle,
  channelsCueMenuBtn,
  masterInput,
  masterValue,
  fromSubInput,
  toSubInput,
  crossfader,
  goBtn,
  goStepBtn,
  goStepBackBtn,
  prevCueBtn,
  nextCueBtn,
  addCueBtn,
  addSongBtn,
  identityBtn,
  clearPatchBtn,
  tabChannels,
  fixtureForm,
  fixtureNameInput,
  addFixtureGroupBtn,
  meterUniverseSelect,
  cuesScroll,
  cuesEl,
  cuesHScroll,
  closePopup,
} from "./dom.ts";
import {
  blankShowState,
  getActiveSong,
  getActiveSet,
  getPlaybackLevels,
  bindActiveSong,
  syncPlaybackPair,
  headerListeners,
  notifyHeader,
  type FileState,
  setStatus,
  persistSession,
  currentShowState,
  markClean,
  isDirty,
  serverLink,
  state,
} from "./state.ts";
import {
  cueLabel,
  faderName,
  isUnpatched,
  liveLevel,
  revealFixtures,
  fixtureOutlineColors,
  holdFromStage,
  refreshFaderPatchLabels,
  syncSlidersFromState,
  confirmAction,
} from "./faders.ts";
import {
  outputs,
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
  syncGoButton,
  stopTimedFade,
  goNextCue,
  stepLiveCue,
  stepNextCue,
  goArea,
  stepBackCue,
  setSelectedCue,
  showArrivedCue,
  toggleFadePause,
  followFade,
} from "./live.ts";
import { syncSongUi, renderShowTab, addSong, setActiveSong, copySong, removeSong, moveSongTo } from "./show-tab.ts";
import { renderSetTab, addToSet, removeFromSet, reorderSet, runSet, playSetEntry, addSet, renameSetTo, copySet, removeSet } from "./set-tab.ts";
import {
  cueUi,
  renderCues,
  wireCurrentCueTitle,
  openChannelsCueMenu,
} from "./cues.ts";
import { renderPatchTable } from "./patch-tab.ts";
import {
  syncShowNameUi,
  applyShowName,
  applyNavOrder,
  wireNavReorder,
  routeFromHash,
} from "./nav.ts";
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
} from "./fixtures-tab.ts";
import { errorMessage } from "../shared/guards.ts";
import { el } from "../shared/html.ts";
import { clamp, clampByte, clampInt } from "../shared/numbers.ts";
import { asUniverse } from "../shared/address.ts";

// ---------------------------------------------------------------------
// Universes: count, outputs (DMX USB Pro / Art-Net / sACN), Channels-tab meter universe
// ---------------------------------------------------------------------

/** The DMX outputs changed: redraw the page header and the meters' universe picker. */
function renderOutputs() {
  notifyHeader();
  syncMeterUniverse();
}

async function toggleOutput(u: number) {
  const out = outputs[u - 1];
  const label = state.universes > 1 ? `Universe ${u}` : "DMX Pro";
  if (out.connected) {
    await out.disconnect();
    renderOutputs();
    setStatus(`${label} disconnected`, "info");
    return;
  }
  try {
    setStatus(state.universes > 1 ? `Looking for the DMX USB Pro for universe ${u}…` : "Looking for the DMX USB Pro…", "info");
    await out.connect();
    renderOutputs();
    setStatus(`${label} connected`, "info");
  } catch (err) {
    renderOutputs();
    setStatus(errorMessage(err, "Connection failed"), "error");
    console.error(err);
  }
}

/** Send universe u to an Art-Net / sACN node, or stop that (null). */
async function setNetworkOutput(u: number, output: NetOutputSetting | null) {
  const out = outputs[u - 1];
  const label = state.universes > 1 ? `Universe ${u}` : "DMX";
  try {
    await out.setNetwork(output);
    renderOutputs();
    setStatus(out.network ? `${label} → ${out.network}` : `${label}: network output stopped`, "info");
  } catch (err) {
    setStatus(errorMessage(err, "Couldn't set the network output"), "error");
  }
}

/** Art-Net nodes on the show server's network: [{ ip, name, ports: [{ port, netUniverse }] }]. */
async function discoverNodes(): Promise<ArtNetNode[]> {
  const reply = await serverLink().request({ type: "net-discover" });
  if (!reply.ok) throw new Error(reply.error);
  return reply.nodes;
}

/** Why the show can't go down to `next` universes (a fixture or patch uses a later one), or null. */
function universesInUse(next: number): string | null {
  if (next >= state.universes) return null;
  const limit = next * UNIVERSE_SIZE;
  const usedPatch = state.patch.some((targets) => targets.some((t) => t.channel > limit));
  const usedBy = state.fixtures.find((i) => i.channelEnd > limit);
  return usedPatch || usedBy ? `Universe ${next + 1}+ is in use (${usedBy ? usedBy.name : "patched faders"}) — move or remove that first` : null;
}

/** Change the universe count; refuses to drop universes that are in use. */
function setUniverses(n: number) {
  const next = clampInt(n, 1, MAX_UNIVERSES);
  if (next < state.universes) {
    const why = universesInUse(next);
    if (why) {
      setStatus(why, "error");
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
  if (state.meterUniverse > state.universes) state.meterUniverse = asUniverse(state.universes);
  renderOutputs();
  renderFixtures();
  suggestFixtureFormStart();
  renderPatchTable();
  refreshFaderPatchLabels();
  renderChannelRow();
  ensureFixtureFormStartPicker();
  pushToDmx();
  setStatus(state.universes === 1 ? "1 universe" : `${state.universes} universes · channels shown as universe/channel`, "info");
}
meterUniverseSelect.className = "meter-universe";
meterUniverseSelect.title = "Universe shown by the meters";
meterUniverseSelect.addEventListener("change", () => {
  state.meterUniverse = asUniverse(Number(meterUniverseSelect.value) || 1);
  renderChannelRow();
});
tabChannels.querySelector<HTMLElement>(".tab-intro")?.append(meterUniverseSelect);

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

/**
 * A GO pressed twice in quick succession (to be sure) mustn't pause the fade
 * the first press started: GO only becomes Pause this long after.
 */
const PAUSE_GUARD_MS = 600;
let lastGoAt = -Infinity;

/** The GO area's buttons: here, and the 3D view's GO bar (console/stage-link.ts), which does exactly the same. */
function goPress(button: GoButton) {
  const area = goArea();
  if (!area.buttons[button].enabled) return;
  if (button === "go") {
    // GO is Pause while its fade plays, Resume once paused.
    if (area.goMode === "pause") {
      if (performance.now() - lastGoAt >= PAUSE_GUARD_MS) toggleFadePause();
    } else if (area.goMode === "resume") toggleFadePause();
    else {
      lastGoAt = performance.now();
      goNextCue();
    }
  }
  else if (button === "step") stepNextCue();
  else if (button === "stepBack") stepBackCue();
  else stepLiveCue(button === "prevCue" ? -1 : 1);
}
goBtn.addEventListener("click", () => goPress("go"));
goStepBtn.addEventListener("click", () => goPress("step"));
goStepBackBtn.addEventListener("click", () => goPress("stepBack"));
prevCueBtn.addEventListener("click", () => goPress("prevCue"));
nextCueBtn.addEventListener("click", () => goPress("nextCue"));

wireCurrentCueTitle(currentCueTitle);

channelsCueMenuBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  if (channelsCueMenuBtn.getAttribute("aria-expanded") === "true") {
    closePopup();
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
  state.liveStep = -1;
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
function applyShow(next: ShowData, { fromServer = false } = {}) {
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
  state.liveStep = next.liveStep ?? -1;
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
  syncGoButton();

  renderCues();
  renderLiveRow();
  renderChannelRow();
  renderSelectedGroup();
  renderShowTab();
  renderSetTab();
  renderFixtures();
  renderPatchTable();
  pushToDmx();
}

function syncTransportFromState() {
  syncMasterUi();
  syncSubmasterUi();
  syncCrossUi();
  refreshCueSelects();
  syncGoButton();
}

/**
 * Start a blank show called `name` (the page header asks first if there are
 * unsaved changes), and download its show file straight away, as Save show does.
 */
async function newShow(name?: string) {
  applyShow(blankShowState(name));
  persistSession();
  // Its stage and chats too: the show server keeps them with the show, and every window takes them.
  // Sent before Save's request on the same connection, so the file has them.
  serverLink().sendShowFile(blankStage(), []);
  const saved = await downloadShowFile();
  noteFile("new", saved);
}

/** A show file was saved, loaded or started: the header shows it beside the show's name (a saved file missing the stage and chats is also an error). */
function noteFile(how: FileState["how"], complete = true, file?: string) {
  state.fileState = { how, at: Date.now(), file };
  if (complete) notifyHeader();
  else setStatus("Saved without the stage and chats: the show server is offline", "error");
}

/** Download the show, with the stage and chats the show server keeps alongside it. */
async function saveShow() {
  noteFile("saved", await downloadShowFile());
}

/** Download the show file; false if the show server was offline (the file then has no stage or chats). */
async function downloadShowFile(): Promise<boolean> {
  const reply = await serverLink().request({ type: "get-show-file" });
  downloadShow(currentShowState(), undefined, reply.ok ? { stage: reply.stage, chats: reply.chats } : null);
  markClean();
  return reply.ok;
}

/**
 * Load a show file's text (the page header asks first if there are unsaved
 * changes). Its stage and chats replace the stage and chats (a blank stage
 * and no chats, if it has none).
 */
function loadShow(text: string, fileName: string) {
  try {
    const data = JSON.parse(text);
    applyShow(parseShow(data));
    markClean();
    // A file without them (older, or saved while the show server was offline) gets a blank stage and no chats, not the last show's.
    serverLink().sendShowFile(data.stage && typeof data.stage === "object" ? data.stage : blankStage(), Array.isArray(data.chats) ? data.chats : []);
    noteFile("loaded", true, fileName);
  } catch (err) {
    const message = errorMessage(err, "Failed to load show");
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

  const ranges: ChannelRange[] = [];
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
    "done",
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
renderShowTab();
renderFixtures();
renderPatchTable();
renderOutputs();
routeFromHash();
persistSession();
markClean();

// ---------------------------------------------------------------------
// Fixtures registered from the stage (see stage-link.ts)
// ---------------------------------------------------------------------
// Placing a fixture on the stage registers it here: a console fixture at
// the next free DMX block, one fader per channel (an unnamed fader already
// patched to just that channel, else a free one) named after the stage fixture, and
// the fader rows scrolled to them. Deleting it on the stage removes it and
// frees the faders.

function registerFromStage(requests: RegisterRequest[]): RegisterResult[] {
  const results: RegisterResult[] = [];
  for (const req of requests) {
    const fail = (error: string) => results.push({ stageId: req.stageId, ok: false, error });
    const width = clampInt(req.width, 1, MAX_FIXTURE_CHANNELS);
    if (state.fixtures.length >= MAX_FIXTURES) { fail(`the console already has its maximum of ${MAX_FIXTURES} fixtures`); continue; }
    const u = req.universe;
    const universe = u != null && Number.isInteger(u) && u >= 1 && u <= state.universes ? asUniverse(u) : null;
    const range = nextAvailableRange(state.fixtures, width, universe);
    if (!range) { fail(`no free block of ${width} DMX channel${width > 1 ? "s" : ""} left${universe ? ` in universe ${universe}` : ""}`); continue; }
    // Per channel: a fader already patched to just that channel and still
    // default-named (e.g. a 1:1 patch) is taken over; otherwise a free one.
    const claimed = new Set<number>();
    const spare = (i: number) => !claimed.has(i) && state.patch[i].length === 1 && faderName(i) === defaultFaderName(i);
    const faders: number[] = [];
    for (let k = 0; k < width; k++) {
      const channel = range.channelStart + k;
      let fader = state.patch.findIndex((targets, i) => spare(i) && targets[0].channel === channel);
      if (fader < 0) fader = state.patch.findIndex((targets, i) => !claimed.has(i) && isUnpatched(targets));
      if (fader < 0) break;
      claimed.add(fader);
      faders.push(fader);
    }
    if (faders.length < width) { fail(`needs ${width} free fader${width > 1 ? "s" : ""}, only ${faders.length} left`); continue; }

    let groupId: string | null = null;
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
    revealFixtures(results.flatMap((r) => (r.ok ? [r.consoleId] : [])));
  }
  return results;
}

/** Remove stage-registered fixtures: unpatch, rename and zero their faders. */
function unregisterFromStage(consoleIds: string[]) {
  let removed = 0;
  for (const id of consoleIds) {
    const fixture = state.fixtures.find((item) => item.id === id);
    if (!fixture) continue;
    const inBlock = (t: PatchTarget) => t.channel >= fixture.channelStart && t.channel <= fixture.channelEnd;
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
 */
function adoptRolesFromStage(stageFixtures: StageLayout[]) {
  let changed = false;
  for (const sf of stageFixtures) {
    const fixture = sf.consoleId && state.fixtures.find((f) => f.id === sf.consoleId);
    const own = fixture ? fixture.roles : null;
    if (!own?.length || !Array.isArray(sf.layout)) continue;
    const roles = normalizeRoles(sf.layout);
    roles.forEach((role, k) => {
      const was = own[k];
      if (!role || k >= own.length || was === role) return;
      if (was ? !(isColorRole(role) && isColorRole(was)) : own.includes(role) && !isColorRole(role)) return;
      own[k] = role;
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
    for (const other of [...document.querySelectorAll<HTMLElement>(".faders:not(.channel-faders)"), cuesHScroll]) {
      if (other !== el) other.scrollLeft = el.scrollLeft;
    }
    syncingFaderScroll = false;
  },
  true,
);

/** Give the cue-area scrollbar the same scroll range as a cue row (hidden when nothing overflows). */
function fitCuesHScroll() {
  const row = cuesEl.querySelector<HTMLElement>(".faders");
  const extra = row ? row.scrollWidth - row.clientWidth : 0;
  cuesHScroll.hidden = extra <= 0;
  if (!row || extra <= 0) return;
  $(cuesHScroll, ":scope > *").style.width = `${cuesHScroll.clientWidth + extra}px`;
  cuesHScroll.scrollLeft = row.scrollLeft;
}
new ResizeObserver(fitCuesHScroll).observe(cuesScroll);
new MutationObserver(fitCuesHScroll).observe(cuesEl, { childList: true });

// For the page header (../index.html): what it shows, and the actions it offers.
const consoleHeader = {
  state: () => ({
    showName: state.showName,
    status: state.status,
    file: state.fileState,
    serverLive: state.serverLive,
    serverHost: location.host,
    universes: state.universes,
    maxUniverses: MAX_UNIVERSES,
    outputs: outputs.slice(0, state.universes).map((out) => ({ usb: out.connected, network: out.network })),
  }),
  /** Call `fn` now and whenever the header's state changes; returns an unsubscribe. */
  subscribe(fn: () => void) {
    headerListeners.add(fn);
    fn();
    return () => headerListeners.delete(fn);
  },
  isDirty,
  rename: applyShowName,
  newShow,
  saveShow,
  loadShow,
  toggleOutput: (u: number) => void toggleOutput(u),
  setNetworkOutput: (u: number, output: NetOutputSetting | null) => void setNetworkOutput(u, output),
  discoverNodes,
  setUniverses,
};
export type ConsoleHeader = typeof consoleHeader;

declare global {
  interface Window {
    /** The console's hooks for the page header (page/page.ts). */
    consoleHeader?: ConsoleHeader;
    /** Set by the page header if it starts first: called once the console is ready. */
    onConsoleHeader?: (header: ConsoleHeader) => void;
    /** The console's hooks for the chat panel's tools (page/chat/tools.ts). */
    consoleChat?: ConsoleChat;
  }
}

window.consoleHeader = consoleHeader;
window.onConsoleHeader?.(consoleHeader);

// For the chat panel's tools (../page/chat/tools.ts): what the show is
// doing, and the same playback actions as the console's own controls.
const consoleChat = {
  /** The show, as the chat's get_show tool reports it. */
  show() {
    const show = currentShowState();
    const song = getActiveSong();
    const set = getActiveSet();
    const songNumber = (id: string) => show.songs.findIndex((s) => s.id === id) + 1;
    const hasUpNext = !!goTarget(state);
    return {
      showName: show.showName,
      serverConnected: state.serverLive,
      playing: {
        song: { number: songNumber(song.id), name: song.name },
        live: { cue: state.fromCue + 1, label: cueLabel(state.fromCue) },
        upNext: hasUpNext ? { label: cueLabel(state.toCue), fadeSeconds: playbackCue(state, state.toCue)?.fadeTime ?? null } : null,
        transition: state.fadeState ? (state.fadeState.paused ? "paused" : "running") : "none",
      },
      master: Math.round(state.master),
      submasters: { live: Math.round(state.fromSub), upNext: Math.round(state.toSub) },
      crossfader: Math.round(state.cross),
      activeSet: { name: set.name, songs: set.entries.map((e) => show.songs.find((s) => s.id === e.songId)?.name ?? "?") },
      songs: show.songs.map((s, i) => ({
        number: i + 1,
        name: s.name,
        cues: s.cues.map((c, j) => ({ number: j + 1, name: c.name, fadeSeconds: c.fadeTime })),
      })),
    };
  },
  /** Songs in show order (the chat finds one by number or name). */
  songs: () => state.songs.map((s) => ({ id: s.id, name: s.name, cues: s.cues.length })),
  /** Play song `songId` from cue `cue` (0-based): it's LIVE at once, no fade. */
  playSong(songId: string, cue = 0) {
    setActiveSong(songId, undefined, cue);
  },
  /** Make cue `cue` (0-based) of the playing song LIVE at once, no fade. */
  makeLive(cue: number) {
    setSelectedCue(cue);
    cuesEl.querySelector<HTMLElement>(`.fader-row[data-row="${state.selectedCue}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  },
  /** GO (false: nothing UP NEXT, or the show server is offline). */
  go(): boolean {
    if (!state.serverLive || !goTarget(state)) return false;
    goNextCue();
    return true;
  },
  /** Pause / resume the running transition (false: none running). */
  pause(): boolean {
    if (!state.fadeState) return false;
    toggleFadePause();
    return true;
  },
  /** Stop the running transition where it is. */
  stop() {
    stopTimedFade();
  },
  setMaster(percent: number) {
    state.master = clamp(percent, 0, 100);
    syncMasterUi();
    pushToDmx();
  },
  setCrossfader(percent: number) {
    setCross(percent, { fromUser: true });
  },
  /** The LIVE and / or UP NEXT submasters (percent): they scale those cues before the blend. */
  setSubmasters(live?: number, upNext?: number) {
    if (live != null) state.fromSub = clamp(live, 0, 100);
    if (upNext != null) state.toSub = clamp(upNext, 0, 100);
    syncSubmasterUi();
    pushToDmx();
  },
  /** Step (the next look: a cue's next step, or UP NEXT) or Step back, as the console's Step buttons. False: nothing to step to. */
  step(back: boolean): boolean {
    const button = back ? "stepBack" : "step";
    if (!state.serverLive || !goArea().buttons[button].enabled) return false;
    goPress(button);
    return true;
  },
  /** Rename the show. */
  renameShow(name: string) {
    applyShowName(name);
    return state.showName;
  },
  /** Download the show file (the person's browser saves it); false: saved without the stage and chats (the show server is offline). */
  async saveShow() {
    const complete = await downloadShowFile();
    noteFile("saved", complete);
    return complete;
  },

  // --- editing (round 2) ------------------------------------------------------
  // Cues are found by song id (null = the playing song) and 0-based index.
  // Each edit goes through the same state and redraws as the console's own
  // controls, then pushToDmx syncs it to the show server.

  /** A cue's name, In time, every fader's level (index = fader − 1) and its aims at named stage positions (position = the stage's id). */
  cue(songId: string | null, index: number) {
    const c = chatSong(songId).cues[index];
    if (!c) throw new Error("No such cue");
    const fixtureName = (id: string) => state.fixtures.find((f) => f.id === id)?.name ?? null;
    const aims = (look: Look) => look.aims.map((a) => ({ fixture: fixtureName(a.fixture), position: a.position }));
    return {
      name: c.name,
      fadeSeconds: c.fadeTime,
      levels: [...c.levels],
      aims: aims(c),
      steps: c.steps.map((st) => ({ fadeSeconds: st.fadeTime, holdSeconds: st.holdTime, levels: [...st.levels], aims: aims(st) })),
    };
  },
  /** Every fader: number (1-based), name, and whether it's patched to a channel. */
  faders: () => Array.from({ length: FADER_COUNT }, (_, i) => ({ fader: i + 1, name: faderName(i), patched: !isUnpatched(state.patch[i]) })),
  /** Set levels (0–255) in a cue (or one of its steps, 0-based): [fader index (0-based), level] pairs. */
  setCueLevels(songId: string | null, index: number, cells: [number, number][], step?: number) {
    const look = chatLook(chatSong(songId), index, step);
    for (const [i, level] of cells) if (i >= 0 && i < FADER_COUNT) look.levels[i] = clampByte(level);
    syncSlidersFromState();
    pushToDmx();
  },
  /** Add a cue after `after` (0-based; default: at the end), blank or a copy of cue `copyOf`. LIVE stays where it is. Returns its index. */
  addCue(songId: string | null, opts: { after?: number | undefined; copyOf?: number | undefined; name?: string | undefined; fadeSeconds?: number | undefined }) {
    const song = chatSong(songId);
    if (song.cues.length >= MAX_CUES) throw new Error("The song has its maximum of cues");
    const source = opts.copyOf == null ? null : song.cues[opts.copyOf];
    if (opts.copyOf != null && !source) throw new Error("No such cue to copy");
    const at = opts.after == null ? song.cues.length : clampInt(opts.after + 1, 0, song.cues.length);
    song.cues.splice(at, 0, createCue({ name: opts.name ?? "", levels: source?.levels, fadeTime: opts.fadeSeconds ?? source?.fadeTime, aims: source?.aims }));
    afterCueListChange(song, (i) => (i >= at ? i + 1 : i));
    return at;
  },
  /** Rename a cue ("" = just "Cue N") and/or set its In time (seconds). */
  editCue(songId: string | null, index: number, opts: { name?: string | undefined; fadeSeconds?: number | undefined }) {
    const song = chatSong(songId);
    const c = song.cues[index];
    if (!c) throw new Error("No such cue");
    if (opts.name != null) c.name = opts.name.trim().slice(0, 40);
    if (opts.fadeSeconds != null) c.fadeTime = normalizeCueFadeTime(opts.fadeSeconds);
    afterCueListChange(song, (i) => i);
    return { name: c.name, fadeSeconds: c.fadeTime };
  },
  /** Delete a cue (a song keeps at least MIN_CUES). */
  deleteCue(songId: string | null, index: number) {
    const song = chatSong(songId);
    if (!song.cues[index]) throw new Error("No such cue");
    if (song.cues.length <= MIN_CUES) throw new Error(`A song keeps at least ${MIN_CUES} cues`);
    song.cues.splice(index, 1);
    const n = song.cues.length;
    afterCueListChange(song, (i) => (i > index ? i - 1 : Math.min(i, n - 1)));
  },
  /** Move cue `from` to `to` (0-based) in a song; LIVE stays on the same cue. */
  moveCue(songId: string | null, from: number, to: number) {
    const song = chatSong(songId);
    const ids = song.cues.map((c) => c.id);
    if (!ids[from] || !ids[to]) throw new Error("No such cue");
    if (from === to) return;
    moveCue(song, ids[from], ids[to], to > from);
    afterCueListChange(song, (i) => song.cues.findIndex((c) => c.id === ids[i]));
  },

  // --- cue steps: looks GO passes through on the way into a cue (0-based; the cue's own look comes last)

  /** Add a step at `at` (default: last, just before the cue's own look): a copy of step `copyOf` (default: the cue's own look). Returns its index. */
  addStep(songId: string | null, index: number, opts: { at?: number | undefined; copyOf?: number | undefined; fadeSeconds?: number | undefined; holdSeconds?: number | undefined }) {
    const song = chatSong(songId);
    const c = song.cues[index];
    if (!c) throw new Error("No such cue");
    if (c.steps.length >= MAX_CUE_STEPS) throw new Error(`A cue has at most ${MAX_CUE_STEPS} steps`);
    const source = opts.copyOf == null ? null : c.steps[opts.copyOf];
    if (opts.copyOf != null && !source) throw new Error("No such step to copy");
    const at = opts.at == null ? c.steps.length : clampInt(opts.at, 0, c.steps.length);
    const fade = normalizeCueFadeTime(opts.fadeSeconds, source?.fadeTime ?? c.fadeTime);
    const hold = normalizeCueFadeTime(opts.holdSeconds, source?.holdTime ?? 0);
    c.steps.splice(at, 0, createStep(source ?? c, fade, hold));
    afterStepsChange(song, index, (k) => (k >= at ? k + 1 : k));
    return at;
  },
  /** Set a step's fade (into it) and / or hold (on it before the next look), in seconds. */
  editStep(songId: string | null, index: number, step: number, opts: { fadeSeconds?: number | undefined; holdSeconds?: number | undefined }) {
    const song = chatSong(songId);
    const st = song.cues[index]?.steps[step];
    if (!st) throw new Error("No such step");
    if (opts.fadeSeconds != null) st.fadeTime = normalizeCueFadeTime(opts.fadeSeconds);
    if (opts.holdSeconds != null) st.holdTime = normalizeCueFadeTime(opts.holdSeconds, 0);
    afterStepsChange(song, index, (k) => k);
    return { fadeSeconds: st.fadeTime, holdSeconds: st.holdTime };
  },
  deleteStep(songId: string | null, index: number, step: number) {
    const song = chatSong(songId);
    const c = song.cues[index];
    if (!c?.steps[step]) throw new Error("No such step");
    c.steps.splice(step, 1);
    // The LIVE step going: the cue's own look is LIVE instead.
    afterStepsChange(song, index, (k) => (k > step ? k - 1 : k === step ? -1 : k));
  },

  /** A new song at the end of the show (not played). Returns its id. */
  addSong(name: string) {
    if (state.songs.length >= MAX_SONGS) throw new Error(`The show has its maximum of ${MAX_SONGS} songs`);
    const song = createSong({ name: normalizeSongName(name, state.songs.length) });
    state.songs.push(song);
    afterSongsChange();
    return song.id;
  },
  renameSong(songId: string, name: string) {
    const song = chatSong(songId);
    song.name = normalizeSongName(name, state.songs.indexOf(song));
    afterSongsChange();
    return song.name;
  },
  /** Copy a song right after itself ("… copy" unless named). Returns the copy's id. */
  duplicateSong: (songId: string, name?: string) => copySong(chatSong(songId).id, name).id,
  /** Delete a song (and take it out of every set). */
  deleteSong: (songId: string) => removeSong(chatSong(songId).id),
  /** Move a song to `index` (0-based) in the show. */
  moveSong: (songId: string, index: number) => moveSongTo(chatSong(songId).id, index),

  // --- sets ---------------------------------------------------------------------
  // A set is found by id; null = the running set. Entries by 0-based position.

  /** Every set: its songs in order (song ids and names) and whether the Run tab runs it. */
  sets: () => state.sets.map((set) => ({
    id: set.id,
    name: set.name,
    running: set.id === state.activeSetId,
    songs: set.entries.map((e) => ({ id: e.songId, name: state.songs.find((s) => s.id === e.songId)?.name ?? "?" })),
  })),
  /** Put songs in a set at `index` (default: the end), in order. */
  addToSet(setId: string | null, songIds: string[], index?: number) {
    const set = chatSet(setId);
    if (set.entries.length + songIds.length > MAX_SET_ENTRIES) throw new Error(`A set holds at most ${MAX_SET_ENTRIES} songs`);
    let at = index ?? set.entries.length;
    for (const id of songIds) addToSet(set, chatSong(id).id, at++);
  },
  /** Take the entry at `index` out of a set. */
  removeFromSet(setId: string | null, index: number) {
    const set = chatSet(setId);
    removeFromSet(set, chatEntry(set, index).id);
  },
  /** Move the entry at `from` to `to` (0-based) in a set. */
  moveInSet(setId: string | null, from: number, to: number) {
    const set = chatSet(setId);
    const entry = chatEntry(set, from);
    const target = chatEntry(set, to);
    reorderSet(set, entry.id, target.id, to > from);
  },
  /** Run a set from the entry at `index` (default: its first song). */
  runSet(setId: string | null, index?: number) {
    const set = chatSet(setId);
    if (index == null) runSet(set);
    else playSetEntry(set, chatEntry(set, index).id);
  },
  /** A new set with these songs. Returns its id. */
  newSet: (name: string, songIds: string[]) => addSet(name, songIds.map((id) => chatSong(id).id)).id,
  renameSet: (setId: string | null, name: string) => renameSetTo(chatSet(setId), name),
  /** Copy a set right after itself ("… copy" unless named). Returns the copy's id. */
  duplicateSet: (setId: string | null, name?: string) => copySet(chatSet(setId), name).id,
  deleteSet: (setId: string | null) => removeSet(chatSet(setId)),
  // --- patch and console fixtures -------------------------------------------------

  /**
   * Patch fader `index` (0-based) to these DMX addresses ("45", or "2/45" =
   * universe 2; [] = none), each with the level it gets at full (`max`
   * 0–255; default: what it had, else 255), and / or rename it ("" = its
   * default name).
   */
  patchFader(index: number, opts: { channels?: { address: string; max?: number | undefined }[] | undefined; name?: string | undefined }) {
    if (!Number.isInteger(index) || index < 0 || index >= FADER_COUNT) throw new Error(`No fader ${index + 1}`);
    if (opts.channels) {
      const was = new Map<number, number>(state.patch[index].map((t) => [t.channel, t.max]));
      const targets = new Map<number, number>();
      for (const { address, max } of opts.channels) {
        const ch = parseAddress(address);
        if (ch == null) throw new Error(`"${address}" isn't a DMX address in this show (${state.universes} universe${state.universes > 1 ? "s" : ""}; e.g. 45${state.universes > 1 ? " or 2/45" : ""})`);
        targets.set(ch, max ?? was.get(ch) ?? 255);
      }
      state.patch[index] = [...targets].sort(([x], [y]) => x - y).map(([ch, max]) => makeTarget(ch, max));
    }
    if (opts.name != null) state.faderNames[index] = opts.name.trim().slice(0, 40);
    persistAndRefresh();
    renderLiveRow();
    renderCues();
    renderSelectedGroup();
    renderPatchTable();
    persistSession();
    return { fader: index + 1, name: faderName(index), channels: state.patch[index].map((t) => (t.max === 255 ? formatAddress(t.channel) : `${formatAddress(t.channel)} (max ${t.max})`)) };
  },
  /**
   * Console fixtures (no stage fixture): `qty` of them, each `channels` wide,
   * in the next free blocks (in `universe` if given), one fader each named
   * after the fixture and what the channel does. Same as the stage's own.
   */
  addFixtures(opts: { name: string; channels: number; qty: number; roles: (DmxAttr | null)[]; group: string | null; universe: number | null; mount: "fixed" | "movable"; color: "single" | "multi" }) {
    const width = clampInt(opts.channels, 1, MAX_FIXTURE_CHANNELS);
    const names = batchFixtureNames(opts.name, clampInt(opts.qty, 1, MAX_FIXTURE_QTY));
    const roles = opts.roles.slice(0, width);
    const labels = Array.from({ length: width }, (_, k) => (roles[k] ? DMX_SHORT[roles[k]] : String(k + 1)));
    const results = registerFromStage(names.map((name, i) => ({
      stageId: `chat-${i}`, name, mount: opts.mount, color: opts.color, labels, roles, values: Array(width).fill(0), width, group: opts.group, universe: opts.universe,
    })));
    return results.map((r, i) => (r.ok
      ? { name: names[i], channels: `${formatAddress(r.start)}–${formatAddress(r.start + width - 1)}`, faders: r.faders }
      : { name: names[i], error: r.error }));
  },
  /**
   * Change a console fixture: rename it (its faders named after it follow),
   * put it in a group by name ("" = no group; a new name makes the group),
   * move it to another start address and / or channel count (the faders
   * patched into it move with it), or change its type.
   */
  editFixture(id: string, opts: { name?: string | undefined; group?: string | undefined; start?: string | undefined; channels?: number | undefined; mount?: "fixed" | "movable" | undefined; color?: "single" | "multi" | undefined }) {
    const fixture = state.fixtures.find((f) => f.id === id);
    if (!fixture) throw new Error("No such fixture");
    if (opts.start != null || opts.channels != null) {
      const start = opts.start == null ? fixture.channelStart : parseAddress(opts.start);
      if (start == null) throw new Error(`"${opts.start}" isn't a DMX address in this show`);
      const width = opts.channels ?? fixture.channelEnd - fixture.channelStart + 1;
      const range = normalizeChannelSpan(start, width);
      if (!range) throw new Error(`${width} channels from ${formatAddress(start)} don't fit in one universe (at most ${MAX_FIXTURE_CHANNELS})`);
      const clash = findRangeConflict(state.fixtures, range.channelStart, range.channelEnd, fixture.id);
      if (clash) throw new Error(`That overlaps ${clash.name} (${formatChannelRange(clash)})`);
      // Faders patched into the old block follow it (channels past the new end are dropped).
      const shift = range.channelStart - fixture.channelStart;
      for (let i = 0; i < FADER_COUNT; i++) {
        const moved = state.patch[i].flatMap((t) => {
          if (t.channel < fixture.channelStart || t.channel > fixture.channelEnd) return [t];
          const ch = t.channel + shift;
          return ch <= range.channelEnd ? [makeTarget(ch, t.max)] : [];
        });
        if (shift || moved.length !== state.patch[i].length) state.patch[i] = moved;
      }
      fixture.channelStart = range.channelStart;
      fixture.channelEnd = range.channelEnd;
      if (fixture.roles) fixture.roles = fixture.roles.slice(0, range.channelEnd - range.channelStart + 1);
      persistAndRefresh();
    }
    if (opts.mount != null) fixture.mount = normalizeMount(opts.mount);
    if (opts.color != null) fixture.color = normalizeColorMode(opts.color);
    if (opts.name != null) {
      const name = opts.name.trim().slice(0, 40);
      if (!name) throw new Error("A fixture needs a name");
      const old = `${fixture.name} `;
      for (let i = 0; i < FADER_COUNT; i++) {
        const own = state.faderNames[i];
        if (own?.startsWith(old) && state.patch[i].some((t) => t.channel >= fixture.channelStart && t.channel <= fixture.channelEnd)) {
          state.faderNames[i] = `${name} ${own.slice(old.length)}`.slice(0, 40);
        }
      }
      fixture.name = name;
    }
    if (opts.group != null) {
      const groupName = opts.group.trim().slice(0, 40);
      let group = groupName ? state.fixtureGroups.find((g) => g.name.toLowerCase() === groupName.toLowerCase()) : null;
      if (groupName && !group) {
        if (state.fixtureGroups.length >= MAX_FIXTURE_GROUPS) throw new Error(`The show has its maximum of ${MAX_FIXTURE_GROUPS} groups`);
        group = createFixtureGroup({ name: groupName });
        state.fixtureGroups.push(group);
      }
      const was = fixture.groupId;
      fixture.groupId = group?.id ?? null;
      if (was && was !== fixture.groupId && !state.fixtures.some((f) => f.groupId === was)) {
        state.fixtureGroups = state.fixtureGroups.filter((g) => g.id !== was);
      }
    }
    afterStageFixturesChanged();
    persistSession();
    const group = state.fixtureGroups.find((g) => g.id === fixture.groupId);
    return { name: fixture.name, group: group?.name ?? null, channels: formatChannelRange(fixture), mount: fixture.mount, color: fixture.color };
  },
  /** Fixture groups: name and member fixtures. */
  groups: () => state.fixtureGroups.map((g) => ({ name: g.name, fixtures: state.fixtures.filter((f) => f.groupId === g.id).map((f) => f.name) })),
  /** Rename a group (found by name, ignoring case). */
  renameGroup(name: string, to: string) {
    const group = chatGroup(name);
    const next = to.trim().slice(0, 40);
    if (!next) throw new Error("A group needs a name");
    group.name = next;
    afterStageFixturesChanged();
    persistSession();
    return group.name;
  },
  /** Delete a group; its fixtures stay, ungrouped. */
  deleteGroup(name: string) {
    const group = chatGroup(name);
    for (const f of state.fixtures) if (f.groupId === group.id) f.groupId = null;
    state.fixtureGroups = state.fixtureGroups.filter((g) => g.id !== group.id);
    if (state.fixtureFormGroupId === group.id) state.fixtureFormGroupId = null;
    afterStageFixturesChanged();
    persistSession();
  },
  /** Delete console fixtures: their faders are unpatched, renamed back and set to 0 in every cue. */
  deleteFixtures(ids: string[]) {
    unregisterFromStage(ids);
    persistSession();
  },

  // --- DMX outputs (on the show server) --------------------------------------

  /** The universes and each one's outputs: DMX USB Pro connected, and the network output ("Art-Net 0 → 192.168.1.50") or null. */
  outputs: () => ({
    universes: state.universes,
    maxUniverses: MAX_UNIVERSES,
    outputs: outputs.slice(0, state.universes).map((out, i) => ({ universe: i + 1, usbPro: out.connected, network: out.network })),
  }),
  /** Connect or disconnect universe `u`'s DMX USB Pro. */
  async usbPro(u: number, connect: boolean) {
    const out = chatOutput(u);
    if (connect) await out.connect();
    else await out.disconnect();
    renderOutputs();
  },
  /** Send universe `u` to an Art-Net / sACN node, or stop that (null). */
  async network(u: number, output: NetOutputSetting | null) {
    await chatOutput(u).setNetwork(output);
    renderOutputs();
  },
  findArtNetNodes: () => discoverNodes(),
  setUniverses(n: number) {
    const why = universesInUse(clampInt(n, 1, MAX_UNIVERSES));
    if (why) throw new Error(why);
    setUniverses(n);
    return state.universes;
  },

  /** Fixtures, with the faders that drive each channel (fader numbers 1-based) and what each channel does. */
  fixtures() {
    const groups = new Map(state.fixtureGroups.map((g) => [g.id, g.name]));
    return state.fixtures.map((f) => ({
      id: f.id,
      name: f.name,
      group: f.groupId ? groups.get(f.groupId) ?? null : null,
      channels: Array.from({ length: f.channelEnd - f.channelStart + 1 }, (_, k) => {
        const channel = f.channelStart + k;
        return {
          channel,
          role: f.roles?.[k] ?? null,
          faders: state.patch.flatMap((targets, i) => (targets.some((t) => t.channel === channel) ? [i + 1] : [])),
        };
      }),
    }));
  },
  /** What the show's edits are now (everything but playback), to undo a chat turn's edits. */
  editSnapshot: () => editSnapshot(),
  /** Put the show's edits back to a snapshot, keeping playback (what's LIVE, the song, levels) as it is now. */
  restoreEdits(snapshot: string) {
    const saved: unknown = JSON.parse(snapshot);
    if (!saved || typeof saved !== "object") throw new Error("Bad snapshot");
    const now = currentShowState();
    const playback = Object.fromEntries([...LIVE_FIELDS, ...PLAYBACK_FIELDS].map((f) => [f, now[f]]));
    applyShow(parseShow({ ...saved, ...playback }), { fromServer: true });
    persistSession();
  },
};
export type ConsoleChat = typeof consoleChat;

/** Show fields about playback, not edits (with LIVE_FIELDS): left out of edit snapshots. */
const PLAYBACK_FIELDS = ["activeSongId", "activeEntryId"] as const;

function editSnapshot(): string {
  const all: Record<string, unknown> = serializeShow(currentShowState());
  for (const f of ["savedAt", ...LIVE_FIELDS, ...PLAYBACK_FIELDS]) delete all[f];
  return JSON.stringify(all);
}

/** A song by id, or the playing one (null). */
function chatSong(songId: string | null): Song {
  const song = songId == null ? getActiveSong() : state.songs.find((s) => s.id === songId);
  if (!song) throw new Error("No such song");
  return song;
}

/** A set by id, or the running one (null). */
function chatSet(setId: string | null): ShowSet {
  const set = setId == null ? getActiveSet() : state.sets.find((s) => s.id === setId);
  if (!set) throw new Error("No such set");
  return set;
}

/** A cue's own look (step null / -1) or one of its steps. */
function chatLook(song: Song, index: number, step?: number | null): Look {
  const c = song.cues[index];
  if (!c) throw new Error("No such cue");
  if (step == null || step < 0) return c;
  const st = c.steps[step];
  if (!st) throw new Error(c.steps.length ? `That cue has steps 1–${c.steps.length}` : "That cue has no steps");
  return st;
}

/** A cue's steps changed: keep the LIVE step on the same step (`moved`: old index → new, -1 = the cue's own look) and redraw. */
function afterStepsChange(song: Song, index: number, moved: (k: number) => number) {
  if (song.id === getActiveSong().id && index === state.fromCue && state.liveStep >= 0) state.liveStep = moved(state.liveStep);
  afterCueListChange(song, (i) => i);
}

/** A fixture group by name (ignoring case). */
function chatGroup(name: string) {
  const group = state.fixtureGroups.find((g) => g.name.toLowerCase() === name.trim().toLowerCase());
  if (!group) throw new Error(state.fixtureGroups.length ? `No group "${name}" (groups: ${state.fixtureGroups.map((g) => g.name).join(", ")})` : "There are no groups");
  return group;
}

/** Universe `u`'s outputs. */
function chatOutput(u: number) {
  if (!Number.isInteger(u) || u < 1 || u > state.universes) throw new Error(`The show has universe${state.universes > 1 ? `s 1–${state.universes}` : " 1"}`);
  return outputs[u - 1];
}

/** The entry at 0-based `index` in a set. */
function chatEntry(set: ShowSet, index: number) {
  const entry = set.entries[index];
  if (!entry) throw new Error(set.entries.length ? `"${set.name}" has songs 1–${set.entries.length}` : `"${set.name}" is empty`);
  return entry;
}

/**
 * A song's cues changed: if it's the playing song, keep LIVE / selected on
 * the same cues (`moved` maps an old index to its new one) and redraw.
 */
function afterCueListChange(song: Song, moved: (i: number) => number) {
  if (song.id === getActiveSong().id) {
    state.fromCue = moved(state.fromCue);
    state.selectedCue = moved(state.selectedCue);
    bindActiveSong();
    renderCues();
    renderSelectedGroup();
    refreshCueSelects();
  }
  renderShowTab();
  pushToDmx();
}

function afterSongsChange() {
  syncSongUi();
  renderShowTab();
  renderSetTab();
  persistSession();
}
window.consoleChat = consoleChat;

// Live link to the stage: send output levels, apply fader moves made there.
startStageLink({
  levels: computeChannelLevels,
  exactLevels: () => computeChannelLevels({ exact: true }),
  patch: () => state.patch,
  live: () => {
    const to = goTarget(state, state.fadeState?.step);
    return { cueLevels: getPlaybackLevels(), fromCue: state.fromCue, toCue: state.toCue, toLevels: to?.levels, toPath: to?.path, fromSub: state.fromSub, toSub: state.toSub, cross: state.cross, master: state.master };
  },
  fixtures: () => state.fixtures,
  groups: () => state.fixtureGroups,
  outlines: fixtureOutlineColors,
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
    const card = el.closest<HTMLElement>(".patch-card[data-fader]");
    if (card) return { kind: "fader", fader: Number(card.dataset.fader) + 1 };
    const fixtureRow = el.closest<HTMLElement>(".fixture-row[data-id]");
    if (fixtureRow) return { kind: "fixture", id: fixtureRow.dataset.id ?? "" };
    const wrap = el.closest<HTMLElement>(".fader");
    if (!wrap) return null;
    for (const [channel, w] of channelUi.wrapEls) if (w === wrap) return { kind: "channel", channel };
    const hit = (els: (HTMLElement | undefined)[]) => els.findIndex((x) => x?.closest<HTMLElement>(".fader") === wrap);
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
  // The 3D view's GO bar: the GO area as shown here, and its buttons are these.
  goArea,
  goPress,
  // The GO bar's crossfader: as dragging this one.
  crossTo: (pct) => setCross(pct, { fromUser: true }),
  adoptRoles: adoptRolesFromStage,
  reveal: revealFixtures,
  hold: holdFromStage,
  // Aims at named stage positions (aims.ts): the stage aims fixtures in the
  // cue(s) on the output, and re-aims every cue when a position moves.
  aim(list) {
    const t = state.cross / 100;
    const on = [t < 1 && state.fromSub > 0 ? state.fromCue : null, t > 0 && state.toSub > 0 ? state.toCue : null];
    // LIVE: the step being shown; UP NEXT: its own look.
    const looks = [...new Set(on.flatMap((i) => {
      const cue = i == null ? undefined : playbackCue(state, i);
      return cue ? [i === state.fromCue ? stepLook(cue, state.liveStep) : cue] : [];
    }))];
    applyAims(looks, state.patch, list);
    syncSlidersFromState();
    pushToDmx();
  },
  reaim(list) {
    if (!applyReaims(state.songs, state.patch, list)) return;
    syncSlidersFromState();
    pushToDmx();
  },
  aims: () => allAims(state.songs),
  liveAims: () => {
    const cue = playbackCue(state, state.cross >= 50 ? state.toCue : state.fromCue);
    return (cue && state.cross < 50 ? stepLook(cue, state.liveStep) : cue)?.aims ?? [];
  },
});

// ---------------------------------------------------------------------
// Show server (see server-link.ts): it holds the show, runs fades and
// drives the DMX; this console mirrors it and sends its edits there.
// ---------------------------------------------------------------------

const offlineCover = el("div", "server-offline");
offlineCover.innerHTML = "<div><strong>Connecting to the show server…</strong><span>Start it with <code>./server.sh</code> on the machine the DMX USB Pro is plugged into.</span></div>";
elById("consolePane").append(offlineCover);

/** Show fields the server sent that are live values (it sends these separately). */
function withLive(show: unknown, live: Partial<Live>): ShowData {
  const state = parseShow(show);
  const current = currentShowState();
  // A live value missing here was just changed on this console: keep ours.
  for (const f of LIVE_FIELDS) state[f] = live[f] ?? current[f];
  return state;
}

/** Live mix from the server (fade steps, other consoles' moves, GO arriving). */
function applyServerLive(live: Partial<Live>) {
  const before = { fromCue: state.fromCue, selectedCue: state.selectedCue, liveStep: state.liveStep };
  if (live.master !== undefined) state.master = live.master;
  if (live.cross !== undefined) state.cross = live.cross;
  if (live.fromSub !== undefined) state.fromSub = live.fromSub;
  if (live.toSub !== undefined) state.toSub = live.toSub;
  if (live.fromCue !== undefined) state.fromCue = live.fromCue;
  if (live.selectedCue !== undefined) state.selectedCue = live.selectedCue;
  if (live.liveStep !== undefined) state.liveStep = live.liveStep;
  syncPlaybackPair();
  followFade(live.fade ?? null);
  state.serverFlashing = new Set(live.flashing ?? []);
  state.serverBlackedOut = new Set(live.blackedOut ?? []);

  syncMasterUi();
  syncSubmasterUi();
  syncCrossUi();
  syncGoButton();
  // A step shown before or now (picked on another console, or GO arrived): the rows' faders are other levels.
  if (state.liveStep !== before.liveStep) { renderCues(); renderSelectedGroup(); }
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
    const byId = new Map<string, Look>();
    for (const song of state.songs) for (const t of song.cues) for (const look of [t, ...t.steps]) byId.set(look.id, look);
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
      // The Server pill shows the connection; clear the "offline" message.
      setStatus("", "info");
    } else {
      setStatus("Show server offline — reconnecting…", "error");
    }
  },
});

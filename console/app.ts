// The console (its pane in ../index.html): starts it up and wires its controls;
// show new / load / save, universes and DMX outputs, fixtures placed on the
// stage, the app header's hooks (consoleHeader), and the link to the show
// server. The console's tabs themselves are in the modules imported below,
// and its hooks for the chat panel (window.consoleChat) in ./chat-hooks.ts.
import { startStageLink } from "./stage-link.ts";
import { blankStage } from "../stage/stage-model.ts";
import type { GoButton, RegisterRequest, RegisterResult, StageLayout } from "../shared/console-stage.ts";
import { createServerLink } from "./server-link.ts";
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
  normalizeUniverses,
} from "./show.ts";
import { type Look, createCue, stepLook, MAX_CUES, normalizeSongs, resolveActiveSong } from "./songs.ts";
import {
  type PatchTarget,
  FADER_COUNT,
  identityPatch,
  defaultPatch,
  makeTarget,
  UNIVERSE_SIZE,
  MAX_UNIVERSES,
  setUniverseCount,
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
import { goTarget, normalizeSets, playbackCue } from "./sets.ts";
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
  showArrivedCue,
  toggleFadePause,
  followFade,
} from "./live.ts";
import { syncSongUi, renderShowTab, addSong } from "./show-tab.ts";
import { renderSetTab } from "./set-tab.ts";
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
import { clampInt } from "../shared/numbers.ts";
import { LIVE_FIELDS } from "../shared/live-fields.ts";
import { asUniverse } from "../shared/address.ts";
import { consoleChat, type ConsoleChat } from "./chat-hooks.ts";

// ---------------------------------------------------------------------
// Universes: count, outputs (DMX USB Pro / Art-Net / sACN), Channels-tab meter universe
// ---------------------------------------------------------------------

/** The DMX outputs changed: redraw the page header and the meters' universe picker. */
export function renderOutputs() {
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
export async function discoverNodes(): Promise<ArtNetNode[]> {
  const reply = await serverLink().request({ type: "net-discover" });
  if (!reply.ok) throw new Error(reply.error);
  return reply.nodes;
}

/** Why the show can't go down to `next` universes (a fixture or patch uses a later one), or null. */
export function universesInUse(next: number): string | null {
  if (next >= state.universes) return null;
  const limit = next * UNIVERSE_SIZE;
  const usedPatch = state.patch.some((targets) => targets.some((t) => t.channel > limit));
  const usedBy = state.fixtures.find((i) => i.channelEnd > limit);
  return usedPatch || usedBy ? `Universe ${next + 1}+ is in use (${usedBy ? usedBy.name : "patched faders"}) — move or remove that first` : null;
}

/** Change the universe count; refuses to drop universes that are in use. */
export function setUniverses(n: number) {
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

export function syncMasterUi() {
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
export function goPress(button: GoButton) {
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

/** The Patch tab's 1:1 (fader N → channel N, full) or Unpatch all (`clear`; no asking: the button asks first). */
export function resetPatch(clear: boolean) {
  state.patch = clear ? defaultPatch() : identityPatch();
  persistAndRefresh();
  renderPatchTable();
}

identityBtn.addEventListener("click", () => resetPatch(false));

clearPatchBtn.addEventListener("click", async () => {
  const ok = await confirmAction({
    title: "Unpatch all?",
    message: "Clear every fader’s channel assignments?",
    confirmLabel: "Unpatch all",
  });
  if (ok) resetPatch(true);
});

/**
 * Replace the whole show. `fromServer`: another console (or the server) changed
 * it, so leave the fade and held buttons alone.
 */
export function applyShow(next: ShowData, { fromServer = false } = {}) {
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
export function noteFile(how: FileState["how"], complete = true, file?: string) {
  state.fileState = { how, at: Date.now(), file };
  if (complete) notifyHeader();
  else setStatus("Saved without the stage and chats: the show server is offline", "error");
}

/** Download the show, with the stage and chats the show server keeps alongside it. */
async function saveShow() {
  noteFile("saved", await downloadShowFile());
}

/** Download the show file; false if the show server was offline (the file then has no stage or chats). */
export async function downloadShowFile(): Promise<boolean> {
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

export function registerFromStage(requests: RegisterRequest[]): RegisterResult[] {
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
export function unregisterFromStage(consoleIds: string[]) {
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

export function afterStageFixturesChanged() {
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
    /** The console's hooks for the chat panel's tools (page/chat/tools/), in ./chat-hooks.ts. */
    consoleChat?: ConsoleChat;
  }
}

window.consoleHeader = consoleHeader;
window.onConsoleHeader?.(consoleHeader);

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

// The console's hooks for the chat panel's tools (../page/chat/tools/):
// what the show is doing, and the same actions as the console's own
// controls. Set as window.consoleChat by ./app.ts.
import { LIVE_FIELDS } from "../shared/live-fields.ts";
import { DMX_SHORT, type DmxAttr } from "../shared/attributes.ts";
import type { NetOutputSetting } from "../shared/protocol.ts";
import { parseShow, serializeShow } from "./show.ts";
import { type Look, type Song, createCue, createStep, createSong, MAX_CUES, MAX_CUE_STEPS, MAX_SONGS, MIN_CUES, moveCue, normalizeCueFadeTime, normalizeSongName } from "./songs.ts";
import {
  FADER_COUNT,
  makeTarget,
  MAX_UNIVERSES,
  parseAddress,
  formatAddress,
} from "./patch.ts";
import {
  createFixtureGroup,
  findRangeConflict,
  formatChannelRange,
  MAX_FIXTURE_CHANNELS,
  MAX_FIXTURE_GROUPS,
  MAX_FIXTURE_QTY,
  normalizeChannelSpan,
  normalizeColorMode,
  normalizeMount,
} from "./fixtures.ts";
import { cuesEl } from "./dom.ts";
import {
  getActiveSong,
  getActiveSet,
  bindActiveSong,
  persistSession,
  currentShowState,
  state,
} from "./state.ts";
import {
  cueLabel,
  faderName,
  isUnpatched,
  syncSlidersFromState,
} from "./faders.ts";
import {
  outputs,
  pushToDmx,
  renderLiveRow,
  refreshCueSelects,
  renderSelectedGroup,
  persistAndRefresh,
  syncSubmasterUi,
  setCross,
  stopTimedFade,
  goNextCue,
  goArea,
  setSelectedCue,
  toggleFadePause,
} from "./live.ts";
import { syncSongUi, renderShowTab, setActiveSong, copySong, removeSong, moveSongTo } from "./show-tab.ts";
import { goTarget, MAX_SET_ENTRIES, playbackCue, type ShowSet } from "./sets.ts";
import { renderSetTab, addToSet, removeFromSet, reorderSet, runSet, playSetEntry, addSet, renameSetTo, copySet, removeSet } from "./set-tab.ts";
import { renderCues } from "./cues.ts";
import { renderPatchTable } from "./patch-tab.ts";
import { applyShowName } from "./nav.ts";
import { batchFixtureNames } from "./fixtures-tab.ts";
import { clamp, clampByte, clampInt } from "../shared/numbers.ts";
import {
  afterStageFixturesChanged,
  applyShow,
  discoverNodes,
  downloadShowFile,
  goPress,
  noteFile,
  registerFromStage,
  renderOutputs,
  resetPatch,
  setUniverses,
  syncMasterUi,
  universesInUse,
  unregisterFromStage,
} from "./app.ts";

export const consoleChat = {
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

  /** Patch 1:1 (fader N → channel N, full) or unpatch every fader (`clear`). Returns how many faders are patched now. */
  resetPatch(clear: boolean) {
    resetPatch(clear);
    return state.patch.filter((t) => !isUnpatched(t)).length;
  },
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

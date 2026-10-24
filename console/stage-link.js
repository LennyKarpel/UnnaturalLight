/**
 * Live link to the Stage page (../stage/stage.html) over a BroadcastChannel
 * (same origin, other tabs; works whether or not the DMX Pro is connected).
 *
 * Console → stage: the 512 output levels, which fader(s) each patched
 * channel comes from, and the console's fixtures — on every output change
 * (marked `local` if made here, not from the server), when the stage says
 * hello, and as a heartbeat. Every open console sends; each message carries
 * the newest show-server message it reflects (`seq`), and the stage keeps
 * the newest, so a console the browser runs slowly can't hold it back.
 *
 * Stage → console: "set channel N to V" requests. The fader(s) patched to N
 * are moved (in the cue(s) currently on the output) so the output
 * becomes V, allowing for the patch max, master, submasters and crossfade.
 * The stage also sends its fixtures, so ⌥-click traces here can show them, and
 * asks to register / unregister fixtures placed / deleted there (app.js creates
 * the console fixture, patches free faders and names them).
 *
 * Trace: ⌥-click a fader (rows, Live meters, Patch cards), a channel meter or
 * a fixture row for a card showing what controls it, what it controls
 * and the current values (../shared/trace.js).
 */

import { UNIVERSE_SIZE } from "./patch.js";
import { createTracePopover } from "../shared/trace.js";
import { MSG, openStageBus } from "../shared/stage-bus.js";
import { clampByte } from "../shared/numbers.js";

const HEARTBEAT_MS = 1000;

/**
 * @typedef {{
 *   levels: () => Map<number, number>,
 *   serverSeq: () => number,
 *   patch: () => { channel: number, max: number }[][],
 *   live: () => { cueLevels: number[][], fromCue: number, toCue: number, fromSub: number, toSub: number, cross: number, master: number },
 *   fixtures: () => { id: string, name: string, mount: string, color: string, channelStart: number, channelEnd: number, groupId: string | null }[],
 *   groups: () => { id: string, name: string }[],
 *   faderInfo: () => { num: number, name: string, live: number, from: number, to: number, patch: { channel: number, max: number }[] }[],
 *   mix: () => { master: number, fromSub: number, toSub: number, cross: number, fromName: string, toName: string },
 *   universes: () => number,
 *   traceTarget: (el: EventTarget | null) => ({ kind: "fader", fader: number } | { kind: "channel", channel: number } | { kind: "fixture", id: string } | null),
 *   afterSet: () => void,
 *   register: (requests: { stageId: string, name: string, mount: string, color: string, labels: string[], roles?: (string | null)[], width: number, group: string | null, universe?: number | null }[]) => { stageId: string, ok: boolean, error?: string, consoleId?: string, start?: number, faders?: number[] }[],
 *   unregister: (consoleIds: string[]) => void,
 *   reveal: (consoleIds: string[]) => void,
 * }} StageLinkApi
 */

/** @type {BroadcastChannel | null} */
let bus = null;
/** @type {StageLinkApi | null} */
let api = null;
let queued = false;
/** The stage's fixtures, as last sent by the stage (null = stage not open). */
let stageFixtures = null;
/** @type {ReturnType<typeof createTracePopover> | null} */
let trace = null;
/**
 * Several console tabs in this browser all mirror the show server, so only
 * one of them (whichever holds the lock) carries out the stage's edits
 * (otherwise each tab would register the same fixture again).
 */
let leader = false;
/** This console, so the stage can tell consoles apart. */
const SOURCE_ID = Math.random().toString(36).slice(2);
/** The output changed here (not just from the server) since the last send. */
let localChange = false;

/**
 * Tell the stage the output changed (coalesced to one message per tick).
 * `local: false` = the change came from the server.
 */
export function notifyStage({ local = true } = {}) {
  if (local) localChange = true;
  if (!bus || queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    send();
  });
}

function outputLevels() {
  // Every universe in the set, end to end (channel 513 = universe 2/1).
  const levels = new Array(api.universes() * UNIVERSE_SIZE).fill(0);
  for (const [channel, level] of api.levels()) if (channel <= levels.length) levels[channel - 1] = level;
  return levels;
}

/** Everything a trace card needs, from the console's side. */
function traceSnapshot() {
  return {
    live: true,
    levels: outputLevels(),
    faders: api.faderInfo(),
    mix: api.mix(),
    universes: api.universes(),
    consoleFixtures: api.fixtures(),
    stageFixtures,
  };
}

function send() {
  if (!bus || !api) return;
  trace?.refresh();
  const local = localChange;
  localChange = false;
  const levels = outputLevels();
  /** channel → 1-based fader numbers patched to it */
  const faders = new Map();
  api.patch().forEach((targets, i) => {
    for (const t of targets) faders.set(t.channel, [...(faders.get(t.channel) ?? []), i + 1]);
  });
  bus.postMessage({
    type: MSG.LEVELS,
    source: SOURCE_ID,
    local,
    seq: api.serverSeq(),
    levels,
    faders: [...faders.entries()],
    fixtures: api.fixtures().map(({ id, name, mount, color, channelStart, channelEnd, groupId }) => ({
      id, name, mount, color, channelStart, channelEnd, groupId,
    })),
    groups: api.groups().map(({ id, name }) => ({ id, name })),
    faderInfo: api.faderInfo(),
    mix: api.mix(),
    universes: api.universes(),
  });
}

/** @param {{ channel: number, value: number }[]} values */
function applySet(values) {
  if (!api) return;
  const patch = api.patch();
  const L = api.live();
  const t = L.cross / 100;
  let touched = false;
  for (const { channel, value } of values) {
    for (let i = 0; i < patch.length; i++) {
      const target = patch[i].find((p) => p.channel === channel);
      if (!target || target.max <= 0 || L.master <= 0) continue;
      // Live level the fader needs for this channel to output `value`…
      const level = clampByte((value * 255) / target.max);
      // …and the pre-master mix that gives it (see liveLevel in app.js).
      const mixed = (level * 100) / L.master;
      if (t < 1 && L.fromSub > 0) L.cueLevels[L.fromCue][i] = clampByte((mixed * 100) / L.fromSub);
      if (t > 0 && L.toSub > 0) L.cueLevels[L.toCue][i] = clampByte((mixed * 100) / L.toSub);
      touched = true;
    }
  }
  if (touched) api.afterSet();
}

/** @param {StageLinkApi} linkApi */
export function startStageLink(linkApi) {
  bus = openStageBus();
  if (!bus) return;
  api = linkApi;
  leader = !navigator.locks;
  navigator.locks?.request("unnaturallight.stage-link", () => {
    leader = true;
    send();
    return new Promise(() => {});
  });
  bus.addEventListener("message", (e) => {
    const msg = e.data;
    if (msg?.type === MSG.HELLO) send();
    if (!leader && [MSG.SET, MSG.REGISTER, MSG.UNREGISTER].includes(msg?.type)) return;
    if (msg?.type === MSG.SET && Array.isArray(msg.values)) applySet(msg.values);
    if (msg?.type === MSG.REGISTER && Array.isArray(msg.requests)) {
      const results = api.register(msg.requests);
      // Start each new fixture at its stage values (moves the new faders).
      applySet(msg.requests.flatMap((req) => {
        const r = results.find((x) => x.stageId === req.stageId && x.ok);
        return r ? req.values.map((value, k) => ({ channel: r.start + k, value })) : [];
      }));
      bus.postMessage({ type: MSG.REGISTERED, results });
      send();
    }
    if (msg?.type === MSG.UNREGISTER && Array.isArray(msg.consoleIds)) api.unregister(msg.consoleIds);
    if (msg?.type === MSG.STAGE_SELECT && Array.isArray(msg.consoleIds)) api.reveal(msg.consoleIds);
    if (msg?.type === MSG.STAGE && Array.isArray(msg.fixtures)) {
      stageFixtures = msg.fixtures;
      trace?.refresh();
    }
  });
  setInterval(send, HEARTBEAT_MS);
  send();
  bus.postMessage({ type: MSG.STAGE_HELLO });

  // ⌥-click a fader, channel meter, Patch card or fixture row: show its
  // trace (instead of moving / renaming / dragging it).
  trace = createTracePopover();
  const onAltPress = (e) => {
    if (!e.altKey) return;
    const target = api.traceTarget(e.target);
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "pointerdown") trace.show(target, e.clientX, e.clientY, traceSnapshot);
  };
  // Swallow the whole ⌥-press (press, mouse down, click) so it can't also
  // move a fader, start a rename or begin a drag.
  for (const type of ["pointerdown", "mousedown", "click"]) document.addEventListener(type, onAltPress, true);
}

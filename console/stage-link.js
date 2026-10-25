/**
 * The console's side of its link with the stage (the other pane of the app),
 * over the in-page link (../shared/console-stage.js).
 *
 * Console → stage: the output levels, which fader(s) each patched channel
 * comes from, and the console's fixtures — on every output change and when
 * the stage starts.
 *
 * Stage → console: "set channel N to V" requests. The fader(s) patched to N
 * are moved (in the cue(s) currently on the output) so the output
 * becomes V, allowing for the patch max, master, submasters and crossfade.
 * The stage also asks to register / unregister fixtures placed / deleted there (app.js creates
 * the console fixture, patches free faders and names them). Channel roles the
 * stage knows and the console fixture lacks (e.g. amber, registered before
 * the console knew it) are filled in from the stage's fixtures.
 *
 * Trace: ⌥-click a fader (rows, Live meters, Patch cards), a channel meter or
 * a fixture row for a card showing what controls it, what it controls
 * and the current values (../shared/trace.js).
 */

import { UNIVERSE_SIZE } from "./patch.js";
import { createTracePopover, provideTrace } from "../shared/trace.js";
import { joinLink } from "../shared/console-stage.js";
import { clampByte } from "../shared/numbers.js";

/**
 * @typedef {{
 *   levels: () => Map<number, number>,
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
 *   adoptRoles: (stageFixtures: { consoleId?: string | null, layout?: (string | null)[] }[]) => void,
 *   reveal: (consoleIds: string[]) => void,
 * }} StageLinkApi
 */

/**
 * Call the stage (null until the link starts).
 * @type {((fn: (stage: import("../shared/console-stage.js").StageEnd) => void) => void) | null}
 */
let toStage = null;
/** @type {StageLinkApi | null} */
let api = null;
let queued = false;
/** @type {ReturnType<typeof createTracePopover> | null} */
let trace = null;
/** Tell the stage the output changed (coalesced to one call per tick). */
export function notifyStage() {
  if (!toStage || queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    send();
  });
}

function outputLevels() {
  // Every universe in the show, end to end (channel 513 = universe 2/1).
  const levels = new Array(api.universes() * UNIVERSE_SIZE).fill(0);
  for (const [channel, level] of api.levels()) if (channel <= levels.length) levels[channel - 1] = level;
  return levels;
}

function send() {
  if (!toStage || !api) return;
  trace?.refresh();
  const levels = outputLevels();
  /** channel → 1-based fader numbers patched to it */
  const faders = new Map();
  api.patch().forEach((targets, i) => {
    for (const t of targets) faders.set(t.channel, [...(faders.get(t.channel) ?? []), i + 1]);
  });
  const data = {
    levels,
    faders: [...faders.entries()],
    fixtures: api.fixtures().map(({ id, name, mount, color, channelStart, channelEnd, groupId }) => ({
      id, name, mount, color, channelStart, channelEnd, groupId,
    })),
    groups: api.groups().map(({ id, name }) => ({ id, name })),
    universes: api.universes(),
  };
  toStage((stage) => stage.levels(data));
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
  api = linkApi;
  toStage = joinLink("console", {
    hello: send,
    set: applySet,
    register(requests) {
      const results = api.register(requests);
      // Start each new fixture at its stage values (moves the new faders).
      applySet(requests.flatMap((req) => {
        const r = results.find((x) => x.stageId === req.stageId && x.ok);
        return r ? req.values.map((value, k) => ({ channel: r.start + k, value })) : [];
      }));
      toStage((stage) => stage.registered(results));
      send();
    },
    unregister: (consoleIds) => api.unregister(consoleIds),
    select: (consoleIds) => api.reveal(consoleIds),
    layouts: (list) => api.adoptRoles(list),
  });
  send();
  toStage((stage) => stage.hello());

  // ⌥-click a fader, channel meter, Patch card or fixture row: show its
  // trace (instead of moving / renaming / dragging it).
  trace = createTracePopover();
  provideTrace({
    console: () => ({ levels: outputLevels(), faders: api.faderInfo(), mix: api.mix(), universes: api.universes(), consoleFixtures: api.fixtures() }),
  });
  const onAltPress = (e) => {
    if (!e.altKey) return;
    const target = api.traceTarget(e.target);
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "pointerdown") trace.show(target, e.clientX, e.clientY);
  };
  // Swallow the whole ⌥-press (press, mouse down, click) so it can't also
  // move a fader, start a rename or begin a drag.
  for (const type of ["pointerdown", "mousedown", "click"]) document.addEventListener(type, onAltPress, true);
}

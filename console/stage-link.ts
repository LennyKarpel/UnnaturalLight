/**
 * The console's side of its link with the stage (the other pane of the app),
 * over the in-page link (../shared/console-stage.ts).
 *
 * Console → stage: the output levels, which fader(s) each patched channel
 * comes from, and the console's fixtures — on every output change and when
 * the stage starts.
 *
 * Stage → console: "aim fixture F at stage position P" (in the cue(s) on the
 * output) and "position P moved" (every cue aiming at it), see aims.ts.
 *
 * Stage → console: "set channel N to V" requests. The fader(s) patched to N
 * are moved (in the cue(s) currently on the output) so the output
 * becomes V, allowing for the patch max, master, submasters and crossfade.
 * The stage also asks to register / unregister fixtures placed / deleted there (app.ts creates
 * the console fixture, patches free faders and names them). Channel roles the
 * stage knows and the console fixture lacks (e.g. amber, registered before
 * the console knew it) are filled in from the stage's fixtures.
 *
 * Trace: ⌥-click a fader (rows, Live meters, Patch cards), a channel meter or
 * a fixture row for a card showing what controls it, what it controls
 * and the current values (../shared/trace.ts).
 */

import { UNIVERSE_SIZE, type FaderPatch } from "./patch.ts";
import { createTracePopover, provideTrace, type FaderInfo, type MixInfo, type TracePopover, type TraceTarget } from "../shared/trace.ts";
import { joinLink, type AimPair, type ConsoleEnd, type RegisterRequest, type RegisterResult, type StageEnd, type StageLevels } from "../shared/console-stage.ts";
import { setChannelLevels, type ChannelValue, type Mix } from "../shared/engine.ts";
import type { Fixture, FixtureGroup } from "./fixtures.ts";

export type StageLinkApi = {
  levels: () => Map<number, number>;
  /** levels, not rounded (see StageLevels.exact). */
  exactLevels: () => Map<number, number>;
  patch: () => FaderPatch[];
  live: () => Mix & { cueLevels: number[][] };
  fixtures: () => Fixture[];
  groups: () => FixtureGroup[];
  outlines: () => Map<string, string>;
  faderInfo: () => FaderInfo[];
  mix: () => MixInfo;
  universes: () => number;
  traceTarget: (el: EventTarget | null) => Exclude<TraceTarget, { kind: "stageFixture" }> | null;
  afterSet: () => void;
  register: (requests: RegisterRequest[]) => RegisterResult[];
  unregister: ConsoleEnd["unregister"];
  adoptRoles: ConsoleEnd["layouts"];
  reveal: ConsoleEnd["select"];
  hold: ConsoleEnd["hold"];
  aim: ConsoleEnd["aim"];
  reaim: ConsoleEnd["reaim"];
  /** Every aim at a named stage position in the show / in the cue on the output. */
  aims: () => AimPair[];
  liveAims: () => AimPair[];
};

/** Call the stage (null until the link starts). */
let toStage: ((fn: (stage: StageEnd) => void) => void) | null = null;
let linked: StageLinkApi | null = null;
let queued = false;
let trace: TracePopover | null = null;
/** Tell the stage the output changed (coalesced to one call per tick). */
export function notifyStage() {
  if (!toStage || queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    send();
  });
}

/** Every universe in the show, end to end (channel 513 = universe 2/1). */
function outputLevels(api: StageLinkApi, byChannel: Map<number, number>): number[] {
  const levels: number[] = new Array(api.universes() * UNIVERSE_SIZE).fill(0);
  for (const [channel, level] of byChannel) if (channel <= levels.length) levels[channel - 1] = level;
  return levels;
}

function send() {
  const api = linked;
  if (!toStage || !api) return;
  trace?.refresh();
  const levels = outputLevels(api, api.levels());
  /** channel → 1-based fader numbers patched to it */
  const faders = new Map<number, number[]>();
  api.patch().forEach((targets, i) => {
    for (const t of targets) faders.set(t.channel, [...(faders.get(t.channel) ?? []), i + 1]);
  });
  const data: StageLevels = {
    levels,
    exact: outputLevels(api, api.exactLevels()),
    faders: [...faders.entries()],
    fixtures: (() => {
      const outlines = api.outlines();
      return api.fixtures().map(({ id, name, mount, color, channelStart, channelEnd, groupId }) => ({
        id, name, mount, color, channelStart, channelEnd, groupId, outline: outlines.get(id) ?? null,
      }));
    })(),
    groups: api.groups().map(({ id, name }) => ({ id, name })),
    universes: api.universes(),
    aims: api.aims(),
    liveAims: api.liveAims(),
  };
  toStage((stage) => stage.levels(data));
}

function applySet(values: ChannelValue[]) {
  const api = linked;
  if (!api) return;
  const L = api.live();
  if (setChannelLevels(api.patch(), L, L.cueLevels, values)) api.afterSet();
}

export function startStageLink(api: StageLinkApi) {
  linked = api;
  const call = joinLink("console", {
    hello: send,
    set: applySet,
    register(requests) {
      const results = api.register(requests);
      // Start each new fixture at its stage values (moves the new faders).
      applySet(requests.flatMap((req) => {
        const r = results.find((x) => x.stageId === req.stageId && x.ok);
        return r?.ok ? req.values.map((value, k) => ({ channel: r.start + k, value })) : [];
      }));
      call((stage) => stage.registered(results));
      send();
    },
    unregister: (consoleIds) => api.unregister(consoleIds),
    select: (consoleIds) => api.reveal(consoleIds),
    layouts: (list) => api.adoptRoles(list),
    hold: (kind, channel, on) => api.hold(kind, channel, on),
    aim: (list) => api.aim(list),
    reaim: (list) => api.reaim(list),
  });
  toStage = call;
  send();
  call((stage) => stage.hello());

  // ⌥-click a fader, channel meter, Patch card or fixture row: show its
  // trace (instead of moving / renaming / dragging it).
  const card = createTracePopover();
  trace = card;
  provideTrace({
    console: () => ({ levels: outputLevels(api, api.levels()), faders: api.faderInfo(), mix: api.mix(), universes: api.universes(), consoleFixtures: api.fixtures() }),
  });
  const onAltPress = (e: MouseEvent) => {
    if (!e.altKey) return;
    const target = api.traceTarget(e.target);
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "pointerdown") card.show(target, e.clientX, e.clientY);
  };
  // Swallow the whole ⌥-press (press, mouse down, click) so it can't also
  // move a fader, start a rename or begin a drag.
  for (const type of ["pointerdown", "mousedown", "click"] as const) document.addEventListener(type, onAltPress, true);
}

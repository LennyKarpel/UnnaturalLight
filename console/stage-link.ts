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

import { exactScaledLevel, FADER_COUNT, scaledLevel, UNIVERSE_SIZE, type FaderPatch } from "./patch.ts";
import { createTracePopover, provideTrace, type FaderInfo, type MixInfo, type TracePopover, type TraceTarget } from "../shared/trace.ts";
import { joinLink, type AimPair, type ConsoleEnd, type RegisterRequest, type RegisterResult, type StageEnd, type StageLevels, type TransitionTest } from "../shared/console-stage.ts";
import { computeChannelLevels, exactLiveLevel, fadeCross, setChannelLevels, stepArrivals, stepAt, timeAt, type ChannelValue, type Mix, type StepPath } from "../shared/engine.ts";
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
  /**
   * The test fade's cues: the one before LIVE (null: nothing, so dark) and
   * LIVE, with their fader levels (LIVE's own look) and LIVE's steps.
   */
  testCues: () => {
    from: { label: string; levels: number[] } | null;
    to: { label: string; levels: number[]; path: StepPath | null; seconds: number };
    canBack: boolean;
    canForward: boolean;
  };
  /** Set the LIVE cue's In time (the 3D view's test fade). */
  setTestFade: (seconds: number) => void;
  /** Make the cue before / after LIVE the LIVE one (the test bar's ‹ ›). */
  stepCue: (step: -1 | 1) => void;
  /**
   * A live test: `start` makes the cue before LIVE the LIVE one (false: there's
   * none), `go` is GO and `step` is Step (false: it can't), `stop` puts the
   * tested cue back LIVE if the test hasn't got there.
   */
  liveTest: { start: () => boolean; go: () => boolean; step: () => boolean; stop: () => void };
};

/** How long the test fade shows the cue before LIVE before fading. */
const TEST_HOLD_MS = 1000;

/**
 * A test fade playing, or null. Its levels are copies: edits meanwhile don't
 * change it. It holds the cue before for a second, then fades (`fade`, by
 * crossfade as a GO: from `cross` to its target), all the way or (Step) to
 * the next step, where it waits for Step or Test again.
 */
type Test = {
  from: number[];
  to: number[];
  path: StepPath | null;
  totalMs: number;
  live: boolean;
  labels: { from: string; to: string; fadeSeconds: number };
  start: number;
  /** After the hold: whether it plays to the next step only. */
  step: boolean;
  cross: number;
  fade: { start: number; target: number; ms: number; at: number } | null;
};
let test: Test | null = null;

/** The test's output levels now (as the console would send them at that point of a GO), or null. */
function testLevels(api: StageLinkApi, exact: boolean): Map<number, number> | null {
  // A live test is the console's own GO: the output shows it as it is.
  if (!test || test.live) return null;
  const mix: Mix = { master: api.live().master, cross: test.cross, fromSub: 100, toSub: 100, fromCue: 0, toCue: 1, toPath: test.path };
  const cues = [test.from, test.to];
  const level = (i: number) => exactLiveLevel(mix, cues, i);
  return exact ? computeChannelLevels(api.patch(), level, exactScaledLevel) : computeChannelLevels(api.patch(), (i) => Math.round(level(i)), scaledLevel);
}

function testInfo(api: StageLinkApi): TransitionTest {
  const { from, to, canBack, canForward } = api.testCues();
  const looks = (test ? test.path : to.path)?.steps.length ?? 0;
  const running = test && {
    phase: performance.now() < test.start + TEST_HOLD_MS ? "hold" as const : test.fade ? "fade" as const : "held" as const,
    seconds: Math.round((timeAt(test.cross) * test.totalMs) / 100) / 10,
    live: test.live,
    step: test.path && test.cross > 0 ? stepAt(test.path, test.cross) + 1 : null,
  };
  return {
    // While a test plays, the cues it plays (a live test moves LIVE back a cue meanwhile).
    ...(test?.labels ?? { from: from?.label ?? "Dark", to: to.label, fadeSeconds: to.seconds }),
    steps: looks + 1,
    canBack,
    canForward,
    running,
  };
}

/** Fade on from where the test is: to the next step (`step`), else all the way. Live: the console's Step / GO. */
function fadeOn(api: StageLinkApi, t: Test, step: boolean) {
  const target = step && t.path ? (stepArrivals(t.path).find((at) => at > t.cross + 1e-6) ?? 100) : 100;
  if (t.live && !(step ? api.liveTest.step() : api.liveTest.go())) {
    // e.g. the server is offline
    api.liveTest.stop();
    test = null;
    return;
  }
  t.fade = { start: t.cross, target, ms: (timeAt(target) - timeAt(t.cross)) * t.totalMs, at: performance.now() };
}

/**
 * Play the test fade, a frame at a time, then hand the stage back to the live
 * output. Live: step back to the cue before, and GO (or Step) when the hold is over.
 */
function startTest(api: StageLinkApi, live: boolean, step: boolean) {
  const { from, to } = api.testCues();
  if (live && !api.liveTest.start()) return;
  const mine: Test = {
    from: [...(from?.levels ?? new Array(FADER_COUNT).fill(0))],
    to: [...to.levels],
    path: to.path && { fade: to.path.fade, steps: to.path.steps.map((s) => ({ ...s, levels: [...s.levels] })) },
    totalMs: to.seconds * 1000,
    live,
    labels: { from: from?.label ?? "Dark", to: to.label, fadeSeconds: to.seconds },
    start: performance.now(),
    step,
    cross: 0,
    fade: null,
  };
  test = mine;
  let went = false;
  const frame = () => {
    if (test !== mine) return;
    const now = performance.now();
    if (!went && now >= mine.start + TEST_HOLD_MS) {
      went = true;
      fadeOn(api, mine, mine.step);
    }
    const f = mine.fade;
    if (f) {
      const t = f.ms > 0 ? (now - f.at) / f.ms : 1;
      mine.cross = fadeCross(f.start, f.target, t);
      if (t >= 1) {
        mine.cross = f.target;
        mine.fade = null;
        if (f.target >= 100) test = null; // done: the live output again (it's the same cue)
      }
    }
    send();
    if (test === mine) requestAnimationFrame(frame);
  };
  frame();
}

/** Step: start a test that stops at LIVE's first step, or play a held one on to its next. */
function stepTest(api: StageLinkApi, live: boolean) {
  if (!test) return startTest(api, live, true);
  if (test.fade || performance.now() < test.start + TEST_HOLD_MS) return; // under way: wait for it
  fadeOn(api, test, true);
  send();
}

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
  const levels = outputLevels(api, testLevels(api, false) ?? api.levels());
  /** channel → 1-based fader numbers patched to it */
  const faders = new Map<number, number[]>();
  api.patch().forEach((targets, i) => {
    for (const t of targets) faders.set(t.channel, [...(faders.get(t.channel) ?? []), i + 1]);
  });
  const data: StageLevels = {
    levels,
    exact: outputLevels(api, testLevels(api, true) ?? api.exactLevels()),
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
    test: testInfo(api),
  };
  toStage((stage) => stage.levels(data));
}

function applySet(values: ChannelValue[]) {
  const api = linked;
  // During a test fade the stage shows the test, not the cue being edited.
  if (!api || test) return;
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
    testFade(on, live = false) {
      // Test on a test held on a step: play the rest.
      if (on && test && !test.fade && test.cross > 0) {
        fadeOn(api, test, false);
        return send();
      }
      if (test?.live) api.liveTest.stop();
      test = null;
      if (on) startTest(api, live, false);
      send();
    },
    testStep: (live = false) => stepTest(api, live),
    setTestFade: (seconds) => api.setTestFade(seconds),
    stepCue(step) {
      test = null; // a test of the old LIVE cue would be wrong now
      api.stepCue(step);
      send();
    },
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

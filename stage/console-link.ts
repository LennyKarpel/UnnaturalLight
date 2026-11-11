// Stage side of the live link with the console (the other pane of the app;
// see console/stage-link.ts), over the in-page link (../shared/console-stage.ts).
//
//   console → stage   output levels (0–255 per DMX channel), which fader(s)
//                     drive each channel, and the console's fixtures
//   stage → console   "set channel N to V" when a linked value is changed here,
//                     aims at named positions (follow.ts),
//                     and the stage's channel layouts (the console takes
//                     color roles its fixtures lack); the 3D view's test fade
//                     (play / stop, and the LIVE cue's In time)
//
// Only channels with a fader patched are synced. A channel is sent only after
// the console's value for it has been heard, so opening the stage never moves
// a console fader; and a value just sent is held briefly against the
// console's older broadcasts so dragging a slider doesn't jitter.

import { joinLink, type AimPair, type AimRequest, type Reaim, type RegisterRequest, type RegisterResult, type StageLayout, type StageLevels, type TransitionTest } from "../shared/console-stage.ts";
import type { ChannelValue } from "../shared/engine.ts";

/** How long a value sent from the stage wins over the console's updates (e.g. an older one from the show server). */
const PENDING_MS = 600;

/** A console fixture as the stage hears of it. */
export type ConsoleFixture = StageLevels["fixtures"][number];

export function createConsoleLink({
  onLevels,
  onStageHello,
  onRegistered,
}: {
  onLevels: () => void;
  onStageHello: () => void;
  onRegistered: (results: RegisterResult[]) => void;
}) {
  let levels: number[] | null = null;
  /** levels not rounded (mid-fade in-between values), for drawing */
  let exact: number[] | null = null;
  /** channel → fader numbers (1-based) patched to it */
  let faders = new Map<number, number[]>();
  let fixtures: ConsoleFixture[] = [];
  /** The console set's universe count (channel 513 = universe 2/1). */
  let universes = 1;
  /** Aims at named positions: in any cue / in the cue on the output. */
  let aims: AimPair[] = [];
  let liveAims: AimPair[] = [];
  /** The test fade's cues and time (null until the console starts). */
  let test: TransitionTest | null = null;
  const testListeners: ((t: TransitionTest) => void)[] = [];
  /** channel → the value the console and stage agree on (heard or sent) */
  const synced = new Map<number, number>();
  /** channel → { value, until }: just sent from the stage */
  const pending = new Map<number, { value: number; until: number }>();

  const toConsole = joinLink("stage", {
    hello: onStageHello,
    registered: onRegistered,
    levels(data) {
      levels = data.levels;
      exact = data.exact;
      faders = new Map(data.faders);
      fixtures = data.fixtures;
      universes = data.universes;
      aims = data.aims;
      liveAims = data.liveAims;
      test = data.test;
      onLevels();
      for (const fn of testListeners) fn(data.test);
    },
  });
  toConsole((c) => c.hello());

  return {
    /** The console has started (it's in the same page, so from then on it's always there). */
    get live() {
      return levels != null;
    },
    /** The console's fixtures. */
    fixtures: () => fixtures,
    /** Universes in the console's set (1 until it starts). */
    get universes() { return universes; },
    /** Fader numbers patched to a channel ([] = none / unknown). */
    fadersFor: (channel: number): number[] => faders.get(channel) ?? [],
    /** The console's output levels (0–255 per channel; null until it starts). */
    get levels() { return levels; },
    /** Ask the console to create fixtures (+ patch / name free faders) for stage fixtures. */
    register(requests: RegisterRequest[]) {
      toConsole((c) => c.register(requests));
    },
    /** Ask the console to remove fixtures the stage registered (frees their faders). */
    unregister(consoleIds: string[]) {
      if (consoleIds.length) toConsole((c) => c.unregister(consoleIds));
    },
    /** Send the stage's channel layouts to the console (for color roles its fixtures lack). */
    publishStage(list: StageLayout[]) {
      toConsole((c) => c.layouts(list));
    },
    /** Tell the console which of its fixtures are selected here (it scrolls to and highlights their faders; [] = none). */
    publishSelection(consoleIds: string[]) {
      toConsole((c) => c.select(consoleIds));
    },
    /**
     * The console's value for a channel that the stage should take now, or
     * null (no fader patched, nothing heard yet, or a stage change in flight).
     */
    /** The console's unrounded level on `channel` (to draw a fade's in-between values). */
    exactLevel(channel: number): number | null {
      return exact?.[channel - 1] ?? null;
    },
    incoming(channel: number): number | null {
      if (!levels || !faders.has(channel)) return null;
      const v = levels[channel - 1];
      const p = pending.get(channel);
      if (p) {
        if (v !== p.value && Date.now() < p.until) return null;
        pending.delete(channel);
      }
      synced.set(channel, v);
      return v;
    },
    /** Send the stage's values for channels that changed here. */
    push(entries: ChannelValue[]) {
      if (levels == null) return;
      const values: ChannelValue[] = [];
      for (const { channel, value } of entries) {
        if (!synced.has(channel) || synced.get(channel) === value) continue;
        synced.set(channel, value);
        pending.set(channel, { value, until: Date.now() + PENDING_MS });
        values.push({ channel, value });
      }
      if (values.length) toConsole((c) => c.set(values));
    },
    /** Hold (on) or release the console's blackout / flash on the dimmer fader(s) patched to `channel`. */
    hold(kind: "blackout" | "flash", channel: number, on: boolean) {
      toConsole((c) => c.hold(kind, channel, on));
    },
    /** Every console fixture → position aim in the show's cues. */
    aims: () => aims,
    /** The aims in the cue on the output. */
    liveAims: () => liveAims,
    /** Aim console fixtures at positions in the cue(s) on the output (position null: stop). */
    aim(list: AimRequest[]) {
      toConsole((c) => c.aim(list));
    },
    /** Positions or fixtures moved: update the cues that aim at them. */
    reaim(list: Reaim[]) {
      toConsole((c) => c.reaim(list));
    },
    /** The test fade's cues and time, and whether it's playing (null until the console starts). */
    get test() { return test; },
    /** Call `fn` with each update of the test fade's info. */
    onTest(fn: (t: TransitionTest) => void) {
      testListeners.push(fn);
      if (test) fn(test);
    },
    /** Play (or stop) the fade into the LIVE cue: on the stage only, or `live` on the lights too. */
    testFade(on: boolean, live = false) {
      toConsole((c) => c.testFade(on, live));
    },
    /** The test one step at a time: play to LIVE's next step and hold (`live`: on the lights too). */
    testStep(live = false) {
      toConsole((c) => c.testStep(live));
    },
    /** Make the cue before (-1) / after (+1) LIVE the LIVE one: the cue the stage edits. */
    stepCue(step: -1 | 1) {
      toConsole((c) => c.stepCue(step));
    },
    /** Set the LIVE cue's In time (seconds). */
    setTestFade(seconds: number) {
      toConsole((c) => c.setTestFade(seconds));
    },
    /** Set one channel the stage doesn't model (e.g. a fixture's strobe) to `value`. */
    setChannel(channel: number, value: number) {
      if (levels == null) return;
      synced.set(channel, value);
      pending.set(channel, { value, until: Date.now() + PENDING_MS });
      toConsole((c) => c.set([{ channel, value }]));
    },
  };
}

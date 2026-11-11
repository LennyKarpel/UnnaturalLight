/**
 * The live link between the console and the stage, inside the app (they're
 * one page, ../index.html): each side joins with the functions the other may
 * call (console/stage-link.ts, stage/console-link.ts) and calls the other's.
 * A call runs once the caller's current work is done (a microtask), so a side
 * never runs halfway through the other's update; one made before the other
 * side has joined is dropped (each says hello on joining). Other app windows
 * aren't on it: each window has its own console and stage, kept together by
 * the show server.
 */

import type { ChannelRole, ColorMode, Fixture, FixtureGroup, MountType } from "../console/fixtures.ts";
import type { ChannelValue } from "./engine.ts";

/** The stage asks the console to create a fixture for one placed on the stage. */
export type RegisterRequest = {
  stageId: string;
  name: string;
  mount: MountType;
  color: ColorMode;
  /** Fader names, one per channel. */
  labels: string[];
  /** What each channel does, when known. */
  roles?: (ChannelRole | null)[];
  /** Each channel's value on the stage now (the new faders start there). */
  values: number[];
  width: number;
  group: string | null;
  universe?: number | null;
};

/** What became of a RegisterRequest. */
export type RegisterResult =
  | { stageId: string; ok: true; consoleId: string; start: number; faders: number[] }
  | { stageId: string; ok: false; error: string };

/** A stage fixture's channel layout, for the console fixture it's linked to. */
export type StageLayout = { consoleId: string | null; layout: (ChannelRole | null)[] };

/**
 * Aim a console fixture at a named stage position (as a position preset):
 * the stage's values for its pan / tilt channels, written into the cue(s) on
 * the output, which remember the aim. position null: they forget it.
 */
export type AimRequest = { consoleId: string; position: string | null; values: ChannelValue[] };

/**
 * A position (or the fixture) moved: every cue that aims `consoleId` at
 * `position` and still has `from` on those channels gets `to`.
 */
export type Reaim = { consoleId: string; position: string; from: ChannelValue[]; to: ChannelValue[] };

/** A console fixture aimed at a named stage position. */
export type AimPair = { fixture: string; position: string };

/**
 * What the stage may call on the console:
 *   hello       the stage started (the console sends its levels now)
 *   set         set channels to values (moves the faders patched to them)
 *   register    create console fixtures for fixtures placed on the stage
 *               (the console answers with the stage's `registered`)
 *   unregister  remove console fixtures the stage registered
 *   select      console fixtures selected on the stage (the console highlights them)
 *   layouts     the stage's channel layouts (the console takes color roles its fixtures lack)
 *   hold        the stage's B / F held (on) or released on a dimmer channel
 *   aim         aim fixtures at positions in the cue(s) on the output
 *   reaim       positions or fixtures moved: update the cues that aim at them
 *   testFade    play (true) or stop (false) a test of the fade into the LIVE
 *               cue (see TransitionTest): on the stage only, or `live` on
 *               the lights too
 *   testStep    the test, one step at a time: play to the LIVE cue's next
 *               step and hold (on its last: all the way)
 *   testStepBack a held test: back to the step before, at once; otherwise
 *               (or live) the console's ‹ Step (the look before LIVE's, LIVE)
 *   setTestFade set the LIVE cue's In time (seconds), as the test uses it
 *   stepCue     make the cue before (-1) or after (+1) LIVE the LIVE one (the
 *               cue the stage edits), as the console's ◀ ▶ beside GO do
 */
export type ConsoleEnd = {
  hello: () => void;
  set: (values: ChannelValue[]) => void;
  register: (requests: RegisterRequest[]) => void;
  unregister: (consoleIds: string[]) => void;
  select: (consoleIds: string[]) => void;
  layouts: (list: StageLayout[]) => void;
  hold: (kind: "blackout" | "flash", channel: number, on: boolean) => void;
  aim: (list: AimRequest[]) => void;
  reaim: (list: Reaim[]) => void;
  testFade: (on: boolean, live?: boolean) => void;
  testStep: (live?: boolean) => void;
  testStepBack: (live?: boolean) => void;
  setTestFade: (seconds: number) => void;
  stepCue: (step: -1 | 1) => void;
};

/**
 * The 3D view's Test: the cue before the LIVE one (`from`; "Dark" when
 * nothing comes before it) for a second, then the fade into LIVE (`to`) over
 * its In time. On the stage only, the console, the show server and the
 * lights don't change. Live, it's the real thing: the cue before is made
 * LIVE, and a second later GO (so it needs a cue before, and the server).
 */
export type TransitionTest = {
  from: string;
  to: string;
  /** How long the fade into LIVE takes (its steps' times and its own In time; seconds). */
  fadeSeconds: number;
  /** LIVE's looks: its steps and its own (1: no steps; then the In time can be set here). */
  steps: number;
  /** Whether there's a cue before / after LIVE (for ‹ ›; across set songs, as ◀ ▶ beside GO). */
  canBack: boolean;
  canForward: boolean;
  /** Whether ‹ Step has somewhere to go (a held test's step before, or the look before LIVE's). */
  canStepBack: boolean;
  /** While a test plays: in the first second ("hold") or fading, and seconds into the fade. */
  /**
   * While a test plays: holding the cue before ("hold"), fading, or held on a
   * step ("held", after Step), how far in (seconds), and the step it's on or
   * fading into (1-based; null: no steps, or not started).
   */
  running: { phase: "hold" | "fade" | "held"; seconds: number; live: boolean; step: number | null } | null;
};

/** What the console sends the stage on every output change. */
export type StageLevels = {
  /** Each channel's output (0–255, whole numbers as DMX sends them). */
  levels: number[];
  /** The same, not rounded: the in-between levels a fade passes through, for drawing. */
  exact: number[];
  faders: [number, number[]][];
  /** The console's fixtures, with the outline color drawn around their faders. */
  fixtures: (Fixture & { outline: string | null })[];
  groups: FixtureGroup[];
  universes: number;
  /** Every aim at a named position, in any cue of the show. */
  aims: AimPair[];
  /** The aims in the cue on the output (during a crossfade: the one past halfway). */
  liveAims: AimPair[];
  /** The test fade's cues and time, and whether one is playing (the levels above are then the test's). */
  test: TransitionTest;
};

/**
 * What the console may call on the stage:
 *   hello       the console started (the stage sends its layouts now)
 *   levels      output levels, patch and fixtures (every output change)
 *   registered  results of a `register`
 */
export type StageEnd = {
  hello: () => void;
  levels: (data: StageLevels) => void;
  registered: (results: RegisterResult[]) => void;
};

type Ends = { console: ConsoleEnd; stage: StageEnd };
type Other<S extends keyof Ends> = S extends "console" ? "stage" : "console";

const ends: { [S in keyof Ends]: Ends[S] | null } = { console: null, stage: null };

/**
 * Join the link as `side` with the functions the other side may call.
 * Returns `call(fn)`: runs `fn` with the other side's functions after the
 * current work (dropped if the other side hasn't joined).
 */
export function joinLink<S extends keyof Ends>(side: S, end: Ends[S]): (fn: (other: Ends[Other<S>]) => void) => void {
  (ends as Record<keyof Ends, unknown>)[side] = end;
  const other = (side === "console" ? "stage" : "console") as Other<S>;
  return (fn) =>
    queueMicrotask(() => {
      const o = ends[other] as Ends[Other<S>] | null;
      if (o) fn(o);
    });
}

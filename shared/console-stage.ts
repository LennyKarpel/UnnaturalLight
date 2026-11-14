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
 *   go          press a button of the GO area (the 3D view's GO bar): the
 *               console does exactly what its own button does, on the lights
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
  go: (button: GoButton) => void;
  /** Move the crossfader (0–100), as dragging the console's does. */
  cross: (pct: number) => void;
};

/** What the GO button does now: GO, or Pause / Resume the fade it started. */
export type GoMode = "go" | "pause" | "resume";
/** What GO says in each mode (the console's and the 3D view's GO bar's). */
export const GO_LABELS: Record<GoMode, string> = { go: "GO", pause: "Pause", resume: "Resume" };

/** The GO area's buttons: « ‹ GO › ». */
export type GoButton = "prevCue" | "stepBack" | "go" | "step" | "nextCue";

/**
 * The console's GO area, as it shows it: the stage's GO bar shows the same
 * and its buttons do the same (console/live.ts goArea makes it for both).
 */
export type GoArea = {
  /** LIVE: the cue on stage now, and its step ("" or " · step 2 of 3"). */
  live: string;
  liveStep: string;
  /** UP NEXT: the cue GO fades to ("End of set": nothing), its steps (" · step 3"), and its fade ("4s", "3 steps · 12s"). */
  next: string;
  nextStep: string;
  nextFade: string;
  /** Under GO: how far the crossfade is, and the step ("9% · into step 1 of 3"). */
  readout: string;
  /** A GO fade is playing (not paused). */
  running: boolean;
  /** What GO does now, and says: "go" (GO), "pause" (Pause: a fade is playing) or "resume" (Resume: it's paused). */
  goMode: GoMode;
  /** The crossfader as shown (0 = all LIVE, 100 = all UP NEXT; between server updates, where a running fade is now). */
  cross: number;
  /** Where UP NEXT's steps land on the crossfader (0–1), as the console's ticks. */
  ticks: number[];
  /** Each button: whether it can be pressed, and what it does (its tooltip). */
  buttons: Record<GoButton, { enabled: boolean; title: string }>;
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
  /** The GO area, as the console shows it. */
  go: GoArea;
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

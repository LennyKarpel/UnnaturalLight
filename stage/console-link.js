// Stage side of the live link with the console (the other pane of the app;
// see console/stage-link.js), over the in-page link (../shared/console-stage.js).
//
//   console → stage   output levels (0–255 per DMX channel), which fader(s)
//                     drive each channel, and the console's fixtures
//   stage → console   "set channel N to V" when a linked value is changed here,
//                     and the stage's channel layouts (the console takes
//                     color roles its fixtures lack)
//
// Only channels with a fader patched are synced. A channel is sent only after
// the console's value for it has been heard, so opening the stage never moves
// a console fader; and a value just sent is held briefly against the
// console's older broadcasts so dragging a slider doesn't jitter.

import { joinLink } from "../shared/console-stage.js";

/** How long a value sent from the stage wins over the console's updates (e.g. an older one from the show server). */
const PENDING_MS = 600;

/**
 * @typedef {{ id: string, name: string, mount: string, color: string, channelStart: number, channelEnd: number, groupId: string | null }} ConsoleFixture
 */

/** @param {{ onLevels: () => void, onStageHello: () => void, onRegistered: (results: any[]) => void }} opts */
export function createConsoleLink({ onLevels, onStageHello, onRegistered }) {
  /** @type {number[] | null} */
  let levels = null;
  /** channel → fader numbers (1-based) patched to it */
  let faders = new Map();
  /** @type {ConsoleFixture[]} */
  let fixtures = [];
  /** The console set's universe count (channel 513 = universe 2/1). */
  let universes = 1;
  /** channel → the value the console and stage agree on (heard or sent) */
  const synced = new Map();
  /** channel → { value, until }: just sent from the stage */
  const pending = new Map();

  const toConsole = joinLink("stage", {
    hello: onStageHello,
    registered: onRegistered,
    levels(data) {
      levels = data.levels;
      faders = new Map(data.faders);
      fixtures = data.fixtures;
      universes = data.universes;
      onLevels();
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
    fadersFor: (channel) => faders.get(channel) ?? [],
    /** The console's output levels (0–255 per channel; null until it starts). */
    get levels() { return levels; },
    /** Ask the console to create fixtures (+ patch / name free faders) for stage fixtures. */
    register(requests) {
      toConsole((c) => c.register(requests));
    },
    /** Ask the console to remove fixtures the stage registered (frees their faders). */
    unregister(consoleIds) {
      if (consoleIds.length) toConsole((c) => c.unregister(consoleIds));
    },
    /** Send the stage's channel layouts to the console (for color roles its fixtures lack). */
    publishStage(list) {
      toConsole((c) => c.layouts(list));
    },
    /** Tell the console which of its fixtures are selected here (it scrolls to and highlights their faders; [] = none). */
    publishSelection(consoleIds) {
      toConsole((c) => c.select(consoleIds));
    },
    /**
     * The console's value for a channel that the stage should take now, or
     * null (no fader patched, nothing heard yet, or a stage change in flight).
     */
    incoming(channel) {
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
    push(entries) {
      if (!this.live) return;
      const values = [];
      for (const { channel, value } of entries) {
        if (!synced.has(channel) || synced.get(channel) === value) continue;
        synced.set(channel, value);
        pending.set(channel, { value, until: Date.now() + PENDING_MS });
        values.push({ channel, value });
      }
      if (values.length) toConsole((c) => c.set(values));
    },
    /** Set one channel the stage doesn't model (e.g. a fixture's strobe) to `value`. */
    setChannel(channel, value) {
      if (!this.live) return;
      synced.set(channel, value);
      pending.set(channel, { value, until: Date.now() + PENDING_MS });
      toConsole((c) => c.set([{ channel, value }]));
    },
  };
}

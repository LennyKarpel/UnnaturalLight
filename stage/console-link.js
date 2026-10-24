// Stage side of the live link with the console (see console/stage-link.js),
// over a BroadcastChannel between tabs of the same site.
//
//   console → stage   output levels (0–255 per DMX channel), which fader(s)
//                     drive each channel, and the console's fixtures
//   stage → console   "set channel N to V" when a linked value is changed here,
//                     and the stage's lights (for the console's ⌥-click trace)
//
// Only channels with a fader patched are synced. A channel is sent only after
// the console's value for it has been heard, so opening the stage never moves
// a console fader; and a value just sent is held briefly against the
// console's older broadcasts so dragging a slider doesn't jitter.

const CHANNEL_NAME = "unnaturallight.dmx";
/** Where the console saves its session (its fixtures are read from here while it's closed). */
const CONSOLE_SESSION_KEY = "unnaturallight.setlist.session.v1";
/** No message for this long = console offline. */
const LIVE_MS = 2500;
/** How long a value sent from the stage wins over the console's broadcasts. */
const PENDING_MS = 600;
/**
 * How long the console someone is working in (it marks its messages
 * `local`) wins over other consoles, whose copies of the same change arrive
 * a moment later and would pull the stage back.
 */
const ACTIVE_MS = 600;

/**
 * @typedef {{ id: string, name: string, mount: string, color: string, channelStart: number, channelEnd: number, groupId: string | null }} ConsoleFixture
 */

function readSavedFixtures() {
  try {
    const data = JSON.parse(localStorage.getItem(CONSOLE_SESSION_KEY) ?? "null");
    // Older console sessions called them "instruments".
    const list = Array.isArray(data?.fixtures) ? data.fixtures : Array.isArray(data?.instruments) ? data.instruments : [];
    return list.filter((i) => typeof i?.id === "string" && Number.isInteger(i.channelStart) && Number.isInteger(i.channelEnd));
  } catch {
    return [];
  }
}

/** @param {{ onLevels: () => void, onStageHello: () => void, onRegistered: (results: any[]) => void }} opts */
export function createConsoleLink({ onLevels, onStageHello, onRegistered }) {
  const bus = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL_NAME);
  let lastHeard = 0;
  /** @type {number[] | null} */
  let levels = null;
  /** channel → fader numbers (1-based) patched to it */
  let faders = new Map();
  /** @type {ConsoleFixture[]} */
  let fixtures = readSavedFixtures();
  /** Per fader: number, name, live level, transition values, patch (for traces). */
  let faderInfo = null;
  /** Master / submasters / crossfade and transition names (for traces). */
  let mix = null;
  /** The console set's universe count (channel 513 = universe 2/1). */
  let universes = 1;
  /** channel → the value the console and stage agree on (heard or sent) */
  const synced = new Map();
  /** channel → { value, until }: just sent from the stage */
  const pending = new Map();
  /** The console last worked in, and until when its messages win. */
  let activeSource = null;
  let activeUntil = 0;

  bus?.addEventListener("message", (e) => {
    const msg = e.data;
    if (msg?.type === "stage-hello") { onStageHello(); return; }
    if (msg?.type === "registered" && Array.isArray(msg.results)) { onRegistered(msg.results); return; }
    if (msg?.type !== "levels" || !Array.isArray(msg.levels)) return;
    lastHeard = Date.now();
    if (msg.local) {
      activeSource = msg.source;
      activeUntil = lastHeard + ACTIVE_MS;
    } else if (msg.source !== activeSource && lastHeard < activeUntil) {
      return;
    }
    levels = msg.levels;
    faders = new Map(Array.isArray(msg.faders) ? msg.faders : []);
    if (Array.isArray(msg.fixtures)) fixtures = msg.fixtures;
    faderInfo = Array.isArray(msg.faderInfo) ? msg.faderInfo : null;
    mix = msg.mix ?? null;
    universes = Number.isInteger(msg.universes) && msg.universes >= 1 ? msg.universes : 1;
    onLevels();
  });
  bus?.postMessage({ type: "hello" });

  return {
    get live() {
      return Date.now() - lastHeard < LIVE_MS;
    },
    /** The console's fixtures (live, or from its saved session). */
    fixtures: () => fixtures,
    /** Universes in the console's set (1 while offline / unknown). */
    get universes() { return universes; },
    /** Fader numbers patched to a channel ([] = none / unknown). */
    fadersFor: (channel) => faders.get(channel) ?? [],
    /** What the console last sent, for traces (null while offline). */
    traceInfo() {
      return this.live ? { levels, faders: faderInfo, mix, universes } : { levels: null, faders: null, mix: null, universes };
    },
    /** Ask the console to create fixtures (+ patch / name free faders) for lights. */
    register(requests) {
      bus?.postMessage({ type: "register", requests });
    },
    /** Ask the console to remove fixtures the stage registered (frees their faders). */
    unregister(consoleIds) {
      if (consoleIds.length) bus?.postMessage({ type: "unregister", consoleIds });
    },
    /** Send the stage's lights to the console (for its traces). */
    publishStage(list) {
      bus?.postMessage({ type: "stage", fixtures: list });
    },
    /** Tell the console which of its fixtures are selected here (it scrolls to and highlights their faders; [] = none). */
    publishSelection(consoleIds) {
      bus?.postMessage({ type: "stage-select", consoleIds });
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
      if (!bus || !this.live) return;
      const values = [];
      for (const { channel, value } of entries) {
        if (!synced.has(channel) || synced.get(channel) === value) continue;
        synced.set(channel, value);
        pending.set(channel, { value, until: Date.now() + PENDING_MS });
        values.push({ channel, value });
      }
      if (values.length) bus.postMessage({ type: "set", values });
    },
  };
}

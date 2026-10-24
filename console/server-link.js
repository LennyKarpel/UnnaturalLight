/**
 * Link to the show server (../server/server.js) over a WebSocket.
 *
 * The server holds the show, runs fades and drives the DMX USB Pro(s); every
 * console (this machine or another one) is a remote view of it:
 *
 *   console → server   edits as they happen: the whole set when its structure
 *                      changes, single fader levels while dragging, the live
 *                      mix (master, subs, crossfade, Current / Next), held
 *                      flash / blackout buttons, GO / pause / stop,
 *                      DMX connect / disconnect, and the stage from a
 *                      loaded set file (stage pages keep it up to date
 *                      themselves, see ../stage/show-link.js)
 *   server → console   the same, from other consoles, plus fade steps and
 *                      DMX status
 *
 * app.js tells the link what the console looks like now (`sync`); the link
 * works out what changed since it last agreed with the server and sends only
 * that. A value just changed here is held briefly against the server's older
 * broadcasts so dragging doesn't jitter (as the stage link does).
 *
 * Other machines open the console with ?token=… (printed by the server).
 * The connection itself (token, reconnecting) is ../shared/server-socket.js.
 */

import { openServerSocket } from "../shared/server-socket.js";
import { LIVE_FIELDS, SNAPSHOT_FIELDS } from "../shared/live-fields.js";

/** How long a value changed here wins over the server's broadcasts. */
const PENDING_MS = 600;

/**
 * @typedef {{
 *   set: Record<string, any>,
 *   snapshots: Record<string, number | null>,
 *   flashing: Set<number>,
 *   blackedOut: Set<number>,
 * }} LocalView what the console shows now (`set` = currentSetState(), live fields included)
 *
 * @typedef {{
 *   view: () => LocalView,
 *   onHello: (msg: { set: object | null, live: object | null, outputs: object[] }) => void,
 *   onSet: (set: object, live: object) => void,
 *   onLive: (live: object) => void,
 *   onLevels: (cells: [string, number, number][]) => void,
 *   onOutputs: (outputs: object[]) => void,
 *   onConnection: (connected: boolean) => void,
 * }} ServerLinkApi
 */

/** Structure of the set: everything but live fields and fader levels. */
function structureKey(set) {
  const rest = { ...set };
  for (const f of LIVE_FIELDS) delete rest[f];
  return JSON.stringify(rest, (key, value) => (key === "levels" ? undefined : value));
}

/** cue id → copy of its levels */
function levelsById(set) {
  const map = new Map();
  for (const song of set.songs) for (const t of song.cues) map.set(t.id, [...t.levels]);
  return map;
}

const holdsKey = (flashing, blackedOut) => `${[...flashing].sort((a, b) => a - b)}|${[...blackedOut].sort((a, b) => a - b)}`;

/** @param {ServerLinkApi} api */
export function createServerLink(api) {
  let connected = false;
  let queued = false;
  /** What the server and this console agree on (null until the server's hello). */
  let agreed = null;
  /** field / "cueId:fader" → until (ms): changed here, not yet confirmed */
  const pending = new Map();
  let nextRequest = 1;
  /** The newest server message heard (its `seq`), for the stage link. */
  let seq = 0;
  /** request id → resolve */
  const replies = new Map();

  const isPending = (key) => {
    const until = pending.get(key);
    if (until == null) return false;
    if (Date.now() < until) return true;
    pending.delete(key);
    return false;
  };
  const touch = (key) => pending.set(key, Date.now() + PENDING_MS);

  function send(msg) {
    if (connected) socket.send(msg);
  }

  const liveOf = (v) => Object.fromEntries([...LIVE_FIELDS.map((f) => [f, v.set[f]]), ...SNAPSHOT_FIELDS.map((f) => [f, v.snapshots[f]])]);

  /** Remember the console's current view as agreed with the server. */
  function agree() {
    const v = api.view();
    agreed = {
      structure: structureKey(v.set),
      levels: levelsById(v.set),
      live: liveOf(v),
      holds: holdsKey(v.flashing, v.blackedOut),
    };
  }

  /** Send whatever changed here since the console and server last agreed. */
  function flush() {
    queued = false;
    if (!connected || !agreed) return;
    const v = api.view();

    const structure = structureKey(v.set);
    if (structure !== agreed.structure) {
      send({ type: "set", set: v.set });
      agreed.structure = structure;
      agreed.levels = levelsById(v.set);
    } else {
      const cells = [];
      for (const song of v.set.songs) {
        for (const t of song.cues) {
          const was = agreed.levels.get(t.id);
          if (!was) continue;
          for (let i = 0; i < t.levels.length; i++) {
            if (t.levels[i] === was[i]) continue;
            cells.push([t.id, i, t.levels[i]]);
            was[i] = t.levels[i];
            touch(`${t.id}:${i}`);
          }
        }
      }
      if (cells.length) send({ type: "levels", cells });
    }

    const live = {};
    for (const f of LIVE_FIELDS) if (v.set[f] !== agreed.live[f]) live[f] = v.set[f];
    for (const f of SNAPSHOT_FIELDS) if (v.snapshots[f] !== agreed.live[f]) live[f] = v.snapshots[f];
    if (Object.keys(live).length) {
      for (const f of Object.keys(live)) {
        agreed.live[f] = live[f];
        touch(f);
      }
      send({ type: "live", live });
    }

    const holds = holdsKey(v.flashing, v.blackedOut);
    if (holds !== agreed.holds) {
      agreed.holds = holds;
      send({ type: "hold", flashing: [...v.flashing], blackedOut: [...v.blackedOut] });
    }
  }

  /** Live values from the server, minus fields changed here moments ago. */
  function filterLive(live) {
    const out = { ...live };
    for (const f of [...LIVE_FIELDS, ...SNAPSHOT_FIELDS]) if (isPending(f)) delete out[f];
    return out;
  }

  const socket = openServerSocket({
    onMessage(msg) {
      if (Number.isFinite(msg.seq)) seq = Math.max(seq, msg.seq);
      if (msg.type === "hello") {
        connected = true;
        pending.clear();
        api.onHello(msg);
        if (msg.set) {
          agree();
        } else {
          // Empty server (first run): this console's show becomes the show.
          agree();
          send({ type: "seed", set: api.view().set });
        }
        api.onConnection(true);
        return;
      }
      if (!agreed) return;
      if (msg.type === "set") {
        api.onSet(msg.set, filterLive(msg.live ?? {}));
        agree();
      } else if (msg.type === "live") {
        api.onLive(filterLive(msg.live));
        // Only the live mix moved (many times a second while fading): leave the rest.
        agreed.live = liveOf(api.view());
      } else if (msg.type === "levels") {
        const cells = msg.cells.filter(([id, i]) => !isPending(`${id}:${i}`));
        api.onLevels(cells);
        for (const [id, i, value] of cells) {
          const was = agreed.levels.get(id);
          if (was) was[i] = value;
        }
      } else if (msg.type === "dmx") {
        api.onOutputs(msg.outputs);
      } else if (msg.type === "reply") {
        replies.get(msg.id)?.(msg);
        replies.delete(msg.id);
      }
    },
    onClose() {
      const was = connected;
      connected = false;
      agreed = null;
      for (const resolve of replies.values()) resolve({ ok: false, error: "Lost the show server" });
      replies.clear();
      if (was) api.onConnection(false);
    },
  });

  return {
    get connected() {
      return connected;
    },
    /** The newest server message heard (0 = none yet). */
    get seq() {
      return seq;
    },
    /** The console changed: send what's different (once per tick). */
    sync() {
      if (queued) return;
      queued = true;
      queueMicrotask(flush);
    },
    /** Send pending changes now (before a command that depends on them). */
    flush,
    /** @param {"go" | "pause" | "stop"} type */
    command(type) {
      flush();
      send({ type });
    },
    /** Replace the stage kept with the show (from a loaded set file). */
    sendStage(stage) {
      send({ type: "stage", stage });
    },
    /** Ask the server something; resolves with its reply ({ ok, error? }). */
    request(msg) {
      if (!connected) return Promise.resolve({ ok: false, error: "Not connected to the show server" });
      const id = nextRequest++;
      return new Promise((resolve) => {
        replies.set(id, resolve);
        send({ ...msg, id });
      });
    },
  };
}

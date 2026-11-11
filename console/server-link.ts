/**
 * Link to the show server (../server/server.ts) over a WebSocket.
 *
 * The server holds the show, runs fades and drives the DMX USB Pro(s); every
 * console (this machine or another one) is a remote view of it:
 *
 *   console → server   edits as they happen: the whole show when its structure
 *                      changes, single fader levels while dragging, the live
 *                      mix (master, subs, crossfade, LIVE / selected cue), held
 *                      flash / blackout buttons, GO / pause / stop,
 *                      DMX connect / disconnect, and the stage from a
 *                      loaded show file (the stage keeps it up to date
 *                      itself, see ../stage/show-link.ts)
 *   server → console   the same, from other consoles, plus fade steps and
 *                      DMX status
 *
 * app.ts tells the link what the console looks like now (`sync`); the link
 * works out what changed since it last agreed with the server and sends only
 * that. A value just changed here is held briefly against the server's older
 * broadcasts so dragging doesn't jitter (as the stage link does).
 *
 * Other machines open the console with ?token=… (printed by the server).
 * The connection itself (token, reconnecting) is ../shared/server-socket.ts.
 */

import { openServerSocket } from "../shared/server-socket.ts";
import { LIVE_FIELDS, type LiveField } from "../shared/live-fields.ts";
import type { LevelCell, Live, OutputStatus, Reply, Request, SavedStage, ServerMessage } from "../shared/protocol.ts";
import type { SerializedShow, ShowData } from "./show.ts";

/** How long a value changed here wins over the server's broadcasts. */
const PENDING_MS = 600;

/** what the console shows now (`show` = currentShowState(), live fields included) */
export type LocalView = {
  show: ShowData;
  flashing: Set<number>;
  blackedOut: Set<number>;
};
export type ServerLinkApi = {
  view: () => LocalView;
  onHello: (msg: Extract<ServerMessage, { type: "hello" }>) => void;
  onShow: (show: SerializedShow | null, live: Partial<Live>) => void;
  onLive: (live: Partial<Live>) => void;
  onLevels: (cells: LevelCell[]) => void;
  onOutputs: (outputs: OutputStatus[]) => void;
  onConnection: (connected: boolean) => void;
};

/** Structure of the show: everything but live fields and fader levels. */
function structureKey(show: ShowData): string {
  const rest: Partial<ShowData> = { ...show };
  for (const f of LIVE_FIELDS) delete rest[f];
  return JSON.stringify(rest, (key, value) => (key === "levels" ? undefined : value));
}

/** Every cue and step in the show, with its id (level edits are sent by it). */
const looksById = (show: ShowData) => show.songs.flatMap((song) => song.cues.flatMap((t) => [t, ...t.steps]));

/** cue or step id → copy of its levels */
function levelsById(show: ShowData): Map<string, number[]> {
  return new Map(looksById(show).map((t) => [t.id, [...t.levels]]));
}

const holdsKey = (flashing: Set<number>, blackedOut: Set<number>) => `${[...flashing].sort((a, b) => a - b)}|${[...blackedOut].sort((a, b) => a - b)}`;

type LiveValues = Partial<Record<LiveField, number>>;

export type ServerLink = ReturnType<typeof createServerLink>;

export function createServerLink(api: ServerLinkApi) {
  let connected = false;
  let queued = false;
  /** What the server and this console agree on (null until the server's hello). */
  let agreed: { structure: string; levels: Map<string, number[]>; live: LiveValues; holds: string } | null = null;
  /** field / "cueId:fader" → until (ms): changed here, not yet confirmed */
  const pending = new Map<string, number>();
  let nextRequest = 1;
  /** request id → resolve */
  const replies = new Map<number, (reply: Reply) => void>();

  const isPending = (key: string) => {
    const until = pending.get(key);
    if (until == null) return false;
    if (Date.now() < until) return true;
    pending.delete(key);
    return false;
  };
  const touch = (key: string) => pending.set(key, Date.now() + PENDING_MS);

  function send(msg: Parameters<typeof socket.send>[0]) {
    if (connected) socket.send(msg);
  }

  const liveOf = (v: LocalView): LiveValues => Object.fromEntries(LIVE_FIELDS.map((f) => [f, v.show[f]]));

  /** Remember the console's current view as agreed with the server. */
  function agree() {
    const v = api.view();
    agreed = {
      structure: structureKey(v.show),
      levels: levelsById(v.show),
      live: liveOf(v),
      holds: holdsKey(v.flashing, v.blackedOut),
    };
  }

  /** Send whatever changed here since the console and server last agreed. */
  function flush() {
    queued = false;
    if (!connected || !agreed) return;
    const v = api.view();

    const structure = structureKey(v.show);
    if (structure !== agreed.structure) {
      send({ type: "show", show: v.show });
      agreed.structure = structure;
      agreed.levels = levelsById(v.show);
    } else {
      const cells: LevelCell[] = [];
      for (const t of looksById(v.show)) {
        const was = agreed.levels.get(t.id);
        if (!was) continue;
        for (let i = 0; i < t.levels.length; i++) {
          if (t.levels[i] === was[i]) continue;
          cells.push([t.id, i, t.levels[i]]);
          was[i] = t.levels[i];
          touch(`${t.id}:${i}`);
        }
      }
      if (cells.length) send({ type: "levels", cells });
    }

    const live: LiveValues = {};
    for (const f of LIVE_FIELDS) if (v.show[f] !== agreed.live[f]) live[f] = v.show[f];
    const changed = Object.keys(live) as LiveField[];
    if (changed.length) {
      for (const f of changed) {
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
  function filterLive(live: Partial<Live>): Partial<Live> {
    const out = { ...live };
    for (const f of LIVE_FIELDS) if (isPending(f)) delete out[f];
    return out;
  }

  const socket = openServerSocket({
    onMessage(msg) {
      if (msg.type === "hello") {
        connected = true;
        pending.clear();
        api.onHello(msg);
        if (msg.show) {
          agree();
        } else {
          // Empty server (first run): this console's show becomes the show.
          agree();
          send({ type: "seed", show: api.view().show });
        }
        api.onConnection(true);
        return;
      }
        if (!agreed) return;
      if (msg.type === "show") {
        api.onShow(msg.show, filterLive(msg.live ?? {}));
        agree();
      } else if (msg.type === "live") {
        api.onLive(filterLive(msg.live ?? {}));
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
    /** The console changed: send what's different (once per tick). */
    sync() {
      if (queued) return;
      queued = true;
      queueMicrotask(flush);
    },
    /** Send pending changes now (before a command that depends on them). */
    flush,
    command(type: "go" | "step" | "pause" | "stop") {
      flush();
      send({ type });
    },
    /** Replace the stage kept with the show (from a loaded show file). */
    sendStage(stage: SavedStage) {
      send({ type: "stage", stage, file: true });
    },
    /** Ask the server something; resolves with its reply (`ok`, and what that request returns, or `error`). */
    request<R extends Request>(msg: R): Promise<Reply<R["type"]>> {
      if (!connected) return Promise.resolve({ ok: false, error: "Not connected to the show server" });
      const id = nextRequest++;
      return new Promise((resolve) => {
        // The server answers this id with this request's reply.
        replies.set(id, resolve as (reply: Reply) => void);
        send({ ...msg, id });
      });
    },
  };
}

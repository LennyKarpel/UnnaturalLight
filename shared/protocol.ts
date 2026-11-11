/**
 * The messages between an app window and the show server
 * (../server/server.ts), over the window's one WebSocket
 * (./server-socket.ts). The console's side is ../console/server-link.ts and
 * the stage's is ../stage/show-link.ts.
 *
 * Messages arrive as parsed JSON: these types say what each side sends, but
 * a receiver still checks anything it can't trust.
 */

import type { ShowData, SerializedShow } from "../console/show.ts";
import type { Live } from "../server/show.ts";
import type { DmxStatus } from "../server/dmx.ts";
import type { ArtNetNode, NetOutputSetting } from "../server/net-dmx.ts";
import type { LiveField } from "./live-fields.ts";
import type { SavedStage } from "../stage/stage-model.ts";

export type { Live, ArtNetNode, NetOutputSetting, SavedStage };

/** A universe's outputs: its DMX USB Pro, plus `network` ("Art-Net 0 → 192.168.1.50" or null). */
export type OutputStatus = DmxStatus & { network: string | null };

/** One fader level in one cue. */
export type LevelCell = [cueId: string, fader: number, level: number];

/** Questions a window asks the server (each gets a `reply` with the same id). */
export type Request =
  | { type: "get-stage" }
  | { type: "dmx-connect"; universe: number }
  | { type: "dmx-disconnect"; universe: number }
  | { type: "net-set"; universe: number; output: NetOutputSetting | null }
  | { type: "net-discover" };

/** What a successful reply carries, per request type. */
type ReplyData = {
  "get-stage": { stage: SavedStage | null };
  "dmx-connect": Nothing;
  "dmx-disconnect": Nothing;
  "net-set": Nothing;
  "net-discover": { nodes: ArtNetNode[] };
};
type Nothing = Record<never, never>;

/** The server's answer to a request of type T. */
export type Reply<T extends Request["type"] = Request["type"]> = ({ ok: true } & ReplyData[T]) | { ok: false; error: string };

/** App window → server. */
export type ClientMessage =
  | { type: "seed"; show: ShowData }
  | { type: "show"; show: ShowData }
  | { type: "live"; live: Partial<Record<LiveField, number>> }
  | { type: "levels"; cells: LevelCell[] }
  | { type: "hold"; flashing: number[]; blackedOut: number[] }
  | { type: "go" | "step" | "pause" | "stop" }
  | { type: "stage"; stage: SavedStage; file?: boolean }
  | (Request & { id: number });

/** Server → app window. */
export type ServerMessage =
  | { type: "hello"; clientId: string; show: SerializedShow | null; live: Live | null; outputs: OutputStatus[]; stage: SavedStage | null }
  | { type: "show"; show: SerializedShow | null; live: Live | null }
  | { type: "live"; live: Live | null }
  | { type: "levels"; cells: LevelCell[] }
  | { type: "stage"; stage: SavedStage }
  | { type: "dmx"; outputs: OutputStatus[] }
  | ({ type: "reply"; id: number } & Reply);

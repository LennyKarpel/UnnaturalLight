/**
 * Link to the show server (../server/server.ts), which keeps the stage with
 * the show: saved in server/data/session.show.json and in set files, so the stage
 * follows the show to any browser or computer.
 *
 *   stage → server   the whole stage after each edit made here
 *   server → stage   the stage when this window connects, and after edits
 *                    in other app windows (or a set file loaded in a console)
 *
 * It shares the window's connection with the console
 * (../shared/server-socket.ts), and the server's hello carries the stage. If
 * the server has no stage yet, or this stage was edited while the server was
 * unreachable, this stage is sent on connecting instead.
 */

import { openServerSocket } from "../shared/server-socket.ts";
import type { SavedStage } from "./stage-model.ts";
import { unhandled } from "../shared/guards.ts";

export function createShowLink(api: { current: () => SavedStage; onStage: (stage: SavedStage) => void }): { send: (stage: SavedStage) => void } {
  let connected = false;
  /** Edited here while not connected: send it on connecting. */
  let unsent = false;

  const socket = openServerSocket({
    onMessage(msg) {
      switch (msg.type) {
        case "hello":
          connected = true;
          if (msg.stage && !unsent) api.onStage(msg.stage);
          else send(api.current());
          unsent = false;
          break;
        case "stage":
          if (msg.stage) api.onStage(msg.stage);
          break;
        case "show":
        case "live":
        case "levels":
        case "dmx":
        case "reply":
          break; // the console's (../console/server-link.ts)
        default:
          unhandled(msg);
      }
    },
    onClose() {
      connected = false;
    },
  });

  function send(stage: SavedStage) {
    socket.send({ type: "stage", stage });
  }

  return {
    /** The stage was edited here: keep it with the show. */
    send(stage: SavedStage) {
      if (connected) send(stage);
      else unsent = true;
    },
  };
}

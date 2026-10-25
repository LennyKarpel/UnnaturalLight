/**
 * Link to the show server (../server/server.js), which keeps the stage with
 * the show: saved in server/data/session.json and in set files, so the stage
 * follows the show to any browser or computer.
 *
 *   stage → server   the whole stage after each edit made here
 *   server → stage   the stage when this window connects, and after edits
 *                    in other app windows (or a set file loaded in a console)
 *
 * It shares the window's connection with the console
 * (../shared/server-socket.js), and the server's hello carries the stage. If
 * the server has no stage yet, or this stage was edited while the server was
 * unreachable, this stage is sent on connecting instead.
 */

import { openServerSocket } from "../shared/server-socket.js";

/**
 * @param {{
 *   current: () => object,
 *   onStage: (stage: object) => void,
 * }} api
 */
export function createShowLink(api) {
  let connected = false;
  /** Edited here while not connected: send it on connecting. */
  let unsent = false;

  const socket = openServerSocket({
    onMessage(msg) {
      if (msg.type === "hello") {
        connected = true;
        if (msg.stage && !unsent) api.onStage(msg.stage);
        else send(api.current());
        unsent = false;
      } else if (msg.type === "stage" && msg.stage) {
        api.onStage(msg.stage);
      }
    },
    onClose() {
      connected = false;
    },
  });

  function send(stage) {
    socket.send({ type: "stage", stage });
  }

  return {
    /** The stage was edited here: keep it with the show. */
    send(stage) {
      if (connected) send(stage);
      else unsent = true;
    },
  };
}

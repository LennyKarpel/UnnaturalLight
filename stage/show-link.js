/**
 * Link to the show server (../server/server.js), which keeps the stage with
 * the show: saved in server/data/session.json and in set files, so the stage
 * follows the show to any browser or computer.
 *
 *   stage → server   the whole stage after each edit made here
 *   server → stage   the stage when this page connects, and after edits in
 *                    other stage pages (or a set file loaded in a console)
 *
 * The server only tells stage pages (/ws?role=stage) about the stage. If the
 * server has no stage yet, or this page was edited while the server was
 * unreachable, this page's stage is sent on connecting instead.
 */

const RECONNECT_MS = 1000;
/** Shared with the console (console/server-link.js): other machines need the server's token. */
const TOKEN_KEY = "unnaturallight.token";

/**
 * @param {{
 *   current: () => object,
 *   onStage: (stage: object) => void,
 * }} api
 */
export function createShowLink(api) {
  /** @type {WebSocket | null} */
  let ws = null;
  let connected = false;
  /** Edited here while not connected: send it on connecting. */
  let unsent = false;

  const params = new URLSearchParams(location.search);
  let token = params.get("token");
  try {
    token ??= sessionStorage.getItem(TOKEN_KEY);
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
  } catch { /* storage unavailable */ }

  function send(stage) {
    ws.send(JSON.stringify({ type: "stage", stage }));
  }

  function connect() {
    const url = new URL("/ws", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("role", "stage");
    if (token) url.searchParams.set("token", token);
    ws = new WebSocket(url);
    ws.addEventListener("message", (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === "hello") {
        connected = true;
        if (msg.stage && !unsent) api.onStage(msg.stage);
        else send(api.current());
        unsent = false;
      } else if (msg.type === "stage" && msg.stage) {
        api.onStage(msg.stage);
      }
    });
    ws.addEventListener("close", () => {
      connected = false;
      setTimeout(connect, RECONNECT_MS);
    });
  }
  connect();

  return {
    /** The stage was edited here: keep it with the show. */
    send(stage) {
      if (connected && ws?.readyState === WebSocket.OPEN) send(stage);
      else unsent = true;
    },
  };
}

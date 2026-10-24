/**
 * WebSocket to the show server (../server/server.js), shared by the console
 * (console/server-link.js) and the stage (stage/show-link.js): finds the
 * server's /ws, passes the access token, reconnects when the connection
 * drops and hands on each message as parsed JSON.
 *
 * Other machines open the page with ?token=… (printed by the server);
 * ../index.html keeps it for the tab, and the console and the stage read it.
 */

const RECONNECT_MS = 1000;
const TOKEN_KEY = "unnaturallight.token";

function accessToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null; // storage unavailable
  }
}

/**
 * @param {{
 *   role?: string,
 *   onMessage: (msg: any) => void,
 *   onClose?: () => void,
 * }} opts  role: e.g. "stage" (the server tells stage pages only about the stage);
 *          onClose: the connection dropped (it reconnects by itself)
 */
export function openServerSocket({ role, onMessage, onClose }) {
  const token = accessToken();
  /** @type {WebSocket | null} */
  let ws = null;

  function connect() {
    const url = new URL("/ws", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    if (role) url.searchParams.set("role", role);
    if (token) url.searchParams.set("token", token);
    ws = new WebSocket(url);
    ws.addEventListener("message", (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      onMessage(msg);
    });
    ws.addEventListener("close", () => {
      onClose?.();
      setTimeout(connect, RECONNECT_MS);
    });
  }
  connect();

  return {
    /** Send a message if the connection is open (dropped otherwise). */
    send(msg) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
  };
}

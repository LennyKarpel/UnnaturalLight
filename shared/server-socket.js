/**
 * The app window's one WebSocket to the show server (../server/server.js),
 * shared by the console (console/server-link.js) and the stage
 * (stage/show-link.js): finds the server's /ws, passes the access token,
 * reconnects when the connection drops and hands each message, as parsed
 * JSON, to both sides (each ignores the other's types).
 *
 * Other machines open the page with ?token=… (printed by the server);
 * ../index.html keeps it for the tab, and this reads it.
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

/** Every side's handlers. */
const listeners = [];
/** @type {WebSocket | null} */
let ws = null;

function connect() {
  const url = new URL("/ws", location.href);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const token = accessToken();
  if (token) url.searchParams.set("token", token);
  ws = new WebSocket(url);
  ws.addEventListener("message", (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    for (const l of listeners) l.onMessage(msg);
  });
  ws.addEventListener("close", () => {
    for (const l of listeners) l.onClose?.();
    setTimeout(connect, RECONNECT_MS);
  });
}

/**
 * Listen on the connection (opened by the first caller).
 * @param {{
 *   onMessage: (msg: any) => void,
 *   onClose?: () => void,
 * }} opts  onClose: the connection dropped (it reconnects by itself)
 */
export function openServerSocket({ onMessage, onClose }) {
  listeners.push({ onMessage, onClose });
  if (!ws) connect();
  return {
    /** Send a message if the connection is open (dropped otherwise). */
    send(msg) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
  };
}

/**
 * The app window's one WebSocket to the show server (../server/server.ts),
 * shared by the console (console/server-link.ts) and the stage
 * (stage/show-link.ts): finds the server's /ws, passes the access token,
 * reconnects when the connection drops and hands each message, as parsed
 * JSON, to both sides (each ignores the other's types).
 *
 * A side that starts listening after the server's `hello` (the stage, which
 * waits for three.js to load, often does) still gets it: the hello is kept,
 * brought up to date with every later show, live, stage and DMX message, and
 * handed to the late side, so it knows it's connected and has what's current.
 *
 * Other machines open the page with ?token=… (printed by the server);
 * ../index.html keeps it for the tab, and this reads it.
 */

import type { ClientMessage, ServerMessage } from "./protocol.ts";

const RECONNECT_MS = 1000;
const TOKEN_KEY = "unnaturallight.token";

/** The access token this tab was opened with (other machines), or null. */
export function accessToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null; // storage unavailable
  }
}

type Listener = {
  onMessage: (msg: ServerMessage) => void;
  /** The connection dropped (it reconnects by itself). */
  onClose?: () => void;
};

/** Every side's handlers. */
const listeners: Listener[] = [];
let ws: WebSocket | null = null;
type Hello = Extract<ServerMessage, { type: "hello" }>;
/** This connection's hello, kept current (for a side that joins later); null until it arrives. */
let hello: Hello | null = null;

/** Keep the hello up to date with a message that replaces part of what it carried. */
function track(msg: ServerMessage) {
  if (msg.type === "hello") hello = msg;
  else if (!hello) return;
  else if (msg.type === "show") hello = { ...hello, show: msg.show, live: msg.live };
  else if (msg.type === "live") hello = { ...hello, live: msg.live };
  else if (msg.type === "stage") hello = { ...hello, stage: msg.stage };
  else if (msg.type === "dmx") hello = { ...hello, outputs: msg.outputs };
  // `levels` (single fader cells) only matter to the console, which is there from the start.
}

function connect() {
  const url = new URL("/ws", location.href);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const token = accessToken();
  if (token) url.searchParams.set("token", token);
  ws = new WebSocket(url);
  ws.addEventListener("message", (e) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    track(msg);
    for (const l of listeners) l.onMessage(msg);
  });
  ws.addEventListener("close", () => {
    hello = null;
    for (const l of listeners) l.onClose?.();
    setTimeout(connect, RECONNECT_MS);
  });
}

/**
 * Listen on the connection (opened by the first caller). A caller that comes
 * after the server's hello gets that hello (kept current) straight away.
 */
export function openServerSocket({ onMessage, onClose }: Listener): { send: (msg: ClientMessage) => void } {
  listeners.push({ onMessage, onClose });
  if (!ws) connect();
  // Joined after the hello: it gets it now (as it stands), as if it had just arrived.
  else if (hello) {
    const late = hello;
    queueMicrotask(() => { if (hello === late) onMessage(late); });
  }
  return {
    /** Send a message if the connection is open (dropped otherwise). */
    send(msg: ClientMessage) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
  };
}

// UnnaturalLight show server.
//
//   - serves the console / stage pages (no caching, so a reload always picks up changes)
//   - holds the show (server/show.js): every console is a remote view of it
//   - keeps the stage (the 3D layout) with the show, for every stage page
//   - runs timed fades and sends DMX to the Enttec DMX USB Pro(s) (server/dmx.js),
//     so closing or backgrounding a browser tab never affects the lights
//   - saves the show to server/data/session.json
//
// Consoles talk to it over a WebSocket at /ws (see console/server-link.js),
// stage pages at /ws?role=stage (see stage/show-link.js; they only hear
// about the stage).
//
// Usage: node server/server.js [port] [--lan] [--fake-dmx] [--no-open]
//   --lan       listen on the local network too (other machines need the printed token)
//   --fake-dmx  pretend a DMX USB Pro is connected (for testing without hardware)
//   --no-open   don't open a browser

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { MAX_UNIVERSES } from "../console/patch.js";
import { createDmx } from "./dmx.js";
import { createShow } from "./show.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "server", "data");
const SESSION_FILE = path.join(DATA_DIR, "session.json");
/** DMX refresh / fade step (40 frames a second, as the browser used to send). */
const FRAME_MS = 25;
const SAVE_DELAY_MS = 500;
/** Only these are served (never node_modules, server/ or its data). */
const PUBLIC = ["index.html", "console/", "stage/", "shared/"];
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const PORT = Number(args.find((a) => /^\d+$/.test(a)) ?? process.env.UNNATURALLIGHT_PORT ?? 8080);
const LAN = flag("--lan");
const TOKEN = crypto.randomBytes(9).toString("base64url");

fs.mkdirSync(DATA_DIR, { recursive: true });

// --- show + DMX -------------------------------------------------------------

let saved = null;
try {
  saved = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
} catch {
  // First run: the first console to connect provides the show.
}
const show = createShow(saved);
/** The stage (stage page's layout, as stage/stage-model.js serializeStage makes it), or null. */
let stage = saved?.stage ?? null;

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
}
function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const set = show.serialized();
  if (!set) return;
  const data = stage ? { ...set, stage } : set;
  const tmp = `${SESSION_FILE}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data)}\n`);
  fs.renameSync(tmp, SESSION_FILE);
}

const dmx = createDmx({
  dataDir: DATA_DIR,
  maxUniverses: MAX_UNIVERSES,
  fake: flag("--fake-dmx"),
  onChange: () => broadcast({ type: "dmx", outputs: dmx.status() }),
});

// --- WebSocket clients -------------------------------------------------------

/** @type {Map<import("ws").WebSocket, { id: string, role: "console" | "stage" }>} */
const clients = new Map();

/**
 * Numbers every message to consoles, always increasing (a clock reading, so
 * also across restarts): a console tells the stage which server message its
 * output reflects, so the stage can drop late copies from a console the
 * browser runs slowly.
 */
let lastSeq = 0;
const nextSeq = () => (lastSeq = Math.max(lastSeq + 1, Date.now()));

/** Send to every client of `role` (consoles by default) but `except`. */
function broadcast(msg, except = null, role = "console") {
  const text = JSON.stringify(role === "console" ? { ...msg, seq: nextSeq() } : msg);
  for (const [ws, client] of clients) {
    if (ws !== except && client.role === role && ws.readyState === ws.OPEN) ws.send(text);
  }
}

const sendLive = (except = null) => broadcast({ type: "live", live: show.live() }, except);

async function onMessage(ws, client, msg) {
  const reply = (extra) => ws.send(JSON.stringify({ type: "reply", id: msg.id, ...extra }));
  switch (msg?.type) {
    case "seed":
      if (show.seed(msg.set)) {
        broadcast({ type: "set", set: show.serialized(), live: show.live() }, ws);
        scheduleSave();
      }
      return;
    case "set":
      show.replaceSet(msg.set);
      broadcast({ type: "set", set: show.serialized(), live: show.live() }, ws);
      scheduleSave();
      return;
    case "live":
      if (!show.hasSet || !msg.live) return;
      show.applyLive(msg.live);
      sendLive(ws);
      scheduleSave();
      return;
    case "levels":
      if (!show.hasSet || !Array.isArray(msg.cells)) return;
      show.applyLevels(msg.cells);
      broadcast({ type: "levels", cells: msg.cells }, ws);
      scheduleSave();
      return;
    case "hold":
      show.setHolds(client.id, msg.flashing, msg.blackedOut);
      sendLive();
      return;
    case "go":
      if (!show.hasSet) return;
      show.go(performance.now());
      sendLive();
      return;
    case "pause":
      show.togglePause(performance.now());
      sendLive();
      return;
    case "stop":
      show.stopFade();
      sendLive();
      return;
    case "stage":
      // From a stage page (an edit) or a console (a set file was loaded).
      if (!msg.stage || typeof msg.stage !== "object") return;
      stage = msg.stage;
      broadcast({ type: "stage", stage }, ws, "stage");
      scheduleSave();
      return;
    case "get-stage":
      reply({ ok: true, stage });
      return;
    case "dmx-connect":
    case "dmx-disconnect":
      try {
        if (msg.type === "dmx-connect") await dmx.connect(msg.universe);
        else await dmx.disconnect(msg.universe);
        reply({ ok: true });
      } catch (err) {
        reply({ ok: false, error: err.message });
      }
      return;
    default:
  }
}

function isLoopback(req) {
  const a = req.socket.remoteAddress ?? "";
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}

// --- HTTP --------------------------------------------------------------------

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (rel === "") rel = "index.html";
  const file = path.resolve(ROOT, rel);
  const inside = file.startsWith(`${ROOT}${path.sep}`);
  if (!inside || !PUBLIC.some((p) => rel === p || (p.endsWith("/") && rel.startsWith(p)))) {
    res.writeHead(404).end("Not found");
    return;
  }
  fs.readFile(file, (err, body) => {
    if (err) {
      res.writeHead(404).end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    });
    res.end(body);
  });
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://x");
  // Other machines must present the token printed at start.
  if (url.pathname !== "/ws" || (!isLoopback(req) && url.searchParams.get("token") !== TOKEN)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

wss.on("connection", (ws, req) => {
  const role = new URL(req.url ?? "/", "http://x").searchParams.get("role") === "stage" ? "stage" : "console";
  const client = { id: crypto.randomUUID(), role };
  clients.set(ws, client);
  ws.send(JSON.stringify(role === "stage"
    ? { type: "hello", stage }
    : { type: "hello", seq: nextSeq(), clientId: client.id, set: show.serialized(), live: show.live(), outputs: dmx.status() }));
  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    onMessage(ws, client, msg).catch((err) => console.error(err));
  });
  ws.on("close", () => {
    clients.delete(ws);
    if (show.dropClient(client.id)) sendLive();
  });
});

// --- frame loop --------------------------------------------------------------

setInterval(() => {
  const step = show.tick(performance.now());
  if (step) {
    sendLive();
    if (step.arrived != null) scheduleSave();
  }
  dmx.write(show.levels(), show.universes);
}, FRAME_MS);

// --- start / stop ------------------------------------------------------------

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal)
    .map((a) => a.address);
}

server.listen(PORT, LAN ? "0.0.0.0" : "127.0.0.1", () => {
  const local = `http://localhost:${PORT}/index.html`;
  console.log("==> UnnaturalLight show server");
  console.log(`    directory : ${ROOT}`);
  console.log(`    show file : ${path.relative(ROOT, SESSION_FILE)}${show.hasSet ? "" : " (none yet: the first console provides it)"}`);
  console.log(`    DMX       : ${flag("--fake-dmx") ? "fake output (--fake-dmx)" : "Enttec DMX USB Pro via USB"}`);
  console.log(`    this Mac  : ${local}`);
  if (LAN) {
    for (const ip of lanAddresses()) console.log(`    remote    : http://${ip}:${PORT}/console/console.html?token=${TOKEN}`);
  } else {
    console.log("    remote    : off (start with --lan to allow other machines)");
  }
  console.log("    stop      : Ctrl+C");
  if (!flag("--no-open") && process.platform === "darwin") spawn("open", [local], { stdio: "ignore", detached: true }).unref();
});

function stop(signal) {
  console.log(`\n==> ${signal}: saving the show and stopping…`);
  saveNow();
  process.exit(0);
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

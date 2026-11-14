// UnnaturalLight show server.
//
//   - serves the console / stage pages (no caching, so a reload always picks up changes)
//   - holds the show (server/show.ts): every console is a remote view of it
//   - keeps the stage (the 3D layout) with the show, for every app window
//   - runs timed fades and sends DMX to the Enttec DMX USB Pro(s) (server/dmx.ts)
//     and to Art-Net / sACN nodes (server/net-dmx.ts),
//     so closing or backgrounding a browser tab never affects the lights
//   - saves the show to server/data/session.show.json
//   - answers the chat panel at POST /chat and /chat/summary (server/chat/:
//     asks the model; the tools run in the page), and keeps its chats at
//     /chat/chats (server/data/session.chats.json, the show's chats in their own file)
//
// Each app window talks to it over one WebSocket at /ws, shared by its
// console (console/server-link.ts) and its stage (stage/show-link.ts).
//
// Usage: node server/server.ts [port] [--lan] [--fake-dmx] [--no-open]
//   --lan       listen on the local network too (other machines need the printed token)
//   --fake-dmx  pretend a DMX USB Pro is connected (for testing without hardware)
//   --no-open   don't open a browser
//
// Environment: UNNATURALLIGHT_PORT (default 8080), UNNATURALLIGHT_DATA_DIR
// (default server/data), and the chat's (server/chat/model.ts).

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { stripTypeScriptTypes } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { WebSocketServer, type WebSocket } from "ws";
import { MAX_UNIVERSES } from "../console/patch.ts";
import { accessProblem, appUrl, BASE_HEADERS, contentSecurityPolicy, isToken, LOOPBACK_NAMES, publicFile } from "./access.ts";
import { readJsonFile, writeJsonFile } from "./files.ts";
import { createDmx } from "./dmx.ts";
import { createNetDmx } from "./net-dmx.ts";
import { createShow } from "./show.ts";
import { handleChat, handleChatSummary } from "./chat/chat.ts";
import { createChats } from "./chat/chats.ts";
import type { ClientMessage, OutputStatus, Reply, Request, SavedStage, ServerMessage } from "../shared/protocol.ts";
import { errorMessage, isRecord, unhandled } from "../shared/guards.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** server/data, or UNNATURALLIGHT_DATA_DIR (the browser tests use a temporary one, so they never touch the real show). */
const DATA_DIR = process.env.UNNATURALLIGHT_DATA_DIR ? path.resolve(process.env.UNNATURALLIGHT_DATA_DIR) : path.join(ROOT, "server", "data");
/** The show (with the stage). Was session.json: renamed on start (below). */
const SESSION_FILE = path.join(DATA_DIR, "session.show.json");
const OLD_SESSION_FILE = path.join(DATA_DIR, "session.json");
/** The chat panel's chats: the show's, in their own file next to it (a saved show file holds both). */
const CHATS_FILE = path.join(DATA_DIR, "session.chats.json");
/** DMX refresh / fade step (40 frames a second, as the browser used to send). */
const FRAME_MS = 25;
const SAVE_DELAY_MS = 500;
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  // Served as JavaScript: types stripped (see stripped()).
  ".ts": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const PORT = Number(args.find((a) => /^\d+$/.test(a)) ?? process.env.UNNATURALLIGHT_PORT ?? 8080);
const LAN = flag("--lan");
const TOKEN = crypto.randomBytes(9).toString("base64url");

fs.mkdirSync(DATA_DIR, { recursive: true });
// Before the chats had their own file, the show was session.json.
if (!fs.existsSync(SESSION_FILE) && fs.existsSync(OLD_SESSION_FILE)) fs.renameSync(OLD_SESSION_FILE, SESSION_FILE);

// --- show + DMX -------------------------------------------------------------

// null on the first run: the first console to connect provides the show.
const saved = readJsonFile(SESSION_FILE) as (Record<string, unknown> & { stage?: SavedStage }) | null;
const show = createShow(saved);
const chats = createChats(CHATS_FILE);
/** The stage (stage page's layout, as stage/stage-model.ts serializeStage makes it), or null. */
let stage: SavedStage | null = saved?.stage ?? null;

let saveTimer: NodeJS.Timeout | null = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
}
function saveNow() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const data = show.serialized();
  if (!data) return;
  writeJsonFile(SESSION_FILE, stage ? { ...data, stage } : data);
}

const dmx = createDmx({
  dataDir: DATA_DIR,
  maxUniverses: MAX_UNIVERSES,
  fake: flag("--fake-dmx"),
  onChange: () => broadcast({ type: "dmx", outputs: outputStatus() }),
});
const netDmx = createNetDmx({
  dataDir: DATA_DIR,
  maxUniverses: MAX_UNIVERSES,
  onChange: () => broadcast({ type: "dmx", outputs: outputStatus() }),
});
/** Each universe's outputs: its DMX USB Pro, plus `network` ("Art-Net 0 → 192.168.1.50" or null). */
const outputStatus = (): OutputStatus[] => dmx.status().map((s) => ({ ...s, network: netDmx.label(s.universe) }));

// --- WebSocket clients -------------------------------------------------------

const clients = new Map<WebSocket, { id: string }>();

/** Send to every client but `except`. */
function broadcast(msg: ServerMessage, except: WebSocket | null = null) {
  const text = JSON.stringify(msg);
  for (const ws of clients.keys()) {
    if (ws !== except && ws.readyState === ws.OPEN) ws.send(text);
  }
}

const sendLive = (except: WebSocket | null = null) => broadcast({ type: "live", live: show.live() }, except);

/** `msg` is parsed JSON from a client: its type says what a console sends, but check what matters. */
async function onMessage(ws: WebSocket, client: { id: string }, msg: ClientMessage) {
  const reply = (extra: Reply) => {
    if (!("id" in msg)) return;
    const out: ServerMessage = { type: "reply", id: msg.id, ...extra };
    ws.send(JSON.stringify(out));
  };
  switch (msg?.type) {
    case "seed":
      if (show.seed(msg.show)) {
        broadcast({ type: "show", show: show.serialized(), live: show.live() }, ws);
        scheduleSave();
      }
      return;
    case "show":
      show.replaceShow(msg.show);
      broadcast({ type: "show", show: show.serialized(), live: show.live() }, ws);
      scheduleSave();
      return;
    case "live":
      if (!show.hasShow || !msg.live) return;
      show.applyLive(msg.live);
      sendLive(ws);
      scheduleSave();
      return;
    case "levels":
      if (!show.hasShow || !Array.isArray(msg.cells)) return;
      show.applyLevels(msg.cells);
      broadcast({ type: "levels", cells: msg.cells }, ws);
      scheduleSave();
      return;
    case "hold":
      show.setHolds(client.id, msg.flashing, msg.blackedOut);
      sendLive();
      return;
    case "go":
      if (!show.hasShow) return;
      show.go(performance.now());
      sendLive();
      return;
    case "step":
      if (!show.hasShow) return;
      show.go(performance.now(), { step: true });
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
      // An edit on a stage: the other windows take it.
      if (!msg.stage || typeof msg.stage !== "object") return;
      stage = msg.stage;
      broadcast({ type: "stage", stage }, ws);
      scheduleSave();
      return;
    case "show-file":
      // New show or Load show in a console: every window takes its stage
      // (the sender's too) and its chats.
      if (!msg.stage || typeof msg.stage !== "object") return;
      stage = msg.stage;
      broadcast({ type: "stage", stage }, null);
      scheduleSave();
      chats.replace(Array.isArray(msg.chats) ? msg.chats : []);
      return;
    case "get-show-file":
    case "dmx-connect":
    case "dmx-disconnect":
    case "net-set":
    case "net-discover":
      try {
        reply(await answer(msg));
      } catch (err) {
        reply({ ok: false, error: errorMessage(err) });
      }
      return;
    default:
      unhandled(msg);
  }
}

/** Do what a request asks; throws when it can't (the reply carries the error). */
async function answer(msg: Request): Promise<Reply> {
  switch (msg.type) {
    case "get-show-file":
      return { ok: true, stage, chats: chats.list() };
    case "dmx-connect":
      await dmx.connect(msg.universe);
      return { ok: true };
    case "dmx-disconnect":
      await dmx.disconnect(msg.universe);
      return { ok: true };
    case "net-set":
      netDmx.set(msg.universe, msg.output ?? null);
      return { ok: true };
    case "net-discover":
      return { ok: true, nodes: await netDmx.discover() };
  }
}

function isLoopback(req: http.IncomingMessage) {
  const a = req.socket.remoteAddress ?? "";
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}

// --- HTTP --------------------------------------------------------------------

/**
 * The browser runs the app's .ts files as JavaScript: the types are blanked
 * out (whitespace keeps every line and column where it was, so the browser's
 * dev tools line numbers match the .ts file). Cached until the file changes.
 */
const strippedCache = new Map<string, { source: string; js: string }>();
function stripped(file: string, data: Buffer): string {
  const source = data.toString("utf8");
  const hit = strippedCache.get(file);
  if (hit?.source === source) return hit.js;
  const js = stripTypeScriptTypes(source, { mode: "strip" });
  strippedCache.set(file, { source, js });
  return js;
}

/** What the About box shows (../page/about.ts): this app's version and what it runs on. Read once, at start. */
const ABOUT = {
  version: String(readPackage("package.json").version ?? ""),
  node: process.versions.node,
  three: String(readPackage("node_modules/three/package.json").version ?? ""),
};
function readPackage(rel: string): Record<string, unknown> {
  try {
    const json: unknown = JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
    return isRecord(json) ? json : {};
  } catch {
    return {};
  }
}

/** This machine, or another that has the token printed at start. */
const allowed = (req: http.IncomingMessage, url: URL) => isLoopback(req) || isToken(url.searchParams.get("token"), TOKEN);

/** The names this server answers to: this machine's, and with --lan its addresses and host name (looked up each time: they can change). */
function hostNames(): Set<string> {
  const names = new Set(LOOPBACK_NAMES);
  if (LAN) {
    for (const ip of lanAddresses()) names.add(ip);
    const host = os.hostname().toLowerCase();
    names.add(host);
    names.add(host.endsWith(".local") ? host.slice(0, -".local".length) : `${host}.local`);
  }
  return names;
}

/** Why a request comes from somewhere it shouldn't (another site, or a name that isn't this machine's), or null. See ./access.ts. */
const foreign = (req: http.IncomingMessage) => accessProblem({ host: req.headers.host, origin: req.headers.origin }, hostNames(), PORT);

// One bad request must never stop the server (and the lights) mid-show: whatever it throws is logged and answered with a 500.
const server = http.createServer((req, res) => {
  try {
    handleRequest(req, res);
  } catch (err) {
    console.error(`${req.method} ${req.url}: ${errorMessage(err)}`);
    if (!res.headersSent) res.writeHead(500).end("Server error");
    else res.end();
  }
});

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");
  const problem = foreign(req);
  if (problem) {
    console.warn(`refused ${req.method} ${url.pathname}: ${problem}`);
    res.writeHead(403).end("Forbidden");
    return;
  }
  if (url.pathname === "/chat" || url.pathname === "/chat/summary") {
    if (!allowed(req, url)) res.writeHead(403).end("Forbidden");
    // JSON only: a browser asks first before sending JSON to another site (and this never says yes).
    else if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) res.writeHead(415).end("JSON only");
    else (url.pathname === "/chat" ? handleChat : handleChatSummary)(req, res).catch((err) => console.error(err));
    return;
  }
  if (url.pathname === "/about") {
    if (!allowed(req, url)) res.writeHead(403).end("Forbidden");
    else res.writeHead(200, { ...BASE_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(ABOUT));
    return;
  }
  if (url.pathname === "/chat/chats" || url.pathname.startsWith("/chat/chats/")) {
    if (!allowed(req, url)) res.writeHead(403).end("Forbidden");
    else chats.handle(req, res, url).catch((err) => console.error(err));
    return;
  }
  let rel: string;
  try {
    rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  } catch {
    res.writeHead(400).end("Bad address"); // e.g. a stray % (any page could link to one)
    return;
  }
  if (rel === "") rel = "index.html";
  // Only the app's files and the vendor folders (see ./access.ts), wherever the path resolves to.
  const file = publicFile(ROOT, rel);
  if (!file) {
    res.writeHead(404).end("Not found");
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end("Not found");
      return;
    }
    let body: Buffer | string = data;
    if (file.endsWith(".ts")) {
      try {
        body = stripped(file, data);
      } catch (e) {
        console.error(`${rel}: ${errorMessage(e)}`);
        res.writeHead(500).end(`Could not strip types from ${rel}`);
        return;
      }
    }
    const type = TYPES[path.extname(file)] ?? "application/octet-stream";
    const packed = packedFile(file, body, type);
    const headers = {
      ...BASE_HEADERS,
      // Pages get their script policy (from what they hold; req.headers.host was checked above).
      ...(file.endsWith(".html") ? { "Content-Security-Policy": contentSecurityPolicy(String(body), req.headers.host ?? "") } : {}),
      "Content-Type": type,
      // Always asked again (an edit shows on reload), but unchanged files come back as a bodiless 304.
      "Cache-Control": "no-cache",
      ETag: packed.etag,
      Vary: "Accept-Encoding",
    };
    if (req.headers["if-none-match"] === packed.etag) {
      res.writeHead(304, headers).end();
      return;
    }
    const gzip = packed.gzip && /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
    res.writeHead(200, gzip ? { ...headers, "Content-Encoding": "gzip" } : headers);
    res.end(gzip ? packed.gzip : body);
  });
}

/** A file as sent: its ETag (a hash of what's sent) and, for text worth it, gzipped. Kept until the file changes. */
type Packed = { etag: string; gzip: Buffer | null };
const packedCache = new Map<string, { body: Buffer | string; packed: Packed }>();

function packedFile(file: string, body: Buffer | string, type: string): Packed {
  const hit = packedCache.get(file);
  if (hit && (typeof body === "string" ? hit.body === body : Buffer.isBuffer(hit.body) && hit.body.equals(body))) return hit.packed;
  const etag = `"${crypto.createHash("sha1").update(body).digest("base64url")}"`;
  const text = /^(text\/|application\/(javascript|json)|image\/svg)/.test(type);
  const gzip = text && Buffer.byteLength(body) > 1024 ? zlib.gzipSync(body) : null;
  const packed = { etag, gzip };
  packedCache.set(file, { body, packed });
  return packed;
}

/** The biggest message a window may send: far above any show, stage or show file's chats (a show is tens of KB), far below what would tie up the server. */
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
server.on("upgrade", (req, socket, head) => {
  socket.on("error", () => socket.destroy()); // a dropped connection mid-handshake, not the server's problem
  let url: URL;
  try {
    url = new URL(req.url ?? "/", "http://x");
  } catch {
    socket.destroy();
    return;
  }
  // Other machines must present the token printed at start; other sites are refused (browsers let any page open a WebSocket).
  const problem = foreign(req);
  if (problem) console.warn(`refused WebSocket: ${problem}`);
  if (url.pathname !== "/ws" || problem || !allowed(req, url)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

wss.on("connection", (ws) => {
  const client = { id: crypto.randomUUID() };
  clients.set(ws, client);
  // A bad frame from a client closes its connection; unheard, the error would stop the server.
  ws.on("error", (err) => console.warn(`WebSocket error: ${errorMessage(err)}`));
  ws.send(JSON.stringify({ type: "hello", clientId: client.id, show: show.serialized(), live: show.live(), outputs: outputStatus(), stage }));
  ws.on("message", (data) => {
    let msg: ClientMessage;
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
    // On to the next set song: consoles need the whole show (the active song changed).
    if (step.songChanged) broadcast({ type: "show", show: show.serialized(), live: show.live() });
    else sendLive();
    if (step.arrived != null) scheduleSave();
  }
  const levels = show.levels();
  dmx.write(levels, show.universes);
  netDmx.write(levels, show.universes);
}, FRAME_MS);

// --- start / stop ------------------------------------------------------------

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a): a is os.NetworkInterfaceInfo => a != null && a.family === "IPv4" && !a.internal)
    .map((a) => a.address);
}

server.listen(PORT, LAN ? "0.0.0.0" : "127.0.0.1", () => {
  const local = `http://localhost:${PORT}/index.html`;
  console.log("==> UnnaturalLight show server");
  console.log(`    directory : ${ROOT}`);
  console.log(`    show file : ${path.relative(ROOT, SESSION_FILE)}${show.hasShow ? "" : " (none yet: the first console provides it)"}`);
  console.log(`    chats     : ${path.relative(ROOT, CHATS_FILE)} (${chats.list().length})`);
  console.log(`    DMX       : ${flag("--fake-dmx") ? "fake output (--fake-dmx)" : "Enttec DMX USB Pro via USB"}`);
  for (const line of netDmx.describe()) console.log(`    network   : ${line}`);
  console.log(`    this Mac  : ${local}`);
  if (LAN) {
    for (const ip of lanAddresses()) console.log(`    remote    : ${appUrl(`${ip}:${PORT}`, `/index.html?token=${TOKEN}`)}`);
  } else {
    console.log("    remote    : off (start with --lan to allow other machines)");
  }
  console.log("    stop      : Ctrl+C");
  if (!flag("--no-open") && process.platform === "darwin") spawn("open", [local], { stdio: "ignore", detached: true }).unref();
});

function stop(signal: string) {
  console.log(`\n==> ${signal}: saving the show and stopping…`);
  saveNow();
  chats.flush();
  netDmx.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

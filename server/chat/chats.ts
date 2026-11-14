// The chat panel's chats (page/chat/panel.ts), kept on the show server so
// every app window, on this computer or another, shares them. They're the
// show's chats, kept in their own file next to it: server/data/session.show.json
// is the show, session.chats.json its chats. A show file holds them too (Save
// show), and New show / Load show replace them all (`replace`).
//
//   GET    /chat/chats       → { chats } (SavedChats)
//   PUT    /chat/chats/<id>  a SavedChat: add or replace it
//   DELETE /chat/chats/<id>  remove it
//   GET    /chat/chats/events  server-sent events: each save or delete, as
//                              it happens, so every window showing a chat
//                              keeps up (?window=<id>: not its own changes)

import type http from "node:http";
import { CHAT_NAME_MAX, MAX_CHATS, type ChatChange, type SavedChat, type SavedChats } from "../../shared/chat-protocol.ts";
import { errorMessage, isRecord } from "../../shared/guards.ts";
import { readJsonFile, writeJsonFile } from "../files.ts";
import { isMessage, readBody } from "./chat.ts";

const SAVE_DELAY_MS = 500;
const ID = /^[\w-]{1,100}$/;

/** A chat from JSON (a request, or the file), or null if it isn't one. */
export function parseChat(v: unknown): SavedChat | null {
  if (!isRecord(v) || typeof v.id !== "string" || !ID.test(v.id) || !Array.isArray(v.history) || !v.history.every(isMessage)) return null;
  return {
    id: v.id,
    name: typeof v.name === "string" ? v.name.slice(0, CHAT_NAME_MAX) : "",
    history: v.history,
    used: typeof v.used === "number" && Number.isFinite(v.used) ? v.used : 0,
  };
}

export function createChats(file: string) {
  const saved = readJsonFile(file);
  let chats = isRecord(saved) && Array.isArray(saved.chats) ? saved.chats.map(parseChat).filter((c): c is SavedChat => !!c) : [];

  /** Windows listening for changes (GET /chat/chats/events), by window id. */
  const listeners = new Set<{ window: string; res: http.ServerResponse }>();
  function tell(change: ChatChange, from: string) {
    const line = `data: ${JSON.stringify(change)}\n\n`;
    for (const l of listeners) if (l.window !== from) l.res.write(line);
  }

  let timer: NodeJS.Timeout | null = null;
  function saveNow() {
    if (timer) clearTimeout(timer);
    timer = null;
    const out: SavedChats = { chats };
    writeJsonFile(file, out);
  }
  const scheduleSave = () => { timer ??= setTimeout(saveNow, SAVE_DELAY_MS); };

  function put(chat: SavedChat, from: string) {
    const i = chats.findIndex((c) => c.id === chat.id);
    if (i >= 0) chats[i] = chat;
    else chats.push(chat);
    // Too many: the one used longest ago goes (never the one just saved).
    while (chats.length > MAX_CHATS) {
      const oldest = chats.filter((c) => c !== chat).reduce((a, b) => (b.used < a.used ? b : a));
      chats.splice(chats.indexOf(oldest), 1);
      tell({ type: "deleted", id: oldest.id }, "");
    }
    scheduleSave();
    tell({ type: "saved", chat }, from);
  }

  function remove(id: string, from: string) {
    const before = chats.length;
    chats = chats.filter((c) => c.id !== id);
    if (chats.length === before) return;
    scheduleSave();
    tell({ type: "deleted", id }, from);
  }

  function listen(req: http.IncomingMessage, res: http.ServerResponse, window: string) {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.write(": listening\n\n");
    const l = { window, res };
    listeners.add(l);
    req.on("close", () => listeners.delete(l));
  }

  /** GET / PUT / DELETE under /chat/chats. */
  async function handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    const from = url.searchParams.get("window") ?? "";
    try {
      // Inside the try: a stray % gets a 400 rather than no answer.
      const id = decodeURIComponent(url.pathname.slice("/chat/chats".length).replace(/^\//, ""));
      if (req.method === "GET" && id === "events") {
        listen(req, res, from);
      } else if (req.method === "GET" && !id) {
        const out: SavedChats = { chats };
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(out));
      } else if (req.method === "PUT" && ID.test(id)) {
        const chat = parseChat(JSON.parse(await readBody(req)));
        if (chat?.id === id) {
          put(chat, from);
          res.writeHead(204).end();
        } else {
          res.writeHead(400).end("Bad chat");
        }
      } else if (req.method === "DELETE" && ID.test(id)) {
        remove(id, from);
        res.writeHead(204).end();
      } else {
        res.writeHead(405, { Allow: "GET, PUT, DELETE" }).end("GET /chat/chats, PUT or DELETE /chat/chats/<id>");
      }
    } catch (err) {
      res.writeHead(400).end(errorMessage(err, "Bad chat"));
    }
  }

  /** A new or loaded show: its chats (unchecked, from the file) replace them all, in every window. */
  function replace(list: unknown[]) {
    chats = list.map(parseChat).filter((c): c is SavedChat => !!c);
    // Too many: keep the ones used most recently.
    if (chats.length > MAX_CHATS) chats = [...chats].sort((a, b) => b.used - a.used).slice(0, MAX_CHATS);
    scheduleSave();
    tell({ type: "replaced", chats }, "");
  }

  /** Write now if a save is waiting (the server is stopping). */
  const flush = () => { if (timer) saveNow(); };

  return { handle, flush, put, remove, replace, list: () => chats };
}

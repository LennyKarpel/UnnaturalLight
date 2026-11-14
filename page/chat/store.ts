/**
 * The chats on the show server (server/chat/chats.ts, kept in
 * server/data/session.chats.json), so every app window and computer shares
 * them. Saves wait a moment and send the latest only; a failed one is tried
 * again with the next change. listenChats hears the other windows' saves and
 * deletes as they happen, each by its chat's id, and a new or loaded show
 * replacing them all.
 */

import type { ChatChange, SavedChat } from "../../shared/chat-protocol.ts";
import { newId } from "../../shared/ids.ts";
import { isRecord } from "../../shared/guards.ts";
import { chatUrl } from "./loop.ts";

const SAVE_DELAY_MS = 400;

/** This window: its own saves aren't sent back to it. */
const WINDOW = newId("window");

const url = (id = "") => {
  const u = chatUrl(`/chat/chats${id ? `/${encodeURIComponent(id)}` : ""}`);
  u.searchParams.set("window", WINDOW);
  return u;
};

/** Every chat on the server (unchecked: the panel reads each one). Throws when the server can't be reached. */
export async function fetchChats(): Promise<unknown[]> {
  const res = await fetch(url(), { cache: "no-store" });
  if (!res.ok) throw new Error(`The show server said ${res.status}`);
  const body: unknown = await res.json();
  return isRecord(body) && Array.isArray(body.chats) ? body.chats : [];
}

const waiting = new Map<string, { timer: number; chat: SavedChat }>();

/** `keepalive`: the request outlives the page (it's closing). */
async function put(chat: SavedChat, keepalive = false) {
  let problem = "";
  try {
    const res = await fetch(url(chat.id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(chat), keepalive });
    if (!res.ok) problem = `${res.status} ${await res.text()}`;
  } catch (err) {
    problem = String(err);
  }
  if (problem) console.warn(`Chat: couldn't save "${chat.name}" on the show server (${problem}); trying again with the next change`);
}

/** Save a chat on the server soon (the same object: what it holds then is sent). */
export function saveChat(chat: SavedChat) {
  cancel(chat.id);
  const timer = window.setTimeout(() => { waiting.delete(chat.id); void put(chat); }, SAVE_DELAY_MS);
  waiting.set(chat.id, { timer, chat });
}

/** Drop a chat's waiting save. */
function cancel(id: string) {
  const w = waiting.get(id);
  if (!w) return;
  clearTimeout(w.timer);
  waiting.delete(id);
}

/** Drop every waiting save (a new or loaded show replaced the chats). */
export function cancelSaves() {
  for (const id of [...waiting.keys()]) cancel(id);
}

/** Send every waiting save now (the page is closing). */
export function flushChats() {
  for (const { chat } of [...waiting.values()]) {
    cancel(chat.id);
    void put(chat, true);
  }
}

export async function deleteChat(id: string) {
  cancel(id);
  try {
    await fetch(url(id), { method: "DELETE" });
  } catch (err) {
    console.warn(`Chat: couldn't delete it on the show server (${err})`);
  }
}

/**
 * Hear the other windows' changes. `reconnected` runs when the link comes
 * back after a drop (the server restarted): changes may have been missed.
 */
export function listenChats(onChange: (change: ChatChange) => void, reconnected: () => void) {
  const events = new EventSource(url("events"));
  let dropped = false;
  events.addEventListener("error", () => { dropped = true; });
  events.addEventListener("open", () => {
    if (dropped) reconnected();
    dropped = false;
  });
  events.addEventListener("message", (e) => {
    try {
      const change: unknown = JSON.parse(e.data);
      if (isRecord(change) && (change.type === "saved" || change.type === "deleted" || change.type === "replaced")) onChange(change as ChatChange);
    } catch {
      // not a change
    }
  });
}

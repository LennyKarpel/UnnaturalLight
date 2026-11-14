/**
 * The chat panel: a side panel on the right of the app page (../../index.html),
 * opened with the header's Chat button. You ask in words; the model answers
 * and uses the tools (./tools.ts) to look at and change the show, through
 * this window's console. There can be several named conversations (chats);
 * they're kept on the show server (./store.ts: server/data/session.chats.json,
 * next to the show's session.show.json; a saved show file holds both), so
 * every window and computer shares them. New show / Load show replace them all. This browser keeps the panel's own settings (open,
 * width, which chat is open, ↑ / ↓ prompts). A long chat is kept short: past
 * MAX_PROMPTS prompts, the oldest are summed up by the model and the summary
 * takes their place.
 */

import { CHAT_NAME_MAX, MAX_CHATS, type ChatChange, type ChatAssistantMessage, type ChatMessage, type ChatToolCall, type SavedChat } from "../../shared/chat-protocol.ts";
import { button, el } from "../../shared/html.ts";
import { ask } from "../../shared/ask.ts";
import { newId } from "../../shared/ids.ts";
import { elById } from "../../shared/query.ts";
import { errorMessage, isRecord } from "../../shared/guards.ts";
import { readStoredJson, storeJson } from "../../shared/storage.ts";
import { promptCount, repairHistory, runTurn, summarize, summaryCut, type TurnView } from "./loop.ts";
import { toolByName } from "./tools.ts";
import { cancelSaves, deleteChat, fetchChats, flushChats, listenChats, saveChat } from "./store.ts";

const KEY = "unnaturallight.chat";
/** Past this many prompts, the oldest SUMMED are summed up (between turns). */
const MAX_PROMPTS = 20;
const SUMMED = 10;
/** If summing up keeps failing (e.g. offline), the oldest are dropped past this many. */
const HARD_MAX = 40;

/** The panel's width (px): DEFAULT_WIDTH to start with, double-click its divider to go back to it. */
const DEFAULT_WIDTH = 340;
const MIN_WIDTH = 260;
/** The panes keep at least this much of the window. */
const MIN_PANES = 360;

/** Prompts kept for ↑ / ↓ (newest last). */
const MAX_SENT = 50;
/** A conversation (as the server keeps it). */
type Chat = SavedChat;
/** This browser's: `sent`: the prompts typed here, for ↑ / ↓ (all chats, kept across New). `current`: the open chat's id. */
type Prefs = { open: boolean; width: number; model: string; current: string; sent: string[] };

/** A chat's name from its first prompt. */
const nameFrom = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, CHAT_NAME_MAX);

const newChat = (history: ChatMessage[] = []): Chat => ({ id: newId("chat"), name: "", history, used: Date.now() });

/** A saved chat, its tool calls cut short by a reload repaired; null if this version can't read it. */
function readChat(v: unknown): Chat | null {
  if (!isRecord(v) || typeof v.id !== "string" || !Array.isArray(v.history)) return null;
  const history = v.history as ChatMessage[];
  try {
    repairHistory(history);
  } catch {
    return null;
  }
  const first = history.find((m) => m.role === "user");
  const name = typeof v.name === "string" && v.name ? v.name.slice(0, CHAT_NAME_MAX) : first ? nameFrom(first.text) : "";
  return { id: v.id, name, history, used: typeof v.used === "number" ? v.used : 0 };
}

const readChats = (list: unknown[]) => list.map(readChat).filter((c): c is Chat => !!c);

/** Chats this browser kept before they moved to the show server: they're sent there once, then dropped here. */
let fromBrowser: Chat[] = [];

function loadPrefs(): Prefs {
  const saved = readStoredJson(KEY);
  const prefs: Prefs = { open: false, width: DEFAULT_WIDTH, model: "", current: "", sent: [] };
  if (isRecord(saved)) {
    prefs.open = saved.open === true;
    if (typeof saved.width === "number" && Number.isFinite(saved.width)) prefs.width = saved.width;
    if (typeof saved.model === "string") prefs.model = saved.model;
    if (Array.isArray(saved.sent)) prefs.sent = saved.sent.filter((t): t is string => typeof t === "string").slice(-MAX_SENT);
    if (Array.isArray(saved.chats)) fromBrowser = readChats(saved.chats);
    // Before named chats: one conversation, `history`.
    else if (Array.isArray(saved.history)) fromBrowser = readChats([{ id: newId("chat"), history: saved.history }]);
    if (typeof saved.current === "string") prefs.current = saved.current;
  }
  return prefs;
}

const prefs = loadPrefs();
/** Every chat: the server's (loadChats), plus a new empty one until they're in. */
let chats: Chat[] = [newChat()];
/** The server's chats are in (until then, sending waits). */
let loaded = false;
const save = () => storeJson(KEY, prefs);
/** Save a chat on the server; a new chat that's still empty stays here until it's used. */
const keep = (c: Chat) => { if (c.history.length || c.name) saveChat(c); };

/** The open chat. */
const chat = () => chats.find((c) => c.id === prefs.current) ?? chats[0];
/** What a chat is called: its name, else "New chat". */
const chatName = (c: Chat) => c.name || "New chat";

/**
 * Never more than HARD_MAX prompts, whatever happens to summing up: drop the
 * oldest down to MAX_PROMPTS. In place (a running turn holds this same list).
 */
function capHistory() {
  const h = chat().history;
  const n = promptCount(h);
  if (n > HARD_MAX) h.splice(0, summaryCut(h, HARD_MAX, n - MAX_PROMPTS));
}

let summing = false;

/**
 * Past MAX_PROMPTS prompts, have the oldest SUMMED summed up and put the
 * summary in their place. Runs in the background after a turn; only
 * replaces them if they're still there unchanged (New, or another window,
 * may have changed the conversation meanwhile; it may not be the open chat
 * any more).
 */
async function sumUpOld() {
  const c = chat();
  const h = c.history;
  const cut = summaryCut(h, MAX_PROMPTS, SUMMED);
  if (summing || !cut) return;
  summing = true;
  const part = h.slice(0, cut);
  try {
    const text = await summarize(part);
    if (!chats.includes(c) || c.history !== h || !part.every((m, i) => h[i] === m)) return;
    h.splice(0, cut, { role: "summary", text });
    keep(c);
    if (!running && chat() === c) renderHistory();
  } catch (err) {
    console.warn(`Chat: couldn't sum up older messages (${errorMessage(err)}); trying again after the next prompt`);
  } finally {
    summing = false;
  }
}

// --- the panel ----------------------------------------------------------------

const chatBtn = elById<HTMLButtonElement>("chatBtn");
const panel = elById("chatPanel");
panel.innerHTML = `
  <div class="chat-divider" role="separator" aria-orientation="vertical" aria-label="Resize the chat" tabindex="0"
    title="Drag to resize · double-click for the default width"><span class="grip"></span></div>
  <header class="chat-head">
    <button type="button" class="chat-pick quiet" aria-expanded="false" aria-controls="chatList" title="Your chats: switch, rename or delete"><span class="chat-name"></span> ▾</button>
    <span class="chat-model"></span>
    <button type="button" class="chat-new quiet" title="Start a new chat (the others are kept: ▾)">New</button>
    <button type="button" class="chat-close quiet" title="Close the chat" aria-label="Close the chat">×</button>
  </header>
  <div class="chat-list thin-scroll" id="chatList" hidden></div>
  <div class="chat-log thin-scroll" aria-live="polite"></div>
  <form class="chat-form">
    <div class="chat-input">
      <textarea rows="2" placeholder="Ask… (Enter sends, ⇧Enter new line, ↑ earlier prompts)" aria-label="Message" spellcheck="false"></textarea>
      <button type="submit" class="primary">Send</button>
    </div>
  </form>`;
const q = <T extends HTMLElement>(sel: string) => panel.querySelector(sel) as T;
const modelEl = q<HTMLElement>(".chat-model");
const pickBtn = q<HTMLButtonElement>(".chat-pick");
const nameEl = q<HTMLElement>(".chat-name");
const list = q<HTMLElement>(".chat-list");
const log = q<HTMLElement>(".chat-log");
const form = q<HTMLFormElement>(".chat-form");
const input = q<HTMLTextAreaElement>("textarea");
const sendBtn = q<HTMLButtonElement>('button[type="submit"]');

// --- width: drag the divider on the panel's left edge -----------------------------

const divider = q<HTMLElement>(".chat-divider");
const clampWidth = (w: number) => Math.round(Math.max(MIN_WIDTH, Math.min(w, innerWidth - MIN_PANES)));

/** Size the panel (the panes make room: chat.css uses --chat-w). */
function setWidth(w: number) {
  prefs.width = clampWidth(w);
  document.documentElement.style.setProperty("--chat-w", `${prefs.width}px`);
  divider.setAttribute("aria-valuenow", String(prefs.width));
}

divider.addEventListener("pointerdown", (e) => {
  divider.setPointerCapture(e.pointerId);
  document.body.classList.add("chat-resizing");
});
divider.addEventListener("pointermove", (e) => {
  if (divider.hasPointerCapture(e.pointerId)) setWidth(innerWidth - e.clientX);
});
const endResize = () => {
  document.body.classList.remove("chat-resizing");
  save();
};
divider.addEventListener("pointerup", endResize);
divider.addEventListener("pointercancel", endResize);
divider.addEventListener("dblclick", () => {
  setWidth(DEFAULT_WIDTH);
  save();
});
// ← / → when it has focus (⇧ for bigger steps).
divider.addEventListener("keydown", (e) => {
  const step = e.shiftKey ? 60 : 20;
  if (e.key === "ArrowLeft") setWidth(prefs.width + step);
  else if (e.key === "ArrowRight") setWidth(prefs.width - step);
  else return;
  e.preventDefault();
  save();
});
// A smaller window: keep the panes their room.
addEventListener("resize", () => setWidth(prefs.width));
setWidth(prefs.width);

function setOpen(open: boolean) {
  prefs.open = open;
  panel.hidden = !open;
  document.body.classList.toggle("chat-open", open);
  chatBtn.classList.toggle("on", open);
  chatBtn.setAttribute("aria-pressed", String(open));
  save();
  if (open) {
    input.focus();
    log.scrollTop = log.scrollHeight;
  }
}

const scrollDown = () => { log.scrollTop = log.scrollHeight; };

function bubble(kind: "user" | "assistant" | "error" | "hint" | "pending", text: string) {
  const b = el("div", `chat-msg is-${kind}`, text);
  log.append(b);
  scrollDown();
  return b;
}

/** A tool call's line in the log, and its state. */
function chip(text: string) {
  const c = el("div", "chat-tool");
  const label = el("span", "chat-tool-text", text);
  const note = el("span", "chat-tool-note");
  c.append(label, note);
  log.append(c);
  scrollDown();
  return {
    el: c,
    set(state: "wait" | "ok" | "fail" | "stopped", text = "") {
      c.dataset.state = state;
      note.textContent = text;
    },
  };
}

function describe(call: ChatToolCall) {
  try {
    return toolByName.get(call.name)?.describe(isRecord(call.args) ? call.args : {}) ?? call.name;
  } catch {
    return call.name;
  }
}

/** Draw the saved conversation. */
function renderHistory() {
  log.replaceChildren();
  nameEl.textContent = chatName(chat());
  const h = chat().history;
  if (!h.length) {
    bubble("hint", "Ask in words: “play song 2”, “what’s up next?”, “master to 60%”, “GO”.");
  }
  h.forEach((m, i) => {
    if (m.role === "summary") {
      const d = el("details", "chat-summary");
      d.append(el("summary", "", "Earlier messages, summed up"), el("div", "chat-summary-text", m.text));
      log.append(d);
    } else if (m.role === "user") bubble("user", m.text);
    else if (m.role === "assistant") {
      if (m.text) bubble("assistant", m.text);
      const next = h[i + 1];
      const results = next?.role === "tool" ? next.results : [];
      for (const call of m.toolCalls) {
        const r = results.find((x) => x.id === call.id);
        const c = chip(describe(call));
        c.set(!r ? "fail" : r.error ? (r.result.startsWith("Stopped") ? "stopped" : "fail") : "ok", r?.error ? r.result : "");
      }
    }
  });
  modelEl.textContent = prefs.model;
}

// --- a turn -------------------------------------------------------------------

let running: AbortController | null = null;
/** Counts turns, and New: a turn whose number is no longer current was dropped by New. */
let turn = 0;

function setBusy(busy: boolean) {
  sendBtn.textContent = busy ? "Stop" : "Send";
  sendBtn.classList.toggle("primary", !busy);
  panel.classList.toggle("is-busy", busy);
  // Switching chats waits for the turn (Stop first): it's still changing the show.
  pickBtn.disabled = busy;
  pickBtn.title = busy ? "Working… (Stop first to switch chats)" : "Your chats: switch, rename or delete";
  if (busy) showList(false);
}

/** The show's and the stage's edits now (not playback), or null before the console and stage are up. */
type Snapshot = { key: string; show: string; stageKey: string; stage: unknown };

function editSnapshot(): Snapshot | null {
  try {
    const show = window.consoleChat?.editSnapshot();
    const stage = window.stageChat?.editSnapshot();
    if (show == null || !stage) return null;
    return { key: `${show}\n${stage.key}`, show, stageKey: stage.key, stage: stage.data };
  } catch {
    return null;
  }
}

/**
 * After a turn that edited the show or the stage: an Undo button that puts
 * the edits back as they were before it (playback stays as it is). Only
 * while nothing has changed since; only the latest turn's.
 */
function offerUndo(before: Snapshot, after: Snapshot) {
  const row = el("div", "chat-undo");
  const btn = button("quiet", "Undo these changes");
  btn.title = "Put cues, songs, fixtures and the stage back as they were before this request (what's LIVE stays)";
  row.append(btn);
  log.append(row);
  scrollDown();
  btn.addEventListener("click", () => {
    row.remove();
    if (editSnapshot()?.key !== after.key) {
      bubble("hint", "Can't undo: the show or the stage has changed since.");
      return;
    }
    try {
      // The show first: it has the console fixtures the stage's fixtures link to.
      if (before.show !== after.show) window.consoleChat?.restoreEdits(before.show);
      if (before.stageKey !== after.stageKey) window.stageChat?.restoreEdits(before.stage);
      bubble("hint", "Undone.");
    } catch (err) {
      bubble("error", `Couldn't undo: ${errorMessage(err)}`);
    }
  });
}

async function send(text: string) {
  log.querySelector(".is-hint")?.remove();
  for (const old of log.querySelectorAll(".chat-undo")) old.remove();
  const before = editSnapshot();
  capHistory();
  const prompt: ChatMessage = { role: "user", text };
  const c = chat();
  c.history.push(prompt);
  c.used = Date.now();
  // A new chat is named after its first prompt (rename it from ▾).
  const named = !c.name;
  if (named) {
    c.name = nameFrom(text);
    nameEl.textContent = c.name;
  }
  keep(c);
  const promptEl = bubble("user", text);
  const abort = new AbortController();
  running = abort;
  const mine = ++turn;
  /** Still this panel's conversation (New wasn't clicked meanwhile)? */
  const current = () => mine === turn;
  setBusy(true);

  /** Reply text streaming in (null until the next reply starts). */
  let streaming: HTMLElement | null = null;
  /** "Thinking…" while waiting on the model, before any text. */
  let pending: HTMLElement | null = null;
  const settle = () => {
    pending?.remove();
    pending = null;
  };
  const chips = new Map<string, ReturnType<typeof chip>>();
  const view: TurnView = {
    waiting: () => {
      if (!current()) return;
      settle();
      pending = bubble("pending", "Thinking…");
    },
    text: (t) => {
      if (!current()) return;
      settle();
      streaming ??= bubble("assistant", "");
      streaming.textContent += t;
      scrollDown();
    },
    reply: (m: ChatAssistantMessage, model) => {
      if (!current()) return;
      settle();
      if (!streaming && m.text) bubble("assistant", m.text);
      streaming = null;
      for (const call of m.toolCalls) {
        const c = chip(describe(call));
        c.set("wait");
        chips.set(call.id, c);
      }
      prefs.model = model;
      modelEl.textContent = model;
      save();
      keep(c);
    },
    results: () => {
      if (current()) keep(c);
    },
    tool: (call) => {
      const c = chips.get(call.id) ?? chip(describe(call));
      return { done: (ok, note) => c.set(ok ? "ok" : "fail", note) };
    },
  };

  const history = c.history;
  try {
    await runTurn(history, view, abort.signal);
  } catch (err) {
    if (!abort.signal.aborted) bubble("error", errorMessage(err, "Chat failed"));
  }
  // "New" while it ran: that conversation is gone, and so is its log.
  if (!current()) return;
  settle();
  // Failed or stopped before anything happened: leave it out of the
  // conversation, so asking again means once (not a pile of unanswered prompts).
  if (history.at(-1) === prompt) {
    history.pop();
    // Nothing left: the next prompt names it.
    if (named && !history.length) {
      c.name = "";
      nameEl.textContent = chatName(c);
    }
    promptEl.classList.add("is-failed");
    promptEl.title = "Not sent: it failed or was stopped before anything was done";
  }
  if (abort.signal.aborted) bubble("hint", "Stopped.");
  for (const c of chips.values()) if (c.el.dataset.state === "wait") c.set("stopped", "Not run");
  const after = editSnapshot();
  if (before && after && after.key !== before.key) offerUndo(before, after);
  running = null;
  setBusy(false);
  keep(c);
  input.focus();
  void sumUpOld();
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (running) {
    running.abort();
    return;
  }
  const text = input.value.trim();
  // Until the chats are in from the show server (a moment), the text waits in the box.
  if (!text || !loaded) return;
  input.value = "";
  remember(text);
  void send(text);
});

// ↑ / ↓ in the box: step back and forth through the prompts sent before, as
// in a terminal. ↑ on the first line (↓ on the last) so moving through a
// longer prompt still works; past the newest is what was being typed.
let recall = prefs.sent.length;
let draft = "";

function remember(text: string) {
  if (prefs.sent.at(-1) !== text) prefs.sent.push(text);
  prefs.sent.splice(0, Math.max(0, prefs.sent.length - MAX_SENT));
  recall = prefs.sent.length;
  draft = "";
}

function stepRecall(by: -1 | 1): boolean {
  const next = recall + by;
  if (next < 0 || next > prefs.sent.length) return false;
  if (recall === prefs.sent.length) draft = input.value;
  recall = next;
  input.value = recall === prefs.sent.length ? draft : prefs.sent[recall];
  const end = input.value.length;
  input.setSelectionRange(end, end);
  return true;
}

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    // While it's working, Enter waits (Stop is a click), so it never stops a turn by surprise.
    if (!running) form.requestSubmit();
    return;
  }
  if ((e.key !== "ArrowUp" && e.key !== "ArrowDown") || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey || e.isComposing) return;
  const { selectionStart: from, selectionEnd: to, value } = input;
  if (from !== to) return;
  const onFirstLine = !value.slice(0, from).includes("\n");
  const onLastLine = !value.slice(to).includes("\n");
  if (e.key === "ArrowUp" ? onFirstLine && stepRecall(-1) : onLastLine && stepRecall(1)) e.preventDefault();
});
// Typing here isn't for the stage or console's keys.
panel.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !list.hidden) showList(false);
  else if (e.key === "Escape" && !running) setOpen(false);
  e.stopPropagation();
});

// --- the chats: New, and the ▾ list to switch, rename or delete -------------------

/** Open a chat (and save which one it is). `focus`: put the cursor in the box (not when another window caused it). */
function openChat(c: Chat, focus = true) {
  prefs.current = c.id;
  save();
  renderHistory();
  scrollDown();
  if (focus) input.focus();
}

/** Take a chat out of the list; if it was open, open the most recent one instead (with `note` under it). */
function dropChat(c: Chat, note?: string) {
  chats.splice(chats.indexOf(c), 1);
  if (!chats.length) chats.push(newChat());
  if (c.id !== prefs.current) return;
  openChat(byUse()[0], !note);
  if (note) bubble("hint", note);
}

/** The chats, the one used most recently first. */
const byUse = () => [...chats].sort((a, b) => b.used - a.used);

/**
 * Take the server's chats (another window may have added, changed or
 * deleted some). The open chat stays this window's own (it may be running,
 * or have a save on its way). Chats this browser kept before are sent up.
 */
async function loadChats() {
  let fresh: Chat[];
  try {
    fresh = readChats(await fetchChats());
  } catch (err) {
    if (!loaded) bubble("error", `Couldn't load the chats from the show server (${errorMessage(err)}). Reload to try again.`);
    return;
  }
  for (const c of fromBrowser) {
    if (fresh.some((f) => f.id === c.id)) continue;
    fresh.push(c);
    saveChat(c);
  }
  if (fromBrowser.length) {
    fromBrowser = [];
    save(); // the browser copy goes (prefs has no chats)
  }
  // The open chat stays this window's own object (even a new, still empty one
  // the server doesn't have yet), so nothing holding it goes stale.
  const mine = chat();
  const i = fresh.findIndex((c) => c.id === mine.id);
  if (loaded) {
    if (i >= 0) fresh[i] = mine;
    else fresh.push(mine);
  }
  if (!fresh.length) fresh.push(newChat());
  chats = fresh;
  if (!chats.some((c) => c.id === prefs.current)) prefs.current = byUse()[0].id;
  const first = !loaded;
  loaded = true;
  if (first) {
    renderHistory();
    void sumUpOld();
  } else nameEl.textContent = chatName(chat());
  if (!list.hidden) renderList();
}

/**
 * Another window saved or deleted a chat. Only the chat with that id
 * changes. The open one is redrawn, unless a request is running in it here
 * (then this window's copy wins: it saves when the request ends).
 */
function onChange(change: ChatChange) {
  if (!loaded) return;
  if (change.type === "replaced") {
    replaceChats(change.chats);
    return;
  }
  const id = change.type === "saved" ? change.chat.id : change.id;
  const i = chats.findIndex((c) => c.id === id);
  const isOpen = id === chat().id;
  if (isOpen && running) return;
  if (change.type === "saved") {
    const [fresh] = readChats([change.chat]);
    if (!fresh) return;
    if (i >= 0) chats[i] = fresh;
    else chats.push(fresh);
    if (isOpen) {
      renderHistory();
      scrollDown();
    }
  } else if (i >= 0) {
    dropChat(chats[i], "That chat was deleted in another window.");
  }
  if (!list.hidden) renderList();
}

/**
 * New show or Load show: the show's chats (none for a new one) replace them
 * all, here too. A request running here stops, as with New.
 */
function replaceChats(saved: unknown[]) {
  running?.abort();
  running = null;
  turn++;
  setBusy(false);
  cancelSaves();
  chats = readChats(saved);
  if (!chats.length) chats.push(newChat());
  openChat(byUse()[0], false);
  if (!list.hidden) renderList();
}

function showList(show: boolean) {
  list.hidden = !show;
  pickBtn.setAttribute("aria-expanded", String(show));
  if (show) {
    renderList();
    void loadChats();
  }
}

function renderList() {
  list.replaceChildren();
  for (const c of byUse()) {
    // The list may be reloaded from the server while it's open: act on the chat as it is when clicked.
    const id = c.id;
    const now = () => chats.find((x) => x.id === id);
    const row = el("div", "chat-row" + (c.id === prefs.current ? " is-current" : ""));
    const open = button("chat-row-name quiet", chatName(c));
    const n = promptCount(c.history);
    open.title = `${chatName(c)} · ${n} prompt${n === 1 ? "" : "s"}`;
    open.addEventListener("click", () => {
      const it = now();
      showList(false);
      if (it) openChat(it);
    });
    const rename = button("quiet", "✎");
    rename.title = "Rename";
    rename.setAttribute("aria-label", `Rename ${chatName(c)}`);
    rename.addEventListener("click", async () => {
      const name = await ask({ title: "Rename chat", initial: chatName(c), confirmLabel: "Rename" });
      const it = now();
      if (!name || !it) return;
      it.name = name.slice(0, CHAT_NAME_MAX);
      saveChat(it);
      renderList();
      if (it.id === prefs.current) nameEl.textContent = it.name;
    });
    const del = button("quiet", "✕");
    del.title = "Delete";
    del.setAttribute("aria-label", `Delete ${chatName(c)}`);
    del.addEventListener("click", async () => {
      if (c.history.length && !(await ask({ title: `Delete “${chatName(c)}”?`, message: "Its messages are deleted for good. The show isn't changed.", confirmLabel: "Delete" }))) return;
      void deleteChat(id);
      const it = now();
      if (it) dropChat(it);
      renderList();
    });
    row.append(open, rename, del);
    list.append(row);
  }
}

pickBtn.addEventListener("click", () => showList(list.hidden !== false)); // hidden may also be "until-found"

q<HTMLButtonElement>(".chat-new").addEventListener("click", () => {
  running?.abort();
  running = null;
  turn++;
  setBusy(false);
  showList(false);
  // An empty chat is already new: no pile of empty ones.
  if (chat().history.length) {
    const c = newChat();
    chats.push(c);
    // Too many: the one used longest ago goes (the server does the same).
    while (chats.length > MAX_CHATS) chats.splice(chats.indexOf(byUse().at(-1)!), 1);
    prefs.current = c.id;
  }
  openChat(chat());
});
q<HTMLButtonElement>(".chat-close").addEventListener("click", () => setOpen(false));
chatBtn.addEventListener("click", () => setOpen(panel.hidden !== false));

renderHistory();
setOpen(prefs.open);
void loadChats();
listenChats(onChange, () => void loadChats());
addEventListener("pagehide", flushChats);

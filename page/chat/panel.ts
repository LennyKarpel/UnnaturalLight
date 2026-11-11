/**
 * The chat panel: a side panel on the right of the app page (../../index.html),
 * opened with the header's Chat button. You ask in words; the model answers
 * and uses the tools (./tools.ts) to look at and change the show, through
 * this window's console. The conversation is kept in this browser
 * (localStorage; windows in the same browser share it), not on the show
 * server. A long one is kept short: past MAX_PROMPTS prompts, the oldest
 * are summed up by the model and the summary takes their place.
 */

import type { ChatAssistantMessage, ChatMessage, ChatToolCall } from "../../shared/chat-protocol.ts";
import { button, el } from "../../shared/html.ts";
import { elById } from "../../shared/query.ts";
import { errorMessage, isRecord } from "../../shared/guards.ts";
import { readStoredJson, storeJson } from "../../shared/storage.ts";
import { promptCount, repairHistory, runTurn, summarize, summaryCut, type TurnView } from "./loop.ts";
import { toolByName } from "./tools.ts";

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

/** `sent`: the prompts typed here, for ↑ / ↓ (kept across New). */
type Prefs = { open: boolean; width: number; model: string; history: ChatMessage[]; sent: string[] };
let prefs: Prefs = { open: false, width: DEFAULT_WIDTH, model: "", history: [], sent: [] };
const saved = readStoredJson(KEY);
if (isRecord(saved)) {
  prefs = {
    open: saved.open === true,
    width: typeof saved.width === "number" && Number.isFinite(saved.width) ? saved.width : DEFAULT_WIDTH,
    model: typeof saved.model === "string" ? saved.model : "",
    history: Array.isArray(saved.history) ? (saved.history as ChatMessage[]) : [],
    sent: Array.isArray(saved.sent) ? saved.sent.filter((t): t is string => typeof t === "string").slice(-MAX_SENT) : [],
  };
  // A turn cut short by a reload can leave tool calls without results.
  try {
    repairHistory(prefs.history);
  } catch {
    prefs.history = []; // not a conversation this version can read
  }
}

const save = () => storeJson(KEY, prefs);

/**
 * Never more than HARD_MAX prompts, whatever happens to summing up: drop the
 * oldest down to MAX_PROMPTS. In place (a running turn holds this same list).
 */
function capHistory() {
  const h = prefs.history;
  const n = promptCount(h);
  if (n > HARD_MAX) h.splice(0, summaryCut(h, HARD_MAX, n - MAX_PROMPTS));
}

let summing = false;

/**
 * Past MAX_PROMPTS prompts, have the oldest SUMMED summed up and put the
 * summary in their place. Runs in the background after a turn; only
 * replaces them if they're still there unchanged (New, or another window
 * in this browser, may have changed the conversation meanwhile).
 */
async function sumUpOld() {
  const h = prefs.history;
  const cut = summaryCut(h, MAX_PROMPTS, SUMMED);
  if (summing || !cut) return;
  summing = true;
  const part = h.slice(0, cut);
  try {
    const text = await summarize(part);
    if (prefs.history !== h || !part.every((m, i) => h[i] === m)) return;
    h.splice(0, cut, { role: "summary", text });
    save();
    if (!running) renderHistory();
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
    <strong>Chat</strong>
    <span class="chat-model"></span>
    <button type="button" class="chat-new quiet" title="Start a new conversation">New</button>
    <button type="button" class="chat-close quiet" title="Close the chat" aria-label="Close the chat">×</button>
  </header>
  <div class="chat-log thin-scroll" aria-live="polite"></div>
  <form class="chat-form">
    <div class="chat-input">
      <textarea rows="2" placeholder="Ask… (Enter sends, ⇧Enter new line, ↑ earlier prompts)" aria-label="Message" spellcheck="false"></textarea>
      <button type="submit" class="primary">Send</button>
    </div>
  </form>`;
const q = <T extends HTMLElement>(sel: string) => panel.querySelector(sel) as T;
const modelEl = q<HTMLElement>(".chat-model");
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
  const h = prefs.history;
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
  prefs.history.push(prompt);
  save();
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
    },
    results: () => {
      if (current()) save();
    },
    tool: (call) => {
      const c = chips.get(call.id) ?? chip(describe(call));
      return { done: (ok, note) => c.set(ok ? "ok" : "fail", note) };
    },
  };

  const history = prefs.history;
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
    promptEl.classList.add("is-failed");
    promptEl.title = "Not sent: it failed or was stopped before anything was done";
  }
  if (abort.signal.aborted) bubble("hint", "Stopped.");
  for (const c of chips.values()) if (c.el.dataset.state === "wait") c.set("stopped", "Not run");
  const after = editSnapshot();
  if (before && after && after.key !== before.key) offerUndo(before, after);
  running = null;
  setBusy(false);
  save();
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
  if (!text) return;
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
  if (e.key === "Escape" && !running) setOpen(false);
  e.stopPropagation();
});

q<HTMLButtonElement>(".chat-new").addEventListener("click", () => {
  running?.abort();
  running = null;
  turn++;
  setBusy(false);
  prefs.history = [];
  save();
  renderHistory();
  input.focus();
});
q<HTMLButtonElement>(".chat-close").addEventListener("click", () => setOpen(false));
chatBtn.addEventListener("click", () => setOpen(panel.hidden));

capHistory();
renderHistory();
setOpen(prefs.open);
void sumUpOld();

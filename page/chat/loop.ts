/**
 * One chat turn: send the conversation to the show server (POST /chat),
 * stream the model's reply, run the tools it calls (./tools.ts, ./tools/), send their
 * results back, and repeat until it answers without calling any.
 */

import type { ChatAssistantMessage, ChatEvent, ChatMessage, ChatModels, ChatRequest, ChatSummary, ChatSummaryRequest, ChatToolCall, ChatToolResult } from "../../shared/chat-protocol.ts";
import { serverUrl } from "../../shared/server-socket.ts";
import { errorMessage, isRecord, unhandled } from "../../shared/guards.ts";
import { TOOLS, toolByName, type ToolDef } from "./tools.ts";

/** Most model calls in one turn (each tool round is one). */
const MAX_STEPS = 12;

/** What the panel shows as the turn goes. */
export type TurnView = {
  /** Waiting on the model (it may think, silently, before it writes anything). */
  waiting?: () => void;
  /** Reply text as it streams in (a new reply starts after each tool round). */
  text: (chunk: string) => void;
  /** A reply is complete. */
  reply: (message: ChatAssistantMessage, model: string) => void;
  /** A reply's tool results were added to the conversation (a good moment to save it). */
  results?: () => void;
  /** A tool is about to run: returns how to show it finishing (`result`: what the model is told, or why it failed). */
  tool: (call: ChatToolCall, description: string) => { done: (ok: boolean, result: string) => void };
};

export const chatUrl = (path = "/chat") => serverUrl(path);

/** The connection to the show server broke (not a refusal or an API error). */
const LOST = "Lost the connection to the show server (it may have restarted). Send your message again.";

/** One model reply, streamed. `model`: the one picked in the panel ("" = the server's default). */
async function ask(history: ChatMessage[], view: TurnView, signal: AbortSignal, model: string): Promise<{ message: ChatAssistantMessage; model: string }> {
  view.waiting?.();
  try {
    return await stream(history, view, signal, model);
  } catch (err) {
    // fetch and reading its body throw TypeError when the connection drops.
    if (err instanceof TypeError && !signal.aborted) throw new Error(LOST);
    throw err;
  }
}

/** POST JSON to the show server's chat (`body` typed by what each endpoint takes). */
const post = (path: string, body: ChatRequest | ChatSummaryRequest, signal?: AbortSignal) =>
  fetch(chatUrl(path), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: signal ?? null });

async function stream(history: ChatMessage[], view: TurnView, signal: AbortSignal, model: string): Promise<{ message: ChatAssistantMessage; model: string }> {
  const tools = TOOLS.map(({ name, description, schema, deferred }) => ({ name, description, schema, deferred }));
  const res = await post("/chat", { messages: history, tools, ...(model ? { model } : {}) }, signal);
  if (!res.ok || !res.body) throw new Error(res.status === 404 ? "This show server has no chat (restart it to update)" : `Chat failed: ${await res.text()}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const event = JSON.parse(line) as ChatEvent;
      if (event.type === "text") view.text(event.text);
      else if (event.type === "error") throw new Error(event.error);
      else if (event.type === "done") return { message: event.message, model: event.model };
      else unhandled(event);
    }
  }
  throw new Error(LOST);
}

function resultText(value: unknown): string {
  if (value === undefined) return "done";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Run one call; always returns a result for the model. */
async function runCall(call: ChatToolCall, view: TurnView, signal: AbortSignal): Promise<ChatToolResult> {
  const def: ToolDef | undefined = toolByName.get(call.name);
  const fail = (msg: string): ChatToolResult => ({ id: call.id, result: msg, error: true });
  if (!def) return fail(`No tool called ${call.name}`);
  const args = isRecord(call.args) ? call.args : {};
  let description: string;
  try {
    description = def.describe(args);
  } catch {
    description = call.name;
  }
  if (signal.aborted) return fail("Stopped by the person before it ran");
  const shown = view.tool(call, description);
  try {
    const result = resultText(await def.run(args));
    shown.done(true, result);
    return { id: call.id, result };
  } catch (err) {
    const msg = errorMessage(err, "Failed");
    shown.done(false, msg);
    return fail(msg);
  }
}

// --- keeping a long chat short --------------------------------------------------

/** Where the person's prompt number `n` (0 = first) is in the conversation, or -1. */
function promptIndex(history: ChatMessage[], n: number) {
  let seen = 0;
  for (let i = 0; i < history.length; i++) if (history[i].role === "user" && seen++ === n) return i;
  return -1;
}

export const promptCount = (history: ChatMessage[]) => history.filter((m) => m.role === "user").length;

/**
 * How many messages from the start to sum up: once there are more than
 * `max` prompts, the oldest `chunk` prompts and everything that followed
 * them (with any summary already at the start, so summaries roll up).
 * 0 = not yet.
 */
export function summaryCut(history: ChatMessage[], max: number, chunk: number): number {
  if (promptCount(history) <= max) return 0;
  return Math.max(0, promptIndex(history, chunk));
}

/** Ask the show server to sum up `messages` (POST /chat/summary), with `model` ("" = the server's default). */
export async function summarize(messages: ChatMessage[], signal?: AbortSignal, model = ""): Promise<string> {
  const res = await post("/chat/summary", { messages, ...(model ? { model } : {}) }, signal);
  if (!res.ok) throw new Error(`Summary failed: ${await res.text()}`);
  const { summary } = (await res.json()) as ChatSummary;
  if (typeof summary !== "string" || !summary.trim()) throw new Error("Summary failed: empty");
  return summary.trim();
}

const INTERRUPTED = "Not run: the chat was interrupted (page reloaded or server restarted)";

/**
 * Make a saved conversation valid to send, in place: every tool call gets a
 * result in the message right after it, and results that answer no call
 * are dropped. A reload or server restart in the middle of a turn can leave
 * calls without results (saved when the reply came, before the tools ran),
 * which the model API refuses.
 */
export function repairHistory(history: ChatMessage[]) {
  for (let i = 0; i < history.length; i++) {
    const m = history[i];
    if (m.role === "tool") {
      const prev = history[i - 1];
      const ids = new Set(prev?.role === "assistant" ? prev.toolCalls.map((c) => c.id) : []);
      m.results = m.results.filter((r) => ids.has(r.id));
      if (!m.results.length) history.splice(i--, 1);
      continue;
    }
    if (m.role !== "assistant" || !m.toolCalls.length) continue;
    let next = history[i + 1];
    if (next?.role !== "tool") {
      next = { role: "tool", results: [] };
      history.splice(i + 1, 0, next);
    }
    const calls = new Set(m.toolCalls.map((c) => c.id));
    next.results = next.results.filter((r) => calls.has(r.id));
    const answered = new Set(next.results.map((r) => r.id));
    for (const c of m.toolCalls) if (!answered.has(c.id)) next.results.push({ id: c.id, result: INTERRUPTED, error: true });
    // Same order as the calls.
    const order = new Map(m.toolCalls.map((c, k) => [c.id, k]));
    next.results.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    i++;
  }
}

/** The models the panel's menu offers (GET /chat/models). Throws if the show server has none. */
export async function fetchModels(): Promise<ChatModels> {
  const res = await fetch(chatUrl("/chat/models"), { cache: "no-store" });
  if (!res.ok) throw new Error(res.status === 404 ? "This show server can't pick models (restart it to update)" : await res.text());
  const body = (await res.json()) as ChatModels;
  if (!Array.isArray(body.models) || typeof body.default !== "string") throw new Error("Bad model list");
  return body;
}

/**
 * Run a turn on `history` (which ends with the person's message). Adds the
 * replies and tool results to it as they come, so it's always valid to send
 * again, even after Stop or an error. `model`: the one picked ("" = the
 * server's default); a new pick applies from the next turn.
 */
export async function runTurn(history: ChatMessage[], view: TurnView, signal: AbortSignal, model = "") {
  repairHistory(history);
  for (let step = 0; step < MAX_STEPS; step++) {
    const { message, model: label } = await ask(history, view, signal, model);
    history.push(message);
    view.reply(message, label);
    if (!message.toolCalls.length) return;
    const results: ChatToolResult[] = [];
    // In order, as the model listed them.
    for (const call of message.toolCalls) results.push(await runCall(call, view, signal));
    history.push({ role: "tool", results });
    view.results?.();
    if (signal.aborted) return;
  }
  throw new Error(`Stopped after ${MAX_STEPS} steps`);
}

import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChatAssistantMessage, ChatMessage, ChatRequest } from "../shared/chat-protocol.ts";

// What the page's loop needs from the browser.
const g = globalThis as Record<string, unknown>;
g.location = new URL("http://127.0.0.1:8080/index.html");
g.sessionStorage = { getItem: () => null };
let goes = 0;
g.window = {
  consoleChat: {
    go: () => {
      goes++;
      return true;
    },
    show: () => ({ serverConnected: true, playing: { upNext: { label: "Cue 2" }, transition: "running" } }),
  },
};

/** A fake /chat: answers each request with the next reply, and records what it was sent. */
function fakeServer(replies: ChatAssistantMessage[]) {
  const sent: ChatRequest[] = [];
  g.fetch = async (_url: URL, init: { body: string }) => {
    sent.push(JSON.parse(init.body));
    const message = replies.shift();
    const lines = [{ type: "text", text: message?.text ?? "" }, { type: "done", message, model: "fake" }];
    return new Response(lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
  };
  return sent;
}

const { runTurn } = await import("../page/chat/loop.ts");

function view() {
  const shown: string[] = [];
  return {
    shown,
    view: {
      text: () => {},
      reply: () => {},
      tool: (_c: unknown, d: string) => {
        shown.push(d);
        return { done: () => {} };
      },
    },
  };
}

const goCall: ChatAssistantMessage = { role: "assistant", text: "", toolCalls: [{ id: "t1", name: "go", args: {} }] };
const after: ChatAssistantMessage = { role: "assistant", text: "Done.", toolCalls: [] };

test("GO: runs straight away, its result goes back, and the turn ends on the model's answer", async () => {
  goes = 0;
  const sent = fakeServer([goCall, after]);
  const history: ChatMessage[] = [{ role: "user", text: "GO" }];
  const v = view();
  await runTurn(history, v.view, new AbortController().signal);
  assert.equal(goes, 1);
  assert.deepEqual(v.shown, ["GO → Cue 2"]);
  assert.deepEqual(history.map((m) => m.role), ["user", "assistant", "tool", "assistant"]);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].messages.at(-1)?.role, "tool");
  assert.ok(sent[0].tools.some((t) => t.name === "go"));
});

test("Stop before a call runs: it doesn't run, still gets a result, and no further model call", async () => {
  goes = 0;
  const sent = fakeServer([goCall, after]);
  const abort = new AbortController();
  const history: ChatMessage[] = [{ role: "user", text: "GO" }];
  const v = view();
  v.view.reply = () => abort.abort();
  await runTurn(history, v.view, abort.signal);
  assert.equal(goes, 0);
  assert.equal(sent.length, 1);
  assert.deepEqual(history.map((m) => m.role), ["user", "assistant", "tool"]);
  const tool = history[2];
  assert.ok(tool.role === "tool" && tool.results[0].error && /^Stopped/.test(tool.results[0].result));
});

test("unknown tool: reported to the model as an error", async () => {
  fakeServer([{ role: "assistant", text: "", toolCalls: [{ id: "x", name: "nope", args: {} }] }, after]);
  const history: ChatMessage[] = [{ role: "user", text: "?" }];
  await runTurn(history, view().view, new AbortController().signal);
  const tool = history[2];
  assert.ok(tool.role === "tool" && tool.results[0].error);
});

test("connection lost mid-turn (e.g. the server restarted): a clear error, history still sendable", async () => {
  g.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  const history: ChatMessage[] = [{ role: "user", text: "GO" }];
  await assert.rejects(runTurn(history, view().view, new AbortController().signal), /Lost the connection to the show server/);
  assert.deepEqual(history.map((m) => m.role), ["user"]);
});

test("repairHistory: calls left without results by a reload get one; stray results go", async () => {
  const { repairHistory } = await import("../page/chat/loop.ts");
  const two: ChatAssistantMessage = { role: "assistant", text: "", toolCalls: [{ id: "a", name: "go", args: {} }, { id: "b", name: "get_show", args: {} }] };
  const history: ChatMessage[] = [
    { role: "user", text: "GO" },
    goCall, // reload before its tools ran: no result
    { role: "user", text: "GO" },
    two,
    { role: "tool", results: [{ id: "b", result: "ok" }, { id: "zzz", result: "?" }] }, // one missing, one stray
    after,
    { role: "tool", results: [{ id: "q", result: "orphan" }] }, // answers nothing
    { role: "user", text: "GO" },
  ];
  repairHistory(history);
  assert.deepEqual(history.map((m) => m.role), ["user", "assistant", "tool", "user", "assistant", "tool", "assistant", "user"]);
  const r1 = history[2], r2 = history[5];
  assert.ok(r1.role === "tool" && r1.results[0].id === "t1" && r1.results[0].error);
  assert.ok(r2.role === "tool");
  assert.deepEqual(r2.results.map((r) => [r.id, r.error ?? false]), [["a", true], ["b", false]]);
  const again = JSON.stringify(history);
  repairHistory(history);
  assert.equal(JSON.stringify(history), again, "repairing twice changes nothing");
});

test("summaryCut: nothing until past the limit, then the oldest prompts and what followed (with an earlier summary)", async () => {
  const { summaryCut, promptCount } = await import("../page/chat/loop.ts");
  const exchange = (n: number): ChatMessage[] => [
    { role: "user", text: `prompt ${n}` },
    { role: "assistant", text: "", toolCalls: [{ id: `c${n}`, name: "go", args: {} }] },
    { role: "tool", results: [{ id: `c${n}`, result: "ok" }] },
    { role: "assistant", text: "done", toolCalls: [] },
  ];
  const history: ChatMessage[] = [{ role: "summary", text: "before" }, ...[1, 2, 3, 4, 5].flatMap(exchange)];
  assert.equal(promptCount(history), 5);
  assert.equal(summaryCut(history, 5, 2), 0, "at the limit: not yet");
  history.push(...exchange(6));
  const cut = summaryCut(history, 5, 2);
  assert.equal(cut, 1 + 2 * 4, "the summary and two whole exchanges");
  assert.deepEqual(history[cut], { role: "user", text: "prompt 3" });
});

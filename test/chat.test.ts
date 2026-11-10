import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChatRequest } from "../server/chat/chat.ts";
import { toApiMessage } from "../server/chat/anthropic.ts";
import { findSong, TOOLS } from "../page/chat/tools.ts";

const songs = [
  { id: "a", name: "Intro", cues: 3 },
  { id: "b", name: "Blue Song", cues: 5 },
  { id: "c", name: "Blue Moon", cues: 2 },
];

test("findSong: by number, exact name, or the one name that contains it", () => {
  assert.equal(findSong(songs, "2").id, "b");
  assert.equal(findSong(songs, "intro").id, "a");
  assert.equal(findSong(songs, "moon").id, "c");
  assert.throws(() => findSong(songs, "blue"), /matches "Blue Song", "Blue Moon"/);
  assert.throws(() => findSong(songs, "outro"), /No song "outro"/);
  assert.throws(() => findSong(songs, ""), /Which song/);
});

test("parseChatRequest: takes a conversation and tools, refuses anything else", () => {
  const tools = TOOLS.map(({ name, description, schema }) => ({ name, description, schema }));
  const ok = parseChatRequest({ messages: [{ role: "user", text: "GO" }], tools });
  assert.equal(ok.messages.length, 1);
  assert.throws(() => parseChatRequest({ messages: [], tools }), /Bad chat messages/);
  assert.throws(() => parseChatRequest({ messages: [{ role: "system", text: "x" }], tools }), /Bad chat messages/);
  assert.throws(() => parseChatRequest({ messages: [{ role: "user", text: "x" }], tools: [{ name: "x" }] }), /Bad chat tools/);
  assert.throws(() => parseChatRequest(null), /Bad chat request/);
});

test("every tool has a unique name and an object schema", () => {
  assert.equal(new Set(TOOLS.map((t) => t.name)).size, TOOLS.length);
  for (const t of TOOLS) assert.equal(t.schema.type, "object", t.name);
});

test("Anthropic adapter: own blocks go back unchanged, others are rebuilt", () => {
  const raw = [{ type: "thinking", thinking: "", signature: "s" }, { type: "tool_use", id: "t1", name: "go", input: {} }];
  assert.deepEqual(toApiMessage({ role: "assistant", text: "", toolCalls: [], raw: { provider: "anthropic", data: raw } }).content, raw);
  assert.deepEqual(toApiMessage({ role: "assistant", text: "Going", toolCalls: [{ id: "t1", name: "go", args: {} }], raw: { provider: "other", data: [] } }).content, [
    { type: "text", text: "Going" },
    { type: "tool_use", id: "t1", name: "go", input: {} },
  ]);
  assert.deepEqual(toApiMessage({ role: "tool", results: [{ id: "t1", result: "no", error: true }] }), {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "t1", content: "no", is_error: true }],
  });
});

test("summaries: accepted in requests, sent to Claude as context, written out plainly for the summarizer", async () => {
  const { transcript } = await import("../server/chat/chat.ts");
  const tools = TOOLS.map(({ name, description, schema }) => ({ name, description, schema }));
  assert.equal(parseChatRequest({ messages: [{ role: "summary", text: "earlier" }, { role: "user", text: "GO" }], tools }).messages.length, 2);
  const api = toApiMessage({ role: "summary", text: "Called cue 3 the blue wash" });
  assert.equal(api.role, "user");
  assert.match(String(api.content), /Summary of the earlier part of this chat\)\n.*blue wash/);
  const text = transcript([
    { role: "summary", text: "before" },
    { role: "user", text: "play song 2" },
    { role: "assistant", text: "", toolCalls: [{ id: "a", name: "select_song", args: { song: "2" } }] },
    { role: "tool", results: [{ id: "a", result: "x".repeat(1000) }] },
    { role: "assistant", text: "Song 2 is LIVE.", toolCalls: [] },
  ]);
  assert.match(text, /^Summary of what came before: before\nOperator: play song 2\nAssistant used select_song \{"song":"2"\}\nTool result: x+…\nAssistant: Song 2 is LIVE\.$/);
  assert.ok(text.length < 600, "long tool results are cut short");
});

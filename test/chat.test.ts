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

// --- round 2: fixtures ---------------------------------------------------------

import { findFixtures, fixtureLevels, fixtureRoles, roleFromName, type FixtureInfo } from "../page/chat/tools.ts";

const fx = (name: string, group: string | null, roles: (string | null)[], firstFader: number): FixtureInfo => ({
  name,
  group,
  channels: roles.map((role, k) => ({ channel: 100 + k, role: role as FixtureInfo["channels"][number]["role"], faders: [firstFader + k] })),
});
const ring1 = fx("Ring 1 - 1", "Ring 1", ["dimmer", "pan", "tilt", "red", "green", "blue", "white", "zoom"], 1);
const ring2 = fx("Ring 1 - 2", "Ring 1", ["dimmer", "red", "green", "blue"], 9);
const par = fx("Front Par", null, [null, null], 20);
const all = [ring1, ring2, par];

test("findFixtures: by name, group, all, or the one name containing it", () => {
  assert.deepEqual(findFixtures(all, ["Ring 1 - 2"]), [ring2]);
  assert.deepEqual(findFixtures(all, ["ring 1"]), [ring1, ring2], "a group's name");
  assert.deepEqual(findFixtures(all, ["all"]), all);
  assert.deepEqual(findFixtures(all, ["par"]), [par]);
  assert.deepEqual(findFixtures(all, ["Ring 1 - 1", "ring 1"]), [ring1, ring2], "no repeats");
  assert.throws(() => findFixtures(all, ["- "]), /matches "Ring 1 - 1", "Ring 1 - 2"/);
  assert.throws(() => findFixtures(all, ["back light"]), /No fixture or group "back light"/);
  assert.throws(() => findFixtures(all, []), /Which fixtures/);
});

test("fixture roles: from the fixture's channels, else from fader names (… Dim, … R)", () => {
  assert.equal(roleFromName("Front Par Dim"), "dimmer");
  assert.equal(roleFromName("Par 2 R"), "red");
  assert.equal(roleFromName("Wash Dimmer"), "dimmer");
  assert.equal(roleFromName("Fader 12"), null);
  const names = (f: number) => (f === 20 ? "Front Par Dim" : f === 21 ? "Front Par Pan" : "");
  assert.deepEqual([...fixtureRoles(par, names)], [["dimmer", [20]], ["pan", [21]]]);
  assert.deepEqual(fixtureRoles(ring1, names).get("zoom"), [8]);
});

test("fixtureLevels: dimmer in %, color mixed onto the emitters, missing channels reported", () => {
  const roles = fixtureRoles(ring1, () => "");
  const { cells, missing } = fixtureLevels(roles, { dimmer: 50, color: "#ff0000", pan: 128, channels: { uv: 10 } });
  assert.equal(cells.get(1), 128, "dimmer 50% → 128");
  assert.equal(cells.get(4), 255, "red");
  assert.equal(cells.get(5), 0, "green");
  assert.equal(cells.get(7), 0, "no white in pure red");
  assert.equal(cells.get(2), 128, "pan");
  assert.deepEqual(missing, ["uv"]);
  assert.throws(() => fixtureLevels(roles, { color: "red" }), /#rrggbb/);
  assert.throws(() => fixtureLevels(roles, { channels: { sparkle: 1 } }), /Unknown channel "sparkle"/);
  assert.throws(() => fixtureLevels(roles, { dimmer: 140 }), /dimmer must be 0–100/);
  // White light on red / green / blue / white: mostly the white emitter.
  const white = fixtureLevels(roles, { color: "#ffffff" }).cells;
  assert.equal(white.get(7), 255);
});

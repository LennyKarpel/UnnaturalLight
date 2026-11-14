import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChatRequest as parseWith, parseModel } from "../server/chat/chat.ts";
import { createAnthropicModel, MODELS, serverTools, toApiMessage, toApiTools } from "../server/chat/anthropic.ts";
import { findSong, TOOLS, toolByName } from "../page/chat/tools.ts";

const parseChatRequest = (body: unknown) => parseWith(body, MODELS);

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

test("chat model: the page may pick one of the provider's models, nothing else", () => {
  const tools = TOOLS.map(({ name, description, schema }) => ({ name, description, schema }));
  const messages = [{ role: "user", text: "GO" }];
  assert.equal(parseChatRequest({ messages, tools }).model, undefined);
  assert.equal(parseChatRequest({ messages, tools, model: "" }).model, undefined);
  assert.equal(parseChatRequest({ messages, tools, model: "claude-haiku-5-5" }).model, "claude-haiku-5-5");
  assert.throws(() => parseChatRequest({ messages, tools, model: "gpt-x" }), /Unknown chat model/);
  assert.throws(() => parseModel(42, MODELS), /Unknown chat model/);
});

test("Anthropic models: the default first; one from the environment joins the menu", () => {
  const plain = createAnthropicModel({});
  assert.equal(plain.defaultModel, "claude-opus-5-5");
  assert.deepEqual(plain.models.map((m) => m.id), MODELS.map((m) => m.id));
  assert.equal(plain.label("claude-sonnet-5-5"), "anthropic · claude-sonnet-5-5");
  const sonnet = createAnthropicModel({ model: "claude-sonnet-5-5" });
  assert.equal(sonnet.models[0].id, "claude-sonnet-5-5");
  assert.equal(sonnet.models.length, MODELS.length);
  const other = createAnthropicModel({ model: "claude-opus-5" });
  assert.equal(other.models[0].id, "claude-opus-5");
  assert.equal(other.models.length, MODELS.length + 1);
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
  assert.match(text, /^Summary of what came before: before\nOperator: play song 2\nAssistant used select_song \{"song":"2"}\nTool result: x+…\nAssistant: Song 2 is LIVE\.$/);
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

test("tool search: playback is always sent; the rest are deferred, found by Claude's tool search", () => {
  const core = TOOLS.filter((t) => !t.deferred).map((t) => t.name);
  assert.deepEqual(core, ["get_show", "select_song", "select_cue", "go", "control_transition", "set_levels"]);
  const api = (toApiTools(TOOLS) ?? []) as { name: string; defer_loading?: boolean }[];
  assert.equal(api[0].name, "tool_search_tool_bm25");
  assert.equal(api.length, TOOLS.length + 1);
  const placeRig = api.find((t) => t.name === "place_rig");
  assert.equal(placeRig?.defer_loading, true);
  // No deferred tools: no search tool.
  const plain = (toApiTools(TOOLS.filter((t) => !t.deferred)) ?? []) as { name: string }[];
  assert.ok(plain.every((t) => t.name !== "tool_search_tool_bm25" && !("defer_loading" in t)));
  assert.equal(toApiTools([]), undefined);
  // The page's `deferred` flag passes the request check.
  assert.doesNotThrow(() => parseChatRequest({ messages: [{ role: "user", text: "x" }], tools: [{ name: "a", description: "", schema: {}, deferred: true }] }));
});

test("stage tools: fixtures by name, rig name or \"selected\"; rigs and positions by name", () => {
  const calls: unknown[][] = [];
  const fixtures = [
    { id: "f1", name: "Spot L", rig: null, selected: true },
    { id: "f2", name: "Spot R", rig: null, selected: false },
    { id: "r1", name: "Ring 1 · 1", rig: "Ring 1", selected: false },
    { id: "r2", name: "Ring 1 · 2", rig: "Ring 1", selected: false },
  ];
  const fake = {
    stage: () => ({ box: { w: 12, d: 8, h: 6 }, rigs: [{ id: "rig1", name: "Ring 1" }], fixtures, positions: [{ id: "p1", name: "DSC", x: 0, y: 0, z: 3 }, { id: "p2", name: "Drum riser", x: 0, y: 0.6, z: -2 }] }),
    aimFixtures: (ids: string[], at: unknown) => { calls.push(["aim", ids, at]); return {}; },
    aimAtPosition: (ids: string[], id: string) => { calls.push(["follow", ids, id]); return {}; },
    stopFollowing: (ids: string[]) => { calls.push(["unfollow", ids]); return []; },
    deleteFixtures: (ids: string[]) => { calls.push(["delete", ids]); return []; },
    editRig: (id: string, fields: unknown) => { calls.push(["rig", id, fields]); return {}; },
  };
  (globalThis as { window?: unknown }).window = { stageChat: fake };
  try {
    const run = (name: string, args: Record<string, unknown>) => toolByName.get(name)!.run(args);
    run("aim_fixtures", { fixtures: ["Ring 1"], at: { x: 0, y: 0, z: 0 } });
    run("aim_fixtures", { fixtures: ["selected", "spot r"], home: true });
    run("delete_fixtures", { fixtures: ["all"] });
    run("edit_rig", { rig: "ring", center: { y: 5 } });
    run("aim_fixtures", { fixtures: ["Ring 1"], position: "drum" });
    run("stop_following", { fixtures: ["selected"] });
    assert.deepEqual(calls, [
      ["aim", ["r1", "r2"], { x: 0, y: 0, z: 0 }],
      ["aim", ["f1", "f2"], null],
      ["delete", ["f1", "f2", "r1", "r2"]],
      ["rig", "rig1", { y: 5 }],
      ["follow", ["r1", "r2"], "p2"],
      ["unfollow", ["f1"]],
    ]);
    assert.throws(() => run("aim_fixtures", { fixtures: ["Spot L"], position: "lectern" }), /No position "lectern" \(positions: DSC, Drum riser\)/);
    assert.throws(() => run("aim_fixtures", { fixtures: ["Spot L"], position: "DSC", home: true }), /Give one of/);
    assert.throws(() => run("aim_fixtures", { fixtures: ["Spot"], home: true }), /matches "Spot L", "Spot R"/);
    assert.throws(() => run("aim_fixtures", { fixtures: ["Spot L"] }), /Give one of/);
    assert.throws(() => run("move_fixtures", { fixtures: ["Spot L"], to: { x: 1 }, by: { x: 1 } }), /either to or by/);
    assert.throws(() => run("edit_rig", { rig: "Line" }), /No rig "Line" \(rigs: Ring 1\)/);
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});

test("stage tools: risers by name; sizes and center passed through in meters", () => {
  const calls: unknown[][] = [];
  const fake = {
    stage: () => ({ box: { w: 12, d: 8, h: 6 }, rigs: [], fixtures: [], positions: [], risers: [{ id: "k1", name: "Drum riser", x: 0, z: -2, width: 2.4, depth: 2.4, height: 0.6, yaw: 0 }, { id: "k2", name: "Keys riser", x: 3, z: -2, width: 2.4, depth: 1.2, height: 0.4, yaw: 0 }] }),
    addRiser: (cfg: unknown) => { calls.push(["add", cfg]); return {}; },
    editRiser: (id: string, change: unknown) => { calls.push(["edit", id, change]); return {}; },
    deleteRiser: (id: string) => { calls.push(["delete", id]); return ""; },
  };
  (globalThis as { window?: unknown }).window = { stageChat: fake };
  try {
    const run = (name: string, args: Record<string, unknown>) => toolByName.get(name)!.run(args);
    run("add_riser", { name: "Vocal riser", center: { x: 0, z: 1 }, height: 0.2 });
    run("edit_riser", { riser: "drum", center: { z: -3 }, yaw: 45 });
    run("delete_riser", { riser: "Keys riser" });
    assert.deepEqual(calls, [
      ["add", { name: "Vocal riser", x: 0, z: 1, height: 0.2 }],
      ["edit", "k1", { z: -3, yaw: 45 }],
      ["delete", "k2"],
    ]);
    assert.throws(() => run("edit_riser", { riser: "riser", height: 1 }), /matches "Drum riser", "Keys riser"/);
    assert.throws(() => run("edit_riser", { riser: "Drum riser" }), /Nothing to change/);
    assert.throws(() => run("delete_riser", { riser: "lectern" }), /No riser "lectern" \(risers: Drum riser, Keys riser\)/);
    assert.throws(() => run("add_riser", { center: { x: 0 } }), /center z must be a number/);
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});

test("Anthropic adapter: tool searches are read out of a reply (what was looked for, what was found)", () => {
  const content = [
    { type: "server_tool_use", id: "s1", name: "tool_search_tool_bm25", input: { query: "risers" } },
    { type: "tool_search_tool_result", tool_use_id: "s1", content: { type: "tool_search_tool_search_result", tool_references: [{ type: "tool_reference", tool_name: "add_riser" }, { type: "tool_reference", tool_name: "list_risers" }] } },
    { type: "server_tool_use", id: "s2", name: "tool_search_tool_bm25", input: { query: "zzz" } },
    { type: "tool_search_tool_result", tool_use_id: "s2", content: { type: "tool_search_tool_search_result", tool_references: [] } },
    { type: "text", text: "Done", citations: null },
  ] as unknown as Parameters<typeof serverTools>[0];
  assert.deepEqual(serverTools(content), [
    { name: "tool_search_tool_bm25", input: "risers", result: "add_riser, list_risers" },
    { name: "tool_search_tool_bm25", input: "zzz", result: "nothing found" },
  ]);
});

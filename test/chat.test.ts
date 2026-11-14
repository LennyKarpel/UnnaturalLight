import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChatRequest as parseWith, parseModel } from "../server/chat/chat.ts";
import { createAnthropicModel, MODELS, serverTools, toApiMessage, toApiTools } from "../server/chat/anthropic.ts";
import { TOOLS, toolByName } from "../page/chat/tools.ts";
import { findSong } from "../page/chat/find.ts";
import type { ConsoleChat } from "../console/chat-hooks.ts";
import type { StageChat } from "../stage/chat-hooks.ts";

/** Any part of a T (all the way down). */
type Loose<T> = T extends (infer U)[] ? Loose<U>[] : T extends object ? { [K in keyof T]?: Loose<T[K]> } : T;
/**
 * A stand-in for the chat's hooks: any of their methods, type-checked against
 * the real ones (their arguments), returning any part of what they return.
 */
type Fake<T> = { [K in keyof T]?: T[K] extends (...a: infer A) => infer R ? (...a: A) => R extends Promise<infer P> ? Promise<Loose<P>> : Loose<R> : never };

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

import { findFixtures } from "../page/chat/find.ts";
import { fixtureLevels, fixtureRoles, roleFromName, type FixtureInfo } from "../page/chat/tools/fixtures.ts";

const fx = (name: string, group: string | null, roles: (string | null)[], firstFader: number): FixtureInfo => ({
  id: name,
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
  const fake: Fake<StageChat> = {
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
  const fake: Fake<StageChat> = {
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

test("set tools: sets by number or name (default: the running one); songs by number or name; places 1-based", () => {
  const calls: unknown[][] = [];
  const songs = [{ id: "a", name: "Intro", cues: 2 }, { id: "b", name: "Ballad", cues: 2 }, { id: "c", name: "Encore", cues: 2 }];
  const sets = [
    { id: "s1", name: "Friday", running: false, songs: [{ id: "a", name: "Intro" }, { id: "b", name: "Ballad" }, { id: "a", name: "Intro" }] },
    { id: "s2", name: "Saturday", running: true, songs: [{ id: "c", name: "Encore" }] },
  ];
  const fake: Fake<ConsoleChat> = {
    songs: () => songs,
    sets: () => sets,
    show: () => ({ playing: {} }),
    addToSet: (...a) => calls.push(["add", ...a]),
    removeFromSet: (...a) => calls.push(["remove", ...a]),
    moveInSet: (...a) => calls.push(["move", ...a]),
    runSet: (...a) => calls.push(["run", ...a]),
    newSet: (...a) => { calls.push(["new", ...a]); return "s1"; },
    moveSong: (...a) => calls.push(["moveSong", ...a]),
  };
  (globalThis as { window?: unknown }).window = { consoleChat: fake };
  try {
    const run = (name: string, args: Record<string, unknown>) => toolByName.get(name)!.run(args);
    run("add_to_set", { songs: ["3", "ballad"] });
    run("add_to_set", { songs: ["Intro"], set: "fri", position: 2 });
    run("remove_from_set", { set: "1", song: "Ballad" });
    run("move_in_set", { set: "Friday", from: 3, to: 1 });
    run("run_set", { set: "2", from: 1 });
    run("new_set", { name: "Sunday", songs: ["1", "Encore"] });
    run("move_song", { song: "Encore", to: 1 });
    assert.deepEqual(calls, [
      ["add", "s2", ["c", "b"], undefined],
      ["add", "s1", ["a"], 1],
      ["remove", "s1", 1],
      ["move", "s1", 2, 0],
      ["run", "s2", 0],
      ["new", "Sunday", ["a", "c"]],
      ["moveSong", "c", 0],
    ]);
    assert.throws(() => run("remove_from_set", { set: "Friday", song: "Intro" }), /in "Friday" 2 times \(at 1, 3\): give the position/);
    assert.throws(() => run("remove_from_set", { song: "Intro" }), /"Intro" isn't in "Saturday"/);
    assert.throws(() => run("remove_from_set", {}), /either position or song/);
    assert.throws(() => run("move_in_set", { from: 1, to: 2 }), /to must be 1–1/);
    assert.throws(() => run("add_to_set", { songs: ["Intro"], set: "Sunday" }), /No set "Sunday" \(sets: Friday, Saturday\)/);
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});

test("step, cue, patch, fixture and output tools: what they pass to the console", async () => {
  const calls: unknown[][] = [];
  const blank = () => Array(256).fill(0);
  const own = blank();
  own[0] = 200;
  own[5] = 50;
  const step1 = blank();
  step1[1] = 99;
  const cues = [
    { name: "", fadeSeconds: 4, levels: own, aims: [], steps: [{ fadeSeconds: 2, holdSeconds: 0, levels: step1, aims: [] }] },
    { name: "", fadeSeconds: 4, levels: blank(), aims: [], steps: [] },
  ];
  const fixtures = [
    { id: "p1", name: "Par 1", group: "Pars", channels: [{ channel: 1, role: "dimmer" as const, faders: [1] }] },
    { id: "p2", name: "Par 2", group: "Pars", channels: [{ channel: 2, role: "dimmer" as const, faders: [6] }] },
  ];
  const fake: Fake<ConsoleChat> = {
    songs: () => [{ id: "s", name: "Song", cues: 2 }],
    show: () => ({ playing: { song: { number: 1 }, live: { cue: 2 } }, songs: [{ cues: [{ number: 1, name: "" }, { number: 2, name: "" }] }] }),
    cue: (_: unknown, i: number) => cues[i],
    fixtures: () => fixtures,
    setCueLevels: (...a) => calls.push(["levels", a[1], (a[2] as [number, number][]).filter(([, v]) => v), a[3]]),
    addStep: (...a) => { calls.push(["addStep", ...a.slice(1)]); return 0; },
    editStep: (...a) => { calls.push(["editStep", ...a.slice(1)]); return {}; },
    moveCue: (...a) => calls.push(["moveCue", ...a.slice(1)]),
    patchFader: (...a) => { calls.push(["patch", ...a]); return {}; },
    addFixtures: (o: unknown) => { calls.push(["addFixtures", o]); return [{ name: "Mover" }]; },
    deleteFixtures: (ids: unknown) => calls.push(["deleteFixtures", ids]),
    outputs: () => ({ universes: 2, maxUniverses: 4, outputs: [{ universe: 1 }, { universe: 2 }] }),
    usbPro: async (...a) => { calls.push(["usb", ...a]); },
    network: async (...a) => { calls.push(["net", ...a]); },
  };
  (globalThis as { window?: unknown }).window = { consoleChat: fake, stageChat: { consoleIds: () => ["p2"] } };
  try {
    const run = (name: string, args: Record<string, unknown>) => toolByName.get(name)!.run(args);
    // Into the LIVE cue (2) from cue 1: all of it, then only Par 2's fader, then from its step 1 into a step.
    run("copy_levels", { from_cue: 1 });
    run("copy_levels", { from_cue: 1, fixtures: ["Par 2"] });
    run("copy_levels", { from_cue: 1, from_step: 1, cue: 1, step: 1 });
    run("add_step", { cue: 1, after: 0, copy_of: 1, hold_seconds: 3 });
    run("edit_step", { cue: 1, step: 1, fade_seconds: 6 });
    run("move_cue", { cue: 2, to: 1 });
    run("patch_fader", { fader: 3, channels: ["2/45"], name: "Haze" });
    run("add_fixtures", { name: "Mover", channels: 3, quantity: 2, roles: ["pan", "tilt", "other"] });
    run("delete_console_fixtures", { fixtures: ["Par 1"] });
    await run("set_output", { universe: 2, usb_pro: true, network: "artnet", host: "10.0.0.5" });
    await run("set_output", { network: "off" });
    assert.deepEqual(calls, [
      ["levels", 1, [[0, 200], [5, 50]], undefined],
      ["levels", 1, [[5, 50]], undefined],
      ["levels", 0, [[1, 99]], 0],
      ["addStep", 0, { at: 0, copyOf: 0, fadeSeconds: undefined, holdSeconds: 3 }],
      ["editStep", 0, 0, { fadeSeconds: 6, holdSeconds: undefined }],
      ["moveCue", 1, 0],
      ["patch", 2, { channels: [{ address: "2/45", max: undefined }], name: "Haze" }],
      ["addFixtures", { name: "Mover", channels: 3, qty: 2, roles: ["pan", "tilt", null], group: null, universe: null, mount: "movable", color: "single" }],
      ["deleteFixtures", ["p1"]],
      ["usb", 2, true],
      ["net", 2, { protocol: "artnet", host: "10.0.0.5" }],
      ["net", 1, null],
    ]);
    assert.throws(() => run("get_cue", { cue: 2, step: 1 }), /Cue 2 has no steps/);
    assert.throws(() => run("edit_step", { cue: 1, step: 2, hold_seconds: 1 }), /step must be 1–1/);
    assert.throws(() => run("delete_console_fixtures", { fixtures: ["Pars"] }), /On the stage \(delete them there with delete_fixtures\): Par 2/);
    assert.throws(() => run("add_fixtures", { name: "X", channels: 1, roles: ["dimmer", "red"] }), /2 roles for 1 channels/);
    assert.throws(() => run("add_fixtures", { name: "X", channels: 1, roles: ["laser"] }), /"laser" isn't a channel role/);
    await assert.rejects(async () => run("set_output", { universe: 3, network: "sacn" }), /universe must be 1–2/);
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});

test("library, link, step, submaster, fixture, group and show tools: what they pass on", async () => {
  const calls: unknown[][] = [];
  const profile = { model: "Spot 7" };
  const stageFake: Fake<StageChat> = {
    stage: () => ({ fixtures: [
      { id: "a", name: "Spot 7 1", rig: null, selected: false, console: null },
      { id: "b", name: "Spot 7 2", rig: null, selected: false, console: null },
    ] }),
    manufacturers: async (q: string) => [{ key: "acme", name: "Acme" }, { key: "acme-pro", name: "Acme Pro" }].filter((m) => m.name.toLowerCase().includes(q.toLowerCase())),
    libraryFixtures: async () => [{ key: "spot-7", name: "Spot 7" }, { key: "spot-70", name: "Spot 70" }],
    libraryModes: async () => [
      { index: 0, name: "Basic", channels: 8, ok: true, reason: "" },
      { index: 1, name: "Extended", channels: 16, ok: true, reason: "" },
      { index: 2, name: "Pixel", channels: 40, ok: false, reason: "pixel / matrix mode (not supported)" },
    ],
    libraryProfile: async (m: { key: string }, f: string, i: number) => { calls.push(["profile", m.key, f, i]); return profile; },
    addFixtures: (points: unknown[], type: string, p: unknown) => { calls.push(["place", points.length, type, p]); return []; },
    linkToConsole: (ids: string[], id: string) => { calls.push(["link", ids, id]); return ids.length; },
    linkManual: (ids: string[], start: number, layout: unknown) => calls.push(["manual", ids, start, layout]),
    register: (...a) => calls.push(["register", ...a]),
    unlink: (ids: string[]) => calls.push(["unlink", ids]),
    parseAddress: (t: string) => (t === "2/1" ? 513 : null),
  };
  const consoleFake: Fake<ConsoleChat> = {
    fixtures: () => [{ id: "c1", name: "Wash 1", group: "Washes", channels: [] }, { id: "c2", name: "Wash 2", group: "Washes", channels: [] }],
    show: () => ({ serverConnected: true, playing: {}, master: 100, crossfader: 0, submasters: { live: 50, upNext: 100 }, showName: "Tour" }),
    step: (back: boolean) => { calls.push(["step", back]); return true; },
    setSubmasters: (...a) => calls.push(["subs", ...a]),
    editFixture: (...a) => { calls.push(["editFixture", ...a]); return {}; },
    renameGroup: (...a) => { calls.push(["renameGroup", ...a]); return a[1]; },
    renameShow: (n: string) => { calls.push(["renameShow", n]); return n; },
    saveShow: async () => { calls.push(["save"]); return true; },
  };
  (globalThis as { window?: unknown }).window = { stageChat: stageFake, consoleChat: consoleFake };
  try {
    const run = (name: string, args: Record<string, unknown>) => toolByName.get(name)!.run(args);
    await run("place_fixtures", { fixtures: [{ x: 0, y: 5, z: 0 }], library: { manufacturer: "acme", model: "Spot 7", mode: "16" } });
    await run("place_fixtures", { fixtures: [{ x: 0, y: 5, z: 0 }], library: { manufacturer: "Acme", model: "spot-7", mode: "basic" } });
    await assert.rejects(async () => run("place_fixtures", { fixtures: [{ x: 0, y: 5, z: 0 }], library: { manufacturer: "Acme", model: "Spot 7" } }), /Which mode of Spot 7\? Basic \(8 ch\), Extended \(16 ch\), Pixel \(40 ch: pixel/);
    await assert.rejects(async () => run("place_fixtures", { fixtures: [{ x: 0, y: 5, z: 0 }], library: { manufacturer: "Acme", model: "Spot", mode: "8" } }), /"Spot" matches 2 Acme fixtures \(Spot 7, Spot 70\)/);
    await assert.rejects(async () => run("place_fixtures", { fixtures: [{ x: 0, y: 5, z: 0 }], library: { manufacturer: "Acme", model: "Spot 7", mode: "pixel" } }), /can't be used: pixel/);
    assert.deepEqual(await run("find_library_fixtures", { manufacturer: "acm" }), { manufacturers: ["Acme", "Acme Pro"] });
    assert.deepEqual(((await run("find_library_fixtures", { manufacturer: "Acme", model: "spot 7" })) as { modes: unknown[] }).modes.length, 3);
    run("link_fixtures", { fixtures: ["Spot 7 1", "Spot 7 2"], console_fixture: "Wash 1" });
    run("link_fixtures", { fixtures: ["Spot 7 1"], address: "2/1", layout: ["dimmer", "other"] });
    run("link_fixtures", { fixtures: ["Spot 7 2"], register: "fixed/single", universe: 2 });
    run("link_fixtures", { fixtures: ["Spot 7 2"], unlink: true });
    run("go", { step: "back" });
    run("set_levels", { live_submaster: 50 });
    run("edit_fixture", { fixture: "Wash 2", start: "100", mount: "movable" });
    run("edit_group", { group: "Washes", name: "Floor" });
    await run("save_show", { name: "Friday" });
    assert.deepEqual(calls, [
      ["profile", "acme", "spot-7", 1],
      ["place", 1, "movable/multi", profile],
      ["profile", "acme", "spot-7", 0],
      ["place", 1, "movable/multi", profile],
      ["link", ["a", "b"], "c1"],
      ["manual", ["a"], 513, ["dimmer", null]],
      ["register", ["b"], "fixed/single", 2],
      ["unlink", ["b"]],
      ["step", true],
      ["subs", 50, undefined],
      ["editFixture", "c2", { name: undefined, group: undefined, start: "100", channels: undefined, mount: "movable", color: undefined }],
      ["renameGroup", "Washes", "Floor"],
      ["renameShow", "Friday"],
      ["save"],
    ]);
    assert.throws(() => run("link_fixtures", { fixtures: ["Spot 7 1"], unlink: true, address: "1" }), /exactly one of/);
    assert.throws(() => run("link_fixtures", { fixtures: ["Spot 7 1"], address: "9/1" }), /"9\/1" isn't a DMX address/);
    assert.throws(() => run("link_fixtures", { fixtures: ["Spot 7 1"], console_fixture: "Washes" }), /is a group/);
    assert.throws(() => run("edit_group", { group: "Washes" }), /either a new name or delete/);
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

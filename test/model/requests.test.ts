// Real requests to the real chat model, checking it picks the right tools
// with the right arguments: npm run test:model. Each case is a few model
// calls, so a run costs a little; `npm test` leaves these out. Skipped
// without ANTHROPIC_API_KEY. The model, provider and effort come from the
// same environment as the show server's (server/chat/model.ts).
//
// The tools run for real (page/chat/tools.ts), against a small fake show
// that keeps what the cases change (sets, song order, cue times, the show's
// name) so the model sees its edits land, as it would in the app. Every
// other edit is only recorded. A case checks the show afterwards and that
// nothing else was edited.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { pickModel } from "../../server/chat/model.ts";
import { SYSTEM_PROMPT } from "../../server/chat/chat.ts";
import { TOOLS, toolByName } from "../../page/chat/tools.ts";
import type { ChatMessage, ChatToolResult } from "../../shared/chat-protocol.ts";
import { errorMessage } from "../../shared/guards.ts";

/** Most model calls in one case (the panel allows 12). */
const MAX_STEPS = 8;

type Call = { hook: string; args: unknown[] };

/** The hooks that only read: never counted as edits. */
const READS = new Set(["show", "songs", "sets", "cue", "faders", "fixtures", "groups", "outputs", "stage", "consoleIds", "manufacturers", "libraryFixtures", "libraryModes"]);

function fakeShow() {
  const calls: Call[] = [];
  const blank = () => ({ name: "", fadeSeconds: 3, levels: Array(256).fill(0), aims: [], steps: [] as { fadeSeconds: number; holdSeconds: number; levels: number[]; aims: [] }[] });
  const show = {
    name: "Spring tour",
    songs: [
      { id: "s1", name: "Intro", cues: [blank(), blank(), blank()] },
      { id: "s2", name: "Yellow", cues: [blank(), blank(), blank(), blank()] },
      { id: "s3", name: "Encore", cues: [blank(), blank()] },
    ],
    sets: [{ id: "t1", name: "Friday", songs: ["s1"] }],
    running: "t1",
    live: 0,
    submasters: { live: 100, upNext: 100 },
  };
  const song = (id: string | null) => show.songs.find((s) => s.id === (id ?? "s1")) ?? assert.fail(`no song ${id}`);
  const set = (id: string | null) => show.sets.find((s) => s.id === (id ?? show.running)) ?? assert.fail(`no set ${id}`);
  const songName = (id: string) => song(id).name;

  const consoleHooks = {
    show: () => ({
      showName: show.name,
      serverConnected: true,
      playing: { song: { number: 1, name: "Intro" }, live: { cue: show.live + 1, label: `Cue ${show.live + 1}` }, upNext: { label: `Cue ${show.live + 2}`, fadeSeconds: 3 }, transition: "none" },
      master: 100,
      submasters: show.submasters,
      crossfader: 0,
      activeSet: { name: set(null).name, songs: set(null).songs.map(songName) },
      songs: show.songs.map((s, i) => ({ number: i + 1, name: s.name, cues: s.cues.map((c, j) => ({ number: j + 1, name: c.name, fadeSeconds: c.fadeSeconds })) })),
    }),
    songs: () => show.songs.map((s) => ({ id: s.id, name: s.name, cues: s.cues.length })),
    resetPatch: (clear: boolean) => (clear ? 0 : 256),
    sets: () => show.sets.map((s) => ({ id: s.id, name: s.name, running: s.id === show.running, songs: s.songs.map((id) => ({ id, name: songName(id) })) })),
    cue: (id: string | null, i: number) => song(id).cues[i] ?? assert.fail(`no cue ${i}`),
    faders: () => Array.from({ length: 256 }, (_, i) => ({ fader: i + 1, name: `${i + 1}`, patched: i < 24 })),
    fixtures: () => [],
    groups: () => [],
    go: () => {
      show.live++;
      return true;
    },
    renameShow: (name: string) => (show.name = name),
    setSubmasters: (live?: number, upNext?: number) => {
      if (live != null) show.submasters.live = live;
      if (upNext != null) show.submasters.upNext = upNext;
    },
    editCue: (id: string | null, i: number, opts: { name?: string; fadeSeconds?: number }) => {
      const c = song(id).cues[i] ?? assert.fail(`no cue ${i}`);
      if (opts.name != null) c.name = opts.name;
      if (opts.fadeSeconds != null) c.fadeSeconds = opts.fadeSeconds;
      return { name: c.name, fadeSeconds: c.fadeSeconds };
    },
    addStep: (id: string | null, i: number, opts: { at?: number; fadeSeconds?: number; holdSeconds?: number }) => {
      const c = song(id).cues[i] ?? assert.fail(`no cue ${i}`);
      const at = opts.at ?? c.steps.length;
      c.steps.splice(at, 0, { fadeSeconds: opts.fadeSeconds ?? c.fadeSeconds, holdSeconds: opts.holdSeconds ?? 0, levels: [...c.levels], aims: [] });
      return at;
    },
    moveSong: (id: string, to: number) => {
      const s = song(id);
      show.songs.splice(show.songs.indexOf(s), 1);
      show.songs.splice(to, 0, s);
    },
    addToSet: (id: string | null, songIds: string[], index?: number) => set(id).songs.splice(index ?? set(id).songs.length, 0, ...songIds),
    newSet: (name: string, songIds: string[]) => {
      const id = `t${show.sets.length + 1}`;
      show.sets.push({ id, name, songs: [...songIds] });
      return id;
    },
  };
  const placed: { x: number; y: number; z: number }[][] = [];
  /** The stage: empty unless a case sets it up (ask's `setup`). Risers and positions are kept; aims are recorded on the fixtures. */
  const stageState = {
    trusses: [] as { id: string; name: string; type: string; x: number; y: number; z: number; size: number; count: number }[],
    fixtures: [] as { id: string; name: string; x: number; y: number; z: number; truss: string | null; aimedAt?: { x: number; y: number; z: number } | string }[],
    positions: [] as { id: string; name: string; x: number; y: number; z: number }[],
    risers: [] as { id: string; name: string; x: number; z: number; width: number; depth: number; height: number; yaw: number }[],
  };
  const fixture = (id: string) => stageState.fixtures.find((f) => f.id === id) ?? assert.fail(`no fixture ${id}`);
  const aimed = (ids: string[]) => ({ aimed: ids.map((id) => ({ name: fixture(id).name, pan: 0, tilt: 30 })), outOfRange: [] });
  const stage = {
    stage: () => ({
      box: { w: 12, d: 8, h: 6 },
      trusses: stageState.trusses,
      fixtures: stageState.fixtures.map(({ aimedAt: _, ...f }) => ({ ...f, pan: 0, tilt: 0, console: f.name, selected: false, following: null })),
      positions: stageState.positions,
      risers: stageState.risers,
      maxFixtures: 200,
      units: "m",
    }),
    addRiser: (cfg: { name?: string | undefined; x: number; z: number; width?: number; depth?: number; height?: number; yaw?: number }) => {
      const riser = { id: `k${stageState.risers.length + 1}`, name: cfg.name ?? `Riser ${stageState.risers.length + 1}`, x: cfg.x, z: cfg.z, width: cfg.width ?? 2.4, depth: cfg.depth ?? 1.2, height: cfg.height ?? 0.4, yaw: cfg.yaw ?? 0 };
      stageState.risers.push(riser);
      return riser;
    },
    addPosition: (name: string, at: { x: number; y: number; z: number }) => {
      const position = { id: `p${stageState.positions.length + 1}`, name, ...at };
      stageState.positions.push(position);
      return { name, ...at };
    },
    aimAtPosition: (ids: string[], positionId: string) => {
      for (const id of ids) fixture(id).aimedAt = positionId;
      return aimed(ids);
    },
    setValues: (ids: string[]) => ids.map((id) => ({ name: fixture(id).name })),
    editSettings: (ids: string[]) => ({ fixtures: ids.map((id) => ({ name: fixture(id).name })) }),
    duplicateFixtures: (ids: string[]) => ({ copies: ids.map((id) => `${fixture(id).name} copy`) }),
    select: (ids: string[]) => ids.map((id) => fixture(id).name),
    aimFixtures: (ids: string[], at: { x: number; y: number; z: number } | null) => {
      for (const id of ids) fixture(id).aimedAt = at ?? "home";
      return aimed(ids);
    },
    addFixtures: (points: { x: number; y: number; z: number }[]) => {
      placed.push(points);
      return points.map((p, i) => ({ name: `Fixture ${i + 1}`, ...p }));
    },
    addTruss: (truss: { type: string; count: number }) => ({ name: "Line 1", fixtures: Array.from({ length: truss.count }, (_, i) => `Line 1 · ${i + 1}`) }),
  };
  /** Every hook call is recorded; a hook the fake doesn't have is recorded and does nothing. */
  const recorded = <T extends object>(hooks: T) =>
    new Proxy(hooks, {
      get(target, key) {
        if (typeof key !== "string") return undefined;
        const own = (target as Record<string, unknown>)[key];
        return (...args: unknown[]) => {
          calls.push({ hook: key, args });
          return typeof own === "function" ? own(...args) : undefined;
        };
      },
    });
  return { show, stageState, calls, placed, window: { consoleChat: recorded(consoleHooks), stageChat: recorded(stage) } };
}

/** Send `prompt` (after `setup` changes the fake show), run the tools the model calls against a fake show, until it answers. */
async function ask(prompt: string, setup?: (world: ReturnType<typeof fakeShow>) => void) {
  const world = fakeShow();
  setup?.(world);
  (globalThis as { window?: unknown }).window = world.window;
  const model = pickModel();
  const tools = TOOLS.map(({ name, description, schema, deferred }) => ({ name, description, schema, deferred }));
  const history: ChatMessage[] = [{ role: "user", text: prompt }];
  const used: string[] = [];
  try {
    for (let step = 0; ; step++) {
      if (step >= MAX_STEPS) assert.fail(`no answer after ${MAX_STEPS} model calls (tools: ${used.join(", ")})`);
      const reply = await model.reply({ system: SYSTEM_PROMPT, messages: history, tools, onText: () => {}, signal: AbortSignal.timeout(120_000) });
      history.push(reply);
      if (!reply.toolCalls.length) break;
      const results: ChatToolResult[] = [];
      for (const call of reply.toolCalls) {
        used.push(call.name);
        const def = toolByName.get(call.name);
        if (!def) {
          results.push({ id: call.id, result: `No tool called ${call.name}`, error: true });
          continue;
        }
        try {
          const value = await def.run(call.args);
          results.push({ id: call.id, result: value === undefined ? "done" : typeof value === "string" ? value : JSON.stringify(value) });
        } catch (err) {
          results.push({ id: call.id, result: errorMessage(err, "Failed"), error: true });
        }
      }
      history.push({ role: "tool", results });
    }
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
  const edits = [...new Set(world.calls.filter((c) => !READS.has(c.hook)).map((c) => c.hook))];
  return { ...world, edits, used };
}

describe("the chat model picks the right tools", { skip: process.env.ANTHROPIC_API_KEY ? false : "no ANTHROPIC_API_KEY" }, () => {
  test("adds songs to a named set, in order", async () => {
    const r = await ask("Put Yellow and Encore at the end of the Friday set.");
    assert.deepEqual(r.show.sets[0].songs, ["s1", "s2", "s3"]);
    assert.deepEqual(r.edits, ["addToSet"]);
  });

  test("makes a set with songs in it", async () => {
    const r = await ask("Make a new set called Saturday with Intro, then Encore.");
    assert.deepEqual(r.show.sets.find((s) => s.name === "Saturday")?.songs, ["s1", "s3"]);
    assert.deepEqual(r.edits.filter((e) => e !== "addToSet"), ["newSet"]);
  });

  test("sets a cue's fade time in another song", async () => {
    const r = await ask("Make cue 3 of Yellow fade in over 5 seconds.");
    assert.equal(r.show.songs.find((s) => s.id === "s2")?.cues[2].fadeSeconds, 5);
    assert.deepEqual(r.edits, ["editCue"]);
  });

  test("adds a step with a hold", async () => {
    const r = await ask("In Intro, add a step to cue 2 that holds for 3 seconds.");
    const steps = r.show.songs.find((s) => s.id === "s1")?.cues[1].steps;
    assert.equal(steps?.length, 1);
    assert.equal(steps?.[0].holdSeconds, 3);
    assert.deepEqual(r.edits, ["addStep"]);
  });

  test("moves a song in the show", async () => {
    const r = await ask("Move Encore to the top of the show.");
    assert.deepEqual(r.show.songs.map((s) => s.id), ["s3", "s1", "s2"]);
    assert.deepEqual(r.edits, ["moveSong"]);
  });

  test("GO is GO, once", async () => {
    const r = await ask("go");
    assert.deepEqual(r.calls.filter((c) => c.hook === "go").length, 1);
    assert.deepEqual(r.edits, ["go"]);
  });

  test("sets a submaster", async () => {
    const r = await ask("Bring the LIVE submaster down to half.");
    assert.equal(r.show.submasters.live, 50);
    assert.equal(r.show.submasters.upNext, 100);
    assert.deepEqual(r.edits, ["setSubmasters"]);
  });

  test("renames the show", async () => {
    const r = await ask("Rename the show to Summer Tour.");
    assert.equal(r.show.name, "Summer Tour");
    assert.deepEqual(r.edits, ["renameShow"]);
  });

  test("hangs a line of fixtures over the front of the stage (as single fixtures or a line truss)", async () => {
    const r = await ask("Hang 4 lights in a line across the front of the stage, 5 meters up.");
    const truss = r.calls.find((c) => c.hook === "addTruss")?.args[0] as { type: string; x: number; y: number; z: number; count: number } | undefined;
    if (truss) {
      assert.deepEqual([truss.type, truss.count, truss.y], ["line", 4, 5]);
      assert.ok(truss.z > 0, `downstage (z > 0): ${JSON.stringify(truss)}`);
      assert.deepEqual(r.edits, ["addTruss"]);
      return;
    }
    const points = r.placed.flat();
    assert.equal(points.length, 4, `tools used: ${r.used.join(", ")}`);
    for (const p of points) {
      assert.equal(p.y, 5);
      assert.ok(p.z > 0, `downstage (z > 0): ${JSON.stringify(p)}`);
    }
    assert.equal(new Set(points.map((p) => p.x)).size, 4, "spread across the stage");
    assert.deepEqual(r.edits, ["addFixtures"]);
  });

  test("puts a riser where it's asked, the size it's asked", async () => {
    const r = await ask("Add a drum riser upstage center, 8 by 8 feet and 2 feet high.");
    assert.equal(r.stageState.risers.length, 1, `tools used: ${r.used.join(", ")}`);
    const k = r.stageState.risers[0];
    assert.match(k.name, /drum/i);
    assert.ok(Math.abs(k.x) < 0.5 && k.z < 0, `upstage center: ${JSON.stringify(k)}`);
    for (const [v, want] of [[k.width, 2.44], [k.depth, 2.44], [k.height, 0.61]]) assert.ok(Math.abs(v - want) < 0.05, `size in meters: ${JSON.stringify(k)}`);
    assert.deepEqual(r.edits, ["addRiser"]);
  });

  test("aims a truss at a riser (the riser's top: a named position there, or the spot)", async () => {
    const r = await ask("Aim the ring at the drum riser.", ({ stageState }) => {
      stageState.risers.push({ id: "k1", name: "Drum riser", x: 1, z: -2, width: 2.4, depth: 2.4, height: 0.6, yaw: 0 });
      stageState.trusses.push({ id: "truss1", name: "Ring 1", type: "ring", x: 0, y: 5, z: 0, size: 3, count: 6 });
      for (let i = 1; i <= 6; i++) stageState.fixtures.push({ id: `r${i}`, name: `Ring 1 · ${i}`, x: 0, y: 5, z: 0, truss: "Ring 1" });
      stageState.fixtures.push({ id: "f1", name: "Spot L", x: -4, y: 5, z: 2, truss: null });
    });
    const targets = r.stageState.fixtures.map((f) => (typeof f.aimedAt === "string" ? r.stageState.positions.find((p) => p.id === f.aimedAt) ?? f.aimedAt : f.aimedAt));
    assert.equal(targets.at(-1), undefined, "Spot L isn't in the ring: left alone");
    for (const t of targets.slice(0, 6)) {
      assert.ok(t && typeof t === "object", `every ring fixture aimed (tools used: ${r.used.join(", ")})`);
      assert.ok(Math.abs(t.x - 1) < 0.6 && Math.abs(t.z + 2) < 0.6 && t.y >= 0.6 && t.y < 2.5, `at the riser's top: ${JSON.stringify(t)}`);
    }
    assert.ok(r.edits.every((e) => e === "addPosition" || e === "aimAtPosition" || e === "aimFixtures"), `only aims: ${r.edits.join(", ")}`);
  });

  /** Two spots and a 6-fixture ring. */
  const withTruss = ({ stageState }: ReturnType<typeof fakeShow>) => {
    stageState.trusses.push({ id: "truss1", name: "Ring 1", type: "ring", x: 0, y: 5, z: 0, size: 3, count: 6 });
    for (let i = 1; i <= 6; i++) stageState.fixtures.push({ id: `r${i}`, name: `Ring 1 · ${i}`, x: 0, y: 5, z: 0, truss: "Ring 1" });
    stageState.fixtures.push({ id: "sl", name: "Spot L", x: -4, y: 5, z: 2, truss: null }, { id: "sr", name: "Spot R", x: 4, y: 5, z: 2, truss: null });
  };
  const args = (r: Awaited<ReturnType<typeof ask>>, hook: string) => r.calls.filter((c) => c.hook === hook).map((c) => c.args);
  const RING = ["r1", "r2", "r3", "r4", "r5", "r6"];

  test("lights fixtures by name", async () => {
    const r = await ask("Make Spot L and Spot R blue at 70%.", withTruss);
    const sets = args(r, "setValues") as [string[], { levels?: { dimmer?: number }; color?: string }][];
    assert.ok(sets.length, `tools used: ${r.used.join(", ")}`);
    assert.deepEqual(sets.flatMap(([ids]) => ids).sort(), ["sl", "sr"]);
    for (const [, v] of sets) {
      if (v.color) assert.match(v.color, /^#0000ff$/i);
      if (v.levels?.dimmer != null) assert.ok(Math.abs(v.levels.dimmer - 179) <= 1, `70% ≈ 179: ${v.levels.dimmer}`);
    }
    assert.ok(sets.some(([, v]) => v.color) && sets.some(([, v]) => v.levels?.dimmer != null), "both color and dimmer set");
    assert.deepEqual(r.edits, ["setValues"]);
  });

  test("sets a real fixture's ranges from its spec sheet", async () => {
    const r = await ask("The ring's fixtures pan 540 degrees and tilt 270, with a fixed 16 degree beam. Set them up to match.", withTruss);
    const edits = args(r, "editSettings") as [string[], { panRange?: number; tiltRange?: number; beamMin?: number; beamMax?: number }][];
    assert.ok(edits.length, `tools used: ${r.used.join(", ")}`);
    const ids = [...new Set(edits.flatMap(([ids]) => ids))].sort();
    const merged = Object.assign({}, ...edits.map(([, v]) => v));
    assert.deepEqual(ids, RING);
    assert.deepEqual([merged.panRange, merged.tiltRange, merged.beamMin, merged.beamMax], [270, 135, 16, 16]);
    assert.deepEqual(r.edits, ["editSettings"]);
  });

  test("duplicates a fixture", async () => {
    const r = await ask("Duplicate Spot L.", withTruss);
    assert.deepEqual(args(r, "duplicateFixtures"), [[["sl"]]]);
    assert.deepEqual(r.edits, ["duplicateFixtures"]);
  });

  test("selects fixtures to work on by hand", async () => {
    const r = await ask("Select the ring and Spot R so I can adjust them.", withTruss);
    const picks = args(r, "select") as [string[]][];
    assert.ok(picks.length, `tools used: ${r.used.join(", ")}`);
    assert.deepEqual([...picks.at(-1)![0]].sort(), [...RING, "sr"].sort());
    assert.deepEqual(r.edits, ["select"]);
  });

  test("patches 1:1 in one go", async () => {
    const r = await ask("Patch the console 1:1.");
    assert.deepEqual(args(r, "resetPatch"), [[false]]);
    assert.deepEqual(r.edits, ["resetPatch"]);
  });
});

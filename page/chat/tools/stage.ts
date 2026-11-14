/**
 * The chat's stage tools (round 3): look at the stage, place fixtures and
 * rigs, move, aim (at a spot or a named position), rename, delete, named
 * positions, risers, and the box's size. They call the stage
 * (window.stageChat, stage/chat-hooks.ts) the same as its own controls.
 */

import type { StageChat } from "../../../stage/chat-hooks.ts";
import type { Args, ToolDef } from "./common.ts";
import { findByName, findFixtures } from "../find.ts";
import { DMX_ATTRS, isDmxAttr, type DmxAttr } from "../../../shared/attributes.ts";
import type { FixtureProfile } from "../../../stage/fixture-library.ts";

function stage(): StageChat {
  const s = window.stageChat;
  if (!s) throw new Error("The stage isn't ready yet");
  return s;
}

const NO_ARGS = { type: "object", properties: {}, additionalProperties: false };

const WHERE =
  "Meters, from the center of the stage floor: x runs stage right (−) to stage left (+), y is height above the floor, z runs upstage (−) to downstage toward the audience (+). The box spans x ±width/2, z ±depth/2, y 0…height.";

const num = (v: unknown, what: string): number => {
  const n = Number(v);
  if (v == null || v === "" || !Number.isFinite(n)) throw new Error(`${what} must be a number`);
  return n;
};

const XYZ = { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } }, additionalProperties: false };
const POSITION = { ...XYZ, required: ["x", "y", "z"] };

const spot = (v: unknown, what: string) => {
  const p = (v ?? {}) as Args;
  return { x: num(p.x, `${what} x`), y: num(p.y, `${what} y`), z: num(p.z, `${what} z`) };
};

/** Some of x / y / z (at least one). */
const someXyz = (v: unknown, what: string) => {
  const p = (v ?? {}) as Args;
  const out: Partial<Record<"x" | "y" | "z", number>> = {};
  for (const k of ["x", "y", "z"] as const) if (p[k] != null) out[k] = num(p[k], `${what} ${k}`);
  if (!Object.keys(out).length) throw new Error(`${what} needs x, y or z`);
  return out;
};

const CONSOLE_TYPE = {
  type: "string",
  enum: ["movable/multi", "movable/single", "fixed/multi", "fixed/single", "none"],
  description:
    "Its console fixture (channels and faders it gets): movable/multi = pan, tilt, RGB, zoom (7 ch, the default); movable/single (4 ch); fixed/multi (dimmer + RGB, 4 ch); fixed/single (dimmer, 1 ch); none = on the stage only",
};

// --- the fixture library ------------------------------------------------------------

const LIBRARY = {
  type: "object",
  description:
    "A real fixture from the Open Fixture Library (find it with find_library_fixtures): its console fixture gets that mode's channels, named, and the stage draws its pan / tilt / zoom ranges. Overrides console_type (except \"none\").",
  properties: {
    manufacturer: { type: "string", description: "Manufacturer name or key" },
    model: { type: "string", description: "Fixture name or key" },
    mode: { type: "string", description: "Mode name, or its channel count (\"16\"); may be left out when it has one usable mode" },
  },
  required: ["manufacturer", "model"],
  additionalProperties: false,
};

/** The one item whose name or key is `query` (ignoring case), else the one containing it. */
function pickOne<T extends { name: string; key: string }>(items: T[], query: string, kind: string): T {
  const q = query.trim().toLowerCase();
  const exact = items.filter((i) => i.name.toLowerCase() === q || i.key === q);
  if (exact.length === 1) return exact[0];
  const partial = items.filter((i) => i.name.toLowerCase().includes(q) || i.key.includes(q));
  if (partial.length === 1) return partial[0];
  if (!partial.length) throw new Error(`No ${kind} "${query}" in the fixture library`);
  const names = partial.slice(0, 15).map((i) => i.name);
  throw new Error(`"${query}" matches ${partial.length} ${kind}s (${names.join(", ")}${partial.length > 15 ? ", …" : ""}): which one?`);
}

/** A library fixture's profile from what the model calls it. */
export async function libraryProfile(v: unknown): Promise<FixtureProfile> {
  const lib = (v ?? {}) as Args;
  const s = stage();
  const man = pickOne(await s.manufacturers(""), String(lib.manufacturer ?? ""), "manufacturer");
  const fix = pickOne(await s.libraryFixtures(man.key, ""), String(lib.model ?? ""), `${man.name} fixture`);
  const modes = await s.libraryModes(man.key, fix.key);
  const usable = modes.filter((m) => m.ok);
  const list = modes.map((m) => `${m.name} (${m.channels} ch${m.ok ? "" : `: ${m.reason}`})`).join(", ");
  let mode;
  const q = String(lib.mode ?? "").trim().toLowerCase();
  if (!q) {
    if (usable.length !== 1) throw new Error(`Which mode of ${fix.name}? ${list}`);
    mode = usable[0];
  } else {
    const hits = /^\d+$/.test(q) ? modes.filter((m) => m.channels === Number(q)) : modes.filter((m) => m.name.toLowerCase() === q);
    const found = hits.length ? hits : modes.filter((m) => m.name.toLowerCase().includes(q));
    if (found.length !== 1) throw new Error(`${found.length ? `"${lib.mode}" matches several modes` : `No mode "${lib.mode}"`} of ${fix.name}: ${list}`);
    mode = found[0];
  }
  if (!mode.ok) throw new Error(`${fix.name}'s ${mode.name} mode can't be used: ${mode.reason}`);
  return s.libraryProfile(man, fix.key, mode.index);
}

const FIXTURES = { type: "array", minItems: 1, items: { type: "string" }, description: "Fixture names, rig names (all its fixtures), \"all\" or \"selected\"" };

type StageFixture = ReturnType<StageChat["stage"]>["fixtures"][number];

/** Stage fixtures by name, rig name, "all" or "selected" (what's selected on the stage), in stage order. */
function stageFixtures(queries: unknown): StageFixture[] {
  const all = stage().stage().fixtures;
  const list = (Array.isArray(queries) ? queries : [queries]).map((q) => String(q ?? "").trim());
  const isSel = (q: string) => q.toLowerCase() === "selected";
  const found = new Set<string>();
  if (list.some(isSel)) {
    const sel = all.filter((f) => f.selected);
    if (!sel.length) throw new Error("Nothing is selected on the stage");
    for (const f of sel) found.add(f.id);
  }
  const rest = list.filter((q) => !isSel(q));
  if (rest.length || !found.size) for (const f of findFixtures(all.map((f) => ({ ...f, group: f.rig })), rest)) found.add(f.id);
  return all.filter((f) => found.has(f.id));
}

/** Rigs, named positions and risers by name (see findByName). */
const findPosition = (query: unknown) => findByName(stage().stage().positions, query, "position", "There are no named positions yet");
const findRiser = (query: unknown) => findByName(stage().stage().risers, query, "riser", "There are no risers");
const findRig = (query: unknown) => findByName(stage().stage().rigs, query, "rig", "There are no rigs");

const RISER_SIZES = {
  width: { type: "number", minimum: 0.1, maximum: 50, description: "Meters, along x before it's turned" },
  depth: { type: "number", minimum: 0.1, maximum: 50, description: "Meters, along z before it's turned" },
  height: { type: "number", minimum: 0.1, maximum: 10, description: "Meters" },
  yaw: { type: "number", minimum: -180, maximum: 180, description: "Turn about the vertical, degrees (+ = counterclockwise seen from above)" },
};
const XZ = { type: "object", properties: { x: { type: "number" }, z: { type: "number" } }, additionalProperties: false };

/** The riser size / turn fields given (as numbers). */
const riserSizes = (a: Args) => {
  const out: Partial<Record<keyof typeof RISER_SIZES, number>> = {};
  for (const k of Object.keys(RISER_SIZES) as (keyof typeof RISER_SIZES)[]) if (a[k] != null) out[k] = num(a[k], k);
  return out;
};

const who = (a: Args) => (Array.isArray(a.fixtures) ? a.fixtures.join(", ") : String(a.fixtures ?? ""));
const xyzText = (p: unknown) => {
  const o = (p ?? {}) as Args;
  return ["x", "y", "z"].filter((k) => o[k] != null).map((k) => `${k} ${o[k]}`).join(", ");
};

export const STAGE_TOOLS: ToolDef[] = [
  {
    name: "get_stage",
    description: `The stage: the box's size, every rig (name, type, center, size, count, tilt, yaw; model: the library fixture its fixtures are), every fixture (name, position, rig, pan and tilt in degrees, console: the console fixture it's linked to, "manual <address>", or missing when it's only on the stage; selected; following: the named position it follows), the named positions (spots to aim at) and the risers (platforms standing on the floor: center x / z, width, depth, height, yaw). Fields that are empty, false or the rig's are left out. ${WHERE}`,
    schema: NO_ARGS,
    describe: () => "Looked at the stage",
    run: () => {
      const s = stage().stage();
      // Kept short (the whole answer stays in the conversation): no ids, nothing empty or false, a rig's model said once.
      const rigModel = new Map(s.rigs.map((r) => [r.name, s.fixtures.find((f) => f.rig === r.name)?.model]));
      return {
        ...s,
        rigs: s.rigs.map(({ id: _id, ...r }) => ({ ...r, ...(rigModel.get(r.name) ? { model: rigModel.get(r.name) } : {}) })),
        positions: s.positions.map(({ id: _id, ...p }) => p),
        risers: s.risers.map(({ id: _id, ...r }) => r),
        fixtures: s.fixtures.map(({ id: _id, inConsole, ...f }) => {
          const kept = Object.fromEntries(Object.entries(f).filter(([k, v]) => v != null && v !== false && !(k === "model" && f.rig && v === rigModel.get(f.rig))));
          return inConsole && !f.console ? { ...kept, console: "registering" } : kept;
        }),
      };
    },
  },
  {
    name: "place_fixtures",
    description: `Put new fixtures on the stage, each at a point, aimed at the stage floor's center. Each also gets a console fixture with faders (unless console_type is "none"). ${WHERE}`,
    schema: {
      type: "object",
      properties: {
        fixtures: {
          type: "array",
          minItems: 1,
          items: { ...XYZ, properties: { ...XYZ.properties, name: { type: "string", maxLength: 40 } }, required: ["x", "y", "z"] },
        },
        console_type: CONSOLE_TYPE,
        library: LIBRARY,
      },
      required: ["fixtures"],
      additionalProperties: false,
    },
    describe: (a) => {
      const n = Array.isArray(a.fixtures) ? a.fixtures.length : 0;
      const lib = (a.library ?? null) as Args | null;
      return `Place ${n} ${lib ? `${lib.manufacturer} ${lib.model}` : `fixture${n === 1 ? "" : "s"}`}${a.console_type === "none" ? " (stage only)" : ""}`;
    },
    run: async (a) => {
      if (!Array.isArray(a.fixtures) || !a.fixtures.length) throw new Error("Which points?");
      const points = a.fixtures.map((p: Args, k: number) => ({ ...spot(p, `fixture ${k + 1}`), name: p.name == null ? undefined : String(p.name) }));
      const profile = a.library == null ? null : await libraryProfile(a.library);
      return { placed: stage().addFixtures(points, String(a.console_type ?? "movable/multi"), profile) };
    },
  },
  {
    name: "place_rig",
    description: `Put a new rig on the stage: fixtures arranged as a circle (a ring; size = diameter), a square (size = side) or a line (size = length), centered at a point. Circle and square fixtures point at the rig's center; a line's all point the same way (straight down when flat). tilt: 0 = flat (hanging), 90 = upright facing the audience (a line: +90 aims upstage, −90 at the audience). yaw turns it about the vertical. Defaults: circle / square 4 m, 8 fixtures; line 6 m, 6 fixtures; tilt 0, yaw 0. ${WHERE}`,
    schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["circle", "square", "line"] },
        center: POSITION,
        size: { type: "number", minimum: 0.5, maximum: 50 },
        count: { type: "integer", minimum: 2 },
        tilt: { type: "number", minimum: -90, maximum: 90 },
        yaw: { type: "number", minimum: -180, maximum: 180 },
        name: { type: "string", maxLength: 40, description: "Default: Ring 1, Square 1, Line 1, …" },
        console_type: CONSOLE_TYPE,
        library: LIBRARY,
      },
      required: ["type", "center"],
      additionalProperties: false,
    },
    describe: (a) => `Place a ${a.type} rig${a.name ? ` "${a.name}"` : ""} at ${xyzText(a.center)}`,
    run: async (a) => {
      const type = a.type === "circle" || a.type === "square" || a.type === "line" ? a.type : null;
      if (!type) throw new Error("type must be circle, square or line");
      const c = spot(a.center, "center");
      const opt = (k: string) => (a[k] == null ? undefined : num(a[k], k));
      const profile = a.library == null ? null : await libraryProfile(a.library);
      return stage().addRig({
        type, ...c,
        size: opt("size"), count: opt("count"), tilt: opt("tilt"), yaw: opt("yaw"),
        consoleType: String(a.console_type ?? "movable/multi"),
        name: a.name == null ? undefined : String(a.name),
        profile,
      });
    },
  },
  {
    name: "edit_rig",
    description: `Change a rig: its name, center (moves the whole rig), size, number of fixtures, tilt or yaw. Its fixtures follow. ${WHERE}`,
    schema: {
      type: "object",
      properties: {
        rig: { type: "string", description: "The rig's name" },
        name: { type: "string", maxLength: 40 },
        center: XYZ,
        size: { type: "number", minimum: 0.5, maximum: 50 },
        count: { type: "integer", minimum: 2 },
        tilt: { type: "number", minimum: -90, maximum: 90 },
        yaw: { type: "number", minimum: -180, maximum: 180 },
      },
      required: ["rig"],
      additionalProperties: false,
    },
    describe: (a) => {
      const what = [
        a.name != null && `name "${a.name}"`,
        a.center != null && `center ${xyzText(a.center)}`,
        ...(["size", "count", "tilt", "yaw"] as const).map((k) => a[k] != null && `${k} ${a[k]}`),
      ].filter(Boolean);
      return `${a.rig}: ${what.join(", ") || "no change"}`;
    },
    run: (a) => {
      const rig = findRig(a.rig);
      const fields: Record<string, string | number> = {};
      if (a.name != null) fields.name = String(a.name);
      if (a.center != null) Object.assign(fields, someXyz(a.center, "center"));
      for (const k of ["size", "count", "tilt", "yaw"]) if (a[k] != null) fields[k] = num(a[k], k);
      if (!Object.keys(fields).length) throw new Error("Nothing to change");
      return stage().editRig(rig.id, fields);
    },
  },
  {
    name: "move_fixtures",
    description: `Move fixtures that aren't in a rig: to a point (any of x / y / z; the others stay) or by an offset. To move a rig's fixtures, move the rig (edit_rig). Moving doesn't re-aim them, except fixtures following a named position. ${WHERE}`,
    schema: {
      type: "object",
      properties: { fixtures: FIXTURES, to: XYZ, by: { ...XYZ, description: "Offset in meters" } },
      required: ["fixtures"],
      additionalProperties: false,
    },
    describe: (a) => `Move ${who(a)} ${a.to != null ? `to ${xyzText(a.to)}` : `by ${xyzText(a.by)}`}`,
    run: (a) => {
      if ((a.to == null) === (a.by == null)) throw new Error("Give either to or by");
      const ids = stageFixtures(a.fixtures).map((f) => f.id);
      return { moved: stage().moveFixtures(ids, a.to != null ? { to: someXyz(a.to, "to") } : { by: someXyz(a.by, "by") }) };
    },
  },
  {
    name: "aim_fixtures",
    description: `Point fixtures' beams (a rig's name aims all its fixtures) at a named position, at a spot, or send them home (pan and tilt centered). Sets their pan and tilt, within their range. Aimed at a named position, they follow it: when the position or the fixture moves they re-aim. For fixtures in the console the aim goes into the cue on stage (its pan / tilt faders), and that cue keeps following the position until its pan / tilt are changed some other way; other cues are untouched. At a spot or home: set once, and any following stops. E.g. the floor's center is (0, 0, 0); downstage center floor is (0, 0, depth/2 − 1). ${WHERE}`,
    schema: {
      type: "object",
      properties: {
        fixtures: FIXTURES,
        position: { type: "string", description: "A named position's name (see get_stage)" },
        at: POSITION,
        home: { type: "boolean" },
      },
      required: ["fixtures"],
      additionalProperties: false,
    },
    describe: (a) => (a.home ? `Home ${who(a)}` : `Aim ${who(a)} at ${a.position != null ? `${a.position}` : xyzText(a.at)}`),
    run: (a) => {
      const given = [a.position != null, a.at != null, !!a.home].filter(Boolean).length;
      if (given !== 1) throw new Error("Give one of: position (a named position), at (x, y, z) or home: true");
      const ids = stageFixtures(a.fixtures).map((f) => f.id);
      if (a.position != null) {
        const p = findPosition(a.position);
        return { position: p.name, following: true, ...stage().aimAtPosition(ids, p.id) };
      }
      return stage().aimFixtures(ids, a.home ? null : spot(a.at, "at"));
    },
  },
  {
    name: "stop_following",
    description: "Stop fixtures following their named position (they stay where they're aimed). For fixtures in the console, this is for the cue on stage.",
    schema: { type: "object", properties: { fixtures: FIXTURES }, required: ["fixtures"], additionalProperties: false },
    describe: (a) => `${who(a)} stop following`,
    run: (a) => ({ stopped: stage().stopFollowing(stageFixtures(a.fixtures).map((f) => f.id)) }),
  },
  {
    name: "add_position",
    description: `Save a named position on the stage: a spot (on the floor, a wall, anywhere) the person can then aim fixtures at by name, like a console's position preset. Name it as the person did (e.g. "DSC", "drum riser", "lectern"). ${WHERE}`,
    schema: {
      type: "object",
      properties: { name: { type: "string", maxLength: 40 }, at: POSITION },
      required: ["name", "at"],
      additionalProperties: false,
    },
    describe: (a) => `Add position "${a.name}" at ${xyzText(a.at)}`,
    run: (a) => stage().addPosition(String(a.name ?? ""), spot(a.at, "at")),
  },
  {
    name: "edit_position",
    description: `Rename or move a named position (any of x / y / z; the others stay). Fixtures following it re-aim, including in every cue that aims at it. ${WHERE}`,
    schema: {
      type: "object",
      properties: { position: { type: "string" }, name: { type: "string", maxLength: 40 }, to: XYZ },
      required: ["position"],
      additionalProperties: false,
    },
    describe: (a) => `${a.position}: ${[a.name != null && `name "${a.name}"`, a.to != null && `move to ${xyzText(a.to)}`].filter(Boolean).join(", ") || "no change"}`,
    run: (a) => {
      const p = findPosition(a.position);
      if (a.name == null && a.to == null) throw new Error("Nothing to change");
      return stage().editPosition(p.id, { ...(a.name != null ? { name: String(a.name) } : {}), ...(a.to != null ? someXyz(a.to, "to") : {}) });
    },
  },
  {
    name: "delete_position",
    description: "Delete a named position. Fixtures following it stop following and stay where they are aimed (cues keep their pan / tilt).",
    schema: { type: "object", properties: { position: { type: "string" } }, required: ["position"], additionalProperties: false },
    describe: (a) => `Delete position ${a.position}`,
    run: (a) => ({ deleted: stage().deletePosition(findPosition(a.position).id) }),
  },
  {
    name: "add_riser",
    description: `Put a riser on the stage: a box standing on the floor (a platform, drum riser, deck), centered at x / z. Defaults: 2.4 m wide, 1.2 m deep (an 8 × 4 ft deck), 0.4 m high, not turned. Beams light its top and sides. To aim at its top, add a named position there with y = its height (e.g. "Drum riser" at the riser's center, y = height + 1.2 for a performer's chest). ${WHERE}`,
    schema: {
      type: "object",
      properties: { name: { type: "string", maxLength: 40, description: "Default: Riser 1, Riser 2, …" }, center: { ...XZ, required: ["x", "z"] }, ...RISER_SIZES },
      required: ["center"],
      additionalProperties: false,
    },
    describe: (a) => `Add riser${a.name ? ` "${a.name}"` : ""} at ${xyzText(a.center)}`,
    run: (a) => {
      const c = (a.center ?? {}) as Args;
      return stage().addRiser({ name: a.name == null ? undefined : String(a.name), x: num(c.x, "center x"), z: num(c.z, "center z"), ...riserSizes(a) });
    },
  },
  {
    name: "edit_riser",
    description: `Change a riser: rename it, move its center (x / z; the other stays), resize it or turn it. ${WHERE}`,
    schema: {
      type: "object",
      properties: { riser: { type: "string", description: "The riser's name" }, name: { type: "string", maxLength: 40 }, center: XZ, ...RISER_SIZES },
      required: ["riser"],
      additionalProperties: false,
    },
    describe: (a) => {
      const what = [
        a.name != null && `name "${a.name}"`,
        a.center != null && `center ${xyzText(a.center)}`,
        ...Object.keys(RISER_SIZES).map((k) => a[k] != null && `${k} ${a[k]}`),
      ].filter(Boolean);
      return `${a.riser}: ${what.join(", ") || "no change"}`;
    },
    run: (a) => {
      const r = findRiser(a.riser);
      const c = (a.center ?? {}) as Args;
      const change = {
        ...(a.name != null ? { name: String(a.name) } : {}),
        ...(c.x != null ? { x: num(c.x, "center x") } : {}),
        ...(c.z != null ? { z: num(c.z, "center z") } : {}),
        ...riserSizes(a),
      };
      if (!Object.keys(change).length) throw new Error("Nothing to change");
      return stage().editRiser(r.id, change);
    },
  },
  {
    name: "delete_riser",
    description: "Delete a riser (it leaves the stage).",
    schema: { type: "object", properties: { riser: { type: "string" } }, required: ["riser"], additionalProperties: false },
    describe: (a) => `Delete riser ${a.riser}`,
    run: (a) => ({ deleted: stage().deleteRiser(findRiser(a.riser).id) }),
  },
  {
    name: "set_stage_fixtures",
    description:
      "Set what stage fixtures show, as the inspector's sliders do: dimmer (%), color (#rrggbb, mixed onto the color channels each has), pan / tilt / zoom or any channel (0–255; pan / tilt 128 = straight ahead from its zero). Works on every stage fixture, including ones only on the stage (not in the console), which set_fixture can't reach. For fixtures in the console the values go to their channels in the cue on stage, as the inspector's do; to change another cue, use set_fixture. Setting pan or tilt stops following a position (to aim at a spot, aim_fixtures is easier).",
    schema: {
      type: "object",
      properties: {
        fixtures: FIXTURES,
        dimmer: { type: "number", minimum: 0, maximum: 100, description: "Percent" },
        color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        pan: { type: "integer", minimum: 0, maximum: 255 },
        tilt: { type: "integer", minimum: 0, maximum: 255 },
        zoom: { type: "integer", minimum: 0, maximum: 255, description: "0 = narrowest, 255 = widest" },
        channels: { type: "object", description: `Any channel by what it does (${DMX_ATTRS.join(", ")}): 0–255`, additionalProperties: { type: "integer", minimum: 0, maximum: 255 } },
      },
      required: ["fixtures"],
      additionalProperties: false,
    },
    describe: (a) => `Set ${who(a)}: ${[a.dimmer != null ? `dimmer ${a.dimmer}%` : "", a.color ? `color ${a.color}` : "", ...(["pan", "tilt", "zoom"] as const).filter((k) => a[k] != null).map((k) => `${k} ${a[k]}`), ...Object.entries((a.channels ?? {}) as Args).map(([k, v]) => `${k} ${v}`)].filter(Boolean).join(", ")}`,
    run: (a) => {
      const levels: Partial<Record<DmxAttr, number>> = {};
      if (a.dimmer != null) {
        const pct = num(a.dimmer, "dimmer");
        if (pct < 0 || pct > 100) throw new Error("dimmer must be 0–100 (%)");
        levels.dimmer = Math.round((pct * 255) / 100);
      }
      const byte = (v: unknown, what: string) => {
        const n = num(v, what);
        if (n < 0 || n > 255) throw new Error(`${what} must be 0–255`);
        return Math.round(n);
      };
      for (const k of ["pan", "tilt", "zoom"] as const) if (a[k] != null) levels[k] = byte(a[k], k);
      if (a.channels != null && typeof a.channels === "object") {
        for (const [k, v] of Object.entries(a.channels as Args)) {
          if (!isDmxAttr(k)) throw new Error(`Unknown channel "${k}" (use: ${DMX_ATTRS.join(", ")})`);
          levels[k] = byte(v, k);
        }
      }
      let color: string | undefined;
      if (a.color != null) {
        color = String(a.color);
        if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error("color must be #rrggbb");
      }
      if (!Object.keys(levels).length && color == null) throw new Error("Nothing to set: give dimmer, color, pan, tilt, zoom or channels");
      return stage().setValues(stageFixtures(a.fixtures).map((f) => f.id), { levels, color });
    },
  },
  {
    name: "edit_stage_fixtures",
    description:
      "Change stage fixtures' own settings, as the inspector's Ranges, Dimmer curve and zero do. pan_range / tilt_range: how far the real fixture turns each way from its zero (± degrees; a 540° pan is ±270). beam_min / beam_max: its beam angle (degrees) at zoom 0 and 255 (the same for both on a fixture without zoom). dimmer_curve: as set in the real fixture's menu (it only changes how bright the stage draws it). zero: \"here\" makes where it points now its zero (pan / tilt 128), \"stage\" points its zero at the stage (for a rig's fixtures the rig sets their zero: skipped). These don't change the DMX sent.",
    schema: {
      type: "object",
      properties: {
        fixtures: FIXTURES,
        pan_range: { type: "number", minimum: 0, maximum: 360 },
        tilt_range: { type: "number", minimum: 0, maximum: 180 },
        beam_min: { type: "number", minimum: 1, maximum: 120 },
        beam_max: { type: "number", minimum: 1, maximum: 120 },
        dimmer_curve: { type: "string", enum: ["linear", "square", "inverse-square", "s-curve"], description: "square = square law (low values stay dim; common on LEDs)" },
        zero: { type: "string", enum: ["here", "stage"] },
      },
      required: ["fixtures"],
      additionalProperties: false,
    },
    describe: (a) => `Change ${who(a)}'s settings`,
    run: (a) => {
      const opt = (k: string) => (a[k] == null ? undefined : num(a[k], k));
      if (a.zero != null && a.zero !== "here" && a.zero !== "stage") throw new Error("zero must be here or stage");
      const zero: "here" | "stage" | undefined = a.zero === "here" || a.zero === "stage" ? a.zero : undefined;
      const settings = { panRange: opt("pan_range"), tiltRange: opt("tilt_range"), beamMin: opt("beam_min"), beamMax: opt("beam_max"), dimmerCurve: a.dimmer_curve == null ? undefined : String(a.dimmer_curve), zero };
      if (Object.values(settings).every((v) => v == null)) throw new Error("Nothing to change");
      return stage().editSettings(stageFixtures(a.fixtures).map((f) => f.id), settings);
    },
  },
  {
    name: "duplicate_fixtures",
    description: "Copy stage fixtures, with all their settings, 0.5 m to stage left (copies of a rig's fixtures are free fixtures). Each copy of a fixture the stage set up in the console gets its own console fixture and faders.",
    schema: { type: "object", properties: { fixtures: FIXTURES }, required: ["fixtures"], additionalProperties: false },
    describe: (a) => `Duplicate ${who(a)}`,
    run: (a) => stage().duplicateFixtures(stageFixtures(a.fixtures).map((f) => f.id)),
  },
  {
    name: "select_fixtures",
    description: "Select fixtures on the stage, as clicking them would, so the person can carry on by hand (the inspector shows them, the console highlights their faders). Replaces the selection; [\"none\"] clears it. Other tools already select what they change.",
    schema: { type: "object", properties: { fixtures: { ...FIXTURES, description: `${FIXTURES.description}, or "none"` } }, required: ["fixtures"], additionalProperties: false },
    describe: (a) => `Select ${who(a)}`,
    run: (a) => {
      const none = Array.isArray(a.fixtures) && a.fixtures.length === 1 && String(a.fixtures[0]).toLowerCase() === "none";
      return { selected: stage().select(none ? [] : stageFixtures(a.fixtures).map((f) => f.id)) };
    },
  },
  {
    name: "rename_stage_fixture",
    description: "Rename a fixture on the stage. (A rig's fixtures are named after the rig: rename the rig with edit_rig.)",
    schema: { type: "object", properties: { fixture: { type: "string" }, name: { type: "string", maxLength: 40 } }, required: ["fixture", "name"], additionalProperties: false },
    describe: (a) => `Rename ${a.fixture} to "${a.name}"`,
    run: (a) => {
      const [f, ...more] = stageFixtures([a.fixture]);
      if (more.length) throw new Error(`"${a.fixture}" is more than one fixture`);
      return { name: stage().renameFixture(f.id, String(a.name ?? "")) };
    },
  },
  {
    name: "delete_fixtures",
    description: "Delete stage fixtures, and the console fixtures the stage made for them. A fixture in a rig deletes its whole rig.",
    schema: { type: "object", properties: { fixtures: FIXTURES }, required: ["fixtures"], additionalProperties: false },
    describe: (a) => `Delete ${who(a)}`,
    run: (a) => ({ deleted: stage().deleteFixtures(stageFixtures(a.fixtures).map((f) => f.id)) }),
  },
  {
    name: "set_stage_size",
    description: "Set the stage box's size in meters (1–100 each): width (stage right to left), depth (upstage to downstage), height.",
    schema: {
      type: "object",
      properties: {
        width: { type: "number", minimum: 1, maximum: 100 },
        depth: { type: "number", minimum: 1, maximum: 100 },
        height: { type: "number", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    describe: (a) => `Stage size ${[a.width != null && `width ${a.width}`, a.depth != null && `depth ${a.depth}`, a.height != null && `height ${a.height}`].filter(Boolean).join(", ")}`,
    run: (a) => {
      const size = { w: a.width == null ? undefined : num(a.width, "width"), d: a.depth == null ? undefined : num(a.depth, "depth"), h: a.height == null ? undefined : num(a.height, "height") };
      if (size.w == null && size.d == null && size.h == null) throw new Error("Give width, depth or height");
      const box = stage().setBox(size);
      return { width: box.w, depth: box.d, height: box.h };
    },
  },
  {
    name: "find_library_fixtures",
    description:
      "Search the Open Fixture Library (real fixtures; needs internet): manufacturers matching a name, or one manufacturer's fixtures matching a model name. When one fixture matches, its modes too (name, channel count, whether it can be used). Then place it with place_fixtures / place_rig's library.",
    schema: {
      type: "object",
      properties: {
        manufacturer: { type: "string", description: "Manufacturer name (or part of it)" },
        model: { type: "string", description: "Model name (or part of it)" },
      },
      required: ["manufacturer"],
      additionalProperties: false,
    },
    describe: (a) => `Looked up ${[a.manufacturer, a.model].filter(Boolean).join(" ")} in the fixture library`,
    run: async (a) => {
      const s = stage();
      const q = String(a.manufacturer ?? "").trim();
      const mans = await s.manufacturers(q);
      const exact = mans.filter((m) => m.name.toLowerCase() === q.toLowerCase() || m.key === q.toLowerCase());
      const man = exact.length === 1 ? exact[0] : mans.length === 1 ? mans[0] : null;
      if (!man) {
        if (!mans.length) throw new Error(`No manufacturer "${q}" in the fixture library`);
        return { manufacturers: mans.slice(0, 40).map((m) => m.name), ...(mans.length > 40 ? { more: mans.length - 40 } : {}) };
      }
      const model = String(a.model ?? "");
      const fixtures = await s.libraryFixtures(man.key, model);
      const one = fixtures.length === 1 ? fixtures[0] : fixtures.find((f) => f.name.toLowerCase() === model.trim().toLowerCase());
      if (one) {
        const modes = await s.libraryModes(man.key, one.key);
        return { manufacturer: man.name, model: one.name, modes: modes.map((m) => ({ mode: m.name, channels: m.channels, ...(m.ok ? {} : { cantUse: m.reason }) })) };
      }
      if (!fixtures.length) throw new Error(`No ${man.name} fixture "${model}"`);
      return { manufacturer: man.name, fixtures: fixtures.slice(0, 60).map((f) => f.name), ...(fixtures.length > 60 ? { more: fixtures.length - 60 } : {}) };
    },
  },
  {
    name: "link_fixtures",
    description:
      "How stage fixtures get their DMX (what get_stage shows as console). Give exactly one of: console_fixture (link to that console fixture; several stage fixtures link in order to it and the console fixtures after it, by channel), address (drive them straight from DMX channels from there, each fixture's block after the last), register (give each a new console fixture of that type, with faders; library fixtures bring their own channels), or unlink (stage only). Moving off a console fixture the stage made deletes it in the console.",
    schema: {
      type: "object",
      properties: {
        fixtures: FIXTURES,
        console_fixture: { type: "string", description: "A console fixture's name (list_fixtures)" },
        address: { type: "string", description: "DMX start address: 45, or 2/45 for universe 2" },
        layout: { type: "array", items: { type: "string", enum: [...DMX_ATTRS, "other"] }, description: "With address: what each channel does (default: its library mode's, else pan, tilt, dimmer, R, G, B, zoom)" },
        register: { ...CONSOLE_TYPE, description: "Console fixture type to make (movable/multi, movable/single, fixed/multi, fixed/single)" },
        universe: { type: "integer", minimum: 1, description: "With register: only in this universe" },
        unlink: { type: "boolean" },
      },
      required: ["fixtures"],
      additionalProperties: false,
    },
    describe: (a) => {
      const how = a.console_fixture != null ? `link to ${a.console_fixture}` : a.address != null ? `address ${a.address}` : a.register != null ? `register (${a.register})` : a.unlink ? "unlink" : "?";
      return `${who(a)}: ${how}`;
    },
    run: (a) => {
      const ways = [a.console_fixture != null, a.address != null, a.register != null, a.unlink === true].filter(Boolean).length;
      if (ways !== 1) throw new Error("Give exactly one of console_fixture, address, register or unlink");
      const ids = stageFixtures(a.fixtures).map((f) => f.id);
      const s = stage();
      if (a.console_fixture != null) {
        const consoleFixtures = window.consoleChat?.fixtures() ?? [];
        const [target, ...more] = findFixtures(consoleFixtures, [a.console_fixture]);
        if (more.length) throw new Error(`"${a.console_fixture}" is a group: name one console fixture`);
        const n = s.linkToConsole(ids, target.id);
        if (n < ids.length) return { linked: n, of: ids.length, note: "Ran out of console fixtures after it" };
      } else if (a.address != null) {
        const start = s.parseAddress(String(a.address));
        if (start == null) throw new Error(`"${a.address}" isn't a DMX address (45, or 2/45)`);
        const layout = Array.isArray(a.layout) ? a.layout.map((r): DmxAttr | null => (isDmxAttr(r) ? r : null)) : undefined;
        s.linkManual(ids, start, layout);
      } else if (a.register != null) {
        if (a.register === "none") throw new Error("To leave them stage only, use unlink");
        s.register(ids, String(a.register), a.universe == null ? null : Number(a.universe));
      } else s.unlink(ids);
      const all = s.stage().fixtures;
      return ids.map((id) => all.find((f) => f.id === id)).filter(Boolean).map((f) => ({ fixture: f?.name, console: f?.console }));
    },
  },
];

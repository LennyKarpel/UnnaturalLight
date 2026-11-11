/**
 * The chat's stage tools (round 3): look at the stage, place fixtures and
 * rigs, move, aim (at a spot or a named position), rename, delete, named
 * positions, risers, and the box's size. They call the stage
 * (window.stageChat, stage/chat-hooks.ts) the same as its own controls.
 */

import type { StageChat } from "../../stage/chat-hooks.ts";
import type { Args, ToolDef } from "./tools.ts";
import { findFixtures } from "./find.ts";

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

/** A named position by name (exact, else the one whose name contains it). */
function findPosition(query: unknown) {
  const positions = stage().stage().positions;
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) throw new Error("Which position?");
  const exact = positions.filter((p) => p.name.toLowerCase() === q);
  if (exact.length === 1) return exact[0];
  const partial = positions.filter((p) => p.name.toLowerCase().includes(q));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw new Error(`"${query}" matches ${partial.map((p) => `"${p.name}"`).join(", ")}: which one?`);
  throw new Error(positions.length ? `No position "${query}" (positions: ${positions.map((p) => p.name).join(", ")})` : "There are no named positions yet");
}

/** A riser by name (exact, else the one whose name contains it). */
function findRiser(query: unknown) {
  const risers = stage().stage().risers;
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) throw new Error("Which riser?");
  const exact = risers.filter((r) => r.name.toLowerCase() === q);
  if (exact.length === 1) return exact[0];
  const partial = risers.filter((r) => r.name.toLowerCase().includes(q));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw new Error(`"${query}" matches ${partial.map((r) => `"${r.name}"`).join(", ")}: which one?`);
  throw new Error(risers.length ? `No riser "${query}" (risers: ${risers.map((r) => r.name).join(", ")})` : "There are no risers");
}

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

/** A rig by name (exact, else the one whose name contains it). */
function findRig(query: unknown) {
  const rigs = stage().stage().rigs;
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) throw new Error("Which rig?");
  const exact = rigs.filter((r) => r.name.toLowerCase() === q);
  if (exact.length === 1) return exact[0];
  const partial = rigs.filter((r) => r.name.toLowerCase().includes(q));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw new Error(`"${query}" matches ${partial.map((r) => `"${r.name}"`).join(", ")}: which one?`);
  throw new Error(rigs.length ? `No rig "${query}" (rigs: ${rigs.map((r) => r.name).join(", ")})` : "There are no rigs");
}

const who = (a: Args) => (Array.isArray(a.fixtures) ? a.fixtures.join(", ") : String(a.fixtures ?? ""));
const xyzText = (p: unknown) => {
  const o = (p ?? {}) as Args;
  return ["x", "y", "z"].filter((k) => o[k] != null).map((k) => `${k} ${o[k]}`).join(", ");
};

export const STAGE_TOOLS: ToolDef[] = [
  {
    name: "get_stage",
    description: `The stage: the box's size, every rig (name, type, center, size, count, tilt, yaw), every fixture (name, position, rig, pan and tilt in degrees, whether it's in the console, whether it's selected), the named positions (spots to aim at, with the fixtures following each) and the risers (platforms standing on the floor: center x / z, width, depth, height, yaw). ${WHERE}`,
    schema: NO_ARGS,
    describe: () => "Looked at the stage",
    run: () => {
      const s = stage().stage();
      return {
        ...s,
        rigs: s.rigs.map(({ id: _id, ...r }) => r),
        positions: s.positions.map(({ id: _id, ...p }) => p),
        risers: s.risers.map(({ id: _id, ...r }) => r),
        fixtures: s.fixtures.map(({ id: _id, ...f }) => f),
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
      },
      required: ["fixtures"],
      additionalProperties: false,
    },
    describe: (a) => {
      const n = Array.isArray(a.fixtures) ? a.fixtures.length : 0;
      return `Place ${n} fixture${n === 1 ? "" : "s"}${a.console_type === "none" ? " (stage only)" : ""}`;
    },
    run: (a) => {
      if (!Array.isArray(a.fixtures) || !a.fixtures.length) throw new Error("Which points?");
      const points = a.fixtures.map((p: Args, k: number) => ({ ...spot(p, `fixture ${k + 1}`), name: p.name == null ? undefined : String(p.name) }));
      return { placed: stage().addFixtures(points, String(a.console_type ?? "movable/multi")) };
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
      },
      required: ["type", "center"],
      additionalProperties: false,
    },
    describe: (a) => `Place a ${a.type} rig${a.name ? ` "${a.name}"` : ""} at ${xyzText(a.center)}`,
    run: (a) => {
      const type = a.type === "circle" || a.type === "square" || a.type === "line" ? a.type : null;
      if (!type) throw new Error("type must be circle, square or line");
      const c = spot(a.center, "center");
      const opt = (k: string) => (a[k] == null ? undefined : num(a[k], k));
      return stage().addRig({
        type, ...c,
        size: opt("size"), count: opt("count"), tilt: opt("tilt"), yaw: opt("yaw"),
        consoleType: String(a.console_type ?? "movable/multi"),
        name: a.name == null ? undefined : String(a.name),
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
    description: "Delete a riser from the stage.",
    schema: { type: "object", properties: { riser: { type: "string" } }, required: ["riser"], additionalProperties: false },
    describe: (a) => `Delete riser ${a.riser}`,
    run: (a) => ({ deleted: stage().deleteRiser(findRiser(a.riser).id) }),
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
    description: "Delete fixtures from the stage, and the console fixtures the stage made for them. A fixture in a rig deletes its whole rig.",
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
];

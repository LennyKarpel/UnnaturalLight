/** The chat's console fixture, group and patch tools (round 2), and reading a fixture's channels by what they do. */

import type { ConsoleChat } from "../../../console/chat-hooks.ts";
import { DMX_ATTRS, DMX_SHORT, isDmxAttr, type DmxAttr } from "../../../shared/attributes.ts";
import { COLOR_ROLES, isColorRole, levelsFromColor } from "../../../shared/color.ts";
import { findFixtures } from "../find.ts";
import { type Args, type ToolDef, api, percent, number, NO_ARGS, songArg, cueArg, songName, level, inSong, SONG, CUE, STEP, stepArg, inStep } from "./common.ts";

export type FixtureInfo = ReturnType<ConsoleChat["fixtures"]>[number];

/** What a fader does from its name ("Ring 1 Dim", "Par R"), for fixtures made by hand without channel roles. */
export function roleFromName(name: string): DmxAttr | null {
  const last = name.trim().split(/\s+/).pop()?.toLowerCase() ?? "";
  return DMX_ATTRS.find((r) => last === r || last === DMX_SHORT[r].toLowerCase()) ?? (last === "dimmer" ? "dimmer" : null);
}

/** A fixture's faders by what they do (role → fader numbers, 1-based). */
export function fixtureRoles(f: FixtureInfo, faderName: (fader: number) => string): Map<DmxAttr, number[]> {
  const roles = new Map<DmxAttr, number[]>();
  for (const ch of f.channels) {
    const role = ch.role ?? (ch.faders.length ? roleFromName(faderName(ch.faders[0])) : null);
    if (!role || !ch.faders.length) continue;
    roles.set(role, [...(roles.get(role) ?? []), ...ch.faders]);
  }
  return roles;
}

/**
 * The levels to set on one fixture for set_fixture's arguments: fader
 * (1-based) → 0–255, and what it couldn't set (the fixture has no such channel).
 */
export function fixtureLevels(roles: Map<DmxAttr, number[]>, a: Args): { cells: Map<number, number>; set: string[]; missing: string[] } {
  const cells = new Map<number, number>();
  const set: string[] = [];
  const missing: string[] = [];
  const put = (role: DmxAttr, value: number, label: string) => {
    const faders = roles.get(role);
    if (!faders) return false;
    for (const f of faders) cells.set(f, value);
    set.push(label);
    return true;
  };
  if (a.dimmer != null) {
    const pct = percent(a.dimmer, "dimmer");
    if (!put("dimmer", Math.round((pct * 255) / 100), `dimmer ${Math.round(pct)}%`)) missing.push("dimmer");
  }
  if (a.color != null) {
    const hex = String(a.color);
    if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error("color must be #rrggbb");
    const colorRoles = COLOR_ROLES.filter((r) => roles.has(r));
    const mix = levelsFromColor(hex, colorRoles);
    let any = false;
    for (const r of colorRoles) {
      const v = isColorRole(r) ? mix[r] : undefined;
      if (v != null) any = put(r, v, `${r} ${v}`) || any;
    }
    if (!any) missing.push("color");
  }
  for (const r of ["pan", "tilt", "zoom"] as const) {
    if (a[r] != null && !put(r, level(a[r], r), `${r} ${level(a[r], r)}`)) missing.push(r);
  }
  if (a.channels != null && typeof a.channels === "object") {
    for (const [r, v] of Object.entries(a.channels as Args)) {
      if (!isDmxAttr(r)) throw new Error(`Unknown channel "${r}" (use: ${DMX_ATTRS.join(", ")})`);
      if (!put(r, level(v, r), `${r} ${level(v, r)}`)) missing.push(r);
    }
  }
  return { cells, set, missing };
}

export const FIXTURE_TOOLS: ToolDef[] = [
  {
    name: "list_fixtures",
    description:
      "Every fixture: its name, group, and which faders drive what (dimmer, pan, tilt, red, green, blue, white, amber, zoom, …; fader numbers). Unknown channels are listed by fader number and name.",
    schema: NO_ARGS,
    describe: () => "Looked at the fixtures",
    run: () => {
      const names = api().faders();
      const faderName = (n: number) => names[n - 1]?.name ?? "";
      return api().fixtures().map((f) => {
        const roles = fixtureRoles(f, faderName);
        const known = new Set([...roles.values()].flat());
        const other = f.channels.flatMap((c) => c.faders.filter((n) => !known.has(n)).map((n) => `F${n} "${faderName(n)}"`));
        return {
          name: f.name,
          group: f.group,
          faders: Object.fromEntries([...roles].map(([r, list]) => [r, list])),
          ...(other.length ? { other } : {}),
        };
      });
    },
  },
  {
    name: "set_fixture",
    description:
      "Set one or more fixtures' dimmer (%), color (#rrggbb, mixed onto their color emitters: red, green, blue, white, amber, …), pan / tilt / zoom (0–255; 128 ≈ center) or any other channel, in a cue. Default: the LIVE cue, so the lights change at once. Fixtures by name, group name, or \"all\".",
    schema: {
      type: "object",
      properties: {
        fixtures: { type: "array", minItems: 1, items: { type: "string" }, description: "Fixture names, group names, or \"all\"" },
        song: SONG,
        cue: { ...CUE, description: "Cue number in the song (default: the LIVE cue)" },
        step: STEP,
        dimmer: { type: "number", minimum: 0, maximum: 100, description: "Percent" },
        color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$", description: "#rrggbb, e.g. #ff8800 for amber-orange" },
        pan: { type: "integer", minimum: 0, maximum: 255 },
        tilt: { type: "integer", minimum: 0, maximum: 255 },
        zoom: { type: "integer", minimum: 0, maximum: 255 },
        channels: {
          type: "object",
          description: `Other channels by what they do (${DMX_ATTRS.join(", ")}), 0–255`,
          additionalProperties: { type: "integer", minimum: 0, maximum: 255 },
        },
      },
      required: ["fixtures"],
      additionalProperties: false,
    },
    describe: (a) => {
      const who = Array.isArray(a.fixtures) ? a.fixtures.join(", ") : String(a.fixtures ?? "");
      const what = [
        a.dimmer != null && `dimmer ${Math.round(Number(a.dimmer))}%`,
        a.color != null && `color ${a.color}`,
        a.pan != null && `pan ${a.pan}`,
        a.tilt != null && `tilt ${a.tilt}`,
        a.zoom != null && `zoom ${a.zoom}`,
        a.channels != null && typeof a.channels === "object" && Object.keys(a.channels).join(", "),
      ].filter(Boolean);
      return `${who}: ${what.join(", ") || "no change"}${a.cue ? ` in cue ${a.cue}` : ""}${inStep(a)}${inSong(a)}`;
    },
    run: (a) => {
      const songId = songArg(a);
      const index = cueArg(a, songId, true);
      const names = api().faders();
      const faderName = (n: number) => names[n - 1]?.name ?? "";
      const all = new Map<number, number>();
      const report = findFixtures(api().fixtures(), a.fixtures).map((f) => {
        const { cells, set, missing } = fixtureLevels(fixtureRoles(f, faderName), a);
        for (const [fader, v] of cells) all.set(fader, v);
        return { fixture: f.name, set, ...(missing.length ? { noSuchChannel: missing } : {}) };
      });
      if (!all.size) throw new Error(`Nothing to set: ${report.map((r) => `${r.fixture} has no ${r.noSuchChannel?.join(" / ") ?? "matching channel"}`).join("; ")}`);
      const step = stepArg(a, songId, index);
      api().setCueLevels(songId, index, [...all].map(([f, v]) => [f - 1, v]), step);
      return { song: songName(songId), cue: index + 1, ...(step != null ? { step: step + 1 } : {}), fixtures: report };
    },
  },
  {
    name: "patch_fader",
    description:
      "Patch a fader to DMX channels (it drives all of them; an empty list unpatches it) and / or rename it. Addresses: \"45\", or \"2/45\" for universe 2 channel 45. Each channel can have a max: the level (0–255) it gets when the fader is full (a proportional patch; default: what it had, else 255). list_fixtures and get_cue show the faders.",
    schema: {
      type: "object",
      properties: {
        fader: { type: "integer", minimum: 1, maximum: 256 },
        channels: {
          type: "array",
          items: {
            type: "object",
            properties: { address: { type: "string" }, max: { type: "integer", minimum: 0, maximum: 255 } },
            required: ["address"],
            additionalProperties: false,
          },
          description: "What it drives; replaces what it drives now",
        },
        name: { type: "string", maxLength: 40, description: "Its name (\"\" = the default, \"Fader N\")" },
      },
      required: ["fader"],
      additionalProperties: false,
    },
    describe: (a) =>
      `Fader ${a.fader}: ${[Array.isArray(a.channels) && (a.channels.length ? `patch to ${a.channels.map((c) => { const t = (c ?? {}) as Args; return t.max == null ? t.address : `${t.address} (max ${t.max})`; }).join(", ")}` : "unpatch"), a.name != null && `name "${a.name}"`].filter(Boolean).join(", ") || "no change"}`,
    run: (a) => {
      if (a.channels == null && a.name == null) throw new Error("Give channels and / or a name");
      if (a.channels != null && !Array.isArray(a.channels)) throw new Error("channels must be a list");
      const channels = (a.channels as unknown[] | undefined)?.map((c) => {
        const t = (typeof c === "string" ? { address: c } : (c ?? {})) as Args;
        return { address: String(t.address ?? ""), max: t.max == null ? undefined : level(t.max, "max") };
      });
      return api().patchFader(number(a.fader, 256, "fader") - 1, { channels, name: a.name == null ? undefined : String(a.name) });
    },
  },
  {
    name: "add_fixtures",
    description:
      "Add console fixtures that aren't on the stage (to put a fixture on the stage too, use place_fixtures instead: it makes the console fixture itself). Each gets the next free block of DMX channels and one fader per channel, named after it and what the channel does. Several at once are numbered (\"Par\" ×3 → Par 1, Par 2, Par 3).",
    schema: {
      type: "object",
      properties: {
        name: { type: "string", maxLength: 40 },
        channels: { type: "integer", minimum: 1, maximum: 64, description: "DMX channels each one uses" },
        quantity: { type: "integer", minimum: 1, maximum: 16, description: "How many (default 1)" },
        roles: {
          type: "array",
          items: { type: "string", enum: [...DMX_ATTRS, "other"] },
          description: "What each channel does, in order. Lets set_fixture set its dimmer, color, pan / tilt.",
        },
        group: { type: "string", maxLength: 40, description: "Put them in this group (made if new)" },
        universe: { type: "integer", minimum: 1, description: "Only in this universe" },
      },
      required: ["name", "channels"],
      additionalProperties: false,
    },
    describe: (a) => `Add ${a.quantity && Number(a.quantity) > 1 ? `${a.quantity}× ` : ""}fixture "${a.name}" (${a.channels} ch)`,
    run: (a) => {
      const name = String(a.name ?? "").trim();
      if (!name) throw new Error("Give the fixture a name");
      const channels = number(a.channels, 64, "channels");
      const roles = (Array.isArray(a.roles) ? a.roles : []).map((r) => {
        if (r == null || r === "other") return null;
        if (!isDmxAttr(r)) throw new Error(`"${r}" isn't a channel role (${DMX_ATTRS.join(", ")})`);
        return r;
      });
      if (roles.length > channels) throw new Error(`${roles.length} roles for ${channels} channels`);
      const colors = roles.filter((r) => r && isColorRole(r)).length;
      const results = api().addFixtures({
        name,
        channels,
        qty: a.quantity == null ? 1 : number(a.quantity, 16, "quantity"),
        roles,
        group: a.group == null || a.group === "" ? null : String(a.group),
        universe: a.universe == null ? null : Number(a.universe),
        mount: roles.includes("pan") || roles.includes("tilt") ? "movable" : "fixed",
        color: colors > 1 ? "multi" : "single",
      });
      if (results.every((r) => "error" in r)) throw new Error(results.map((r) => `${r.name}: ${"error" in r ? r.error : ""}`).join("; "));
      return results;
    },
  },
  {
    name: "edit_fixture",
    description:
      "Change a console fixture: rename it (its faders named after it follow), move it into a group by name (\"\" = no group; a new name makes the group), give it another DMX start address and / or channel count (the faders patched into it move with it, and a linked stage fixture follows), or change its type (fixed / movable, single / multi-color).",
    schema: {
      type: "object",
      properties: {
        fixture: { type: "string", description: "The fixture's name" },
        name: { type: "string", maxLength: 40 },
        group: { type: "string", maxLength: 40 },
        start: { type: "string", description: "DMX start address: 45, or 2/45 for universe 2" },
        channels: { type: "integer", minimum: 1, maximum: 64 },
        mount: { type: "string", enum: ["fixed", "movable"] },
        color: { type: "string", enum: ["single", "multi"] },
      },
      required: ["fixture"],
      additionalProperties: false,
    },
    describe: (a) =>
      `Fixture ${a.fixture}: ${[
        a.name != null && `name "${a.name}"`,
        a.group != null && (a.group ? `group "${a.group}"` : "no group"),
        a.start != null && `start ${a.start}`,
        a.channels != null && `${a.channels} ch`,
        a.mount != null && a.mount,
        a.color != null && `${a.color}-color`,
      ].filter(Boolean).join(", ") || "no change"}`,
    run: (a) => {
      const keys = ["name", "group", "start", "channels", "mount", "color"];
      if (keys.every((k) => a[k] == null)) throw new Error(`Give one of ${keys.join(", ")}`);
      const [f, ...more] = findFixtures(api().fixtures(), [a.fixture]);
      if (more.length) throw new Error(`"${a.fixture}" is a group: name one fixture`);
      if (a.mount != null && a.mount !== "fixed" && a.mount !== "movable") throw new Error("mount must be fixed or movable");
      if (a.color != null && a.color !== "single" && a.color !== "multi") throw new Error("color must be single or multi");
      return api().editFixture(f.id, {
        name: a.name == null ? undefined : String(a.name),
        group: a.group == null ? undefined : String(a.group),
        start: a.start == null ? undefined : String(a.start),
        channels: a.channels == null ? undefined : number(a.channels, 64, "channels"),
        mount: a.mount ?? undefined,
        color: a.color ?? undefined,
      });
    },
  },
  {
    name: "delete_console_fixtures",
    description:
      "Delete console fixtures that aren't on the stage: their faders are unpatched, get their default names back and go to 0 in every cue. A fixture placed on the stage is deleted there instead (delete_fixtures), which removes its console fixture too.",
    schema: {
      type: "object",
      properties: { fixtures: { type: "array", minItems: 1, items: { type: "string" }, description: "Fixture names, group names, or \"all\"" } },
      required: ["fixtures"],
      additionalProperties: false,
    },
    describe: (a) => `Delete console fixtures ${Array.isArray(a.fixtures) ? a.fixtures.join(", ") : a.fixtures}`,
    run: (a) => {
      const found = findFixtures(api().fixtures(), a.fixtures);
      const onStage = new Set(window.stageChat?.consoleIds() ?? []);
      const staged = found.filter((f) => onStage.has(f.id));
      if (staged.length) throw new Error(`On the stage (delete them there with delete_fixtures): ${staged.map((f) => f.name).join(", ")}`);
      api().deleteFixtures(found.map((f) => f.id));
      return { deleted: found.map((f) => f.name) };
    },
  },
  {
    name: "edit_group",
    description: "Rename a fixture group, or delete it (its fixtures stay, ungrouped). get_groups lists them.",
    schema: {
      type: "object",
      properties: { group: { type: "string" }, name: { type: "string", maxLength: 40, description: "New name" }, delete: { type: "boolean" } },
      required: ["group"],
      additionalProperties: false,
    },
    describe: (a) => (a.delete ? `Delete group ${a.group}` : `Rename group ${a.group} to "${a.name}"`),
    run: (a) => {
      if ((a.name == null) === (a.delete !== true)) throw new Error("Give either a new name or delete: true");
      if (a.delete === true) {
        api().deleteGroup(String(a.group ?? ""));
        return { groups: api().groups() };
      }
      return { name: api().renameGroup(String(a.group ?? ""), String(a.name ?? "")) };
    },
  },
  {
    name: "get_groups",
    description: "The console's fixture groups and the fixtures in each.",
    schema: NO_ARGS,
    describe: () => "Looked at the groups",
    run: () => api().groups(),
  },
];

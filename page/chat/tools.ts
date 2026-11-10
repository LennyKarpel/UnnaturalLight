/**
 * The chat's tools: what the model may look at and do. Each runs here in
 * the page and calls the console (window.consoleChat, console/app.ts), the
 * same as its own controls, so changes reach the show server and the other
 * windows the usual way.
 *
 * Add a tool: give it a name, a description the model reads, a JSON Schema
 * for its arguments, a short line for the chat (`describe`) and `run`.
 * Tools run as soon as the model calls them: nothing asks first.
 */

import type { ChatTool } from "../../shared/chat-protocol.ts";
import type { ConsoleChat } from "../../console/app.ts";
import { DMX_ATTRS, DMX_SHORT, isDmxAttr, type DmxAttr } from "../../shared/attributes.ts";
import { COLOR_ROLES, isColorRole, levelsFromColor } from "../../shared/color.ts";

export type Args = Record<string, unknown>;

export type ToolDef = ChatTool & {
  describe: (args: Args) => string;
  /** Returns what the model is told (an object is sent as JSON). Throws to report an error. */
  run: (args: Args) => unknown;
};

function api(): ConsoleChat {
  const c = window.consoleChat;
  if (!c) throw new Error("The console isn't ready yet");
  return c;
}

const percent = (v: unknown, what: string): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`${what} must be 0–100`);
  return n;
};

/** A 1-based number from 1 to `max`. */
const number = (v: unknown, max: number, what: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`${what} must be 1–${max}`);
  return n;
};

/** A song by its number (1 = first in the show) or name (exact, else the one whose name contains it). */
export function findSong(songs: { id: string; name: string; cues: number }[], query: unknown) {
  const q = String(query ?? "").trim();
  if (/^\d+$/.test(q)) {
    const n = Number(q);
    if (n >= 1 && n <= songs.length) return songs[n - 1];
  }
  const lower = q.toLowerCase();
  if (!lower) throw new Error("Which song? Give its number or name");
  const exact = songs.filter((s) => s.name.toLowerCase() === lower);
  if (exact.length === 1) return exact[0];
  const partial = songs.filter((s) => s.name.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0];
  const names = (exact.length > 1 ? exact : partial).map((s) => `"${s.name}"`);
  throw new Error(names.length > 1 ? `"${q}" matches ${names.join(", ")}: which one?` : `No song "${q}"`);
}

/** Where playback is after an action: what the model is told. */
const playing = () => api().show().playing;

const NO_ARGS = { type: "object", properties: {}, additionalProperties: false };

const PLAYBACK_TOOLS: ToolDef[] = [
  {
    name: "get_show",
    description:
      "The show now: what's playing (song, LIVE cue, UP NEXT cue and its fade time, whether a transition is running), master and crossfader levels, the active set's song order, and every song with its numbered cues.",
    schema: NO_ARGS,
    describe: () => "Looked at the show",
    run: () => api().show(),
  },
  {
    name: "select_song",
    description:
      "Play a song: its cue (cue 1 unless given) goes LIVE at once, with no fade, and any running transition stops. Find the song by its number in the show or its name.",
    schema: {
      type: "object",
      properties: {
        song: { type: "string", description: "The song's number in the show (\"3\") or its name" },
        cue: { type: "integer", minimum: 1, description: "Cue number in that song to start on (default 1)" },
      },
      required: ["song"],
      additionalProperties: false,
    },
    describe: (a) => `Play song ${a.song}${a.cue ? ` from cue ${a.cue}` : ""}`,
    run: (a) => {
      const song = findSong(api().songs(), a.song);
      const cue = a.cue == null ? 1 : number(a.cue, song.cues, "cue");
      api().playSong(song.id, cue - 1);
      return playing();
    },
  },
  {
    name: "select_cue",
    description: "Make a cue of the playing song LIVE at once, with no fade (any running transition stops). Use go to fade instead.",
    schema: {
      type: "object",
      properties: { cue: { type: "integer", minimum: 1, description: "Cue number in the playing song" } },
      required: ["cue"],
      additionalProperties: false,
    },
    describe: (a) => `Make cue ${a.cue} LIVE`,
    run: (a) => {
      const show = api().show();
      const cues = show.songs[show.playing.song.number - 1]?.cues.length ?? 0;
      api().makeLive(number(a.cue, cues, "cue") - 1);
      return playing();
    },
  },
  {
    name: "go",
    description: "GO: fade from LIVE to UP NEXT over UP NEXT's fade time (the show server runs the fade).",
    schema: NO_ARGS,
    describe: () => {
      const next = window.consoleChat?.show().playing.upNext;
      return next ? `GO → ${next.label}` : "GO";
    },
    run: () => {
      if (!api().go()) throw new Error(api().show().serverConnected ? "Nothing is UP NEXT (end of the set)" : "The show server is offline");
      return playing();
    },
  },
  {
    name: "control_transition",
    description: "Pause, resume or stop the running transition (a GO fade). Stop leaves it where it is.",
    schema: {
      type: "object",
      properties: { action: { type: "string", enum: ["pause", "resume", "stop"] } },
      required: ["action"],
      additionalProperties: false,
    },
    describe: (a) => `${String(a.action ?? "").replace(/^./, (c) => c.toUpperCase())} the transition`,
    run: (a) => {
      const state = playing().transition;
      if (a.action === "stop") api().stop();
      else if (a.action === "pause" || a.action === "resume") {
        if (state === "none") throw new Error("No transition is running");
        if ((a.action === "pause") === (state === "running")) api().pause();
      } else throw new Error("action must be pause, resume or stop");
      return playing();
    },
  },
  {
    name: "set_levels",
    description: "Set the master (overall level) and/or the crossfader (0 = all LIVE, 100 = all UP NEXT; moving it stops a running transition), in percent.",
    schema: {
      type: "object",
      properties: {
        master: { type: "number", minimum: 0, maximum: 100 },
        crossfader: { type: "number", minimum: 0, maximum: 100 },
      },
      additionalProperties: false,
    },
    describe: (a) =>
      [a.master != null && `Master → ${Math.round(Number(a.master))}%`, a.crossfader != null && `Crossfader → ${Math.round(Number(a.crossfader))}%`]
        .filter(Boolean)
        .join(", ") || "Set levels",
    run: (a) => {
      if (a.master == null && a.crossfader == null) throw new Error("Give master and/or crossfader");
      const master = a.master == null ? null : percent(a.master, "master");
      const cross = a.crossfader == null ? null : percent(a.crossfader, "crossfader");
      if (master != null) api().setMaster(master);
      if (cross != null) api().setCrossfader(cross);
      const { master: m, crossfader: c } = api().show();
      return { master: m, crossfader: c };
    },
  },
];

// --- cues and songs (round 2) ---------------------------------------------------

/** The song a tool means: `song` (its number or name), or null = the playing song. */
const songArg = (a: Args): string | null => (a.song == null || a.song === "" ? null : findSong(api().songs(), a.song).id);

function playingSongId() {
  return api().songs()[api().show().playing.song.number - 1]?.id ?? null;
}

/**
 * The cue a tool means, as a 0-based index: `cue` (its number in the song),
 * or, when `liveByDefault` and it's the playing song, the LIVE cue.
 */
function cueArg(a: Args, songId: string | null, liveByDefault: boolean): number {
  const id = songId ?? playingSongId();
  const song = api().songs().find((s) => s.id === id);
  if (!song) throw new Error("No such song");
  if (a.cue == null) {
    if (liveByDefault && id === playingSongId()) return api().show().playing.live.cue - 1;
    throw new Error("Which cue? Give its number");
  }
  return number(a.cue, song.cues, "cue") - 1;
}

const songName = (songId: string | null) => api().songs().find((s) => s.id === (songId ?? playingSongId()))?.name ?? "?";
const level = (v: unknown, what: string): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 255) throw new Error(`${what} must be 0–255`);
  return Math.round(n);
};
const inSong = (a: Args) => (a.song ? ` of song ${a.song}` : "");

const SONG = { type: "string", description: "The song's number in the show or its name (default: the playing song)" };
const CUE = { type: "integer", minimum: 1, description: "Cue number in the song" };

const CUE_TOOLS: ToolDef[] = [
  {
    name: "get_cue",
    description:
      "A cue's name, fade time (seconds) and the level (0–255) of every fader that's patched or not at 0, with the fader's number and name. Default: the LIVE cue.",
    schema: { type: "object", properties: { song: SONG, cue: CUE }, additionalProperties: false },
    describe: (a) => `Looked at ${a.cue ? `cue ${a.cue}` : "the LIVE cue"}${inSong(a)}`,
    run: (a) => {
      const songId = songArg(a);
      const index = cueArg(a, songId, true);
      const cue = api().cue(songId, index);
      const faders = api().faders();
      return {
        song: songName(songId),
        cue: index + 1,
        name: cue.name,
        fadeSeconds: cue.fadeSeconds,
        levels: faders.filter((f) => f.patched || cue.levels[f.fader - 1] > 0).map((f) => ({ fader: f.fader, name: f.name, level: cue.levels[f.fader - 1] })),
      };
    },
  },
  {
    name: "set_cue_levels",
    description:
      "Set fader levels (0–255; 255 = full) in a cue. Default: the LIVE cue, so the lights change at once. Use list_fixtures or get_cue to find fader numbers; set_fixture is easier for a fixture's dimmer, color or position.",
    schema: {
      type: "object",
      properties: {
        song: SONG,
        cue: CUE,
        levels: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: { fader: { type: "integer", minimum: 1, maximum: 256 }, level: { type: "integer", minimum: 0, maximum: 255 } },
            required: ["fader", "level"],
            additionalProperties: false,
          },
        },
      },
      required: ["levels"],
      additionalProperties: false,
    },
    describe: (a) => {
      const n = Array.isArray(a.levels) ? a.levels.length : 0;
      return `Set ${n} fader${n === 1 ? "" : "s"} in ${a.cue ? `cue ${a.cue}` : "the LIVE cue"}${inSong(a)}`;
    },
    run: (a) => {
      const songId = songArg(a);
      const index = cueArg(a, songId, true);
      if (!Array.isArray(a.levels) || !a.levels.length) throw new Error("Give levels: [{ fader, level }]");
      const cells = a.levels.map((c): [number, number] => {
        const cell = c as Args;
        return [number(cell.fader, 256, "fader") - 1, level(cell.level, "level")];
      });
      api().setCueLevels(songId, index, cells);
      return { song: songName(songId), cue: index + 1, set: cells.map(([f, l]) => ({ fader: f + 1, level: l })) };
    },
  },
  {
    name: "add_cue",
    description:
      "Add a cue to a song: blank (all faders at 0), or a copy of another cue. It goes at the end unless `after` is given. Nothing changes on stage: LIVE stays where it is (UP NEXT may become the new cue).",
    schema: {
      type: "object",
      properties: {
        song: SONG,
        after: { type: "integer", minimum: 1, description: "Put it after this cue number (default: at the end)" },
        copy_of: { type: "integer", minimum: 1, description: "Copy this cue's levels and fade time" },
        name: { type: "string", maxLength: 40 },
        fade_seconds: { type: "integer", minimum: 0, maximum: 20 },
      },
      additionalProperties: false,
    },
    describe: (a) => `Add a cue${a.copy_of ? ` (copy of cue ${a.copy_of})` : ""}${a.name ? ` "${a.name}"` : ""}${inSong(a)}`,
    run: (a) => {
      const songId = songArg(a);
      const cues = api().songs().find((s) => s.id === (songId ?? playingSongId()))?.cues ?? 0;
      const after = a.after == null ? undefined : number(a.after, cues, "after") - 1;
      const copyOf = a.copy_of == null ? undefined : number(a.copy_of, cues, "copy_of") - 1;
      const at = api().addCue(songId, {
        after,
        copyOf,
        name: a.name == null ? undefined : String(a.name),
        fadeSeconds: a.fade_seconds == null ? undefined : Number(a.fade_seconds),
      });
      return { song: songName(songId), added: at + 1, playing: playing() };
    },
  },
  {
    name: "edit_cue",
    description: "Rename a cue (empty name = just \"Cue N\") and/or set its fade time: the seconds GO takes to fade into it.",
    schema: {
      type: "object",
      properties: { song: SONG, cue: CUE, name: { type: "string", maxLength: 40 }, fade_seconds: { type: "integer", minimum: 0, maximum: 20 } },
      required: ["cue"],
      additionalProperties: false,
    },
    describe: (a) =>
      `Cue ${a.cue}${inSong(a)}: ${[a.name != null && `name "${a.name}"`, a.fade_seconds != null && `fade ${a.fade_seconds}s`].filter(Boolean).join(", ") || "no change"}`,
    run: (a) => {
      if (a.name == null && a.fade_seconds == null) throw new Error("Give a name and/or fade_seconds");
      const songId = songArg(a);
      const index = cueArg(a, songId, false);
      const fade = a.fade_seconds == null ? undefined : Number(a.fade_seconds);
      if (fade != null && (!Number.isFinite(fade) || fade < 0 || fade > 20)) throw new Error("fade_seconds must be 0–20");
      return { cue: index + 1, ...api().editCue(songId, index, { name: a.name == null ? undefined : String(a.name), fadeSeconds: fade }) };
    },
  },
  {
    name: "delete_cue",
    description: "Delete a cue from a song (a song keeps at least 2 cues). Later cues move up a number.",
    schema: { type: "object", properties: { song: SONG, cue: CUE }, required: ["cue"], additionalProperties: false },
    describe: (a) => `Delete cue ${a.cue}${inSong(a)}`,
    run: (a) => {
      const songId = songArg(a);
      const index = cueArg(a, songId, false);
      api().deleteCue(songId, index);
      return { deleted: index + 1, playing: playing() };
    },
  },
  {
    name: "add_song",
    description: "Add a new song (two blank cues) at the end of the show. It isn't played; use select_song for that.",
    schema: { type: "object", properties: { name: { type: "string", maxLength: 40 } }, required: ["name"], additionalProperties: false },
    describe: (a) => `Add song "${a.name}"`,
    run: (a) => {
      api().addSong(String(a.name ?? ""));
      return { songs: api().songs().map((s, i) => `${i + 1}. ${s.name}`) };
    },
  },
  {
    name: "rename_song",
    description: "Rename a song.",
    schema: { type: "object", properties: { song: SONG, name: { type: "string", maxLength: 40 } }, required: ["song", "name"], additionalProperties: false },
    describe: (a) => `Rename song ${a.song} to "${a.name}"`,
    run: (a) => ({ name: api().renameSong(findSong(api().songs(), a.song).id, String(a.name ?? "")) }),
  },
];

// --- fixtures (round 2) ---------------------------------------------------------

export type FixtureInfo = ReturnType<ConsoleChat["fixtures"]>[number];

/**
 * Fixtures by name: each query is a fixture's name, a group's name or "all"
 * (exact, ignoring case), else the one fixture whose name contains it.
 */
export function findFixtures(all: FixtureInfo[], queries: unknown): FixtureInfo[] {
  const list = (Array.isArray(queries) ? queries : [queries]).map((q) => String(q ?? "").trim()).filter(Boolean);
  if (!list.length) throw new Error("Which fixtures? Give names, group names or \"all\"");
  const found = new Set<FixtureInfo>();
  for (const q of list) {
    const lower = q.toLowerCase();
    let hits = lower === "all" ? all : all.filter((f) => f.name.toLowerCase() === lower);
    if (!hits.length) hits = all.filter((f) => f.group?.toLowerCase() === lower);
    if (!hits.length) {
      const partial = all.filter((f) => f.name.toLowerCase().includes(lower));
      if (partial.length > 1) throw new Error(`"${q}" matches ${partial.map((f) => `"${f.name}"`).join(", ")}: which one(s)?`);
      hits = partial;
    }
    if (!hits.length) throw new Error(`No fixture or group "${q}"`);
    for (const f of hits) found.add(f);
  }
  return [...found];
}

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

const FIXTURE_TOOLS: ToolDef[] = [
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
      return `${who}: ${what.join(", ") || "no change"}${a.cue ? ` in cue ${a.cue}` : ""}${inSong(a)}`;
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
      api().setCueLevels(songId, index, [...all].map(([f, v]) => [f - 1, v]));
      return { song: songName(songId), cue: index + 1, fixtures: report };
    },
  },
];

export const TOOLS: ToolDef[] = [...PLAYBACK_TOOLS, ...CUE_TOOLS, ...FIXTURE_TOOLS];
export const toolByName = new Map(TOOLS.map((t) => [t.name, t]));

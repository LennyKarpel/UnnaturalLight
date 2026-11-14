/**
 * The chat's tools: what the model may look at and do. Each runs here in
 * the page and calls the console (window.consoleChat, console/app.ts) or the
 * stage (window.stageChat, stage/chat-hooks.ts, tools in ./stage-tools.ts), the
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
import { STAGE_TOOLS } from "./stage-tools.ts";
import { findFixtures, findSet, findSong } from "./find.ts";

export { findFixtures, findSong };

export type Args = Record<string, unknown>;

export type ToolDef = ChatTool & {
  describe: (args: Args) => string;
  /** Returns what the model is told (an object is sent as JSON), or a promise of it. Throws (or rejects) to report an error. */
  run: (args: Args) => unknown;
};

function api(): ConsoleChat {
  const c = window.consoleChat;
  if (!c) throw new Error("The console isn't ready yet");
  return c;
}

/** A named stage position's name from its id (the stage holds them). */
const positionName = (id: string) => window.stageChat?.stage().positions.find((p) => p.id === id)?.name ?? "(deleted)";

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

/** Where playback is after an action: what the model is told. */
const playing = () => api().show().playing;

/** The show's songs, numbered: what the model is told after changing them. */
const songList = () => api().songs().map((s, i) => `${i + 1}. ${s.name}`);

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
    description:
      "GO: fade from LIVE to UP NEXT over UP NEXT's fade time (through its steps, if it has any; the show server runs the fade). step: \"next\" fades only to the next look (a cue's next step, or UP NEXT), \"back\" to the look before, like the console's Step buttons.",
    schema: { type: "object", properties: { step: { type: "string", enum: ["next", "back"] } }, additionalProperties: false },
    describe: (a) => {
      if (a.step) return a.step === "back" ? "Step back" : "Step";
      const next = window.consoleChat?.show().playing.upNext;
      return next ? `GO → ${next.label}` : "GO";
    },
    run: (a) => {
      if (a.step != null) {
        if (a.step !== "next" && a.step !== "back") throw new Error("step must be next or back");
        if (!api().step(a.step === "back")) throw new Error(api().show().serverConnected ? `Nothing to step ${a.step === "back" ? "back to" : "to"}` : "The show server is offline");
        return playing();
      }
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
    description:
      "Set the master (overall level), the crossfader (0 = all LIVE, 100 = all UP NEXT; moving it stops a running transition) and / or the LIVE and UP NEXT submasters (they scale those cues before the blend), in percent.",
    schema: {
      type: "object",
      properties: {
        master: { type: "number", minimum: 0, maximum: 100 },
        crossfader: { type: "number", minimum: 0, maximum: 100 },
        live_submaster: { type: "number", minimum: 0, maximum: 100 },
        up_next_submaster: { type: "number", minimum: 0, maximum: 100 },
      },
      additionalProperties: false,
    },
    describe: (a) =>
      [
        a.master != null && `Master → ${Math.round(Number(a.master))}%`,
        a.crossfader != null && `Crossfader → ${Math.round(Number(a.crossfader))}%`,
        a.live_submaster != null && `LIVE sub → ${Math.round(Number(a.live_submaster))}%`,
        a.up_next_submaster != null && `UP NEXT sub → ${Math.round(Number(a.up_next_submaster))}%`,
      ]
        .filter(Boolean)
        .join(", ") || "Set levels",
    run: (a) => {
      if (a.master == null && a.crossfader == null && a.live_submaster == null && a.up_next_submaster == null) throw new Error("Give master, crossfader or a submaster");
      const master = a.master == null ? null : percent(a.master, "master");
      const cross = a.crossfader == null ? null : percent(a.crossfader, "crossfader");
      const live = a.live_submaster == null ? undefined : percent(a.live_submaster, "live_submaster");
      const upNext = a.up_next_submaster == null ? undefined : percent(a.up_next_submaster, "up_next_submaster");
      if (master != null) api().setMaster(master);
      if (cross != null) api().setCrossfader(cross);
      if (live != null || upNext != null) api().setSubmasters(live, upNext);
      const { master: m, crossfader: c, submasters } = api().show();
      return { master: m, crossfader: c, submasters };
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

/** A song's cues, numbered and named. */
const cueNames = (songId: string | null) => {
  const show = api().show();
  const id = songId ?? playingSongId();
  const n = api().songs().findIndex((s) => s.id === id);
  return (show.songs[n]?.cues ?? []).map((c) => `${c.number}. ${c.name || `Cue ${c.number}`}`);
};
const songName = (songId: string | null) => api().songs().find((s) => s.id === (songId ?? playingSongId()))?.name ?? "?";
const level = (v: unknown, what: string): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 255) throw new Error(`${what} must be 0–255`);
  return Math.round(n);
};
const inSong = (a: Args) => (a.song ? ` of song ${a.song}` : "");

const SONG = { type: "string", description: "The song's number in the show or its name (default: the playing song)" };
const CUE = { type: "integer", minimum: 1, description: "Cue number in the song" };
const STEP = { type: "integer", minimum: 1, description: "Step number in the cue (1 = the first look GO passes through). Leave out for the cue's own look, where GO ends." };
const TIME = { type: "integer", minimum: 0, maximum: 20 };

/** A cue's step a tool means, 0-based, or undefined for the cue's own look. */
function stepArg(a: Args, songId: string | null, index: number): number | undefined {
  if (a.step == null) return undefined;
  const steps = api().cue(songId, index).steps.length;
  if (!steps) throw new Error(`Cue ${index + 1} has no steps`);
  return number(a.step, steps, "step") - 1;
}

const seconds = (v: unknown, what: string): number | undefined => {
  if (v == null) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 20) throw new Error(`${what} must be 0–20`);
  return n;
};
const inStep = (a: Args) => (a.step ? ` step ${a.step}` : "");

const CUE_TOOLS: ToolDef[] = [
  {
    name: "get_cue",
    description:
      "A cue's name, fade time (seconds), its steps (looks GO passes through first: fade and hold each), the level (0–255) of every fader that's patched or not at 0, with the fader's number and name, and which fixtures it aims at named stage positions. Default: the LIVE cue's own look; give step for a step's levels.",
    schema: { type: "object", properties: { song: SONG, cue: CUE, step: STEP }, additionalProperties: false },
    describe: (a) => `Looked at ${a.cue ? `cue ${a.cue}` : "the LIVE cue"}${inStep(a)}${inSong(a)}`,
    run: (a) => {
      const songId = songArg(a);
      const index = cueArg(a, songId, true);
      const step = stepArg(a, songId, index);
      const cue = api().cue(songId, index);
      const look = step == null ? cue : cue.steps[step];
      const faders = api().faders();
      return {
        song: songName(songId),
        cue: index + 1,
        name: cue.name,
        fadeSeconds: cue.fadeSeconds,
        ...(cue.steps.length ? { steps: cue.steps.map((st, k) => ({ step: k + 1, fadeSeconds: st.fadeSeconds, holdSeconds: st.holdSeconds })) } : {}),
        ...(step != null ? { levelsOfStep: step + 1 } : {}),
        levels: faders.filter((f) => f.patched || look.levels[f.fader - 1] > 0).map((f) => ({ fader: f.fader, name: f.name, level: look.levels[f.fader - 1] })),
        ...(look.aims.length ? { aimedAtPositions: look.aims.map((a) => ({ fixture: a.fixture, position: positionName(a.position) })) } : {}),
      };
    },
  },
  {
    name: "set_cue_levels",
    description:
      "Set fader levels (0–255; 255 = full) in a cue (its own look, or one of its steps). Default: the LIVE cue, so the lights change at once. Use list_fixtures or get_cue to find fader numbers; set_fixture is easier for a fixture's dimmer, color or pan / tilt.",
    schema: {
      type: "object",
      properties: {
        song: SONG,
        cue: CUE,
        step: STEP,
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
      return `Set ${n} fader${n === 1 ? "" : "s"} in ${a.cue ? `cue ${a.cue}` : "the LIVE cue"}${inStep(a)}${inSong(a)}`;
    },
    run: (a) => {
      const songId = songArg(a);
      const index = cueArg(a, songId, true);
      if (!Array.isArray(a.levels) || !a.levels.length) throw new Error("Give levels: [{ fader, level }]");
      const cells = a.levels.map((c): [number, number] => {
        const cell = c as Args;
        return [number(cell.fader, 256, "fader") - 1, level(cell.level, "level")];
      });
      const step = stepArg(a, songId, index);
      api().setCueLevels(songId, index, cells, step);
      return { song: songName(songId), cue: index + 1, ...(step != null ? { step: step + 1 } : {}), set: cells.map(([f, l]) => ({ fader: f + 1, level: l })) };
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
    description: "Delete one of a song's cues (a song keeps at least 2). Later cues move up a number.",
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
    name: "move_cue",
    description: "Move a cue to another place in its song (cues between move up or down a number). LIVE stays on the same cue.",
    schema: {
      type: "object",
      properties: { song: SONG, cue: CUE, to: { type: "integer", minimum: 1, description: "Its new number in the song" } },
      required: ["cue", "to"],
      additionalProperties: false,
    },
    describe: (a) => `Move cue ${a.cue} to ${a.to}${inSong(a)}`,
    run: (a) => {
      const songId = songArg(a);
      const index = cueArg(a, songId, false);
      const to = cueArg({ cue: a.to }, songId, false);
      api().moveCue(songId, index, to);
      return { song: songName(songId), cues: cueNames(songId), playing: playing() };
    },
  },
  {
    name: "copy_levels",
    description:
      "Copy levels from one cue (or step) to another: every fader, or only the given fixtures' faders. The target defaults to the LIVE cue. Also good for \"make cue 4 look like cue 2\" or \"copy the wash from song 1\".",
    schema: {
      type: "object",
      properties: {
        from_song: { ...SONG, description: "The song to copy from (default: the target's song)" },
        from_cue: { ...CUE, description: "Cue to copy from" },
        from_step: { ...STEP, description: "A step of that cue to copy from (default: its own look)" },
        song: { ...SONG, description: "The song to copy into (default: the playing song)" },
        cue: { ...CUE, description: "Cue to copy into (default: the LIVE cue)" },
        step: { ...STEP, description: "A step of that cue to copy into (default: its own look)" },
        fixtures: { type: "array", items: { type: "string" }, description: "Only these fixtures' faders (names, group names); default: every fader" },
      },
      required: ["from_cue"],
      additionalProperties: false,
    },
    describe: (a) => {
      const who = Array.isArray(a.fixtures) && a.fixtures.length ? `${a.fixtures.join(", ")} ` : "";
      const from = `cue ${a.from_cue}${a.from_step ? ` step ${a.from_step}` : ""}${a.from_song ? ` of song ${a.from_song}` : ""}`;
      return `Copy ${who}levels from ${from} to ${a.cue ? `cue ${a.cue}` : "the LIVE cue"}${inStep(a)}${inSong(a)}`;
    },
    run: (a) => {
      const songId = songArg(a);
      const index = cueArg(a, songId, true);
      const step = stepArg(a, songId, index);
      const fromSongId = a.from_song == null || a.from_song === "" ? songId : findSong(api().songs(), a.from_song).id;
      const from = { song: fromSongId, cue: a.from_cue, step: a.from_step };
      const fromIndex = cueArg(from, fromSongId, false);
      const fromStep = stepArg(from, fromSongId, fromIndex);
      const source = api().cue(fromSongId, fromIndex);
      const levels = (fromStep == null ? source : source.steps[fromStep]).levels;
      let faders: number[];
      if (Array.isArray(a.fixtures) && a.fixtures.length) {
        faders = [...new Set(findFixtures(api().fixtures(), a.fixtures).flatMap((f) => f.channels.flatMap((c) => c.faders)))].map((n) => n - 1);
        if (!faders.length) throw new Error("Those fixtures have no faders");
      } else {
        faders = levels.map((_, i) => i);
      }
      api().setCueLevels(songId, index, faders.map((i) => [i, levels[i]]), step);
      return { song: songName(songId), cue: index + 1, ...(step != null ? { step: step + 1 } : {}), copiedFaders: faders.length };
    },
  },
  {
    name: "add_step",
    description:
      "Add a step to a cue: a look GO passes through on the way into the cue (e.g. Build → Hit → the cue's own look), at most 15. It's a copy of the cue's own look (or of another step) to change with set_fixture / set_cue_levels and step. It goes last (just before the cue's own look) unless after is given.",
    schema: {
      type: "object",
      properties: {
        song: SONG,
        cue: { ...CUE, description: "Cue number in the song (default: the LIVE cue)" },
        after: { type: "integer", minimum: 0, description: "Put it after this step (0 = first)" },
        copy_of: { ...STEP, description: "Copy this step's look (default: the cue's own look)" },
        fade_seconds: { ...TIME, description: "Seconds to fade into it (default: what it copies)" },
        hold_seconds: { ...TIME, description: "Seconds GO stays on it before the next look fades in (default 0)" },
      },
      additionalProperties: false,
    },
    describe: (a) => `Add a step to ${a.cue ? `cue ${a.cue}` : "the LIVE cue"}${inSong(a)}`,
    run: (a) => {
      const songId = songArg(a);
      const index = cueArg(a, songId, true);
      const steps = api().cue(songId, index).steps.length;
      const at = a.after == null ? undefined : Number(a.after) === 0 ? 0 : number(a.after, steps, "after");
      const copyOf = a.copy_of == null ? undefined : stepArg({ step: a.copy_of }, songId, index);
      const step = api().addStep(songId, index, { at, copyOf, fadeSeconds: seconds(a.fade_seconds, "fade_seconds"), holdSeconds: seconds(a.hold_seconds, "hold_seconds") });
      return { song: songName(songId), cue: index + 1, added: step + 1, steps: api().cue(songId, index).steps.map((st, k) => ({ step: k + 1, fadeSeconds: st.fadeSeconds, holdSeconds: st.holdSeconds })) };
    },
  },
  {
    name: "edit_step",
    description: "Set a step's fade (seconds to fade into it) and / or hold (seconds GO stays on it before the next look). For the cue's own look's fade use edit_cue.",
    schema: {
      type: "object",
      properties: {
        song: SONG,
        cue: { ...CUE, description: "Cue number in the song (default: the LIVE cue)" },
        step: { ...STEP, description: "Step number in the cue" },
        fade_seconds: TIME,
        hold_seconds: TIME,
      },
      required: ["step"],
      additionalProperties: false,
    },
    describe: (a) =>
      `Step ${a.step} of ${a.cue ? `cue ${a.cue}` : "the LIVE cue"}${inSong(a)}: ${[a.fade_seconds != null && `fade ${a.fade_seconds}s`, a.hold_seconds != null && `hold ${a.hold_seconds}s`].filter(Boolean).join(", ") || "no change"}`,
    run: (a) => {
      if (a.fade_seconds == null && a.hold_seconds == null) throw new Error("Give fade_seconds and / or hold_seconds");
      const songId = songArg(a);
      const index = cueArg(a, songId, true);
      const step = stepArg(a, songId, index) ?? 0;
      return { cue: index + 1, step: step + 1, ...api().editStep(songId, index, step, { fadeSeconds: seconds(a.fade_seconds, "fade_seconds"), holdSeconds: seconds(a.hold_seconds, "hold_seconds") }) };
    },
  },
  {
    name: "delete_step",
    description: "Delete one of a cue's steps (its levels are lost). Later steps move up a number.",
    schema: {
      type: "object",
      properties: { song: SONG, cue: { ...CUE, description: "Cue number in the song (default: the LIVE cue)" }, step: { ...STEP, description: "Step number in the cue" } },
      required: ["step"],
      additionalProperties: false,
    },
    describe: (a) => `Delete step ${a.step} of ${a.cue ? `cue ${a.cue}` : "the LIVE cue"}${inSong(a)}`,
    run: (a) => {
      const songId = songArg(a);
      const index = cueArg(a, songId, true);
      const step = stepArg(a, songId, index) ?? 0;
      api().deleteStep(songId, index, step);
      return { cue: index + 1, deleted: step + 1, stepsLeft: api().cue(songId, index).steps.length };
    },
  },
  {
    name: "add_song",
    description: "Add a new song (two blank cues) at the end of the show. It isn't played; use select_song for that.",
    schema: { type: "object", properties: { name: { type: "string", maxLength: 40 } }, required: ["name"], additionalProperties: false },
    describe: (a) => `Add song "${a.name}"`,
    run: (a) => {
      api().addSong(String(a.name ?? ""));
      return { songs: songList() };
    },
  },
  {
    name: "rename_song",
    description: "Rename a song.",
    schema: { type: "object", properties: { song: SONG, name: { type: "string", maxLength: 40 } }, required: ["song", "name"], additionalProperties: false },
    describe: (a) => `Rename song ${a.song} to "${a.name}"`,
    run: (a) => ({ name: api().renameSong(findSong(api().songs(), a.song).id, String(a.name ?? "")) }),
  },
  {
    name: "duplicate_song",
    description: "Copy a song (all its cues) to right after itself, named \"… copy\" unless a name is given. The playing song keeps playing.",
    schema: { type: "object", properties: { song: SONG, name: { type: "string", maxLength: 40 } }, required: ["song"], additionalProperties: false },
    describe: (a) => `Duplicate song ${a.song}`,
    run: (a) => {
      api().duplicateSong(findSong(api().songs(), a.song).id, a.name == null ? undefined : String(a.name));
      return { songs: songList() };
    },
  },
  {
    name: "delete_song",
    description: "Delete a song and all its cues; it's also taken out of every set. The show keeps at least one song. Deleting the playing song plays the next one.",
    schema: { type: "object", properties: { song: SONG }, required: ["song"], additionalProperties: false },
    describe: (a) => `Delete song ${a.song}`,
    run: (a) => {
      const song = findSong(api().songs(), a.song);
      api().deleteSong(song.id);
      return { deleted: song.name, songs: songList() };
    },
  },
  {
    name: "move_song",
    description: "Move a song to another place in the show's song list (this is the show's order, not a set's: use move_in_set for that).",
    schema: {
      type: "object",
      properties: { song: SONG, to: { type: "integer", minimum: 1, description: "Its new number in the show" } },
      required: ["song", "to"],
      additionalProperties: false,
    },
    describe: (a) => `Move song ${a.song} to ${a.to}`,
    run: (a) => {
      const songs = api().songs();
      api().moveSong(findSong(songs, a.song).id, number(a.to, songs.length, "to") - 1);
      return { songs: songList() };
    },
  },
];

// --- fixtures (round 2) ---------------------------------------------------------

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

// --- the show file --------------------------------------------------------------

const SHOW_TOOLS: ToolDef[] = [
  {
    name: "rename_show",
    description: "Rename the show (its name in the page header, and the show file's name when it's saved).",
    schema: { type: "object", properties: { name: { type: "string", maxLength: 80 } }, required: ["name"], additionalProperties: false },
    describe: (a) => `Rename the show to "${a.name}"`,
    run: (a) => ({ name: api().renameShow(String(a.name ?? "")) }),
  },
  {
    name: "save_show",
    description:
      "Save the show: download the show file (songs, sets, cues, patch, fixtures, the stage and the chats) to this browser's downloads. Give a name to rename the show first (the file is named after it).",
    schema: { type: "object", properties: { name: { type: "string", maxLength: 80 } }, additionalProperties: false },
    describe: (a) => (a.name ? `Save the show as "${a.name}"` : "Save the show"),
    run: async (a) => {
      if (a.name != null) api().renameShow(String(a.name));
      const complete = await api().saveShow();
      return { saved: api().show().showName, ...(complete ? {} : { note: "The show server is offline: the file has no stage or chats" }) };
    },
  },
];

// --- DMX outputs ------------------------------------------------------------------

const UNIVERSE = { type: "integer", minimum: 1, description: "The show's universe (default 1)" };

const OUTPUT_TOOLS: ToolDef[] = [
  {
    name: "get_outputs",
    description: "The show's DMX universes and where each one goes: a DMX USB Pro on the show computer (connected or not) and / or an Art-Net or sACN network output.",
    schema: NO_ARGS,
    describe: () => "Looked at the DMX outputs",
    run: () => api().outputs(),
  },
  {
    name: "set_universes",
    description: "How many DMX universes the show uses (512 channels each). Fewer is refused while a fixture or patch uses a universe that would go.",
    schema: { type: "object", properties: { count: { type: "integer", minimum: 1 } }, required: ["count"], additionalProperties: false },
    describe: (a) => `Use ${a.count} universe${Number(a.count) === 1 ? "" : "s"}`,
    run: (a) => ({ universes: api().setUniverses(number(a.count, api().outputs().maxUniverses, "count")) }),
  },
  {
    name: "find_artnet_nodes",
    description: "Look for Art-Net nodes on the show computer's network (takes a few seconds): each node's address, name and ports with their Art-Net universes.",
    schema: NO_ARGS,
    describe: () => "Looked for Art-Net nodes",
    run: async () => {
      const nodes = await api().findArtNetNodes();
      return nodes.length ? nodes : "No Art-Net nodes answered";
    },
  },
  {
    name: "set_output",
    description:
      "Where a universe's DMX goes: connect or disconnect its DMX USB Pro (plugged into the show computer), and / or send it over the network (Art-Net to a node's address or broadcast, or sACN multicast) or stop that. The lights follow straight away.",
    schema: {
      type: "object",
      properties: {
        universe: UNIVERSE,
        usb_pro: { type: "boolean", description: "true connects the DMX USB Pro, false disconnects it" },
        network: { type: "string", enum: ["artnet", "sacn", "off"] },
        host: { type: "string", description: "Art-Net: the node's IP address (default: broadcast)" },
        net_universe: { type: "integer", minimum: 0, description: "The network's universe number (default: Art-Net universe − 1, sACN the same number)" },
      },
      additionalProperties: false,
    },
    describe: (a) => {
      const u = a.universe ?? 1;
      const what = [
        a.usb_pro != null && (a.usb_pro ? "connect the DMX USB Pro" : "disconnect the DMX USB Pro"),
        a.network != null && (a.network === "off" ? "stop the network output" : `${a.network === "sacn" ? "sACN" : "Art-Net"}${a.host ? ` → ${a.host}` : ""}`),
      ].filter(Boolean);
      return `Universe ${u}: ${what.join(", ") || "no change"}`;
    },
    run: async (a) => {
      if (a.usb_pro == null && a.network == null) throw new Error("Give usb_pro and / or network");
      const u = a.universe == null ? 1 : number(a.universe, api().outputs().universes, "universe");
      if (a.usb_pro != null) await api().usbPro(u, a.usb_pro === true);
      if (a.network != null) {
        if (a.network === "off") await api().network(u, null);
        else if (a.network === "artnet" || a.network === "sacn") {
          await api().network(u, {
            protocol: a.network,
            ...(a.host ? { host: String(a.host) } : {}),
            ...(a.net_universe != null ? { netUniverse: Number(a.net_universe) } : {}),
          });
        } else throw new Error("network must be artnet, sacn or off");
      }
      return api().outputs().outputs[u - 1];
    },
  },
];

// --- sets -----------------------------------------------------------------------

const SET = { type: "string", description: "The set's number or name (default: the running set, the one the Run tab plays)" };
const SET_POSITION = { type: "integer", minimum: 1, description: "A place in the set's running order (1 = its first song)" };

/** A set's id by number or name (null = the running set) and the set. */
function pickSet(query: unknown) {
  const sets = api().sets();
  const set = query == null || query === "" ? sets.find((s) => s.running) ?? sets[0] : findSet(sets, query);
  return { id: set.id, set };
}

/** What a set holds now: what the model is told after editing it. */
function setReport(id: string) {
  const set = api().sets().find((s) => s.id === id);
  if (!set) return { sets: api().sets().map((s) => s.name) };
  return { set: set.name, running: set.running, songs: set.songs.map((s, i) => `${i + 1}. ${s.name}`) };
}

const SET_TOOLS: ToolDef[] = [
  {
    name: "get_sets",
    description:
      "Every set (a running order of the show's songs for one event; a song can be in many sets, or twice in one) with its numbered songs, and which one the Run tab runs.",
    schema: NO_ARGS,
    describe: () => "Looked at the sets",
    run: () => api().sets().map((s, i) => ({ number: i + 1, name: s.name, running: s.running, songs: s.songs.map((x, j) => `${j + 1}. ${x.name}`) })),
  },
  {
    name: "add_to_set",
    description: "Add songs from the show to a set, in the order given, at the end or at a place in its running order. A song already in the set is added again.",
    schema: {
      type: "object",
      properties: {
        songs: { type: "array", minItems: 1, items: { type: "string" }, description: "Songs by number in the show or name" },
        set: SET,
        position: { ...SET_POSITION, description: "Where the first one goes in the set (default: after its last song)" },
      },
      required: ["songs"],
      additionalProperties: false,
    },
    describe: (a) => `Add ${Array.isArray(a.songs) ? a.songs.join(", ") : a.songs} to ${a.set ? `set ${a.set}` : "the set"}`,
    run: (a) => {
      const { id, set } = pickSet(a.set);
      const all = api().songs();
      const ids = (Array.isArray(a.songs) ? a.songs : [a.songs]).map((q) => findSong(all, q).id);
      if (!ids.length) throw new Error("Which songs?");
      const at = a.position == null ? undefined : number(a.position, set.songs.length + 1, "position") - 1;
      api().addToSet(id, ids, at);
      return setReport(id);
    },
  },
  {
    name: "remove_from_set",
    description: "Take a song out of a set, by its place in the running order or by name (it stays in the show).",
    schema: {
      type: "object",
      properties: { set: SET, position: SET_POSITION, song: { type: "string", description: "The song's name (or number in the show)" } },
      additionalProperties: false,
    },
    describe: (a) => `Take ${a.position != null ? `#${a.position}` : a.song} out of ${a.set ? `set ${a.set}` : "the set"}`,
    run: (a) => {
      const { id, set } = pickSet(a.set);
      let index: number;
      if ((a.position == null) === (a.song == null)) throw new Error("Give either position or song");
      if (a.position != null) index = number(a.position, set.songs.length, "position") - 1;
      else {
        const song = findSong(api().songs(), a.song);
        const places = set.songs.flatMap((s, i) => (s.id === song.id ? [i + 1] : []));
        if (!places.length) throw new Error(`"${song.name}" isn't in "${set.name}"`);
        if (places.length > 1) throw new Error(`"${song.name}" is in "${set.name}" ${places.length} times (at ${places.join(", ")}): give the position`);
        index = places[0] - 1;
      }
      api().removeFromSet(id, index);
      return setReport(id);
    },
  },
  {
    name: "move_in_set",
    description: "Move a song to another place in a set's running order.",
    schema: {
      type: "object",
      properties: {
        set: SET,
        from: { ...SET_POSITION, description: "Its place in the set now" },
        to: { ...SET_POSITION, description: "Its new place" },
      },
      required: ["from", "to"],
      additionalProperties: false,
    },
    describe: (a) => `Move #${a.from} to #${a.to} in ${a.set ? `set ${a.set}` : "the set"}`,
    run: (a) => {
      const { id, set } = pickSet(a.set);
      const n = set.songs.length;
      api().moveInSet(id, number(a.from, n, "from") - 1, number(a.to, n, "to") - 1);
      return setReport(id);
    },
  },
  {
    name: "new_set",
    description: "Make a new set, empty or with songs in the order given. It doesn't run; use run_set for that.",
    schema: {
      type: "object",
      properties: {
        name: { type: "string", maxLength: 40 },
        songs: { type: "array", items: { type: "string" }, description: "Songs by number in the show or name" },
      },
      required: ["name"],
      additionalProperties: false,
    },
    describe: (a) => `New set "${a.name}"`,
    run: (a) => {
      const all = api().songs();
      const ids = (Array.isArray(a.songs) ? a.songs : []).map((q) => findSong(all, q).id);
      return setReport(api().newSet(String(a.name ?? ""), ids));
    },
  },
  {
    name: "rename_set",
    description: "Rename a set.",
    schema: { type: "object", properties: { set: SET, name: { type: "string", maxLength: 40 } }, required: ["name"], additionalProperties: false },
    describe: (a) => `Rename ${a.set ? `set ${a.set}` : "the set"} to "${a.name}"`,
    run: (a) => {
      const { id } = pickSet(a.set);
      return { name: api().renameSet(id, String(a.name ?? "")) };
    },
  },
  {
    name: "duplicate_set",
    description: "Copy a set (its running order) to a new set right after it, named \"… copy\" unless a name is given.",
    schema: { type: "object", properties: { set: SET, name: { type: "string", maxLength: 40 } }, additionalProperties: false },
    describe: (a) => `Duplicate ${a.set ? `set ${a.set}` : "the set"}`,
    run: (a) => setReport(api().duplicateSet(pickSet(a.set).id, a.name == null ? undefined : String(a.name))),
  },
  {
    name: "delete_set",
    description: "Delete a set; its songs stay in the show. The show keeps at least one set. Deleting the running set runs the first one left.",
    schema: { type: "object", properties: { set: SET }, required: ["set"], additionalProperties: false },
    describe: (a) => `Delete set ${a.set}`,
    run: (a) => {
      const { id, set } = pickSet(a.set);
      api().deleteSet(id);
      return { deleted: set.name, sets: api().sets().map((s) => (s.running ? `${s.name} (running)` : s.name)) };
    },
  },
  {
    name: "run_set",
    description:
      "Make a set the one the Run tab runs (GO goes on from each song's last cue to the next song in it) and play it from its first song, or from a place in it, at once with no fade.",
    schema: { type: "object", properties: { set: SET, from: { ...SET_POSITION, description: "Start here (default: its first song)" } }, additionalProperties: false },
    describe: (a) => `Run ${a.set ? `set ${a.set}` : "the set"}${a.from ? ` from #${a.from}` : ""}`,
    run: (a) => {
      const { id, set } = pickSet(a.set);
      api().runSet(id, a.from == null ? undefined : number(a.from, set.songs.length, "from") - 1);
      return { ...setReport(id), playing: playing() };
    },
  },
];

/**
 * Every tool. Playback is always in the model's view (it's what a show
 * needs, quickly); the rest are deferred: found by the model's tool search
 * when a request needs them (see ChatTool.deferred).
 */
export const TOOLS: ToolDef[] = [
  ...PLAYBACK_TOOLS,
  ...[...CUE_TOOLS, ...SET_TOOLS, ...FIXTURE_TOOLS, ...OUTPUT_TOOLS, ...SHOW_TOOLS, ...STAGE_TOOLS].map((t) => ({ ...t, deferred: true })),
];
export const toolByName = new Map(TOOLS.map((t) => [t.name, t]));

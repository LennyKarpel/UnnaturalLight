/** The chat's song, cue and step tools (round 2): add, rename, move, copy and delete them, and set their levels and times. */

import { findFixtures, findSong } from "../find.ts";
import { type Args, type ToolDef, api, positionName, number, playing, songList, songArg, playingSongId, cueArg, cueNames, songName, level, inSong, SONG, CUE, STEP, TIME, stepArg, seconds, inStep } from "./common.ts";

export const CUE_TOOLS: ToolDef[] = [
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

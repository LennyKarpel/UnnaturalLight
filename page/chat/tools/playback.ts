/** The chat's playback tools: what's playing, GO, back, jump, pause, levels. Always in the model's view. */

import { findSong } from "../find.ts";
import { type ToolDef, api, percent, number, playing, NO_ARGS } from "./common.ts";

export const PLAYBACK_TOOLS: ToolDef[] = [
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

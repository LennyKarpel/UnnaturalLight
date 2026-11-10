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

export const TOOLS: ToolDef[] = [
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

export const toolByName = new Map(TOOLS.map((t) => [t.name, t]));

/** What the chat's tools share: their shape, the console's hooks, and reading their arguments (songs, cues, steps, levels). */

import type { ChatTool } from "../../../shared/chat-protocol.ts";
import type { ConsoleChat } from "../../../console/chat-hooks.ts";
import { findSong } from "../find.ts";

export type Args = Record<string, unknown>;

export type ToolDef = ChatTool & {
  describe: (args: Args) => string;
  /** Returns what the model is told (an object is sent as JSON), or a promise of it. Throws (or rejects) to report an error. */
  run: (args: Args) => unknown;
};

export function api(): ConsoleChat {
  const c = window.consoleChat;
  if (!c) throw new Error("The console isn't ready yet");
  return c;
}

/** A named stage position's name from its id (the stage holds them). */
export const positionName = (id: string) => window.stageChat?.stage().positions.find((p) => p.id === id)?.name ?? "(deleted)";

export const percent = (v: unknown, what: string): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`${what} must be 0–100`);
  return n;
};

/** A 1-based number from 1 to `max`. */
export const number = (v: unknown, max: number, what: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`${what} must be 1–${max}`);
  return n;
};

/** Where playback is after an action: what the model is told. */
export const playing = () => api().show().playing;

/** The show's songs, numbered: what the model is told after changing them. */
export const songList = () => api().songs().map((s, i) => `${i + 1}. ${s.name}`);

export const NO_ARGS = { type: "object", properties: {}, additionalProperties: false };

/** The song a tool means: `song` (its number or name), or null = the playing song. */
export const songArg = (a: Args): string | null => (a.song == null || a.song === "" ? null : findSong(api().songs(), a.song).id);

export function playingSongId() {
  return api().songs()[api().show().playing.song.number - 1]?.id ?? null;
}

/**
 * The cue a tool means, as a 0-based index: `cue` (its number in the song),
 * or, when `liveByDefault` and it's the playing song, the LIVE cue.
 */
export function cueArg(a: Args, songId: string | null, liveByDefault: boolean): number {
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
export const cueNames = (songId: string | null) => {
  const show = api().show();
  const id = songId ?? playingSongId();
  const n = api().songs().findIndex((s) => s.id === id);
  return (show.songs[n]?.cues ?? []).map((c) => `${c.number}. ${c.name || `Cue ${c.number}`}`);
};
export const songName = (songId: string | null) => api().songs().find((s) => s.id === (songId ?? playingSongId()))?.name ?? "?";
export const level = (v: unknown, what: string): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 255) throw new Error(`${what} must be 0–255`);
  return Math.round(n);
};
export const inSong = (a: Args) => (a.song ? ` of song ${a.song}` : "");

export const SONG = { type: "string", description: "The song's number in the show or its name (default: the playing song)" };
export const CUE = { type: "integer", minimum: 1, description: "Cue number in the song" };
export const STEP = { type: "integer", minimum: 1, description: "Step number in the cue (1 = the first look GO passes through). Leave out for the cue's own look, where GO ends." };
export const TIME = { type: "integer", minimum: 0, maximum: 20 };

/** A cue's step a tool means, 0-based, or undefined for the cue's own look. */
export function stepArg(a: Args, songId: string | null, index: number): number | undefined {
  if (a.step == null) return undefined;
  const steps = api().cue(songId, index).steps.length;
  if (!steps) throw new Error(`Cue ${index + 1} has no steps`);
  return number(a.step, steps, "step") - 1;
}

export const seconds = (v: unknown, what: string): number | undefined => {
  if (v == null) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 20) throw new Error(`${what} must be 0–20`);
  return n;
};
export const inStep = (a: Args) => (a.step ? ` step ${a.step}` : "");

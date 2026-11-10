// The show as the server holds it: its songs and sets, the live mix, timed fades and
// held flash / blackout buttons. Every console mirrors this; the DMX output
// is computed from it.

import { FADER_COUNT, setUniverseCount } from "../console/patch.ts";
import { parseShow, serializeShow, type ShowData } from "../console/show.ts";
import { normalizeCueFadeTime, resolveActiveSong, type Cue } from "../console/songs.ts";
import { nextSetSong, playbackCue, playbackLevels, upNextCue } from "../console/sets.ts";
import { computeChannelLevels, easeFade, liveLevel } from "../shared/engine.ts";
import { LIVE_FIELDS, type LiveField } from "../shared/live-fields.ts";
import { must } from "../shared/query.ts";
import { errorMessage } from "../shared/guards.ts";
import type { LevelCell } from "../shared/protocol.ts";
import { clamp } from "../shared/numbers.ts";

/** The parts of the show that change while playing, as sent to every console. */
/**
 * A GO fade in progress: the crossfade runs from `start` to `target` over
 * `durationMs`, eased, and is `elapsedMs` in. `id` changes when a new fade
 * starts or a paused one resumes.
 */
export type FadeInfo = { id: number; paused: boolean; start: number; target: number; durationMs: number; elapsedMs: number };

export type Live = Record<LiveField, number> & {
  /** The timed fade running (null = none). Consoles animate it between updates. */
  fade: FadeInfo | null;
  /** Dimmer faders held flashed / blacked out on any console. */
  flashing: number[];
  blackedOut: number[];
};

type Holds = { flashing: Set<number>; blackedOut: Set<number> };

/** @param saved a show (as saved) or null */
export function createShow(saved: unknown) {
  let show: ShowData | null = null;
  if (saved) {
    try {
      show = parseShow(saved);
    } catch (err) {
      console.warn(`Saved session ignored: ${errorMessage(err)}`);
    }
  }
  let fade: null | { start: number; target: number; durationMs: number; startedAt: number; pausedAt: number | null; mode: "go" } = null;
  /** client id → faders it holds flashed / blacked out */
  const holds = new Map<string, Holds>();

  /** The show (only called once there is one: the server checks hasShow). */
  const cur = (): ShowData => must(show, "show");
  const activeSong = () => resolveActiveSong(cur().songs, cur().activeSongId);
  const cueLevels = () => playbackLevels(cur(), activeSong().cues.map((t) => t.levels));

  /** Keep LIVE / UP NEXT / selected inside the song; UP NEXT follows LIVE (and the set). */
  function clampPlayback() {
    const show = cur();
    const n = activeSong().cues.length;
    show.activeSongId = activeSong().id;
    show.selectedCue = clamp(Math.round(show.selectedCue) || 0, 0, Math.max(0, n - 1));
    show.fromCue = clamp(Math.round(show.fromCue) || 0, 0, Math.max(0, n - 1));
    show.toCue = upNextCue(show);
    setUniverseCount(show.universes);
  }
  if (show) clampPlayback();

  function heldUnion(key: keyof Holds): Set<number> {
    const all = new Set<number>();
    for (const h of holds.values()) for (const f of h[key]) all.add(f);
    return all;
  }

  return {
    get hasShow() {
      return show != null;
    },

    /** The first console to connect to an empty server provides the show. */
    seed(data: unknown): boolean {
      if (show) return false;
      show = parseShow(data);
      clampPlayback();
      return true;
    },

    /** Structural edit from a console: everything but the live fields (those come separately). */
    replaceShow(data: unknown) {
      const next = parseShow(data);
      if (show) for (const f of LIVE_FIELDS) next[f] = show[f];
      show = next;
      clampPlayback();
    },

    applyLive(live: Record<string, unknown>) {
      const show = cur();
      for (const f of LIVE_FIELDS) {
        const v = Number(live[f]);
        if (f in live && Number.isFinite(v)) show[f] = v;
      }
      show.master = clamp(show.master, 0, 100);
      show.cross = clamp(show.cross, 0, 100);
      show.fromSub = clamp(show.fromSub, 0, 100);
      show.toSub = clamp(show.toSub, 0, 100);
      clampPlayback();
    },

    applyLevels(cells: LevelCell[]) {
      const byId = new Map<string, Cue>();
      for (const song of cur().songs) for (const t of song.cues) byId.set(t.id, t);
      for (const cell of cells) {
        if (!Array.isArray(cell)) continue;
        const [id, fader, value] = cell;
        const t = byId.get(id);
        if (!t || !Number.isInteger(fader) || fader < 0 || fader >= FADER_COUNT) continue;
        t.levels[fader] = clamp(Math.round(Number(value)) || 0, 0, 255);
      }
    },

    setHolds(clientId: string, flashing: unknown, blackedOut: unknown) {
      const ok = (f: unknown): f is number => typeof f === "number" && Number.isInteger(f) && f >= 0 && f < FADER_COUNT;
      holds.set(clientId, {
        flashing: new Set((Array.isArray(flashing) ? flashing : []).filter(ok)),
        blackedOut: new Set((Array.isArray(blackedOut) ? blackedOut : []).filter(ok)),
      });
    },

    /** A console went away: let go of whatever it was holding. Returns true if it held anything. */
    dropClient(clientId: string) {
      const h = holds.get(clientId);
      holds.delete(clientId);
      return Boolean(h && (h.flashing.size || h.blackedOut.size));
    },

    /** GO: fade from the selected cue to UP NEXT (its fade time), then advance. */
    go(now: number) {
      const show = cur();
      show.fromCue = show.selectedCue;
      clampPlayback();
      if (show.toCue === show.fromCue) return;
      const seconds = normalizeCueFadeTime(playbackCue(show, show.toCue)?.fadeTime);
      show.cross = 0;
      fade = { start: 0, target: 100, durationMs: seconds * 1000, startedAt: now, pausedAt: null, mode: "go" };
    },

    togglePause(now: number) {
      if (!fade) return;
      if (fade.pausedAt == null) {
        fade.pausedAt = now;
      } else {
        fade.startedAt += now - fade.pausedAt;
        fade.pausedAt = null;
      }
    },

    stopFade() {
      fade = null;
    },

    /**
     * Advance a running fade.
     * @returns null = nothing changed;
     *   songChanged: GO arrived on the next set song (its first cue is live now)
     */
    tick(now: number): null | { arrived: number | null; songChanged?: boolean } {
      if (!show || !fade || fade.pausedAt != null) return null;
      // A 0 s fade arrives at once.
      const t = fade.durationMs > 0 ? Math.min(1, (now - fade.startedAt) / fade.durationMs) : 1;
      show.cross = fade.start + (fade.target - fade.start) * easeFade(t);
      if (t < 1) return { arrived: null };
      const wasGo = fade.mode === "go";
      fade = null;
      if (!wasGo) {
        show.cross = 100;
        return { arrived: null };
      }
      const arrived = show.toCue;
      const next = arrived >= activeSong().cues.length ? nextSetSong(show) : null;
      if (next) {
        show.activeSongId = next.song.id;
        show.activeEntryId = next.entry.id;
      }
      show.fromCue = next ? 0 : arrived;
      show.selectedCue = show.fromCue;
      show.cross = 0;
      clampPlayback();
      return { arrived: show.fromCue, songChanged: Boolean(next) };
    },

    /** DMX channel → level, as it should go out now. */
    levels(): Map<number, number> {
      const s = show;
      if (!s) return new Map();
      const levels = cueLevels();
      const flashing = heldUnion("flashing");
      const blackedOut = heldUnion("blackedOut");
      return computeChannelLevels(s.patch, (i) => (flashing.has(i) ? 255 : blackedOut.has(i) ? 0 : liveLevel(s, levels, i)));
    },

    get universes() {
      return show?.universes ?? 1;
    },

    live(): Live | null {
      const s = show;
      if (!s) return null;
      return {
        ...(Object.fromEntries(LIVE_FIELDS.map((f) => [f, s[f]])) as Record<LiveField, number>),
        fade: fade && {
          id: fade.startedAt,
          paused: fade.pausedAt != null,
          start: fade.start,
          target: fade.target,
          durationMs: fade.durationMs,
          elapsedMs: (fade.pausedAt ?? performance.now()) - fade.startedAt,
        },
        flashing: [...heldUnion("flashing")],
        blackedOut: [...heldUnion("blackedOut")],
      };
    },

    /** The whole show, as saved / sent to consoles. */
    serialized() {
      return show ? serializeShow(show) : null;
    },
  };
}

// The show as the server holds it: its songs and sets, the live mix, timed fades and
// held flash / blackout buttons. Every console mirrors this; the DMX output
// is computed from it.

import { FADER_COUNT, setUniverseCount } from "../console/patch.js";
import { parseShow, serializeShow } from "../console/show.js";
import { normalizeCueFadeTime, resolveActiveSong } from "../console/songs.js";
import { nextSetSong, playbackCue, playbackLevels, upNextCue } from "../console/sets.js";
import { computeChannelLevels, easeFade, liveLevel } from "../shared/engine.js";
import { LIVE_FIELDS, SNAPSHOT_FIELDS } from "../shared/live-fields.js";


const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/** @param {unknown} saved a show (as saved) or null */
export function createShow(saved) {
  /** @type {ReturnType<typeof parseShow> | null} */
  let show = null;
  if (saved) {
    try {
      show = parseShow(saved);
    } catch (err) {
      console.warn(`Saved session ignored: ${err.message}`);
    }
  }
  /** @type {Record<string, number | null>} */
  const snapshots = Object.fromEntries(SNAPSHOT_FIELDS.map((f) => [f, null]));
  /** @type {null | { start: number, target: number, durationMs: number, startedAt: number, pausedAt: number | null, mode?: "go" }} */
  let fade = null;
  /** client id → faders it holds flashed / blacked out */
  const holds = new Map();

  const activeSong = () => resolveActiveSong(show.songs, show.activeSongId);
  const cueLevels = () => playbackLevels(show, activeSong().cues.map((t) => t.levels));

  /** Keep LIVE / UP NEXT / selected inside the song; UP NEXT follows LIVE (and the set). */
  function clampPlayback() {
    const n = activeSong().cues.length;
    show.activeSongId = activeSong().id;
    show.selectedCue = clamp(Math.round(show.selectedCue) || 0, 0, Math.max(0, n - 1));
    show.fromCue = clamp(Math.round(show.fromCue) || 0, 0, Math.max(0, n - 1));
    show.toCue = upNextCue(show);
    setUniverseCount(show.universes);
  }
  if (show) clampPlayback();

  function heldUnion(key) {
    const all = new Set();
    for (const h of holds.values()) for (const f of h[key]) all.add(f);
    return all;
  }

  return {
    get hasShow() {
      return show != null;
    },

    /** The first console to connect to an empty server provides the show. */
    seed(data) {
      if (show) return false;
      show = parseShow(data);
      clampPlayback();
      return true;
    },

    /** Structural edit from a console: everything but the live fields (those come separately). */
    replaceShow(data) {
      const next = parseShow(data);
      if (show) for (const f of LIVE_FIELDS) next[f] = show[f];
      show = next;
      clampPlayback();
    },

    /** @param {Record<string, unknown>} live */
    applyLive(live) {
      for (const f of LIVE_FIELDS) {
        const v = Number(live[f]);
        if (f in live && Number.isFinite(v)) show[f] = v;
      }
      show.master = clamp(show.master, 0, 100);
      show.cross = clamp(show.cross, 0, 100);
      show.fromSub = clamp(show.fromSub, 0, 100);
      show.toSub = clamp(show.toSub, 0, 100);
      for (const f of SNAPSHOT_FIELDS) {
        if (!(f in live)) continue;
        const v = live[f];
        snapshots[f] = v == null || !Number.isFinite(Number(v)) ? null : Number(v);
      }
      clampPlayback();
    },

    /** @param {[string, number, number][]} cells [cue id, fader index, level] */
    applyLevels(cells) {
      const byId = new Map();
      for (const song of show.songs) for (const t of song.cues) byId.set(t.id, t);
      for (const cell of cells) {
        if (!Array.isArray(cell)) continue;
        const [id, fader, value] = cell;
        const t = byId.get(id);
        if (!t || !Number.isInteger(fader) || fader < 0 || fader >= FADER_COUNT) continue;
        t.levels[fader] = clamp(Math.round(Number(value)) || 0, 0, 255);
      }
    },

    setHolds(clientId, flashing, blackedOut) {
      const ok = (f) => Number.isInteger(f) && f >= 0 && f < FADER_COUNT;
      holds.set(clientId, {
        flashing: new Set((Array.isArray(flashing) ? flashing : []).filter(ok)),
        blackedOut: new Set((Array.isArray(blackedOut) ? blackedOut : []).filter(ok)),
      });
    },

    /** A console went away: let go of whatever it was holding. Returns true if it held anything. */
    dropClient(clientId) {
      const h = holds.get(clientId);
      holds.delete(clientId);
      return Boolean(h && (h.flashing.size || h.blackedOut.size));
    },

    /** GO: fade from the selected cue to UP NEXT (its fade time), then advance. */
    go(now) {
      show.fromCue = show.selectedCue;
      clampPlayback();
      if (show.toCue === show.fromCue) return;
      const seconds = normalizeCueFadeTime(playbackCue(show, show.toCue)?.fadeTime);
      show.fadeTime = seconds;
      show.cross = 0;
      fade = { start: 0, target: 100, durationMs: seconds * 1000, startedAt: now, pausedAt: null, mode: "go" };
    },

    togglePause(now) {
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
     * @returns {null | { arrived: number | null, songChanged?: boolean }} null = nothing changed;
     *   songChanged: GO arrived on the next set song (its first cue is live now)
     */
    tick(now) {
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
    levels() {
      if (!show) return new Map();
      const levels = cueLevels();
      const flashing = heldUnion("flashing");
      const blackedOut = heldUnion("blackedOut");
      return computeChannelLevels(show.patch, (i) => (flashing.has(i) ? 255 : blackedOut.has(i) ? 0 : liveLevel(show, levels, i)));
    },

    get universes() {
      return show?.universes ?? 1;
    },

    live() {
      if (!show) return null;
      return {
        ...Object.fromEntries(LIVE_FIELDS.map((f) => [f, show[f]])),
        ...snapshots,
        fade: fade ? { paused: fade.pausedAt != null } : null,
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

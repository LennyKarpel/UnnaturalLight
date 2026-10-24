// The show as the server holds it: the set, the live mix, timed fades and
// held flash / blackout buttons. Every console mirrors this; the DMX output
// is computed from it.

import { FADER_COUNT, setUniverseCount } from "../console/patch.js";
import { parseSet, serializeSet } from "../console/set.js";
import { normalizeTransitionFadeTime, resolveActiveTune } from "../console/tunes.js";
import { computeChannelLevels, easeFade, liveLevel } from "../shared/engine.js";

/** Set fields that change while playing (sent on their own, many times a second). */
export const LIVE_FIELDS = ["master", "cross", "fromSub", "toSub", "fromRow", "toRow", "selectedRow", "fadeTime"];
/** Blackout buttons remember what they cut (null = not blacked out). */
export const SNAPSHOT_FIELDS = ["masterBlackoutSnapshot", "fromSubBlackoutSnapshot", "toSubBlackoutSnapshot"];

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/** @param {unknown} saved a set (as saved) or null */
export function createShow(saved) {
  /** @type {ReturnType<typeof parseSet> | null} */
  let set = null;
  if (saved) {
    try {
      set = parseSet(saved);
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

  const activeTune = () => resolveActiveTune(set.tunes, set.activeTuneId);
  const rows = () => activeTune().transitions.map((t) => t.levels);

  /** Keep Current / Next / selected inside the song; Next always follows Current. */
  function clampPlayback() {
    const n = activeTune().transitions.length;
    set.activeTuneId = activeTune().id;
    set.selectedRow = clamp(Math.round(set.selectedRow) || 0, 0, Math.max(0, n - 1));
    set.fromRow = clamp(Math.round(set.fromRow) || 0, 0, Math.max(0, n - 1));
    set.toRow = n < 2 ? set.fromRow : (set.fromRow + 1) % n;
    setUniverseCount(set.universes);
  }
  if (set) clampPlayback();

  function heldUnion(key) {
    const all = new Set();
    for (const h of holds.values()) for (const f of h[key]) all.add(f);
    return all;
  }

  return {
    get hasSet() {
      return set != null;
    },

    /** The first console to connect to an empty server provides the show. */
    seed(data) {
      if (set) return false;
      set = parseSet(data);
      clampPlayback();
      return true;
    },

    /** Structural edit from a console: everything but the live fields (those come separately). */
    replaceSet(data) {
      const next = parseSet(data);
      if (set) for (const f of LIVE_FIELDS) next[f] = set[f];
      set = next;
      clampPlayback();
    },

    /** @param {Record<string, unknown>} live */
    applyLive(live) {
      for (const f of LIVE_FIELDS) {
        const v = Number(live[f]);
        if (f in live && Number.isFinite(v)) set[f] = v;
      }
      set.master = clamp(set.master, 0, 100);
      set.cross = clamp(set.cross, 0, 100);
      set.fromSub = clamp(set.fromSub, 0, 100);
      set.toSub = clamp(set.toSub, 0, 100);
      for (const f of SNAPSHOT_FIELDS) {
        if (!(f in live)) continue;
        const v = live[f];
        snapshots[f] = v == null || !Number.isFinite(Number(v)) ? null : Number(v);
      }
      clampPlayback();
    },

    /** @param {[string, number, number][]} cells [transition id, fader index, level] */
    applyLevels(cells) {
      const byId = new Map();
      for (const tune of set.tunes) for (const t of tune.transitions) byId.set(t.id, t);
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

    /** GO: fade from the selected cue to the next one (its fade time), then advance. */
    go(now) {
      const n = activeTune().transitions.length;
      if (n < 2) return;
      set.fromRow = set.selectedRow;
      clampPlayback();
      const seconds = normalizeTransitionFadeTime(activeTune().transitions[set.toRow]?.fadeTime);
      set.fadeTime = seconds;
      set.cross = 0;
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
     * @returns {null | { arrived: number | null }} null = nothing changed
     */
    tick(now) {
      if (!set || !fade || fade.pausedAt != null) return null;
      const t = Math.min(1, (now - fade.startedAt) / fade.durationMs);
      set.cross = fade.start + (fade.target - fade.start) * easeFade(t);
      if (t < 1) return { arrived: null };
      const wasGo = fade.mode === "go";
      fade = null;
      if (!wasGo) {
        set.cross = 100;
        return { arrived: null };
      }
      const arrived = set.toRow;
      set.fromRow = arrived;
      set.selectedRow = arrived;
      set.cross = 0;
      clampPlayback();
      return { arrived };
    },

    /** DMX channel → level, as it should go out now. */
    levels() {
      if (!set) return new Map();
      const r = rows();
      const flashing = heldUnion("flashing");
      const blackedOut = heldUnion("blackedOut");
      return computeChannelLevels(set.patch, (i) => (flashing.has(i) ? 255 : blackedOut.has(i) ? 0 : liveLevel(set, r, i)));
    },

    get universes() {
      return set?.universes ?? 1;
    },

    live() {
      if (!set) return null;
      return {
        ...Object.fromEntries(LIVE_FIELDS.map((f) => [f, set[f]])),
        ...snapshots,
        fade: fade ? { paused: fade.pausedAt != null } : null,
        flashing: [...heldUnion("flashing")],
        blackedOut: [...heldUnion("blackedOut")],
      };
    },

    /** The whole set, as saved / sent to consoles. */
    serialized() {
      return set ? serializeSet(set) : null;
    },
  };
}

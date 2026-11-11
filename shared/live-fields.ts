/**
 * The parts of a show that change while playing, kept by the show server
 * (../server/show.ts) and synced live by every console (../console/server-link.ts).
 */

/** Show fields that change while playing (sent on their own, many times a second). */
/** `liveStep`: the LIVE cue's step shown and edited (-1: its own look; see Cue.steps). */
export const LIVE_FIELDS = ["master", "cross", "fromSub", "toSub", "fromCue", "selectedCue", "liveStep"] as const;
export type LiveField = (typeof LIVE_FIELDS)[number];

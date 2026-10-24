/**
 * The parts of a set that change while playing, kept by the show server
 * (../server/show.js) and synced live by every console (../console/server-link.js).
 */

/** Set fields that change while playing (sent on their own, many times a second). */
export const LIVE_FIELDS = ["master", "cross", "fromSub", "toSub", "fromCue", "selectedCue"];
/** Blackout buttons remember what they cut (null = not blacked out). */
export const SNAPSHOT_FIELDS = ["masterBlackoutSnapshot", "fromSubBlackoutSnapshot", "toSubBlackoutSnapshot"];

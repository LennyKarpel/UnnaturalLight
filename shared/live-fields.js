/**
 * The parts of a show that change while playing, kept by the show server
 * (../server/show.js) and synced live by every console (../console/server-link.js).
 */

/** Show fields that change while playing (sent on their own, many times a second). */
export const LIVE_FIELDS = ["master", "cross", "fromSub", "toSub", "fromCue", "selectedCue"];

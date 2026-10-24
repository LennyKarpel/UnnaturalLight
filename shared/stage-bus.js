/**
 * The live link between the console and the stage: a BroadcastChannel
 * between tabs of the same site. Both sides (console/stage-link.js,
 * stage/console-link.js) use these names, so they can't drift apart.
 */

const CHANNEL_NAME = "unnaturallight.dmx";

/** Message types on the bus. */
export const MSG = {
  // console → stage
  /** A console opened: stages send their lights again. */
  STAGE_HELLO: "stage-hello",
  /** Output levels, patch, fixtures, mix (every output change + heartbeat). */
  LEVELS: "levels",
  /** Results of a `register` request. */
  REGISTERED: "registered",
  // stage → console
  /** A stage opened: consoles send their levels now. */
  HELLO: "hello",
  /** Set channels to values (moves the faders patched to them). */
  SET: "set",
  /** Create console fixtures for lights placed on the stage. */
  REGISTER: "register",
  /** Remove console fixtures the stage registered. */
  UNREGISTER: "unregister",
  /** The stage's lights (for the console's ⌥-click traces). */
  STAGE: "stage",
  /** Console fixtures selected on the stage (the console highlights them). */
  STAGE_SELECT: "stage-select",
};

/** Where the console saves its session (the stage reads its fixtures while the console is closed). */
export const CONSOLE_SESSION_KEY = "unnaturallight.setlist.session.v1";

/** The bus, or null where the browser has no BroadcastChannel. */
export function openStageBus() {
  return typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL_NAME);
}

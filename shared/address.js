/**
 * DMX channel addresses, shared by the console, the stage, traces and the
 * show server. Channels are numbered continuously across universes:
 * universe 2 channel 1 is 513. Shown as "2/1" once there's more than one
 * universe.
 */

/** Channels per DMX universe (one Enttec DMX USB Pro each). */
export const UNIVERSE_SIZE = 512;
/** Most universes a set can have. */
export const MAX_UNIVERSES = 8;
export const DMX_CHANNEL_MAX = UNIVERSE_SIZE * MAX_UNIVERSES;

export const universeOf = (channel) => Math.floor((channel - 1) / UNIVERSE_SIZE) + 1;
export const addressOf = (channel) => ((channel - 1) % UNIVERSE_SIZE) + 1;
/** First channel of a universe. */
export const universeStart = (universe) => (universe - 1) * UNIVERSE_SIZE + 1;

/** 45 → "45" (one universe) · 557 → "2/45" (several). */
export function formatAddress(channel, universes) {
  return universes > 1 ? `${universeOf(channel)}/${addressOf(channel)}` : String(channel);
}

/** "2/45" → 557 · "45" → 45 · invalid / beyond `universes` → null. */
export function parseAddress(text, universes) {
  const m = /^\s*(?:(\d+)\s*\/\s*)?(\d+)\s*$/.exec(String(text));
  if (!m) return null;
  const universe = m[1] ? Number(m[1]) : 1;
  const address = Number(m[2]);
  if (universe < 1 || universe > universes || address < 1 || address > UNIVERSE_SIZE) return null;
  return universeStart(universe) + address - 1;
}

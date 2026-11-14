/**
 * DMX channel addresses, shared by the console, the stage, traces and the
 * show server. Channels are numbered continuously across universes:
 * universe 2 channel 1 is 513. Shown as "2/1" once there's more than one
 * universe.
 */

/**
 * Three kinds of number that are easy to mix up, each its own type so a
 * mix-up is a type error (at run time they're plain numbers):
 * - Channel: numbered across universes (513 = universe 2, address 1); what the patch, fixtures and output use
 * - Universe: 1-based
 * - Address: a channel's place inside its universe, 1–512 (what a fixture's DIP switches say)
 * Make them with the functions here (channelAt, asChannel…), not casts.
 * formatAddress takes any number: it only labels.
 */
export type Channel = number & { readonly kind: "Channel" };
export type Universe = number & { readonly kind: "Universe" };
export type Address = number & { readonly kind: "Address" };

/** A number already known to be a channel (checked, or from a saved patch that was). */
export const asChannel = (n: number): Channel => n as Channel;
export const asUniverse = (n: number): Universe => n as Universe;

/** Channels per DMX universe (one Enttec DMX USB Pro each). */
export const UNIVERSE_SIZE = 512;
/** Most universes a show can have. */
export const MAX_UNIVERSES = 8;
export const DMX_CHANNEL_MAX = UNIVERSE_SIZE * MAX_UNIVERSES;

export const universeOf = (channel: Channel): Universe => asUniverse(Math.floor((channel - 1) / UNIVERSE_SIZE) + 1);
export const addressOf = (channel: Channel): Address => (((channel - 1) % UNIVERSE_SIZE) + 1) as Address;
/** First channel of a universe. */
export const universeStart = (universe: Universe): Channel => asChannel((universe - 1) * UNIVERSE_SIZE + 1);
/** The channel at `address` (1–512) in `universe`. */
export const channelAt = (universe: Universe, address: number): Channel => asChannel(universeStart(universe) + address - 1);

/** 45 → "45" (one universe) · 557 → "2/45" (several). */
export function formatAddress(channel: number, universes: number): string {
  return universes > 1 ? `${universeOf(asChannel(channel))}/${addressOf(asChannel(channel))}` : String(channel);
}

/** "2/45" → 557 · "45" → 45 · invalid / beyond `universes` → null. */
export function parseAddress(text: unknown, universes: number): Channel | null {
  const m = /^\s*(?:(\d+)\s*\/\s*)?(\d+)\s*$/.exec(String(text));
  if (!m) return null;
  const universe = m[1] ? Number(m[1]) : 1;
  const address = Number(m[2]);
  if (universe < 1 || universe > universes || address < 1 || address > UNIVERSE_SIZE) return null;
  return channelAt(asUniverse(universe), address);
}

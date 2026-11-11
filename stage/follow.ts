// Fixtures following named positions (position presets).
//
// Aiming a fixture at a named position makes it follow it: when the position
// or the fixture moves, it re-aims.
//
//   A fixture the console drives (pan / tilt on faders): the aim goes into
//   the cue(s) on the output (console/aims.ts). Every cue that aims at the
//   position re-aims when it moves, so a cue played later still finds it. A
//   cue whose pan / tilt were changed some other way stops following.
//
//   Any other fixture: it keeps the aim itself (Fixture.follow) and lets go
//   when its pan / tilt are changed some other way.
//
// The pan is the one nearest home, so a position always gives the same
// values whatever the fixture was doing.

import { state, positionById } from "./state.ts";
import { aimDmx, setPanTilt, linkChannels, type Fixture } from "./stage-model.ts";
import { consoleLink } from "./link.ts";
import type { ChannelValue } from "../shared/engine.ts";
import type { AimRequest, Reaim } from "../shared/console-stage.ts";
import type { Xyz } from "./stage-model.ts";

const aimFor = (fixture: Fixture, at: Xyz) => aimDmx(fixture, at, 0);

/** The fixture's pan / tilt channels the console drives (with a fader), or null: the stage keeps its aim. */
function consoleChannels(fixture: Fixture) {
  if (!fixture.link.consoleId) return null;
  const chans = linkChannels(fixture).filter((c) => (c.attr === "pan" || c.attr === "tilt") && consoleLink.fadersFor(c.channel).length);
  return chans.length ? (chans as { channel: number; attr: "pan" | "tilt" }[]) : null;
}

const valuesFor = (chans: { channel: number; attr: "pan" | "tilt" }[], aim: { pan: number; tilt: number }): ChannelValue[] =>
  chans.map((c) => ({ channel: c.channel, value: aim[c.attr] }));

const sameValues = (a: ChannelValue[], b: ChannelValue[]) => a.length === b.length && a.every((v, k) => v.channel === b[k].channel && v.value === b[k].value);

/**
 * Aim fixtures at a named position and have them follow it. Returns the
 * ones it can't reach (aimed as close as they go). Call changed() after.
 */
export function aimAndFollow(fixtures: Fixture[], positionId: string): Fixture[] {
  const position = positionById(positionId);
  if (!position) return [];
  const missed: Fixture[] = [];
  const requests: AimRequest[] = [];
  for (const fixture of fixtures) {
    const aim = aimFor(fixture, position);
    if (!aim) { missed.push(fixture); continue; }
    if (!aim.reached) missed.push(fixture);
    setPanTilt(fixture, aim);
    const chans = consoleChannels(fixture);
    fixture.follow = chans ? null : { position: positionId, pan: aim.pan, tilt: aim.tilt };
    if (chans && fixture.link.consoleId) requests.push({ consoleId: fixture.link.consoleId, position: positionId, values: valuesFor(chans, aim) });
  }
  // After the caller's changed() has sent the new pan / tilt (a microtask),
  // so the aim's exact values are what the cue keeps.
  if (requests.length) queueMicrotask(() => consoleLink.aim(requests));
  return missed;
}

/** Stop fixtures following (they stay where they're aimed; for the console, in the cue(s) on the output). Returns how many were following. */
export function stopFollowing(fixtures: Fixture[]): number {
  let n = 0;
  const requests: AimRequest[] = [];
  for (const fixture of fixtures) {
    if (followingOf(fixture)) n++;
    fixture.follow = null;
    if (fixture.link.consoleId && consoleChannels(fixture)) requests.push({ consoleId: fixture.link.consoleId, position: null, values: [] });
  }
  if (requests.length) consoleLink.aim(requests);
  return n;
}

/** The position a fixture follows now, or null. */
export function followingOf(fixture: Fixture) {
  if (fixture.follow) {
    const { position, pan, tilt } = fixture.follow;
    return fixture.dmx.pan === pan && fixture.dmx.tilt === tilt ? positionById(position) ?? null : null;
  }
  const id = fixture.link.consoleId;
  const pair = id ? consoleLink.liveAims().find((a) => a.fixture === id) : null;
  const position = pair ? positionById(pair.position) : null;
  if (!position) return null;
  // The cue on the output aims it there, and it's still pointing there.
  const aim = aimFor(fixture, position);
  return aim && fixture.dmx.pan === aim.pan && fixture.dmx.tilt === aim.tilt ? position : null;
}

/** console fixture + position → the values its cues were last known to have (to tell them apart from cues changed since). */
const known = new Map<string, ChannelValue[]>();

/**
 * Re-aim whatever follows a position that moved (or whose fixture moved):
 * fixtures here, and the cues in the console. Cheap when nothing moved.
 */
export function syncFollowing() {
  for (const fixture of state.fixtures) {
    const f = fixture.follow;
    if (!f) continue;
    const position = positionById(f.position);
    // Gone, or pan / tilt changed some other way: let go.
    if (!position || fixture.dmx.pan !== f.pan || fixture.dmx.tilt !== f.tilt) { fixture.follow = null; continue; }
    const aim = aimFor(fixture, position);
    if (!aim || (aim.pan === f.pan && aim.tilt === f.tilt)) continue;
    f.pan = aim.pan;
    f.tilt = aim.tilt;
    setPanTilt(fixture, aim);
  }

  const reaims: Reaim[] = [];
  const seen = new Set<string>();
  for (const pair of consoleLink.aims()) {
    const fixture = state.fixtures.find((f) => f.link.consoleId === pair.fixture);
    const position = positionById(pair.position);
    const chans = fixture && consoleChannels(fixture);
    // A deleted position: its cues keep their values (and the note, for an undo).
    if (!fixture || !position || !chans) continue;
    const aim = aimFor(fixture, position);
    if (!aim) continue;
    const key = `${pair.fixture}\n${pair.position}`;
    seen.add(key);
    const values = valuesFor(chans, aim);
    const was = known.get(key);
    known.set(key, values);
    if (was && !sameValues(was, values)) reaims.push({ consoleId: pair.fixture, position: pair.position, from: was, to: values });
  }
  for (const key of known.keys()) if (!seen.has(key)) known.delete(key);
  if (reaims.length) consoleLink.reaim(reaims);
}

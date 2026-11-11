// Cues that aim fixtures at named stage positions (position presets).
//
// The stage works out a fixture's pan / tilt for a position (it has the 3D
// geometry); a cue keeps those values on the fixture's pan / tilt faders like
// any other levels, plus a note (Cue.aims) that they aim at the position. When
// the position or the fixture moves, the stage sends the old and new values
// (Reaim), and every cue with the note that still has the old values gets the
// new ones. A cue whose pan / tilt were changed some other way (a fader, the
// chat, another aim) no longer has the old values, so it's left alone.

import type { AimPair, AimRequest, Reaim } from "../shared/console-stage.ts";
import type { ChannelValue } from "../shared/engine.ts";
import type { FaderPatch } from "./patch.ts";
import type { Cue, Song } from "./songs.ts";
import { clampByte } from "../shared/numbers.ts";

/** A cue's level for each fader patched to `channel` that makes it output `value` (with the master and submaster up). */
function fadersFor(patch: FaderPatch[], channel: number, value: number): [number, number][] {
  return patch.flatMap((targets, i) => {
    const t = targets.find((p) => p.channel === channel);
    return t && t.max > 0 ? [[i, clampByte((value * 255) / t.max)] as [number, number]] : [];
  });
}

/** Whether `cue` outputs `values` on its own (every fader patched to each channel has the level for it). */
function has(cue: Cue, patch: FaderPatch[], values: ChannelValue[]): boolean {
  return values.every(({ channel, value }) => fadersFor(patch, channel, value).every(([i, level]) => cue.levels[i] === level));
}

/** Put `values` on the faders; returns whether a level changed. */
function put(cue: Cue, patch: FaderPatch[], values: ChannelValue[]): boolean {
  let moved = false;
  for (const { channel, value } of values) {
    for (const [i, level] of fadersFor(patch, channel, value)) {
      if (cue.levels[i] !== level) { cue.levels[i] = level; moved = true; }
    }
  }
  return moved;
}

/** Aim (or stop aiming) fixtures in these cues (the ones on the output). */
export function applyAims(cues: Cue[], patch: FaderPatch[], list: AimRequest[]) {
  for (const cue of cues) {
    for (const { consoleId, position, values } of list) {
      cue.aims = cue.aims.filter((a) => a.fixture !== consoleId);
      if (!position) continue;
      put(cue, patch, values);
      if (values.some(({ channel }) => patch.some((targets) => targets.some((t) => t.channel === channel)))) cue.aims.push({ fixture: consoleId, position });
    }
  }
}

/** Update every cue that still aims as `from` says. Returns whether any level changed. */
export function applyReaims(songs: Song[], patch: FaderPatch[], list: Reaim[]): boolean {
  let changed = false;
  for (const song of songs) {
    for (const cue of song.cues) {
      for (const r of list) {
        const aim = cue.aims.find((a) => a.fixture === r.consoleId && a.position === r.position);
        if (aim && has(cue, patch, r.from) && put(cue, patch, r.to)) changed = true;
      }
    }
  }
  return changed;
}

/** Every distinct fixture → position aim in the show. */
export function allAims(songs: Song[]): AimPair[] {
  const seen = new Map<string, AimPair>();
  for (const song of songs) for (const cue of song.cues) for (const a of cue.aims) seen.set(`${a.fixture}\n${a.position}`, a);
  return [...seen.values()];
}

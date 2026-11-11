import { test } from "node:test";
import assert from "node:assert/strict";
import { createCue, createSong } from "../console/songs.ts";
import { createSet, moveEntry, nextSetSong, normalizeSets, playbackCue, previousSetSong, upNextCue, type Playback } from "../console/sets.ts";

const song = (name: string, cues: number) => createSong({ name, cues: Array.from({ length: cues }, (_, i) => createCue({ name: `${name} ${i + 1}` })) });

/** A show with songs A (3 cues), B (2), C (2) and one set A, B, C. */
function show() {
  const songs = [song("A", 3), song("B", 2), song("C", 2)];
  const set = createSet({ name: "Tonight", songIds: songs.map((s) => s.id) });
  const play = (songIndex: number, fromCue: number, inSet = true): Playback => ({
    songs, sets: [set], activeSetId: set.id,
    activeEntryId: inSet ? set.entries[songIndex].id : null,
    activeSongId: songs[songIndex].id, fromCue,
  });
  return { songs, set, play };
}

test("sets: UP NEXT is the next cue, then the next set song's first", () => {
  const { songs, play } = show();
  assert.equal(upNextCue(play(0, 0)), 1);
  assert.equal(upNextCue(play(0, 1)), 2);
  // Last cue of A: UP NEXT is past the end = B's first cue.
  assert.equal(upNextCue(play(0, 2)), 3);
  assert.equal(playbackCue(play(0, 2), 3), songs[1].cues[0]);
  assert.equal(nextSetSong(play(0, 2))?.song, songs[1]);
});

test("sets: after the set's last song nothing is UP NEXT; outside the set it wraps", () => {
  const { play } = show();
  assert.equal(upNextCue(play(2, 1)), 1, "last cue of the last set song stays put");
  assert.equal(nextSetSong(play(2, 1)), null);
  assert.equal(upNextCue(play(0, 2, false)), 0, "played from outside the set: back to its first cue");
  assert.equal(playbackCue(play(0, 2, false), 3), undefined);
});

test("sets: a reprise (same song twice) runs on to the right entry", () => {
  const { songs, set, play } = show();
  set.entries.push({ id: "reprise", songId: songs[0].id });
  // Playing C (the third entry) runs on into the reprise of A.
  assert.equal(nextSetSong(play(2, 1))?.song, songs[0]);
  assert.equal(nextSetSong(play(2, 1))?.entry.id, "reprise");
});

test("sets: loading drops unknown songs and duplicate ids, and always has a set", () => {
  const songs = [song("A", 2)];
  const sets = normalizeSets([{ id: "s", name: " ", entries: [{ id: "e", songId: songs[0].id }, { id: "e", songId: songs[0].id }, { songId: "gone" }] }, { id: "s" }, "junk"], songs);
  assert.equal(sets.length, 2);
  assert.equal(sets[0].entries.length, 2);
  assert.notEqual(sets[0].entries[0].id, sets[0].entries[1].id);
  assert.notEqual(sets[0].id, sets[1].id);
  assert.ok(sets[0].name.trim(), "a blank name gets a default");
  const none = normalizeSets(null, songs);
  assert.equal(none.length, 1);
  assert.deepEqual(none[0].entries.map((e) => e.songId), [songs[0].id]);
});

test("sets: moveEntry reorders before or after another entry", () => {
  const { set } = show();
  const [a, b, c] = set.entries.map((e) => e.id);
  assert.equal(moveEntry(set, a, c, true), true);
  assert.deepEqual(set.entries.map((e) => e.id), [b, c, a]);
  assert.equal(moveEntry(set, a, b, false), true);
  assert.deepEqual(set.entries.map((e) => e.id), [a, b, c]);
  assert.equal(moveEntry(set, a, a, false), false);
  assert.equal(moveEntry(set, "nope", a, false), false);
});

test("sets: the song before the playing one (none for the first, or outside the set)", () => {
  const { songs, play } = show();
  assert.equal(previousSetSong(play(1, 0))?.song, songs[0]);
  assert.equal(previousSetSong(play(0, 0)), null);
  assert.equal(previousSetSong(play(1, 0, false)), null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { findRangeConflict, nextAvailableRange, normalizeChannelSpan, normalizeFixtures } from "../console/fixtures.ts";
import { asChannel as ch } from "../shared/address.ts";

const at = (id: string, channelStart: number, channelEnd: number) => ({ id, channelStart: ch(channelStart), channelEnd: ch(channelEnd) });

test("console fixtures: a channel block stays inside one universe", () => {
  assert.deepEqual(normalizeChannelSpan(10, 4), { channelStart: 10, channelEnd: 13 });
  assert.equal(normalizeChannelSpan(510, 4), null, "would cross from universe 1 into 2");
  assert.deepEqual(normalizeChannelSpan(513, 4), { channelStart: 513, channelEnd: 516 });
  assert.equal(normalizeChannelSpan(1, 0), null);
  assert.equal(normalizeChannelSpan(1, 65), null, "more channels than a fixture may have");
});

test("console fixtures: overlaps are found, and the next free block skips them", () => {
  const list = [at("a", 1, 6), at("b", 10, 12)];
  assert.equal(findRangeConflict(list, 6, 8)?.id, "a");
  assert.equal(findRangeConflict(list, 7, 9), null);
  assert.equal(findRangeConflict(list, 1, 3, "a"), null, "a fixture doesn't clash with itself");
  assert.deepEqual(nextAvailableRange(list, 3), { channelStart: 7, channelEnd: 9 });
  assert.deepEqual(nextAvailableRange(list, 4), { channelStart: 13, channelEnd: 16 });
  assert.equal(nextAvailableRange([at("full", 1, 512)], 1), null, "one universe, all used");
});

test("console fixtures: loading moves clashing fixtures to free channels", () => {
  const out = normalizeFixtures([
    { id: "a", name: "A", channelStart: 1, channelEnd: 4 },
    { id: "b", name: "B", channelStart: 3, channelEnd: 5 },
    { id: "a", name: "Dup id", channelStart: 20, channelEnd: 20 },
  ]);
  assert.deepEqual(out.map((f) => [f.channelStart, f.channelEnd]), [[1, 4], [5, 7], [20, 20]]);
  assert.equal(new Set(out.map((f) => f.id)).size, 3, "ids are made unique");
});

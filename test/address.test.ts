import { test } from "node:test";
import assert from "node:assert/strict";
import { addressOf, asChannel as ch, asUniverse, channelAt, formatAddress, parseAddress, universeOf, universeStart } from "../shared/address.ts";

test("channels run on across universes (513 = universe 2 channel 1)", () => {
  assert.equal(universeOf(ch(512)), 1);
  assert.equal(universeOf(ch(513)), 2);
  assert.equal(addressOf(ch(513)), 1);
  assert.equal(universeStart(asUniverse(3)), 1025);
  assert.equal(channelAt(asUniverse(2), 45), 557);
});

test("formatAddress: plain with one universe, universe/channel with several", () => {
  assert.equal(formatAddress(45, 1), "45");
  assert.equal(formatAddress(557, 2), "2/45");
  assert.equal(formatAddress(45, 2), "1/45");
});

test("parseAddress: both forms, and what's out of range", () => {
  assert.equal(parseAddress("45", 1), 45);
  assert.equal(parseAddress(" 2 / 45 ", 2), 557);
  assert.equal(parseAddress("2/45", 1), null, "universe beyond the show's");
  assert.equal(parseAddress("513", 2), null, "channel beyond a universe");
  assert.equal(parseAddress("0", 1), null);
  assert.equal(parseAddress("", 1), null);
  assert.equal(parseAddress("abc", 1), null);
});

test("format and parse agree", () => {
  for (const ch of [1, 45, 512, 513, 1000, 4096]) assert.equal(parseAddress(formatAddress(ch, 8), 8), ch);
});

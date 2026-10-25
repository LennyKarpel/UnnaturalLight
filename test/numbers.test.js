import { test } from "node:test";
import assert from "node:assert/strict";
import { clamp, clampByte, numberFrom } from "../shared/numbers.js";

test("numberFrom: an empty or missing value is no number, not 0", () => {
  for (const v of ["", "   ", null, undefined, "abc", "1x", NaN]) assert.equal(numberFrom(v), null, String(v));
});

test("numberFrom: numbers and numeric text", () => {
  assert.equal(numberFrom("0"), 0);
  assert.equal(numberFrom(" 12.5 "), 12.5);
  assert.equal(numberFrom("-3"), -3);
  assert.equal(numberFrom(7), 7);
});

test("clamp: limits, and not-a-number becomes the low end", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
  assert.equal(clamp(NaN, 2, 10), 2);
});

test("clampByte: a whole number 0–255", () => {
  assert.equal(clampByte(127.6), 128);
  assert.equal(clampByte(-4), 0);
  assert.equal(clampByte(300), 255);
  assert.equal(clampByte("x", 9), 9);
});

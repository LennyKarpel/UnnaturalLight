import { test } from "node:test";
import assert from "node:assert/strict";
import { convertLength, describeSpot, fmtLength, fromShown, lengthUnit, setLengthUnit, snapLength, toShown } from "../stage/units.ts";

test("units: meters by default, feet shown and typed back to meters", () => {
  assert.equal(lengthUnit(), "m");
  assert.equal(toShown(2.5), 2.5);
  assert.equal(snapLength(1.234), 1.2);
  assert.equal(describeSpot({ x: -1.2, y: 0, z: 2.8 }, "Floor"), "x -1.2 (SR) · height 0 · z 2.8 (DS) m · Floor");
  setLengthUnit("ft");
  try {
    assert.equal(toShown(3.048), 10);
    assert.equal(fromShown(10), 3.048);
    assert.equal(toShown(fromShown(7.25)), 7.25); // what's typed shows back the same
    assert.equal(fmtLength(1), "3.3 ft");
    assert.equal(toShown(snapLength(1)), 3.25); // 3-inch steps
    assert.equal(convertLength(10, "ft", "m"), 3.05);
  } finally {
    setLengthUnit("m");
  }
});

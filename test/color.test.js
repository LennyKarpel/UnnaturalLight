import { test } from "node:test";
import assert from "node:assert/strict";
import { colorFromLevels, emitterHex, hexFromRgb, levelsFromColor, rgbFromHex } from "../shared/color.js";

const RGB = ["red", "green", "blue"];
/** The ETC Source Four LED Series 3 Lustr X8's emitters. */
const LUSTR = ["deepred", "red", "amber", "lime", "green", "cyan", "blue", "indigo"];

/** Two hex colors within `tol` per channel. */
function near(a, b, tol = 2) {
  const [x, y] = [rgbFromHex(a), rgbFromHex(b)];
  return x.every((v, i) => Math.abs(v - y[i]) <= tol);
}

test("hex ↔ rgb", () => {
  assert.deepEqual(rgbFromHex("#ff8040"), [255, 128, 64]);
  assert.equal(hexFromRgb(255, 128, 64), "#ff8040");
  assert.deepEqual(rgbFromHex("nope"), [255, 255, 255]);
});

test("red / green / blue only: the picked values exactly", () => {
  assert.deepEqual(levelsFromColor("#ff8040", RGB), { red: 255, green: 128, blue: 64 });
});

test("white takes the part red, green and blue share", () => {
  assert.deepEqual(levelsFromColor("#ffffff", [...RGB, "white"]), { white: 255, red: 0, green: 0, blue: 0 });
});

test("tints go to the nearest hue: yellow-green → lime, orange → amber", () => {
  const yg = levelsFromColor("#aaff00", LUSTR);
  assert.ok(yg.lime > 200 && yg.amber === 0, JSON.stringify(yg));
  const orange = levelsFromColor("#ff9900", LUSTR);
  assert.ok(orange.amber === 255 && orange.lime === 0, JSON.stringify(orange));
});

test("UV is never mixed", () => {
  assert.ok(!("uv" in levelsFromColor("#8000ff", [...RGB, "uv"])));
});

test("mixing and reading back give the same color", () => {
  for (const roles of [RGB, [...RGB, "white", "amber"], LUSTR]) {
    for (const hex of ["#ff8040", "#aaff00", "#ff9900", "#c00020", "#00ffff", "#7f7f7f", "#2040ff", "#000000"]) {
      const back = colorFromLevels(levelsFromColor(hex, roles));
      assert.ok(near(hex, back), `${hex} on ${roles.join("/")} → ${back}`);
    }
  }
});

test("colorFromLevels scales a too-bright mix down, keeping its hue", () => {
  assert.equal(colorFromLevels({ red: 255, white: 255 }), "#ff8080");
});

test("emitter swatches", () => {
  assert.equal(emitterHex("red"), "#ff0000");
  assert.equal(emitterHex("deepred"), "#a8001c");
  assert.equal(emitterHex("unknown"), "#000000");
});

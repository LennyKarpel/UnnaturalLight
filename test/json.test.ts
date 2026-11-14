import { test } from "node:test";
import assert from "node:assert/strict";
import { prettyJson } from "../shared/json.ts";

test("prettyJson: indented, lists of numbers on one line, reads back the same", () => {
  const value = { name: "Show", cues: [{ levels: [0, 255, 12], aims: [] }, { levels: [] }], skip: undefined, nested: { a: [1, "x"], b: null } };
  const text = prettyJson(value);
  assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(value)));
  assert.match(text, /"levels": \[0,255,12]/);
  assert.match(text, /\n {2}"cues": \[\n {4}\{/);
  assert.ok(!text.includes("skip"));
  assert.ok(text.endsWith("}\n"));
});

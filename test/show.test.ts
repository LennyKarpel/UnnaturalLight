import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_NAV_ORDER, normalizeNavOrder, parseShow, serializeShow } from "../console/show.ts";

test("an empty file gives a usable show", () => {
  const show = parseShow({});
  assert.equal(show.songs.length, 1);
  assert.equal(show.sets.length, 1);
  assert.equal(show.universes, 1);
  assert.deepEqual(show.navOrder, DEFAULT_NAV_ORDER);
});

test("saving and loading give the same show", () => {
  // Everything but when it was saved.
  const withoutDate = ({ savedAt: _, ...rest }: ReturnType<typeof serializeShow>) => rest;
  const saved = serializeShow(parseShow({}));
  const again = serializeShow(parseShow(JSON.parse(JSON.stringify(saved))));
  assert.deepEqual(withoutDate(again), withoutDate(saved));
});

test("a file from another app is refused", () => {
  assert.throws(() => parseShow({ app: "Other", kind: "show" }), /not an UnnaturalLight show/);
});

test("tab order: unknown tabs dropped, missing ones after the tab before them", () => {
  assert.deepEqual(normalizeNavOrder(["patch", "bogus", "run"]), ["show", "set", "patch", "run", "channels", "fixtures"]);
  assert.deepEqual(normalizeNavOrder([]), DEFAULT_NAV_ORDER);
});

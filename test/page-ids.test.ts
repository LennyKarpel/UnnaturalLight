// Every element the code looks up by id (elById, shared/query.ts) is in a
// page, and no page has an id twice. A renamed or mistyped id otherwise
// only shows up when that code runs (elById throws, naming it).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGES = ["index.html", "page/help.html"];
const SOURCES = ["console", "stage", "page", "shared"];

const idsIn = (html: string) => [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1] ?? "");

/** The browser code's .ts files (not the server's: it has no page). */
function sourceFiles(): string[] {
  return SOURCES.flatMap((dir) => fs.readdirSync(path.join(ROOT, dir), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .map((f) => path.join(dir, f)));
}

test("no page has an id twice", () => {
  for (const page of PAGES) {
    const ids = idsIn(fs.readFileSync(path.join(ROOT, page), "utf8"));
    assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], page);
  }
});

test("every id the code looks up (elById) is in a page", () => {
  const ids = new Set(PAGES.flatMap((page) => idsIn(fs.readFileSync(path.join(ROOT, page), "utf8"))));
  const missing: string[] = [];
  let looked = 0;
  for (const file of sourceFiles()) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const [, id = ""] of source.matchAll(/\belById(?:<[^>]*>)?\(\s*"([^"]+)"/g)) {
      looked++;
      if (!ids.has(id)) missing.push(`${file}: ${id}`);
    }
  }
  assert.ok(looked > 100, `found only ${looked} lookups: has elById been renamed?`);
  assert.deepEqual(missing, []);
});

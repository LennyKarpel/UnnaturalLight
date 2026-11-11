// The server's data files (server/data/): read and write readable JSON.

import fs from "node:fs";
import { prettyJson } from "../shared/json.ts";

/** A file's JSON, or null when it's missing or unreadable (first run). */
export function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Write JSON (shared/json.ts's readable layout) to a temporary file, then put it in place: a crash mid-write never leaves half a file. */
export function writeJsonFile(file: string, value: unknown) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, prettyJson(value));
  fs.renameSync(tmp, file);
}

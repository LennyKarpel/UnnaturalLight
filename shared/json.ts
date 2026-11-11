// Readable JSON for the files people may open: indented two spaces, but a
// list of plain numbers (a cue's 256 fader levels, a channel layout…) stays
// on one line, so a show reads (and diffs) a cue per few lines, not 260.

export function prettyJson(value: unknown): string {
  return `${format(value, "")}\n`;
}

function format(value: unknown, indent: string): string {
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    if (value.every((v) => typeof v === "number")) return JSON.stringify(value);
    const inner = indent + "  ";
    return `[\n${value.map((v) => inner + (v === undefined || typeof v === "function" ? "null" : format(v, inner))).join(",\n")}\n${indent}]`;
  }
  if (value && typeof value === "object") {
    const inner = indent + "  ";
    const entries = Object.entries(value).filter(([, v]) => v !== undefined && typeof v !== "function");
    if (!entries.length) return "{}";
    return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${format(v, inner)}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value) ?? "null";
}

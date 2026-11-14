/** Finding songs and fixtures by what the model calls them (for the tools in ./tools/). */

/** A song by its number (1 = first in the show) or name (exact, else the one whose name contains it). */
export function findSong(songs: { id: string; name: string; cues: number }[], query: unknown) {
  const q = String(query ?? "").trim();
  if (/^\d+$/.test(q)) {
    const n = Number(q);
    if (n >= 1 && n <= songs.length) return songs[n - 1];
  }
  const lower = q.toLowerCase();
  if (!lower) throw new Error("Which song? Give its number or name");
  const exact = songs.filter((s) => s.name.toLowerCase() === lower);
  if (exact.length === 1) return exact[0];
  const partial = songs.filter((s) => s.name.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0];
  const names = (exact.length > 1 ? exact : partial).map((s) => `"${s.name}"`);
  throw new Error(names.length > 1 ? `"${q}" matches ${names.join(", ")}: which one?` : `No song "${q}"`);
}

/**
 * One stage item (a truss, named position or riser) by name: exact, ignoring
 * case, else the one whose name contains it. `kind` names it in the errors
 * ("position", plural `kinds`); `none` is the error when there are none at all.
 */
export function findByName<T extends { name: string }>(items: T[], query: unknown, kind: string, none: string, kinds = `${kind}s`): T {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) throw new Error(`Which ${kind}?`);
  const exact = items.filter((item) => item.name.toLowerCase() === q);
  if (exact.length === 1) return exact[0];
  const partial = items.filter((item) => item.name.toLowerCase().includes(q));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw new Error(`"${query}" matches ${partial.map((item) => `"${item.name}"`).join(", ")}: which one?`);
  throw new Error(items.length ? `No ${kind} "${query}" (${kinds}: ${items.map((item) => item.name).join(", ")})` : none);
}

/**
 * Fixtures by name: each query is a fixture's name, a group's name or "all"
 * (exact, ignoring case), else the one fixture whose name contains it.
 */
export function findFixtures<T extends { name: string; group?: string | null }>(all: T[], queries: unknown): T[] {
  const list = (Array.isArray(queries) ? queries : [queries]).map((q) => String(q ?? "").trim()).filter(Boolean);
  if (!list.length) throw new Error("Which fixtures? Give names, group names or \"all\"");
  const found = new Set<T>();
  for (const q of list) {
    const lower = q.toLowerCase();
    let hits = lower === "all" ? all : all.filter((f) => f.name.toLowerCase() === lower);
    if (!hits.length) hits = all.filter((f) => f.group?.toLowerCase() === lower);
    if (!hits.length) {
      const partial = all.filter((f) => f.name.toLowerCase().includes(lower));
      if (partial.length > 1) throw new Error(`"${q}" matches ${partial.map((f) => `"${f.name}"`).join(", ")}: which one(s)?`);
      hits = partial;
    }
    if (!hits.length) throw new Error(`No fixture or group "${q}"`);
    for (const f of hits) found.add(f);
  }
  return [...found];
}

/** A set by its number (1 = first) or name (exact, else the one whose name contains it). */
export function findSet<T extends { name: string }>(sets: T[], query: unknown): T {
  const q = String(query ?? "").trim();
  if (/^\d+$/.test(q)) {
    const n = Number(q);
    if (n >= 1 && n <= sets.length) return sets[n - 1];
  }
  return findByName(sets, q, "set", "There are no sets");
}

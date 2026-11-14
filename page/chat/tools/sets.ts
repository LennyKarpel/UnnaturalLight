/** The chat's set tools: the running orders of the show's songs for each event. */

import { findSet, findSong } from "../find.ts";
import { type ToolDef, api, number, playing, NO_ARGS } from "./common.ts";

const SET = { type: "string", description: "The set's number or name (default: the running set, the one the Run tab plays)" };
const SET_POSITION = { type: "integer", minimum: 1, description: "A place in the set's running order (1 = its first song)" };

/** A set's id by number or name (null = the running set) and the set. */
function pickSet(query: unknown) {
  const sets = api().sets();
  const set = query == null || query === "" ? sets.find((s) => s.running) ?? sets[0] : findSet(sets, query);
  return { id: set.id, set };
}

/** What a set holds now: what the model is told after editing it. */
function setReport(id: string) {
  const set = api().sets().find((s) => s.id === id);
  if (!set) return { sets: api().sets().map((s) => s.name) };
  return { set: set.name, running: set.running, songs: set.songs.map((s, i) => `${i + 1}. ${s.name}`) };
}

export const SET_TOOLS: ToolDef[] = [
  {
    name: "get_sets",
    description:
      "Every set (a running order of the show's songs for one event; a song can be in many sets, or twice in one) with its numbered songs, and which one the Run tab runs.",
    schema: NO_ARGS,
    describe: () => "Looked at the sets",
    run: () => api().sets().map((s, i) => ({ number: i + 1, name: s.name, running: s.running, songs: s.songs.map((x, j) => `${j + 1}. ${x.name}`) })),
  },
  {
    name: "add_to_set",
    description: "Add songs from the show to a set, in the order given, at the end or at a place in its running order. A song already in the set is added again.",
    schema: {
      type: "object",
      properties: {
        songs: { type: "array", minItems: 1, items: { type: "string" }, description: "Songs by number in the show or name" },
        set: SET,
        position: { ...SET_POSITION, description: "Where the first one goes in the set (default: after its last song)" },
      },
      required: ["songs"],
      additionalProperties: false,
    },
    describe: (a) => `Add ${Array.isArray(a.songs) ? a.songs.join(", ") : a.songs} to ${a.set ? `set ${a.set}` : "the set"}`,
    run: (a) => {
      const { id, set } = pickSet(a.set);
      const all = api().songs();
      const ids = (Array.isArray(a.songs) ? a.songs : [a.songs]).map((q) => findSong(all, q).id);
      if (!ids.length) throw new Error("Which songs?");
      const at = a.position == null ? undefined : number(a.position, set.songs.length + 1, "position") - 1;
      api().addToSet(id, ids, at);
      return setReport(id);
    },
  },
  {
    name: "remove_from_set",
    description: "Take a song out of a set, by its place in the running order or by name (it stays in the show).",
    schema: {
      type: "object",
      properties: { set: SET, position: SET_POSITION, song: { type: "string", description: "The song's name (or number in the show)" } },
      additionalProperties: false,
    },
    describe: (a) => `Take ${a.position != null ? `#${a.position}` : a.song} out of ${a.set ? `set ${a.set}` : "the set"}`,
    run: (a) => {
      const { id, set } = pickSet(a.set);
      let index: number;
      if ((a.position == null) === (a.song == null)) throw new Error("Give either position or song");
      if (a.position != null) index = number(a.position, set.songs.length, "position") - 1;
      else {
        const song = findSong(api().songs(), a.song);
        const places = set.songs.flatMap((s, i) => (s.id === song.id ? [i + 1] : []));
        if (!places.length) throw new Error(`"${song.name}" isn't in "${set.name}"`);
        if (places.length > 1) throw new Error(`"${song.name}" is in "${set.name}" ${places.length} times (at ${places.join(", ")}): give the position`);
        index = places[0] - 1;
      }
      api().removeFromSet(id, index);
      return setReport(id);
    },
  },
  {
    name: "move_in_set",
    description: "Move a song to another place in a set's running order.",
    schema: {
      type: "object",
      properties: {
        set: SET,
        from: { ...SET_POSITION, description: "Its place in the set now" },
        to: { ...SET_POSITION, description: "Its new place" },
      },
      required: ["from", "to"],
      additionalProperties: false,
    },
    describe: (a) => `Move #${a.from} to #${a.to} in ${a.set ? `set ${a.set}` : "the set"}`,
    run: (a) => {
      const { id, set } = pickSet(a.set);
      const n = set.songs.length;
      api().moveInSet(id, number(a.from, n, "from") - 1, number(a.to, n, "to") - 1);
      return setReport(id);
    },
  },
  {
    name: "new_set",
    description: "Make a new set, empty or with songs in the order given. It doesn't run; use run_set for that.",
    schema: {
      type: "object",
      properties: {
        name: { type: "string", maxLength: 40 },
        songs: { type: "array", items: { type: "string" }, description: "Songs by number in the show or name" },
      },
      required: ["name"],
      additionalProperties: false,
    },
    describe: (a) => `New set "${a.name}"`,
    run: (a) => {
      const all = api().songs();
      const ids = (Array.isArray(a.songs) ? a.songs : []).map((q) => findSong(all, q).id);
      return setReport(api().newSet(String(a.name ?? ""), ids));
    },
  },
  {
    name: "rename_set",
    description: "Rename a set.",
    schema: { type: "object", properties: { set: SET, name: { type: "string", maxLength: 40 } }, required: ["name"], additionalProperties: false },
    describe: (a) => `Rename ${a.set ? `set ${a.set}` : "the set"} to "${a.name}"`,
    run: (a) => {
      const { id } = pickSet(a.set);
      return { name: api().renameSet(id, String(a.name ?? "")) };
    },
  },
  {
    name: "duplicate_set",
    description: "Copy a set (its running order) to a new set right after it, named \"… copy\" unless a name is given.",
    schema: { type: "object", properties: { set: SET, name: { type: "string", maxLength: 40 } }, additionalProperties: false },
    describe: (a) => `Duplicate ${a.set ? `set ${a.set}` : "the set"}`,
    run: (a) => setReport(api().duplicateSet(pickSet(a.set).id, a.name == null ? undefined : String(a.name))),
  },
  {
    name: "delete_set",
    description: "Delete a set; its songs stay in the show. The show keeps at least one set. Deleting the running set runs the first one left.",
    schema: { type: "object", properties: { set: SET }, required: ["set"], additionalProperties: false },
    describe: (a) => `Delete set ${a.set}`,
    run: (a) => {
      const { id, set } = pickSet(a.set);
      api().deleteSet(id);
      return { deleted: set.name, sets: api().sets().map((s) => (s.running ? `${s.name} (running)` : s.name)) };
    },
  },
  {
    name: "run_set",
    description:
      "Make a set the one the Run tab runs (GO goes on from each song's last cue to the next song in it) and play it from its first song, or from a place in it, at once with no fade.",
    schema: { type: "object", properties: { set: SET, from: { ...SET_POSITION, description: "Start here (default: its first song)" } }, additionalProperties: false },
    describe: (a) => `Run ${a.set ? `set ${a.set}` : "the set"}${a.from ? ` from #${a.from}` : ""}`,
    run: (a) => {
      const { id, set } = pickSet(a.set);
      api().runSet(id, a.from == null ? undefined : number(a.from, set.songs.length, "from") - 1);
      return { ...setReport(id), playing: playing() };
    },
  },
];

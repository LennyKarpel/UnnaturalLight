// Set tab: build a set (a running order for one event) from the show's
// songs — drag them in, reorder, take them out — and pick which set the
// Run tab runs.
import {
  createEntry,
  createSet,
  defaultSetName,
  MAX_SET_ENTRIES,
  MAX_SETS,
  moveEntry,
  normalizeSetName,
  type SetEntry,
  type ShowSet,
} from "./sets.ts";
import {
  tabSet,
  setSelect,
  setMenuBtn,
  runSetBtn,
  setSongSearch,
  setSourceScroll,
  setSourceList,
  setEntryScroll,
  setEntryList,
  setEntryEmpty,
  setEntryCount,
  dropSlot,
  showDropLine,
  closePopup,
} from "./dom.ts";
import { getActiveEntry, persistSession, state } from "./state.ts";
import { abortInlineEdits, confirmAction, promptName } from "./faders.ts";
import { openActionMenu } from "./cues.ts";
import { refreshUpNext, setActiveSong } from "./show-tab.ts";
import { el, button } from "../shared/html.ts";
import { clamp } from "../shared/numbers.ts";

/** The set shown here (not necessarily the one the Run tab runs). */
let editSetId = state.activeSetId;

/**
 * What's being dragged: a show song (to add) or one of the set's entries
 * (to move, or to take out by dropping it back on the show).
 */
let drag: null | { kind: "song"; songId: string } | { kind: "entry"; entryId: string } = null;

function editSet() {
  const set = state.sets.find((item) => item.id === editSetId) ?? state.sets.find((item) => item.id === state.activeSetId) ?? state.sets[0];
  editSetId = set.id;
  return set;
}

/** `set` changed: show it here, save, and if it's the one running, update UP NEXT. (The Show tab redraws when it's opened.) */
function setChanged(set: ShowSet) {
  editSetId = set.id;
  if (set.id === state.activeSetId) refreshUpNext();
  else persistSession();
  renderSetTab();
}

export function renderSetTab() {
  if (tabSet.hidden) return;
  const set = editSet();
  const running = set.id === state.activeSetId;

  setSelect.replaceChildren(
    ...state.sets.map((item) => new Option(item.id === state.activeSetId ? `${item.name} (running)` : item.name, item.id)),
  );
  setSelect.value = set.id;
  runSetBtn.disabled = running;
  runSetBtn.textContent = running ? "Running" : "Run this set";
  runSetBtn.title = running ? "The Run tab runs this set" : "Run this set on the Run tab, from its first song";

  renderSourceList(set);
  renderEntryList(set, running);
}

function renderSourceList(set: ShowSet) {
  const query = setSongSearch.value.trim().toLowerCase();
  const full = set.entries.length >= MAX_SET_ENTRIES;
  const rows = [];
  for (const song of state.songs) {
    if (query && !song.name.toLowerCase().includes(query)) continue;
    const row = el("div", "song-row set-source-row");
    row.setAttribute("role", "listitem");
    row.dataset.songId = song.id;
    row.draggable = true;
    row.title = "Drag into the running order";

    const name = el("h3", "song-row-name", song.name);

    const meta = el("span", "song-row-meta");
    const times = set.entries.filter((entry) => entry.songId === song.id).length;
    meta.textContent = times === 0 ? "" : times === 1 ? "in this set" : `in this set ×${times}`;

    const add = button("quiet set-add-btn", "+");
    add.title = `Add ${song.name} to the end of the set`;
    add.setAttribute("aria-label", `Add ${song.name} to the set`);
    add.disabled = full;
    add.addEventListener("click", () => addSongToSet(song.id, set.entries.length));

    row.append(name, meta, add);
    row.addEventListener("dragstart", (event) => {
      abortInlineEdits();
      drag = { kind: "song", songId: song.id };
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "copyMove";
        event.dataTransfer.setData("text/plain", song.name);
      }
    });
    row.addEventListener("dragend", endDrag);
    rows.push(row);
  }
  setSourceList.replaceChildren(...rows);
  if (rows.length === 0) {
    const empty = el("div", "fixture-empty", query ? "No song matches." : "No songs yet.");
    setSourceList.append(empty);
  }
}

function renderEntryList(set: ShowSet, running: boolean) {
  const playing = running ? getActiveEntry()?.id : null;
  setEntryEmpty.hidden = set.entries.length > 0;
  const n = set.entries.length;
  setEntryCount.textContent = `${n} song${n === 1 ? "" : "s"}`;

  setEntryList.replaceChildren(...set.entries.map((entry, index) => {
    const song = state.songs.find((item) => item.id === entry.songId);
    const row = el("div", "song-row set-entry-row");
    row.setAttribute("role", "listitem");
    row.dataset.entryId = entry.id;
    row.draggable = true;
    row.title = "Click to play from here · drag to reorder · drag back to the show to take out";
    if (entry.id === playing) row.classList.add("is-active");

    const handle = el("div", "song-drag-handle");
    handle.setAttribute("aria-hidden", "true");
    handle.textContent = "⋮⋮";

    const number = el("span", "set-entry-number", String(index + 1));

    const name = el("h3", "song-row-name", song?.name ?? "");

    const badge = el("span", "song-row-badge", entry.id === playing ? "Playing" : "");

    const remove = button("quiet set-remove-btn", "✕");
    remove.title = "Take out of the set";
    remove.setAttribute("aria-label", `Take ${song?.name ?? "song"} out of the set`);
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      removeEntry(entry.id);
    });

    row.append(handle, number, name, badge, remove);
    row.addEventListener("click", () => playEntry(entry.id));
    row.addEventListener("dragstart", (event) => {
      abortInlineEdits();
      drag = { kind: "entry", entryId: entry.id };
      row.classList.add("is-dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", song?.name ?? "");
      }
    });
    row.addEventListener("dragend", endDrag);
    return row;
  }));
}

function endDrag() {
  drag = null;
  clearDropMarks();
  for (const row of setEntryList.querySelectorAll<HTMLElement>(".is-dragging")) row.classList.remove("is-dragging");
}

function clearDropMarks() {
  setEntryScroll.classList.remove("is-drop-target");
  setSourceScroll.classList.remove("is-drop-target");
  for (const el of setEntryList.querySelectorAll<HTMLElement>(".is-drop-before, .is-drop-after")) {
    el.classList.remove("is-drop-before", "is-drop-after");
  }
}

/** Where a drop at `clientY` would land in the running order (see dropSlot), or null. */
function entrySlot(clientY: number) {
  const rows = [...setEntryList.querySelectorAll<HTMLElement>(":scope > .set-entry-row")];
  const d = drag;
  const dragged = d?.kind === "entry" ? rows.find((row) => row.dataset.entryId === d.entryId) : undefined;
  return { rows, slot: dropSlot(rows, dragged, clientY) };
}

// Running order: drop a show song in (at the line), or move an entry.
setEntryScroll.addEventListener("dragover", (event) => {
  if (!drag) return;
  if (drag.kind === "song" && editSet().entries.length >= MAX_SET_ENTRIES) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = drag.kind === "song" ? "copy" : "move";
  const { rows, slot } = entrySlot(event.clientY);
  setEntryScroll.classList.toggle("is-drop-target", drag.kind === "song" && rows.length === 0);
  showDropLine(rows, rows.length ? slot : null);
});

setEntryScroll.addEventListener("dragleave", (event) => {
  if (!(event.relatedTarget instanceof Node) || !setEntryScroll.contains(event.relatedTarget)) clearDropMarks();
});

setEntryScroll.addEventListener("drop", (event) => {
  if (!drag) return;
  event.preventDefault();
  const what = drag;
  const { rows, slot } = entrySlot(event.clientY);
  endDrag();
  if (what.kind === "song") {
    addSongToSet(what.songId, slot ?? rows.length);
  } else if (slot != null) {
    const after = slot === rows.length;
    const targetId = rows[after ? rows.length - 1 : slot].dataset.entryId;
    if (targetId) reorderSet(editSet(), what.entryId, targetId, after);
  }
});

// Show column: drop an entry here to take it out of the set.
setSourceScroll.addEventListener("dragover", (event) => {
  if (drag?.kind !== "entry") return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  setSourceScroll.classList.add("is-drop-target");
});

setSourceScroll.addEventListener("dragleave", (event) => {
  if (!(event.relatedTarget instanceof Node) || !setSourceScroll.contains(event.relatedTarget)) clearDropMarks();
});

setSourceScroll.addEventListener("drop", (event) => {
  if (drag?.kind !== "entry") return;
  event.preventDefault();
  const { entryId } = drag;
  endDrag();
  removeEntry(entryId);
});

// --- set edits (the tab's controls and the chat's tools both use these) ------
// Each takes the set it edits and shows that set here.

/** Put `songId` in `set` at `index` (clamped). Returns the new entry. */
export function addToSet(set: ShowSet, songId: string, index = set.entries.length): SetEntry {
  if (set.entries.length >= MAX_SET_ENTRIES) throw new Error(`A set holds at most ${MAX_SET_ENTRIES} songs`);
  const entry = createEntry(songId);
  set.entries.splice(clamp(index, 0, set.entries.length), 0, entry);
  setChanged(set);
  return entry;
}

export function removeFromSet(set: ShowSet, entryId: string) {
  set.entries = set.entries.filter((entry) => entry.id !== entryId);
  setChanged(set);
}

/** Move entry `fromId` before (or `after`) entry `toId`. */
export function reorderSet(set: ShowSet, fromId: string, toId: string, after: boolean) {
  if (moveEntry(set, fromId, toId, after)) setChanged(set);
}

/** Run `set` from `entryId` (its song, first cue). */
export function playSetEntry(set: ShowSet, entryId: string) {
  const entry = set.entries.find((item) => item.id === entryId);
  if (!entry) return;
  editSetId = set.id;
  state.activeSetId = set.id;
  setActiveSong(entry.songId, entry.id);
  renderSetTab();
}

/** Make `set` the one the Run tab runs, from its first song. */
export function runSet(set: ShowSet) {
  if (set.entries.length) {
    playSetEntry(set, set.entries[0].id);
  } else {
    editSetId = set.id;
    state.activeSetId = set.id;
    refreshUpNext();
    renderSetTab();
  }
}

/** A new set after `after` (default: at the end), with `songIds` in order. */
export function addSet(name: string, songIds: string[] = [], after?: ShowSet): ShowSet {
  if (state.sets.length >= MAX_SETS) throw new Error(`The show has its maximum of ${MAX_SETS} sets`);
  const set = createSet({ name: normalizeSetName(name, state.sets.length), songIds });
  state.sets.splice(after ? state.sets.indexOf(after) + 1 : state.sets.length, 0, set);
  editSetId = set.id;
  persistSession();
  renderSetTab();
  return set;
}

export function renameSetTo(set: ShowSet, name: string) {
  set.name = normalizeSetName(name, state.sets.indexOf(set));
  setChanged(set);
  return set.name;
}

/** A copy of `set` right after it, named "… copy" unless `name` is given. */
export function copySet(set: ShowSet, name?: string) {
  return addSet(name ?? `${set.name} copy`.slice(0, 40), set.entries.map((entry) => entry.songId), set);
}

/** Delete `set` (its songs stay in the show; the show keeps at least one set). Deleting the running set runs the first one left. */
export function removeSet(set: ShowSet) {
  if (state.sets.length <= 1) throw new Error("The show keeps at least one set");
  const running = set.id === state.activeSetId;
  state.sets.splice(state.sets.indexOf(set), 1);
  if (editSetId === set.id) editSetId = state.sets[0].id;
  if (running) {
    state.activeSetId = state.sets[0].id;
    refreshUpNext();
  } else {
    persistSession();
  }
  renderSetTab();
}

// --- the tab's controls -------------------------------------------------------

function addSongToSet(songId: string, index: number) {
  const set = editSet();
  if (set.entries.length < MAX_SET_ENTRIES) addToSet(set, songId, index);
}

function removeEntry(entryId: string) {
  removeFromSet(editSet(), entryId);
}

function playEntry(entryId: string) {
  playSetEntry(editSet(), entryId);
}

async function newSet() {
  if (state.sets.length >= MAX_SETS) return;
  const name = await promptName({ title: "New set", confirmLabel: "Create", initial: defaultSetName(state.sets.length) });
  if (!name || state.sets.length >= MAX_SETS) return;
  addSet(name);
}

async function renameSet() {
  const set = editSet();
  const name = await promptName({ title: "Rename set", confirmLabel: "Rename", initial: set.name });
  if (name) renameSetTo(set, name);
}

function duplicateSet() {
  if (state.sets.length < MAX_SETS) copySet(editSet());
}

async function deleteSet() {
  if (state.sets.length <= 1) return;
  const set = editSet();
  const running = set.id === state.activeSetId;
  const ok = await confirmAction({
    title: "Delete set?",
    message: `Delete “${set.name}”? Its songs stay in the show.${running ? " The Run tab will run the first remaining set." : ""}`,
    confirmLabel: "Delete",
  });
  if (ok && state.sets.includes(set)) removeSet(set);
}

setSelect.addEventListener("change", () => {
  editSetId = setSelect.value;
  renderSetTab();
});

setSongSearch.addEventListener("input", () => renderSourceList(editSet()));

runSetBtn.addEventListener("click", () => runSet(editSet()));

setMenuBtn.addEventListener("click", async (event) => {
  event.stopPropagation();
  if (setMenuBtn.getAttribute("aria-expanded") === "true") {
    closePopup();
    return;
  }
  const action = await openActionMenu(setMenuBtn, "Set actions", [
    { label: "New set", action: "new", disabled: state.sets.length >= MAX_SETS },
    { label: "Rename", action: "rename" },
    { label: "Duplicate", action: "duplicate", disabled: state.sets.length >= MAX_SETS },
    { label: "Delete", action: "delete", danger: true, disabled: state.sets.length <= 1 },
  ]);
  if (action === "new") await newSet();
  if (action === "rename") await renameSet();
  if (action === "duplicate") duplicateSet();
  if (action === "delete") await deleteSet();
});

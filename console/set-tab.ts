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

/** The set changed: save, and if it's the one running, update UP NEXT. (The Show tab redraws when it's opened.) */
function setChanged() {
  if (editSet().id === state.activeSetId) refreshUpNext();
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
    if (targetId && moveEntry(editSet(), what.entryId, targetId, after)) setChanged();
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

function addSongToSet(songId: string, index: number) {
  const set = editSet();
  if (set.entries.length >= MAX_SET_ENTRIES) return;
  set.entries.splice(clamp(index, 0, set.entries.length), 0, createEntry(songId));
  setChanged();
}

function removeEntry(entryId: string) {
  const set = editSet();
  set.entries = set.entries.filter((entry) => entry.id !== entryId);
  setChanged();
}

/** Run the set shown here from `entryId` (its song, first cue). */
function playEntry(entryId: string) {
  const set = editSet();
  const entry = set.entries.find((item) => item.id === entryId);
  if (!entry) return;
  state.activeSetId = set.id;
  setActiveSong(entry.songId, entry.id);
  renderSetTab();
}

/** Make the set shown here the one the Run tab runs, from its first song. */
function runSet() {
  const set = editSet();
  if (set.entries.length) {
    playEntry(set.entries[0].id);
  } else {
    state.activeSetId = set.id;
    refreshUpNext();
    renderSetTab();
  }
}

async function newSet() {
  if (state.sets.length >= MAX_SETS) return;
  const name = await promptName({ title: "New set", confirmLabel: "Create", initial: defaultSetName(state.sets.length) });
  if (!name || state.sets.length >= MAX_SETS) return;
  const set = createSet({ name: normalizeSetName(name, state.sets.length) });
  state.sets.push(set);
  editSetId = set.id;
  persistSession();
  renderSetTab();
}

async function renameSet() {
  const set = editSet();
  const name = await promptName({ title: "Rename set", confirmLabel: "Rename", initial: set.name });
  if (!name) return;
  set.name = normalizeSetName(name);
  setChanged();
}

function duplicateSet() {
  if (state.sets.length >= MAX_SETS) return;
  const set = editSet();
  const copy = createSet({
    name: `${set.name} copy`.slice(0, 40),
    songIds: set.entries.map((entry) => entry.songId),
  });
  state.sets.splice(state.sets.indexOf(set) + 1, 0, copy);
  editSetId = copy.id;
  persistSession();
  renderSetTab();
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
  if (!ok) return;
  state.sets.splice(state.sets.indexOf(set), 1);
  editSetId = state.sets[0].id;
  if (running) {
    state.activeSetId = state.sets[0].id;
    refreshUpNext();
  } else {
    persistSession();
  }
  renderSetTab();
}

setSelect.addEventListener("change", () => {
  editSetId = setSelect.value;
  renderSetTab();
});

setSongSearch.addEventListener("input", () => renderSourceList(editSet()));

runSetBtn.addEventListener("click", runSet);

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

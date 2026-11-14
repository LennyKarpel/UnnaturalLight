// Show tab: every song in the show (add, remove, rename, reorder, play),
// and the sets each one is in.
import { defaultSongName, copyCue, createSong, MAX_SONGS, moveSong, normalizeSongName } from "./songs.ts";
import { addSongBtn, songScroll, songList, songEmpty, tabShow, dropSlot, showDropLine, startDragScroll, wireRowDrag, type DragScroll, closePopup } from "./dom.ts";
import { renderSetBar } from "./set-bar.ts";
import { getActiveEntry, getActiveSet, bindActiveSong, persistSession, state } from "./state.ts";
import { abortInlineEdits, confirmAction, promptName } from "./faders.ts";
import { pushToDmx, refreshCueSelects, renderSelectedGroup, syncCrossUi, stopTimedFade, syncGoButton } from "./live.ts";
import { renderCues, openActionMenu } from "./cues.ts";
import { inlineRename, clickToRename } from "./inline-rename.ts";
import { el, button } from "../shared/html.ts";

/** Names of the sets `songId` is in. */
function setsWithSong(songId: string) {
  return state.sets.filter((set) => set.entries.some((entry) => entry.songId === songId)).map((set) => set.name);
}

/** The active song changed (or its set, or a song's name): update the Run tab's set bar and the Show tab. */
export function syncSongUi() {
  addSongBtn.disabled = state.songs.length >= MAX_SONGS;
  renderSetBar();
  if (!tabShow.hidden) renderShowTab();
}

function clearSongDropMarks() {
  for (const el of songList.querySelectorAll<HTMLElement>(".is-drop-before, .is-drop-after")) {
    el.classList.remove("is-drop-before", "is-drop-after");
  }
}

let dragSongId: string | null = null;
let dragScroll: DragScroll | null = null;



export function renderShowTab() {
  songList.replaceChildren();
  songEmpty.hidden = state.songs.length > 0;
  addSongBtn.disabled = state.songs.length >= MAX_SONGS;

  for (const song of state.songs) {
    const row = el("div", "song-row");
    row.setAttribute("role", "listitem");
    row.dataset.songId = song.id;
    if (song.id === state.activeSongId) row.classList.add("is-active");

    const handle = el("div", "song-drag-handle");
    handle.title = "Drag to reorder";
    handle.setAttribute("aria-hidden", "true");
    handle.textContent = "⋮⋮";

    const name = songNameEl(song);

    const meta = el("span", "song-row-meta");
    const n = song.cues.length;
    const sets = setsWithSong(song.id);
    meta.textContent = `${n} cue${n === 1 ? "" : "s"} · ${sets.length ? `in ${sets.join(", ")}` : "in no set"}`;

    const badge = el("span", "song-row-badge", song.id !== state.activeSongId ? "Play" : getActiveEntry() ? "Playing" : "Playing · not in set");

    const menuBtn = button("cue-menu-btn");
    menuBtn.innerHTML = '<span class="cue-menu-dots" aria-hidden="true"></span>';
    menuBtn.title = "Song options";
    menuBtn.setAttribute("aria-label", `Options for ${song.name}`);
    menuBtn.setAttribute("aria-haspopup", "menu");
    menuBtn.setAttribute("aria-expanded", "false");
    menuBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      if (menuBtn.getAttribute("aria-expanded") === "true") {
        closePopup();
        return;
      }
      void openSongMenu(menuBtn, song.id);
    });

    row.append(handle, name, meta, badge, menuBtn);
    wireSongRowDrag(row, handle, song.id);
    row.addEventListener("click", (event) => {
      if (
        event.target instanceof Element &&
        event.target.closest(
          ".song-drag-handle, .song-row-name, .cue-menu-btn, .cue-title-input",
        )
      ) {
        return;
      }
      if (song.id !== state.activeSongId) setActiveSong(song.id);
      else syncSongUi();
    });
    songList.append(row);
  }
}

function wireSongRowDrag(row: HTMLElement, handle: HTMLElement, songId: string) {
  wireRowDrag(row, handle, songId, (event) => {
    abortInlineEdits();
    dragSongId = songId;
    row.dataset.dragSongId = songId;
    dragScroll?.stop();
    dragScroll = startDragScroll(songScroll, tabShow, "is-dragging-song", () => dragSongId != null, event.clientY);
  }, () => {
    delete row.dataset.dragSongId;
    clearSongDropMarks();
    dragScroll?.stop();
    dragSongId = null;
  });
}

/** Where the dragged song would land (see dropSlot), or null. */
function songDropSlot(clientY: number) {
  const rows = [...songList.querySelectorAll<HTMLElement>(":scope > .song-row")];
  const slot = dropSlot(rows, rows.find((row) => row.dataset.dragSongId === dragSongId), clientY);
  return slot == null ? null : { rows, slot };
}

// Anywhere in the song area (between songs, below the last one too): a line
// in the gap the dragged song will land in.
songScroll.addEventListener("dragover", (event) => {
  if (!dragSongId) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  dragScroll?.track(event.clientY);
  const drop = songDropSlot(event.clientY);
  if (drop) showDropLine(drop.rows, drop.slot);
  else clearSongDropMarks();
});

songScroll.addEventListener("dragleave", (event) => {
  if (!(event.relatedTarget instanceof Node) || !songScroll.contains(event.relatedTarget)) clearSongDropMarks();
});

songScroll.addEventListener("drop", (event) => {
  if (!dragSongId) return;
  event.preventDefault();
  const fromId = dragSongId;
  const drop = songDropSlot(event.clientY);
  clearSongDropMarks();
  dragScroll?.stop();
  dragSongId = null;
  if (!drop) return;
  const { rows, slot } = drop;
  const after = slot === rows.length;
  const targetId = rows[after ? rows.length - 1 : slot].dataset.songId;
  if (targetId && moveSong(state.songs, fromId, targetId, after)) {
    persistSession();
    renderShowTab();
    syncSongUi();
  }
});

function beginInlineSongRename(id: string, target: HTMLElement) {
  const song = state.songs.find((item) => item.id === id);
  if (!song || !(target instanceof HTMLElement) || !target.isConnected) return;
  abortInlineEdits();

  inlineRename({
    replace: target,
    value: song.name,
    label: "Song name",
    className: "cue-title-input",
    done: (name, putBack) => {
      if (name) {
        song.name = normalizeSongName(name);
        persistSession();
      }
      putBack(songNameEl(song));
      syncSongUi();
    },
  });
}

/** A song row's name, click to rename. */
function songNameEl(song: { id: string; name: string }) {
  return clickToRename(el("h3", "song-row-name", song.name), (name) => beginInlineSongRename(song.id, name));
}

/**
 * Play a song from its first cue. `entryId`: its place in the active set;
 * left out, its first place there (or none: played from outside the set).
 */
/** Play a song: make its first cue (or `startCue`) LIVE. */
export function setActiveSong(songId: string, entryId?: string | null, startCue = 0) {
  const song = state.songs.find((item) => item.id === songId);
  if (!song) return;
  stopTimedFade();
  state.activeSongId = song.id;
  state.activeEntryId = entryId !== undefined
    ? entryId
    : (getActiveSet().entries.find((entry) => entry.songId === song.id)?.id ?? null);
  state.fromCue = Math.min(Math.max(0, startCue), song.cues.length - 1);
  state.selectedCue = state.fromCue;
  state.liveStep = -1;
  state.cross = 0;
  bindActiveSong();
  syncCrossUi();
  syncSongUi();
  renderCues();
  renderSelectedGroup();
  pushToDmx();
  persistSession();
}

export async function addSong() {
  if (state.songs.length >= MAX_SONGS) return;
  const name = await promptName({
    title: "New song",
    confirmLabel: "Create",
    initial: defaultSongName(state.songs.length),
  });
  if (!name) return;
  if (state.songs.length >= MAX_SONGS) return;
  const song = createSong({ name });
  state.songs.push(song);
  setActiveSong(song.id);
  renderShowTab();
}

async function openSongMenu(anchor: HTMLElement, id: string) {
  const action = await openActionMenu(anchor, "Song actions", [
    { label: "Duplicate", action: "duplicate", disabled: state.songs.length >= MAX_SONGS },
    { label: "Delete", action: "delete", danger: true, disabled: state.songs.length <= 1 },
  ]);
  if (action === "duplicate") duplicateSong(id);
  if (action === "delete") await deleteSong(id);
}

/**
 * Put a copy of a song (its cues: levels, names, In times) right after it,
 * named "… copy". The song that's playing stays playing.
 */
function duplicateSong(id: string) {
  if (state.songs.length >= MAX_SONGS) return;
  const index = state.songs.findIndex((item) => item.id === id);
  if (index < 0) return;
  const song = state.songs[index];
  const copy = createSong({
    name: `${song.name} copy`.slice(0, 40),
    cues: song.cues.map(copyCue),
  });
  state.songs.splice(index + 1, 0, copy);
  persistSession();
  renderShowTab();
  syncSongUi();
}

async function deleteSong(id: string) {
  if (state.songs.length <= 1) return;
  const song = state.songs.find((item) => item.id === id);
  if (!song) return;
  const sets = setsWithSong(id);
  const ok = await confirmAction({
    title: "Delete song?",
    message: `Delete “${song.name}” and all of its cues?${sets.length ? ` It will also be taken out of ${sets.join(", ")}.` : ""}`,
    confirmLabel: "Delete",
  });
  if (!ok) return;
  const index = state.songs.findIndex((item) => item.id === id);
  if (index < 0) return;
  const wasActive = song.id === state.activeSongId;
  state.songs.splice(index, 1);
  for (const set of state.sets) set.entries = set.entries.filter((entry) => entry.songId !== id);
  if (wasActive) {
    const next = state.songs[Math.min(index, state.songs.length - 1)];
    setActiveSong(next.id);
  } else {
    renderShowTab();
    refreshUpNext();
  }
}

/**
 * The set changed (or a song left it): UP NEXT may now be another song's
 * first cue, or nothing. Redraw what shows it, and save.
 */
export function refreshUpNext() {
  bindActiveSong();
  refreshCueSelects();
  syncGoButton();
  renderCues();
  syncSongUi();
  pushToDmx();
}

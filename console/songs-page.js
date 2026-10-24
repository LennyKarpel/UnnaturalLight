// Songs page: the song list (add, remove, rename, reorder).
import { defaultSongName, createSong, MAX_SONGS, moveSong, normalizeSongName } from "./songs.js";
import { addSongBtn, songScroll, songList, songEmpty, activeSongLabel, pageSet } from "./dom.js";
import { getActiveSong, bindActiveSong, persistSession, state } from "./state.js";
import { abortInlineEdits, confirmAction, promptName } from "./faders.js";
import { pushToDmx, renderSelectedGroup, syncCrossUi, stopTimedFade } from "./live.js";
import { renderCues } from "./cues.js";

/** @type {null | (() => void)} */
export let endInlineSongRename = null;

export function adjustIndexAfterRemove(index, removed, lengthAfter) {
  if (index > removed) return index - 1;
  if (index === removed) return Math.min(removed, lengthAfter - 1);
  return index;
}

export function syncSongUi() {
  const song = getActiveSong();
  activeSongLabel.textContent = song.name;
  activeSongLabel.title = `${song.name} · ${song.cues.length} cues`;
  addSongBtn.disabled = state.songs.length >= MAX_SONGS;
  if (!pageSet.hidden) renderSongs();
}

function clearSongDropMarks() {
  for (const el of songList.querySelectorAll(".is-drop-before, .is-drop-after")) {
    el.classList.remove("is-drop-before", "is-drop-after");
  }
}

/** @type {string | null} */
let dragSongId = null;
/** @type {number | null} */
let songDragClientY = null;
/** @type {number | null} */
let songDragScrollRaf = null;
/** @type {null | (() => void)} */
let stopSongDragSession = null;

const SONG_DRAG_SCROLL_EDGE = 56;
const SONG_DRAG_SCROLL_MAX = 24;

function tickSongDragScroll() {
  songDragScrollRaf = null;
  if (!dragSongId) return;

  if (songDragClientY != null) {
    const rect = songScroll.getBoundingClientRect();
    const y = songDragClientY;
    let dy = 0;

    if (y < rect.top) {
      dy = -SONG_DRAG_SCROLL_MAX;
    } else if (y > rect.bottom) {
      dy = SONG_DRAG_SCROLL_MAX;
    } else if (y < rect.top + SONG_DRAG_SCROLL_EDGE) {
      const distance = rect.top + SONG_DRAG_SCROLL_EDGE - y;
      const t = Math.min(1, distance / SONG_DRAG_SCROLL_EDGE);
      dy = -Math.ceil(Math.max(2, t * SONG_DRAG_SCROLL_MAX));
    } else if (y > rect.bottom - SONG_DRAG_SCROLL_EDGE) {
      const distance = y - (rect.bottom - SONG_DRAG_SCROLL_EDGE);
      const t = Math.min(1, distance / SONG_DRAG_SCROLL_EDGE);
      dy = Math.ceil(Math.max(2, t * SONG_DRAG_SCROLL_MAX));
    }

    if (dy !== 0) {
      const maxScroll = Math.max(
        0,
        songScroll.scrollHeight - songScroll.clientHeight,
      );
      songScroll.scrollTop = Math.max(
        0,
        Math.min(maxScroll, songScroll.scrollTop + dy),
      );
    }
  }

  // Keep the loop alive for the whole drag — early frames often run before
  // any dragover has set clientY.
  songDragScrollRaf = requestAnimationFrame(tickSongDragScroll);
}

/** @param {number} [initialClientY] */
function startSongDragSession(initialClientY) {
  stopSongDragSession?.();
  songDragClientY =
    typeof initialClientY === "number" ? initialClientY : null;
  pageSet.classList.add("is-dragging-song");

  const onDragOver = (event) => {
    if (!dragSongId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    songDragClientY = event.clientY;
  };

  document.addEventListener("dragover", onDragOver, true);
  songDragScrollRaf = requestAnimationFrame(tickSongDragScroll);

  stopSongDragSession = () => {
    document.removeEventListener("dragover", onDragOver, true);
    if (songDragScrollRaf != null) {
      cancelAnimationFrame(songDragScrollRaf);
      songDragScrollRaf = null;
    }
    songDragClientY = null;
    pageSet.classList.remove("is-dragging-song");
    stopSongDragSession = null;
  };
}

export function renderSongs() {
  songList.replaceChildren();
  songEmpty.hidden = state.songs.length > 0;
  addSongBtn.disabled = state.songs.length >= MAX_SONGS;

  for (const song of state.songs) {
    const row = document.createElement("div");
    row.className = "song-row";
    row.setAttribute("role", "listitem");
    row.dataset.songId = song.id;
    if (song.id === state.activeSongId) row.classList.add("is-active");

    const handle = document.createElement("div");
    handle.className = "song-drag-handle";
    handle.title = "Drag to reorder";
    handle.setAttribute("aria-hidden", "true");
    handle.textContent = "⋮⋮";

    const name = document.createElement("h3");
    name.className = "song-row-name";
    name.textContent = song.name;
    name.title = "Click to rename";
    name.setAttribute("role", "button");
    name.tabIndex = 0;
    name.addEventListener("click", (event) => {
      event.stopPropagation();
      beginInlineSongRename(song.id, name);
    });
    name.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        beginInlineSongRename(song.id, name);
      }
    });

    const meta = document.createElement("span");
    meta.className = "song-row-meta";
    const n = song.cues.length;
    meta.textContent = `${n} cue${n === 1 ? "" : "s"}`;

    const badge = document.createElement("span");
    badge.className = "song-row-badge";
    badge.textContent = song.id === state.activeSongId ? "Playing" : "Play";

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "fixture-remove";
    removeBtn.textContent = "✕";
    removeBtn.title = `Remove ${song.name}`;
    removeBtn.setAttribute("aria-label", `Remove ${song.name}`);
    removeBtn.disabled = state.songs.length <= 1;
    removeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      void removeSong(song.id);
    });

    row.append(handle, name, meta, badge, removeBtn);
    wireSongRowDrag(row, handle, song.id);
    row.addEventListener("click", (event) => {
      if (
        event.target instanceof Element &&
        event.target.closest(
          ".song-drag-handle, .song-row-name, .fixture-remove, .cue-title-input",
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

/**
 * @param {HTMLElement} row
 * @param {HTMLElement} handle
 * @param {string} songId
 */
function wireSongRowDrag(row, handle, songId) {
  handle.addEventListener("pointerdown", (event) => {
    if (event.button != null && event.button !== 0) return;
    row.dataset.dragArmed = "1";
    const onUp = () => {
      window.removeEventListener("pointerup", onUp, true);
      requestAnimationFrame(() => {
        if (!row.classList.contains("is-dragging")) delete row.dataset.dragArmed;
      });
    };
    window.addEventListener("pointerup", onUp, true);
  });

  row.draggable = true;
  row.addEventListener("dragstart", (event) => {
    if (row.dataset.dragArmed !== "1") {
      event.preventDefault();
      return;
    }
    delete row.dataset.dragArmed;
    abortInlineEdits();
    dragSongId = songId;
    row.classList.add("is-dragging");
    row.dataset.dragSongId = songId;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", songId);
    }
    startSongDragSession(event.clientY);
  });

  row.addEventListener("dragend", () => {
    delete row.dataset.dragArmed;
    delete row.dataset.dragSongId;
    row.classList.remove("is-dragging");
    clearSongDropMarks();
    stopSongDragSession?.();
    dragSongId = null;
  });

  row.addEventListener("dragover", (event) => {
    if (!dragSongId || dragSongId === songId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    songDragClientY = event.clientY;
    clearSongDropMarks();
    const rect = row.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    row.classList.add(after ? "is-drop-after" : "is-drop-before");
  });

  row.addEventListener("drop", (event) => {
    if (!dragSongId || dragSongId === songId) return;
    event.preventDefault();
    event.stopPropagation();
    const fromId = dragSongId;
    const rect = row.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    clearSongDropMarks();
    stopSongDragSession?.();
    dragSongId = null;
    if (moveSong(state.songs, fromId, songId, after)) {
      persistSession();
      renderSongs();
      syncSongUi();
    }
  });
}

/**
 * @param {string} id
 * @param {HTMLElement} target
 */
function beginInlineSongRename(id, target) {
  const song = state.songs.find((item) => item.id === id);
  if (!song || !(target instanceof HTMLElement) || !target.isConnected) return;
  abortInlineEdits();

  const input = document.createElement("input");
  input.type = "text";
  input.className = "cue-title-input";
  input.maxLength = 40;
  input.value = song.name;
  input.setAttribute("aria-label", "Song name");
  input.autocomplete = "off";
  input.spellcheck = false;

  const parent = target.parentElement;
  if (!parent) return;
  target.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = (commit) => {
    if (finished) return;
    finished = true;
    if (endInlineSongRename === finishAbort) endInlineSongRename = null;
    input.removeEventListener("keydown", onKeydown);
    input.removeEventListener("blur", onBlur);

    const next = input.value.trim();
    if (commit && next) {
      song.name = normalizeSongName(next);
      persistSession();
    }

    const restored = document.createElement("h3");
    restored.className = "song-row-name";
    restored.textContent = song.name;
    restored.title = "Click to rename";
    restored.setAttribute("role", "button");
    restored.tabIndex = 0;
    restored.addEventListener("click", (event) => {
      event.stopPropagation();
      beginInlineSongRename(id, restored);
    });
    restored.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        beginInlineSongRename(id, restored);
      }
    });
    if (input.isConnected) input.replaceWith(restored);
    else parent.prepend(restored);
    syncSongUi();
  };

  const finishAbort = () => finish(false);
  endInlineSongRename = finishAbort;

  const onKeydown = (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  };
  const onBlur = () => finish(true);
  input.addEventListener("keydown", onKeydown);
  input.addEventListener("blur", onBlur);
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("pointerdown", (event) => event.stopPropagation());
}

function setActiveSong(songId) {
  const song = state.songs.find((item) => item.id === songId);
  if (!song) return;
  stopTimedFade();
  state.activeSongId = song.id;
  state.fromCue = 0;
  state.toCue = Math.min(1, song.cues.length - 1);
  state.selectedCue = 0;
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
  renderSongs();
}

/** @param {string} id */
async function removeSong(id) {
  if (state.songs.length <= 1) return;
  const song = state.songs.find((item) => item.id === id);
  if (!song) return;
  const ok = await confirmAction({
    title: "Remove song?",
    message: `Remove “${song.name}” and all of its cues?`,
    confirmLabel: "Remove",
  });
  if (!ok) return;
  const index = state.songs.findIndex((item) => item.id === id);
  if (index < 0) return;
  const wasActive = song.id === state.activeSongId;
  state.songs.splice(index, 1);
  if (wasActive) {
    const next = state.songs[Math.min(index, state.songs.length - 1)];
    setActiveSong(next.id);
  } else {
    renderSongs();
    persistSession();
  }
}

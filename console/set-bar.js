// Run tab set bar: the song playing, where it is in the active set
// ("song 3 of 12", ◀ / ▶) and the set's running order (click a song to play it).
import { activeSongLabel, activeSetLabel, prevSongBtn, nextSongBtn, setStrip } from "./dom.js";
import { getActiveEntry, getActiveSet, getActiveSong, state } from "./state.js";
import { setActiveSong } from "./show-tab.js";

/** The bar: the song playing, where it is in the active set, and the set's running order. */
export function renderSetBar() {
  const song = getActiveSong();
  activeSongLabel.textContent = song.name;
  activeSongLabel.title = `${song.name} · ${song.cues.length} cues`;

  const set = getActiveSet();
  const entry = getActiveEntry();
  const index = entry ? set.entries.indexOf(entry) : -1;
  activeSetLabel.textContent = index >= 0
    ? `${set.name} · song ${index + 1} of ${set.entries.length}`
    : `Not in ${set.name}`;
  prevSongBtn.disabled = index <= 0;
  nextSongBtn.disabled = index < 0 || index >= set.entries.length - 1;

  const key = JSON.stringify([set.id, set.entries, entry?.id, state.songs.map((s) => s.name)]);
  if (setStrip.dataset.key === key) return;
  setStrip.dataset.key = key;
  setStrip.replaceChildren(...set.entries.map((item, i) => {
    const song = state.songs.find((s) => s.id === item.songId);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "set-strip-song";
    chip.setAttribute("role", "listitem");
    chip.classList.toggle("is-active", item === entry);
    chip.classList.toggle("is-next", index >= 0 && i === index + 1);
    chip.textContent = `${i + 1}. ${song?.name ?? ""}`;
    chip.title = item === entry ? "Playing" : `Play ${song?.name ?? ""} (from its first cue)`;
    chip.addEventListener("click", () => {
      if (item !== getActiveEntry()) setActiveSong(item.songId, item.id);
    });
    return chip;
  }));
  setStrip.querySelector(".is-active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/** Run tab ◀ / ▶: the previous / next song in the active set. @param {-1 | 1} step */
function stepSetSong(step) {
  const set = getActiveSet();
  const entry = getActiveEntry();
  const target = entry ? set.entries[set.entries.indexOf(entry) + step] : null;
  if (target) setActiveSong(target.songId, target.id);
}

prevSongBtn.addEventListener("click", () => stepSetSong(-1));
nextSongBtn.addEventListener("click", () => stepSetSong(1));

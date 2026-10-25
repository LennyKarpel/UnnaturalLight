// The console page's elements (console.html).

/**
 * @template {typeof Element} C
 * @param {string} id
 * @param {C} type
 * @returns {InstanceType<C>}
 */
function requireEl(id, type) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  if (!(el instanceof type)) throw new Error(`#${id} is not ${type.name}`);
  return /** @type {InstanceType<C>} */ (el);
}

/**
 * Place an open (unhidden) popup menu at (left, top), keeping it inside the
 * window: it moves left at the right edge, and opens above `aboveY` (the top
 * of what opened it) when it would run off the bottom. Its real size is used.
 * @param {HTMLElement} el
 * @param {number} left
 * @param {number} top
 * @param {number} aboveY
 */
export function placePopup(el, left, top, aboveY) {
  // Measure at the window's corner, so a spot near the edge from last time
  // doesn't squeeze it.
  el.style.left = "0px";
  el.style.top = "0px";
  const { offsetWidth: width, offsetHeight: height } = el;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  if (top + height > window.innerHeight - 8) top = Math.max(8, aboveY - height - 6);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

/**
 * Reordering by drag: where the dragged row would land among `rows` — the
 * gap nearest the pointer (0 = before the first row, rows.length = after the
 * last) — or null when it would stay where it is.
 * @param {HTMLElement[]} rows
 * @param {HTMLElement | undefined} dragged
 * @param {number} clientY
 */
export function dropSlot(rows, dragged, clientY) {
  const from = dragged ? rows.indexOf(dragged) : -1;
  let slot = rows.findIndex((row) => {
    const rect = row.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2;
  });
  if (slot < 0) slot = rows.length;
  if (from < 0 || slot === from || slot === from + 1) return null;
  return slot;
}

/**
 * Show the drop line (styles.css) at a slot from dropSlot, or none for null.
 * @param {HTMLElement[]} rows
 * @param {number | null} slot
 */
export function showDropLine(rows, slot) {
  for (const row of rows) row.classList.remove("is-drop-before", "is-drop-after");
  if (slot == null) return;
  if (slot < rows.length) rows[slot].classList.add("is-drop-before");
  else rows[rows.length - 1].classList.add("is-drop-after");
}

export const cuesScroll = requireEl("cuesScroll", HTMLElement);
export const cuesEl = requireEl("cues", HTMLElement);
export const liveFadersEl = requireEl("liveFaders", HTMLElement);
export const channelLevelsEl = requireEl("channelLevels", HTMLElement);
export const selectedGroupFadersEl = requireEl("selectedGroupFaders", HTMLElement);
/** @type {HTMLElement} */
export let currentCueTitle = requireEl("currentCueTitle", HTMLElement);
export const cuePicker = requireEl("cuePicker", HTMLElement);
export const cuePickerList = requireEl("cuePickerList", HTMLElement);
export const channelsCueMenuBtn = requireEl("channelsCueMenuBtn", HTMLButtonElement);
export const channelsCueMenu = requireEl("channelsCueMenu", HTMLElement);
export const channelsCueMenuList = requireEl("channelsCueMenuList", HTMLElement);
export const actionMenu = requireEl("actionMenu", HTMLElement);
export const actionMenuList = requireEl("actionMenuList", HTMLElement);
export const faderNameMenu = requireEl("faderNameMenu", HTMLElement);
export const faderNameMenuList = requireEl("faderNameMenuList", HTMLElement);
export const patchTableEl = requireEl("patchTable", HTMLElement);
export const patchConflictsEl = requireEl("patchConflicts", HTMLElement);
export const blackoutBtn = requireEl("blackoutBtn", HTMLButtonElement);
export const masterInput = requireEl("master", HTMLInputElement);
export const masterValue = requireEl("masterValue", HTMLOutputElement);
export const fromSubInput = requireEl("fromSub", HTMLInputElement);
export const fromSubValue = requireEl("fromSubValue", HTMLOutputElement);
export const fromSubLabel = requireEl("fromSubLabel", HTMLElement);
export const fromSubBlackoutBtn = requireEl("fromSubBlackoutBtn", HTMLButtonElement);
export const toSubInput = requireEl("toSub", HTMLInputElement);
export const toSubValue = requireEl("toSubValue", HTMLOutputElement);
export const toSubLabel = requireEl("toSubLabel", HTMLElement);
export const toSubBlackoutBtn = requireEl("toSubBlackoutBtn", HTMLButtonElement);
export const crossfader = requireEl("crossfader", HTMLInputElement);
export const crossValue = requireEl("crossValue", HTMLOutputElement);
export const crossFromLabel = requireEl("crossFromLabel", HTMLElement);
export const crossToLabel = requireEl("crossToLabel", HTMLElement);
export const goBtn = requireEl("goBtn", HTMLButtonElement);
export const goNextFade = requireEl("goNextFade", HTMLElement);
export const fadePauseBtn = requireEl("fadePauseBtn", HTMLButtonElement);
export const addCueBtn = requireEl("addCueBtn", HTMLButtonElement);
export const removeCueBtn = requireEl("removeCueBtn", HTMLButtonElement);
export const addSongBtn = requireEl("addSongBtn", HTMLButtonElement);
export const songScroll = requireEl("songScroll", HTMLElement);
export const songList = requireEl("songList", HTMLElement);
export const songEmpty = requireEl("songEmpty", HTMLElement);
export const activeSongLabel = requireEl("activeSongLabel", HTMLElement);
export const pageSet = requireEl("page-set", HTMLElement);
export const identityBtn = requireEl("identityBtn", HTMLButtonElement);
export const clearPatchBtn = requireEl("clearPatchBtn", HTMLButtonElement);
export const channelMenu = requireEl("channelMenu", HTMLElement);
export const channelMenuFilter = requireEl("channelMenuFilter", HTMLInputElement);
export const channelMenuList = requireEl("channelMenuList", HTMLElement);
export const channelMenuSub = requireEl("channelMenuSub", HTMLElement);
export const channelMenuSubList = requireEl("channelMenuSubList", HTMLElement);
export const channelMenuSubLabel = requireEl("channelMenuSubLabel", HTMLElement);
export const pageSongs = requireEl("page-songs", HTMLElement);
export const pageChannels = requireEl("page-channels", HTMLElement);
export const pageFixtures = requireEl("page-fixtures", HTMLElement);
export const pagePatch = requireEl("page-patch", HTMLElement);
export const fixtureForm = requireEl("fixtureForm", HTMLFormElement);
export const fixtureNameInput = requireEl("fixtureNameInput", HTMLInputElement);
export const fixtureStartPicker = requireEl("fixtureStartPicker", HTMLElement);
export const fixtureCountPicker = requireEl("fixtureCountPicker", HTMLElement);
export const countMenu = requireEl("countMenu", HTMLElement);
export const countMenuList = requireEl("countMenuList", HTMLElement);
export const fixtureQtyPicker = requireEl("fixtureQtyPicker", HTMLElement);
export const fixtureConflicts = requireEl("fixtureConflicts", HTMLElement);
export const fixtureScroll = requireEl("fixtureScroll", HTMLElement);
export const fixtureEmpty = requireEl("fixtureEmpty", HTMLElement);
export const fixtureList = requireEl("fixtureList", HTMLElement);
export const addFixtureBtn = requireEl("addFixtureBtn", HTMLButtonElement);
export const addFixtureGroupBtn = requireEl("addFixtureGroupBtn", HTMLButtonElement);
export const fixtureFormGroupPickerHost = requireEl(
  "fixtureFormGroupPicker",
  HTMLElement,
);
export const fixtureGroupMenu = requireEl("fixtureGroupMenu", HTMLElement);
export const fixtureGroupMenuList = requireEl("fixtureGroupMenuList", HTMLElement);
export const navEl = requireEl("nav", HTMLElement);
/** @type {Record<string, HTMLElement>} */
export const pages = {
  set: pageSet,
  songs: pageSongs,
  channels: pageChannels,
  fixtures: pageFixtures,
  patch: pagePatch,
};

export function getNavLinks() {
  return [...navEl.querySelectorAll(".nav-link")];
}

/** Channels tab: which universe the meters show. */
export const meterUniverseSelect = document.createElement("select");

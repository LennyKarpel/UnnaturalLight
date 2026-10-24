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
export const cueMenu = requireEl("cueMenu", HTMLElement);
export const cueMenuList = requireEl("cueMenuList", HTMLElement);
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

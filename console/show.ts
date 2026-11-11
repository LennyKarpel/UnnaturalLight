import { FADER_COUNT, defaultPatch, normalizeFaderPatch, MAX_UNIVERSES, type FaderPatch } from "./patch.ts";
import { normalizeFixtureGroups, normalizeFixtures, type Fixture, type FixtureGroup } from "./fixtures.ts";
import { prettyJson } from "../shared/json.ts";
import { normalizeSongs, resolveActiveSong, type Song } from "./songs.ts";
import { normalizeSets, resolveActiveEntry, resolveActiveSet, upNextCue, type ShowSet } from "./sets.ts";
import { clamp, clampInt } from "../shared/numbers.ts";
import { isRecord } from "../shared/guards.ts";

/** Where the console keeps its session in this browser. */
const SESSION_KEY = "unnaturallight.session";

const SHOW_VERSION = 1;
const SHOW_APP = "UnnaturalLight";
export const DEFAULT_NAV_ORDER = [
  "show",
  "set",
  "run",
  "channels",
  "fixtures",
  "patch",
];

export function normalizeNavOrder(order: unknown): string[] {
  const allowed = new Set(DEFAULT_NAV_ORDER);
  const source = Array.isArray(order) ? order : [];
  const next: string[] = [];
  for (const item of source) {
    if (!allowed.has(item) || next.includes(item)) continue;
    next.push(item);
  }
  // A tab the saved order doesn't have goes where it is by default: right
  // after the tab before it there (or first).
  DEFAULT_NAV_ORDER.forEach((tab, i) => {
    if (next.includes(tab)) return;
    next.splice(i === 0 ? 0 : next.indexOf(DEFAULT_NAV_ORDER[i - 1]) + 1, 0, tab);
  });
  return next;
}

export function defaultShowName() {
  return "Untitled";
}

export function normalizeShowName(name: unknown) {
  const text = typeof name === "string" ? name.trim() : "";
  return text || defaultShowName();
}

export function defaultFaderName(index: number) {
  return `F${index + 1}`;
}

function normalizeNames(names: unknown, count: number, fallback: (index: number) => string): string[] {
  const source = Array.isArray(names) ? names : [];
  return Array.from({ length: count }, (_, i) => {
    const raw = source[i];
    const text = typeof raw === "string" ? raw.trim() : "";
    return text || fallback(i);
  });
}

export function normalizeFaderNames(names: unknown): string[] {
  return normalizeNames(names, FADER_COUNT, defaultFaderName);
}

/** Universe count (1…MAX_UNIVERSES). */
export function normalizeUniverses(value: unknown): number {
  const n = Math.round(Number(value));
  return clamp(n, 1, MAX_UNIVERSES);
}

/** A show as the console and the server hold it (parseShow's result). */
export type ShowData = {
  showName: string;
  navOrder: string[];
  master: number;
  cross: number;
  fromSub: number;
  toSub: number;
  universes: number;
  fromCue: number;
  toCue: number;
  selectedCue: number;
  songs: Song[];
  activeSongId: string;
  sets: ShowSet[];
  activeSetId: string;
  activeEntryId: string | null;
  faderNames: string[];
  fixtureGroups: FixtureGroup[];
  fixtures: Fixture[];
  patch: FaderPatch[];
};

/** What serializeShow needs (anything else is filled in or normalized). */
export type ShowInput = Pick<ShowData, "master" | "cross" | "fromCue" | "songs" | "patch"> &
  Partial<Omit<ShowData, "activeSongId" | "activeSetId" | "activeEntryId">> & {
    activeSongId?: string | null;
    activeSetId?: string | null;
    activeEntryId?: string | null;
  };

/** A show as saved (a show file, the server's session, the browser's autosave). */
export type SerializedShow = ReturnType<typeof serializeShow>;

export function serializeShow(state: ShowInput) {
  const songs = normalizeSongs(state.songs);
  const active = resolveActiveSong(songs, state.activeSongId);
  const sets = normalizeSets(state.sets, songs);
  const activeSet = resolveActiveSet(sets, state.activeSetId);
  const fixtureGroups = normalizeFixtureGroups(state.fixtureGroups);
  return {
    version: SHOW_VERSION,
    app: SHOW_APP,
    kind: "show",
    savedAt: new Date().toISOString(),
    showName: normalizeShowName(state.showName),
    navOrder: normalizeNavOrder(state.navOrder),
    master: clamp(state.master, 0, 100),
    cross: clamp(state.cross, 0, 100),
    fromSub: clamp(state.fromSub ?? 100, 0, 100),
    toSub: clamp(state.toSub ?? 100, 0, 100),
    universes: normalizeUniverses(state.universes),
    fromCue: state.fromCue,
    selectedCue: state.selectedCue ?? 0,
    songs,
    activeSongId: active.id,
    sets,
    activeSetId: activeSet.id,
    activeEntryId: resolveActiveEntry(activeSet, state.activeEntryId, active.id)?.id ?? null,
    faderNames: normalizeFaderNames(state.faderNames),
    fixtureGroups,
    fixtures: normalizeFixtures(state.fixtures, fixtureGroups),
    patch: state.patch.map(normalizeFaderPatch),
  };
}

/** Stable snapshot for dirty checks (ignores savedAt / selectedCue). */
export function showSnapshot(state: ShowInput): string {
  const { savedAt: _savedAt, selectedCue: _selectedCue, ...rest } = serializeShow(state);
  return JSON.stringify(rest);
}

/** @param stage the stage's layout, saved in the same file */
function showToJson(state: ShowInput, stage: object | null = null): string {
  const data = serializeShow(state);
  return prettyJson(stage ? { ...data, stage } : data);
}

export function parseShow(data: unknown): ShowData {
  if (!isRecord(data)) throw new Error("Invalid show file.");
  const obj = data;
  // A show file has these; the console's live state (sent to the server) doesn't.
  if ((obj.app != null && obj.app !== SHOW_APP) || (obj.kind != null && obj.kind !== "show")) {
    throw new Error("This file is not an UnnaturalLight show.");
  }
  if (obj.version != null && obj.version !== SHOW_VERSION) {
    throw new Error(`Unsupported show version: ${obj.version}`);
  }

  const patchSource = Array.isArray(obj.patch) ? obj.patch : [];
  const patch = defaultPatch().map((_, i) => normalizeFaderPatch(patchSource[i]));

  const songs = normalizeSongs(obj.songs);
  const active = resolveActiveSong(songs, typeof obj.activeSongId === "string" ? obj.activeSongId : null);
  const cueCount = active.cues.length;
  const sets = normalizeSets(obj.sets, songs);
  const activeSet = resolveActiveSet(sets, typeof obj.activeSetId === "string" ? obj.activeSetId : null);
  const activeEntryId = resolveActiveEntry(activeSet, typeof obj.activeEntryId === "string" ? obj.activeEntryId : null, active.id)?.id ?? null;

  const showName = normalizeShowName(obj.showName);
  const navOrder = normalizeNavOrder(obj.navOrder);
  const faderNames = normalizeFaderNames(obj.faderNames);
  const fixtureGroups = normalizeFixtureGroups(obj.fixtureGroups);
  const fixtures = normalizeFixtures(obj.fixtures, fixtureGroups);
  const master = clamp(Number(obj.master ?? 100), 0, 100);
  const cross = clamp(Number(obj.cross ?? 0), 0, 100);
  const fromSub = clamp(Number(obj.fromSub ?? 100), 0, 100);
  const toSub = clamp(Number(obj.toSub ?? 100), 0, 100);
  const universes = normalizeUniverses(obj.universes);
  const fromCue = clampInt(Number(obj.fromCue ?? 0), 0, cueCount - 1);
  // Up next follows from the live cue and the set (not saved).
  const toCue = upNextCue({ songs, sets, activeSetId: activeSet.id, activeEntryId, activeSongId: active.id, fromCue });
  const selectedCue = clampInt(
    Number(obj.selectedCue ?? 0),
    0,
    cueCount - 1,
  );

  return {
    showName,
    navOrder,
    master,
    cross,
    fromSub,
    toSub,
    universes,
    fromCue,
    toCue,
    selectedCue,
    songs,
    activeSongId: active.id,
    sets,
    activeSetId: activeSet.id,
    activeEntryId,
    faderNames,
    fixtureGroups,
    fixtures,
    patch,
  };
}

export function downloadShow(state: ShowInput, filename?: string, stage: object | null = null) {
  const blob = new Blob([showToJson(state, stage)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || defaultFilename(state.showName);
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function defaultFilename(showName?: unknown) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const base = normalizeShowName(showName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${base || "show"}-${stamp}.json`;
}

/** Autosave full show state for refresh restore (no explicit Save needed). */
export function saveSession(state: ShowInput) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(serializeShow(state)));
  } catch (err) {
    console.warn("Could not autosave session", err);
  }
}

export function loadSession(): ShowData | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return parseShow(JSON.parse(raw));
  } catch (err) {
    console.warn("Could not load session", err);
    return null;
  }
}

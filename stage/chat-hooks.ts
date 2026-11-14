// What the chat panel (../page/chat/) can see and do on the stage
// (window.stageChat): the same functions as the stage's own controls, so its
// edits are saved and shared the usual way. Fixtures and trusses are passed by id.
import { MAX_FIXTURES, TRUSS_TYPES, DIMMER_CURVES, aimAt, aimZeroAt, defaultTarget, deriveFromDmx, setColorHex, setDmx, setZeroHere, homeFixture, type DimmerCurve, type Fixture, consoleTypeFromKey, consoleTypeOfMode, createFixture, round, linkChannels, type TrussType } from "./stage-model.ts";
import { state, byId, positionById, riserById, trussById, trussOf, trussMembers, moveFixture, addTrussAt, setTrussField, serialize, save, TRUSS_FIELDS, type TrussField } from "./state.ts";
import { changed, deleteSelected, duplicateFixtures, addPositionAt, deletePosition, setActivePosition, addRiserAt, deleteRiser, setActiveRiser } from "./actions.ts";
import { setRiserField, RISER_FIELDS, type Riser, type RiserField } from "./risers.ts";
import { renderInspector } from "./sidebar.ts";
import { updateBox } from "./view3d.ts";
import { syncBoxInputs } from "./dialogs.ts";
import { requestRegistrations, linkInOrder, registerFixtures, consoleFixtureById } from "./link.ts";
import { listManufacturers, listFixtures, loadFixture, modesOf, profileFor, type FixtureProfile } from "./fixture-library.ts";
import { applyFixture } from "./stage-model.ts";
import type { DmxAttr } from "../shared/attributes.ts";
import { aimAndFollow, followingOf, stopFollowing } from "./follow.ts";
import { unitName } from "./units.ts";
import { takeStage } from "./stage.ts";
import { clamp } from "../shared/numbers.ts";
import * as THREE from "three";

declare global {
  interface Window {
    stageChat?: StageChat;
  }
}

const fixtureOrThrow = (id: string) => {
  const f = byId(id);
  if (!f) throw new Error("No such fixture on the stage");
  return f;
};

const trussOrThrow = (id: string) => {
  const r = trussById(id);
  if (!r) throw new Error("No such truss");
  return r;
};

/** Show these fixtures selected (so the person sees what the chat changed), and redraw. */
function showChanged(ids: string[]) {
  state.selected = ids.filter((id) => byId(id));
  renderInspector();
  changed();
}

/** A fixture's values as the chat sees them (0–255; color as #rrggbb, what it shows). */
const fixtureValues = (f: Fixture) => ({ name: f.name, ...f.dmx, color: f.color });

/** A fixture's own settings as the chat sees them. */
const fixtureSettings = (f: Fixture) => ({ name: f.name, panRange: f.panLimit, tiltRange: f.tiltLimit, beamMin: f.zoomMin, beamMax: f.zoomMax, dimmerCurve: f.dimmerCurve });

/** A riser as the chat sees it (meters, yaw in degrees). */
const riserInfo = (r: Riser) => ({ name: r.name, x: r.x, z: r.z, width: r.w, depth: r.d, height: r.h, yaw: r.yaw });

/** Riser sizes as the chat names them → the riser's own fields. */
const RISER_SIZE_KEYS = { width: "w", depth: "d", height: "h" } as const;

const stageChat = {
  // --- the fixture library (Open Fixture Library; needs internet) -------------

  /** Manufacturers whose name or key contains `query` (all if empty). */
  async manufacturers(query: string) {
    const q = query.trim().toLowerCase();
    return (await listManufacturers()).filter((m) => !q || m.name.toLowerCase().includes(q) || m.key.includes(q));
  },
  /** A manufacturer's fixtures whose name or key contains `query`. */
  async libraryFixtures(manufacturer: string, query: string) {
    const q = query.trim().toLowerCase();
    return (await listFixtures(manufacturer)).filter((f) => !q || f.name.toLowerCase().includes(q) || f.key.includes(q));
  },
  /** A library fixture's modes (channel count, and whether it can be used here). */
  async libraryModes(manufacturer: string, fixture: string) {
    return modesOf(await loadFixture(manufacturer, fixture));
  },
  /** The profile for one mode, to place with addFixtures / addTruss. */
  async libraryProfile(manufacturer: { key: string; name: string }, fixture: string, modeIndex: number): Promise<FixtureProfile> {
    return profileFor(await loadFixture(manufacturer.key, fixture), manufacturer.name, manufacturer.key, fixture, modeIndex);
  },

  // --- console links ----------------------------------------------------------

  /** Link fixtures in order to console fixtures, the first to `consoleId` (by channel order after it). Returns how many were linked. */
  linkToConsole(ids: string[], consoleId: string) {
    if (!consoleFixtureById(consoleId)) throw new Error("The stage doesn't know that console fixture yet");
    const n = linkInOrder(ids.map(fixtureOrThrow), consoleId);
    showChanged(ids);
    return n;
  },
  /** Give each a new console fixture (a console type key; ignored for library fixtures, which bring their own channels). */
  register(ids: string[], typeKey: string, universe: number | null) {
    registerFixtures(ids.map(fixtureOrThrow), typeKey, universe);
    showChanged(ids);
  },

  /** The console fixtures that stage fixtures made (their console ids): the stage owns those. */
  consoleIds: () => state.fixtures.flatMap((f) => (f.link.consoleId ? [f.link.consoleId] : [])),
  /** The box, trusses and fixtures, for the model to read. */
  stage() {
    return {
      box: { ...state.box },
      trusses: state.trusses.map((r) => ({
        id: r.id, name: r.name, type: r.type,
        x: r.x, y: r.y, z: r.z, size: r.size, count: r.count, tilt: r.tilt, yaw: r.yaw,
      })),
      fixtures: state.fixtures.map((f) => ({
        id: f.id, name: f.name,
        x: f.x, y: f.y, z: f.z,
        truss: trussOf(f)?.name ?? null,
        pan: round(f.pan, 1), tilt: round(f.tilt, 1),
        console: f.link.consoleId ? consoleFixtureById(f.link.consoleId)?.name ?? "(missing console fixture)" : "registering",
        ...(f.link.fixture ? { model: `${f.link.fixture.manufacturer} ${f.link.fixture.model} (${f.link.fixture.mode})` } : {}),
        selected: state.selected.includes(f.id),
        following: followingOf(f)?.name ?? null,
      })),
      positions: state.positions.map((p) => ({ id: p.id, name: p.name, x: p.x, y: p.y, z: p.z })),
      risers: state.risers.map((r) => ({ id: r.id, ...riserInfo(r) })),
      maxFixtures: MAX_FIXTURES,
      /** The unit the person sees lengths in (the tools always use meters). */
      units: unitName(),
    };
  },

  /** A new named position (a spot to aim at). */
  addPosition(name: string, at: { x: number; y: number; z: number }) {
    const n = name.trim();
    if (n && state.positions.some((p) => p.name.toLowerCase() === n.toLowerCase())) throw new Error(`There's already a position called "${n}"`);
    const position = addPositionAt(at.x, at.y, at.z, n, { rename: false });
    if (!position) throw new Error("Position limit reached");
    return { name: position.name, x: position.x, y: position.y, z: position.z };
  },

  /** Rename or move a position (fixtures following it re-aim). */
  editPosition(id: string, change: { name?: string; x?: number; y?: number; z?: number }) {
    const position = positionById(id);
    if (!position) throw new Error("No such position");
    const n = change.name?.trim();
    if (n && state.positions.some((p) => p !== position && p.name.toLowerCase() === n.toLowerCase())) throw new Error(`There's already a position called "${n}"`);
    if (n) position.name = n;
    for (const k of ["x", "y", "z"] as const) {
      const v = change[k];
      if (v != null) position[k] = round(k === "y" ? clamp(v, 0, 100) : clamp(v, -100, 100));
    }
    setActivePosition(position.id);
    changed();
    return { name: position.name, x: position.x, y: position.y, z: position.z };
  },

  deletePosition(id: string) {
    const position = positionById(id);
    if (!position) throw new Error("No such position");
    deletePosition(id);
    return position.name;
  },

  /** A new riser centered at (x, z) on the floor; sizes default to an 8 × 4 ft deck, 0.4 m high. */
  addRiser(cfg: { name?: string | undefined; x: number; z: number; width?: number; depth?: number; height?: number; yaw?: number }) {
    const n = cfg.name?.trim() ?? "";
    if (n && state.risers.some((r) => r.name.toLowerCase() === n.toLowerCase())) throw new Error(`There's already a riser called "${n}"`);
    const riser = addRiserAt(cfg.x, cfg.z, {
      // Only the fields given: addRiserAt merges them over the defaults.
      ...(n ? { name: n } : {}),
      ...(cfg.width != null ? { w: cfg.width } : {}),
      ...(cfg.depth != null ? { d: cfg.depth } : {}),
      ...(cfg.height != null ? { h: cfg.height } : {}),
      ...(cfg.yaw != null ? { yaw: cfg.yaw } : {}),
    }, { rename: false });
    if (!riser) throw new Error("Riser limit reached");
    return riserInfo(riser);
  },

  /** Rename, move (x / z), resize or turn a riser. */
  editRiser(id: string, change: { name?: string | undefined; x?: number | undefined; z?: number | undefined; width?: number | undefined; depth?: number | undefined; height?: number | undefined; yaw?: number | undefined }) {
    const riser = riserById(id);
    if (!riser) throw new Error("No such riser");
    const n = change.name?.trim();
    if (n && state.risers.some((r) => r !== riser && r.name.toLowerCase() === n.toLowerCase())) throw new Error(`There's already a riser called "${n}"`);
    const fields: Partial<Record<RiserField, string | number | undefined>> = { name: n || undefined, x: change.x, z: change.z, yaw: change.yaw };
    for (const [k, f] of Object.entries(RISER_SIZE_KEYS)) fields[f] = change[k as keyof typeof RISER_SIZE_KEYS];
    for (const k of RISER_FIELDS) { const v = fields[k]; if (v != null) setRiserField(riser, k, v); }
    setActiveRiser(riser.id);
    changed();
    return riserInfo(riser);
  },

  deleteRiser(id: string) {
    const riser = riserById(id);
    if (!riser) throw new Error("No such riser");
    deleteRiser(id);
    return riser.name;
  },

  /**
   * New free fixtures at these points; `type` = a console type key. With a library `profile` they're that real fixture (named
   * after its model unless named), and their console fixtures get its channels.
   */
  addFixtures(points: { x: number; y: number; z: number; name?: string | undefined }[], type: string, profile?: FixtureProfile | null) {
    const room = MAX_FIXTURES - state.fixtures.length;
    if (points.length > room) throw new Error(`Only room for ${room} more fixtures (max ${MAX_FIXTURES})`);
    const register = profile ? consoleTypeOfMode(profile) : consoleTypeFromKey(type);
    const added = points.map((p) => {
      const f = createFixture(p.x, p.y, p.z, state.fixtures.length, state.box);
      if (profile) {
        applyFixture(f, profile);
        f.name = `${profile.model} ${state.fixtures.filter((i) => i.link.fixture?.model === profile.model).length + 1}`;
      }
      if (p.name?.trim()) f.name = p.name.trim();
      f.link.register = register;
      state.fixtures.push(f);
      return f;
    });
    showChanged(added.map((f) => f.id));
    requestRegistrations();
    return added.map((f) => f.name);
  },

  /** A new truss (circle, square, line) centered at (x, y, z). */
  addTruss(cfg: { type: TrussType; x: number; y: number; z: number; size?: number | undefined; count?: number | undefined; tilt?: number | undefined; yaw?: number | undefined; consoleType: string; name?: string | undefined; profile?: FixtureProfile | null }) {
    const d = TRUSS_TYPES[cfg.type].defaults;
    const count = Math.round(cfg.count ?? d.count);
    const room = MAX_FIXTURES - state.fixtures.length;
    if (count < 2) throw new Error("A truss needs at least 2 fixtures");
    if (count > room) throw new Error(`This truss needs ${count} fixtures; there's room for ${room} (max ${MAX_FIXTURES})`);
    const before = new Set(state.trusses.map((r) => r.id));
    addTrussAt({
      type: cfg.type,
      size: clamp(cfg.size ?? d.size, 0.5, 50),
      count,
      tilt: clamp(cfg.tilt ?? d.tilt, -90, 90),
      yaw: cfg.yaw ?? d.yaw,
      consoleType: cfg.profile ? consoleTypeOfMode(cfg.profile) : consoleTypeFromKey(cfg.consoleType),
      fixture: cfg.profile ?? null,
      universe: null,
    }, cfg.x, cfg.y, cfg.z);
    const truss = state.trusses.find((r) => !before.has(r.id));
    if (!truss) throw new Error("The truss wasn't added");
    if (cfg.name?.trim()) {
      setTrussField(truss, "name", cfg.name.trim());
      showChanged(trussMembers(truss).map((m) => m.id));
    }
    return { name: truss.name, x: truss.x, y: truss.y, z: truss.z, fixtures: trussMembers(truss).map((m) => m.name) };
  },

  /** Change a truss's name, position (center), size, count, tilt or yaw. */
  editTruss(id: string, fields: Partial<Record<TrussField, string | number>>) {
    const truss = trussOrThrow(id);
    for (const k of TRUSS_FIELDS) if (fields[k] != null) setTrussField(truss, k, String(fields[k]));
    showChanged(trussMembers(truss).map((m) => m.id));
    return { name: truss.name, x: truss.x, y: truss.y, z: truss.z, size: truss.size, count: truss.count, tilt: truss.tilt, yaw: truss.yaw };
  },

  /**
   * Move free fixtures to a point (`to`, any of x / y / z) or by an offset
   * (`by`). Truss members are moved with their truss (editTruss).
   */
  moveFixtures(ids: string[], move: { to?: Partial<Record<"x" | "y" | "z", number>>; by?: Partial<Record<"x" | "y" | "z", number>> }) {
    const fixtures = ids.map(fixtureOrThrow);
    const trusses = [...new Set(fixtures.map((f) => trussOf(f)?.name).filter((n) => n != null))];
    if (trusses.length) throw new Error(`Fixtures in ${trusses.length > 1 ? "trusses" : "truss"} ${trusses.join(", ")} move with the truss: change its center with edit_truss`);
    for (const f of fixtures) {
      const to = move.to ?? {};
      const by = move.by ?? {};
      moveFixture(f, round(to.x ?? f.x + (by.x ?? 0)), round(to.y ?? f.y + (by.y ?? 0)), round(to.z ?? f.z + (by.z ?? 0)));
    }
    showChanged(fixtures.map((f) => f.id));
    return fixtures.map((f) => ({ name: f.name, x: f.x, y: f.y, z: f.z }));
  },

  /** Point fixtures' beams at a spot (pan / tilt), or home them (null); they stop following. Returns those out of range. */
  aimFixtures(ids: string[], at: { x: number; y: number; z: number } | null) {
    const fixtures = ids.map(fixtureOrThrow);
    stopFollowing(fixtures);
    if (!at) fixtures.forEach(homeFixture);
    const missed = at ? fixtures.filter((f) => !aimAt(f, new THREE.Vector3(at.x, at.y, at.z))) : [];
    showChanged(fixtures.map((f) => f.id));
    return { aimed: fixtures.map((f) => ({ name: f.name, pan: round(f.pan, 1), tilt: round(f.tilt, 1) })), outOfRange: missed.map((f) => f.name) };
  },

  /** Aim fixtures at a named position, to follow it. Returns those out of range. */
  aimAtPosition(ids: string[], positionId: string) {
    const fixtures = ids.map(fixtureOrThrow);
    if (!positionById(positionId)) throw new Error("No such position");
    const missed = aimAndFollow(fixtures, positionId);
    showChanged(fixtures.map((f) => f.id));
    return { aimed: fixtures.map((f) => ({ name: f.name, pan: round(f.pan, 1), tilt: round(f.tilt, 1) })), outOfRange: missed.map((f) => f.name) };
  },

  /** Stop fixtures following a position. Returns the names of those that were. */
  stopFollowing(ids: string[]) {
    const fixtures = ids.map(fixtureOrThrow);
    const were = fixtures.filter((f) => followingOf(f)).map((f) => f.name);
    stopFollowing(fixtures);
    showChanged(fixtures.map((f) => f.id));
    return were;
  },

  renameFixture(id: string, name: string) {
    const f = fixtureOrThrow(id);
    const n = name.trim();
    if (!n) throw new Error("A name can't be empty");
    f.name = n;
    showChanged([f.id]);
    return n;
  },

  /**
   * Set fixtures' values (0–255 each, as the inspector's sliders and keys
   * do) and / or color (#rrggbb, mixed onto the color channels each is linked
   * with). For a fixture the console drives, the values go to its channels
   * on the console, as the inspector's do. Setting pan or tilt stops following.
   */
  setValues(ids: string[], values: { levels?: Partial<Record<DmxAttr, number>>; color?: string | undefined }) {
    const fixtures = ids.map(fixtureOrThrow);
    const levels = Object.entries(values.levels ?? {}) as [DmxAttr, number][];
    if (levels.some(([a]) => a === "pan" || a === "tilt")) stopFollowing(fixtures);
    for (const f of fixtures) {
      if (values.color != null) setColorHex(f, values.color);
      for (const [a, v] of levels) setDmx(f, a, v);
    }
    showChanged(fixtures.map((f) => f.id));
    return fixtures.map(fixtureValues);
  },

  /**
   * A fixture's own settings, as the inspector's Ranges, Dimmer curve and
   * zero frame: how far pan / tilt go (± degrees), the beam angle at zoom 0
   * and 255, the dimmer curve, and `zero`: "here" (where it points now
   * becomes pan / tilt 128) or "stage" (its zero aimed at the stage). A truss
   * member's zero is its truss's, so `zero` skips them (listed in `skipped`).
   */
  editSettings(ids: string[], s: { panRange?: number | undefined; tiltRange?: number | undefined; beamMin?: number | undefined; beamMax?: number | undefined; dimmerCurve?: string | undefined; zero?: "here" | "stage" | undefined }) {
    const fixtures = ids.map(fixtureOrThrow);
    if (s.dimmerCurve != null && !DIMMER_CURVES.includes(s.dimmerCurve as DimmerCurve)) throw new Error(`dimmer_curve must be one of ${DIMMER_CURVES.join(", ")}`);
    const skipped: string[] = [];
    for (const f of fixtures) {
      if (s.panRange != null) f.panLimit = clamp(s.panRange, 0, 360);
      if (s.tiltRange != null) f.tiltLimit = clamp(s.tiltRange, 0, 180);
      // Both given: the narrower is zoom 0's (whichever way round they came). One: kept within the other.
      let min = s.beamMin == null ? null : clamp(s.beamMin, 1, 120);
      let max = s.beamMax == null ? null : clamp(s.beamMax, 1, 120);
      if (min != null && max != null && min > max) [min, max] = [max, min];
      if (min != null && max != null) Object.assign(f, { zoomMin: min, zoomMax: max });
      else if (min != null) f.zoomMin = Math.min(min, f.zoomMax);
      else if (max != null) f.zoomMax = Math.max(max, f.zoomMin);
      if (s.dimmerCurve != null) f.dimmerCurve = s.dimmerCurve as DimmerCurve;
      deriveFromDmx(f);
      if (s.zero) {
        if (f.trussId) skipped.push(f.name);
        else if (s.zero === "here") setZeroHere(f);
        else aimZeroAt(f, defaultTarget(f, state.box));
      }
    }
    if (s.zero) stopFollowing(fixtures.filter((f) => !f.trussId));
    showChanged(fixtures.map((f) => f.id));
    return { fixtures: fixtures.map(fixtureSettings), ...(skipped.length ? { skipped } : {}) };
  },

  /** Copy fixtures (0.5 m to stage left; each gets its own console fixture if the original came from the stage). Returns the copies' names. */
  duplicateFixtures(ids: string[]) {
    const fixtures = ids.map(fixtureOrThrow);
    const copies = duplicateFixtures(fixtures);
    if (!copies.length) throw new Error(`The stage has its maximum of ${MAX_FIXTURES} fixtures`);
    return { copies: copies.map((f) => f.name), ...(copies.length < fixtures.length ? { note: `Fixture limit (${MAX_FIXTURES}): copied ${copies.length} of ${fixtures.length}` } : {}) };
  },

  /** Select fixtures on the stage (as clicking them would), so the person can carry on by hand. [] = none. */
  select(ids: string[]) {
    ids.forEach(fixtureOrThrow);
    showChanged(ids);
    return state.selected.map((id) => byId(id)?.name ?? id);
  },

  /** Delete fixtures (a truss member takes its whole truss with it). Returns what was deleted. */
  deleteFixtures(ids: string[]) {
    const fixtures = ids.map(fixtureOrThrow);
    const trusses = [...new Set(fixtures.map(trussOf).filter((r) => r != null))];
    const names = [...trusses.map((r) => `${r.name} (${r.count} fixtures)`), ...fixtures.filter((f) => !f.trussId).map((f) => f.name)];
    state.selected = fixtures.map((f) => f.id);
    deleteSelected();
    return names;
  },

  /** The box's size in meters (1–100 each). */
  setBox(size: { w?: number | undefined; d?: number | undefined; h?: number | undefined }) {
    for (const k of ["w", "d", "h"] as const) if (size[k] != null) state.box[k] = clamp(Number(size[k]), 1, 100);
    syncBoxInputs();
    updateBox();
    changed();
    return { ...state.box };
  },

  /**
   * The stage's edits now, to compare (`key`) and to put back (`data`).
   * Values a linked fixture takes from the console (its levels, pan, tilt…)
   * are left out of the key: the console's own snapshot has them, and they
   * change with playback.
   */
  editSnapshot() {
    // A copy: the saved form shares objects (box, dmx, link…) with the stage.
    const data = structuredClone(serialize());
    const linked = new Map(state.fixtures.map((f) => [f.id, new Set(linkChannels(f).map((c) => c.attr))]));
    const key = JSON.stringify({
      ...data,
      fixtures: data.fixtures.map((f) => {
        const skip = linked.get(f.id);
        return { ...f, dmx: Object.fromEntries(Object.entries(f.dmx).filter(([a]) => !skip?.has(a as never))) };
      }),
    });
    return { key, data };
  },

  /** Put the stage back as a snapshot had it (this window's selection stays). */
  restoreEdits(data: unknown) {
    takeStage(data);
    save();
    requestRegistrations();
  },
};

export type StageChat = typeof stageChat;
window.stageChat = stageChat;

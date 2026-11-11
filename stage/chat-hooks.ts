// What the chat panel (../page/chat/) can see and do on the stage
// (window.stageChat): the same functions as the stage's own controls, so its
// edits are saved and shared the usual way. Fixtures and rigs are passed by id.
import { MAX_FIXTURES, RIG_TYPES, aimAt, homeFixture, consoleTypeFromKey, createFixture, round, linkChannels, type RigType } from "./stage-model.ts";
import { state, byId, positionById, rigById, rigOf, rigMembers, moveFixture, addRigAt, setRigField, serialize, save, RIG_FIELDS, type RigField } from "./state.ts";
import { changed, deleteSelected, addPositionAt, deletePosition, setActivePosition } from "./actions.ts";
import { renderInspector } from "./sidebar.ts";
import { updateBox } from "./view3d.ts";
import { syncBoxInputs } from "./dialogs.ts";
import { requestRegistrations } from "./link.ts";
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

/** Console types by key, for the chat ("none" = stage only). */
export const CHAT_CONSOLE_TYPES = ["movable/multi", "movable/single", "fixed/multi", "fixed/single", "none"] as const;

const fixtureOrThrow = (id: string) => {
  const f = byId(id);
  if (!f) throw new Error("No such fixture on the stage");
  return f;
};

const rigOrThrow = (id: string) => {
  const r = rigById(id);
  if (!r) throw new Error("No such rig");
  return r;
};

/** Show these fixtures selected (so the person sees what the chat changed), and redraw. */
function showChanged(ids: string[]) {
  state.selected = ids.filter((id) => byId(id));
  renderInspector();
  changed();
}

const stageChat = {
  /** The box, rigs and fixtures, for the model to read. */
  stage() {
    return {
      box: { ...state.box },
      rigs: state.rigs.map((r) => ({
        id: r.id, name: r.name, type: r.type,
        x: r.x, y: r.y, z: r.z, size: r.size, count: r.count, tilt: r.tilt, yaw: r.yaw,
      })),
      fixtures: state.fixtures.map((f) => ({
        id: f.id, name: f.name,
        x: f.x, y: f.y, z: f.z,
        rig: rigOf(f)?.name ?? null,
        pan: round(f.pan, 1), tilt: round(f.tilt, 1),
        inConsole: !!(f.link.consoleId || f.link.register),
        selected: state.selected.includes(f.id),
        following: followingOf(f)?.name ?? null,
      })),
      positions: state.positions.map((p) => ({ id: p.id, name: p.name, x: p.x, y: p.y, z: p.z })),
      maxFixtures: MAX_FIXTURES,
      /** The unit the person sees lengths in (the tools always use meters). */
      units: unitName(),
    };
  },

  /** A new named position (a spot to aim at). */
  addPosition(name: string, at: { x: number; y: number; z: number }) {
    const n = name.trim();
    if (n && state.positions.some((p) => p.name.toLowerCase() === n.toLowerCase())) throw new Error(`There's already a position called "${n}"`);
    const position = addPositionAt(at.x, at.y, at.z, n);
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

  /** New free fixtures at these points; `type` = a console type key or "none" (stage only). */
  addFixtures(points: { x: number; y: number; z: number; name?: string }[], type: string) {
    const room = MAX_FIXTURES - state.fixtures.length;
    if (points.length > room) throw new Error(`Only room for ${room} more fixtures (max ${MAX_FIXTURES})`);
    const register = consoleTypeFromKey(type);
    const added = points.map((p) => {
      const f = createFixture(p.x, p.y, p.z, state.fixtures.length, state.box);
      if (p.name?.trim()) f.name = p.name.trim();
      f.link.register = register;
      state.fixtures.push(f);
      return f;
    });
    showChanged(added.map((f) => f.id));
    requestRegistrations();
    return added.map((f) => f.name);
  },

  /** A new rig (circle, square, line) centered at (x, y, z). */
  addRig(cfg: { type: RigType; x: number; y: number; z: number; size?: number; count?: number; tilt?: number; yaw?: number; consoleType: string; name?: string }) {
    const d = RIG_TYPES[cfg.type].defaults;
    const count = Math.round(cfg.count ?? d.count);
    const room = MAX_FIXTURES - state.fixtures.length;
    if (count < 2) throw new Error("A rig needs at least 2 fixtures");
    if (count > room) throw new Error(`This rig needs ${count} fixtures; there's room for ${room} (max ${MAX_FIXTURES})`);
    const before = new Set(state.rigs.map((r) => r.id));
    addRigAt({
      type: cfg.type,
      size: clamp(cfg.size ?? d.size, 0.5, 50),
      count,
      tilt: clamp(cfg.tilt ?? d.tilt, -90, 90),
      yaw: cfg.yaw ?? d.yaw,
      consoleType: consoleTypeFromKey(cfg.consoleType),
      fixture: null,
      universe: null,
    }, cfg.x, cfg.y, cfg.z);
    const rig = state.rigs.find((r) => !before.has(r.id));
    if (!rig) throw new Error("The rig wasn't added");
    if (cfg.name?.trim()) {
      setRigField(rig, "name", cfg.name.trim());
      showChanged(rigMembers(rig).map((m) => m.id));
    }
    return { name: rig.name, x: rig.x, y: rig.y, z: rig.z, fixtures: rigMembers(rig).map((m) => m.name) };
  },

  /** Change a rig's name, position (center), size, count, tilt or yaw. */
  editRig(id: string, fields: Partial<Record<RigField, string | number>>) {
    const rig = rigOrThrow(id);
    for (const k of RIG_FIELDS) if (fields[k] != null) setRigField(rig, k, String(fields[k]));
    showChanged(rigMembers(rig).map((m) => m.id));
    return { name: rig.name, x: rig.x, y: rig.y, z: rig.z, size: rig.size, count: rig.count, tilt: rig.tilt, yaw: rig.yaw };
  },

  /**
   * Move free fixtures to a point (`to`, any of x / y / z) or by an offset
   * (`by`). Rig members are moved with their rig (editRig).
   */
  moveFixtures(ids: string[], move: { to?: Partial<Record<"x" | "y" | "z", number>>; by?: Partial<Record<"x" | "y" | "z", number>> }) {
    const fixtures = ids.map(fixtureOrThrow);
    const rigs = [...new Set(fixtures.map((f) => rigOf(f)?.name).filter((n) => n != null))];
    if (rigs.length) throw new Error(`Fixtures in ${rigs.length > 1 ? "rigs" : "rig"} ${rigs.join(", ")} move with the rig: change its center with edit_rig`);
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
    const missed = at ? fixtures.filter((f) => !aimAt(f, new THREE.Vector3(at.x, at.y, at.z))) : (fixtures.forEach(homeFixture), []);
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

  /** Delete fixtures (a rig member takes its whole rig with it). Returns what was deleted. */
  deleteFixtures(ids: string[]) {
    const fixtures = ids.map(fixtureOrThrow);
    const rigs = [...new Set(fixtures.map(rigOf).filter((r) => r != null))];
    const names = [...rigs.map((r) => `${r.name} (${r.count} fixtures)`), ...fixtures.filter((f) => !f.rigId).map((f) => f.name)];
    state.selected = fixtures.map((f) => f.id);
    deleteSelected();
    return names;
  },

  /** The box's size in meters (1–100 each). */
  setBox(size: { w?: number; d?: number; h?: number }) {
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

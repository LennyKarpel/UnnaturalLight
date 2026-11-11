// The plan view (2D): top, front or side, with dragging and right-click.
import * as THREE from "three";
import { round, beamDir, axisHits, rigOutline, describeSpot, type Box, type Fixture, type StagePosition, type Xyz } from "./stage-model.ts";
import { clamp } from "../shared/numbers.ts";
import { state, byId, selectedFixtures, moveFixture, addRigAt, positionById, ui } from "./state.ts";
import { look, changed, select, selectRigOf, applyAim, addFixtureAt, addPositionAt, setActivePosition, setHoverPosition, openContextMenu, showPositionSpot } from "./actions.ts";
import { followingOf } from "./follow.ts";
import { showTrace } from "./stage.ts";
import { isPresent } from "../shared/guards.ts";
import { elById, must } from "../shared/query.ts";
import { readStored, store } from "../shared/storage.ts";

// ---------------------------------------------------------------------
// Plan view (2D): top, front (from the audience), or from stage right / left
// ---------------------------------------------------------------------
// Each view maps the world onto canvas axes (a → right, b → down):
//   a = hSign · world[h]      b = vSign · world[v]
// so "up" in the elevations is +y (vSign −1), and the stage-left view
// mirrors z so the audience ends up on its left (hSign −1).

type Axis = "x" | "y" | "z";
type Edge = "top" | "bottom" | "left" | "right";
export type PlanView = "top" | "front" | "sr" | "sl";
type PlanViewSpec = {
  h: Axis;
  hSign?: number;
  v: Axis;
  vSign: number;
  caption: string;
  labels: Record<Edge, string>;
  audienceEdge: Edge | null;
  placeDefault: (box: Box) => Partial<Xyz>;
  placeHint: (box: Box) => string;
  aimDefault: (box: Box) => Partial<Xyz>;
  aimHint: string;
  /** While placing a position (it goes where an aim would: aimDefault). */
  positionHint: string;
  /** The surface a position placed in this view sits on. */
  positionSurface: string;
};
/** Where the plan maps the world: its a / b axes (in plan units) and pixel scale. */
type Fit = { minA: number; minB: number; scale: number };

const PLAN_VIEWS: Record<PlanView, PlanViewSpec> = {
  top: {
    h: "x", v: "z", vSign: 1, caption: "top · audience ↓",
    labels: { top: "UPSTAGE", bottom: "AUDIENCE", left: "SR", right: "SL" }, audienceEdge: "bottom",
    placeDefault: (box: Box) => ({ y: box.h - 0.3 }), placeHint: (box: Box) => `height ${round(box.h - 0.3, 1)} m`,
    aimDefault: () => ({ y: 0 }), aimHint: "click a floor spot to aim at", positionHint: "click a floor spot for the position", positionSurface: "Floor",
  },
  front: {
    h: "x", v: "y", vSign: -1, caption: "front · from the audience",
    labels: { top: "CEILING", bottom: "FLOOR", left: "SR", right: "SL" }, audienceEdge: null,
    placeDefault: () => ({ z: 0 }), placeHint: () => "on the center line (z 0)",
    aimDefault: (box: Box) => ({ z: -box.d / 2 }), aimHint: "click a spot on the upstage wall to aim at", positionHint: "click a spot on the upstage wall for the position", positionSurface: "Upstage wall",
  },
  sr: {
    h: "z", v: "y", vSign: -1, caption: "from stage right · audience →",
    labels: { top: "CEILING", bottom: "FLOOR", left: "UPSTAGE", right: "AUDIENCE" }, audienceEdge: "right",
    placeDefault: () => ({ x: 0 }), placeHint: () => "on the center line (x 0)",
    aimDefault: (box: Box) => ({ x: box.w / 2 }), aimHint: "click a spot on the stage-left wall to aim at", positionHint: "click a spot on the stage-left wall for the position", positionSurface: "Stage-left wall",
  },
  sl: {
    h: "z", hSign: -1, v: "y", vSign: -1, caption: "from stage left · ← audience",
    labels: { top: "CEILING", bottom: "FLOOR", left: "AUDIENCE", right: "UPSTAGE" }, audienceEdge: "left",
    placeDefault: () => ({ x: 0 }), placeHint: () => "on the center line (x 0)",
    aimDefault: (box: Box) => ({ x: -box.w / 2 }), aimHint: "click a spot on the stage-right wall to aim at", positionHint: "click a spot on the stage-right wall for the position", positionSurface: "Stage-right wall",
  },
};
const PLAN_VIEW_KEY = "unnaturallight.stage.planView";

const isPlanView = (v: unknown): v is PlanView => typeof v === "string" && Object.hasOwn(PLAN_VIEWS, v);

const savedPlanView = readStored(PLAN_VIEW_KEY);
export let planView: PlanView = isPlanView(savedPlanView) ? savedPlanView : "top";

const plan = elById<HTMLCanvasElement>("plan");
const pctx = must(plan.getContext("2d"), "plan canvas 2D context");
let planFit: Fit | null = null;
/** Fit computed on first use (kept while dragging so the plan doesn't rescale under the pointer). */
const fit = (): Fit => (planFit ??= computeFit());
/** Dragging a fixture or a position: which one, and where it sits relative to the pointer. */
let planDrag: { kind: "fixture" | "position"; id: string; da: number; db: number; moved?: boolean } | null = null;
/** Named positions' color (the same as --position in stage.css). */
const POSITION_COLOR = "#c58cff";
/** The dotted axes through a new position's preview (as in 3D: x red, height green, z blue). */
const AXIS_COLORS: Record<Axis, string> = { x: "#ff7a7a", y: "#7ee08a", z: "#7aaaff" };
/** Placing a position: where it would go under the pointer (world, snapped), or null. */
let positionHover: Xyz | null = null;

/** Where a click at plan axes (a, b) puts a new position: on the surface this view shows, snapped to 0.1 m. */
function positionSpotAt(a: number, b: number): Xyz {
  const p = { x: 0, y: 0, z: 0, ...pv().aimDefault(state.box) };
  setAB(p, a, b);
  return { x: round(p.x, 1), y: round(clamp(p.y, 0, 50), 1), z: round(p.z, 1) };
}

const pv = () => PLAN_VIEWS[planView];

/** World point (anything with x, y, z) → plan axes [a, b]. */
function toAB(p: Xyz): [number, number] {
  const V = pv();
  return [(V.hSign ?? 1) * p[V.h], V.vSign * p[V.v]];
}

/** Write plan axes [a, b] back into a world point / fixture. */
function setAB(p: Xyz, a: number, b: number) {
  const V = pv();
  p[V.h] = (V.hSign ?? 1) * a;
  p[V.v] = V.vSign * b;
}

/** World-axis range of the box. */
function boxRange(axis: Axis): [number, number] {
  const { w, d, h } = state.box;
  return axis === "x" ? [-w / 2, w / 2] : axis === "z" ? [-d / 2, d / 2] : [0, h];
}

/** Box range on the plan's a axis (flipped for the stage-left view). */
function boxRangeA(): [number, number] {
  const V = pv();
  const [lo, hi] = boxRange(V.h);
  return (V.hSign ?? 1) > 0 ? [lo, hi] : [-hi, -lo];
}

/** Box range on the plan's b axis (flipped for elevations). */
function boxRangeB(): [number, number] {
  const V = pv();
  const [lo, hi] = boxRange(V.v);
  return V.vSign > 0 ? [lo, hi] : [-hi, -lo];
}

function computeFit(): Fit {
  const { w, d, h } = state.box;
  // Generous margin so there's room to place fixtures outside the box.
  const margin = Math.max(4, Math.max(w, d, h) * 0.6);
  let [minA, maxA] = boxRangeA();
  let [minB, maxB] = boxRangeB();
  minA -= margin; maxA += margin; minB -= margin; maxB += margin;
  for (const i of [...state.fixtures, ...state.positions]) {
    const [a, b] = toAB(i);
    minA = Math.min(minA, a - 1); maxA = Math.max(maxA, a + 1);
    minB = Math.min(minB, b - 1); maxB = Math.max(maxB, b + 1);
  }
  const size = plan.clientWidth;
  const span = Math.max(maxA - minA, maxB - minB);
  const ca = (minA + maxA) / 2, cb = (minB + maxB) / 2;
  return { minA: ca - span / 2, minB: cb - span / 2, scale: size / span };
}

const toPlan = (a: number, b: number): [number, number] => { const f = fit(); return [(a - f.minA) * f.scale, (b - f.minB) * f.scale]; };
const fromPlan = (px: number, py: number): [number, number] => { const f = fit(); return [px / f.scale + f.minA, py / f.scale + f.minB]; };
const fixturePlan = (p: Xyz) => toPlan(...toAB(p));

export function drawPlan() {
  const size = plan.clientWidth;
  if (!size) return;
  const dpr = window.devicePixelRatio || 1;
  if (plan.width !== Math.round(size * dpr)) { plan.width = Math.round(size * dpr); plan.height = Math.round(size * dpr); }
  if (!planDrag) planFit = null;
  const { scale } = fit();
  const V = pv();
  const ctx = pctx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  // 1 m grid
  ctx.strokeStyle = "#171a20";
  ctx.lineWidth = 1;
  const [ga0, gb0] = fromPlan(0, 0);
  const [ga1, gb1] = fromPlan(size, size);
  ctx.beginPath();
  for (let a = Math.ceil(ga0); a <= ga1; a++) { const [px] = toPlan(a, 0); ctx.moveTo(px, 0); ctx.lineTo(px, size); }
  for (let b = Math.ceil(gb0); b <= gb1; b++) { const [, py] = toPlan(0, b); ctx.moveTo(0, py); ctx.lineTo(size, py); }
  ctx.stroke();

  // Ground line in the elevations
  if (V.v === "y") {
    const [, gy] = toPlan(0, 0);
    ctx.strokeStyle = "#3a4150";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(size, gy); ctx.stroke();
  }

  // Box
  const [a0, a1] = boxRangeA();
  const [b0, b1] = boxRangeB();
  const [bx, by] = toPlan(a0, b0);
  const bw = (a1 - a0) * scale, bh = (b1 - b0) * scale;
  ctx.fillStyle = "#14171d";
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = "#5a6272";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(bx, by, bw, bh);
  if (V.audienceEdge) {
    ctx.strokeStyle = "#e2a13a";
    ctx.beginPath();
    if (V.audienceEdge === "bottom") { ctx.moveTo(bx, by + bh); ctx.lineTo(bx + bw, by + bh); }
    else if (V.audienceEdge === "left") { ctx.moveTo(bx, by); ctx.lineTo(bx, by + bh); }
    else { ctx.moveTo(bx + bw, by); ctx.lineTo(bx + bw, by + bh); }
    ctx.stroke();
  }

  ctx.font = "10px ui-monospace, Menlo, monospace";
  ctx.textAlign = "center";
  const L = V.labels;
  const labelColor = (t: string) => (t === "AUDIENCE" ? "#e2a13a" : "#6c7280");
  ctx.fillStyle = labelColor(L.top);
  ctx.fillText(L.top, bx + bw / 2, by - 5);
  ctx.fillStyle = labelColor(L.bottom);
  ctx.fillText(L.bottom, bx + bw / 2, by + bh + 13);
  ctx.save();
  ctx.translate(bx - 5, by + bh / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = labelColor(L.left);
  ctx.fillText(L.left, 0, 0);
  ctx.restore();
  ctx.save();
  ctx.translate(bx + bw + 5, by + bh / 2);
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = labelColor(L.right);
  ctx.fillText(L.right, 0, 0);
  ctx.restore();

  // Which way we're looking
  ctx.textAlign = "left";
  ctx.fillStyle = "#6c7280";
  ctx.fillText(V.caption, 6, 13);

  // Rig outlines
  const selRigIds = new Set(selectedFixtures().map((i) => i.rigId).filter(isPresent));
  for (const rig of state.rigs) {
    ctx.strokeStyle = selRigIds.has(rig.id) ? "#00dddd88" : "#8a93a688";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    rigOutline(rig).forEach((p, k) => {
      const [px, py] = fixturePlan(p);
      if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    });
    ctx.stroke();
  }

  // Named positions: a diamond and the name. Hovered: bigger, with a halo
  // and dashed lines from the fixtures following it.
  const hovered = positionById(ui.hoverPosition);
  if (hovered) {
    const [hx, hy] = fixturePlan(hovered);
    ctx.save();
    ctx.strokeStyle = POSITION_COLOR;
    ctx.globalAlpha = 0.85;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.2;
    for (const f of state.fixtures) {
      if (followingOf(f)?.id !== hovered.id) continue;
      const [fx, fy] = fixturePlan(f);
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(hx, hy); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = POSITION_COLOR;
    ctx.beginPath(); ctx.arc(hx, hy, 16, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  for (const position of state.positions) {
    const [px, py] = fixturePlan(position);
    const on = ui.activePosition === position.id;
    const hover = hovered === position;
    const r = hover ? 9 : on ? 7 : 5;
    ctx.fillStyle = POSITION_COLOR;
    ctx.beginPath(); ctx.moveTo(px, py - r); ctx.lineTo(px + r, py); ctx.lineTo(px, py + r); ctx.lineTo(px - r, py); ctx.closePath(); ctx.fill();
    if (on || hover) { ctx.strokeStyle = "#e8e4dc"; ctx.lineWidth = 1.5; ctx.stroke(); }
    ctx.fillStyle = on || hover ? "#e8e4dc" : POSITION_COLOR;
    ctx.textAlign = "left";
    ctx.font = hover ? "600 13px system-ui, sans-serif" : "11px system-ui, sans-serif";
    ctx.fillText(position.name, px + r + 4, py + 4);
  }

  // Beam axis hit points
  for (const fixture of state.fixtures) {
    const hits = axisHits(fixture, state.box);
    if (!hits.length || look(fixture).intensity <= 0) continue;
    const last = hits[hits.length - 1].point;
    const [px, py] = fixturePlan(fixture);
    const [hx, hy] = fixturePlan(last);
    ctx.strokeStyle = look(fixture).color + "55";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = look(fixture).color;
    ctx.globalAlpha = 0.3 + 0.7 * look(fixture).intensity;
    ctx.beginPath(); ctx.arc(hx, hy, 3, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Fixtures
  for (const fixture of state.fixtures) {
    const [px, py] = fixturePlan(fixture);
    const [da, db] = toAB(beamDir(fixture));
    const sel = state.selected.includes(fixture.id);
    const flat = Math.hypot(da, db);
    const hlen = flat * 22;
    if (hlen > 1) {
      ctx.strokeStyle = look(fixture).color;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + (da / flat) * hlen, py + (db / flat) * hlen); ctx.stroke();
    }
    ctx.fillStyle = "#0c0e11";
    ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = look(fixture).color;
    ctx.globalAlpha = 0.25 + 0.75 * look(fixture).intensity;
    ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    if (sel) {
      ctx.strokeStyle = "#00dddd";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, 10, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = sel ? "#e8e4dc" : "#9a9488";
    ctx.textAlign = "left";
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText(fixture.name, px + 12, py - 8);
  }

  // Placing a position: its preview, with a dotted line along each of this view's
  // two axes across the box, and where it is.
  if ((ui.placingPosition || planDrag?.kind === "position") && positionHover) {
    const [px, py] = fixturePlan(positionHover);
    const [a0, a1] = boxRangeA();
    const [b0, b1] = boxRangeB();
    const [ha, hb] = toAB(positionHover);
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = AXIS_COLORS[V.h];
    const [lx0] = toPlan(Math.min(a0, ha), 0), [lx1] = toPlan(Math.max(a1, ha), 0);
    ctx.beginPath(); ctx.moveTo(lx0, py); ctx.lineTo(lx1, py); ctx.stroke();
    ctx.strokeStyle = AXIS_COLORS[V.v];
    const [, ly0] = toPlan(0, Math.min(b0, hb)), [, ly1] = toPlan(0, Math.max(b1, hb));
    ctx.beginPath(); ctx.moveTo(px, ly0); ctx.lineTo(px, ly1); ctx.stroke();
    ctx.setLineDash([]);
    const r = 7;
    ctx.fillStyle = POSITION_COLOR;
    if (ui.placingPosition) { ctx.beginPath(); ctx.moveTo(px, py - r); ctx.lineTo(px + r, py); ctx.lineTo(px, py + r); ctx.lineTo(px - r, py); ctx.closePath(); ctx.fill(); }
    ctx.font = "11px system-ui, sans-serif";
    const text = describeSpot(positionHover);
    const tw = ctx.measureText(text).width;
    // Keep the label inside the canvas.
    const tx = Math.min(Math.max(4, px + r + 4), size - tw - 4);
    const ty = py - r - 6 < 14 ? py + r + 14 : py - r - 6;
    ctx.fillStyle = "rgba(12, 14, 17, 0.8)";
    ctx.fillRect(tx - 3, ty - 11, tw + 6, 15);
    ctx.fillStyle = POSITION_COLOR;
    ctx.textAlign = "left";
    ctx.fillText(text, tx, ty);
  }

  if (ui.placing || ui.aiming) {
    ctx.fillStyle = ui.aiming ? "#ffffff" : "#00dddd";
    ctx.textAlign = "center";
    ctx.font = "11px system-ui, sans-serif";
    const msg = ui.aiming ? V.aimHint : ui.placingPosition ? V.positionHint : `click inside or outside the box · ${V.placeHint(state.box)}`;
    ctx.fillText(msg, size / 2, size - 8);
  }
}

export function setPlanView(name: string | undefined) {
  if (!isPlanView(name)) return;
  planView = name;
  store(PLAN_VIEW_KEY, name);
  document.querySelectorAll<HTMLElement>("[data-plan-view]").forEach((b) => b.classList.toggle("on", b.dataset.planView === name));
  planDrag = null;
  drawPlan();
}
document.querySelectorAll<HTMLElement>("[data-plan-view]").forEach((b) => {
  b.addEventListener("click", () => { setPlanView(b.dataset.planView); b.blur(); });
});

function planPosition(e: MouseEvent): [number, number] {
  const r = plan.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

/** Fixture under a plan-canvas point (within 14 px), or null. */
function planFixtureAt(px: number, py: number) {
  let best: Fixture | null = null, bestD = 14;
  for (const fixture of state.fixtures) {
    const [ix, iy] = fixturePlan(fixture);
    const d = Math.hypot(ix - px, iy - py);
    if (d < bestD) { bestD = d; best = fixture; }
  }
  return best;
}

/** Named position under a plan-canvas point (within 10 px), or null. */
function planPositionAt(px: number, py: number): StagePosition | null {
  let best: StagePosition | null = null, bestD = 10;
  for (const position of state.positions) {
    const [ix, iy] = fixturePlan(position);
    const d = Math.hypot(ix - px, iy - py);
    if (d < bestD) { bestD = d; best = position; }
  }
  return best;
}

plan.addEventListener("contextmenu", (e) => {
  const fixture = planFixtureAt(...planPosition(e));
  if (!fixture) return;
  e.preventDefault();
  openContextMenu(fixture.id, e.clientX, e.clientY);
});

plan.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const [px, py] = planPosition(e);
  const [a, b] = fromPlan(px, py);
  if (ui.placing && ui.placingPosition) {
    const p = positionSpotAt(a, b);
    positionHover = null;
    addPositionAt(p.x, p.y, p.z);
    return;
  }
  if (ui.placing) {
    const p = { x: 0, y: 0, z: 0, ...pv().placeDefault(state.box) };
    setAB(p, a, b);
    if (ui.placingRig) addRigAt(ui.placingRig, p.x, clamp(p.y, 0, 50), p.z);
    else addFixtureAt(p.x, clamp(p.y, 0, 50), p.z);
    return;
  }
  if (ui.aiming) {
    const p = { x: 0, y: 0, z: 0, ...pv().aimDefault(state.box) };
    setAB(p, a, b);
    applyAim(new THREE.Vector3(p.x, p.y, p.z));
    return;
  }
  const best = planFixtureAt(px, py);
  if (e.altKey && best) { showTrace({ kind: "stageFixture", id: best.id }, e); return; }
  // A position (fixtures win when they overlap): click to pick it out, drag to move it.
  const position = best ? null : planPositionAt(px, py);
  if (position) {
    const [ia, ib] = toAB(position);
    planDrag = { kind: "position", id: position.id, da: ia - a, db: ib - b };
    plan.setPointerCapture(e.pointerId);
    return;
  }
  if (!best) { if (!e.shiftKey) select(null); return; }
  if (e.shiftKey) { select(best.id, true); return; }
  if (!state.selected.includes(best.id)) select(best.id);
  const [ia, ib] = toAB(best);
  planDrag = { kind: "fixture", id: best.id, da: ia - a, db: ib - b };
  plan.setPointerCapture(e.pointerId);
});

// Double-click a rig's fixture: select the whole rig.
plan.addEventListener("dblclick", (e) => {
  if (ui.placing || ui.aiming) return;
  const fixture = planFixtureAt(...planPosition(e));
  if (fixture) selectRigOf(fixture.id);
});

plan.addEventListener("pointermove", (e) => {
  if (ui.placingPosition && !planDrag) {
    positionHover = positionSpotAt(...fromPlan(...planPosition(e)));
    showPositionSpot(describeSpot(positionHover, pv().positionSurface));
    drawPlan();
    return;
  }
  if (!planDrag) {
    // Light up a position under the pointer (fixtures win when they overlap).
    if (!e.buttons && !ui.aiming && !ui.placing) {
      const [px, py] = planPosition(e);
      setHoverPosition(planFixtureAt(px, py) ? null : planPositionAt(px, py)?.id ?? null);
    }
    return;
  }
  const [a, b] = fromPlan(...planPosition(e));
  const snap = e.altKey ? 0.01 : 0.1;
  const s = (v: number) => round(Math.round(v / snap) * snap);
  if (planDrag.kind === "position") {
    const position = positionById(planDrag.id);
    if (!position) return;
    planDrag.moved = true;
    const p = { x: position.x, y: position.y, z: position.z };
    setAB(p, s(a + planDrag.da), s(b + planDrag.db));
    Object.assign(position, { x: clamp(p.x, -100, 100), y: clamp(p.y, 0, 50), z: clamp(p.z, -100, 100) });
    positionHover = { x: position.x, y: position.y, z: position.z };
    showPositionSpot(describeSpot(position), position.name);
    changed({ list: false, inspector: false });
    return;
  }
  const fixture = byId(planDrag.id);
  if (!fixture) return;
  const p = { x: fixture.x, y: fixture.y, z: fixture.z };
  setAB(p, s(a + planDrag.da), s(b + planDrag.db));
  moveFixture(fixture, p.x, clamp(p.y, 0, 50), p.z);
  changed({ list: false });
});

const endDrag = () => {
  const d = planDrag;
  if (!d) return;
  planDrag = null;
  // A position clicked without moving: pick it out (or put it back).
  if (d.kind === "position" && !d.moved) setActivePosition(ui.activePosition === d.id ? null : d.id);
  else if (d.kind === "position") { positionHover = null; showPositionSpot(null, ""); setActivePosition(d.id); changed(); }
  else changed();
};
plan.addEventListener("pointerup", endDrag);
plan.addEventListener("pointerleave", () => {
  if (!planDrag) setHoverPosition(null);
  if (!positionHover) return;
  positionHover = null;
  showPositionSpot(null);
  drawPlan();
});
plan.addEventListener("pointercancel", endDrag);
new ResizeObserver(() => drawPlan()).observe(plan);

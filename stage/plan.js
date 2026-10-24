// The plan view (2D): top, front or side, with dragging and right-click.
import * as THREE from "three";
import { round, beamDir, axisHits, rigOutline } from "./stage-model.js";
import { clamp } from "../shared/numbers.js";
import { state, byId, selectedFixtures, moveFixture, addRigAt, ui } from "./state.js";
import { look, changed, select, applyAim, addFixtureAt, openContextMenu } from "./actions.js";
import { showTrace } from "./stage.js";

// ---------------------------------------------------------------------
// Plan view (2D): top, front (from the audience), or from stage right / left
// ---------------------------------------------------------------------
// Each view maps the world onto canvas axes (a → right, b → down):
//   a = hSign · world[h]      b = vSign · world[v]
// so "up" in the elevations is +y (vSign −1), and the stage-left view
// mirrors z so the audience ends up on its left (hSign −1).

const PLAN_VIEWS = {
  top: {
    h: "x", v: "z", vSign: 1, caption: "top · audience ↓",
    labels: { top: "UPSTAGE", bottom: "AUDIENCE", left: "SR", right: "SL" }, audienceEdge: "bottom",
    placeDefault: (box) => ({ y: box.h - 0.3 }), placeHint: (box) => `height ${round(box.h - 0.3, 1)} m`,
    aimDefault: () => ({ y: 0 }), aimHint: "click a floor spot to aim at",
  },
  front: {
    h: "x", v: "y", vSign: -1, caption: "front · from the audience",
    labels: { top: "CEILING", bottom: "FLOOR", left: "SR", right: "SL" }, audienceEdge: null,
    placeDefault: () => ({ z: 0 }), placeHint: () => "on the center line (z 0)",
    aimDefault: (box) => ({ z: -box.d / 2 }), aimHint: "click a spot on the upstage wall to aim at",
  },
  sr: {
    h: "z", v: "y", vSign: -1, caption: "from stage right · audience →",
    labels: { top: "CEILING", bottom: "FLOOR", left: "UPSTAGE", right: "AUDIENCE" }, audienceEdge: "right",
    placeDefault: () => ({ x: 0 }), placeHint: () => "on the center line (x 0)",
    aimDefault: (box) => ({ x: box.w / 2 }), aimHint: "click a spot on the stage-left wall to aim at",
  },
  sl: {
    h: "z", hSign: -1, v: "y", vSign: -1, caption: "from stage left · ← audience",
    labels: { top: "CEILING", bottom: "FLOOR", left: "AUDIENCE", right: "UPSTAGE" }, audienceEdge: "left",
    placeDefault: () => ({ x: 0 }), placeHint: () => "on the center line (x 0)",
    aimDefault: (box) => ({ x: -box.w / 2 }), aimHint: "click a spot on the stage-right wall to aim at",
  },
};
const PLAN_VIEW_KEY = "unnaturallight.stage.planView";

export let planView = "top";
try {
  const raw = localStorage.getItem(PLAN_VIEW_KEY);
  if (raw && PLAN_VIEWS[raw]) planView = raw;
} catch { /* storage unavailable */ }

const plan = document.getElementById("plan");
const pctx = plan.getContext("2d");
let planFit = null; // { minA, minB, scale }
let planDrag = null;

const pv = () => PLAN_VIEWS[planView];

/** World point (anything with x, y, z) → plan axes [a, b]. */
function toAB(p) {
  const V = pv();
  return [(V.hSign ?? 1) * p[V.h], V.vSign * p[V.v]];
}

/** Write plan axes [a, b] back into a world point / fixture. */
function setAB(p, a, b) {
  const V = pv();
  p[V.h] = (V.hSign ?? 1) * a;
  p[V.v] = V.vSign * b;
}

/** World-axis range of the box. */
function boxRange(axis) {
  const { w, d, h } = state.box;
  return axis === "x" ? [-w / 2, w / 2] : axis === "z" ? [-d / 2, d / 2] : [0, h];
}

/** Box range on the plan's a axis (flipped for the stage-left view). */
function boxRangeA() {
  const V = pv();
  const [lo, hi] = boxRange(V.h);
  return (V.hSign ?? 1) > 0 ? [lo, hi] : [-hi, -lo];
}

/** Box range on the plan's b axis (flipped for elevations). */
function boxRangeB() {
  const V = pv();
  const [lo, hi] = boxRange(V.v);
  return V.vSign > 0 ? [lo, hi] : [-hi, -lo];
}

function computeFit() {
  const { w, d, h } = state.box;
  // Generous margin so there's room to place fixtures outside the box.
  const margin = Math.max(4, Math.max(w, d, h) * 0.6);
  let [minA, maxA] = boxRangeA();
  let [minB, maxB] = boxRangeB();
  minA -= margin; maxA += margin; minB -= margin; maxB += margin;
  for (const i of state.fixtures) {
    const [a, b] = toAB(i);
    minA = Math.min(minA, a - 1); maxA = Math.max(maxA, a + 1);
    minB = Math.min(minB, b - 1); maxB = Math.max(maxB, b + 1);
  }
  const size = plan.clientWidth;
  const span = Math.max(maxA - minA, maxB - minB);
  const ca = (minA + maxA) / 2, cb = (minB + maxB) / 2;
  return { minA: ca - span / 2, minB: cb - span / 2, scale: size / span };
}

const toPlan = (a, b) => [(a - planFit.minA) * planFit.scale, (b - planFit.minB) * planFit.scale];
const fromPlan = (px, py) => [px / planFit.scale + planFit.minA, py / planFit.scale + planFit.minB];
const fixturePlan = (p) => toPlan(...toAB(p));

export function drawPlan() {
  const size = plan.clientWidth;
  if (!size) return;
  const dpr = window.devicePixelRatio || 1;
  if (plan.width !== Math.round(size * dpr)) { plan.width = Math.round(size * dpr); plan.height = Math.round(size * dpr); }
  if (!planDrag) planFit = computeFit();
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
  const bw = (a1 - a0) * planFit.scale, bh = (b1 - b0) * planFit.scale;
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
  const labelColor = (t) => (t === "AUDIENCE" ? "#e2a13a" : "#6c7280");
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
  const selRigIds = new Set(selectedFixtures().map((i) => i.rigId).filter(Boolean));
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

  if (ui.placing || ui.aiming) {
    ctx.fillStyle = ui.aiming ? "#ffffff" : "#00dddd";
    ctx.textAlign = "center";
    ctx.font = "11px system-ui, sans-serif";
    const msg = ui.aiming ? V.aimHint : `click inside or outside the box · ${V.placeHint(state.box)}`;
    ctx.fillText(msg, size / 2, size - 8);
  }
}

export function setPlanView(name) {
  if (!PLAN_VIEWS[name]) return;
  planView = name;
  try { localStorage.setItem(PLAN_VIEW_KEY, name); } catch { /* storage unavailable */ }
  document.querySelectorAll("[data-plan-view]").forEach((b) => b.classList.toggle("on", b.dataset.planView === name));
  planDrag = null;
  drawPlan();
}
document.querySelectorAll("[data-plan-view]").forEach((b) => {
  b.addEventListener("click", () => { setPlanView(b.dataset.planView); b.blur(); });
});

function planPoint(e) {
  const r = plan.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

/** Fixture under a plan-canvas point (within 14 px), or null. */
function planFixtureAt(px, py) {
  let best = null, bestD = 14;
  for (const fixture of state.fixtures) {
    const [ix, iy] = fixturePlan(fixture);
    const d = Math.hypot(ix - px, iy - py);
    if (d < bestD) { bestD = d; best = fixture; }
  }
  return best;
}

plan.addEventListener("contextmenu", (e) => {
  planFit = planFit || computeFit();
  const fixture = planFixtureAt(...planPoint(e));
  if (!fixture) return;
  e.preventDefault();
  openContextMenu(fixture.id, e.clientX, e.clientY);
});

plan.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  planFit = planFit || computeFit();
  const [px, py] = planPoint(e);
  const [a, b] = fromPlan(px, py);
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
  if (!best) { if (!e.shiftKey) select(null); return; }
  if (e.shiftKey) { select(best.id, true); return; }
  if (!state.selected.includes(best.id)) select(best.id);
  const [ia, ib] = toAB(best);
  planDrag = { id: best.id, da: ia - a, db: ib - b };
  plan.setPointerCapture(e.pointerId);
});

plan.addEventListener("pointermove", (e) => {
  if (!planDrag) return;
  const fixture = byId(planDrag.id);
  if (!fixture) return;
  const [a, b] = fromPlan(...planPoint(e));
  const snap = e.altKey ? 0.01 : 0.1;
  const s = (v) => round(Math.round(v / snap) * snap);
  const p = { x: fixture.x, y: fixture.y, z: fixture.z };
  setAB(p, s(a + planDrag.da), s(b + planDrag.db));
  moveFixture(fixture, p.x, clamp(p.y, 0, 50), p.z);
  changed({ list: false });
});

const endDrag = () => { if (planDrag) { planDrag = null; changed(); } };
plan.addEventListener("pointerup", endDrag);
plan.addEventListener("pointercancel", endDrag);
new ResizeObserver(() => drawPlan()).observe(plan);

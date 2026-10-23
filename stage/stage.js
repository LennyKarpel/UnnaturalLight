import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  STORAGE_KEY, MAX_INSTRUMENTS, DEG, FORWARD,
  clamp, round, newId,
  baseQuat, fullQuat, beamDir, defaultTarget, aimZeroAt, setZeroHere, aimAt,
  isInside, axisHits, createInstrument, parseStage, serializeStage,
  SURFACES, TRANSPARENT_OPACITY, DEFAULT_TRANSPARENT,
  RIG_TYPES, PALETTE, applyRig, rigLowestY, rigOutline, normalizeRig,
  DMX_ATTRS, DMX_LABELS, setDmx, setColorHex, deriveFromDmx, homeInstrument,
  rgbFromHex, zoomFromBeam, layoutFor, linkChannels, LAYOUT_PRESETS,
  CONSOLE_TYPES, consoleTypeFromKey, consoleTypeKey, DMX_SHORT,
} from "./stage-model.js";
import { createConsoleLink } from "./console-link.js";
import { createTracePopover } from "../shared/trace.js";

/** @typedef {import("./stage-model.js").Instrument} Instrument */
/** @typedef {import("./stage-model.js").Rig} Rig */

const state = {
  box: { w: 12, d: 8, h: 6 },
  /** @type {Instrument[]} */
  instruments: [],
  /** @type {string[]} */
  selected: [],
  /** Which box sides are transparent (floor is always solid). */
  transparent: { ...DEFAULT_TRANSPARENT },
  /** @type {Rig[]} */
  rigs: [],
};

let placing = false;
/** While placing a rig: its settings from the Place rig dialog (else null). */
let placingRig = null;
let aiming = false;

function loadData(data) {
  const { box, instruments, transparent, rigs } = parseStage(data);
  state.box = box;
  state.transparent = transparent;
  state.rigs = rigs;
  state.instruments = instruments;
  state.selected = instruments.length ? [instruments[0].id] : [];
}

const serialize = () => serializeStage(state.box, state.instruments, state.transparent, state.rigs);

// Flash: while held, the flashed instruments draw white at full intensity.
// Display-only: their saved color / intensity are untouched.
const FLASH_MIN_MS = 150;
const flashing = new Set();
let flashStart = 0;
let flashTimer = 0;

/** What an instrument looks like right now (its own settings, or white/full while flashing). */
const look = (inst) => (flashing.has(inst.id) ? { color: "#ffffff", intensity: 1 } : inst);

function redrawLook() {
  syncScene();
  drawPlan();
  renderHud();
}

/** Flash the selected instruments, or every instrument if none is selected. */
function startFlash() {
  clearTimeout(flashTimer);
  const ids = state.selected.length ? state.selected : state.instruments.map((i) => i.id);
  flashing.clear();
  for (const id of ids) flashing.add(id);
  flashStart = performance.now();
  redrawLook();
}

/** Release; a quick tap still shows for at least FLASH_MIN_MS. */
function stopFlash() {
  if (!flashing.size) return;
  const wait = Math.max(0, FLASH_MIN_MS - (performance.now() - flashStart));
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flashing.clear(); redrawLook(); }, wait);
}

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize())); } catch { /* storage unavailable */ }
  }, 200);
}

function restore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) { loadData(JSON.parse(raw)); return; }
  } catch { /* fall through to demo */ }
  loadData({ box: { w: 12, d: 8, h: 6 } });
  for (const [x, y, z] of [[-3, 5.7, 2.5], [3, 5.7, 2.5], [0, 4.5, 7]]) {
    state.instruments.push(createInstrument(x, y, z, state.instruments.length, state.box));
  }
  state.instruments[2].name = "FOH";
  state.selected = [state.instruments[0].id];
}

const byId = (id) => state.instruments.find((i) => i.id === id);
const selectedInstruments = () => state.selected.map(byId).filter(Boolean);

// ---------------------------------------------------------------------
// Rigs
// ---------------------------------------------------------------------

const escapeHtml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const rigById = (id) => state.rigs.find((r) => r.id === id);
const rigOf = (inst) => (inst?.rigId ? rigById(inst.rigId) : null);
const rigMembers = (rig) => state.instruments.filter((i) => i.rigId === rig.id).sort((a, b) => a.rigIndex - b.rigIndex);
const syncRig = (rig) => applyRig(rig, rigMembers(rig));

/** The rig every selected instrument belongs to, if they all share one. */
function commonRig(sel) {
  const rig = rigOf(sel[0]);
  return rig && sel.every((i) => i.rigId === rig.id) ? rig : null;
}

/**
 * Move an instrument. A rig member can't move on its own, so the whole rig
 * shifts by the same amount instead.
 */
function moveInstrument(inst, x, y, z) {
  const rig = rigOf(inst);
  if (!rig) { inst.x = x; inst.y = y; inst.z = z; return; }
  rig.x = round(rig.x + x - inst.x, 3);
  rig.y = round(rig.y + y - inst.y, 3);
  rig.z = round(rig.z + z - inst.z, 3);
  syncRig(rig);
}

/** Make a member instrument for `rig` at slot `k`, copying the look of `like`. */
function makeRigMember(rig, k, like) {
  const inst = createInstrument(0, 0, 0, state.instruments.length, state.box);
  Object.assign(inst, {
    name: `${rig.name} · ${k + 1}`,
    rigId: rig.id, rigIndex: k,
    panLimit: like.panLimit, tiltLimit: like.tiltLimit, zoomMin: like.zoomMin, zoomMax: like.zoomMax,
  });
  const { dimmer, red, green, blue, zoom } = like.dmx;
  Object.assign(inst.dmx, { dimmer, red, green, blue, zoom });
  deriveFromDmx(inst);
  inst.link.register = rig.consoleType ?? null;
  return inst;
}

/** Create a rig centred at (x, y, z) from the Place rig dialog's settings. */
function addRigAt(cfg, x, y, z) {
  const room = MAX_INSTRUMENTS - state.instruments.length;
  if (cfg.count > room) {
    setPlacing(false);
    setBanner(`Not enough room: this rig needs ${cfg.count} instruments, ${room} left (max ${MAX_INSTRUMENTS})`, 4000);
    return;
  }
  const n = state.rigs.length;
  const sameType = state.rigs.filter((r) => r.type === cfg.type).length;
  const name = `${RIG_TYPES[cfg.type].prefix} ${sameType + 1}`;
  const rig = normalizeRig({ ...cfg, name, x: round(x, 2), y: round(y, 2), z: round(z, 2) }, n);
  // Keep an upright / tilted rig above the floor.
  const low = rigLowestY(rig);
  if (low < PLACE_OFFSET) rig.y = round(rig.y + PLACE_OFFSET - low, 2);
  const [red, green, blue] = rgbFromHex(PALETTE[n % PALETTE.length]);
  const like = {
    dmx: { dimmer: 191, red, green, blue, zoom: zoomFromBeam(24, 5, 60) },
    panLimit: 270, tiltLimit: 135, zoomMin: 5, zoomMax: 60,
  };
  const members = Array.from({ length: rig.count }, (_, k) => makeRigMember(rig, k, like));
  state.rigs.push(rig);
  state.instruments.push(...members);
  syncRig(rig);
  setPlacing(false);
  state.selected = members.map((m) => m.id);
  renderInspector();
  changed();
  requestRegistrations();
}

/** Change how many instruments a rig has; extras copy the first member's look. */
function setRigCount(rig, n) {
  const members = rigMembers(rig);
  const max = MAX_INSTRUMENTS - state.instruments.length + members.length;
  n = clamp(Math.round(n), 2, max);
  if (n === members.length) return;
  if (n < members.length) {
    const dropped = members.slice(n);
    const drop = new Set(dropped.map((m) => m.id));
    state.instruments = state.instruments.filter((i) => !drop.has(i.id));
    state.selected = state.selected.filter((id) => !drop.has(id));
    consoleLink.unregister(dropped.filter((m) => m.link.owned).map((m) => m.link.consoleId));
  } else {
    for (let k = members.length; k < n; k++) state.instruments.push(makeRigMember(rig, k, members[0]));
  }
  rig.count = n;
  syncRig(rig);
  requestRegistrations();
}

function setRigField(rig, k, raw) {
  if (k === "name") {
    rig.name = raw;
    rigMembers(rig).forEach((m, i) => { m.name = `${raw} · ${i + 1}`; });
    return;
  }
  const v = Number(raw);
  if (!Number.isFinite(v)) return;
  if (k === "count") setRigCount(rig, v);
  else if (k === "size") rig.size = clamp(v, 0.5, 50);
  else if (k === "tilt") rig.tilt = clamp(v, -90, 90);
  else if (k === "yaw") rig.yaw = v;
  else if (k === "x" || k === "y" || k === "z") rig[k] = v;
  syncRig(rig);
}

// ---------------------------------------------------------------------
// 3D scene
// ---------------------------------------------------------------------

const view = document.getElementById("view");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x0b0d10);
renderer.localClippingEnabled = true;
view.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
camera.position.set(11, 10, 15);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2, 0);
controls.enableDamping = true;
controls.update();

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
keyLight.position.set(5, 10, 8);
scene.add(keyLight);

const ground = new THREE.GridHelper(80, 80, 0x1c2027, 0x15181d);
ground.position.y = -0.002;
scene.add(ground);

const uniforms = {
  uCount: { value: 0 },
  uPos: { value: Array.from({ length: MAX_INSTRUMENTS }, () => new THREE.Vector3()) },
  uDir: { value: Array.from({ length: MAX_INSTRUMENTS }, () => new THREE.Vector3()) },
  uColor: { value: Array.from({ length: MAX_INSTRUMENTS }, () => new THREE.Vector3()) },
  uCosOuter: { value: new Float32Array(MAX_INSTRUMENTS) },
  uCosInner: { value: new Float32Array(MAX_INSTRUMENTS) },
  uInt: { value: new Float32Array(MAX_INSTRUMENTS) },
  uFaceAlpha: { value: new Float32Array(6) },
  uPass: { value: 0 },
  uAlpha: { value: 0.03 },
};

const vertexShader = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vNormal;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPos = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragmentShader = /* glsl */ `
  #define MAX ${MAX_INSTRUMENTS}
  uniform int uCount;
  uniform vec3 uPos[MAX];
  uniform vec3 uDir[MAX];
  uniform vec3 uColor[MAX];
  uniform float uCosOuter[MAX];
  uniform float uCosInner[MAX];
  uniform float uInt[MAX];
  uniform float uFaceAlpha[6];
  uniform int uPass; // 0 = solid insides, 1 = see-through insides, 2 = outer shell
  uniform float uAlpha;
  varying vec3 vPos;
  varying vec3 vNormal;

  float gridLine(vec2 uv) {
    vec2 g = abs(fract(uv - 0.5) - 0.5) / fwidth(uv);
    return 1.0 - min(min(g.x, g.y), 1.0);
  }

  void main() {
    vec3 n = normalize(vNormal);
    // Which surface this is, from its outward normal (order matches SURFACES).
    int face = abs(n.x) > 0.5 ? (n.x > 0.0 ? 0 : 1) : (abs(n.y) > 0.5 ? (n.y > 0.0 ? 2 : 3) : (n.z > 0.0 ? 4 : 5));
    float fa = uFaceAlpha[face];
    bool solid = fa >= 0.999;
    if (uPass == 0 && !solid) discard;
    if (uPass == 1 && solid) discard;

    vec3 light = vec3(0.0);
    float edge = 0.0;
    for (int i = 0; i < MAX; i++) {
      if (i >= uCount) break;
      vec3 v = vPos - uPos[i];
      float d = max(length(v), 1e-4);
      vec3 L = v / d;
      float c = dot(L, uDir[i]);
      if (c < uCosOuter[i]) continue;
      float cone = smoothstep(uCosOuter[i], uCosInner[i], c);
      float lambert = abs(dot(n, L));
      float att = 1.0 / (1.0 + 0.012 * d * d);
      light += uColor[i] * uInt[i] * cone * (0.35 + 0.65 * lambert) * att * 2.4;
      // thin bright rim where the cone boundary crosses the surface
      float w = fwidth(c) * 1.5;
      edge += uInt[i] * (1.0 - smoothstep(0.0, w, abs(c - uCosOuter[i] - w)));
    }

    vec2 uv = abs(n.x) > 0.5 ? vPos.zy : (abs(n.y) > 0.5 ? vPos.xz : vPos.xy);
    float grid = gridLine(uv);
    vec3 base = vec3(0.075, 0.08, 0.095) + grid * 0.06;
    vec3 col = base + light * 0.85 + vec3(edge) * 0.25;
    col = 1.0 - exp(-col * 1.4);

    float lum = dot(light, vec3(0.3, 0.5, 0.2));
    float a;
    if (uPass == 0) a = 1.0;
    else if (uPass == 1) a = clamp(fa + lum * 0.55 + edge * 0.2 + grid * 0.05 * (1.0 - fa), 0.0, 1.0);
    else a = clamp(uAlpha + lum * 0.55 + edge * 0.2 + grid * 0.03, 0.0, 0.85);
    gl_FragColor = vec4(col, a);
  }
`;

// The box is drawn in three passes over the same geometry:
//   inner, solid sides: opaque pass, hide what's behind them
//   inner, transparent sides (View settings): blended, faint
//   outer shell (near walls seen from outside): always faint so you can see in
// Light patches add opacity, so beams stay visible on see-through surfaces.
const passMaterial = (pass, opts) => {
  const m = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uPass: { value: pass } },
    vertexShader, fragmentShader, ...opts,
  });
  m.extensions = { derivatives: true };
  return m;
};
const innerMat = passMaterial(0, { side: THREE.BackSide });
const innerSeeMat = passMaterial(1, { side: THREE.BackSide, transparent: true, depthWrite: false });
const outerMat = passMaterial(2, { side: THREE.FrontSide, transparent: true, depthWrite: false });

const boxGeom = new THREE.BoxGeometry(1, 1, 1);
const boxInner = new THREE.Mesh(boxGeom, innerMat);
const boxInnerSee = new THREE.Mesh(boxGeom, innerSeeMat);
boxInnerSee.renderOrder = 1;
const boxOuter = new THREE.Mesh(boxGeom, outerMat);
boxOuter.renderOrder = 2;
const boxEdges = new THREE.LineSegments(
  new THREE.EdgesGeometry(boxGeom),
  new THREE.LineBasicMaterial({ color: 0x4a5160 }),
);
const boxGroup = new THREE.Group();
boxGroup.add(boxInner, boxInnerSee, boxOuter, boxEdges);

function updateSurfaces() {
  SURFACES.forEach(({ key, alwaysSolid }, i) => {
    uniforms.uFaceAlpha.value[i] = !alwaysSolid && state.transparent[key] ? TRANSPARENT_OPACITY : 1;
  });
}
scene.add(boxGroup);

// Downstage marker so orientation is obvious in 3D.
const audienceMarker = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 0.25),
  new THREE.MeshBasicMaterial({ color: 0xe2a13a, transparent: true, opacity: 0.6 }),
);
audienceMarker.rotation.x = -Math.PI / 2;
scene.add(audienceMarker);

// Box walls as clipping planes (normals point inward: keep the inside).
const wallPlanes = Array.from({ length: 6 }, () => new THREE.Plane());

function updateBox() {
  const { w, d, h } = state.box;
  wallPlanes[0].set(new THREE.Vector3(1, 0, 0), w / 2);
  wallPlanes[1].set(new THREE.Vector3(-1, 0, 0), w / 2);
  wallPlanes[2].set(new THREE.Vector3(0, 1, 0), 0);
  wallPlanes[3].set(new THREE.Vector3(0, -1, 0), h);
  wallPlanes[4].set(new THREE.Vector3(0, 0, 1), d / 2);
  wallPlanes[5].set(new THREE.Vector3(0, 0, -1), d / 2);
  boxGroup.scale.set(w, h, d);
  boxGroup.position.set(0, h / 2, 0);
  audienceMarker.scale.set(w * 0.5, 1, 1);
  audienceMarker.position.set(0, 0.001, d / 2 + 0.35);
}

// Unit cone: apex at origin, opening along −Z, base radius 1 at z = −1.
const coneGeom = new THREE.ConeGeometry(1, 1, 48, 1, true);
coneGeom.translate(0, -0.5, 0);
coneGeom.rotateX(Math.PI / 2);

const bodyGeom = new THREE.CylinderGeometry(0.11, 0.15, 0.36, 20);
bodyGeom.rotateX(Math.PI / 2);
const lensGeom = new THREE.CircleGeometry(0.1, 20);
lensGeom.rotateY(Math.PI);
lensGeom.translate(0, 0, -0.181);
const ringGeom = new THREE.TorusGeometry(0.28, 0.02, 8, 40);
const pickGeom = new THREE.SphereGeometry(0.4, 12, 8);

// Place-mode preview: where the next instrument will land.
const ghost = new THREE.Mesh(
  new THREE.SphereGeometry(0.18, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0x00dddd, transparent: true, opacity: 0.8, depthTest: false }),
);
ghost.renderOrder = 10;
const ghostStem = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
  new THREE.LineDashedMaterial({ color: 0x00dddd, dashSize: 0.12, gapSize: 0.08, depthTest: false }),
);
ghostStem.renderOrder = 10;
ghost.visible = ghostStem.visible = false;
scene.add(ghost, ghostStem);

// Rig outlines (ring, square or line), rebuilt from the rig's shape.
/** @type {Map<string, THREE.Line>} */
const rigVisuals = new Map();
const rigGhost = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x00dddd, depthTest: false }));
rigGhost.renderOrder = 10;
rigGhost.visible = false;
scene.add(rigGhost);

/** Redraw a line object as the outline of a rig (or rig-like settings). */
function setOutline(line, rig) {
  line.geometry.dispose();
  line.geometry = new THREE.BufferGeometry().setFromPoints(rigOutline(rig));
}

// Aim-mode preview: target marker + a line from each selected instrument.
const aimMarker = new THREE.Mesh(
  new THREE.TorusGeometry(0.25, 0.03, 8, 32),
  new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
);
aimMarker.renderOrder = 10;
const aimLines = new THREE.LineSegments(
  new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_INSTRUMENTS * 6), 3)),
  new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.2, gapSize: 0.12, transparent: true, opacity: 0.8, depthTest: false }),
);
aimLines.renderOrder = 10;
aimMarker.visible = aimLines.visible = false;
scene.add(aimMarker, aimLines);

/** @type {Map<string, {group: THREE.Group, aim: THREE.Group, body: THREE.Mesh, lens: THREE.Mesh, cone: THREE.Mesh, ring: THREE.Mesh, zero: THREE.Group, axis: THREE.Line, pick: THREE.Mesh}>} */
const visuals = new Map();

function makeVisual(inst) {
  const group = new THREE.Group();
  const aim = new THREE.Group();
  const body = new THREE.Mesh(bodyGeom, new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.6, metalness: 0.4 }));
  const lens = new THREE.Mesh(lensGeom, new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const cone = new THREE.Mesh(coneGeom, new THREE.MeshBasicMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  cone.renderOrder = 3;
  aim.add(body, lens, cone);

  // Invisible sphere: a bigger target than the fixture itself for click / drag.
  const pick = new THREE.Mesh(pickGeom, new THREE.MeshBasicMaterial({ visible: false }));
  pick.userData.instId = inst.id;

  const ring = new THREE.Mesh(ringGeom, new THREE.MeshBasicMaterial({ color: 0x00dddd }));
  ring.rotation.x = Math.PI / 2;

  // Zero frame: dashed "home" forward + short "up" tick (what ↑ means).
  const zero = new THREE.Group();
  const fwd = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1.4)]),
    new THREE.LineDashedMaterial({ color: 0x00dddd, dashSize: 0.1, gapSize: 0.07 }),
  );
  fwd.computeLineDistances();
  const up = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.5, 0)]),
    new THREE.LineBasicMaterial({ color: 0x00dddd }),
  );
  zero.add(fwd, up);

  const axis = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.15, gapSize: 0.1, transparent: true, opacity: 0.5 }),
  );

  group.add(aim, ring, zero, pick);
  scene.add(group, axis);
  const v = { group, aim, body, lens, cone, ring, zero, axis, pick };
  visuals.set(inst.id, v);
  return v;
}

function syncScene() {
  const ids = new Set(state.instruments.map((i) => i.id));
  for (const [id, v] of visuals) {
    if (!ids.has(id)) {
      scene.remove(v.group, v.axis);
      visuals.delete(id);
    }
  }
  const rigIds = new Set(state.rigs.map((r) => r.id));
  for (const [id, line] of rigVisuals) {
    if (!rigIds.has(id)) { scene.remove(line); rigVisuals.delete(id); }
  }
  const selRigs = new Set(selectedInstruments().map((i) => i.rigId).filter(Boolean));
  for (const rig of state.rigs) {
    let line = rigVisuals.get(rig.id);
    if (!line) {
      line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x8a93a6 }));
      rigVisuals.set(rig.id, line);
      scene.add(line);
    }
    setOutline(line, rig);
    line.material.color.set(selRigs.has(rig.id) ? 0x00dddd : 0x8a93a6);
  }

  const { w, d, h } = state.box;
  const diag = Math.hypot(w, d, h);
  uniforms.uCount.value = state.instruments.length;

  state.instruments.forEach((inst, i) => {
    const v = visuals.get(inst.id) || makeVisual(inst);
    const q = fullQuat(inst);
    const dir = FORWARD.clone().applyQuaternion(q);
    const lk = look(inst);
    const color = new THREE.Color(lk.color);
    const sel = state.selected.includes(inst.id);

    v.group.position.set(inst.x, inst.y, inst.z);
    v.aim.quaternion.copy(q);
    v.zero.quaternion.copy(baseQuat(inst));
    v.zero.visible = sel;
    v.ring.visible = sel;

    const hits = axisHits(inst, state.box);
    const len = hits.length ? hits[hits.length - 1].t : diag * 0.6;
    // The visible cone is drawn long and clipped by every wall the
    // instrument is on the inside of, so it ends exactly where it lands
    // on the walls (an outside instrument's beam passes in through the
    // near wall and stops at the far ones).
    const p = new THREE.Vector3(inst.x, inst.y, inst.z);
    const coneLen = p.length() + diag * 1.5;
    const coneR = Math.tan((inst.beam / 2) * DEG) * coneLen;
    v.cone.scale.set(coneR, coneR, coneLen);
    v.cone.material.clippingPlanes = wallPlanes.filter((pl) => pl.distanceToPoint(p) >= -1e-3);
    v.cone.material.color.copy(color);
    v.cone.material.opacity = 0.06 + 0.16 * lk.intensity;
    v.cone.visible = lk.intensity > 0.001;
    v.lens.material.color.copy(color).multiplyScalar(0.25 + 0.75 * lk.intensity);

    const pts = v.axis.geometry.attributes.position;
    pts.setXYZ(0, inst.x, inst.y, inst.z);
    const end = new THREE.Vector3(inst.x, inst.y, inst.z).addScaledVector(dir, len);
    pts.setXYZ(1, end.x, end.y, end.z);
    pts.needsUpdate = true;
    v.axis.computeLineDistances();
    v.axis.visible = sel;

    uniforms.uPos.value[i].set(inst.x, inst.y, inst.z);
    uniforms.uDir.value[i].copy(dir);
    uniforms.uColor.value[i].set(color.r, color.g, color.b);
    uniforms.uCosOuter.value[i] = Math.cos((inst.beam / 2) * DEG);
    uniforms.uCosInner.value[i] = Math.cos((inst.beam / 2) * 0.82 * DEG);
    uniforms.uInt.value[i] = lk.intensity;
  });
}

function resize() {
  const { clientWidth: w, clientHeight: h } = view;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(view);

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

// 3D picking, placing and dragging.
//   click instrument      select (⇧ adds/removes)
//   drag instrument       slide it horizontally at its current height
//   ⇧-drag instrument     raise / lower it
//   drag empty space      orbit (OrbitControls)
// Listeners sit on the parent in the capture phase so we can switch
// OrbitControls off before it sees a press that lands on an instrument.
const raycaster = new THREE.Raycaster();
const DRAG_THRESHOLD = 4;
let downAt = null;
/** @type {null | { id: string, shift: boolean, active: boolean, plane: THREE.Plane, offset: THREE.Vector3 }} */
let drag3d = null;

function rayFromEvent(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray;
}

function pickInstrument(e) {
  rayFromEvent(e);
  const targets = [...visuals.values()].map((v) => v.pick);
  return raycaster.intersectObjects(targets)[0]?.object.userData.instId ?? null;
}

/** Horizontal plane through the instrument, or (⇧) a vertical one facing the camera. */
function dragPlane(inst, vertical) {
  const p = new THREE.Vector3(inst.x, inst.y, inst.z);
  if (!vertical) return new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), p);
  const n = new THREE.Vector3();
  camera.getWorldDirection(n);
  n.y = 0;
  if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
  return new THREE.Plane().setFromNormalAndCoplanarPoint(n.normalize(), p);
}

const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const PLACE_OFFSET = 0.3;

/**
 * Where a place-mode click puts the new instrument (uses the current ray).
 *   click a wall/floor/ceiling   on its inside surface
 *   ⌥-click a wall               on the outside of the nearest wall
 *   click the ground off the box  standing on the ground, outside
 */
function placePoint(outside) {
  const snap = (p) => p.set(round(p.x, 1), round(p.y, 1), round(p.z, 1));
  if (outside) {
    const hit = raycaster.intersectObject(boxOuter)[0];
    if (hit) return snap(hit.point.clone().addScaledVector(hit.face.normal, PLACE_OFFSET));
  }
  const inner = raycaster.intersectObject(boxInner)[0];
  if (inner) return snap(inner.point.clone().addScaledVector(inner.face.normal, -PLACE_OFFSET));
  const g = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
  if (!g || Math.hypot(g.x, g.z) > 100) return null;
  return snap(g.setY(PLACE_OFFSET));
}

function updateGhost(e) {
  const p = placing && e ? (rayFromEvent(e), placePoint(e.altKey)) : null;
  ghost.visible = ghostStem.visible = !!p;
  rigGhost.visible = !!p && !!placingRig;
  if (!p) return;
  if (placingRig) {
    const preview = { ...placingRig, x: p.x, y: p.y, z: p.z };
    const low = rigLowestY(preview);
    if (low < PLACE_OFFSET) { preview.y += PLACE_OFFSET - low; p.y = preview.y; }
    setOutline(rigGhost, preview);
  }
  ghost.position.copy(p);
  const inside = isInside({ x: p.x, y: p.y, z: p.z }, state.box);
  ghost.material.color.set(inside ? 0x00dddd : 0xe2a13a);
  ghostStem.material.color.copy(ghost.material.color);
  const pts = ghostStem.geometry.attributes.position;
  pts.setXYZ(0, p.x, p.y, p.z);
  pts.setXYZ(1, p.x, 0, p.z);
  pts.needsUpdate = true;
  ghostStem.computeLineDistances();
}

/** Aim target under the pointer (uses the current ray): a box surface, else the ground. */
function aimPoint() {
  const hit = raycaster.intersectObject(boxInner)[0];
  if (hit) return hit.point.clone();
  const g = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
  return g && Math.hypot(g.x, g.z) <= 100 ? g : null;
}

/** Show the aim marker at `p` (or hide it) with lines from the selected instruments. */
function showAimPreview(p) {
  aimMarker.visible = aimLines.visible = !!p;
  if (!p) return;
  aimMarker.position.copy(p);
  // Face the camera so the ring always reads as a target.
  aimMarker.quaternion.copy(camera.quaternion);
  const pts = aimLines.geometry.attributes.position;
  const sel = selectedInstruments();
  sel.forEach((inst, k) => {
    pts.setXYZ(k * 2, inst.x, inst.y, inst.z);
    pts.setXYZ(k * 2 + 1, p.x, p.y, p.z);
  });
  pts.needsUpdate = true;
  aimLines.geometry.setDrawRange(0, sel.length * 2);
  aimLines.geometry.computeBoundingSphere();
  aimLines.computeLineDistances();
}

view.addEventListener("pointerdown", (e) => {
  if (e.target !== renderer.domElement || e.button !== 0) return;
  downAt = { x: e.clientX, y: e.clientY };
  if (placing || aiming) return;
  const id = pickInstrument(e);
  if (!id) return;
  const inst = byId(id);
  const plane = dragPlane(inst, e.shiftKey);
  const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  const offset = hit ? new THREE.Vector3(inst.x, inst.y, inst.z).sub(hit) : new THREE.Vector3();
  drag3d = { id, shift: e.shiftKey, active: false, plane, offset };
  controls.enabled = false;
  renderer.domElement.setPointerCapture(e.pointerId);
}, true);

view.addEventListener("pointermove", (e) => {
  if (e.target !== renderer.domElement) return;
  if (!drag3d) {
    if (placing) updateGhost(e);
    else if (aiming) { rayFromEvent(e); showAimPreview(aimPoint()); }
    else if (!e.buttons) renderer.domElement.style.cursor = pickInstrument(e) ? "grab" : "";
    return;
  }
  if (!drag3d.active) {
    if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) <= DRAG_THRESHOLD) return;
    drag3d.active = true;
    if (!state.selected.includes(drag3d.id)) select(drag3d.id);
    renderer.domElement.style.cursor = "grabbing";
  }
  const inst = byId(drag3d.id);
  if (!inst) return;
  const hit = rayFromEvent(e).intersectPlane(drag3d.plane, new THREE.Vector3());
  if (!hit) return;
  hit.add(drag3d.offset);
  const snap = e.altKey ? 0.01 : 0.1;
  const s = (v) => round(Math.round(v / snap) * snap);
  if (drag3d.shift) {
    moveInstrument(inst, inst.x, clamp(s(hit.y), 0, 50), inst.z);
  } else {
    // Keep the camera from flinging it off to the horizon at grazing angles.
    moveInstrument(inst, clamp(s(hit.x), -100, 100), inst.y, clamp(s(hit.z), -100, 100));
  }
  changed({ list: false });
}, true);

renderer.domElement.addEventListener("pointerleave", () => { updateGhost(null); showAimPreview(null); });

let rightDownAt = null;
view.addEventListener("pointerdown", (e) => {
  if (e.target === renderer.domElement && e.button === 2) rightDownAt = { x: e.clientX, y: e.clientY };
}, true);
view.addEventListener("contextmenu", (e) => {
  if (e.target !== renderer.domElement) return;
  e.preventDefault();
  // ctrl-click (Mac) has no right-button press; treat it as a still click.
  const still = rightDownAt ? Math.hypot(e.clientX - rightDownAt.x, e.clientY - rightDownAt.y) <= DRAG_THRESHOLD : e.ctrlKey;
  rightDownAt = null;
  if (!still || placing || aiming) return;
  const id = pickInstrument(e);
  if (id) openContextMenu(id, e.clientX, e.clientY);
}, true);

view.addEventListener("pointerup", (e) => {
  if (e.target !== renderer.domElement || e.button !== 0) return;
  const moved = downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > DRAG_THRESHOLD;
  const d = drag3d;
  drag3d = null;
  controls.enabled = true;
  if (d) {
    renderer.domElement.style.cursor = "grab";
    if (d.active) changed();
    else if (e.altKey) showTrace({ kind: "light", id: d.id }, e);
    else select(d.id, d.shift);
    return;
  }
  if (!downAt || moved) return;
  rayFromEvent(e);

  if (placing) {
    const p = placePoint(e.altKey);
    if (p) (placingRig ? addRigAt(placingRig, p.x, p.y, p.z) : addInstrumentAt(p.x, p.y, p.z));
    return;
  }
  if (aiming) {
    const p = aimPoint();
    if (p) applyAim(p);
    return;
  }
  if (!e.shiftKey) select(null);
}, true);

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
    placeDefault: () => ({ z: 0 }), placeHint: () => "on the centre line (z 0)",
    aimDefault: (box) => ({ z: -box.d / 2 }), aimHint: "click a spot on the upstage wall to aim at",
  },
  sr: {
    h: "z", v: "y", vSign: -1, caption: "from stage right · audience →",
    labels: { top: "CEILING", bottom: "FLOOR", left: "UPSTAGE", right: "AUDIENCE" }, audienceEdge: "right",
    placeDefault: () => ({ x: 0 }), placeHint: () => "on the centre line (x 0)",
    aimDefault: (box) => ({ x: box.w / 2 }), aimHint: "click a spot on the stage-left wall to aim at",
  },
  sl: {
    h: "z", hSign: -1, v: "y", vSign: -1, caption: "from stage left · ← audience",
    labels: { top: "CEILING", bottom: "FLOOR", left: "AUDIENCE", right: "UPSTAGE" }, audienceEdge: "left",
    placeDefault: () => ({ x: 0 }), placeHint: () => "on the centre line (x 0)",
    aimDefault: (box) => ({ x: -box.w / 2 }), aimHint: "click a spot on the stage-right wall to aim at",
  },
};
// Older pages saved the stage-right view as "side".
const PLAN_VIEW_ALIASES = { side: "sr" };
const PLAN_VIEW_KEY = "unnaturallight.stage.planView";

let planView = "top";
try {
  const raw = localStorage.getItem(PLAN_VIEW_KEY);
  const v = PLAN_VIEW_ALIASES[raw] ?? raw;
  if (v && PLAN_VIEWS[v]) planView = v;
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

/** Write plan axes [a, b] back into a world point / instrument. */
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
  // Generous margin so there's room to place instruments outside the box.
  const margin = Math.max(4, Math.max(w, d, h) * 0.6);
  let [minA, maxA] = boxRangeA();
  let [minB, maxB] = boxRangeB();
  minA -= margin; maxA += margin; minB -= margin; maxB += margin;
  for (const i of state.instruments) {
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
const instPlan = (p) => toPlan(...toAB(p));

function drawPlan() {
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
  const selRigIds = new Set(selectedInstruments().map((i) => i.rigId).filter(Boolean));
  for (const rig of state.rigs) {
    ctx.strokeStyle = selRigIds.has(rig.id) ? "#00dddd88" : "#8a93a688";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    rigOutline(rig).forEach((p, k) => {
      const [px, py] = instPlan(p);
      if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    });
    ctx.stroke();
  }

  // Beam axis hit points
  for (const inst of state.instruments) {
    const hits = axisHits(inst, state.box);
    if (!hits.length || look(inst).intensity <= 0) continue;
    const last = hits[hits.length - 1].point;
    const [px, py] = instPlan(inst);
    const [hx, hy] = instPlan(last);
    ctx.strokeStyle = look(inst).color + "55";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = look(inst).color;
    ctx.globalAlpha = 0.3 + 0.7 * look(inst).intensity;
    ctx.beginPath(); ctx.arc(hx, hy, 3, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Instruments
  for (const inst of state.instruments) {
    const [px, py] = instPlan(inst);
    const [da, db] = toAB(beamDir(inst));
    const sel = state.selected.includes(inst.id);
    const flat = Math.hypot(da, db);
    const hlen = flat * 22;
    if (hlen > 1) {
      ctx.strokeStyle = look(inst).color;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + (da / flat) * hlen, py + (db / flat) * hlen); ctx.stroke();
    }
    ctx.fillStyle = "#0c0e11";
    ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = look(inst).color;
    ctx.globalAlpha = 0.25 + 0.75 * look(inst).intensity;
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
    ctx.fillText(inst.name, px + 12, py - 8);
  }

  if (placing || aiming) {
    ctx.fillStyle = aiming ? "#ffffff" : "#00dddd";
    ctx.textAlign = "center";
    ctx.font = "11px system-ui, sans-serif";
    const msg = aiming ? V.aimHint : `click inside or outside the box · ${V.placeHint(state.box)}`;
    ctx.fillText(msg, size / 2, size - 8);
  }
}

function setPlanView(name) {
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

/** Instrument under a plan-canvas point (within 14 px), or null. */
function planInstrumentAt(px, py) {
  let best = null, bestD = 14;
  for (const inst of state.instruments) {
    const [ix, iy] = instPlan(inst);
    const d = Math.hypot(ix - px, iy - py);
    if (d < bestD) { bestD = d; best = inst; }
  }
  return best;
}

plan.addEventListener("contextmenu", (e) => {
  planFit = planFit || computeFit();
  const inst = planInstrumentAt(...planPoint(e));
  if (!inst) return;
  e.preventDefault();
  openContextMenu(inst.id, e.clientX, e.clientY);
});

plan.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  planFit = planFit || computeFit();
  const [px, py] = planPoint(e);
  const [a, b] = fromPlan(px, py);
  if (placing) {
    const p = { x: 0, y: 0, z: 0, ...pv().placeDefault(state.box) };
    setAB(p, a, b);
    if (placingRig) addRigAt(placingRig, p.x, clamp(p.y, 0, 50), p.z);
    else addInstrumentAt(p.x, clamp(p.y, 0, 50), p.z);
    return;
  }
  if (aiming) {
    const p = { x: 0, y: 0, z: 0, ...pv().aimDefault(state.box) };
    setAB(p, a, b);
    applyAim(new THREE.Vector3(p.x, p.y, p.z));
    return;
  }
  const best = planInstrumentAt(px, py);
  if (e.altKey && best) { showTrace({ kind: "light", id: best.id }, e); return; }
  if (!best) { if (!e.shiftKey) select(null); return; }
  if (e.shiftKey) { select(best.id, true); return; }
  if (!state.selected.includes(best.id)) select(best.id);
  const [ia, ib] = toAB(best);
  planDrag = { id: best.id, da: ia - a, db: ib - b };
  plan.setPointerCapture(e.pointerId);
});

plan.addEventListener("pointermove", (e) => {
  if (!planDrag) return;
  const inst = byId(planDrag.id);
  if (!inst) return;
  const [a, b] = fromPlan(...planPoint(e));
  const snap = e.altKey ? 0.01 : 0.1;
  const s = (v) => round(Math.round(v / snap) * snap);
  const p = { x: inst.x, y: inst.y, z: inst.z };
  setAB(p, s(a + planDrag.da), s(b + planDrag.db));
  moveInstrument(inst, p.x, clamp(p.y, 0, 50), p.z);
  changed({ list: false });
});

const endDrag = () => { if (planDrag) { planDrag = null; changed(); } };
plan.addEventListener("pointerup", endDrag);
plan.addEventListener("pointercancel", endDrag);
new ResizeObserver(() => drawPlan()).observe(plan);

// ---------------------------------------------------------------------
// Sidebar: list + inspector
// ---------------------------------------------------------------------

const listEl = document.getElementById("list");
const inspectorEl = document.getElementById("inspector");
const hudEl = document.getElementById("hud");

function renderList() {
  document.getElementById("count").textContent = `${state.instruments.length} / ${MAX_INSTRUMENTS}`;
  if (!state.instruments.length) {
    listEl.innerHTML = `<div class="empty">None yet — press <kbd>A</kbd> or “+ Place instrument”.</div>`;
    return;
  }
  listEl.innerHTML = "";
  for (const inst of state.instruments) {
    const row = document.createElement("div");
    row.className = "item" + (state.selected.includes(inst.id) ? " sel" : "");
    row.innerHTML = `
      <span class="swatch" style="background:${inst.color}"></span>
      <span></span>
      <div class="bar"><div style="width:${Math.round(inst.intensity * 100)}%"></div></div>
      <span class="pct" title="Dimmer (0–255)">${inst.dmx.dimmer}</span>`;
    row.children[1].textContent = inst.name + (isInside(inst, state.box) ? "" : "  ·  outside");
    row.addEventListener("click", (e) => (e.altKey ? showTrace({ kind: "light", id: inst.id }, e) : select(inst.id, e.shiftKey)));
    row.addEventListener("contextmenu", (e) => { e.preventDefault(); openContextMenu(inst.id, e.clientX, e.clientY); });
    listEl.append(row);
  }
}

/** Inspector block for editing a rig (shown when the selection is all one rig). */
function rigSectionHtml(rig) {
  return `
    <div class="fields rig-fields">
      <div class="subhead">Rig · ${RIG_TYPES[rig.type].name}</div>
      <label>Rig name</label><input type="text" data-r="name" />
      <label>Centre</label>
      <div class="xyz">
        <input type="number" step="0.1" data-r="x" title="x (− SR · + SL)" />
        <input type="number" step="0.1" data-r="y" title="height" />
        <input type="number" step="0.1" data-r="z" title="z (− upstage · + audience)" />
      </div>
      <label>${RIG_TYPES[rig.type].sizeLabel} m</label><input type="number" min="0.5" max="50" step="0.1" data-r="size" />
      <label>Instruments</label><input type="number" min="2" max="${MAX_INSTRUMENTS}" step="1" data-r="count" />
      <label>Tilt / Yaw °</label>
      <div class="xyz">
        <input type="number" min="-90" max="90" step="5" data-r="tilt" title="tilt: 0 = flat, 90 = upright facing the audience" />
        <input type="number" step="5" data-r="yaw" title="yaw: turn about the vertical" />
      </div>
    </div>`;
}

/** Rebuild the inspector for the current selection (none, one, or several). */
function renderInspector() {
  const sel = selectedInstruments();
  if (!sel.length) {
    inspectorEl.innerHTML = `<h2>Inspector</h2><div class="empty">Select an instrument.</div>`;
    return;
  }
  if (sel.length > 1) {
    inspectorEl.innerHTML = `
      <h2>Inspector <span>${sel.length} selected</span></h2>
      <div class="fields">
        <label>Dimmer</label>
        <div class="slider"><input type="range" min="0" max="255" step="1" data-multi="dimmer" /><input type="number" min="0" max="255" data-multi="dimmer" /></div>
        <label>Color</label>
        <input type="color" data-multi="color" />
      </div>
      <p class="hint">Sets every selected instrument. Arrow keys, +/− and [ ] step each one's own 0–255 values (⇧ = 10).</p>
      ${commonRig(sel) ? rigSectionHtml(commonRig(sel)) + rigLinkHtml() : ""}
      <div class="buttons">
        <button data-flash class="flash" title="Hold to flash white at full intensity (F)">Flash</button>
        <button data-act="aimSpot" title="Point all selected beams at one spot (T)">Aim at spot</button>
        <button data-act="home">Home all</button>
        <button data-act="zero">Set zero here (all)</button>
        <button data-act="aim">Aim zero at stage</button>
        <button data-act="del" class="danger" title="Delete all selected (⌫ or right-click) · ⌘Z to undo">Delete all</button>
      </div>`;
    bindInspector();
    syncInspector();
    return;
  }
  const rig = rigOf(sel[0]);
  const lock = rig ? 'disabled title="Set by the rig"' : "";
  inspectorEl.innerHTML = `
    <h2>Inspector${rig ? ` <span>in ${escapeHtml(rig.name)}</span>` : ""}</h2>
    <div class="fields">
      <label>Name</label><input type="text" data-k="name" />
      <label>Position</label>
      <div class="xyz">
        <input type="number" step="0.1" data-k="x" title="x (− SR · + SL)" ${lock} />
        <input type="number" step="0.1" data-k="y" title="height" ${lock} />
        <input type="number" step="0.1" data-k="z" title="z (− upstage · + audience)" ${lock} />
      </div>
      <label></label><div class="hint" style="margin:0">x · height · z (m)${rig ? " · set by the rig (drag to move the whole rig)" : ""}</div>

      <div class="subhead">DMX values · 0–255</div>
      ${DMX_ATTRS.map((a) => `
      <label>${DMX_LABELS[a]}</label>
      <div class="dmx-row">
        <input type="range" min="0" max="255" step="1" data-d="${a}" />
        <input type="number" min="0" max="255" step="1" data-d="${a}" />
        <span class="dmx-note" data-note="${a}"></span>
      </div>`).join("")}
      <label>Color</label>
      <input type="color" data-k="color" title="Sets red / green / blue" />

      <div class="subhead">Ranges (what 0 and 255 mean)</div>
      <label>Pan / Tilt ±°</label>
      <div class="xyz">
        <input type="number" min="0" max="360" step="5" data-k="panLimit" title="pan: 0 = −limit, 128 = zero, 255 = +limit" />
        <input type="number" min="0" max="180" step="5" data-k="tiltLimit" title="tilt: 0 = −limit, 128 = zero, 255 = +limit" />
      </div>
      <label>Zoom °</label>
      <div class="xyz">
        <input type="number" min="1" max="120" step="1" data-k="zoomMin" title="beam angle at zoom 0" />
        <input type="number" min="1" max="120" step="1" data-k="zoomMax" title="beam angle at zoom 255" />
      </div>

      <div class="subhead">Zero frame (world)</div>
      <label>Yaw/Pitch/Roll</label>
      <div class="xyz">
        <input type="number" step="1" data-k="base.yaw" title="yaw ° (0 = facing upstage, +90 = facing stage right)" ${lock} />
        <input type="number" step="1" data-k="base.pitch" title="pitch ° (−90 = straight down)" ${lock} />
        <input type="number" step="1" data-k="base.roll" title="roll ° (which way is 'up' for the arrow keys)" ${lock} />
      </div>
      <div class="readout" id="readout"></div>
    </div>
    ${linkSectionHtml(sel[0])}
    ${rig ? rigSectionHtml(rig) + rigLinkHtml() : ""}
    <div class="buttons">
      <button data-flash class="flash" title="Hold to flash white at full intensity (F)">Flash</button>
      <button data-act="aimSpot" title="Point the beam at a spot you click (T)">Aim at spot</button>
      <button data-act="home" title="Pan/tilt back to 0 (H)">Home</button>
      ${rig ? `<button data-act="selectRig" title="Select every instrument in this rig">Select whole rig</button>` : `
      <button data-act="zero" title="Make the current direction the new zero (Z)">Set zero here</button>
      <button data-act="aim" title="Point zero at the stage centre">Aim zero at stage</button>`}
      <button data-act="dup" title="${rig ? "Copy as a free instrument (not part of the rig)" : "Copy"}">Duplicate</button>
      <button data-act="del" class="danger" title="${rig ? "Delete the whole rig" : "Delete"} (⌫ or right-click) · ⌘Z to undo">${rig ? "Delete rig" : "Delete"}</button>
    </div>`;
  bindInspector();
  syncInspector();
}

function getField(inst, k) {
  if (k.startsWith("base.")) return inst.base[k.slice(5)];
  return inst[k];
}

function setField(inst, k, raw) {
  if (k === "name") { inst.name = raw; return; }
  if (k === "color") { setColorHex(inst, raw); return; }
  const v = Number(raw);
  if (!Number.isFinite(v)) return;
  // Ranges change what the same 0–255 values mean, so re-derive afterwards.
  if (k === "panLimit") { inst.panLimit = clamp(v, 0, 360); deriveFromDmx(inst); }
  else if (k === "tiltLimit") { inst.tiltLimit = clamp(v, 0, 180); deriveFromDmx(inst); }
  else if (k === "zoomMin") { inst.zoomMin = clamp(v, 1, Math.min(120, inst.zoomMax)); deriveFromDmx(inst); }
  else if (k === "zoomMax") { inst.zoomMax = clamp(v, Math.max(1, inst.zoomMin), 120); deriveFromDmx(inst); }
  else if (k.startsWith("base.")) inst.base[k.slice(5)] = v;
  else if (k === "x" || k === "y" || k === "z") inst[k] = v;
}

function bindInspector() {
  inspectorEl.querySelectorAll("[data-k]").forEach((el) => {
    el.addEventListener("input", () => {
      const inst = selectedInstruments()[0];
      if (!inst) return;
      setField(inst, el.dataset.k, el.value);
      changed({ inspector: el.dataset.k !== "name" });
    });
    if (el.type === "range") el.addEventListener("change", () => el.blur());
  });
  inspectorEl.querySelectorAll("[data-d]").forEach((el) => {
    el.addEventListener("input", () => {
      const inst = selectedInstruments()[0];
      const v = Number(el.value);
      if (!inst || el.value === "" || !Number.isFinite(v)) return;
      setDmx(inst, el.dataset.d, v);
      changed();
    });
    if (el.type === "range") el.addEventListener("change", () => el.blur());
  });
  inspectorEl.querySelectorAll("[data-multi]").forEach((el) => {
    el.addEventListener("input", () => {
      if (el.dataset.multi === "color") {
        for (const inst of selectedInstruments()) setColorHex(inst, el.value);
        changed();
        return;
      }
      const v = Number(el.value);
      if (el.value === "" || !Number.isFinite(v)) return;
      for (const inst of selectedInstruments()) setDmx(inst, "dimmer", v);
      changed();
    });
    if (el.type === "range") el.addEventListener("change", () => el.blur());
  });
  bindLinkControls();
  inspectorEl.querySelectorAll("[data-r]").forEach((el) => {
    el.addEventListener("input", () => {
      const rig = commonRig(selectedInstruments());
      if (!rig) return;
      const before = rig.count;
      setRigField(rig, el.dataset.r, el.value);
      // A new member count changes the list and possibly the selection.
      if (rig.count !== before) { renderInspector(); changed(); return; }
      // Moving / turning the rig can take members inside or outside the box,
      // so the list (with its "outside" marks) is always refreshed.
      changed({ inspector: el.dataset.r !== "name" });
    });
  });
  inspectorEl.querySelectorAll("[data-flash]").forEach((el) => {
    el.addEventListener("pointerdown", (e) => { e.preventDefault(); startFlash(); });
    for (const t of ["pointerup", "pointerleave", "pointercancel"]) el.addEventListener(t, stopFlash);
  });
  inspectorEl.querySelectorAll("[data-act]").forEach((el) => {
    el.addEventListener("click", () => { act(el.dataset.act); el.blur(); });
  });
}

function syncRigFields(rig) {
  inspectorEl.querySelectorAll("[data-r]").forEach((el) => {
    if (el === document.activeElement) return;
    const v = rig[el.dataset.r];
    el.value = typeof v === "number" ? String(round(v)) : v;
  });
}

function syncInspector() {
  const sel = selectedInstruments();
  const rig = commonRig(sel);
  if (rig) syncRigFields(rig);
  if (sel.length > 1) {
    const avg = Math.round(sel.reduce((s, i) => s + i.dmx.dimmer, 0) / sel.length);
    inspectorEl.querySelectorAll('[data-multi="dimmer"]').forEach((el) => { if (el !== document.activeElement) el.value = String(avg); });
    const colorEl = inspectorEl.querySelector('[data-multi="color"]');
    if (colorEl && colorEl !== document.activeElement) colorEl.value = sel[0].color;
    return;
  }
  const inst = sel[0];
  if (!inst) return;
  inspectorEl.querySelectorAll("[data-k]").forEach((el) => {
    const k = el.dataset.k;
    if (el === document.activeElement && el.type !== "range") return;
    const v = getField(inst, k);
    el.value = typeof v === "number" ? String(round(v)) : v;
  });
  syncDmxRows(inst);
  const readout = inspectorEl.querySelector("#readout");
  if (readout) {
    const dir = beamDir(inst);
    const hits = axisHits(inst, state.box);
    const fmt = (p) => `${round(p.x, 1)}, ${round(p.y, 1)}, ${round(p.z, 1)}`;
    let html = `<div>${isInside(inst, state.box) ? "Inside" : "<b>Outside</b>"} the box · dir ${round(dir.x)}, ${round(dir.y)}, ${round(dir.z)}</div>`;
    if (!hits.length) html += `<div>Beam axis misses the box</div>`;
    hits.forEach((h, idx) => {
      const label = hits.length > 1 ? (idx === 0 ? "Enters" : "Exits") : "Hits";
      html += `<div>${label} <b>${h.face}</b> at ${fmt(h.point)} · ${round(h.t, 1)} m</div>`;
    });
    readout.innerHTML = html;
  }
}

function renderHud() {
  const sel = selectedInstruments();
  if (!sel.length) { hudEl.hidden = true; return; }
  hudEl.hidden = false;
  const flashRow = sel.some((i) => flashing.has(i.id)) ? `<div class="row flash-on"><span>FLASH</span><span>white · 100%</span></div>` : "";
  if (sel.length > 1) {
    hudEl.innerHTML = `<div class="name">${sel.length} instruments</div><div class="row"><span>keys act on all</span></div>${flashRow}`;
    return;
  }
  const i = sel[0];
  hudEl.innerHTML = `
    <div class="name"></div>
    <div class="row"><span>dimmer</span><span>${i.dmx.dimmer} · ${Math.round(i.intensity * 100)}%</span></div>
    <div class="row"><span>pan</span><span>${i.dmx.pan} · ${i.pan.toFixed(1)}°</span></div>
    <div class="row"><span>tilt</span><span>${i.dmx.tilt} · ${i.tilt.toFixed(1)}°</span></div>
    <div class="row"><span>zoom</span><span>${i.dmx.zoom} · ${i.beam}°</span></div>
    <div class="row"><span>color</span><span><span class="swatch hud-swatch" style="background:${i.color}"></span>${i.dmx.red} ${i.dmx.green} ${i.dmx.blue}</span></div>
    ${flashRow}`;
  hudEl.querySelector(".name").textContent = i.name;
}

// ---------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------

function changed({ list = true, inspector = true } = {}) {
  pushToConsole();
  publishStage();
  trace?.refresh();
  syncScene();
  drawPlan();
  if (list) renderList();
  if (inspector) syncInspector();
  renderHud();
  save();
}

function select(id, additive = false) {
  if (!id) state.selected = [];
  else if (additive) {
    state.selected = state.selected.includes(id) ? state.selected.filter((s) => s !== id) : [...state.selected, id];
  } else state.selected = [id];
  renderInspector();
  changed({ inspector: false });
}

const bannerEl = document.getElementById("banner");
const PLACE_HINT = bannerEl.textContent;
const RIG_PLACE_HINT = "Click where the rig's centre goes: a surface or the ground in 3D, or the plan · Esc cancels";
const AIM_HINT = "Click a spot on the floor, a wall or the ceiling (or in the plan) to aim the selected instruments at it · Esc cancels";
let bannerTimer = 0;

/** Show a banner message (null hides it); `ms` auto-hides it. */
function setBanner(text, ms = 0) {
  clearTimeout(bannerTimer);
  bannerEl.textContent = text ?? "";
  bannerEl.hidden = !text;
  if (ms) bannerTimer = setTimeout(() => setBanner(null), ms);
}

function setPlacing(on, rigCfg = null) {
  if (on && aiming) setAiming(false);
  placing = on;
  placingRig = on ? rigCfg : null;
  view.classList.toggle("placing", on);
  setBanner(on ? (rigCfg ? RIG_PLACE_HINT : PLACE_HINT) : null);
  document.getElementById("addBtn").classList.toggle("active", on && !rigCfg);
  document.getElementById("rigBtn").classList.toggle("active", on && !!rigCfg);
  if (!on) updateGhost(null);
  drawPlan();
}

function setAiming(on) {
  if (on && !selectedInstruments().length) {
    setBanner("Select one or more instruments first, then Aim at spot (T)", 2500);
    return;
  }
  if (on && placing) setPlacing(false);
  aiming = on;
  view.classList.toggle("placing", on);
  setBanner(on ? AIM_HINT : null);
  inspectorEl.querySelectorAll('[data-act="aimSpot"]').forEach((b) => b.classList.toggle("active", on));
  if (!on) showAimPreview(null);
  drawPlan();
}

/** Point every selected instrument's beam at `p` (world, metres). */
function applyAim(p) {
  const sel = selectedInstruments();
  const missed = sel.filter((inst) => !aimAt(inst, p));
  setAiming(false);
  changed();
  if (missed.length) {
    const names = missed.map((i) => i.name).join(", ");
    setBanner(`Out of pan/tilt range, aimed as close as possible: ${names}`, 4000);
  }
}

function addInstrumentAt(x, y, z) {
  if (state.instruments.length >= MAX_INSTRUMENTS) { setPlacing(false); return; }
  const inst = createInstrument(x, y, z, state.instruments.length, state.box);
  inst.link.register = placeType;
  state.instruments.push(inst);
  setPlacing(false);
  select(inst.id);
  requestRegistrations();
}

// ---------------------------------------------------------------------
// Right-click menu (instruments in 3D, plan and list)
// ---------------------------------------------------------------------

const ctxMenu = document.getElementById("ctxMenu");

/**
 * Open the menu for instrument `id` at a screen point. Right-clicking an
 * instrument that's part of the selection acts on the whole selection;
 * otherwise it selects just that instrument first.
 */
function openContextMenu(id, x, y) {
  if (!state.selected.includes(id)) select(id);
  const n = state.selected.length;
  const rig = rigOf(byId(id));
  const title = n === 1 ? byId(id)?.name ?? "" : `${n} instruments`;
  const count = n > 1 ? ` ${n}` : "";
  const delCount = deletionIds().size;
  const delLabel = rig ? `Delete rig${delCount > 1 ? ` (${delCount})` : ""}` : `Delete${count}`;
  const item = (cmd, label, key = "", cls = "") =>
    `<button type="button" data-cmd="${cmd}" class="${cls}"><span>${label}</span><kbd>${key}</kbd></button>`;
  ctxMenu.innerHTML = `<div class="ctx-title"></div>
    ${item("aimSpot", "Aim at spot…", "T")}
    ${item("home", "Home", "H")}
    ${rig ? item("selectRig", "Select whole rig") : `${item("zero", "Set zero here", "Z")}${item("aim", "Aim zero at stage")}`}
    ${item("flash", "Flash (hold)", "F")}
    <hr />
    ${item("dup", `Duplicate${count}`)}
    ${item("del", delLabel, "⌫", "danger")}`;
  ctxMenu.querySelectorAll("kbd:empty").forEach((k) => k.remove());
  ctxMenu.querySelector(".ctx-title").textContent = title;
  ctxMenu.hidden = false;
  const r = ctxMenu.getBoundingClientRect();
  ctxMenu.style.left = `${Math.min(x, window.innerWidth - r.width - 8)}px`;
  ctxMenu.style.top = `${Math.min(y, window.innerHeight - r.height - 8)}px`;
  ctxMenu.querySelector("button").focus();
}

function closeContextMenu() {
  ctxMenu.hidden = true;
}

const menuCmd = (e) => (e.target instanceof Element ? e.target.closest("[data-cmd]")?.dataset.cmd : null);

ctxMenu.addEventListener("click", (e) => {
  const cmd = menuCmd(e);
  if (!cmd || cmd === "flash") return;
  closeContextMenu();
  act(cmd); // aimSpot, home, zero, aim, dup, del — same as the inspector buttons
});
// Flash lasts while the menu item is held down.
ctxMenu.addEventListener("pointerdown", (e) => { if (menuCmd(e) === "flash") { e.preventDefault(); startFlash(); } });
ctxMenu.addEventListener("pointerup", (e) => { if (menuCmd(e) === "flash") { stopFlash(); closeContextMenu(); } });
ctxMenu.addEventListener("pointerleave", stopFlash);
// Any press outside the menu, or the window losing focus / resizing, closes it.
window.addEventListener("pointerdown", (e) => { if (!ctxMenu.hidden && !ctxMenu.contains(e.target)) closeContextMenu(); }, true);
window.addEventListener("blur", closeContextMenu);
window.addEventListener("resize", closeContextMenu);

/**
 * Copy every selected instrument (all settings, 0.5 m to stage left) and
 * select the copies. Stops at the instrument limit.
 */
function duplicateSelected() {
  const wanted = selectedInstruments();
  const room = MAX_INSTRUMENTS - state.instruments.length;
  const src = wanted.slice(0, Math.max(0, room));
  if (!src.length) {
    if (wanted.length) setBanner(`Instrument limit reached (${MAX_INSTRUMENTS})`, 2500);
    return;
  }
  // Copies are free instruments, even when copied from a rig.
  const copies = src.map((inst) => ({
    ...structuredClone(inst), id: newId(), name: `${inst.name} copy`, x: round(inst.x + 0.5),
    rigId: null, rigIndex: 0,
    // Copies get their own console instrument if the original came from the stage.
    link: { consoleId: null, start: null, layout: [], owned: false, type: null, register: inst.link.owned ? inst.link.type : inst.link.register },
  }));
  state.instruments.push(...copies);
  state.selected = copies.map((c) => c.id);
  renderInspector();
  changed();
  requestRegistrations();
  if (src.length < wanted.length) setBanner(`Instrument limit reached (${MAX_INSTRUMENTS}): copied ${src.length} of ${wanted.length}`, 3000);
}

/** Deleted instruments (and rigs), newest last, so ⌘Z can put them back. */
const undoStack = [];
const MAX_UNDO = 50;

/** What a delete removes: the selection, widened to whole rigs. */
function deletionIds() {
  const ids = new Set(state.selected);
  for (const inst of selectedInstruments()) {
    const rig = rigOf(inst);
    if (rig) rigMembers(rig).forEach((m) => ids.add(m.id));
  }
  return ids;
}

function deleteSelected() {
  const ids = deletionIds();
  const removed = [];
  state.instruments.forEach((inst, index) => { if (ids.has(inst.id)) removed.push({ inst, index }); });
  if (!removed.length) return;
  const rigIds = new Set(removed.map((r) => r.inst.rigId).filter(Boolean));
  const rigs = state.rigs.filter((r) => rigIds.has(r.id));
  undoStack.push({ removed, rigs });
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  state.instruments = state.instruments.filter((i) => !ids.has(i.id));
  state.rigs = state.rigs.filter((r) => !rigIds.has(r.id));
  // Lights the stage registered leave the console too (their faders are freed).
  consoleLink.unregister(removed.filter((r) => r.inst.link.owned).map((r) => r.inst.link.consoleId));
  select(null);
  const what = rigs.length === 1 && removed.every((r) => r.inst.rigId === rigs[0].id)
    ? rigs[0].name
    : removed.length === 1 ? removed[0].inst.name : `${removed.length} instruments`;
  setBanner(`Deleted ${what} · ⌘Z to undo`, 4000);
}

function undoDelete() {
  const entry = undoStack.pop();
  if (!entry) return;
  const { removed, rigs } = entry;
  if (state.instruments.length + removed.length > MAX_INSTRUMENTS) {
    undoStack.push(entry);
    setBanner(`Can't undo: it would go over ${MAX_INSTRUMENTS} instruments`, 3000);
    return;
  }
  state.rigs.push(...rigs);
  // Re-insert in original order so each lands back at its old index.
  for (const { inst, index } of removed) state.instruments.splice(Math.min(index, state.instruments.length), 0, inst);
  rigs.forEach(syncRig);
  // Their console instruments were removed on delete: register them again.
  for (const { inst } of removed) {
    if (!inst.link.owned) continue;
    inst.link = { consoleId: null, start: null, layout: [], owned: false, type: null, register: inst.link.type };
  }
  requestRegistrations();
  state.selected = removed.map((r) => r.inst.id).filter((id) => byId(id));
  renderInspector();
  changed();
  const what = rigs.length === 1 ? rigs[0].name : removed.length === 1 ? removed[0].inst.name : `${removed.length} instruments`;
  setBanner(`Restored ${what}`, 2000);
}

function act(name) {
  const sel = selectedInstruments();
  if (name === "home") sel.forEach(homeInstrument);
  // A rig member's zero is set by its rig, so these skip rig members.
  const free = sel.filter((i) => !i.rigId);
  if (name === "zero") free.forEach(setZeroHere);
  if (name === "aimSpot") { setAiming(!aiming); return; }
  if (name === "aim") free.forEach((i) => aimZeroAt(i, defaultTarget(i, state.box)));
  if (name === "selectRig") {
    const rig = rigOf(sel[0]);
    if (rig) { state.selected = rigMembers(rig).map((m) => m.id); renderInspector(); }
  }
  if (name === "dup") { duplicateSelected(); return; }
  if (name === "del") { deleteSelected(); return; }
  changed();
}

// ---------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------

window.addEventListener("keydown", (e) => {
  const t = e.target;
  const typing = t instanceof HTMLElement && (t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && t.type !== "range" && t.type !== "color"));
  if (typing) {
    if (e.key === "Escape" || e.key === "Enter") t.blur();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ" && !e.shiftKey && !settingsDlg.open && !rigDlg.open && !placeDlg.open) {
    e.preventDefault();
    undoDelete();
    return;
  }
  if (e.metaKey || e.ctrlKey) return;
  if (settingsDlg.open || rigDlg.open || placeDlg.open) return;

  if (e.key === "Escape") {
    if (!ctxMenu.hidden) closeContextMenu();
    else if (placing) setPlacing(false);
    else if (aiming) setAiming(false);
    else select(null);
    return;
  }
  if (e.code === "KeyT") { setAiming(!aiming); return; }
  // Mac "delete" is Backspace; forward-delete is Delete. ⌘Z undoes it.
  if (e.key === "Backspace" || e.key === "Delete") {
    if (state.selected.length) { e.preventDefault(); deleteSelected(); }
    return;
  }
  if (e.key === "a" || e.key === "A") { togglePlaceInstrument(); return; }
  if (e.code === "KeyF") { if (!e.repeat) startFlash(); e.preventDefault(); return; }
  if (e.key === "Tab" && state.instruments.length) {
    e.preventDefault();
    const cur = state.instruments.findIndex((i) => i.id === state.selected[state.selected.length - 1]);
    const n = state.instruments.length;
    const next = state.instruments[(cur + (e.shiftKey ? -1 : 1) + n) % n];
    select(next.id);
    return;
  }

  const sel = selectedInstruments();
  if (!sel.length) return;

  // Every value is 0–255: one key press = 1 step, ⇧ = 10.
  const step = e.shiftKey ? 10 : 1;
  const nudge = (attr, by) => sel.forEach((i) => setDmx(i, attr, i.dmx[attr] + by));
  let handled = true;
  // e.code is layout-independent; keeps ⇧/⌥ from changing the key we see.
  switch (e.code) {
    case "ArrowLeft": nudge("pan", step); break;
    case "ArrowRight": nudge("pan", -step); break;
    case "ArrowUp": nudge("tilt", step); break;
    case "ArrowDown": nudge("tilt", -step); break;
    case "Equal": case "NumpadAdd": nudge("dimmer", step); break;
    case "Minus": case "NumpadSubtract": nudge("dimmer", -step); break;
    case "BracketLeft": nudge("zoom", -step); break;
    case "BracketRight": nudge("zoom", step); break;
    case "KeyH": sel.forEach(homeInstrument); break;
    case "KeyZ": sel.filter((i) => !i.rigId).forEach(setZeroHere); break;
    default: handled = false;
  }
  if (handled) { e.preventDefault(); changed(); }
});

window.addEventListener("keyup", (e) => { if (e.code === "KeyF") stopFlash(); });
window.addEventListener("blur", stopFlash);

// ---------------------------------------------------------------------
// Header: box size, place, import/export
// ---------------------------------------------------------------------

const boxInputs = { w: document.getElementById("boxW"), d: document.getElementById("boxD"), h: document.getElementById("boxH") };
function syncBoxInputs() { for (const k in boxInputs) boxInputs[k].value = String(state.box[k]); }
for (const [k, el] of Object.entries(boxInputs)) {
  el.addEventListener("input", () => {
    const v = Number(el.value);
    if (!Number.isFinite(v) || v < 1) return;
    state.box[k] = clamp(v, 1, 100);
    updateBox();
    changed();
  });
}

document.getElementById("addBtn").addEventListener("click", (e) => { e.currentTarget.blur(); togglePlaceInstrument(); });

document.getElementById("exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "stage.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

const importFile = document.getElementById("importFile");
document.getElementById("importBtn").addEventListener("click", () => importFile.click());
importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  importFile.value = "";
  if (!file) return;
  try {
    loadData(JSON.parse(await file.text()));
  } catch {
    return;
  }
  syncBoxInputs();
  updateBox();
  updateSurfaces();
  renderInspector();
  changed();
});

// ---------------------------------------------------------------------
// View settings dialog
// ---------------------------------------------------------------------

const settingsDlg = /** @type {HTMLDialogElement} */ (document.getElementById("settings"));
const surfaceRows = document.getElementById("surfaceRows");

function renderSurfaceRows() {
  surfaceRows.innerHTML = "";
  for (const { key, name, alwaysSolid } of SURFACES) {
    if (alwaysSolid) continue;
    const row = document.createElement("label");
    row.className = "check";
    row.innerHTML = `<input type="checkbox" /><span></span>`;
    const box = row.querySelector("input");
    row.querySelector("span").textContent = name;
    box.checked = state.transparent[key];
    box.addEventListener("change", () => {
      state.transparent[key] = box.checked;
      updateSurfaces();
      save();
    });
    surfaceRows.append(row);
  }
}

document.getElementById("settingsBtn").addEventListener("click", (e) => {
  e.currentTarget.blur();
  renderSurfaceRows();
  settingsDlg.showModal();
});
document.getElementById("settingsClose").addEventListener("click", () => settingsDlg.close());
settingsDlg.addEventListener("click", (e) => { if (e.target === settingsDlg) settingsDlg.close(); });
settingsDlg.querySelectorAll("[data-all]").forEach((el) => {
  el.addEventListener("click", () => {
    const on = el.dataset.all === "transparent";
    for (const key of Object.keys(state.transparent)) state.transparent[key] = on;
    updateSurfaces();
    renderSurfaceRows();
    save();
  });
});

// ---------------------------------------------------------------------
// Place rig dialog
// ---------------------------------------------------------------------

const rigDlg = /** @type {HTMLDialogElement} */ (document.getElementById("rigDlg"));
const rigInputs = {
  type: document.getElementById("rigType"),
  size: document.getElementById("rigSize"),
  count: document.getElementById("rigCount"),
  tilt: document.getElementById("rigTilt"),
  yaw: document.getElementById("rigYaw"),
  consoleType: document.getElementById("rigConsoleType"),
};
const rigRoomEl = document.getElementById("rigRoom");

document.getElementById("rigBtn").addEventListener("click", (e) => {
  e.currentTarget.blur();
  if (placing) setPlacing(false);
  const room = MAX_INSTRUMENTS - state.instruments.length;
  rigInputs.count.max = String(Math.max(2, room));
  rigRoomEl.textContent = `${room} of ${MAX_INSTRUMENTS} instrument slots free.`;
  fillConsoleTypes(rigInputs.consoleType);
  rigDlg.showModal();
});
document.getElementById("rigClose").addEventListener("click", () => rigDlg.close());
rigDlg.addEventListener("click", (e) => { if (e.target === rigDlg) rigDlg.close(); });
document.getElementById("rigPlace").addEventListener("click", () => {
  const cfg = normalizeRig({
    type: rigInputs.type.value,
    size: rigInputs.size.value,
    count: rigInputs.count.value,
    tilt: rigInputs.tilt.value,
    yaw: rigInputs.yaw.value,
  }, 0);
  const room = MAX_INSTRUMENTS - state.instruments.length;
  if (cfg.count > room) {
    rigRoomEl.textContent = `Only ${room} instrument slots free; lower the count to ${room} or fewer.`;
    return;
  }
  rigDlg.close();
  rememberConsoleType(rigInputs.consoleType.value);
  setPlacing(true, {
    type: cfg.type, size: cfg.size, count: cfg.count, tilt: cfg.tilt, yaw: cfg.yaw,
    consoleType: consoleTypeFromKey(rigInputs.consoleType.value),
  });
});

/** Switching type relabels the size and loads that type's defaults and help. */
function syncRigDialogType() {
  const t = RIG_TYPES[rigInputs.type.value];
  document.getElementById("rigSizeLabel").textContent = `${t.sizeLabel} (m)`;
  document.getElementById("rigHelp").textContent = `${t.name}: ${t.help}`;
  rigInputs.size.value = String(t.defaults.size);
  rigInputs.count.value = String(t.defaults.count);
  rigInputs.tilt.value = String(t.defaults.tilt);
  rigInputs.yaw.value = String(t.defaults.yaw);
}
rigInputs.type.innerHTML = Object.entries(RIG_TYPES).map(([k, t]) => `<option value="${k}">${t.name}</option>`).join("");
rigInputs.type.addEventListener("change", syncRigDialogType);
syncRigDialogType();

// ---------------------------------------------------------------------
// Console link: stage instruments ↔ console instruments / DMX channels
// ---------------------------------------------------------------------
// A linked instrument has a start channel and a layout (which attribute
// each channel drives). Values flow both ways for channels that have a
// console fader patched: the console's output sets the stage, and changing
// a value here moves that fader (see console-link.js for the rules).

const consoleLink = createConsoleLink({
  onLevels: () => applyConsoleLevels(),
  onStageHello: () => publishStage(),
  onRegistered: (results) => onRegistered(results),
});
const consoleStatusEl = document.getElementById("consoleStatus");

const sortedConsoleInstruments = () => [...consoleLink.instruments()].sort((a, b) => a.channelStart - b.channelStart);
const consoleInstrumentById = (id) => consoleLink.instruments().find((c) => c.id === id) ?? null;
const chRange = (c) => `Ch ${c.channelStart}${c.channelEnd > c.channelStart ? `–${c.channelEnd}` : ""}`;

function updateConsoleStatus() {
  const live = consoleLink.live;
  consoleStatusEl.textContent = live ? "Console · live" : "Console · offline";
  consoleStatusEl.classList.toggle("on", live);
  consoleStatusEl.title = live
    ? "Linked values follow the console's faders, and changes here move them"
    : "Open the console (console/console.html) in another tab to link";
}
setInterval(updateConsoleStatus, 1000);

/** Take the console's current values for linked, patched channels. */
function applyConsoleLevels() {
  let moved = false;
  for (const inst of state.instruments) {
    // Follow the console instrument if its address was changed there.
    const ci = inst.link.consoleId ? consoleInstrumentById(inst.link.consoleId) : null;
    if (ci && ci.channelStart !== inst.link.start) { inst.link.start = ci.channelStart; moved = true; }
    for (const { channel, attr } of linkChannels(inst)) {
      const v = consoleLink.incoming(channel);
      if (v != null && v !== inst.dmx[attr]) { setDmx(inst, attr, v); moved = true; }
    }
  }
  updateConsoleStatus();
  requestRegistrations();
  if (moved) { syncScene(); drawPlan(); renderList(); save(); publishStage(); }
  syncInspector();
  renderHud();
  trace.refresh();
}

/** Send values changed on the stage to the console (called from changed()). */
function pushToConsole() {
  const entries = [];
  for (const inst of state.instruments) {
    for (const { channel, attr } of linkChannels(inst)) entries.push({ channel, value: inst.dmx[attr] });
  }
  consoleLink.push(entries);
}

function linkToConsoleInstrument(inst, ci) {
  if (!ci) return;
  inst.link = { consoleId: ci.id, start: ci.channelStart, layout: layoutFor(ci.mount, ci.color, ci.channelEnd - ci.channelStart + 1) };
}

/** After (re)linking: take the console's values (it wins at link time), then redraw. */
function afterLinkChange() {
  renderInspector();
  applyConsoleLevels();
  changed();
}

function linkSectionHtml(inst) {
  const L = inst.link;
  const mode = L.consoleId ?? (L.start ? "manual" : "");
  const opt = (v, text) => `<option value="${escapeHtml(v)}"${v === mode ? " selected" : ""}>${escapeHtml(text)}</option>`;
  const missing = L.consoleId && !consoleInstrumentById(L.consoleId);
  const attrOpts = (cur) => [`<option value="">—</option>`, ...DMX_ATTRS.map((a) => `<option value="${a}"${a === cur ? " selected" : ""}>${DMX_LABELS[a]}</option>`)].join("");
  return `
    <div class="fields link-fields">
      <div class="subhead">Console link</div>
      <label>Instrument</label>
      <select data-link="target">
        ${opt("", "— not linked —")}
        ${sortedConsoleInstruments().map((c) => opt(c.id, `${c.name} · ${chRange(c)}`)).join("")}
        ${missing ? opt(L.consoleId, "(not found in the console)") : ""}
        ${opt("manual", "Manual address…")}
      </select>
      ${L.start ? `
      <label>Start ch</label>
      <input type="number" min="1" max="512" step="1" data-link="start" value="${L.start}"${L.consoleId ? ' disabled title="Set by the console instrument"' : ""} />
      <label>Layout</label>
      <div class="layout">
        ${L.layout.map((a, k) => `<label class="lay"><span>${L.start + k}</span><select data-layout="${k}">${attrOpts(a)}</select></label>`).join("")}
        <div class="lay-btns">
          <button type="button" data-link-act="add" title="Add a channel">+ ch</button>
          <button type="button" data-link-act="remove" title="Remove the last channel">− ch</button>
          ${L.consoleId ? `<button type="button" data-link-act="preset" title="Reset to the preset for the console instrument's type">Preset</button>` : ""}
        </div>
      </div>` : ""}
      ${!L.start ? `
      <label>Register</label>
      <div class="xyz">
        <select data-reg-type>${CONSOLE_TYPES.filter((t) => t.key !== "none").map((t) => `<option value="${t.key}"${t.key === lastConsoleType() ? " selected" : ""}>${t.label}</option>`).join("")}</select>
        <button type="button" data-link-act="register" title="Create a console instrument for this light, with free faders patched to it">Register</button>
      </div>` : ""}
      <div class="readout" id="linkStatus"></div>
    </div>`;
}

/** Rig only: link every member to consecutive console instruments. */
function rigLinkHtml() {
  return `
    <div class="fields rig-fields">
      <label>Link rig</label>
      <select data-rig-link title="Link member 1 to the chosen console instrument, member 2 to the next one, …">
        <option value="">Members in order, from…</option>
        ${sortedConsoleInstruments().map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)} · ${chRange(c)}</option>`).join("")}
        <option value="__unlink">Unlink all members</option>
      </select>
    </div>`;
}

function linkRigFrom(rig, id) {
  const members = rigMembers(rig);
  if (id === "__unlink") {
    members.forEach((m) => { m.link = { consoleId: null, start: null, layout: [] }; });
  } else {
    const list = sortedConsoleInstruments();
    const first = list.findIndex((c) => c.id === id);
    if (first < 0) return;
    members.forEach((m, k) => linkToConsoleInstrument(m, list[first + k]));
    const linked = Math.min(members.length, list.length - first);
    if (linked < members.length) setBanner(`Linked ${linked} of ${members.length}: ran out of console instruments`, 4000);
  }
  afterLinkChange();
}

function bindLinkControls() {
  const sel = selectedInstruments();
  const inst = sel.length === 1 ? sel[0] : null;
  inspectorEl.querySelector('[data-link="target"]')?.addEventListener("change", (e) => {
    const v = e.target.value;
    // Moving off a console instrument the stage registered: remove it there.
    if (inst.link.owned && v !== inst.link.consoleId) consoleLink.unregister([inst.link.consoleId]);
    if (v === "") inst.link = { consoleId: null, start: null, layout: [] };
    else if (v === "manual") inst.link = { consoleId: null, start: inst.link.start ?? 1, layout: inst.link.layout.length ? inst.link.layout : [...LAYOUT_PRESETS["movable/multi"]] };
    else linkToConsoleInstrument(inst, consoleInstrumentById(v));
    afterLinkChange();
  });
  inspectorEl.querySelector('[data-link="start"]')?.addEventListener("change", (e) => {
    const v = Math.round(Number(e.target.value));
    if (!Number.isFinite(v)) return;
    inst.link.start = clamp(v, 1, 512);
    afterLinkChange();
  });
  inspectorEl.querySelectorAll("[data-layout]").forEach((el) => {
    el.addEventListener("change", () => {
      inst.link.layout[Number(el.dataset.layout)] = el.value || null;
      afterLinkChange();
    });
  });
  inspectorEl.querySelectorAll("[data-link-act]").forEach((el) => {
    el.addEventListener("click", () => {
      const L = inst.link;
      if (el.dataset.linkAct === "add" && L.layout.length < 16) L.layout.push(null);
      if (el.dataset.linkAct === "remove" && L.layout.length > 1) L.layout.pop();
      if (el.dataset.linkAct === "register") {
        const key = inspectorEl.querySelector("[data-reg-type]")?.value;
        rememberConsoleType(key);
        L.register = consoleTypeFromKey(key);
        requestRegistrations();
      }
      if (el.dataset.linkAct === "preset") {
        const ci = consoleInstrumentById(L.consoleId);
        if (ci) linkToConsoleInstrument(inst, ci);
      }
      afterLinkChange();
    });
  });
  inspectorEl.querySelector("[data-rig-link]")?.addEventListener("change", (e) => {
    const rig = commonRig(selectedInstruments());
    if (rig && e.target.value) linkRigFrom(rig, e.target.value);
  });
}

/** DMX rows in the inspector: values, units, and which channel / fader drives each. */
function syncDmxRows(inst) {
  const chans = new Map(linkChannels(inst).map(({ channel, attr }) => [attr, channel]));
  inspectorEl.querySelectorAll("[data-d]").forEach((el) => {
    if (el === document.activeElement && el.type !== "range") return;
    el.value = String(inst.dmx[el.dataset.d]);
  });
  inspectorEl.querySelectorAll("[data-note]").forEach((el) => {
    const a = el.dataset.note;
    const unit = { dimmer: `${Math.round(inst.intensity * 100)}%`, pan: `${inst.pan}°`, tilt: `${inst.tilt}°`, zoom: `${inst.beam}°` }[a] ?? "";
    const ch = chans.get(a);
    const faders = ch ? consoleLink.fadersFor(ch) : [];
    const chan = ch
      ? `<span class="chan${faders.length ? " on" : ""}" data-ch="${ch}" title="${faders.length ? `DMX ${ch} ← fader ${faders.join(", ")}` : `DMX ${ch} · no fader patched`} · ⌥-click to trace">${ch}${faders.length ? ` F${faders.join(",")}` : ""}</span>`
      : "";
    el.innerHTML = `<span>${unit}</span>${chan}`;
  });
  const status = inspectorEl.querySelector("#linkStatus");
  if (!status) return;
  const linked = linkChannels(inst);
  const withFader = linked.filter(({ channel }) => consoleLink.fadersFor(channel).length).length;
  const owned = inst.link.owned ? " Registered by the stage: deleting the light removes it from the console." : "";
  status.textContent = inst.link.register
    ? (consoleLink.live ? "Registering in the console…" : "Will register in the console when it opens.")
    : !linked.length
    ? (inst.link.start ? "No channels assigned in the layout." : "Not linked: values are set here only.")
    : !consoleLink.live
      ? "Console offline: changes stay here. Open the console to sync (its values take over)."
      : `${withFader} of ${linked.length} channels have a fader: those follow the console, and changes here move the fader.${owned}`;
}

// ---------------------------------------------------------------------
// Registering lights in the console
// ---------------------------------------------------------------------
// A light placed with a console type (or a rig's members, or a copy of a
// registered light) asks the console to create an instrument at the next
// free DMX block, patch one free fader per channel and name them. It starts
// at the light's current values. Lights placed while the console is closed
// wait (link.register) and register when it opens.

const CONSOLE_TYPE_KEY = "unnaturallight.stage.consoleType";
const lastConsoleType = () => { try { return localStorage.getItem(CONSOLE_TYPE_KEY) || "movable/multi"; } catch { return "movable/multi"; } };
const rememberConsoleType = (key) => { try { localStorage.setItem(CONSOLE_TYPE_KEY, key); } catch { /* storage unavailable */ } };

function fillConsoleTypes(select) {
  select.innerHTML = CONSOLE_TYPES.map((t) => `<option value="${t.key}"${t.key === lastConsoleType() ? " selected" : ""}>${t.label}</option>`).join("");
}

/** Lights asked for but not answered yet (stage id → give-up timer). */
const registering = new Map();

function requestRegistrations() {
  if (!consoleLink.live) return;
  const requests = [];
  for (const inst of state.instruments) {
    const t = inst.link.register;
    if (!t || registering.has(inst.id)) continue;
    const layout = LAYOUT_PRESETS[consoleTypeKey(t)];
    requests.push({
      stageId: inst.id,
      name: inst.name,
      mount: t.mount,
      color: t.color,
      width: layout.length,
      labels: layout.map((a) => DMX_SHORT[a]),
      values: layout.map((a) => inst.dmx[a]),
      group: rigOf(inst)?.name ?? null,
    });
    registering.set(inst.id, setTimeout(() => registering.delete(inst.id), 5000));
  }
  if (requests.length) consoleLink.register(requests);
}

function onRegistered(results) {
  const failed = [];
  for (const r of results) {
    clearTimeout(registering.get(r.stageId));
    registering.delete(r.stageId);
    const inst = byId(r.stageId);
    if (!inst || !inst.link.register) {
      // Deleted (or unlinked) while waiting: undo it in the console.
      if (r.ok) consoleLink.unregister([r.consoleId]);
      continue;
    }
    const type = inst.link.register;
    if (!r.ok) {
      inst.link.register = null;
      failed.push(`${inst.name}: ${r.error}`);
      continue;
    }
    inst.link = { consoleId: r.consoleId, start: r.start, layout: [...LAYOUT_PRESETS[consoleTypeKey(type)]], owned: true, type, register: null };
  }
  renderInspector();
  changed();
  if (failed.length) setBanner(`Not registered in the console (kept on the stage only) · ${failed.join(" · ")}`, 7000);
}

// Place instrument: pick its console type first.
const placeDlg = /** @type {HTMLDialogElement} */ (document.getElementById("placeDlg"));
const placeTypeEl = document.getElementById("placeType");
/** Console type for the instrument being placed (null = stage only). */
let placeType = null;

function togglePlaceInstrument() {
  if (placing) { setPlacing(false); return; }
  fillConsoleTypes(placeTypeEl);
  placeDlg.showModal();
}

document.getElementById("placeForm").addEventListener("submit", (e) => {
  e.preventDefault();
  rememberConsoleType(placeTypeEl.value);
  placeType = consoleTypeFromKey(placeTypeEl.value);
  placeDlg.close();
  setPlacing(true);
});
document.getElementById("placeClose").addEventListener("click", () => placeDlg.close());
placeDlg.addEventListener("click", (e) => { if (e.target === placeDlg) placeDlg.close(); });

// ---------------------------------------------------------------------
// Trace: ⌥-click a light (3D, plan, list) or a channel badge in the
// inspector for a card showing what controls it and the current values.
// ---------------------------------------------------------------------

const trace = createTracePopover();

/** A light as the trace card (here and in the console) sees it. */
function traceLights() {
  return state.instruments.map((i) => ({
    id: i.id,
    name: i.name,
    start: i.link.start,
    layout: i.link.layout,
    dmx: { ...i.dmx },
    notes: { dimmer: `${Math.round(i.intensity * 100)}%`, pan: `${i.pan}°`, tilt: `${i.tilt}°`, zoom: `${i.beam}°` },
    consoleId: i.link.consoleId,
    consoleName: i.link.consoleId ? consoleInstrumentById(i.link.consoleId)?.name ?? null : null,
  }));
}

function traceSnapshot() {
  const { levels, faders, mix } = consoleLink.traceInfo();
  return { live: consoleLink.live, levels, faders, mix, consoleInstruments: consoleLink.instruments(), stageInstruments: traceLights() };
}

function showTrace(target, e) {
  trace.show(target, e.clientX, e.clientY, traceSnapshot);
}

// Tell the console about the stage's lights (coalesced; plus a slow heartbeat).
let publishTimer = 0;
function publishStage() {
  clearTimeout(publishTimer);
  publishTimer = setTimeout(() => consoleLink.publishStage(traceLights()), 80);
}
setInterval(publishStage, 2000);

// ⌥-click a channel badge in the inspector: trace that DMX channel.
inspectorEl.addEventListener("click", (e) => {
  const badge = e.altKey && e.target instanceof Element ? e.target.closest("[data-ch]") : null;
  if (badge) showTrace({ kind: "channel", channel: Number(badge.dataset.ch) }, e);
});

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------

restore();
syncBoxInputs();
updateSurfaces();
setPlanView(planView);
updateBox();
renderInspector();
changed();
resize();

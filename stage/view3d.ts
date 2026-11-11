// The 3D view: the box, the fixtures and their beams, and picking, placing,
// dragging and aiming with the mouse.
import * as THREE from "three";
import { describeSpot, snapLength } from "./units.ts";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  MAX_FIXTURES,
  DEG,
  FORWARD,
  round,
  baseQuat,
  fullQuat,
  isInside,
  axisHits,
  SURFACES,
  TRANSPARENT_OPACITY,
  rigLowestY,
  rigOutline,
  type Fixture,
  type RigShape,
  type StagePosition,
  type Xyz,
} from "./stage-model.ts";
import { clamp } from "../shared/numbers.ts";
import { state, byId, selectedFixtures, moveFixture, addRigAt, positionById, ui } from "./state.ts";
import { runFrameStart } from "./frame.ts";
import { look, changed, select, selectRigOf, applyAim, addFixtureAt, addPositionAt, setActivePosition, setHoverPosition, openContextMenu, openPositionMenu, showPositionSpot } from "./actions.ts";
import { followingOf } from "./follow.ts";
import { showTrace } from "./stage.ts";
import { isPresent } from "../shared/guards.ts";
import { elById } from "../shared/query.ts";

// ---------------------------------------------------------------------
// 3D scene
// ---------------------------------------------------------------------

export const view = elById("view");
/** The 3D view needs drawing (see the animation loop below). */
let needsRender = true;
function requestRender() {
  needsRender = true;
}
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
  uPos: { value: Array.from({ length: MAX_FIXTURES }, () => new THREE.Vector3()) },
  uDir: { value: Array.from({ length: MAX_FIXTURES }, () => new THREE.Vector3()) },
  uColor: { value: Array.from({ length: MAX_FIXTURES }, () => new THREE.Vector3()) },
  uCosOuter: { value: new Float32Array(MAX_FIXTURES) },
  uCosInner: { value: new Float32Array(MAX_FIXTURES) },
  uInt: { value: new Float32Array(MAX_FIXTURES) },
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
  #define MAX ${MAX_FIXTURES}
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
const passMaterial = (pass: number, opts: THREE.ShaderMaterialParameters) => {
  const m = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uPass: { value: pass } },
    vertexShader, fragmentShader, ...opts,
  });
  m.extensions.derivatives = true;
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

export function updateSurfaces() {
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

export function updateBox() {
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

// Place-mode preview: where the next fixture will land.
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
const rigVisuals = new Map<string, THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>>();
const rigGhost = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x00dddd, depthTest: false }));
rigGhost.renderOrder = 10;
rigGhost.visible = false;
scene.add(rigGhost);

/** Redraw a line object as the outline of a rig (or rig-like settings). */
function setOutline(line: THREE.Line, rig: RigShape) {
  line.geometry.dispose();
  line.geometry = new THREE.BufferGeometry().setFromPoints(rigOutline(rig));
}

// Aim-mode preview: target marker + a line from each selected fixture.
const aimMarker = new THREE.Mesh(
  new THREE.TorusGeometry(0.25, 0.03, 8, 32),
  new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
);
aimMarker.renderOrder = 10;
const aimLines = new THREE.LineSegments(
  new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_FIXTURES * 6), 3)),
  new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.2, gapSize: 0.12, transparent: true, opacity: 0.8, depthTest: false }),
);
aimLines.renderOrder = 10;
aimMarker.visible = aimLines.visible = false;
scene.add(aimMarker, aimLines);

const visuals = new Map<string, ReturnType<typeof makeVisual>>();

// Named positions: a small diamond, a dashed stem down to the floor, and the
// name on a label that always faces the camera.
const POSITION_COLOR = 0xc58cff; // the same as --position in stage.css
const positionGeom = new THREE.OctahedronGeometry(0.12);
const positionVisuals = new Map<string, { group: THREE.Group; mark: THREE.Mesh; halo: THREE.Mesh; stem: THREE.Line; label: THREE.Sprite; pick: THREE.Mesh; text: string }>();
/** Hovered: a soft glow around the diamond. */
const positionHaloGeom = new THREE.SphereGeometry(0.32, 20, 12);
/** Hovered: dashed lines from the fixtures following the position to it. */
const followLines = new THREE.LineSegments(
  new THREE.BufferGeometry(),
  new THREE.LineDashedMaterial({ color: POSITION_COLOR, dashSize: 0.15, gapSize: 0.1, transparent: true, opacity: 0.85, depthTest: false }),
);
followLines.renderOrder = 9;
scene.add(followLines);
/** Invisible: a bigger target than a position's diamond, for click / drag. */
const positionPickGeom = new THREE.SphereGeometry(0.25, 12, 8);

/** A camera-facing text label (canvas texture), about `height` meters tall. */
function makeLabel(text: string, height = 0.32, color = "#e8e4dc") {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = "600 44px system-ui, sans-serif";
  if (ctx) ctx.font = font;
  const w = Math.ceil((ctx?.measureText(text).width ?? 100) + 24);
  canvas.width = w;
  canvas.height = 64;
  if (ctx) {
    ctx.font = font;
    ctx.fillStyle = "rgba(12, 14, 17, 0.75)";
    ctx.beginPath(); ctx.roundRect(0, 0, w, 64, 12); ctx.fill();
    ctx.fillStyle = color;
    ctx.textBaseline = "middle";
    ctx.fillText(text, 12, 34);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set((height * w) / 64, height, 1);
  sprite.center.set(0, 0);
  sprite.renderOrder = 11;
  return sprite;
}

function syncPositions() {
  const ids = new Set(state.positions.map((p) => p.id));
  for (const [id, v] of positionVisuals) {
    if (ids.has(id)) continue;
    scene.remove(v.group);
    v.label.material.map?.dispose();
    v.label.material.dispose();
    v.stem.geometry.dispose();
    positionVisuals.delete(id);
  }
  for (const position of state.positions) syncPosition(position);
  // Lines from the hovered position's followers to it.
  const hovered = positionById(ui.hoverPosition);
  const ends = hovered ? state.fixtures.filter((f) => followingOf(f)?.id === hovered.id).flatMap((f) => [f.x, f.y, f.z, hovered.x, hovered.y, hovered.z]) : [];
  followLines.geometry.setAttribute("position", new THREE.Float32BufferAttribute(ends, 3));
  followLines.geometry.computeBoundingSphere();
  followLines.computeLineDistances();
  followLines.visible = ends.length > 0;
}

function syncPosition(position: StagePosition) {
  let v = positionVisuals.get(position.id);
  if (!v) {
    const group = new THREE.Group();
    const mark = new THREE.Mesh(positionGeom, new THREE.MeshBasicMaterial({ color: POSITION_COLOR, depthTest: false }));
    mark.renderOrder = 10;
    const stem = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({ color: POSITION_COLOR, dashSize: 0.1, gapSize: 0.08, transparent: true, opacity: 0.6 }),
    );
    const label = makeLabel(position.name);
    const halo = new THREE.Mesh(positionHaloGeom, new THREE.MeshBasicMaterial({ color: POSITION_COLOR, transparent: true, opacity: 0.25, depthTest: false, depthWrite: false }));
    halo.renderOrder = 9;
    const pick = new THREE.Mesh(positionPickGeom, new THREE.MeshBasicMaterial({ visible: false }));
    pick.userData.positionId = position.id;
    group.add(mark, halo, stem, label, pick);
    scene.add(group);
    v = { group, mark, halo, stem, label, pick, text: position.name };
    positionVisuals.set(position.id, v);
  }
  if (v.text !== position.name) {
    v.group.remove(v.label);
    v.label.material.map?.dispose();
    v.label.material.dispose();
    v.label = makeLabel(position.name);
    v.text = position.name;
    v.group.add(v.label);
  }
  v.group.position.set(position.x, position.y, position.z);
  const on = ui.activePosition === position.id;
  const hover = ui.hoverPosition === position.id;
  v.mark.scale.setScalar(hover ? 2 : on ? 1.6 : 1);
  (v.mark.material as THREE.MeshBasicMaterial).color.set(hover ? 0xf1e3ff : POSITION_COLOR);
  v.halo.visible = hover;
  const labelScale = hover ? 1.4 : 1;
  if (v.label.userData.base == null) v.label.userData.base = v.label.scale.x;
  v.label.scale.set(v.label.userData.base * labelScale, 0.32 * labelScale, 1);
  v.label.position.set(hover ? 0.3 : 0.15, hover ? 0.25 : 0.15, 0);
  const pts = v.stem.geometry.attributes.position;
  pts.setXYZ(1, 0, -position.y, 0);
  pts.needsUpdate = true;
  v.stem.geometry.computeBoundingSphere();
  v.stem.computeLineDistances();
  v.stem.visible = position.y > 0.05;
}

function makeVisual(fixture: Fixture) {
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
  pick.userData.fixtureId = fixture.id;

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
  visuals.set(fixture.id, v);
  return v;
}

// Placing a position: a preview of it (a violet diamond) on the spot under the
// pointer, three dotted lines through it across the box (x red, height
// green, z blue), and a label saying where it is.
const positionPreview = new THREE.Group();
const previewMark = new THREE.Mesh(positionGeom, new THREE.MeshBasicMaterial({ color: POSITION_COLOR, depthTest: false, transparent: true, opacity: 0.9 }));
previewMark.scale.setScalar(1.4);
previewMark.renderOrder = 12;
const axisLine = (color: number) => {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineDashedMaterial({ color, dashSize: 0.2, gapSize: 0.1, depthTest: false }),
  );
  line.renderOrder = 11;
  return line;
};
const previewAxes = { x: axisLine(0xff7a7a), y: axisLine(0x7ee08a), z: axisLine(0x7aaaff) };
let previewLabel: THREE.Sprite | null = null;
let previewText = "";
positionPreview.add(previewMark, previewAxes.x, previewAxes.y, previewAxes.z);
positionPreview.visible = false;
scene.add(positionPreview);

/**
 * Show where a new position would go (null hides it); `surface` names what it
 * sits on. `moving`: the name of a position being dragged (its own diamond
 * shows, so the preview's doesn't).
 */
function showPositionPreview(p: THREE.Vector3 | null, surface: string | null, moving?: string) {
  requestRender();
  positionPreview.visible = !!p;
  previewMark.visible = moving == null;
  if (!p) { showPositionSpot(null, moving); return; }
  previewMark.position.copy(p);
  // Each axis spans the box, and reaches the position if it's outside.
  const { w, d, h } = state.box;
  const span = (lo: number, hi: number, v: number) => [Math.min(lo, v), Math.max(hi, v)];
  const [x0, x1] = span(-w / 2, w / 2, p.x), [y0, y1] = span(0, h, p.y), [z0, z1] = span(-d / 2, d / 2, p.z);
  const set = (line: THREE.Line, a: THREE.Vector3, b: THREE.Vector3) => {
    const pts = line.geometry.attributes.position;
    pts.setXYZ(0, a.x, a.y, a.z);
    pts.setXYZ(1, b.x, b.y, b.z);
    pts.needsUpdate = true;
    line.geometry.computeBoundingSphere();
    line.computeLineDistances();
  };
  set(previewAxes.x, new THREE.Vector3(x0, p.y, p.z), new THREE.Vector3(x1, p.y, p.z));
  set(previewAxes.y, new THREE.Vector3(p.x, y0, p.z), new THREE.Vector3(p.x, y1, p.z));
  set(previewAxes.z, new THREE.Vector3(p.x, p.y, z0), new THREE.Vector3(p.x, p.y, z1));
  const text = describeSpot(p, surface);
  if (text !== previewText) {
    if (previewLabel) { positionPreview.remove(previewLabel); previewLabel.material.map?.dispose(); previewLabel.material.dispose(); }
    previewLabel = makeLabel(text, 0.3, "#c58cff");
    previewText = text;
    positionPreview.add(previewLabel);
  }
  previewLabel?.position.set(p.x + 0.2, p.y + 0.2, p.z);
  showPositionSpot(text, moving);
}

export function syncScene() {
  requestRender();
  syncPositions();
  const ids = new Set(state.fixtures.map((i) => i.id));
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
  const selRigs = new Set(selectedFixtures().map((i) => i.rigId).filter(isPresent));
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
  uniforms.uCount.value = state.fixtures.length;

  state.fixtures.forEach((fixture, i) => {
    const v = visuals.get(fixture.id) || makeVisual(fixture);
    const q = fullQuat(fixture);
    const dir = FORWARD.clone().applyQuaternion(q);
    const lk = look(fixture);
    const color = new THREE.Color(lk.color);
    const sel = state.selected.includes(fixture.id);

    v.group.position.set(fixture.x, fixture.y, fixture.z);
    v.aim.quaternion.copy(q);
    v.zero.quaternion.copy(baseQuat(fixture));
    v.zero.visible = sel;
    v.ring.visible = sel;

    const hits = axisHits(fixture, state.box);
    const len = hits.length ? hits[hits.length - 1].t : diag * 0.6;
    // The visible cone is drawn long and clipped by every wall the
    // fixture is on the inside of, so it ends exactly where it lands
    // on the walls (an outside fixture's beam passes in through the
    // near wall and stops at the far ones).
    const p = new THREE.Vector3(fixture.x, fixture.y, fixture.z);
    const coneLen = p.length() + diag * 1.5;
    const coneR = Math.tan((fixture.beam / 2) * DEG) * coneLen;
    v.cone.scale.set(coneR, coneR, coneLen);
    v.cone.material.clippingPlanes = wallPlanes.filter((pl) => pl.distanceToPoint(p) >= -1e-3);
    v.cone.material.color.copy(color);
    v.cone.material.opacity = 0.06 + 0.16 * lk.intensity;
    v.cone.visible = lk.intensity > 0.001;
    v.lens.material.color.copy(color).multiplyScalar(0.25 + 0.75 * lk.intensity);

    const pts = v.axis.geometry.attributes.position;
    pts.setXYZ(0, fixture.x, fixture.y, fixture.z);
    const end = new THREE.Vector3(fixture.x, fixture.y, fixture.z).addScaledVector(dir, len);
    pts.setXYZ(1, end.x, end.y, end.z);
    pts.needsUpdate = true;
    v.axis.computeLineDistances();
    v.axis.visible = sel;

    uniforms.uPos.value[i].set(fixture.x, fixture.y, fixture.z);
    uniforms.uDir.value[i].copy(dir);
    uniforms.uColor.value[i].set(color.r, color.g, color.b);
    uniforms.uCosOuter.value[i] = Math.cos((fixture.beam / 2) * DEG);
    uniforms.uCosInner.value[i] = Math.cos((fixture.beam / 2) * 0.82 * DEG);
    uniforms.uInt.value[i] = lk.intensity;
  });
}

export function resize() {
  const { clientWidth: w, clientHeight: h } = view;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  requestRender();
}
new ResizeObserver(resize).observe(view);

// Draw only when something changed: the scene (syncScene), the camera
// (orbit, incl. its damping glide), the size, or anything the mouse /
// keyboard did here (ghosts, aim lines, surfaces…), plus a slow safety
// redraw. Drawing every frame kept the GPU and the page busy, and in the
// split view the console shares this page's thread, so its faders lagged.
for (const type of ["pointerdown", "pointermove", "pointerup", "wheel", "keydown", "keyup", "input", "change"]) {
  window.addEventListener(type, requestRender, { capture: true, passive: true });
}
setInterval(requestRender, 500);

/** The stage's pane of the app: while it's hidden (Console view), nothing is drawn; the scene still keeps up. */
const pane = view.closest<HTMLElement>("[data-pane]");

renderer.setAnimationLoop(() => {
  runFrameStart();
  const moved = controls.update();
  if (!moved && !needsRender) return;
  if (pane && getComputedStyle(pane).visibility === "hidden") { needsRender = true; return; }
  needsRender = false;
  renderer.render(scene, camera);
});

// 3D picking, placing and dragging.
//   click fixture      select (⇧ adds/removes)
//   drag fixture       slide it horizontally at its current height
//   ⇧-drag fixture     raise / lower it
//   drag empty space      orbit (OrbitControls)
// Listeners sit on the parent in the capture phase so we can switch
// OrbitControls off before it sees a press that lands on a fixture.
const raycaster = new THREE.Raycaster();
const DRAG_THRESHOLD = 4;
let downAt: { x: number; y: number } | null = null;
let drag3d: null | { id: string; shift: boolean; active: boolean; vertical: boolean; plane: THREE.Plane; offset: THREE.Vector3 } = null;

function rayFromEvent(e: MouseEvent) {
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray;
}

/** The named position under the pointer, or null. */
function pickPosition(e: MouseEvent): string | null {
  rayFromEvent(e);
  const targets = [...positionVisuals.values()].map((v) => v.pick);
  return raycaster.intersectObjects(targets)[0]?.object.userData.positionId ?? null;
}

/**
 * Dragging a named position: level, at the height it's at (a floor position stays
 * on the floor), or with ⇧ straight up and down. `move`: the plane it moves
 * on now (re-made from where it is when ⇧ is pressed or let go).
 */
let dragPosition: { id: string; active: boolean; move: null | { vertical: boolean; plane: THREE.Plane; offset: THREE.Vector3 } } | null = null;

function pickFixture(e: MouseEvent) {
  rayFromEvent(e);
  const targets = [...visuals.values()].map((v) => v.pick);
  return raycaster.intersectObjects(targets)[0]?.object.userData.fixtureId ?? null;
}

/** Horizontal plane through the fixture (or position), or (⇧) a vertical one facing the camera. */
function dragPlane(fixture: Xyz, vertical: boolean) {
  const p = new THREE.Vector3(fixture.x, fixture.y, fixture.z);
  if (!vertical) return new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), p);
  const n = new THREE.Vector3();
  camera.getWorldDirection(n);
  n.y = 0;
  if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
  return new THREE.Plane().setFromNormalAndCoplanarPoint(n.normalize(), p);
}

/** Start dragging `fixture` along its drag plane from the current ray: the plane, and where on it the fixture sits relative to the pointer. */
function dragFrom(fixture: Xyz, vertical: boolean) {
  const plane = dragPlane(fixture, vertical);
  const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  const offset = hit ? new THREE.Vector3(fixture.x, fixture.y, fixture.z).sub(hit) : new THREE.Vector3();
  return { vertical, plane, offset };
}

const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
export const PLACE_OFFSET = 0.3;

/**
 * Where a place-mode click puts the new fixture (uses the current ray).
 *   click a wall/floor/ceiling   on its inside surface
 *   ⌥-click a wall               on the outside of the nearest wall
 *   click the ground off the box  standing on the ground, outside
 */
function placePosition(outside: boolean) {
  const snap = (p: THREE.Vector3) => p.set(snapLength(p.x), snapLength(p.y), snapLength(p.z));
  if (outside) {
    const hit = raycaster.intersectObject(boxOuter)[0];
    if (hit?.face) return snap(hit.point.clone().addScaledVector(hit.face.normal, PLACE_OFFSET));
  }
  const inner = raycaster.intersectObject(boxInner)[0];
  if (inner?.face) return snap(inner.point.clone().addScaledVector(inner.face.normal, -PLACE_OFFSET));
  const g = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
  if (!g || Math.hypot(g.x, g.z) > 100) return null;
  return snap(g.setY(PLACE_OFFSET));
}

export function updateGhost(e: PointerEvent | null) {
  // A position goes on the surface under the pointer, like an aim: show the target ring there.
  if (ui.placingPosition) {
    ghost.visible = ghostStem.visible = rigGhost.visible = false;
    const t = e ? (rayFromEvent(e), positionTarget()) : null;
    showPositionPreview(t?.p ?? null, t?.surface ?? null);
    return;
  }
  if (positionPreview.visible) { positionPreview.visible = false; requestRender(); }
  const p = ui.placing && e ? (rayFromEvent(e), placePosition(e.altKey)) : null;
  ghost.visible = ghostStem.visible = !!p;
  rigGhost.visible = !!p && !!ui.placingRig;
  if (!p) return;
  if (ui.placingRig) {
    const preview = { ...ui.placingRig, x: p.x, y: p.y, z: p.z };
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

/** Box surfaces by the (outward) normal of the face a ray hits from inside. */
function surfaceName(n: THREE.Vector3): string {
  if (Math.abs(n.y) > 0.5) return n.y < 0 ? "Floor" : "Ceiling";
  if (Math.abs(n.x) > 0.5) return n.x < 0 ? "Stage-right wall" : "Stage-left wall";
  return n.z < 0 ? "Upstage wall" : "Downstage edge";
}

/**
 * Where a new position would go (uses the current ray): the box surface under
 * the pointer, else the ground outside; snapped (0.1 m or 3 in), as the click puts it.
 */
function positionTarget(): { p: THREE.Vector3; surface: string } | null {
  const snap = (p: THREE.Vector3) => p.set(snapLength(p.x), snapLength(Math.max(0, p.y)), snapLength(p.z));
  const hit = raycaster.intersectObject(boxInner)[0];
  if (hit?.face) return { p: snap(hit.point.clone()), surface: surfaceName(hit.face.normal) };
  const g = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
  return g && Math.hypot(g.x, g.z) <= 100 ? { p: snap(g), surface: "Ground, outside the box" } : null;
}

/** Aim target under the pointer (uses the current ray): a box surface, else the ground. */
function aimPosition() {
  const hit = raycaster.intersectObject(boxInner)[0];
  if (hit) return hit.point.clone();
  const g = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
  return g && Math.hypot(g.x, g.z) <= 100 ? g : null;
}

/** Show the aim marker at `p` (or hide it), with lines from the selected fixtures unless `lines` is false. */
export function showAimPreview(p: THREE.Vector3 | null, lines = true) {
  requestRender();
  aimMarker.visible = !!p;
  aimLines.visible = !!p && lines;
  if (!p) return;
  aimMarker.position.copy(p);
  // Face the camera so the ring always reads as a target.
  aimMarker.quaternion.copy(camera.quaternion);
  const pts = aimLines.geometry.attributes.position;
  const sel = selectedFixtures();
  sel.forEach((fixture, k) => {
    pts.setXYZ(k * 2, fixture.x, fixture.y, fixture.z);
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
  if (ui.placing || ui.aiming) return;
  const id = pickFixture(e);
  // No fixture there: a named position? Drag it over the surfaces.
  const positionId = id ? null : pickPosition(e);
  if (positionId) {
    const position = positionById(positionId);
    // From where it's pressed (pickPosition just set the ray), as fixtures are.
    dragPosition = { id: positionId, active: false, move: position ? dragFrom(position, e.shiftKey) : null };
    controls.enabled = false;
    renderer.domElement.setPointerCapture(e.pointerId);
    return;
  }
  if (!id) return;
  const fixture = byId(id);
  if (!fixture) return;
  drag3d = { id, shift: e.shiftKey, active: false, ...dragFrom(fixture, e.shiftKey) };
  controls.enabled = false;
  renderer.domElement.setPointerCapture(e.pointerId);
}, true);

view.addEventListener("pointermove", (e) => {
  if (e.target !== renderer.domElement) return;
  if (dragPosition) {
    if (!dragPosition.active && downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) <= DRAG_THRESHOLD) return;
    dragPosition.active = true;
    renderer.domElement.style.cursor = "grabbing";
    const position = positionById(dragPosition.id);
    if (!position) return;
    rayFromEvent(e);
    if (dragPosition.move?.vertical !== e.shiftKey) dragPosition.move = dragFrom(position, e.shiftKey);
    const hit = raycaster.ray.intersectPlane(dragPosition.move.plane, new THREE.Vector3());
    if (!hit) return;
    hit.add(dragPosition.move.offset);
    // ⇧: up and down only; else level (kept near the stage at grazing angles).
    if (e.shiftKey) position.y = snapLength(clamp(hit.y, 0, 50));
    else { position.x = snapLength(clamp(hit.x, -100, 100)); position.z = snapLength(clamp(hit.z, -100, 100)); }
    const where = position.y < 0.05 ? "Floor" : "raised";
    showPositionPreview(new THREE.Vector3(position.x, position.y, position.z), isInside(position, state.box) ? where : `${where}, outside the box`, position.name);
    changed({ list: false, inspector: false });
    return;
  }
  if (!drag3d) {
    if (ui.placing) updateGhost(e);
    else if (ui.aiming) { rayFromEvent(e); showAimPreview(aimPosition()); }
    else if (!e.buttons) {
      const fixture = pickFixture(e);
      const position = fixture ? null : pickPosition(e);
      setHoverPosition(position);
      renderer.domElement.style.cursor = fixture || position ? "grab" : "";
    }
    return;
  }
  if (!drag3d.active) {
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) <= DRAG_THRESHOLD) return;
    drag3d.active = true;
    if (!state.selected.includes(drag3d.id)) select(drag3d.id);
    renderer.domElement.style.cursor = "grabbing";
  }
  const fixture = byId(drag3d.id);
  if (!fixture) return;
  rayFromEvent(e);
  // ⇧ pressed or let go mid-drag: switch between sliding and raising / lowering, from where it is now.
  if (e.shiftKey !== drag3d.vertical) Object.assign(drag3d, dragFrom(fixture, e.shiftKey));
  const hit = raycaster.ray.intersectPlane(drag3d.plane, new THREE.Vector3());
  if (!hit) return;
  hit.add(drag3d.offset);
  const s = (v: number) => snapLength(v, e.altKey);
  if (drag3d.vertical) {
    moveFixture(fixture, fixture.x, clamp(s(hit.y), 0, 50), fixture.z);
  } else {
    // Keep the camera from flinging it off to the horizon at grazing angles.
    moveFixture(fixture, clamp(s(hit.x), -100, 100), fixture.y, clamp(s(hit.z), -100, 100));
  }
  changed({ list: false });
}, true);

// Double-click a rig's fixture: select the whole rig.
view.addEventListener("dblclick", (e) => {
  if (e.target !== renderer.domElement || ui.placing || ui.aiming) return;
  const id = pickFixture(e);
  if (id) selectRigOf(id);
}, true);

renderer.domElement.addEventListener("pointerleave", () => { updateGhost(null); showAimPreview(null); if (!dragPosition) setHoverPosition(null); });

let rightDownAt: { x: number; y: number } | null = null;
view.addEventListener("pointerdown", (e) => {
  if (e.target === renderer.domElement && e.button === 2) rightDownAt = { x: e.clientX, y: e.clientY };
}, true);
view.addEventListener("contextmenu", (e) => {
  if (e.target !== renderer.domElement) return;
  e.preventDefault();
  // ctrl-click (Mac) has no right-button press; treat it as a still click.
  const still = rightDownAt ? Math.hypot(e.clientX - rightDownAt.x, e.clientY - rightDownAt.y) <= DRAG_THRESHOLD : e.ctrlKey;
  rightDownAt = null;
  if (!still || ui.placing || ui.aiming) return;
  const id = pickFixture(e);
  if (id) { openContextMenu(id, e.clientX, e.clientY); return; }
  const positionId = pickPosition(e);
  if (positionId) openPositionMenu(positionId, e.clientX, e.clientY);
}, true);

view.addEventListener("pointerup", (e) => {
  if (e.target !== renderer.domElement || e.button !== 0) return;
  const moved = downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > DRAG_THRESHOLD;
  const dp = dragPosition;
  if (dp) {
    dragPosition = null;
    controls.enabled = true;
    renderer.domElement.style.cursor = "grab";
    if (dp.active) {
      const position = positionById(dp.id);
      showPositionPreview(null, null, position?.name ?? "");
      setActivePosition(dp.id);
      changed();
    } else setActivePosition(ui.activePosition === dp.id ? null : dp.id);
    return;
  }
  const d = drag3d;
  drag3d = null;
  controls.enabled = true;
  if (d) {
    renderer.domElement.style.cursor = "grab";
    if (d.active) changed();
    else if (e.altKey) showTrace({ kind: "stageFixture", id: d.id }, e);
    else select(d.id, d.shift);
    return;
  }
  if (!downAt || moved) return;
  rayFromEvent(e);

  if (ui.placingPosition) {
    const t = positionTarget();
    if (t) addPositionAt(t.p.x, t.p.y, t.p.z);
    return;
  }
  if (ui.placing) {
    const p = placePosition(e.altKey);
    if (p) (ui.placingRig ? addRigAt(ui.placingRig, p.x, p.y, p.z) : addFixtureAt(p.x, p.y, p.z));
    return;
  }
  if (ui.aiming) {
    const p = aimPosition();
    if (p) applyAim(p);
    return;
  }
  if (!e.shiftKey) select(null);
}, true);

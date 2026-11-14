// The 3D view: the box, the fixtures and their beams, and picking, placing,
// dragging and aiming with the mouse.
import * as THREE from "three";
import { describeSpot, gridStep, lengthUnit, onUnitChange, snapLength } from "./units.ts";
import { alwaysShowNames, onNamesChange } from "./names.ts";

/** Grid squares per major square: 5 in feet, 1 in meters. */
const majorEvery = () => (lengthUnit() === "ft" ? 5 : 1);
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  MAX_FIXTURES,
  DEG,
  FORWARD,
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
import { rotate, type Vec } from "./rotation.ts";
import { state, byId, selectedFixtures, moveFixture, addRigAt, positionById, riserById, ui } from "./state.ts";
import { RISER_DEFAULTS, RISER_MIN, RISER_MAX_H, SIZE_HANDLES, TURN_HANDLE_GAP, resizeTo, yawToward, type Riser, type RiserHandle } from "./risers.ts";
import { runFrameStart } from "./frame.ts";
import { look, changed, select, selectRigOf, applyAim, addFixtureAt, addPositionAt, addRiserAt, setActivePosition, setActiveRiser, setHoverItem, setHoverPosition, setBanner, openContextMenu, openPositionMenu, openRiserMenu, showPositionSpot, describeRiser } from "./actions.ts";
import { followingOf } from "./follow.ts";
import { showTrace } from "./stage.ts";
import { isPresent } from "../shared/guards.ts";
import { elById } from "../shared/query.ts";

/** The model's plain vectors (./rotation.ts) as three.js ones, to draw. */
const toVector3 = (p: Vec) => new THREE.Vector3(p.x, p.y, p.z);

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

// The ground outside the box: a grid of 1 m or 5 ft squares (units.ts), about 80 m across.
let ground = makeGround();
scene.add(ground);
function makeGround() {
  const step = gridStep() * majorEvery();
  const n = Math.round(80 / step);
  const grid = new THREE.GridHelper(n * step, n, 0x1c2027, 0x15181d);
  grid.position.y = -0.002;
  return grid;
}

const uniforms = {
  /** One grid square on the box's surfaces, in meters, and how many make a major one (feet: 1 ft lines, 5 ft squares). */
  uGrid: { value: gridStep() },
  uMajor: { value: majorEvery() },
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
  /** The surface's own color (risers are a little lighter and warmer than the box). */
  uBase: { value: new THREE.Vector3(0.075, 0.08, 0.095) },
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
  uniform float uGrid;
  uniform float uMajor;
  uniform vec3 uBase;
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
    // Major lines always; the ones between fade out where they'd crowd together.
    vec2 fine = uv / uGrid;
    float crowd = smoothstep(0.12, 0.3, max(fwidth(fine).x, fwidth(fine).y));
    float grid = uMajor > 1.0 ? max(gridLine(fine / uMajor), gridLine(fine) * 0.6 * (1.0 - crowd)) : gridLine(fine);
    vec3 base = uBase + grid * 0.06;
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
// (The shaders' derivatives, dFdx / dFdy, are built into WebGL 2: nothing to switch on.)
const passMaterial = (pass: number, opts: THREE.ShaderMaterialParameters) => new THREE.ShaderMaterial({
  uniforms: { ...uniforms, uPass: { value: pass } },
  vertexShader, fragmentShader, ...opts,
});
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
  line.geometry = new THREE.BufferGeometry().setFromPoints(rigOutline(rig).map(toVector3));
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

/**
 * Point a two-point line from `a` to `b`, keeping its bounds (so it isn't
 * culled) and its dashes up to date.
 */
function setLine(line: THREE.Line, a: Xyz, b: Xyz) {
  const pts = line.geometry.attributes.position;
  pts.setXYZ(0, a.x, a.y, a.z);
  pts.setXYZ(1, b.x, b.y, b.z);
  pts.needsUpdate = true;
  line.geometry.computeBoundingSphere();
  line.computeLineDistances();
}

/** Drop a label sprite and its texture. */
function disposeLabel(label: THREE.Sprite) {
  label.material.map?.dispose();
  label.material.dispose();
}

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

// Risers: solid boxes standing on the floor, lit by the beams like the box's
// surfaces (the same shader), with sand-colored edges and the name on top.
const RISER_COLOR = 0xc9b58a; // the same as --riser in stage.css
const riserGeom = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const riserEdgesGeom = new THREE.EdgesGeometry(riserGeom);
const riserMat = new THREE.ShaderMaterial({
  uniforms: { ...uniforms, uPass: { value: 0 }, uFaceAlpha: { value: new Float32Array(6).fill(1) }, uBase: { value: new THREE.Vector3(0.12, 0.11, 0.1) } },
  vertexShader, fragmentShader, side: THREE.FrontSide,
});
type RiserVisual = { group: THREE.Group; mesh: THREE.Mesh; edges: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>; label: THREE.Sprite; text: string };
const riserVisuals = new Map<string, RiserVisual>();

// The picked-out riser's handles (one set, moved onto whichever riser is
// picked out): boxes on its top corners and edges to resize it, a knob past
// its upstage edge to turn it, an arrow above it for its height. Drawn over
// everything, with bigger invisible targets for the mouse.
const handleMat = new THREE.MeshBasicMaterial({ color: 0xe8e4dc, depthTest: false });
const handleLineMat = new THREE.LineDashedMaterial({ color: 0xe8e4dc, dashSize: 0.08, gapSize: 0.06, depthTest: false });
const handleGroup = new THREE.Group();
const handlePickGeom = new THREE.SphereGeometry(0.22, 10, 8);
/** A handle mesh, with a bigger invisible target; both carry the handle. */
function makeHandle(geom: THREE.BufferGeometry, handle: RiserHandle) {
  const mesh = new THREE.Mesh(geom, handleMat);
  mesh.renderOrder = 12;
  const pick = new THREE.Mesh(handlePickGeom, new THREE.MeshBasicMaterial({ visible: false }));
  mesh.userData.handle = pick.userData.handle = handle;
  mesh.add(pick);
  handleGroup.add(mesh);
  return mesh;
}
const sizeHandles = SIZE_HANDLES.map((h) => ({ h, mesh: makeHandle(new THREE.BoxGeometry(0.14, 0.14, 0.14), h) }));
const turnHandle = makeHandle(new THREE.SphereGeometry(0.1, 16, 12), { kind: "turn" });
const heightHandle = makeHandle(new THREE.ConeGeometry(0.09, 0.2, 16), { kind: "height" });
const stemLine = () => {
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), handleLineMat);
  line.renderOrder = 12;
  handleGroup.add(line);
  return line;
};
const turnStem = stemLine();
const heightStem = stemLine();
/** How far above the top the height arrow sits (clear of the name label). */
const HEIGHT_HANDLE_RISE = 0.5;

/** Put the handles on the picked-out riser (in its own turned frame), or take them off. */
function syncHandles() {
  const riser = riserById(ui.activeRiser);
  const v = riser ? riserVisuals.get(riser.id) : null;
  if (!riser || !v) { handleGroup.removeFromParent(); return; }
  if (handleGroup.parent !== v.group) v.group.add(handleGroup);
  const { w, d, h } = riser;
  for (const { h: hd, mesh } of sizeHandles) mesh.position.set((hd.su * w) / 2, h, (hd.sv * d) / 2);
  turnHandle.position.set(0, h, -(d / 2 + TURN_HANDLE_GAP));
  setLine(turnStem, new THREE.Vector3(0, h, -d / 2), turnHandle.position);
  heightHandle.position.set(0, h + HEIGHT_HANDLE_RISE, 0);
  setLine(heightStem, new THREE.Vector3(0, h, 0), new THREE.Vector3(0, h + HEIGHT_HANDLE_RISE - 0.1, 0));
  v.group.updateMatrixWorld(true);
}

/** The picked-out riser's handle under the pointer (uses the current ray), or null. */
function pickHandle(e: MouseEvent): RiserHandle | null {
  if (!handleGroup.parent) return null;
  rayFromEvent(e);
  const meshes = [...sizeHandles.map((s) => s.mesh), turnHandle, heightHandle];
  return raycaster.intersectObjects(meshes, true)[0]?.object.userData.handle ?? null;
}

/** The mouse cursor over a handle. */
const handleCursor = (h: RiserHandle) => (h.kind === "turn" ? "grab" : h.kind === "height" ? "ns-resize" : "move");

/**
 * Dragging a handle: on a level plane at the riser's top (size, turn), or an
 * upright one facing the camera (height, with where the pointer was from the top).
 */
let dragHandle: { id: string; handle: RiserHandle; active: boolean; plane: THREE.Plane; offsetY: number } | null = null;

function syncRisers() {
  const ids = new Set(state.risers.map((r) => r.id));
  for (const [id, v] of riserVisuals) {
    if (ids.has(id)) continue;
    scene.remove(v.group);
    v.edges.material.dispose();
    disposeLabel(v.label);
    riserVisuals.delete(id);
  }
  for (const riser of state.risers) syncRiser(riser);
  syncHandles();
}

function syncRiser(riser: Riser) {
  let v = riserVisuals.get(riser.id);
  if (!v) {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(riserGeom, riserMat);
    mesh.userData.riserId = riser.id;
    const edges = new THREE.LineSegments(riserEdgesGeom, new THREE.LineBasicMaterial({ color: RISER_COLOR }));
    const label = makeLabel(riser.name, 0.26, "#c9b58a");
    group.add(mesh, edges, label);
    scene.add(group);
    v = { group, mesh, edges, label, text: riser.name };
    riserVisuals.set(riser.id, v);
  }
  if (v.text !== riser.name) {
    v.group.remove(v.label);
    disposeLabel(v.label);
    v.label = makeLabel(riser.name, 0.26, "#c9b58a");
    v.text = riser.name;
    v.group.add(v.label);
  }
  v.group.position.set(riser.x, 0, riser.z);
  v.group.rotation.y = riser.yaw * DEG;
  v.mesh.scale.set(riser.w, riser.h, riser.d);
  v.edges.scale.copy(v.mesh.scale);
  const on = ui.activeRiser === riser.id;
  v.edges.material.color.set(on ? 0xffffff : RISER_COLOR);
  v.label.position.set(0, riser.h + 0.08, 0);
  v.label.visible = on || ui.hoverRiser === riser.id || alwaysShowNames();
  v.group.updateMatrixWorld();
}

/** Riser meshes, for picking and for what a click lands on. */
const riserMeshes = () => [...riserVisuals.values()].map((v) => v.mesh);

/** The riser under the pointer (uses the current ray), or null. */
function pickRiser(e: MouseEvent): string | null {
  rayFromEvent(e);
  return raycaster.intersectObjects(riserMeshes())[0]?.object.userData.riserId ?? null;
}

/**
 * The first surface the current ray hits: the box's inside or a riser.
 * `normal` is the hit face's outward normal in the world (a riser's) or the
 * box face's outward normal (the box's, which the ray sees from inside).
 */
function surfaceHit(): { point: THREE.Vector3; normal: THREE.Vector3; riser: Riser | null } | null {
  const hit = raycaster.intersectObjects([boxInner, ...riserMeshes()])[0];
  if (!hit?.face) return null;
  const riser = riserById(hit.object.userData.riserId) ?? null;
  const normal = riser ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : hit.face.normal.clone();
  return { point: hit.point.clone(), normal, riser };
}

// Placing a riser: its outline where it would stand.
const riserGhost = new THREE.LineSegments(riserEdgesGeom, new THREE.LineBasicMaterial({ color: 0x00dddd, depthTest: false }));
riserGhost.renderOrder = 10;
riserGhost.scale.set(RISER_DEFAULTS.w, RISER_DEFAULTS.h, RISER_DEFAULTS.d);
riserGhost.visible = false;
scene.add(riserGhost);

/** Where a new riser's center would go (uses the current ray): the floor / ground under the pointer, snapped. */
function riserSpot(): THREE.Vector3 | null {
  const g = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
  if (!g || Math.hypot(g.x, g.z) > 100) return null;
  return g.set(snapLength(g.x), 0, snapLength(g.z));
}

/**
 * Dragging a riser over the floor (only the picked-out one, so dragging
 * elsewhere still turns the view): the plane at its top, and where the
 * riser's center is from the pointer on it.
 */
let dragRiser: { id: string; active: boolean; plane: THREE.Plane; offset: THREE.Vector3 } | null = null;

function syncPositions() {
  const ids = new Set(state.positions.map((p) => p.id));
  for (const [id, v] of positionVisuals) {
    if (ids.has(id)) continue;
    scene.remove(v.group);
    disposeLabel(v.label);
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
    disposeLabel(v.label);
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
  v.label.visible = on || hover || alwaysShowNames();
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
  setLine(previewAxes.x, { x: x0, y: p.y, z: p.z }, { x: x1, y: p.y, z: p.z });
  setLine(previewAxes.y, { x: p.x, y: y0, z: p.z }, { x: p.x, y: y1, z: p.z });
  setLine(previewAxes.z, { x: p.x, y: p.y, z: z0 }, { x: p.x, y: p.y, z: z1 });
  const text = describeSpot(p, surface);
  if (text !== previewText) {
    if (previewLabel) { positionPreview.remove(previewLabel); disposeLabel(previewLabel); }
    previewLabel = makeLabel(text, 0.3, "#c58cff");
    previewText = text;
    positionPreview.add(previewLabel);
  }
  previewLabel?.position.set(p.x + 0.2, p.y + 0.2, p.z);
  showPositionSpot(text, moving);
}

/** The hovered fixture's name in 3D (fixtures have no names there otherwise). */
let fixtureName: { sprite: THREE.Sprite; text: string } | null = null;

function syncFixtureName() {
  const fixture = state.fixtures.find((f) => f.id === ui.hoverFixture);
  if (fixtureName && fixtureName.text !== fixture?.name) {
    scene.remove(fixtureName.sprite);
    disposeLabel(fixtureName.sprite);
    fixtureName = null;
  }
  if (!fixture) return;
  if (!fixtureName) {
    fixtureName = { sprite: makeLabel(fixture.name, 0.28), text: fixture.name };
    fixtureName.sprite.renderOrder = 11;
    fixtureName.sprite.material.depthTest = false; // over the fixture's own body
    scene.add(fixtureName.sprite);
  }
  fixtureName.sprite.position.set(fixture.x, fixture.y + 0.35, fixture.z);
}

export function syncScene() {
  requestRender();
  syncPositions();
  syncRisers();
  syncFixtureName();
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
    const dir = toVector3(rotate(FORWARD, q));
    const lk = look(fixture);
    const color = new THREE.Color(lk.color);
    const sel = state.selected.includes(fixture.id);

    v.group.position.set(fixture.x, fixture.y, fixture.z);
    v.aim.quaternion.set(q.x, q.y, q.z, q.w);
    const zero = baseQuat(fixture);
    v.zero.quaternion.set(zero.x, zero.y, zero.z, zero.w);
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
    // In step with the dimmer from zero (no floor), so a low level looks low: dimmer 1 is a faint beam.
    v.cone.material.opacity = 0.22 * lk.intensity;
    v.cone.visible = lk.intensity > 0.001;
    v.lens.material.color.copy(color).multiplyScalar(0.25 + 0.75 * lk.intensity);

    setLine(v.axis, fixture, new THREE.Vector3(fixture.x, fixture.y, fixture.z).addScaledVector(dir, len));
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

/**
 * The stage's pane of the app: while it's hidden (Console view), nothing is
 * drawn; the scene still keeps up. The page hides it with an inline
 * `visibility` (../page/page.ts place()), read here as is: asking for the
 * computed style every frame made the browser recalculate the page's styles
 * each time (1.6 ms a frame during a fade, more than drawing the stage).
 */
const pane = view.closest<HTMLElement>("[data-pane]");

renderer.setAnimationLoop(() => {
  runFrameStart();
  const moved = controls.update();
  if (!moved && !needsRender) return;
  if (pane?.style.visibility === "hidden") { needsRender = true; return; }
  needsRender = false;
  renderer.render(scene, camera);
});

// 3D picking, placing and dragging.
//   click fixture      select (⌘ or ⇧ adds/removes)
//   drag fixture       slide it horizontally at its current height
//   ⇧-drag fixture     raise / lower it
//   drag empty space      orbit (OrbitControls)
// Listeners sit on the parent in the capture phase so we can switch
// OrbitControls off before it sees a press that lands on a fixture.
const raycaster = new THREE.Raycaster();
const DRAG_THRESHOLD = 4;
/** Has the pointer gone further than a click from where it was pressed (`at`)? */
const movedFrom = (e: MouseEvent, at: { x: number; y: number } | null) => !!at && Math.hypot(e.clientX - at.x, e.clientY - at.y) > DRAG_THRESHOLD;
let downAt: { x: number; y: number } | null = null;
/** `add`: ⇧- or ⌘-click, which adds the fixture to the selection (or takes it out). */
let drag3d: null | { id: string; add: boolean; active: boolean; vertical: boolean; plane: THREE.Plane; offset: THREE.Vector3 } = null;

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
  const hit = surfaceHit();
  // Into the box from its inside; off a riser's face, out from it.
  if (hit) return snap(hit.point.addScaledVector(hit.normal, hit.riser ? PLACE_OFFSET : -PLACE_OFFSET));
  const g = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
  if (!g || Math.hypot(g.x, g.z) > 100) return null;
  return snap(g.setY(PLACE_OFFSET));
}

export function updateGhost(e: PointerEvent | null) {
  if (ui.placingRiser) {
    ghost.visible = ghostStem.visible = rigGhost.visible = false;
    if (e) rayFromEvent(e);
    const p = e ? riserSpot() : null;
    riserGhost.visible = !!p;
    if (p) riserGhost.position.copy(p);
    requestRender();
    return;
  }
  if (riserGhost.visible) { riserGhost.visible = false; requestRender(); }
  // A position goes on the surface under the pointer, like an aim: show the target ring there.
  if (ui.placingPosition) {
    ghost.visible = ghostStem.visible = rigGhost.visible = false;
    if (e) rayFromEvent(e);
    const t = e ? positionTarget() : null;
    showPositionPreview(t?.p ?? null, t?.surface ?? null);
    return;
  }
  if (positionPreview.visible) { positionPreview.visible = false; requestRender(); }
  if (ui.placing && e) rayFromEvent(e);
  const p = ui.placing && e ? placePosition(e.altKey) : null;
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
  setLine(ghostStem, p, { x: p.x, y: 0, z: p.z });
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
  const hit = surfaceHit();
  if (hit?.riser) {
    // On a riser's top: at its height exactly (snapping could sink it or lift it off).
    const top = hit.normal.y > 0.5;
    const p = snap(hit.point);
    if (top) p.y = hit.riser.h;
    return { p, surface: `${hit.riser.name} (${top ? "top" : "side"})` };
  }
  if (hit) return { p: snap(hit.point), surface: surfaceName(hit.normal) };
  const g = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
  return g && Math.hypot(g.x, g.z) <= 100 ? { p: snap(g), surface: "Ground, outside the box" } : null;
}

/** Aim target under the pointer (uses the current ray): a box surface, else the ground. */
function aimPosition() {
  const hit = surfaceHit();
  if (hit) return hit.point;
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
  // The picked-out riser's handles come first: they're small, and sit on its edges.
  const handle = pickHandle(e);
  const handleRiser = handle ? riserById(ui.activeRiser) : null;
  if (handle && handleRiser) {
    const top = new THREE.Vector3(handleRiser.x, handleRiser.h, handleRiser.z);
    const plane = handle.kind === "height" ? dragPlane(top, true) : new THREE.Plane(new THREE.Vector3(0, 1, 0), -handleRiser.h);
    const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    dragHandle = { id: handleRiser.id, handle, active: false, plane, offsetY: hit ? handleRiser.h - hit.y : 0 };
    controls.enabled = false;
    renderer.domElement.setPointerCapture(e.pointerId);
    return;
  }
  const id = pickFixture(e);
  // No fixture there: a named position? Drag it over the surfaces.
  const positionId = id ? null : pickPosition(e);
  // Nor a position: a riser? Pressing the picked-out one drags it; others are picked out on release.
  const riserId = id || positionId ? null : pickRiser(e);
  if (riserId && riserId === ui.activeRiser) {
    const riser = riserById(riserId);
    if (riser) {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -riser.h);
      const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
      dragRiser = { id: riserId, active: false, plane, offset: hit ? new THREE.Vector3(riser.x, 0, riser.z).sub(hit.setY(0)) : new THREE.Vector3() };
      controls.enabled = false;
      renderer.domElement.setPointerCapture(e.pointerId);
      return;
    }
  }
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
  drag3d = { id, add: e.shiftKey || e.metaKey, active: false, ...dragFrom(fixture, e.shiftKey) };
  controls.enabled = false;
  renderer.domElement.setPointerCapture(e.pointerId);
}, true);

view.addEventListener("pointermove", (e) => {
  if (e.target !== renderer.domElement) return;
  if (dragHandle) {
    if (!dragHandle.active && !movedFrom(e, downAt)) return;
    dragHandle.active = true;
    const riser = riserById(dragHandle.id);
    if (!riser) return;
    rayFromEvent(e);
    const hit = raycaster.ray.intersectPlane(dragHandle.plane, new THREE.Vector3());
    if (!hit) return;
    const h = dragHandle.handle;
    const snap = (v: number) => snapLength(v, e.altKey);
    if (h.kind === "size") Object.assign(riser, resizeTo(riser, h.su, h.sv, hit.x, hit.z, snap));
    else if (h.kind === "turn") riser.yaw = yawToward(riser, hit.x, hit.z, e.altKey ? 1 : 15) ?? riser.yaw;
    else riser.h = clamp(snap(hit.y + dragHandle.offsetY), RISER_MIN, RISER_MAX_H);
    setBanner(`${riser.name}: ${describeRiser(riser)} · ⌥ = fine`);
    changed({ list: false, inspector: false });
    return;
  }
  if (dragRiser) {
    if (!dragRiser.active && !movedFrom(e, downAt)) return;
    dragRiser.active = true;
    renderer.domElement.style.cursor = "grabbing";
    const riser = riserById(dragRiser.id);
    if (!riser) return;
    rayFromEvent(e);
    const hit = raycaster.ray.intersectPlane(dragRiser.plane, new THREE.Vector3());
    if (!hit) return;
    hit.setY(0).add(dragRiser.offset);
    const s = (v: number) => snapLength(clamp(v, -100, 100), e.altKey);
    riser.x = s(hit.x);
    riser.z = s(hit.z);
    setBanner(`Moving ${riser.name}: ${describeSpot({ x: riser.x, y: riser.h, z: riser.z })} · ⌥ = fine`);
    changed({ list: false, inspector: false });
    return;
  }
  if (dragPosition) {
    if (!dragPosition.active && !movedFrom(e, downAt)) return;
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
      const handle = pickHandle(e);
      const under = handle || fixture || position ? null : pickRiser(e);
      setHoverItem(fixture, under);
      const riser = ui.activeRiser ? under : null;
      renderer.domElement.style.cursor = handle ? handleCursor(handle) : fixture || position || (riser && riser === ui.activeRiser) ? "grab" : "";
    }
    return;
  }
  if (!drag3d.active) {
    if (!movedFrom(e, downAt)) return;
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

renderer.domElement.addEventListener("pointerleave", () => { updateGhost(null); showAimPreview(null); if (!dragPosition) setHoverPosition(null); setHoverItem(null, null); });

let rightDownAt: { x: number; y: number } | null = null;
view.addEventListener("pointerdown", (e) => {
  if (e.target === renderer.domElement && e.button === 2) rightDownAt = { x: e.clientX, y: e.clientY };
}, true);
view.addEventListener("contextmenu", (e) => {
  if (e.target !== renderer.domElement) return;
  e.preventDefault();
  // ctrl-click (Mac) has no right-button press; treat it as a still click.
  const still = rightDownAt ? !movedFrom(e, rightDownAt) : e.ctrlKey;
  rightDownAt = null;
  if (!still || ui.placing || ui.aiming) return;
  const id = pickFixture(e);
  if (id) { openContextMenu(id, e.clientX, e.clientY); return; }
  const positionId = pickPosition(e);
  if (positionId) { openPositionMenu(positionId, e.clientX, e.clientY); return; }
  const riserId = pickRiser(e);
  if (riserId) openRiserMenu(riserId, e.clientX, e.clientY);
}, true);

view.addEventListener("pointerup", (e) => {
  if (e.target !== renderer.domElement || e.button !== 0) return;
  const moved = movedFrom(e, downAt);
  const dh = dragHandle;
  if (dh) {
    dragHandle = null;
    controls.enabled = true;
    if (dh.active) { setBanner(null); changed(); }
    return;
  }
  const dr = dragRiser;
  if (dr) {
    dragRiser = null;
    controls.enabled = true;
    renderer.domElement.style.cursor = "grab";
    if (dr.active) { setBanner(null); changed(); }
    else setActiveRiser(null); // a click on the picked-out riser puts it back
    return;
  }
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
    else select(d.id, d.add);
    return;
  }
  if (!downAt || moved) return;
  rayFromEvent(e);

  if (ui.placingRiser) {
    const p = riserSpot();
    if (p) addRiserAt(p.x, p.z);
    return;
  }
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
  // A riser clicked (not a fixture or position): pick it out.
  const riserId = pickRiser(e);
  if (riserId) { setActiveRiser(riserId); return; }
  if (!e.shiftKey && !e.metaKey) select(null);
  if (ui.activeRiser) setActiveRiser(null);
}, true);

// Meters or feet: the grids follow.
onNamesChange(() => syncScene());
onUnitChange(() => {
  scene.remove(ground);
  ground.geometry.dispose();
  (ground.material as THREE.Material).dispose();
  ground = makeGround();
  scene.add(ground);
  uniforms.uGrid.value = gridStep();
  uniforms.uMajor.value = majorEvery();
  requestRender();
});

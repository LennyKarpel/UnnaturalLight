// The 3D view: the box, the fixtures and their beams, and picking, placing,
// dragging and aiming with the mouse.
import * as THREE from "three";
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
} from "./stage-model.js";
import { clamp } from "../shared/numbers.js";
import { state, byId, selectedFixtures, moveFixture, addRigAt, ui } from "./state.js";
import { look, changed, select, applyAim, addFixtureAt, openContextMenu } from "./actions.js";
import { showTrace } from "./stage.js";

// ---------------------------------------------------------------------
// 3D scene
// ---------------------------------------------------------------------

export const view = document.getElementById("view");
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

/** @type {Map<string, {group: THREE.Group, aim: THREE.Group, body: THREE.Mesh, lens: THREE.Mesh, cone: THREE.Mesh, ring: THREE.Mesh, zero: THREE.Group, axis: THREE.Line, pick: THREE.Mesh}>} */
const visuals = new Map();

function makeVisual(fixture) {
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

export function syncScene() {
  requestRender();
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
  const selRigs = new Set(selectedFixtures().map((i) => i.rigId).filter(Boolean));
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
const pane = view.closest("[data-pane]");

renderer.setAnimationLoop(() => {
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

function pickFixture(e) {
  rayFromEvent(e);
  const targets = [...visuals.values()].map((v) => v.pick);
  return raycaster.intersectObjects(targets)[0]?.object.userData.fixtureId ?? null;
}

/** Horizontal plane through the fixture, or (⇧) a vertical one facing the camera. */
function dragPlane(fixture, vertical) {
  const p = new THREE.Vector3(fixture.x, fixture.y, fixture.z);
  if (!vertical) return new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), p);
  const n = new THREE.Vector3();
  camera.getWorldDirection(n);
  n.y = 0;
  if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
  return new THREE.Plane().setFromNormalAndCoplanarPoint(n.normalize(), p);
}

const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
export const PLACE_OFFSET = 0.3;

/**
 * Where a place-mode click puts the new fixture (uses the current ray).
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

export function updateGhost(e) {
  const p = ui.placing && e ? (rayFromEvent(e), placePoint(e.altKey)) : null;
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

/** Aim target under the pointer (uses the current ray): a box surface, else the ground. */
function aimPoint() {
  const hit = raycaster.intersectObject(boxInner)[0];
  if (hit) return hit.point.clone();
  const g = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
  return g && Math.hypot(g.x, g.z) <= 100 ? g : null;
}

/** Show the aim marker at `p` (or hide it) with lines from the selected fixtures. */
export function showAimPreview(p) {
  aimMarker.visible = aimLines.visible = !!p;
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
  if (!id) return;
  const fixture = byId(id);
  const plane = dragPlane(fixture, e.shiftKey);
  const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  const offset = hit ? new THREE.Vector3(fixture.x, fixture.y, fixture.z).sub(hit) : new THREE.Vector3();
  drag3d = { id, shift: e.shiftKey, active: false, plane, offset };
  controls.enabled = false;
  renderer.domElement.setPointerCapture(e.pointerId);
}, true);

view.addEventListener("pointermove", (e) => {
  if (e.target !== renderer.domElement) return;
  if (!drag3d) {
    if (ui.placing) updateGhost(e);
    else if (ui.aiming) { rayFromEvent(e); showAimPreview(aimPoint()); }
    else if (!e.buttons) renderer.domElement.style.cursor = pickFixture(e) ? "grab" : "";
    return;
  }
  if (!drag3d.active) {
    if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) <= DRAG_THRESHOLD) return;
    drag3d.active = true;
    if (!state.selected.includes(drag3d.id)) select(drag3d.id);
    renderer.domElement.style.cursor = "grabbing";
  }
  const fixture = byId(drag3d.id);
  if (!fixture) return;
  const hit = rayFromEvent(e).intersectPlane(drag3d.plane, new THREE.Vector3());
  if (!hit) return;
  hit.add(drag3d.offset);
  const snap = e.altKey ? 0.01 : 0.1;
  const s = (v) => round(Math.round(v / snap) * snap);
  if (drag3d.shift) {
    moveFixture(fixture, fixture.x, clamp(s(hit.y), 0, 50), fixture.z);
  } else {
    // Keep the camera from flinging it off to the horizon at grazing angles.
    moveFixture(fixture, clamp(s(hit.x), -100, 100), fixture.y, clamp(s(hit.z), -100, 100));
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
  if (!still || ui.placing || ui.aiming) return;
  const id = pickFixture(e);
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
    else if (e.altKey) showTrace({ kind: "stageFixture", id: d.id }, e);
    else select(d.id, d.shift);
    return;
  }
  if (!downAt || moved) return;
  rayFromEvent(e);

  if (ui.placing) {
    const p = placePoint(e.altKey);
    if (p) (ui.placingRig ? addRigAt(ui.placingRig, p.x, p.y, p.z) : addFixtureAt(p.x, p.y, p.z));
    return;
  }
  if (ui.aiming) {
    const p = aimPoint();
    if (p) applyAim(p);
    return;
  }
  if (!e.shiftKey) select(null);
}, true);

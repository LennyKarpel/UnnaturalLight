// Pan / tilt pad, shared by the console (under a fixture's pan / tilt faders)
// and the stage (in the inspector): hold the mouse button on it and move the
// mouse: left / right = pan, up / down = tilt. The pointer is locked while
// held, so it can't run off the pad.
// Styles: theme.css (.pt-pad).

/** DMX steps per pixel of mouse movement (⇧ = fine). */
const PAD_SPEED = 0.5;
const PAD_SPEED_FINE = 0.1;

/**
 * Make `pad` a pan / tilt pad.
 * - get(): the current { pan, tilt } (0–255), or null when there's nothing to move.
 * - set(pan, tilt): apply new whole values while dragging (only called on change).
 * - done(): the drag ended (e.g. save it).
 * @param {HTMLElement} pad
 * @param {{ get: () => { pan: number, tilt: number } | null, set: (pan: number, tilt: number) => void, done: () => void }} handlers
 */
export function bindPanTiltPad(pad, { get, set, done }) {
  pad.classList.add("pt-pad");
  let held = null;
  const move = (e) => {
    if (!held) return;
    const speed = e.shiftKey ? PAD_SPEED_FINE : PAD_SPEED;
    held.pan = Math.max(0, Math.min(255, held.pan + e.movementX * speed));
    held.tilt = Math.max(0, Math.min(255, held.tilt - e.movementY * speed));
    const p = Math.round(held.pan);
    const t = Math.round(held.tilt);
    const now = get();
    if (!now || (p === now.pan && t === now.tilt)) return;
    set(p, t);
  };
  const release = () => {
    if (!held) return;
    held = null;
    pad.classList.remove("is-held");
    pad.removeEventListener("pointermove", move);
    if (document.pointerLockElement === pad) document.exitPointerLock();
    done();
  };
  pad.addEventListener("pointerdown", (e) => {
    const now = get();
    if (e.button !== 0 || e.altKey || !now || pad.classList.contains("is-disabled")) return;
    e.preventDefault();
    e.stopPropagation();
    held = { ...now };
    pad.classList.add("is-held");
    pad.setPointerCapture(e.pointerId);
    pad.addEventListener("pointermove", move);
    try {
      pad.requestPointerLock()?.catch?.(() => {});
    } catch {
      // No pointer lock: pointer capture still tracks the drag.
    }
  });
  pad.addEventListener("click", (e) => e.stopPropagation());
  for (const type of ["pointerup", "pointercancel"]) pad.addEventListener(type, release);
}

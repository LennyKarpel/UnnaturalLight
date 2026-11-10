// Work done at the start of each 3D frame, before view3d.ts decides whether
// to draw it, so what it changes is drawn in that same frame. Its own module
// (no imports) so any stage module can register while the others load.

const frameStart: (() => void)[] = [];

/** Run `fn` at the start of every frame. */
export const onFrameStart = (fn: () => void) => { frameStart.push(fn); };

/** view3d.ts: start a frame. */
export function runFrameStart() {
  for (const fn of frameStart) fn();
}

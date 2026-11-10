/**
 * Which pane of the app (../index.html) the user is working in: the one last
 * clicked or focused, or the only one shown. Keys go to that pane (e.g. the
 * stage's arrow keys only move fixtures while you're working on the stage).
 */

export type Pane = "stage" | "console";

let active: Pane | null = null;

const track = (e: Event) => {
  const pane = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-pane]") : null;
  const name = pane?.dataset.pane;
  if (name === "stage" || name === "console") active = name;
};
document.addEventListener("pointerdown", track, true);
document.addEventListener("focusin", track, true);

export const activePane = () => active;

/** Make a pane the active one (e.g. when it becomes the only one shown). */
export function setActivePane(pane: Pane | null) {
  active = pane;
}

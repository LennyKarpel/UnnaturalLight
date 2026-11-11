// Whether the stage always shows the names of fixtures (in the plan),
// positions and risers (View settings, remembered in this browser). Off (the
// default): only what's under the pointer or picked out is named, so the view
// stays clear. A hovered fixture is named in 3D too.

import { readStored, store } from "../shared/storage.ts";

const NAMES_KEY = "unnaturallight.stage.names";

let always = readStored(NAMES_KEY) === "always";
const listeners: (() => void)[] = [];

export const alwaysShowNames = () => always;

export function setAlwaysShowNames(on: boolean) {
  if (on === always) return;
  always = on;
  store(NAMES_KEY, on ? "always" : "picked");
  for (const fn of listeners) fn();
}

/** Run `fn` whenever the setting changes. */
export function onNamesChange(fn: () => void) {
  listeners.push(fn);
}

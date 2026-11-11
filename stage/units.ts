// The unit lengths are shown and typed in: meters or feet (View settings,
// remembered in this browser). The stage's data is always in meters; only
// what people see and type is converted.

import { readStored, store } from "../shared/storage.ts";
import type { Xyz } from "./stage-model.ts";

const round = (v: number, n = 2) => Math.round(v * 10 ** n) / 10 ** n;

export const UNITS = ["m", "ft"] as const;
export type Unit = (typeof UNITS)[number];
const UNITS_KEY = "unnaturallight.stage.units";
const FT = 0.3048;

let unit: Unit = readStored(UNITS_KEY) === "ft" ? "ft" : "m";
const listeners: (() => void)[] = [];

export const lengthUnit = (): Unit => unit;
export const unitName = () => (unit === "ft" ? "feet" : "meters");

export function setLengthUnit(next: Unit) {
  if (next === unit) return;
  unit = next;
  store(UNITS_KEY, next);
  for (const fn of listeners) fn();
}

/** Run `fn` whenever the unit changes. */
export function onUnitChange(fn: () => void) {
  listeners.push(fn);
}

/** Meters → the shown unit (rounded for display: 2 decimals). */
export const toShown = (m: number) => round(unit === "ft" ? m / FT : m, 2);
/** A typed value in the shown unit → meters (kept precise enough to show the same number back). */
export const fromShown = (v: number) => (unit === "ft" ? round(v * FT, 4) : v);
/** A length typed in one unit, in another (2 decimals). */
export const convertLength = (v: number, from: Unit, to: Unit) => (from === to ? v : round(from === "ft" ? v * FT : v / FT, 2));
/** "3.2 m" / "10.5 ft" (one decimal). */
export const fmtLength = (m: number, digits = 1) => `${round(unit === "ft" ? m / FT : m, digits)} ${unit}`;
/** One decimal, no unit (for "x 1.2 · height 0 · z 2.8"). */
export const fmtNumber = (m: number) => String(round(unit === "ft" ? m / FT : m, 1));
/** What a drag or click snaps to, in meters: 0.1 m, or 3 inches in feet (`fine`: 1 cm / 1 inch). */
export const snapStep = (fine = false) => (unit === "ft" ? (fine ? FT / 12 : FT / 4) : fine ? 0.01 : 0.1);
/** Snap a length (meters) to the shown unit's step. */
export const snapLength = (m: number, fine = false) => {
  const s = snapStep(fine);
  return round(Math.round(m / s) * s, 4);
};
/** One grid square in meters (1 m, or 1 ft). */
export const gridStep = () => (unit === "ft" ? FT : 1);
/** A step for number inputs, in the shown unit. */
export const inputStep = () => (unit === "ft" ? "0.25" : "0.1");

/** Where a spot is, said for people: "x 1.2 (SL) · height 0 · z 2.8 (DS) m", plus the surface it's on if given. */
export function describeSpot(p: Xyz, surface?: string | null): string {
  const side = (v: number, minus: string, plus: string) => (Math.abs(v) < 0.05 ? "" : ` (${v < 0 ? minus : plus})`);
  const parts = [`x ${fmtNumber(p.x)}${side(p.x, "SR", "SL")}`, `height ${fmtNumber(p.y)}`, `z ${fmtNumber(p.z)}${side(p.z, "US", "DS")} ${unit}`];
  return parts.join(" · ") + (surface ? ` · ${surface}` : "");
}

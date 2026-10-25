/**
 * The live link between the console and the stage, inside the app (they're
 * one page, ../index.html): each side joins with the functions the other may
 * call (console/stage-link.js, stage/console-link.js) and calls the other's.
 * A call runs once the caller's current work is done (a microtask), so a side
 * never runs halfway through the other's update; one made before the other
 * side has joined is dropped (each says hello on joining). Other app windows
 * aren't on it: each window has its own console and stage, kept together by
 * the show server.
 */

/**
 * What the stage may call on the console:
 *   hello       the stage started (the console sends its levels now)
 *   set         set channels to values (moves the faders patched to them)
 *   register    create console fixtures for fixtures placed on the stage
 *               (the console answers with the stage's `registered`)
 *   unregister  remove console fixtures the stage registered
 *   select      console fixtures selected on the stage (the console highlights them)
 *   layouts     the stage's channel layouts (the console takes color roles its fixtures lack)
 * @typedef {{
 *   hello: () => void,
 *   set: (values: { channel: number, value: number }[]) => void,
 *   register: (requests: any[]) => void,
 *   unregister: (consoleIds: string[]) => void,
 *   select: (consoleIds: string[]) => void,
 *   layouts: (list: { consoleId: string | null, layout: (string | null)[] }[]) => void,
 * }} ConsoleEnd
 */

/**
 * What the console may call on the stage:
 *   hello       the console started (the stage sends its layouts now)
 *   levels      output levels, patch and fixtures (every output change)
 *   registered  results of a `register`
 * @typedef {{
 *   hello: () => void,
 *   levels: (data: { levels: number[], faders: [number, number[]][], fixtures: object[], groups: object[], universes: number }) => void,
 *   registered: (results: any[]) => void,
 * }} StageEnd
 */

/** @type {{ console: ConsoleEnd | null, stage: StageEnd | null }} */
const ends = { console: null, stage: null };

/**
 * Join the link as `side` with the functions the other side may call.
 * Returns `call(fn)`: runs `fn` with the other side's functions after the
 * current work (dropped if the other side hasn't joined).
 * @template {"console" | "stage"} S
 * @param {S} side
 * @param {S extends "console" ? ConsoleEnd : StageEnd} end
 * @returns {(fn: (other: S extends "console" ? StageEnd : ConsoleEnd) => void) => void}
 */
export function joinLink(side, end) {
  ends[side] = /** @type {any} */ (end);
  const other = side === "console" ? "stage" : "console";
  return (fn) => queueMicrotask(() => {
    const o = ends[other];
    if (o) fn(/** @type {any} */ (o));
  });
}

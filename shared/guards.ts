/**
 * Checks for values from outside the code's own types: saved files, server
 * messages, `data-*` attributes. Each narrows the value's type when it passes.
 */

/** Is `v` one of `list` (e.g. a `data-*` value that must be a known name)? */
export const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => list.includes(v as T);

/** Is `v` a plain object whose fields can be read (not null, not an array)? */
export const isRecord = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);

/** A caught error's message (`fallback` when what was thrown isn't an Error). */
export const errorMessage = (err: unknown, fallback = String(err)): string => (err instanceof Error ? err.message : fallback);

/** Is `v` there (not null / undefined)? For `.filter(isPresent)`. */
export const isPresent = <T>(v: T | null | undefined): v is T => v != null;

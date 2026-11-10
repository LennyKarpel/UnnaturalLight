/**
 * Element lookups that must succeed (the markup is in ../index.html or made by
 * the module itself): a missing element is a bug, so these throw instead of
 * returning null.
 */

/** `v`, which must be there (throws naming `what` when it's null / undefined). */
export function must<T>(v: T | null | undefined, what = "value"): T {
  if (v == null) throw new Error(`Missing ${what}`);
  return v;
}

/** The element matching `selector` inside `root` (throws when there's none). */
export function $<E extends Element = HTMLElement>(root: ParentNode, selector: string): E {
  return must(root.querySelector<E>(selector), selector);
}

/**
 * The element with this id (throws when there's none). With `type`, it's
 * also checked to be one (e.g. HTMLButtonElement) and typed as one.
 */
export function elById<E extends HTMLElement = HTMLElement>(id: string): E;
export function elById<E extends HTMLElement>(id: string, type: { new (): E; prototype: E }): E;
export function elById(id: string, type?: { new (): HTMLElement; prototype: HTMLElement }): HTMLElement {
  const el = must(document.getElementById(id), `#${id}`);
  if (type && !(el instanceof type)) throw new Error(`#${id} is not ${type.name}`);
  return el;
}

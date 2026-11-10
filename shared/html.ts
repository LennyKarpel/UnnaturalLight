/** Text made safe to put inside HTML (and attribute values). */
const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (t: unknown): string => String(t ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** A new element with its class and, if given, its text. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string | null): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** A new `type="button"` button (so it never submits a form) with its class and, if given, its text. */
export function button(className: string, text?: string | null): HTMLButtonElement {
  const node = el("button", className, text);
  node.type = "button";
  return node;
}

// Renaming in place: a text input takes a name's place; Enter or leaving the
// field saves, Escape cancels. One rename at a time, for cues, faders,
// fixtures, fixture groups and songs.

/** Ends the rename in progress without saving, or null. */
let endCurrent: (() => void) | null = null;

/** End the rename in progress (if any) without saving: before another edit, or a redraw. */
export function abortInlineRename() {
  endCurrent?.();
}

/**
 * Start renaming: an input replaces `replace`, holding `value`. When it ends,
 * `done` gets the trimmed name (null: cancelled) and `putBack`, which puts an
 * element where the input is (or, if a redraw already removed the input,
 * first in its old parent).
 */
export function inlineRename(opts: {
  replace: HTMLElement;
  value: string;
  /** What's being named, for screen readers ("Cue name"). */
  label: string;
  className: string;
  placeholder?: string;
  done: (name: string | null, putBack: (el: HTMLElement) => void) => void;
}) {
  abortInlineRename();
  const parent = opts.replace.parentElement;
  if (!parent) return;
  const input = document.createElement("input");
  input.type = "text";
  input.className = opts.className;
  input.maxLength = 40;
  input.value = opts.value;
  if (opts.placeholder) input.placeholder = opts.placeholder;
  input.setAttribute("aria-label", opts.label);
  input.autocomplete = "off";
  input.spellcheck = false;
  // Clicks in the field stay in it (rows and cards behind it act on clicks).
  for (const type of ["click", "dblclick", "pointerdown"]) input.addEventListener(type, (event) => event.stopPropagation());
  opts.replace.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = (save: boolean) => {
    if (finished) return;
    finished = true;
    if (endCurrent === cancel) endCurrent = null;
    input.removeEventListener("keydown", onKeydown);
    input.removeEventListener("blur", onBlur);
    opts.done(save ? input.value.trim() : null, (el) => (input.isConnected ? input.replaceWith(el) : parent.prepend(el)));
  };
  const cancel = () => finish(false);
  endCurrent = cancel;

  const onKeydown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key !== "Enter" && event.key !== "Escape") return;
    event.preventDefault();
    finish(event.key === "Enter");
  };
  const onBlur = () => finish(true);
  input.addEventListener("keydown", onKeydown);
  input.addEventListener("blur", onBlur);
}

/** Make a name clickable to rename it: a click, Enter or Space calls `start` with it. */
export function clickToRename(el: HTMLElement, start: (el: HTMLElement) => void) {
  el.title = "Click to rename";
  el.setAttribute("role", "button");
  el.tabIndex = 0;
  el.addEventListener("click", (event) => {
    event.stopPropagation();
    start(el);
  });
  el.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    start(el);
  });
  return el;
}

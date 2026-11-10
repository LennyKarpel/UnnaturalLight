/**
 * A small dialog shared by the whole app (styles in theme.css): confirm
 * something, or ask for a name. Used by the console and the page header
 * (../index.html).
 */

import { $ } from "./query.ts";

let dlg: HTMLDialogElement | null = null;

function create(): HTMLDialogElement {
  const d = document.createElement("dialog");
  dlg = d;
  d.className = "ask";
  d.innerHTML = `
    <form method="dialog">
      <h2></h2>
      <p></p>
      <label>Name <input type="text" maxlength="40" autocomplete="off" spellcheck="false" data-1p-ignore /></label>
      <div class="ask-actions">
        <button type="submit" value="cancel" class="quiet" formnovalidate>Cancel</button>
        <button type="submit" value="confirm" class="primary">OK</button>
      </div>
    </form>`;
  // Enter in the name box means the confirm button (the form's first button is Cancel).
  $(d, "input").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    $<HTMLFormElement>(d, "form").requestSubmit($<HTMLButtonElement>(d, '[value="confirm"]'));
  });
  document.body.append(d);
  return d;
}

export type AskOptions = { title: string; message?: string; confirmLabel?: string };

/**
 * Confirm (no `initial`) or ask for a name (`initial` = the starting text).
 * Resolves true / the trimmed name, or null when canceled.
 */
export function ask(opts: AskOptions & { initial: string }): Promise<string | null>;
export function ask(opts: AskOptions & { initial?: null }): Promise<true | null>;
export function ask({
  title,
  message = "",
  confirmLabel = "OK",
  initial = null,
}: AskOptions & { initial?: string | null }): Promise<true | string | null> {
  const d = dlg ?? create();
  const form = $<HTMLFormElement>(d, "form");
  const msg = $(d, "p");
  const field = $(d, "label");
  const input = $<HTMLInputElement>(d, "input");
  $(d, "h2").textContent = title;
  msg.textContent = message;
  msg.hidden = !message;
  $(d, '[value="confirm"]').textContent = confirmLabel;
  field.hidden = initial === null;
  input.value = initial ?? "";
  input.setCustomValidity("");
  return new Promise((resolve) => {
    const onSubmit = (e: SubmitEvent) => {
      const confirmed = e.submitter instanceof HTMLButtonElement && e.submitter.value === "confirm";
      if (!confirmed || field.hidden) return;
      const name = input.value.trim();
      if (name) {
        input.value = name;
        input.setCustomValidity("");
        return;
      }
      e.preventDefault();
      input.setCustomValidity("Enter a name");
      input.reportValidity();
    };
    const onInput = () => input.setCustomValidity("");
    const onClose = () => {
      form.removeEventListener("submit", onSubmit);
      input.removeEventListener("input", onInput);
      if (d.returnValue !== "confirm") resolve(null);
      else resolve(field.hidden ? true : input.value.trim() || null);
    };
    form.addEventListener("submit", onSubmit);
    input.addEventListener("input", onInput);
    d.addEventListener("close", onClose, { once: true });
    d.returnValue = "";
    d.showModal();
    if (!field.hidden) queueMicrotask(() => { input.focus(); input.select(); });
  });
}

/**
 * A small dialog shared by the whole app (styles in theme.css): confirm
 * something, or ask for a name. Used by the console and the page header
 * (../index.html).
 */

/** @type {HTMLDialogElement | null} */
let dlg = null;

function create() {
  dlg = document.createElement("dialog");
  dlg.className = "ask";
  dlg.innerHTML = `
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
  dlg.querySelector("input").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    dlg.querySelector("form").requestSubmit(dlg.querySelector('[value="confirm"]'));
  });
  document.body.append(dlg);
  return dlg;
}

/**
 * Confirm (no `initial`) or ask for a name (`initial` = the starting text).
 * Resolves true / the trimmed name, or null when cancelled.
 *
 * @param {{ title: string, message?: string, confirmLabel?: string, initial?: string | null }} opts
 * @returns {Promise<true | string | null>}
 */
export function ask({ title, message = "", confirmLabel = "OK", initial = null }) {
  const d = dlg ?? create();
  const form = d.querySelector("form");
  const msg = d.querySelector("p");
  const field = d.querySelector("label");
  const input = d.querySelector("input");
  d.querySelector("h2").textContent = title;
  msg.textContent = message;
  msg.hidden = !message;
  d.querySelector('[value="confirm"]').textContent = confirmLabel;
  field.hidden = initial === null;
  input.value = initial ?? "";
  input.setCustomValidity("");
  return new Promise((resolve) => {
    const onSubmit = (e) => {
      if (e.submitter?.value !== "confirm" || field.hidden) return;
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

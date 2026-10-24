/**
 * Color picker shared by the console and the stage, used in place of the
 * browser's own for every <input type="color"> on the page (console color
 * bars; stage keys bar and inspector). Clicking one opens a popover by it:
 *
 *   wheel     hue around the edge, saturation toward the centre, at full
 *             brightness (the dimmer sets how bright the light is)
 *   swatches  common lighting colors, then colors in use (the app says which)
 *   R G B     the 0–255 values it sets, and the hex code
 *
 * Every change sets the input's value and fires "input" on it (closing fires
 * "change"), so the page handles it like the browser's picker. A click
 * outside, or Esc, only closes the popover: nothing under it is clicked.
 */

const byte = (v) => Math.max(0, Math.min(255, Math.round(Number(v) || 0)));
const hexFromRgb = (r, g, b) => `#${[r, g, b].map((c) => byte(c).toString(16).padStart(2, "0")).join("")}`;
const rgbFromHex = (hex) => {
  const n = parseInt(String(hex).slice(1), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [255, 255, 255];
};

/** Common lighting colors: [name, hex]. */
const SWATCHES = [
  ["Warm white", "#ffd9a0"], ["White", "#ffffff"], ["Cool white", "#dce6ff"],
  ["Amber", "#ffaa00"], ["Orange", "#ff5a00"], ["Red", "#ff0000"],
  ["Pink", "#ff3c8c"], ["Magenta", "#ff00ff"], ["UV", "#6a00ff"],
  ["Blue", "#0028ff"], ["Cyan", "#00e0ff"], ["Green", "#00ff3c"],
];
const MAX_USED_COLORS = 12;
const WHEEL = 180; // CSS px

// Uses the page's colors (--panel, --ink …), with the shared dark look as fallback.
const STYLE = `
input[type="color"] { cursor: pointer; }
dialog.color-pop {
  position: fixed; inset: auto; margin: 0; padding: 0;
  border: 1px solid var(--track, #2a303b); border-radius: 8px;
  background: var(--panel, #1b1f27); color: var(--ink, #e8e4dc);
  font: 13px var(--font, "IBM Plex Sans", system-ui, sans-serif);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}
dialog.color-pop::backdrop { background: transparent; }
.color-pop-body { display: grid; gap: 8px; padding: 10px; width: 202px; }
.color-wheel { position: relative; width: 180px; height: 180px; justify-self: center; }
.color-wheel canvas { display: block; cursor: crosshair; touch-action: none; }
.color-wheel-dot {
  position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px;
  border: 2px solid #fff; border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6); pointer-events: none;
}
.color-swatches { display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px; }
.color-swatches[hidden], .color-used-head[hidden] { display: none; }
.color-swatches button {
  height: 22px; padding: 0; border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 4px; cursor: pointer;
}
.color-swatches button:hover { border-color: var(--ink, #e8e4dc); }
.color-swatches button.on { outline: 2px solid var(--accent, #e2a13a); outline-offset: 1px; }
.color-used-head { color: var(--muted, #9a9488); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
.color-values { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; }
.color-values label { display: grid; gap: 2px; color: var(--muted, #9a9488); font-size: 11px; }
.color-values input {
  width: 100%; font: 12px var(--mono, "IBM Plex Mono", ui-monospace, Menlo, monospace);
  padding: 3px 5px; border: 1px solid var(--track, #2a303b); border-radius: 4px;
  background: var(--bg, #121418); color: var(--ink, #e8e4dc);
}
.color-values input[type="text"] { grid-column: 1 / -1; }
`;

/** h 0–360, s 0–1, v 0–1 → [r, g, b] 0–255 */
function rgbFromHsv(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return [f(5), f(3), f(1)];
}

/** [r, g, b] 0–255 → [h 0–360, s 0–1] */
function hsFromRgb(r, g, b) {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (!max || !d) return [0, 0];
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, d / max];
}

/**
 * @param {{ usedLabel: string, usedColors: () => string[] }} api
 *   the second swatch row: its heading and colors (hex), e.g. the stage's lights
 */
export function installColorPicker(api) {
  if (!document.getElementById("color-pop-style")) {
    const style = document.createElement("style");
    style.id = "color-pop-style";
    style.textContent = STYLE;
    document.head.append(style);
  }
  const dlg = document.createElement("dialog");
  dlg.className = "color-pop";
  dlg.innerHTML = `
    <div class="color-pop-body">
      <div class="color-wheel">
        <canvas width="${WHEEL * 2}" height="${WHEEL * 2}" style="width:${WHEEL}px;height:${WHEEL}px"></canvas>
        <span class="color-wheel-dot"></span>
      </div>
      <div class="color-swatches">${SWATCHES.map(([name, hex]) => `<button type="button" data-hex="${hex}" title="${name}" style="background:${hex}"></button>`).join("")}</div>
      <div class="color-used-head"></div>
      <div class="color-swatches" data-used></div>
      <div class="color-values">
        <label>R <input type="number" min="0" max="255" step="1" data-c="0" /></label>
        <label>G <input type="number" min="0" max="255" step="1" data-c="1" /></label>
        <label>B <input type="number" min="0" max="255" step="1" data-c="2" /></label>
        <input type="text" data-hex-field maxlength="7" spellcheck="false" title="Hex code" />
      </div>
    </div>`;
  document.body.append(dlg);

  const canvas = dlg.querySelector("canvas");
  const dot = /** @type {HTMLElement} */ (dlg.querySelector(".color-wheel-dot"));
  const usedRow = /** @type {HTMLElement} */ (dlg.querySelector("[data-used]"));
  const usedHead = /** @type {HTMLElement} */ (dlg.querySelector(".color-used-head"));
  usedHead.textContent = api.usedLabel;
  const rgbFields = /** @type {HTMLInputElement[]} */ ([...dlg.querySelectorAll("[data-c]")]);
  const hexField = /** @type {HTMLInputElement} */ (dlg.querySelector("[data-hex-field]"));

  drawWheel(canvas);

  /** @type {HTMLInputElement | null} */
  let anchor = null;
  let shown = "";
  let frame = 0;

  /** Show a color in the popover (fields, dot, selected swatch). */
  function show(hex) {
    shown = hex;
    const rgb = rgbFromHex(hex);
    rgbFields.forEach((el, i) => { if (el !== document.activeElement) el.value = String(rgb[i]); });
    if (hexField !== document.activeElement) hexField.value = hex;
    const [h, s] = hsFromRgb(...rgb);
    const a = (h * Math.PI) / 180;
    const r = (s * WHEEL) / 2;
    dot.style.left = `${WHEEL / 2 + r * Math.cos(a)}px`;
    dot.style.top = `${WHEEL / 2 - r * Math.sin(a)}px`;
    dot.style.background = hex;
    dlg.querySelectorAll("[data-hex]").forEach((b) => b.classList.toggle("on", b.dataset.hex === hex));
  }

  /** Pick a color: set it on the input, as the browser's picker would. */
  function pick(hex) {
    hex = hex.toLowerCase();
    if (!anchor || hex === shown) return;
    anchor.value = hex;
    anchor.dispatchEvent(new Event("input", { bubbles: true }));
    show(hex);
  }

  function renderUsedColors() {
    const preset = new Set(SWATCHES.map(([, hex]) => hex));
    const colors = [...new Set(api.usedColors().map((c) => c.toLowerCase()))]
      .filter((c) => /^#[0-9a-f]{6}$/.test(c) && !preset.has(c))
      .slice(0, MAX_USED_COLORS);
    usedRow.innerHTML = colors.map((hex) => `<button type="button" data-hex="${hex}" title="${hex}" style="background:${hex}"></button>`).join("");
    usedRow.hidden = usedHead.hidden = !colors.length;
  }

  function place() {
    const a = anchor.getBoundingClientRect();
    const { width, height } = dlg.getBoundingClientRect();
    const gap = 6;
    const below = a.bottom + gap + height <= innerHeight;
    const top = below ? a.bottom + gap : Math.max(gap, a.top - gap - height);
    const left = Math.min(Math.max(gap, a.left), innerWidth - width - gap);
    dlg.style.left = `${left}px`;
    dlg.style.top = `${top}px`;
  }

  /** While open: follow the input (another window or the console may change it). */
  function follow() {
    if (!anchor) return;
    if (!anchor.isConnected || anchor.disabled) { dlg.close(); return; }
    if (anchor.value !== shown && !dragging) show(anchor.value);
    frame = requestAnimationFrame(follow);
  }

  function open(input) {
    anchor = input;
    renderUsedColors();
    show(input.value.toLowerCase());
    dlg.showModal();
    place();
    frame = requestAnimationFrame(follow);
  }

  dlg.addEventListener("close", () => {
    cancelAnimationFrame(frame);
    const input = anchor;
    anchor = null;
    input?.dispatchEvent(new Event("change", { bubbles: true }));
  });

  // Instead of the browser's picker.
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.type !== "color" || t.disabled) return;
    e.preventDefault();
    open(t);
  }, true);

  // A click on the (see-through) backdrop closes it and goes no further.
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  // Keys typed here aren't stage keys (arrows, ⌫, Tab …).
  dlg.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && e.target instanceof HTMLInputElement) dlg.close();
  });

  // Wheel: click or drag.
  let dragging = false;
  const fromWheel = (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left - WHEEL / 2;
    const y = r.top + WHEEL / 2 - e.clientY;
    const h = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    const s = Math.min(1, Math.hypot(x, y) / (WHEEL / 2));
    pick(hexFromRgb(...rgbFromHsv(h, s, 1)));
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    fromWheel(e);
  });
  canvas.addEventListener("pointermove", (e) => { if (dragging) fromWheel(e); });
  for (const type of ["pointerup", "pointercancel"]) canvas.addEventListener(type, () => { dragging = false; });

  dlg.addEventListener("click", (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest("[data-hex]");
    if (b) pick(b.dataset.hex);
  });
  rgbFields.forEach((el) => el.addEventListener("input", () => {
    if (el.value === "") return;
    pick(hexFromRgb(...rgbFields.map((f) => byte(f.value))));
  }));
  hexField.addEventListener("input", () => {
    const v = hexField.value.trim().replace(/^#?/, "#");
    if (/^#[0-9a-f]{6}$/i.test(v)) pick(v);
  });
  for (const el of [...rgbFields, hexField]) el.addEventListener("blur", () => show(shown));
}

/** Hue around, saturation outward, full brightness; soft edge. */
function drawWheel(canvas) {
  const ctx = canvas.getContext("2d");
  const size = canvas.width;
  const c = size / 2;
  const img = ctx.createImageData(size, size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = px + 0.5 - c;
      const y = c - (py + 0.5);
      const d = Math.hypot(x, y);
      const alpha = Math.max(0, Math.min(1, c - d));
      if (!alpha) continue;
      const h = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
      const [r, g, b] = rgbFromHsv(h, Math.min(1, d / c), 1);
      const o = (py * size + px) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = Math.round(alpha * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
}

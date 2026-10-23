// Signal trace, shared by the console and the stage: ⌥-click a fader, a
// DMX channel, a console instrument or a stage light to see what controls
// it, what it controls, and the current values, in a small card next to
// the pointer.
//
// Each page passes a snapshot of what it knows (its own state plus what the
// other page has sent over the live link); buildTrace() turns that into rows.

/**
 * @typedef {{ channel: number, max: number }} PatchTarget
 * @typedef {{ num: number, name: string, live: number, from: number, to: number, patch: PatchTarget[] }} FaderInfo
 * @typedef {{ master: number, fromSub: number, toSub: number, cross: number, fromName: string, toName: string }} MixInfo
 * @typedef {{ id: string, name: string, mount?: string, color?: string, channelStart: number, channelEnd: number }} ConsoleInstrument
 * @typedef {{ id: string, name: string, start: number | null, layout: (string | null)[], dmx: Record<string, number>, notes: Record<string, string>, consoleId: string | null, consoleName: string | null }} StageInstrument
 * @typedef {{
 *   live: boolean,
 *   levels: number[] | null,
 *   faders: FaderInfo[] | null,
 *   mix: MixInfo | null,
 *   consoleInstruments: ConsoleInstrument[],
 *   stageInstruments: StageInstrument[] | null,
 * }} Snapshot
 * @typedef {{ kind: "fader", fader: number } | { kind: "channel", channel: number } | { kind: "instrument", id: string } | { kind: "light", id: string }} TraceTarget
 * @typedef {{ label: string, value?: string | number, note?: string, depth?: number, tone?: "on" | "muted" | "warn" }} Row
 * @typedef {{ title: string, subtitle: string, sections: { heading: string, rows: Row[] }[] }} Trace
 */

const ATTRS = ["dimmer", "pan", "tilt", "red", "green", "blue", "zoom"];
const LABEL = { dimmer: "Dimmer", pan: "Pan", tilt: "Tilt", red: "Red", green: "Green", blue: "Blue", zoom: "Zoom" };

const scaled = (level, max) => Math.round((level * max) / 255);
/** "F3", or "F3 · Name" when the fader has its own name. */
const faderLabel = (f) => (f.name && f.name !== `F${f.num}` ? `F${f.num} · ${f.name}` : `F${f.num}`);

/** Faders patched to a channel, with what each sends to it (highest first). */
function fadersOn(s, ch) {
  return (s.faders ?? [])
    .flatMap((f) => f.patch.filter((t) => t.channel === ch).map((t) => ({ f, max: t.max, out: scaled(f.live, t.max) })))
    .sort((a, b) => b.out - a.out);
}

/** What a DMX channel drives: console instruments and linked stage lights. */
function channelUses(s, ch, depth) {
  /** @type {Row[]} */
  const rows = [];
  for (const ci of s.consoleInstruments) {
    if (ch < ci.channelStart || ch > ci.channelEnd) continue;
    rows.push({ label: `Console · ${ci.name}`, note: `channel ${ch - ci.channelStart + 1} of ${ci.channelEnd - ci.channelStart + 1}`, depth });
  }
  for (const si of s.stageInstruments ?? []) {
    if (!si.start) continue;
    const attr = si.layout[ch - si.start];
    if (ch < si.start || !attr) continue;
    rows.push({ label: `Stage · ${si.name} · ${LABEL[attr]}`, value: si.dmx[attr], note: si.notes[attr] ? `= ${si.notes[attr]}` : "", depth, tone: "on" });
  }
  if (!rows.length) rows.push({ label: "Not used by any instrument", depth, tone: "muted" });
  if (!s.stageInstruments) rows.push({ label: "Stage not open: its lights aren't shown", depth, tone: "muted" });
  return rows;
}

function consoleMissing() {
  return { heading: "Console", rows: [{ label: "Console not open: fader values unknown", tone: "muted" }] };
}

/** @param {Snapshot} s @param {number} n */
function traceFader(s, n) {
  const f = s.faders?.[n - 1];
  if (!f) return { title: `F${n}`, subtitle: "Fader", sections: [consoleMissing()] };
  const m = s.mix;
  /** @type {Row[]} */
  const up = [];
  if (m) {
    const t = m.cross / 100;
    if (t < 1) up.push({ label: `Transition ${m.fromName}`, value: f.from, note: m.fromSub !== 100 ? `submaster ${m.fromSub}%` : "" });
    if (t > 0) up.push({ label: `Transition ${m.toName}`, value: f.to, note: `${m.toSub !== 100 ? `submaster ${m.toSub}% · ` : ""}crossfade ${m.cross}%` });
    up.push({ label: "Master", value: `${m.master}%`, tone: m.master === 0 ? "warn" : undefined });
  }
  up.push({ label: "Live level", value: f.live, tone: "on" });

  /** @type {Row[]} */
  const down = [];
  if (!f.patch.length) down.push({ label: "Not patched to any channel", tone: "muted" });
  for (const t of f.patch) {
    const out = scaled(f.live, t.max);
    const level = s.levels?.[t.channel - 1] ?? out;
    const winner = fadersOn(s, t.channel)[0];
    const held = winner && winner.f.num !== n && winner.out > out;
    down.push({
      label: `Ch ${t.channel}`,
      value: out,
      note: `${t.max !== 255 ? `max ${t.max} · ` : ""}${held ? `output ${level}: higher F${winner.f.num} wins (HTP)` : `output ${level}`}`,
      tone: held ? "warn" : "on",
    });
    down.push(...channelUses(s, t.channel, 1));
  }
  return {
    title: faderLabel(f),
    subtitle: "Fader",
    sections: [{ heading: "Controlled by", rows: up }, { heading: "Controls", rows: down }],
  };
}

/** @param {Snapshot} s @param {number} ch */
function traceChannel(s, ch) {
  const level = s.levels?.[ch - 1];
  /** @type {Row[]} */
  const up = [];
  if (!s.faders) up.push({ label: "Console not open: fader values unknown", tone: "muted" });
  else {
    const on = fadersOn(s, ch);
    if (!on.length) up.push({ label: "No fader patched", tone: "muted" });
    on.forEach(({ f, max, out }, k) => up.push({
      label: faderLabel(f),
      value: out,
      note: `live ${f.live}${max !== 255 ? ` × max ${max}` : ""}${on.length > 1 ? (k === 0 ? " · highest wins" : "") : ""}`,
      tone: k === 0 ? "on" : "muted",
    }));
  }
  return {
    title: `Ch ${ch}`,
    subtitle: `DMX channel${level != null ? ` · output ${level}` : ""}`,
    sections: [{ heading: "Controlled by", rows: up }, { heading: "Controls", rows: channelUses(s, ch, 0) }],
  };
}

/** @param {Snapshot} s @param {string} id */
function traceLight(s, id) {
  const si = (s.stageInstruments ?? []).find((i) => i.id === id);
  if (!si) return { title: "Light", subtitle: "Stage light", sections: [{ heading: "", rows: [{ label: "Not found", tone: "muted" }] }] };
  /** @type {Row[]} */
  const rows = [];
  const chOf = (attr) => (si.start ? si.layout.indexOf(attr) : -1);
  for (const attr of ATTRS) {
    rows.push({ label: LABEL[attr], value: si.dmx[attr], note: si.notes[attr] ?? "" });
    const k = chOf(attr);
    if (k < 0) continue;
    const ch = si.start + k;
    if (!s.faders) {
      rows.push({ label: `← Ch ${ch}`, note: "console not open", depth: 1, tone: "muted" });
      continue;
    }
    const on = fadersOn(s, ch);
    if (!on.length) {
      rows.push({ label: `← Ch ${ch}`, note: "no fader patched: set on the stage", depth: 1, tone: "muted" });
      continue;
    }
    rows.push({ label: `← Ch ${ch}`, value: s.levels?.[ch - 1] ?? "", depth: 1, tone: "on" });
    on.forEach(({ f, max }, j) => rows.push({
      label: `← ${faderLabel(f)}`,
      value: f.live,
      note: `${max !== 255 ? `max ${max} · ` : ""}${on.length > 1 && j === 0 ? "highest wins" : ""}`,
      depth: 2,
      tone: j === 0 ? "on" : "muted",
    }));
  }
  /** @type {Row[]} */
  const link = [];
  if (!si.start) link.push({ label: "Not linked: every value is set on the stage", tone: "muted" });
  else {
    link.push({ label: si.consoleName ? `Console · ${si.consoleName}` : "Manual address", note: `Ch ${si.start}–${si.start + si.layout.length - 1}` });
    if (s.mix) link.push({ label: "Master", value: `${s.mix.master}%`, note: "scales every fader", tone: s.mix.master === 0 ? "warn" : undefined });
  }
  return {
    title: si.name,
    subtitle: "Stage light",
    sections: [{ heading: "Linked to", rows: link }, { heading: "Values ← controlled by", rows }],
  };
}

/** Stage lights' attributes on a channel, e.g. "Inst 1 · Dimmer". */
function stageUsesOf(s, ch) {
  return (s.stageInstruments ?? []).flatMap((si) => {
    const attr = si.start && ch >= si.start ? si.layout[ch - si.start] : null;
    return attr ? [{ si, attr }] : [];
  });
}

/** @param {Snapshot} s @param {string} id */
function traceInstrument(s, id) {
  const ci = s.consoleInstruments.find((c) => c.id === id);
  if (!ci) return { title: "Instrument", subtitle: "Console instrument", sections: [{ heading: "", rows: [{ label: "Not found", tone: "muted" }] }] };
  const count = ci.channelEnd - ci.channelStart + 1;
  const kind = [ci.mount === "movable" ? "Movable" : ci.mount ? "Fixed" : "", ci.color === "multi" ? "Multi-color" : ci.color ? "Single color" : ""].filter(Boolean).join(" · ");

  /** @type {Row[]} */
  const lights = [];
  if (!s.stageInstruments) lights.push({ label: "Stage not open: its lights aren't shown", tone: "muted" });
  else {
    const linked = s.stageInstruments.filter((si) => si.consoleId === id);
    if (!linked.length) lights.push({ label: "No stage light linked to it", tone: "muted" });
    for (const si of linked) lights.push({ label: si.name, note: `Ch ${si.start}–${si.start + si.layout.length - 1}`, tone: "on" });
  }

  /** @type {Row[]} */
  const rows = [];
  for (let ch = ci.channelStart; ch <= ci.channelEnd; ch++) {
    const uses = stageUsesOf(s, ch);
    rows.push({
      label: `Ch ${ch} · ${ch - ci.channelStart + 1} of ${count}`,
      value: s.levels?.[ch - 1] ?? "",
      note: uses.length ? uses.map(({ si, attr }) => `${si.name} · ${LABEL[attr]}${si.notes[attr] ? ` = ${si.notes[attr]}` : ""}`).join(", ") : (s.stageInstruments ? "not used on the stage" : ""),
    });
    if (!s.faders) continue;
    const on = fadersOn(s, ch);
    if (!on.length) rows.push({ label: "← no fader patched", depth: 1, tone: "muted" });
    on.forEach(({ f, max, out }, j) => rows.push({
      label: `← ${faderLabel(f)}`,
      value: out,
      note: `live ${f.live}${max !== 255 ? ` × max ${max}` : ""}${on.length > 1 && j === 0 ? " · highest wins" : ""}`,
      depth: 1,
      tone: j === 0 ? "on" : "muted",
    }));
  }
  if (!s.faders) rows.push({ label: "Console not open: fader values unknown", tone: "muted" });

  return {
    title: ci.name,
    subtitle: `Console instrument · Ch ${ci.channelStart}${count > 1 ? `–${ci.channelEnd}` : ""}${kind ? ` · ${kind}` : ""}`,
    sections: [{ heading: "Stage lights", rows: lights }, { heading: "Channels ← controlled by", rows }],
  };
}

/** @param {Snapshot} s @param {TraceTarget} target @returns {Trace} */
export function buildTrace(s, target) {
  if (target.kind === "fader") return traceFader(s, target.fader);
  if (target.kind === "channel") return traceChannel(s, target.channel);
  if (target.kind === "instrument") return traceInstrument(s, target.id);
  return traceLight(s, target.id);
}

// ---------------------------------------------------------------------
// Popover card
// ---------------------------------------------------------------------

const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const STYLE = `
.trace-pop {
  position: fixed; z-index: 1000; width: 340px; max-height: min(70vh, 520px); overflow: auto;
  background: #1b1f27; color: #e8e4dc; border: 1px solid #3a4150; border-radius: 8px;
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.55);
  font: 12px/1.45 "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
}
.trace-pop[hidden] { display: none; }
.trace-pop .t-head { display: flex; justify-content: space-between; align-items: start; gap: 8px; padding: 8px 10px 6px; border-bottom: 1px solid #2a303b; }
.trace-pop .t-title { font-weight: 600; font-size: 13px; }
.trace-pop .t-sub { color: #9a9488; font-size: 11px; }
.trace-pop .t-close { background: none; border: 0; color: #9a9488; font: inherit; cursor: pointer; padding: 0 2px; }
.trace-pop .t-close:hover { color: #e8e4dc; }
.trace-pop .t-sec { padding: 6px 10px 8px; }
.trace-pop .t-sec + .t-sec { border-top: 1px solid #2a303b; }
.trace-pop .t-h { color: #e2a13a; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 3px; }
.trace-pop .t-row { display: grid; grid-template-columns: 1fr auto; column-gap: 8px; }
.trace-pop .t-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.trace-pop .t-val { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; text-align: right; }
.trace-pop .t-note { grid-column: 1 / -1; color: #9a9488; font-size: 11px; margin-top: -1px; }
.trace-pop .on .t-val { color: #6fbf7a; }
.trace-pop .muted { color: #6c7280; }
.trace-pop .warn .t-val, .trace-pop .warn .t-note { color: #e2a13a; }
.trace-pop .t-foot { padding: 4px 10px 7px; color: #6c7280; font-size: 10px; }
`;

function rowHtml(r) {
  const pad = (r.depth ?? 0) * 14;
  return `<div class="t-row ${r.tone ?? ""}" style="padding-left:${pad}px">
    <span class="t-label" title="${esc(r.label)}">${esc(r.label)}</span>
    <span class="t-val">${esc(r.value ?? "")}</span>
    ${r.note ? `<span class="t-note">${esc(r.note)}</span>` : ""}
  </div>`;
}

/**
 * One reusable card. open() shows a trace at a screen point; refresh()
 * re-renders it from a fresh snapshot (call it whenever values change).
 */
export function createTracePopover() {
  if (!document.getElementById("trace-style")) {
    const style = document.createElement("style");
    style.id = "trace-style";
    style.textContent = STYLE;
    document.head.append(style);
  }
  const el = document.createElement("div");
  el.className = "trace-pop";
  el.hidden = true;
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Signal trace");
  document.body.append(el);

  /** @type {null | { target: TraceTarget, snapshot: () => Snapshot }} */
  let current = null;

  function render() {
    if (!current) return;
    const t = buildTrace(current.snapshot(), current.target);
    el.innerHTML = `
      <div class="t-head">
        <div><div class="t-title">${esc(t.title)}</div><div class="t-sub">${esc(t.subtitle)}</div></div>
        <button type="button" class="t-close" aria-label="Close">✕</button>
      </div>
      ${t.sections.map((sec) => `<div class="t-sec">${sec.heading ? `<div class="t-h">${esc(sec.heading)}</div>` : ""}${sec.rows.map(rowHtml).join("")}</div>`).join("")}
      <div class="t-foot">Live · ⌥-click something else to trace it · Esc closes</div>`;
    el.querySelector(".t-close").addEventListener("click", close);
  }

  function close() {
    current = null;
    el.hidden = true;
  }

  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !el.hidden) close(); }, true);
  document.addEventListener("pointerdown", (e) => { if (!el.hidden && !e.altKey && !el.contains(e.target)) close(); }, true);

  return {
    get open() { return !el.hidden; },
    /** @param {TraceTarget} target @param {number} x @param {number} y @param {() => Snapshot} snapshot */
    show(target, x, y, snapshot) {
      current = { target, snapshot };
      render();
      el.hidden = false;
      const r = el.getBoundingClientRect();
      el.style.left = `${Math.max(8, Math.min(x + 14, window.innerWidth - r.width - 8))}px`;
      el.style.top = `${Math.max(8, Math.min(y + 14, window.innerHeight - r.height - 8))}px`;
    },
    refresh() { if (!el.hidden) render(); },
    close,
  };
}

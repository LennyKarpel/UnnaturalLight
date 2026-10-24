// Signal trace, shared by the console and the stage: ⌥-click a fader, a
// DMX channel, a console fixture or a stage fixture to see what controls
// it, what it controls, and the current values, in a small card next to
// the pointer.
//
// Each page passes a snapshot of what it knows (its own state plus what the
// other page has sent over the live link); buildTrace() turns that into rows.
// Styles: theme.css.

import { DMX_ATTRS as ATTRS, DMX_LABELS as LABEL } from "./attributes.js";
import { formatAddress } from "./address.js";
import { escapeHtml as esc } from "./html.js";

/**
 * @typedef {{ channel: number, max: number }} PatchTarget
 * @typedef {{ num: number, name: string, live: number, from: number, to: number, patch: PatchTarget[] }} FaderInfo
 * @typedef {{ master: number, fromSub: number, toSub: number, cross: number, fromName: string, toName: string }} MixInfo
 * @typedef {{ id: string, name: string, mount?: string, color?: string, channelStart: number, channelEnd: number }} ConsoleFixture
 * @typedef {{ id: string, name: string, start: number | null, layout: (string | null)[], dmx: Record<string, number>, notes: Record<string, string>, consoleId: string | null, consoleName: string | null, channelNames?: string[] | null, fixture?: string | null }} StageFixture
 * @typedef {{
 *   live: boolean,
 *   levels: number[] | null,
 *   faders: FaderInfo[] | null,
 *   mix: MixInfo | null,
 *   universes?: number,
 *   consoleFixtures: ConsoleFixture[],
 *   stageFixtures: StageFixture[] | null,
 * }} Snapshot
 * @typedef {{ kind: "fader", fader: number } | { kind: "channel", channel: number } | { kind: "fixture", id: string } | { kind: "stageFixture", id: string }} TraceTarget
 * @typedef {{ label: string, value?: string | number, note?: string, depth?: number, tone?: "on" | "muted" | "warn" }} Row
 * @typedef {{ title: string, subtitle: string, sections: { heading: string, rows: Row[] }[] }} Trace
 */

const scaled = (level, max) => Math.round((level * max) / 255);
/** Channel as shown to people: "45", or "2/45" (universe/channel) with several universes. */
const addr = (s, ch) => formatAddress(ch, s.universes ?? 1);
/** "F3", or "F3 · Name" when the fader has its own name. */
const faderLabel = (f) => (f.name && f.name !== `F${f.num}` ? `F${f.num} · ${f.name}` : `F${f.num}`);

/** Faders patched to a channel, with what each sends to it (highest first). */
function fadersOn(s, ch) {
  return (s.faders ?? [])
    .flatMap((f) => f.patch.filter((t) => t.channel === ch).map((t) => ({ f, max: t.max, out: scaled(f.live, t.max) })))
    .sort((a, b) => b.out - a.out);
}

/** What a DMX channel drives: console fixtures and linked stage fixtures. */
function channelUses(s, ch, depth) {
  /** @type {Row[]} */
  const rows = [];
  for (const ci of s.consoleFixtures) {
    if (ch < ci.channelStart || ch > ci.channelEnd) continue;
    rows.push({ label: `Console · ${ci.name}`, note: `channel ${ch - ci.channelStart + 1} of ${ci.channelEnd - ci.channelStart + 1}`, depth });
  }
  for (const si of s.stageFixtures ?? []) {
    if (!si.start || ch < si.start) continue;
    const attr = si.layout[ch - si.start];
    const channelName = si.channelNames?.[ch - si.start];
    if (attr) rows.push({ label: `Stage · ${si.name} · ${LABEL[attr]}`, value: si.dmx[attr], note: si.notes[attr] ? `= ${si.notes[attr]}` : "", depth, tone: "on" });
    else if (channelName) rows.push({ label: `Stage · ${si.name} · ${channelName}`, note: "not drawn on the stage", depth, tone: "muted" });
  }
  if (!rows.length) rows.push({ label: "Not used by any fixture", depth, tone: "muted" });
  if (!s.stageFixtures) rows.push({ label: "Stage not open: its fixtures aren't shown", depth, tone: "muted" });
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
    if (t < 1) up.push({ label: `Cue ${m.fromName}`, value: f.from, note: m.fromSub !== 100 ? `submaster ${m.fromSub}%` : "" });
    if (t > 0) up.push({ label: `Cue ${m.toName}`, value: f.to, note: `${m.toSub !== 100 ? `submaster ${m.toSub}% · ` : ""}crossfade ${m.cross}%` });
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
      label: `Ch ${addr(s, t.channel)}`,
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
    title: `Ch ${addr(s, ch)}`,
    subtitle: `DMX channel${level != null ? ` · output ${level}` : ""}`,
    sections: [{ heading: "Controlled by", rows: up }, { heading: "Controls", rows: channelUses(s, ch, 0) }],
  };
}

/** @param {Snapshot} s @param {string} id */
function traceStageFixture(s, id) {
  const si = (s.stageFixtures ?? []).find((i) => i.id === id);
  if (!si) return { title: "Fixture", subtitle: "Stage fixture", sections: [{ heading: "", rows: [{ label: "Not found", tone: "muted" }] }] };
  /** @type {Row[]} */
  const rows = [];
  const chOf = (attr) => (si.start ? si.layout.indexOf(attr) : -1);
  for (const attr of ATTRS) {
    rows.push({ label: LABEL[attr], value: si.dmx[attr], note: si.notes[attr] ?? "" });
    const k = chOf(attr);
    if (k < 0) continue;
    const ch = si.start + k;
    if (!s.faders) {
      rows.push({ label: `← Ch ${addr(s, ch)}`, note: "console not open", depth: 1, tone: "muted" });
      continue;
    }
    const on = fadersOn(s, ch);
    if (!on.length) {
      rows.push({ label: `← Ch ${addr(s, ch)}`, note: "no fader patched: set on the stage", depth: 1, tone: "muted" });
      continue;
    }
    rows.push({ label: `← Ch ${addr(s, ch)}`, value: s.levels?.[ch - 1] ?? "", depth: 1, tone: "on" });
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
    if (si.fixture) link.push({ label: `Fixture · ${si.fixture}` });
    link.push({ label: si.consoleName ? `Console · ${si.consoleName}` : "Manual address", note: `Ch ${addr(s, si.start)}–${addr(s, si.start + si.layout.length - 1)}` });
    if (s.mix) link.push({ label: "Master", value: `${s.mix.master}%`, note: "scales every fader", tone: s.mix.master === 0 ? "warn" : undefined });
  }
  return {
    title: si.name,
    subtitle: "Stage fixture",
    sections: [{ heading: "Linked to", rows: link }, { heading: "Values ← controlled by", rows }],
  };
}

/** Stage fixtures' attributes on a channel, e.g. "Inst 1 · Dimmer". */
function stageUsesOf(s, ch) {
  return (s.stageFixtures ?? []).flatMap((si) => {
    const attr = si.start && ch >= si.start ? si.layout[ch - si.start] : null;
    return attr ? [{ si, attr }] : [];
  });
}

/** A library fixture's own name for a channel (e.g. "Gobo Wheel"), if any. */
function channelNameOf(s, ch) {
  for (const si of s.stageFixtures ?? []) {
    const name = si.start && ch >= si.start ? si.channelNames?.[ch - si.start] : null;
    if (name) return name;
  }
  return null;
}

/** @param {Snapshot} s @param {string} id */
function traceFixture(s, id) {
  const ci = s.consoleFixtures.find((c) => c.id === id);
  if (!ci) return { title: "Fixture", subtitle: "Console fixture", sections: [{ heading: "", rows: [{ label: "Not found", tone: "muted" }] }] };
  const count = ci.channelEnd - ci.channelStart + 1;
  const kind = [ci.mount === "movable" ? "Movable" : ci.mount ? "Fixed" : "", ci.color === "multi" ? "Multi-color" : ci.color ? "Single color" : ""].filter(Boolean).join(" · ");

  /** @type {Row[]} */
  const lights = [];
  if (!s.stageFixtures) lights.push({ label: "Stage not open: its fixtures aren't shown", tone: "muted" });
  else {
    const linked = s.stageFixtures.filter((si) => si.consoleId === id);
    if (!linked.length) lights.push({ label: "No stage fixture linked to it", tone: "muted" });
    for (const si of linked) lights.push({ label: si.name, note: `Ch ${addr(s, si.start)}–${addr(s, si.start + si.layout.length - 1)}`, tone: "on" });
  }

  /** @type {Row[]} */
  const rows = [];
  for (let ch = ci.channelStart; ch <= ci.channelEnd; ch++) {
    const uses = stageUsesOf(s, ch);
    const fixtureName = channelNameOf(s, ch);
    rows.push({
      label: `Ch ${addr(s, ch)} · ${ch - ci.channelStart + 1} of ${count}${fixtureName ? ` · ${fixtureName}` : ""}`,
      value: s.levels?.[ch - 1] ?? "",
      note: uses.length ? uses.map(({ si, attr }) => `${si.name} · ${LABEL[attr]}${si.notes[attr] ? ` = ${si.notes[attr]}` : ""}`).join(", ") : (s.stageFixtures ? "not used on the stage" : ""),
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
    subtitle: `Console fixture · Ch ${addr(s, ci.channelStart)}${count > 1 ? `–${addr(s, ci.channelEnd)}` : ""}${kind ? ` · ${kind}` : ""}`,
    sections: [{ heading: "Stage fixtures", rows: lights }, { heading: "Channels ← controlled by", rows }],
  };
}

/** @param {Snapshot} s @param {TraceTarget} target @returns {Trace} */
function buildTrace(s, target) {
  if (target.kind === "fader") return traceFader(s, target.fader);
  if (target.kind === "channel") return traceChannel(s, target.channel);
  if (target.kind === "fixture") return traceFixture(s, target.id);
  return traceStageFixture(s, target.id);
}

// ---------------------------------------------------------------------
// Popover card
// ---------------------------------------------------------------------

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

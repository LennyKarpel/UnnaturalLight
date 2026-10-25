// Console link: stage fixtures ↔ console fixtures and DMX channels, and
// registering stage fixtures in the console.
import {
  setDmx,
  layoutFor,
  linkChannels,
  followerChannels,
  LAYOUT_PRESETS,
  CONSOLE_TYPES,
  consoleTypeFromKey,
  registerLayout,
  registerLabels,
} from "./stage-model.js";
import { createConsoleLink } from "./console-link.js";
import { createFixturePicker } from "./fixture-library.js";
import { DMX_ATTRS, DMX_LABELS } from "../shared/attributes.js";
import { escapeHtml } from "../shared/html.js";
import { clampByte } from "../shared/numbers.js";
import { COLOR_ROLES } from "../shared/color.js";
import { formatAddress, parseAddress, MAX_UNIVERSES } from "../shared/address.js";
import { state, save, byId, selectedFixtures, rigOf, rigMembers, commonRig } from "./state.js";
import { syncScene } from "./view3d.js";
import { drawPlan } from "./plan.js";
import { inspectorEl, renderList, renderInspector, syncInspector, renderHud } from "./sidebar.js";
import { changed, setBanner } from "./actions.js";
import { trace, publishStage } from "./stage.js";

// ---------------------------------------------------------------------
// Console link: stage fixtures ↔ console fixtures / DMX channels
// ---------------------------------------------------------------------
// A linked fixture has a start channel and a layout (which attribute
// each channel drives). Values flow both ways for channels that have a
// console fader patched: the console's output sets the stage, and changing
// a value here moves that fader (see console-link.js for the rules).

// The console sends its levels on every fader move (often 120 a second while
// dragging): take its latest values once per frame.
let consoleLevelsQueued = false;
function applyConsoleLevelsSoon() {
  if (consoleLevelsQueued) return;
  consoleLevelsQueued = true;
  requestAnimationFrame(() => {
    consoleLevelsQueued = false;
    applyConsoleLevels();
  });
}

export const consoleLink = createConsoleLink({
  onLevels: applyConsoleLevelsSoon,
  onStageHello: () => publishStage(),
  onRegistered: (results) => onRegistered(results),
});

const sortedConsoleFixtures = () => [...consoleLink.fixtures()].sort((a, b) => a.channelStart - b.channelStart);
export const consoleFixtureById = (id) => consoleLink.fixtures().find((c) => c.id === id) ?? null;
/** Channel as shown: "45", or "2/45" (universe/channel) when the console has several universes. */
const addr = (ch) => formatAddress(ch, consoleLink.universes);
/** "2/45" or "45" → channel number in any universe (null if invalid). */
const parseAddr = (text) => parseAddress(text, MAX_UNIVERSES);
const chRange = (c) => `Ch ${addr(c.channelStart)}${c.channelEnd > c.channelStart ? `–${addr(c.channelEnd)}` : ""}`;

/**
 * Each follower channel's color as last sent or heard ("fixtureId:attr" →
 * 0–255): followers are sent only when the stage changes that color, not
 * when the console does (so moving fader 58 doesn't drag 59 along).
 */
const followed = new Map();

/** Take the console's current values for linked, patched channels. */
function applyConsoleLevels() {
  let moved = false;
  for (const fixture of state.fixtures) {
    // Follow the console fixture if its address was changed there.
    const ci = fixture.link.consoleId ? consoleFixtureById(fixture.link.consoleId) : null;
    if (ci && ci.channelStart !== fixture.link.start) { fixture.link.start = ci.channelStart; moved = true; }
    for (const { channel, attr } of linkChannels(fixture)) {
      const v = consoleLink.incoming(channel);
      if (v != null && v !== fixture.dmx[attr]) { setDmx(fixture, attr, v); moved = true; }
    }
    for (const { attr } of followerChannels(fixture)) followed.set(`${fixture.id}:${attr}`, fixture.dmx[attr]);
  }
  requestRegistrations();
  if (moved) { syncScene(); drawPlan(); renderList(); save({ share: false }); publishStage(); }
  syncInspector();
  renderHud();
  trace.refresh();
}

/** Send values changed on the stage to the console (called from changed()). */
export function pushToConsole() {
  const entries = [];
  for (const fixture of state.fixtures) {
    for (const { channel, attr } of linkChannels(fixture)) entries.push({ channel, value: fixture.dmx[attr] });
    for (const { channel, attr } of followerChannels(fixture)) {
      const key = `${fixture.id}:${attr}`;
      if (followed.has(key) && followed.get(key) !== fixture.dmx[attr]) entries.push({ channel, value: fixture.dmx[attr] });
      followed.set(key, fixture.dmx[attr]);
    }
  }
  consoleLink.push(entries);
}

function linkToConsoleFixture(fixture, ci) {
  if (!ci) return;
  fixture.link = { consoleId: ci.id, start: ci.channelStart, layout: layoutFor(ci.mount, ci.color, ci.channelEnd - ci.channelStart + 1) };
}

/** After (re)linking: take the console's values (it wins at link time), then redraw. */
function afterLinkChange() {
  renderInspector();
  applyConsoleLevels();
  changed();
}

export function linkSectionHtml(fixture) {
  const L = fixture.link;
  const mode = L.consoleId ?? (L.start ? "manual" : "");
  const opt = (v, text) => `<option value="${escapeHtml(v)}"${v === mode ? " selected" : ""}>${escapeHtml(text)}</option>`;
  const missing = L.consoleId && !consoleFixtureById(L.consoleId);
  const attrOpts = (cur) => [`<option value="">—</option>`, ...DMX_ATTRS.map((a) => `<option value="${a}"${a === cur ? " selected" : ""}>${DMX_LABELS[a]}</option>`)].join("");
  return `
    <div class="fields link-fields">
      <div class="subhead">Console link</div>
      ${L.fixture ? `<label>Fixture</label><div class="hint" style="margin:0">${escapeHtml(`${L.fixture.manufacturer} ${L.fixture.model}`)} · ${escapeHtml(L.fixture.mode)} · ${L.fixture.channels.length} ch</div>` : ""}
      <label>Fixture</label>
      <select data-link="target">
        ${opt("", "— not linked —")}
        ${sortedConsoleFixtures().map((c) => opt(c.id, `${c.name} · ${chRange(c)}`)).join("")}
        ${missing ? opt(L.consoleId, "(not found in the console)") : ""}
        ${opt("manual", "Manual address…")}
      </select>
      ${L.start ? `
      <label>Start ch</label>
      <input type="text" data-link="start" value="${addr(L.start)}" title="Start channel: 45, or universe/channel like 2/45"${L.consoleId ? ' disabled' : ""} />
      <label>Layout</label>
      <div class="layout">
        ${L.layout.map((a, k) => `<label class="lay" title="${escapeHtml(L.fixture?.channels[k]?.name ?? "")}"><span>${addr(L.start + k)}</span><select data-layout="${k}">${attrOpts(a)}</select></label>`).join("")}
        <div class="lay-btns">
          <button type="button" data-link-act="add" title="Add a channel">+ ch</button>
          <button type="button" data-link-act="remove" title="Remove the last channel">− ch</button>
          ${L.consoleId ? `<button type="button" data-link-act="preset" title="Reset to the preset for the console fixture's type">Preset</button>` : ""}
        </div>
      </div>` : ""}
      ${!L.start ? `
      <label>Register</label>
      <div class="xyz">
        <select data-reg-type>${CONSOLE_TYPES.filter((t) => t.key !== "none").map((t) => `<option value="${t.key}"${t.key === lastConsoleType() ? " selected" : ""}>${t.label}</option>`).join("")}</select>
        <button type="button" data-link-act="register" title="Create a console fixture for this one, with free faders patched to it">Register</button>
      </div>` : ""}
      <div class="readout" id="linkStatus"></div>
    </div>`;
}

/** Rig only: link every member to consecutive console fixtures. */
export function rigLinkHtml() {
  return `
    <div class="fields rig-fields">
      <label>Link rig</label>
      <select data-rig-link title="Link member 1 to the chosen console fixture, member 2 to the next one, …">
        <option value="">Members in order, from…</option>
        ${sortedConsoleFixtures().map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)} · ${chRange(c)}</option>`).join("")}
        <option value="__unlink">Unlink all members</option>
      </select>
    </div>`;
}

function linkRigFrom(rig, id) {
  const members = rigMembers(rig);
  if (id === "__unlink") {
    members.forEach((m) => { m.link = { consoleId: null, start: null, layout: [] }; });
  } else {
    const list = sortedConsoleFixtures();
    const first = list.findIndex((c) => c.id === id);
    if (first < 0) return;
    members.forEach((m, k) => linkToConsoleFixture(m, list[first + k]));
    const linked = Math.min(members.length, list.length - first);
    if (linked < members.length) setBanner(`Linked ${linked} of ${members.length}: ran out of console fixtures`, 4000);
  }
  afterLinkChange();
}

export function bindLinkControls() {
  const sel = selectedFixtures();
  const fixture = sel.length === 1 ? sel[0] : null;
  inspectorEl.querySelector('[data-link="target"]')?.addEventListener("change", (e) => {
    const v = e.target.value;
    // Moving off a console fixture the stage registered: remove it there.
    if (fixture.link.owned && v !== fixture.link.consoleId) consoleLink.unregister([fixture.link.consoleId]);
    if (v === "") fixture.link = { consoleId: null, start: null, layout: [] };
    else if (v === "manual") fixture.link = { consoleId: null, start: fixture.link.start ?? 1, layout: fixture.link.layout.length ? fixture.link.layout : [...LAYOUT_PRESETS["movable/multi"]] };
    else {
      const profile = fixture.link.fixture;
      linkToConsoleFixture(fixture, consoleFixtureById(v));
      fixture.link.fixture = profile ?? null;
    }
    afterLinkChange();
  });
  inspectorEl.querySelector('[data-link="start"]')?.addEventListener("change", (e) => {
    const v = parseAddr(e.target.value);
    if (v == null) { e.target.value = addr(fixture.link.start); return; }
    fixture.link.start = v;
    afterLinkChange();
  });
  inspectorEl.querySelectorAll("[data-layout]").forEach((el) => {
    el.addEventListener("change", () => {
      fixture.link.layout[Number(el.dataset.layout)] = el.value || null;
      afterLinkChange();
    });
  });
  inspectorEl.querySelectorAll("[data-link-act]").forEach((el) => {
    el.addEventListener("click", () => {
      const L = fixture.link;
      if (el.dataset.linkAct === "add" && L.layout.length < 16) L.layout.push(null);
      if (el.dataset.linkAct === "remove" && L.layout.length > 1) L.layout.pop();
      if (el.dataset.linkAct === "register") {
        const key = inspectorEl.querySelector("[data-reg-type]")?.value;
        rememberConsoleType(key);
        L.register = consoleTypeFromKey(key);
        L.universe = lastUniverse();
        requestRegistrations();
      }
      if (el.dataset.linkAct === "preset") {
        const ci = consoleFixtureById(L.consoleId);
        if (L.fixture) L.layout = L.fixture.channels.map((c) => c.attr);
        else if (ci) linkToConsoleFixture(fixture, ci);
      }
      afterLinkChange();
    });
  });
  inspectorEl.querySelector("[data-rig-link]")?.addEventListener("change", (e) => {
    const rig = commonRig(selectedFixtures());
    if (rig && e.target.value) linkRigFrom(rig, e.target.value);
  });
}

/**
 * What a fixture really has (its library mode's channels, or its console
 * layout), or null when it's stage-only and every attribute is its own.
 */
function presentAttrList(fixture) {
  const { fixture: profile, start, layout } = fixture.link;
  if (profile) return profile.channels.map((c) => c.attr).filter(Boolean);
  return start ? layout.filter(Boolean) : null;
}

function presentAttrs(fixture) {
  const list = presentAttrList(fixture);
  return list ? new Set(list) : null;
}

/**
 * Inspector row order: the color rows in the fixture's channel order (like
 * its console faders), then the colors it doesn't have; the rest as usual.
 */
export function inspectorAttrs(fixture) {
  const isColor = (a) => COLOR_ROLES.includes(a);
  const present = (presentAttrList(fixture) ?? []).filter(isColor);
  const colors = [...new Set([...present, ...DMX_ATTRS.filter(isColor)])];
  const others = DMX_ATTRS.filter((a) => !isColor(a));
  const at = DMX_ATTRS.findIndex(isColor);
  return [...others.slice(0, at), ...colors, ...others.slice(at)];
}

/** A channel badge: its address and the console fader(s) patched to it (⌥-click traces it). */
function chanChip(ch) {
  const faders = consoleLink.fadersFor(ch);
  return `<span class="chan${faders.length ? " on" : ""}" data-ch="${ch}" title="${faders.length ? `DMX ${addr(ch)} ← fader ${faders.join(", ")}` : `DMX ${addr(ch)} · no fader patched`} · ⌥-click to trace">${addr(ch)}${faders.length ? ` F${faders.join(",")}` : ""}</span>`;
}

/**
 * "Other channels": a library fixture's channels the stage doesn't draw
 * (strobe, dimmer curve, fan, fine channels, …). Their sliders show the
 * console's value and set the channel there; nothing changes on the stage.
 */
function syncOtherChannels(fixture) {
  const box = inspectorEl.querySelector("[data-other]");
  if (!box) return;
  const { start, fixture: profile } = fixture.link;
  const others = start && profile
    ? profile.channels.flatMap((c, k) => (c.attr || c.also || c.name.endsWith("(unused)") ? [] : [{ name: c.name, channel: start + k }]))
    : [];
  box.hidden = !others.length;
  // Rebuild only when the channels change, so a slider being dragged stays put.
  const key = others.map((o) => `${o.channel}:${o.name}`).join("|");
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.innerHTML = `<div class="subhead">Other channels · not shown on the stage</div>${others.map(({ name, channel }) => `
      <label title="${escapeHtml(name)}">${escapeHtml(name)}</label>
      <div class="dmx-row">
        <input type="range" min="0" max="255" step="1" data-oc="${channel}" />
        <input type="number" min="0" max="255" step="1" data-oc="${channel}" />
        <span class="dmx-note" data-oc-note="${channel}"></span>
      </div>`).join("")}`;
    box.querySelectorAll("[data-oc]").forEach((el) => {
      el.addEventListener("input", () => {
        const v = clampByte(el.value);
        consoleLink.setChannel(Number(el.dataset.oc), v);
        box.querySelectorAll(`[data-oc="${el.dataset.oc}"]`).forEach((other) => { if (other !== el) other.value = String(v); });
      });
      if (el.type === "range") el.addEventListener("change", () => el.blur());
    });
  }
  const levels = consoleLink.levels;
  box.querySelectorAll("[data-oc]").forEach((el) => {
    if (el === document.activeElement) return;
    el.value = String(levels?.[Number(el.dataset.oc) - 1] ?? 0);
  });
  box.querySelectorAll("[data-oc-note]").forEach((el) => {
    const html = `<span></span><span class="chans">${chanChip(Number(el.dataset.ocNote))}</span>`;
    if (el.innerHTML !== html) el.innerHTML = html;
  });
}

/**
 * DMX rows in the inspector: values, units, and which channel / fader drives
 * each. Attributes the fixture doesn't have (e.g. pan on a fixed light) are
 * dimmed and can't be changed.
 */
export function syncDmxRows(fixture) {
  /** attr → its channels (the first, then any followers). */
  const chans = new Map();
  for (const { channel, attr } of [...linkChannels(fixture), ...followerChannels(fixture)]) chans.set(attr, [...(chans.get(attr) ?? []), channel]);
  const present = presentAttrs(fixture);
  inspectorEl.querySelectorAll("[data-dl]").forEach((el) => {
    const absent = present != null && !present.has(el.dataset.dl);
    el.classList.toggle("is-absent", absent);
    el.title = absent ? "This fixture doesn't have this channel" : "";
    el.querySelectorAll("input").forEach((input) => { input.disabled = absent; });
  });
  inspectorEl.querySelectorAll("[data-d]").forEach((el) => {
    if (el === document.activeElement && el.type !== "range") return;
    el.value = String(fixture.dmx[el.dataset.d]);
  });
  inspectorEl.querySelectorAll("[data-note]").forEach((el) => {
    const a = el.dataset.note;
    const unit = { dimmer: `${Math.round(fixture.intensity * 100)}%`, pan: `${fixture.pan}°`, tilt: `${fixture.tilt}°`, zoom: `${fixture.beam}°` }[a] ?? "";
    el.innerHTML = `<span>${unit}</span><span class="chans">${(chans.get(a) ?? []).map(chanChip).join("")}</span>`;
  });
  syncOtherChannels(fixture);
  const status = inspectorEl.querySelector("#linkStatus");
  if (!status) return;
  const linked = linkChannels(fixture);
  const withFader = linked.filter(({ channel }) => consoleLink.fadersFor(channel).length).length;
  const owned = fixture.link.owned ? " Registered by the stage: deleting it here removes it from the console." : "";
  status.textContent = fixture.link.register
    ? "Registering in the console…"
    : !linked.length
    ? (fixture.link.start ? "No channels assigned in the layout." : "Not linked: values are set here only.")
    : `${withFader} of ${linked.length} channels have a fader: those follow the console, and changes here move the fader.${owned}`;
}

// ---------------------------------------------------------------------
// Registering stage fixtures in the console
// ---------------------------------------------------------------------
// A fixture placed with a console type (or a rig's members, or a copy of a
// registered fixture) asks the console to create a fixture at the next
// free DMX block, patch one free fader per channel and name them. It starts
// at the fixture's current values. A fixture waiting to register (link.register,
// e.g. from a saved stage) registers once the console has started.

const CONSOLE_TYPE_KEY = "unnaturallight.stage.consoleType";
const lastConsoleType = () => { try { return localStorage.getItem(CONSOLE_TYPE_KEY) || "movable/multi"; } catch { return "movable/multi"; } };
export const rememberConsoleType = (key) => { try { localStorage.setItem(CONSOLE_TYPE_KEY, key); } catch { /* storage unavailable */ } };

export const LIBRARY = "library";

// Universe choice for registering (shown when the console has several).
const UNIVERSE_KEY = "unnaturallight.stage.universe";
export const sd = (id) => document.getElementById(id);
const lastUniverse = () => { try { return Number(localStorage.getItem(UNIVERSE_KEY)) || null; } catch { return null; } };

export function fillUniverses(select) {
  const n = consoleLink.universes;
  select.closest("[data-universe-row]").hidden = n < 2;
  const last = lastUniverse();
  select.innerHTML = `<option value="">First with room</option>` +
    Array.from({ length: n }, (_, i) => `<option value="${i + 1}"${last === i + 1 ? " selected" : ""}>Universe ${i + 1}</option>`).join("");
}

/** The chosen universe (remembered), or null for "first with room". */
export function readUniverse(select) {
  const u = Number(select.value) || null;
  try { localStorage.setItem(UNIVERSE_KEY, u ? String(u) : ""); } catch { /* storage unavailable */ }
  return consoleLink.universes > 1 ? u : null;
}

export function fillConsoleTypes(select) {
  const types = [...CONSOLE_TYPES.slice(0, -1), { key: LIBRARY, label: "From fixture library…" }, CONSOLE_TYPES[CONSOLE_TYPES.length - 1]];
  select.innerHTML = types.map((t) => `<option value="${t.key}"${t.key === lastConsoleType() ? " selected" : ""}>${t.label}</option>`).join("");
}

/**
 * Show a fixture picker under a console-type select while "From fixture
 * library…" is chosen. Returns () => the picked profile (or null).
 */
export function libraryPickerFor(select, container) {
  let picker = null;
  const sync = () => {
    const on = select.value === LIBRARY;
    container.hidden = !on;
    if (on && !picker) picker = createFixturePicker(container, { onChange: () => {} });
  };
  select.addEventListener("change", sync);
  return { sync, profile: () => (select.value === LIBRARY ? picker?.profile ?? null : null) };
}

/** Fixtures asked for but not answered yet (the console answers right after this update). */
const registering = new Set();
/** Fixtures another stage window placed and is registering (its job, not ours). */
export const othersRegistering = new Set();

export function requestRegistrations() {
  if (!consoleLink.live) return;
  const requests = [];
  for (const fixture of state.fixtures) {
    const t = fixture.link.register;
    if (!t || registering.has(fixture.id) || othersRegistering.has(fixture.id)) continue;
    const layout = registerLayout(fixture.link, t);
    requests.push({
      stageId: fixture.id,
      name: fixture.name,
      mount: t.mount,
      color: t.color,
      width: layout.length,
      labels: registerLabels(fixture.link, t),
      // What each channel does (so the console can e.g. show R/G/B faders as a color picker).
      roles: layout,
      values: layout.map((a) => (a ? fixture.dmx[a] : 0)),
      group: rigOf(fixture)?.name ?? null,
      universe: fixture.link.universe ?? null,
    });
    registering.add(fixture.id);
  }
  if (requests.length) consoleLink.register(requests);
}

function onRegistered(results) {
  const failed = [];
  for (const r of results) {
    const fixture = byId(r.stageId);
    registering.delete(r.stageId);
    if (!fixture || !fixture.link.register) {
      // Deleted (or unlinked) while waiting: undo it in the console.
      if (r.ok) consoleLink.unregister([r.consoleId]);
      continue;
    }
    const type = fixture.link.register;
    if (!r.ok) {
      fixture.link.register = null;
      failed.push(`${fixture.name}: ${r.error}`);
      continue;
    }
    fixture.link = { consoleId: r.consoleId, start: r.start, layout: registerLayout(fixture.link, type), owned: true, type, register: null, fixture: fixture.link.fixture ?? null, universe: fixture.link.universe ?? null };
  }
  renderInspector();
  changed();
  if (failed.length) setBanner(`Not registered in the console (kept on the stage only) · ${failed.join(" · ")}`, 15000);
}

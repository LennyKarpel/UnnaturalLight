// Real fixtures from the Open Fixture Library (open-fixture-library.org):
// browse manufacturers → fixtures → modes, and turn a mode into a channel
// profile for a stage fixture and its console fixture.
//
// Needs internet while browsing. A picked profile is saved with the fixture,
// so placed fixtures keep working offline.

import { DMX_ATTRS, DMX_LABELS as LABEL } from "../shared/attributes.js";
import { COLOR_ROLES } from "../shared/color.js";
import { escapeHtml as esc } from "../shared/html.js";
import { numberFrom } from "../shared/numbers.js";
/** Console fixtures are capped at this many channels. */
import { MAX_FIXTURE_CHANNELS } from "../console/fixtures.js";

// The OFL API only allows requests from its own site and http://localhost:8080
// (what ./server.sh serves); from anywhere else the library's files on
// GitHub are used instead (they allow any origin; listing a manufacturer's
// fixtures there counts against GitHub's 60-per-hour limit, so it's cached).
const API = "https://open-fixture-library.org/api/v1";
const RAW = "https://raw.githubusercontent.com/OpenLightingProject/open-fixture-library/master/fixtures";
const GITHUB_LIST = "https://api.github.com/repos/OpenLightingProject/open-fixture-library/contents/fixtures";

/**
 * @typedef {(typeof import("../shared/attributes.js").DMX_ATTRS)[number]} DmxAttr
 * @typedef {{ name: string, attr: DmxAttr | null, also?: DmxAttr }} ProfileChannel
 * also: a second channel of a color the fixture already has (e.g. Red after
 * Deep Red); it follows that color.
 * @typedef {{
 *   manufacturer: string, model: string, mode: string, key: string,
 *   channels: ProfileChannel[],
 *   mount: "fixed" | "movable", color: "single" | "multi",
 *   panLimit: number | null, tiltLimit: number | null,
 *   zoomMin: number | null, zoomMax: number | null,
 * }} FixtureProfile
 * One mode of a real fixture: its channels in order, which ones the stage
 * can draw (attr), and the real pan / tilt / zoom ranges when known.
 */

const cache = new Map();
async function getJson(url) {
  if (cache.has(url)) return cache.get(url);
  const p = fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
  cache.set(url, p);
  p.catch(() => cache.delete(url));
  return p;
}

/** Try the API first, then the GitHub fallback. */
async function either(primary, fallback) {
  try { return await primary(); } catch { return fallback(); }
}

/** "colorsource-par" → "Colorsource Par" (fallback names, when the API isn't reachable). */
const titleFromKey = (key) => key.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** @returns {Promise<{ key: string, name: string, count: number | null }[]>} */
async function listManufacturers() {
  const list = await either(
    async () => Object.entries(await getJson(`${API}/manufacturers`)).map(([key, m]) => ({ key, name: m.name, count: m.fixtureCount })),
    async () => Object.entries(await getJson(`${RAW}/manufacturers.json`))
      .filter(([key]) => !key.startsWith("$"))
      .map(([key, m]) => ({ key, name: m.name, count: null })),
  );
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

const FIXTURE_LIST_CACHE = "unnaturallight.stage.oflFixtures.";

/** @returns {Promise<{ key: string, name: string }[]>} */
async function listFixtures(manufacturer) {
  const list = await either(
    async () => (await getJson(`${API}/manufacturers/${encodeURIComponent(manufacturer)}`)).fixtures.map(({ key, name }) => ({ key, name })),
    async () => {
      try {
        const cached = JSON.parse(localStorage.getItem(FIXTURE_LIST_CACHE + manufacturer) ?? "null");
        if (Array.isArray(cached)) return cached;
      } catch { /* storage unavailable */ }
      const files = await getJson(`${GITHUB_LIST}/${encodeURIComponent(manufacturer)}`);
      const out = files
        .filter((f) => f.type === "file" && f.name.endsWith(".json"))
        .map((f) => { const key = f.name.slice(0, -5); return { key, name: titleFromKey(key) }; });
      try { localStorage.setItem(FIXTURE_LIST_CACHE + manufacturer, JSON.stringify(out)); } catch { /* storage unavailable */ }
      return out;
    },
  );
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

const loadFixture = (manufacturer, fixture) =>
  getJson(`${RAW}/${encodeURIComponent(manufacturer)}/${encodeURIComponent(fixture)}.json`);

// ---------------------------------------------------------------------
// Fixture → profile
// ---------------------------------------------------------------------

const COLOR_ATTR = { Red: "red", Green: "green", Blue: "blue", White: "white", "Warm White": "white", "Cold White": "white", Amber: "amber", Lime: "lime", Cyan: "cyan", Indigo: "indigo", UV: "uv" };

/** Channel names of a deep red LED (e.g. ETC x8 "Deep Red"). */
const DEEP_RED = /^deep\s*red$/i;

/** "540deg" → 540; anything else → null. */
const degrees = (v) => {
  const m = /^(-?\d+(?:\.\d+)?)deg$/.exec(String(v ?? ""));
  return m ? Number(m[1]) : null;
};

/** The channel's main capability (first one that does something). */
function mainCapability(ch) {
  if (ch?.capability) return ch.capability;
  const list = Array.isArray(ch?.capabilities) ? ch.capabilities : [];
  return list.find((c) => c.type !== "NoFunction") ?? list[0] ?? null;
}

/** What a channel means to the stage, plus any angle range it carries. */
function classify(ch) {
  const cap = mainCapability(ch);
  if (!cap) return { attr: null };
  const span = () => {
    const a = degrees(cap.angleStart ?? cap.angle);
    const b = degrees(cap.angleEnd ?? cap.angle);
    return a != null && b != null ? { lo: Math.min(a, b), hi: Math.max(a, b) } : null;
  };
  switch (cap.type) {
    case "Intensity": return { attr: "dimmer" };
    case "Pan": return { attr: "pan", range: span() };
    case "Tilt": return { attr: "tilt", range: span() };
    case "Zoom": return { attr: "zoom", range: span() };
    case "ColorIntensity": return { attr: COLOR_ATTR[cap.color] ?? null };
    default: return { attr: null };
  }
}

/** Modes of a fixture, with whether each can be used here (and why not). */
function modesOf(fixture) {
  return (fixture.modes ?? []).map((mode, index) => {
    const n = Array.isArray(mode.channels) ? mode.channels.length : 0;
    const matrix = (mode.channels ?? []).some((c) => c && typeof c === "object");
    const reason = matrix ? "pixel / matrix mode (not supported)" : n > MAX_FIXTURE_CHANNELS ? `${n} channels (max ${MAX_FIXTURE_CHANNELS})` : n === 0 ? "no channels" : "";
    return { index, name: mode.name, channels: n, ok: !reason, reason };
  });
}

/**
 * Build the profile for one mode. Channels the stage can draw get an attr
 * (only the first of each kind); everything else (strobe, gobo, fine
 * channels, …) is kept by name so the console can still give it a fader.
 * @returns {FixtureProfile}
 */
function profileFor(fixture, manufacturerName, manufacturerKey, fixtureKey, modeIndex) {
  const mode = fixture.modes[modeIndex];
  const available = fixture.availableChannels ?? {};
  // Pixel fixtures define channels as templates ("Red $pixelKey"), used in
  // modes as e.g. "Red Master" or "Red 1a".
  const templates = Object.entries(fixture.templateChannels ?? {}).map(([name, ch]) => {
    const [before, after] = name.split("$pixelKey");
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return { re: new RegExp(`^${esc(before)}.+${esc(after ?? "")}$`), ch };
  });
  const channelFor = (key) => available[key] ?? templates.find((t) => t.re.test(key))?.ch ?? null;
  const used = new Set();
  const ranges = {};
  /** @type {ProfileChannel[]} */
  const channels = mode.channels.map((key, k) => {
    if (key == null) return { name: `Ch ${k + 1} (unused)`, attr: null };
    const ch = channelFor(key);
    // Fine (16-bit) and switching aliases aren't defined as channels.
    if (!ch) return { name: key, attr: null };
    const { attr: kind, range } = classify(ch);
    // The library calls a deep red LED just "Red": tell it apart by name.
    const attr = kind === "red" && DEEP_RED.test(key) ? "deepred" : kind;
    if (attr && used.has(attr) && COLOR_ROLES.includes(attr)) return { name: key, attr: null, also: attr };
    if (!attr || used.has(attr)) return { name: key, attr: null };
    used.add(attr);
    if (range) ranges[attr] = range;
    return { name: key, attr };
  });
  const lens = fixture.physical?.lens?.degreesMinMax;
  const halfRange = (r) => (r ? Math.round((r.hi - r.lo) / 2) : null);
  return {
    manufacturer: manufacturerName,
    model: fixture.name,
    mode: mode.name,
    key: `${manufacturerKey}/${fixtureKey}`,
    channels,
    mount: used.has("pan") || used.has("tilt") ? "movable" : "fixed",
    color: ["red", "green", "blue"].some((a) => used.has(a)) ? "multi" : "single",
    panLimit: halfRange(ranges.pan),
    tiltLimit: halfRange(ranges.tilt),
    zoomMin: ranges.zoom?.lo ?? (Array.isArray(lens) ? lens[0] : null),
    zoomMax: ranges.zoom?.hi ?? (Array.isArray(lens) ? lens[1] : null),
  };
}

/**
 * Profiles saved before the stage knew white / amber / lime / cyan / indigo
 * / UV, or second channels of a color, have those channels without an attr:
 * give them one by channel name ("Amber", "Warm White", …), like
 * profileFor() does now.
 */
function upgradeColorAttrs(channels) {
  // Deep red was "red" (with a later Red as its second channel) before it had its own attr.
  for (const c of channels) {
    if (c.attr !== "red" || !DEEP_RED.test(c.name.trim())) continue;
    c.attr = "deepred";
    const second = channels.find((d) => d.also === "red");
    if (second) { second.attr = "red"; delete second.also; }
  }
  const used = new Set(channels.map((c) => c.attr));
  for (const c of channels) {
    const name = c.name.trim();
    const attr = DEEP_RED.test(name) ? "deepred" : COLOR_ATTR[Object.keys(COLOR_ATTR).find((k) => k.toLowerCase() === name.toLowerCase()) ?? ""];
    if (c.attr || c.also || !attr) continue;
    if (used.has(attr)) c.also = attr;
    else c.attr = attr;
    used.add(attr);
  }
  return channels;
}

/** A quick check of a saved profile; null if it doesn't look right. */
export function normalizeProfile(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.channels) || !raw.channels.length) return null;
  const num = numberFrom;
  return {
    manufacturer: String(raw.manufacturer ?? ""),
    model: String(raw.model ?? "Fixture"),
    mode: String(raw.mode ?? ""),
    key: String(raw.key ?? ""),
    channels: upgradeColorAttrs(raw.channels.slice(0, MAX_FIXTURE_CHANNELS).map((c, k) => ({
      name: String(c?.name ?? `Ch ${k + 1}`),
      attr: DMX_ATTRS.includes(c?.attr) ? c.attr : null,
      ...(COLOR_ROLES.includes(c?.also) ? { also: c.also } : {}),
    }))),
    mount: raw.mount === "movable" ? "movable" : "fixed",
    color: raw.color === "multi" ? "multi" : "single",
    panLimit: num(raw.panLimit), tiltLimit: num(raw.tiltLimit),
    zoomMin: num(raw.zoomMin), zoomMax: num(raw.zoomMax),
  };
}

// ---------------------------------------------------------------------
// Picker UI (manufacturer → search → fixture → mode)
// ---------------------------------------------------------------------

const LAST_KEY = "unnaturallight.stage.lastFixture";

/**
 * Mount a fixture picker in `root`. `onChange(profile | null)` fires when a
 * usable mode is chosen (or the choice is lost).
 */
export function createFixturePicker(root, { onChange }) {
  root.innerHTML = `
    <div class="fields">
      <label>Manufacturer</label><select data-lib="man"><option value="">Loading…</option></select>
      <label>Search</label><input type="search" data-lib="q" placeholder="Model name" />
      <label>Fixture</label><select data-lib="fix" size="6"></select>
      <label>Mode</label><select data-lib="mode"></select>
    </div>
    <div class="lib-info" data-lib="info"></div>`;
  const $ = (k) => root.querySelector(`[data-lib="${k}"]`);
  const man = $("man"), q = $("q"), fix = $("fix"), mode = $("mode"), info = $("info");

  let last = {};
  try { last = JSON.parse(localStorage.getItem(LAST_KEY) ?? "{}"); } catch { /* storage unavailable */ }
  const remember = () => { try { localStorage.setItem(LAST_KEY, JSON.stringify(last)); } catch { /* storage unavailable */ } };

  let manufacturers = [];
  let fixtures = [];
  let fixture = null;
  /** @type {FixtureProfile | null} */
  let profile = null;
  let loadToken = 0;

  const setInfo = (html, tone = "") => { info.innerHTML = html; info.dataset.tone = tone; };
  const offline = (what) => setInfo(`Couldn't load ${what} from the Open Fixture Library (offline?). You can still use a generic console type.`, "warn");

  function choose(p) {
    profile = p;
    onChange(p);
    if (!p) return;
    const lines = p.channels.map((c, k) => `<li><span>${k + 1}</span> ${esc(c.name)}${c.attr ? ` <b>→ ${LABEL[c.attr]}</b>` : ""}</li>`).join("");
    const extra = [
      p.panLimit != null ? `pan ±${p.panLimit}°` : "",
      p.tiltLimit != null ? `tilt ±${p.tiltLimit}°` : "",
      p.zoomMin != null && p.zoomMax != null ? `beam ${p.zoomMin}–${p.zoomMax}°` : "",
    ].filter(Boolean).join(" · ");
    setInfo(`<div><b>${esc(p.manufacturer)} ${esc(p.model)}</b> · ${esc(p.mode)} · ${p.channels.length} ch · ${p.mount === "movable" ? "Movable" : "Fixed"} · ${p.color === "multi" ? "Multi-color" : "Single color"}${extra ? ` · ${extra}` : ""}</div>
      <ol class="lib-chans">${lines}</ol>
      <div class="lib-note">→ = drawn on the stage. Every channel gets a console fader named after it.</div>`);
  }

  function renderFixtures() {
    const term = q.value.trim().toLowerCase();
    const shown = fixtures.filter((f) => !term || f.name.toLowerCase().includes(term));
    fix.innerHTML = shown.map((f) => `<option value="${esc(f.key)}"${f.key === last.fixture ? " selected" : ""}>${esc(f.name)}</option>`).join("")
      || `<option disabled>${fixtures.length ? "No match" : "No fixtures"}</option>`;
  }

  async function pickManufacturer(key) {
    const token = ++loadToken;
    fixtures = []; fixture = null; mode.innerHTML = ""; choose(null);
    if (!key) { renderFixtures(); return; }
    fix.innerHTML = `<option disabled>Loading…</option>`;
    try {
      const list = await listFixtures(key);
      if (token !== loadToken) return;
      fixtures = list;
      last.manufacturer = key; remember();
      renderFixtures();
      setInfo(`${list.length} fixture${list.length === 1 ? "" : "s"}. Pick one.`);
      if (last.fixture && list.some((f) => f.key === last.fixture)) await pickFixture(last.fixture);
    } catch { if (token === loadToken) offline("this manufacturer's fixtures"); }
  }

  async function pickFixture(key) {
    const token = ++loadToken;
    fixture = null; mode.innerHTML = ""; choose(null);
    if (!key) return;
    setInfo("Loading fixture…");
    try {
      const f = await loadFixture(man.value, key);
      if (token !== loadToken) return;
      fixture = f;
      last.fixture = key; remember();
      const modes = modesOf(f);
      mode.innerHTML = modes.map((m) => `<option value="${m.index}"${m.ok ? "" : " disabled"}>${esc(m.name)} · ${m.channels} ch${m.ok ? "" : ` (${esc(m.reason)})`}</option>`).join("");
      const preferred = modes.find((m) => m.ok && m.name === last.mode) ?? modes.find((m) => m.ok);
      if (!preferred) { setInfo("No usable mode in this fixture.", "warn"); return; }
      mode.value = String(preferred.index);
      pickMode(preferred.index);
    } catch { if (token === loadToken) offline("this fixture"); }
  }

  function pickMode(index) {
    if (!fixture) return;
    const m = fixture.modes[index];
    last.mode = m?.name; remember();
    const manufacturer = manufacturers.find((x) => x.key === man.value);
    choose(profileFor(fixture, manufacturer?.name ?? man.value, man.value, fix.value, index));
  }

  man.addEventListener("change", () => { q.value = ""; void pickManufacturer(man.value); });
  q.addEventListener("input", renderFixtures);
  fix.addEventListener("change", () => void pickFixture(fix.value));
  mode.addEventListener("change", () => pickMode(Number(mode.value)));

  (async () => {
    try {
      manufacturers = await listManufacturers();
      man.innerHTML = `<option value="">Choose…</option>` + manufacturers.map((m) => `<option value="${esc(m.key)}"${m.key === last.manufacturer ? " selected" : ""}>${esc(m.name)}${m.count != null ? ` (${m.count})` : ""}</option>`).join("");
      if (last.manufacturer && manufacturers.some((m) => m.key === last.manufacturer)) await pickManufacturer(last.manufacturer);
      else setInfo("Pick a manufacturer.");
    } catch {
      man.innerHTML = `<option value="">Unavailable</option>`;
      offline("the manufacturer list");
    }
  })();

  return {
    get profile() { return profile; },
  };
}

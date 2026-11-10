// Real fixtures from the Open Fixture Library (open-fixture-library.org):
// browse manufacturers → fixtures → modes, and turn a mode into a channel
// profile for a stage fixture and its console fixture.
//
// Needs internet while browsing. A picked profile is saved with the fixture,
// so placed fixtures keep working offline.

import { DMX_LABELS as LABEL, isDmxAttr, type DmxAttr } from "../shared/attributes.ts";
import { isRecord } from "../shared/guards.ts";
import { isColorRole } from "../shared/color.ts";
import { escapeHtml as esc } from "../shared/html.ts";
import { numberFrom } from "../shared/numbers.ts";
import { $ as find } from "../shared/query.ts";
/** Console fixtures are capped at this many channels. */
import { MAX_FIXTURE_CHANNELS, type ColorMode, type MountType } from "../console/fixtures.ts";
import { readStoredJson, storeJson } from "../shared/storage.ts";

// The OFL API only allows requests from its own site and http://localhost:8080
// (what ./server.sh serves); from anywhere else the library's files on
// GitHub are used instead (they allow any origin; listing a manufacturer's
// fixtures there counts against GitHub's 60-per-hour limit, so it's cached).
const API = "https://open-fixture-library.org/api/v1";
const RAW = "https://raw.githubusercontent.com/OpenLightingProject/open-fixture-library/master/fixtures";
const GITHUB_LIST = "https://api.github.com/repos/OpenLightingProject/open-fixture-library/contents/fixtures";

/** also: a second channel of a color the fixture already has (e.g. Red after
 * Deep Red); it follows that color. */
export type ProfileChannel = { name: string; attr: DmxAttr | null; also?: DmxAttr };
/** One mode of a real fixture: its channels in order, which ones the stage
 * can draw (attr), and the real pan / tilt / zoom ranges when known. */
export type FixtureProfile = {
  manufacturer: string; model: string; mode: string; key: string;
  channels: ProfileChannel[];
  mount: MountType; color: ColorMode;
  panLimit: number | null; tiltLimit: number | null;
  zoomMin: number | null; zoomMax: number | null;
};

// The Open Fixture Library's JSON (only the parts used here).
type OflCapability = { type?: string; color?: string; angle?: string; angleStart?: string; angleEnd?: string };
type OflChannel = { capability?: OflCapability; capabilities?: OflCapability[] };
type OflMode = { name: string; channels?: (string | null | object)[] };
type OflFixture = {
  name: string;
  modes?: OflMode[];
  availableChannels?: Record<string, OflChannel>;
  templateChannels?: Record<string, OflChannel>;
  physical?: { lens?: { degreesMinMax?: [number, number] } };
};
type Manufacturer = { key: string; name: string; count: number | null };
type FixtureEntry = { key: string; name: string };

const cache = new Map<string, Promise<unknown>>();
/** Parsed JSON from `url` (fetched once), trusted to be a `T` (the Open Fixture Library's documented shapes). */
function getJson<T>(url: string): Promise<T> {
  const hit = cache.get(url);
  if (hit) return hit as Promise<T>;
  const p = fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
  cache.set(url, p);
  p.catch(() => cache.delete(url));
  return p as Promise<T>;
}

/** Try the API first, then the GitHub fallback. */
async function either<T>(primary: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try { return await primary(); } catch { return fallback(); }
}

/** "colorsource-par" → "Colorsource Par" (fallback names, when the API isn't reachable). */
const titleFromKey = (key: string) => key.replace(/[-_]+/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());

async function listManufacturers(): Promise<Manufacturer[]> {
  const list = await either<Manufacturer[]>(
    async () => Object.entries(await getJson<Record<string, { name: string; fixtureCount: number }>>(`${API}/manufacturers`)).map(([key, m]) => ({ key, name: m.name, count: m.fixtureCount })),
    async () => Object.entries(await getJson<Record<string, { name: string }>>(`${RAW}/manufacturers.json`))
      .filter(([key]) => !key.startsWith("$"))
      .map(([key, m]) => ({ key, name: m.name, count: null })),
  );
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

const FIXTURE_LIST_CACHE = "unnaturallight.stage.oflFixtures.";

async function listFixtures(manufacturer: string): Promise<FixtureEntry[]> {
  const list = await either<FixtureEntry[]>(
    async () => (await getJson<{ fixtures: FixtureEntry[] }>(`${API}/manufacturers/${encodeURIComponent(manufacturer)}`)).fixtures.map(({ key, name }) => ({ key, name })),
    async () => {
      const cached = readStoredJson(FIXTURE_LIST_CACHE + manufacturer);
      if (Array.isArray(cached)) return cached;
      const files = await getJson<{ type: string; name: string }[]>(`${GITHUB_LIST}/${encodeURIComponent(manufacturer)}`);
      const out = files
        .filter((f) => f.type === "file" && f.name.endsWith(".json"))
        .map((f) => { const key = f.name.slice(0, -5); return { key, name: titleFromKey(key) }; });
      storeJson(FIXTURE_LIST_CACHE + manufacturer, out);
      return out;
    },
  );
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

const loadFixture = (manufacturer: string, fixture: string): Promise<OflFixture> =>
  getJson<OflFixture>(`${RAW}/${encodeURIComponent(manufacturer)}/${encodeURIComponent(fixture)}.json`);

// ---------------------------------------------------------------------
// Fixture → profile
// ---------------------------------------------------------------------

const COLOR_ATTR: Record<string, DmxAttr> = { Red: "red", Green: "green", Blue: "blue", White: "white", "Warm White": "white", "Cold White": "white", Amber: "amber", Lime: "lime", Cyan: "cyan", Indigo: "indigo", UV: "uv" };

/** Channel names of a deep red LED (e.g. ETC x8 "Deep Red"). */
const DEEP_RED = /^deep\s*red$/i;

/** "540deg" → 540; anything else → null. */
const degrees = (v: unknown): number | null => {
  const m = /^(-?\d+(?:\.\d+)?)deg$/.exec(String(v ?? ""));
  return m ? Number(m[1]) : null;
};

/** The channel's main capability (first one that does something). */
function mainCapability(ch: OflChannel | null | undefined): OflCapability | null {
  if (ch?.capability) return ch.capability;
  const list = Array.isArray(ch?.capabilities) ? ch.capabilities : [];
  return list.find((c) => c.type !== "NoFunction") ?? list[0] ?? null;
}

/** What a channel means to the stage, plus any angle range it carries. */
function classify(ch: OflChannel): { attr: DmxAttr | null; range?: { lo: number; hi: number } | null } {
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
    case "ColorIntensity": return { attr: COLOR_ATTR[cap.color ?? ""] ?? null };
    default: return { attr: null };
  }
}

/** Modes of a fixture, with whether each can be used here (and why not). */
function modesOf(fixture: OflFixture): { index: number; name: string; channels: number; ok: boolean; reason: string }[] {
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
 */
function profileFor(fixture: OflFixture, manufacturerName: string, manufacturerKey: string, fixtureKey: string, modeIndex: number): FixtureProfile {
  const mode = (fixture.modes ?? [])[modeIndex];
  const available = fixture.availableChannels ?? {};
  // Pixel fixtures define channels as templates ("Red $pixelKey"), used in
  // modes as e.g. "Red Master" or "Red 1a".
  const templates = Object.entries(fixture.templateChannels ?? {}).map(([name, ch]) => {
    const [before, after] = name.split("$pixelKey");
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return { re: new RegExp(`^${esc(before)}.+${esc(after ?? "")}$`), ch };
  });
  const channelFor = (key: string) => available[key] ?? templates.find((t) => t.re.test(key))?.ch ?? null;
  const used = new Set<DmxAttr>();
  const ranges: Partial<Record<DmxAttr, { lo: number; hi: number }>> = {};
  const channels = (mode.channels ?? []).map((entry, k): ProfileChannel => {
    // Matrix modes (object entries) can't be picked (see the mode list); null = an unused slot.
    const key = typeof entry === "string" ? entry : null;
    if (key == null) return { name: `Ch ${k + 1} (unused)`, attr: null };
    const ch = channelFor(key);
    // Fine (16-bit) and switching aliases aren't defined as channels.
    if (!ch) return { name: key, attr: null };
    const { attr: kind, range } = classify(ch);
    // The library calls a deep red LED just "Red": tell it apart by name.
    const attr: DmxAttr | null = kind === "red" && DEEP_RED.test(key) ? "deepred" : kind;
    if (attr && used.has(attr) && isColorRole(attr)) return { name: key, attr: null, also: attr };
    if (!attr || used.has(attr)) return { name: key, attr: null };
    used.add(attr);
    if (range) ranges[attr] = range;
    return { name: key, attr };
  });
  const lens = fixture.physical?.lens?.degreesMinMax;
  const halfRange = (r: { lo: number; hi: number } | undefined) => (r ? Math.round((r.hi - r.lo) / 2) : null);
  return {
    manufacturer: manufacturerName,
    model: fixture.name,
    mode: mode.name,
    key: `${manufacturerKey}/${fixtureKey}`,
    channels,
    mount: used.has("pan") || used.has("tilt") ? "movable" : "fixed",
    color: (["red", "green", "blue"] as const).some((a) => used.has(a)) ? "multi" : "single",
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
function upgradeColorAttrs(channels: ProfileChannel[]): ProfileChannel[] {
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
    const attr: DmxAttr | undefined = DEEP_RED.test(name) ? "deepred" : COLOR_ATTR[Object.keys(COLOR_ATTR).find((k) => k.toLowerCase() === name.toLowerCase()) ?? ""];
    if (c.attr || c.also || !attr) continue;
    if (used.has(attr)) c.also = attr;
    else c.attr = attr;
    used.add(attr);
  }
  return channels;
}

/** A quick check of a saved profile; null if it doesn't look right. */
export function normalizeProfile(data: unknown): FixtureProfile | null {
  if (!isRecord(data)) return null;
  const raw = data;
  const channels: unknown[] = Array.isArray(raw.channels) ? raw.channels : [];
  if (!channels.length) return null;
  const num = numberFrom;
  return {
    manufacturer: String(raw.manufacturer ?? ""),
    model: String(raw.model ?? "Fixture"),
    mode: String(raw.mode ?? ""),
    key: String(raw.key ?? ""),
    channels: upgradeColorAttrs(channels.slice(0, MAX_FIXTURE_CHANNELS).map((saved, k) => {
      const c = isRecord(saved) ? saved : {};
      return {
        name: String(c.name ?? `Ch ${k + 1}`),
        attr: isDmxAttr(c.attr) ? c.attr : null,
        ...(isColorRole(c.also) ? { also: c.also } : {}),
      };
    })),
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
export function createFixturePicker(
  root: HTMLElement,
  { onChange }: { onChange: (profile: FixtureProfile | null) => void },
): { readonly profile: FixtureProfile | null } {
  root.innerHTML = `
    <div class="fields">
      <label>Manufacturer</label><select data-lib="man"><option value="">Loading…</option></select>
      <label>Search</label><input type="search" data-lib="q" placeholder="Model name" />
      <label>Fixture</label><select data-lib="fix" size="6"></select>
      <label>Mode</label><select data-lib="mode"></select>
    </div>
    <div class="lib-info" data-lib="info"></div>`;
  const $ = <E extends HTMLElement>(k: string) => find<E>(root, `[data-lib="${k}"]`);
  const man = $<HTMLSelectElement>("man"), q = $<HTMLInputElement>("q"), fix = $<HTMLSelectElement>("fix"), mode = $<HTMLSelectElement>("mode"), info = $("info");

  const saved = readStoredJson(LAST_KEY);
  const text = (v: unknown) => (typeof v === "string" ? v : undefined);
  const last: { manufacturer?: string; fixture?: string; mode?: string } = isRecord(saved)
    ? { manufacturer: text(saved.manufacturer), fixture: text(saved.fixture), mode: text(saved.mode) }
    : {};
  const remember = () => storeJson(LAST_KEY, last);

  let manufacturers: Manufacturer[] = [];
  let fixtures: FixtureEntry[] = [];
  let fixture: OflFixture | null = null;
  let profile: FixtureProfile | null = null;
  let loadToken = 0;

  const setInfo = (html: string, tone = "") => { info.innerHTML = html; info.dataset.tone = tone; };
  const offline = (what: string) => setInfo(`Couldn't load ${what} from the Open Fixture Library (offline?). You can still use a generic console type.`, "warn");

  function choose(p: FixtureProfile | null) {
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

  async function pickManufacturer(key: string) {
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

  async function pickFixture(key: string) {
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

  function pickMode(index: number) {
    if (!fixture) return;
    const m = fixture.modes?.[index];
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

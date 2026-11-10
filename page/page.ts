// The app page: lays out its two panes, the stage and the console (both
// always there; Console / Both / Stage only changes which are shown), and
// shows the console's show and DMX controls in its header (bottom of this
// script).

import { ask } from "../shared/ask.ts";
import { setActivePane, type Pane } from "../shared/panes.ts";
import { elById } from "../shared/query.ts";
import type { ConsoleHeader } from "../console/app.ts";
import type { ArtNetNode, NetOutputSetting } from "../shared/protocol.ts";
import { errorMessage, isRecord } from "../shared/guards.ts";
import { readStoredJson, storeJson } from "../shared/storage.ts";
import { el, button } from "../shared/html.ts";
import { clamp } from "../shared/numbers.ts";

const KEY = "unnaturallight.shell";
const MIN = 20; // % each side keeps in Both view
const panes = elById("panes");
const stage = elById("stagePane");
const consolePane = elById("consolePane");
const divider = elById("divider");
const swapBtn = elById<HTMLButtonElement>("swapBtn");

/** Which panes are shown: both side by side, or one. */
type Mode = "both" | Pane;
const isMode = (v: unknown): v is Mode => v === "both" || v === "stage" || v === "console";

// split = width of the LEFT pane in Both view (%); swapped = console on the left.
let prefs: { mode: Mode; split: number; swapped: boolean } = { mode: "both", split: 50, swapped: false };
const savedPrefs = readStoredJson(KEY);
if (isRecord(savedPrefs)) prefs = { ...prefs, ...savedPrefs };
if (!isMode(prefs.mode)) prefs.mode = "both";
const save = () => storeJson(KEY, prefs);

function place(pane: HTMLElement, left: number, width: number, z: number, shown = true) {
  pane.style.left = `${left}%`;
  pane.style.width = `${width}%`;
  pane.style.zIndex = String(z);
  pane.style.visibility = shown ? "visible" : "hidden";
  pane.inert = !shown || z < 2;
}

function layout() {
  const { mode, split } = prefs;
  if (mode === "both") {
    const [left, right] = prefs.swapped ? [consolePane, stage] : [stage, consolePane];
    place(left, 0, split, 2);
    place(right, split, 100 - split, 2);
    divider.style.left = `${split}%`;
    divider.hidden = false;
  } else if (mode === "stage") {
    // Console stays full-size and rendered underneath, so its fades keep running.
    place(stage, 0, 100, 2);
    place(consolePane, 0, 100, 1);
    divider.hidden = true;
  } else {
    place(consolePane, 0, 100, 2);
    place(stage, 0, 100, 1, false);
    divider.hidden = true;
  }
  // Only one pane shown: keys go to it.
  if (mode !== "both") setActivePane(mode);
  document.querySelectorAll<HTMLElement>("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
  swapBtn.disabled = mode !== "both";
  swapBtn.title = prefs.swapped ? "Swap sides: stage left, console right" : "Swap sides: console left, stage right";
}

// Swap keeps each pane's width: the left pane's share moves to the right.
swapBtn.addEventListener("click", () => {
  prefs.swapped = !prefs.swapped;
  prefs.split = 100 - prefs.split;
  save();
  layout();
});

document.querySelectorAll<HTMLElement>("[data-mode]").forEach((b) => {
  b.addEventListener("click", () => {
    const mode = b.dataset.mode;
    if (!isMode(mode)) return;
    prefs.mode = mode;
    save();
    layout();
  });
});

divider.addEventListener("pointerdown", (e) => {
  divider.setPointerCapture(e.pointerId);
  document.body.classList.add("dragging");
});
divider.addEventListener("pointermove", (e) => {
  if (!divider.hasPointerCapture(e.pointerId)) return;
  const r = panes.getBoundingClientRect();
  prefs.split = clamp(((e.clientX - r.left) / r.width) * 100, MIN, 100 - MIN);
  layout();
});
const endDrag = () => { document.body.classList.remove("dragging"); save(); };
divider.addEventListener("pointerup", endDrag);
divider.addEventListener("pointercancel", endDrag);
divider.addEventListener("dblclick", () => { prefs.split = 50; save(); layout(); });

layout();
// Both shown: keys go to the stage until you click in the console.
if (prefs.mode === "both") setActivePane("stage");

// ---------------------------------------------------------------
// Show name, show buttons, DMX outputs and status: the console's
// (console/app.ts consoleHeader), shown up here for the whole page.
// ---------------------------------------------------------------
const showNameEl = elById("showName");
const showMenuBtn = elById("showMenuBtn");
const showMenu = elById("showMenu");
const statusEl = elById("status");
const universeCount = elById<HTMLSelectElement>("universeCount");
const outputBtns = elById("outputBtns");
const serverPill = elById("serverPill");
const loadFile = elById<HTMLInputElement>("loadFile");
/** The console's header API, once it has started. */
let header: ConsoleHeader | null = null;
let unsubscribe: (() => void) | null = null;
let outputsKey = "";

function render() {
  if (!header) return;
  const st = header.state();
  showNameEl.textContent = st.showName;
  showNameEl.hidden = showMenuBtn.hidden = false;
  showMenuBtn.setAttribute("aria-label", `Options for show ${st.showName}`);
  document.title = `${st.showName} · UnnaturalLight`;
  statusEl.textContent = st.status.text;
  statusEl.title = st.status.text;
  statusEl.dataset.state = st.status.state;
  serverPill.textContent = st.serverLive ? "Server · live" : "Server · offline";
  serverPill.classList.toggle("is-on", st.serverLive);
  serverPill.title = st.serverLive
    ? `Connected to the show server (${st.serverHost}): edits are saved there and it drives the DMX`
    : "Not connected to the show server: reconnecting…";

  if (universeCount.options.length !== st.maxUniverses) {
    universeCount.replaceChildren(...Array.from({ length: st.maxUniverses }, (_, i) =>
      new Option(i === 0 ? "1 universe" : `${i + 1} universes`, String(i + 1))));
  }
  universeCount.value = String(st.universes);

  // One universe: one DMX button. Several: a button per universe. Each opens its output menu.
  const key = JSON.stringify([st.outputs, st.serverLive]);
  if (key === outputsKey) return;
  outputsKey = key;
  outputBtns.replaceChildren(...st.outputs.map(({ usb, network }, i) => {
    const u = i + 1;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.classList.toggle("connected", usb || network != null);
    btn.disabled = !st.serverLive;
    btn.setAttribute("aria-haspopup", "menu");
    const kinds = [usb && "USB", network?.split(" ")[0]].filter(Boolean);
    btn.textContent = st.outputs.length > 1 ? `U${u}` : kinds.length ? `DMX · ${kinds.join(" + ")}` : "Connect DMX";
    const sends = [usb && "DMX USB Pro", network].filter(Boolean);
    btn.title = `${st.outputs.length > 1 ? `Universe ${u}` : "DMX"}: ${sends.length ? sends.join(" + ") : "no output"} (click to choose)`;
    btn.addEventListener("click", () => toggleOutputMenu(u, btn));
    return btn;
  }));
  if (!outputMenu.hidden) {
    if (!st.serverLive || menuUniverse > st.outputs.length) closeOutputMenu();
    else renderOutputMenu();
  }
}

// ---------------------------------------------------------------
// DMX output menu (one universe): its DMX USB Pro, or an Art-Net /
// sACN output, picked from the nodes the show server finds.
// ---------------------------------------------------------------
const outputMenu = elById("outputMenu");
/** The universe the menu is open for (0 = closed). */
let menuUniverse = 0;
/** Last search, or null before the first. */
let nodes: ArtNetNode[] | null = null;
let searching = false;
let searchError = "";

/** The label the server gives an output (server/net-dmx.ts label()), to mark the current one. */
const networkLabel = (protocol: string, netUniverse: number, host?: string) =>
  `${protocol === "artnet" ? "Art-Net" : "sACN"} ${netUniverse} ${host ? `→ ${host}` : protocol === "artnet" ? "(broadcast)" : "(multicast)"}`;

function menuItem(text: string | null, hint: string | null, onClick: () => void, { current = false, danger = false, disabled = false } = {}) {
  const item = button("menu-item");
  item.setAttribute("role", "menuitem");
  item.classList.toggle("is-current", current);
  item.classList.toggle("danger", danger);
  item.disabled = disabled;
  const label = document.createElement("span");
  label.textContent = text;
  item.append(label);
  if (hint) {
    const k = document.createElement("kbd");
    k.textContent = hint;
    item.append(k);
  }
  item.addEventListener("click", onClick);
  return item;
}

const menuLabel = (text: string | null) => el("div", "menu-label", text);

function renderOutputMenu() {
  const h = header;
  if (!h) return;
  const st = h.state();
  const u = menuUniverse;
  const { usb, network } = st.outputs[u - 1];
  const pick = (output: NetOutputSetting | null) => () => {
    closeOutputMenu();
    h.setNetworkOutput(u, output);
  };
  const title = el("div", "menu-title", st.outputs.length > 1 ? `Universe ${u} output` : "DMX output");
  const items = [
    title,
    menuItem("DMX USB Pro", usb ? "Disconnect" : "Connect", () => {
      closeOutputMenu();
      h.toggleOutput(u);
    }, { current: usb }),
    document.createElement("hr"),
    menuLabel("Art-Net nodes found"),
  ];
  if (searchError) items.push(menuItem(searchError, "", () => {}, { disabled: true }));
  else if (!nodes) items.push(menuItem("Searching…", "", () => {}, { disabled: true }));
  else if (!nodes.length) items.push(menuItem(searching ? "Searching…" : "None found", "", () => {}, { disabled: true }));
  for (const node of nodes ?? []) {
    for (const { port, netUniverse } of node.ports) {
      const name = node.ports.length > 1 ? `${node.name} · port ${port}` : node.name;
      const label = networkLabel("artnet", netUniverse, node.ip);
      items.push(menuItem(name, `Art-Net ${netUniverse} · ${node.ip}`, pick({ protocol: "artnet", host: node.ip, netUniverse }), { current: network === label }));
    }
  }
  items.push(
    menuItem(searching ? "Searching…" : "Search again", "", () => void search(), { disabled: searching }),
    document.createElement("hr"),
    menuItem("Art-Net broadcast", `Art-Net ${u - 1}`, pick({ protocol: "artnet" }), { current: network === networkLabel("artnet", u - 1) }),
    menuItem("sACN multicast", `sACN ${u}`, pick({ protocol: "sacn" }), { current: network === networkLabel("sacn", u) }),
  );
  if (network) items.push(menuItem(`Stop ${network}`, "", pick(null), { danger: true }));
  outputMenu.replaceChildren(...items);
}

/** Ask the show server for the Art-Net nodes on its network. */
async function search() {
  if (searching || !header) return;
  searching = true;
  searchError = "";
  if (menuUniverse) renderOutputMenu();
  try {
    nodes = await header.discoverNodes();
  } catch (err) {
    searchError = errorMessage(err, "Search failed");
  }
  searching = false;
  if (menuUniverse) renderOutputMenu();
}

function toggleOutputMenu(u: number, btn: HTMLButtonElement) {
  const reopen = menuUniverse !== u;
  closeOutputMenu();
  if (!reopen || !header) return;
  menuUniverse = u;
  renderOutputMenu();
  outputMenu.hidden = false;
  const r = btn.getBoundingClientRect();
  outputMenu.style.top = `${r.bottom + 4}px`;
  outputMenu.style.left = `${clamp(r.left, 8, innerWidth - outputMenu.offsetWidth - 8)}px`;
  btn.setAttribute("aria-expanded", "true");
  void search();
}

function closeOutputMenu() {
  menuUniverse = 0;
  outputMenu.hidden = true;
  for (const b of outputBtns.querySelectorAll<HTMLElement>("[aria-expanded]")) b.setAttribute("aria-expanded", "false");
}

// console/app.ts calls this when it starts.
window.onConsoleHeader = (api) => {
  unsubscribe?.();
  header = api;
  outputsKey = "";
  closeOutputMenu();
  elById("showControls").hidden = false;
  unsubscribe = api.subscribe(render);
};
if (window.consoleHeader) window.onConsoleHeader(window.consoleHeader);

universeCount.addEventListener("change", () => header?.setUniverses(Number(universeCount.value)));

elById("newShowBtn").addEventListener("click", async () => {
  if (!header) return;
  if (header.isDirty() && !(await ask({ title: "New show?", message: "Discard unsaved changes and start a blank show?", confirmLabel: "Continue" }))) return;
  const name = await ask({ title: "New show", confirmLabel: "Create", initial: "" });
  if (name) header.newShow(name);
});
elById("saveBtn").addEventListener("click", () => header?.saveShow());
elById("loadBtn").addEventListener("click", () => { loadFile.value = ""; loadFile.click(); });
loadFile.addEventListener("change", async () => {
  const file = loadFile.files?.[0];
  if (!file || !header) return;
  if (header.isDirty() && !(await ask({
    title: "Unsaved changes",
    message: "The current show has changed since it was last saved. Load another show anyway and discard those changes?",
    confirmLabel: "Load anyway",
  }))) return;
  header.loadShow(await file.text(), file.name);
});

/** Rename the show in place (Enter or clicking away keeps it, Esc cancels). */
function beginRename() {
  const h = header;
  if (!h || showNameEl.hidden) return;
  const input = el("input", "show-name-input");
  input.maxLength = 40;
  input.value = h.state().showName;
  input.setAttribute("aria-label", "Show name");
  input.autocomplete = "off";
  input.spellcheck = false;
  showNameEl.hidden = true;
  showNameEl.after(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    if (commit && input.value.trim()) h.rename(input.value.trim());
    input.remove();
    showNameEl.hidden = false;
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}
showNameEl.addEventListener("click", beginRename);
showNameEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); beginRename(); }
});

// ⋮ menu (Rename).
const closeShowMenu = () => {
  showMenu.hidden = true;
  showMenuBtn.setAttribute("aria-expanded", "false");
};
showMenuBtn.addEventListener("click", () => {
  if (!showMenu.hidden) { closeShowMenu(); return; }
  const r = showMenuBtn.getBoundingClientRect();
  showMenu.hidden = false;
  showMenu.style.top = `${r.bottom + 4}px`;
  showMenu.style.left = `${clamp(r.left, 8, innerWidth - showMenu.offsetWidth - 8)}px`;
  showMenuBtn.setAttribute("aria-expanded", "true");
});
showMenu.addEventListener("click", (e) => {
  const act = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-act]")?.dataset.act : undefined;
  if (!act) return;
  closeShowMenu();
  if (act === "rename") beginRename();
});
document.addEventListener("pointerdown", (e) => {
  const target = e.target instanceof Node ? e.target : null;
  if (!showMenu.hidden && !showMenu.contains(target) && !showMenuBtn.contains(target)) closeShowMenu();
  if (!outputMenu.hidden && !outputMenu.contains(target) && !outputBtns.contains(target)) closeOutputMenu();
}, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeShowMenu(); closeOutputMenu(); } });

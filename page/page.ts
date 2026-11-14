// The app page: lays out its two panes, the stage and the console (both
// always there; Console / Both / Stage only changes which are shown), and
// shows the console's show and DMX controls in its header (bottom of this
// script).

import { ask } from "../shared/ask.ts";
import { setActivePane, type Pane } from "../shared/panes.ts";
import { elById } from "../shared/query.ts";
import type { ConsoleHeader } from "../console/app.ts";
import type { StatusKind } from "../console/state.ts";
import type { ArtNetNode, NetOutputSetting } from "../shared/protocol.ts";
import { errorMessage, isRecord } from "../shared/guards.ts";
import { readStoredJson, storeJson } from "../shared/storage.ts";
import { el, button } from "../shared/html.ts";
import { clamp } from "../shared/numbers.ts";
import { GUIDE_SECTIONS, openGuide, showAbout } from "./help-menu.ts";

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
  pane.style.visibility = shown ? "visible" : "hidden"; // the stage reads this to skip drawing while hidden (stage/view3d.ts)
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

/** The last status message shown (console state's status.seq). */
let statusSeq = 0;
let toastTimer = 0;
/** How long a "done" message stays (an error stays until it's clicked). */
const TOAST_MS = 3500;
/**
 * Show one of the console's messages (console/state.ts StatusKind): "done" as
 * a toast under the header for a few seconds, "error" as a red one that stays
 * until clicked; "info" repeats what a control shows, so isn't shown (an empty
 * one clears the toast, e.g. the server's back).
 */
function showToast(text: string, kind: StatusKind) {
  if (kind === "info" && text) return;
  clearTimeout(toastTimer);
  statusEl.textContent = text;
  statusEl.dataset.state = kind;
  statusEl.title = kind === "error" ? "Click to dismiss" : "";
  statusEl.classList.toggle("is-shown", !!text);
  if (text && kind === "done") toastTimer = window.setTimeout(hideToast, TOAST_MS);
}
function hideToast() {
  clearTimeout(toastTimer);
  statusEl.classList.remove("is-shown");
}
statusEl.addEventListener("click", hideToast);

/** Shortcuts read ⌘ on a Mac, Ctrl elsewhere. */
const MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);
const saveStateEl = elById("saveState");
const timeOf = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const FILE_WORDS = { saved: "Saved", loaded: "Loaded", new: "New show" } as const;
/** Beside the show's name: "Unsaved changes" since the last save, else when it was saved / loaded / started (nothing before any of those). */
function renderSaveState() {
  if (!header) return;
  const dirty = header.isDirty();
  const file = header.state().file;
  saveStateEl.hidden = !dirty && !file;
  saveStateEl.classList.toggle("is-dirty", dirty);
  saveStateEl.textContent = dirty ? "Unsaved changes" : file ? `${FILE_WORDS[file.how]} ${timeOf(file.at)}` : "";
  saveStateEl.title = dirty
    ? `Changed since the show file was last ${file ? FILE_WORDS[file.how].toLowerCase() : "saved"} — Show → Save show (${MAC ? "⌘S" : "Ctrl+S"}) keeps a file`
    : file ? `${FILE_WORDS[file.how]} at ${timeOf(file.at)}${file.file ? ` (${file.file})` : ""}` : "";
}
// Edits don't tell the header, so it checks for unsaved changes every second (cheap: one show snapshot).
setInterval(renderSaveState, 1000);

function render() {
  if (!header) return;
  const st = header.state();
  showNameEl.textContent = st.showName;
  showNameEl.hidden = showMenuBtn.hidden = false;
  document.title = `${st.showName} · UnnaturalLight`;
  renderSaveState();
  if (st.status.seq !== statusSeq) {
    statusSeq = st.status.seq;
    showToast(st.status.text, st.status.state);
  }
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

async function newShow() {
  if (!header) return;
  if (header.isDirty() && !(await ask({ title: "New show?", message: "Discard unsaved changes and start a blank show?", confirmLabel: "Continue" }))) return;
  const name = await ask({ title: "New show", confirmLabel: "Create", initial: "" });
  if (name) void header.newShow(name);
}
function chooseShowFile() {
  loadFile.value = "";
  loadFile.click();
}
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

/** Save the show under a new name: rename it, then save its file (named after the show), as Save show does. */
async function saveShowAs() {
  const h = header;
  if (!h) return;
  const name = await ask({ title: "Save show as", message: "The show takes this name, and its file is saved under it.", confirmLabel: "Save", initial: h.state().showName });
  if (!name) return;
  h.rename(name);
  await h.saveShow();
}

showNameEl.addEventListener("click", beginRename);
showNameEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); beginRename(); }
});

/** One of the menu bar's menus: its button, and the menu (of [data-act] items) that opens under it. */
type BarMenu = { btn: HTMLElement; menu: HTMLElement; open: () => void; close: () => void; isOpen: () => boolean };

/** A menu bar menu: `onAct` gets the chosen item's data-act. Clicking elsewhere and Esc close it. */
function barMenu(btn: HTMLElement, menu: HTMLElement, onAct: (act: string) => void): BarMenu {
  const close = () => {
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  };
  const open = () => {
    const r = btn.getBoundingClientRect();
    menu.hidden = false;
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.left = `${clamp(r.left, 8, innerWidth - menu.offsetWidth - 8)}px`;
    btn.setAttribute("aria-expanded", "true");
  };
  btn.addEventListener("click", () => (menu.hidden ? open() : close()));
  menu.addEventListener("click", (e) => {
    const act = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-act]")?.dataset.act : undefined;
    if (!act) return;
    close();
    onAct(act);
  });
  document.addEventListener("pointerdown", (e) => {
    const target = e.target instanceof Node ? e.target : null;
    if (!menu.hidden && !menu.contains(target) && !btn.contains(target)) close();
  }, true);
  return { btn, menu, open, close, isOpen: () => !menu.hidden };
}

const menubar: BarMenu[] = [
  // Show: New, Save (⌘S), Save as (⇧⌘S), Load, Rename.
  barMenu(showMenuBtn, showMenu, (act) => {
    if (act === "new") void newShow();
    else if (act === "save") void header?.saveShow();
    else if (act === "save-as") void saveShowAs();
    else if (act === "load") chooseShowFile();
    else if (act === "rename") beginRename();
  }),
  // Help: the user guide (in its own tab), its keys and mouse section, About.
  barMenu(elById("helpMenuBtn"), elById("helpMenu"), (act) => {
    if (act === "guide") openGuide();
    else if (act === "keys") openGuide(GUIDE_SECTIONS.keys);
    else if (act === "about") void showAbout();
  }),
];
/** Open `m` (closing the others), its first item focused when `focus`. */
function openBarMenu(m: BarMenu, focus: boolean) {
  for (const other of menubar) if (other !== m) other.close();
  m.open();
  if (focus) m.menu.querySelector<HTMLElement>(".menu-item")?.focus();
}
// As in a desktop app: with one menu open, pointing at another opens it instead.
for (const m of menubar) {
  m.btn.addEventListener("pointerenter", () => { if (!m.isOpen() && menubar.some((o) => o.isOpen())) openBarMenu(m, false); });
}
// Keys while a menu is open: ↑ ↓ move through its items, ← → go to the next menu, Esc closes it.
document.addEventListener("keydown", (e) => {
  const current = menubar.find((m) => m.isOpen());
  if (!current) return;
  if (e.key === "Escape") { current.close(); current.btn.focus(); return; }
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    const shown = menubar.filter((m) => !m.btn.hidden);
    const at = shown.indexOf(current);
    e.preventDefault();
    openBarMenu(shown[(at + (e.key === "ArrowRight" ? 1 : shown.length - 1)) % shown.length], true);
    return;
  }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    const items = [...current.menu.querySelectorAll<HTMLElement>(".menu-item:not(:disabled)")];
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const step = e.key === "ArrowDown" ? 1 : -1;
    items[at < 0 ? (step > 0 ? 0 : items.length - 1) : (at + step + items.length) % items.length].focus();
  }
});

for (const k of showMenu.querySelectorAll<HTMLElement>("kbd[data-shortcut]")) {
  const shift = k.dataset.shortcut === "save-as";
  k.textContent = MAC ? `${shift ? "⇧" : ""}⌘S` : `Ctrl+${shift ? "Shift+" : ""}S`;
}
// ⌘S saves the show and ⇧⌘S is Save as, from anywhere on the page (not the browser's Save Page), unless a dialog is open.
document.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.code !== "KeyS") return;
  e.preventDefault();
  if (!header || e.repeat || document.querySelector("dialog[open]")) return;
  if (e.shiftKey) void saveShowAs();
  else void header.saveShow();
});

document.addEventListener("pointerdown", (e) => {
  const target = e.target instanceof Node ? e.target : null;
  if (!outputMenu.hidden && !outputMenu.contains(target) && !outputBtns.contains(target)) closeOutputMenu();
}, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeOutputMenu(); });

// Combined page: the console and the stage run in their own frames
// (still linked live). This page lays them out and shows the console's
// set and DMX controls in its header (bottom of this script).

import { ask } from "../shared/ask.js";

const KEY = "unnaturallight.shell";
const MIN = 20; // % each side keeps in Both view
const panes = document.getElementById("panes");
const stage = document.getElementById("stageFrame");
const consoleFrame = document.getElementById("consoleFrame");
const divider = document.getElementById("divider");
const swapBtn = document.getElementById("swapBtn");

// split = width of the LEFT pane in Both view (%); swapped = console on the left.
let prefs = { mode: "both", split: 50, swapped: false };
try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { /* storage unavailable */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ } };

function place(frame, left, width, z, shown = true) {
  frame.style.left = `${left}%`;
  frame.style.width = `${width}%`;
  frame.style.zIndex = String(z);
  frame.style.visibility = shown ? "visible" : "hidden";
}

function layout() {
  const { mode, split } = prefs;
  if (mode === "both") {
    const [left, right] = prefs.swapped ? [consoleFrame, stage] : [stage, consoleFrame];
    place(left, 0, split, 2);
    place(right, split, 100 - split, 2);
    divider.style.left = `${split}%`;
    divider.hidden = false;
  } else if (mode === "stage") {
    // Console stays full-size and rendered underneath, so its fades keep running.
    place(stage, 0, 100, 2);
    place(consoleFrame, 0, 100, 1);
    divider.hidden = true;
  } else {
    place(consoleFrame, 0, 100, 2);
    place(stage, 0, 100, 1, false);
    divider.hidden = true;
  }
  document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
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

document.querySelectorAll("[data-mode]").forEach((b) => {
  b.addEventListener("click", () => {
    prefs.mode = b.dataset.mode;
    save();
    layout();
    (prefs.mode === "console" ? consoleFrame : stage).focus();
  });
});

divider.addEventListener("pointerdown", (e) => {
  divider.setPointerCapture(e.pointerId);
  document.body.classList.add("dragging");
});
divider.addEventListener("pointermove", (e) => {
  if (!divider.hasPointerCapture(e.pointerId)) return;
  const r = panes.getBoundingClientRect();
  prefs.split = Math.min(100 - MIN, Math.max(MIN, ((e.clientX - r.left) / r.width) * 100));
  layout();
});
const endDrag = () => { document.body.classList.remove("dragging"); save(); };
divider.addEventListener("pointerup", endDrag);
divider.addEventListener("pointercancel", endDrag);
divider.addEventListener("dblclick", () => { prefs.split = 50; save(); layout(); });

layout();

// ---------------------------------------------------------------
// Set name, set buttons, DMX outputs and status: the console's
// (console/app.js consoleHeader), shown up here for the whole page.
// ---------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const setNameEl = $("setName");
const setMenuBtn = $("setMenuBtn");
const setMenu = $("setMenu");
const statusEl = $("status");
const universeCount = $("universeCount");
const outputBtns = $("outputBtns");
const serverPill = $("serverPill");
const loadFile = $("loadFile");
/** The console's header API, once its frame has started. */
let header = null;
let unsubscribe = null;
let outputsKey = "";

function render() {
  const st = header.state();
  setNameEl.textContent = st.setName;
  setNameEl.hidden = setMenuBtn.hidden = false;
  setMenuBtn.setAttribute("aria-label", `Options for set ${st.setName}`);
  document.title = `${st.setName} · UnnaturalLight`;
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

  // One universe: Connect DMX Pro / Disconnect. Several: a button per universe.
  const key = JSON.stringify([st.outputs, st.serverLive]);
  if (key === outputsKey) return;
  outputsKey = key;
  outputBtns.replaceChildren(...st.outputs.map((connected, i) => {
    const u = i + 1;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.classList.toggle("connected", connected);
    btn.disabled = !st.serverLive;
    if (st.outputs.length === 1) {
      btn.textContent = connected ? "Disconnect" : "Connect DMX Pro";
      btn.title = "The DMX USB Pro plugs into the machine running the show server";
    } else {
      btn.textContent = `U${u}`;
      btn.title = connected ? `Universe ${u}: connected (click to disconnect)` : `Universe ${u}: connect its DMX USB Pro`;
    }
    btn.addEventListener("click", () => header?.toggleOutput(u));
    return btn;
  }));
}

// console/app.js calls this when it starts (also after it reloads).
window.onConsoleHeader = (api) => {
  unsubscribe?.();
  header = api;
  outputsKey = "";
  $("showControls").hidden = false;
  unsubscribe = api.subscribe(render);
};
if (consoleFrame.contentWindow?.consoleHeader) window.onConsoleHeader(consoleFrame.contentWindow.consoleHeader);

universeCount.addEventListener("change", () => header?.setUniverses(Number(universeCount.value)));

$("newSetBtn").addEventListener("click", async () => {
  if (!header) return;
  if (header.isDirty() && !(await ask({ title: "New set?", message: "Discard unsaved changes and start a blank set?", confirmLabel: "Continue" }))) return;
  const name = await ask({ title: "New set", confirmLabel: "Create", initial: "" });
  if (name) header.newSet(name);
});
$("saveBtn").addEventListener("click", () => header?.saveSet());
$("loadBtn").addEventListener("click", () => { loadFile.value = ""; loadFile.click(); });
loadFile.addEventListener("change", async () => {
  const file = loadFile.files?.[0];
  if (!file || !header) return;
  if (header.isDirty() && !(await ask({
    title: "Unsaved changes",
    message: "The current set has changed since it was last saved. Load another set anyway and discard those changes?",
    confirmLabel: "Load anyway",
  }))) return;
  header.loadSet(await file.text(), file.name);
});

/** Rename the set in place (Enter or clicking away keeps it, Esc cancels). */
function beginRename() {
  if (!header || setNameEl.hidden) return;
  const input = document.createElement("input");
  input.className = "set-name-input";
  input.maxLength = 40;
  input.value = header.state().setName;
  input.setAttribute("aria-label", "Set name");
  input.autocomplete = "off";
  input.spellcheck = false;
  setNameEl.hidden = true;
  setNameEl.after(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    if (commit && input.value.trim()) header.rename(input.value.trim());
    input.remove();
    setNameEl.hidden = false;
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}
setNameEl.addEventListener("click", beginRename);
setNameEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); beginRename(); }
});

// ⋮ menu (Rename).
const closeSetMenu = () => {
  setMenu.hidden = true;
  setMenuBtn.setAttribute("aria-expanded", "false");
};
setMenuBtn.addEventListener("click", () => {
  if (!setMenu.hidden) { closeSetMenu(); return; }
  const r = setMenuBtn.getBoundingClientRect();
  setMenu.hidden = false;
  setMenu.style.top = `${r.bottom + 4}px`;
  setMenu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - setMenu.offsetWidth - 8))}px`;
  setMenuBtn.setAttribute("aria-expanded", "true");
});
setMenu.addEventListener("click", (e) => {
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (!act) return;
  closeSetMenu();
  if (act === "rename") beginRename();
});
document.addEventListener("pointerdown", (e) => {
  if (!setMenu.hidden && !setMenu.contains(e.target) && !setMenuBtn.contains(e.target)) closeSetMenu();
}, true);
// A press inside a frame doesn't reach this page: close when it takes focus.
window.addEventListener("blur", closeSetMenu);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSetMenu(); });

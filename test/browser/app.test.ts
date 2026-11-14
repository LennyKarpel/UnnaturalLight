// The app in a real (headless) Chrome, against a real show server with its
// own temporary data: npm run test:browser. Skipped when there's no Chrome.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromePath, startApp, waitFor, type Page } from "./harness.ts";

type App = Awaited<ReturnType<typeof startApp>>;

const stage = (p: Page) => p.evaluate<{ risers: { id: string; name: string }[]; positions: { id: string; name: string }[]; fixtures: { name: string }[] }>("window.stageChat.stage()");
/** Work on the stage (its keys only act while it's the pane in use), as a click on it would. */
const useStage = (p: Page) => p.evaluate(`document.getElementById("stagePane").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))`);

describe("the app in a browser", { skip: chromePath() ? false : "no Chrome (set CHROME_PATH)" }, () => {
  let app: App;
  let a: Page;
  let b: Page;

  before(async () => {
    app = await startApp();
    a = await app.page();
    b = await app.page();
  });
  after(async () => { await app?.close(); });

  test("both windows start with no errors", async () => {
    for (const p of [a, b]) {
      assert.equal(await p.evaluate("!!document.getElementById('stagePane') && !!document.getElementById('consolePane')"), true);
      assert.deepEqual(p.errors, []);
    }
  });

  test("HTML that gets into the page can't run script (Content-Security-Policy)", async () => {
    // As if a name from a show file had been put into the page unescaped.
    await a.evaluate(`(() => {
      const img = Object.assign(document.createElement("img"), { id: "xss-probe", alt: "", src: "data:," });
      img.setAttribute("onerror", "window.xssRan = true");
      const link = Object.assign(document.createElement("a"), { id: "xss-link", textContent: "x" });
      link.setAttribute("href", "javascript:window.xssRan = true");
      document.body.append(img, link);
    })()`);
    await a.evaluate(`document.getElementById("xss-link").click()`);
    await waitFor(() => a.errors.some((e) => /Content Security Policy/i.test(e)), "the policy to block the injected script");
    assert.equal(await a.evaluate("window.xssRan === true"), false);
    await a.evaluate(`document.getElementById("xss-probe").remove(); document.getElementById("xss-link").remove()`);
    a.errors.length = 0; // the blocks this test caused on purpose
  });

  test("Delete removes the picked-out riser, ⌘Z brings it back, and the other window follows", async () => {
    await a.evaluate(`window.stageChat.addRiser({ name: "Drum riser", x: 1, z: -2 })`);
    await b.waitFor(`window.stageChat.stage().risers.some((r) => r.name === "Drum riser")`, "the riser in the other window");
    await useStage(a);
    await a.key("Delete");
    assert.deepEqual((await stage(a)).risers.map((r) => r.name), []);
    await b.waitFor(`!window.stageChat.stage().risers.length`, "the delete in the other window");
    await a.key("z", { meta: true });
    assert.deepEqual((await stage(a)).risers.map((r) => r.name), ["Drum riser"]);
  });

  test("Delete removes the position being looked at (with no fixtures selected)", async () => {
    await a.evaluate(`window.stageChat.addPosition("DSC", { x: 0, y: 0, z: 3 })`);
    await useStage(a);
    await a.key("Escape"); // nothing else picked out
    await a.evaluate(`window.stageChat.addPosition("USC", { x: 0, y: 0, z: -3 })`); // a new one is looked at
    await a.key("Backspace");
    assert.deepEqual((await stage(a)).positions.map((p) => p.name), ["DSC"]);
  });

  test("the stage is saved on the server (a new window gets it)", async () => {
    const c = await app.page();
    await c.waitFor(`(({ risers, positions }) => risers.map((r) => r.name).join() === "Drum riser" && positions.map((p) => p.name).join() === "DSC")(window.stageChat.stage())`, "the stage in a new window");
  });

  test("a chat renamed in one window is renamed in the other", async () => {
    // Open a's list, rename its chat through the dialog.
    await a.click("#chatBtn");
    await a.click("#chatPanel .chat-pick");
    await a.click("#chatPanel .chat-row button[aria-label^='Rename']");
    await a.waitFor("document.querySelector('dialog.ask')?.open", "the rename dialog");
    await a.evaluate(`{ const input = document.querySelector("dialog.ask input"); input.focus(); input.select(); }`);
    await a.type("Rehearsal notes");
    await a.click("dialog.ask button[value='confirm']");
    await a.waitFor(`document.querySelector("#chatPanel .chat-name").textContent === "Rehearsal notes"`, "the new name in a");
    // b hears it from the server (no reload) and lists it.
    await b.click("#chatBtn");
    await b.click("#chatPanel .chat-pick");
    await b.waitFor(`[...document.querySelectorAll("#chatPanel .chat-row-name")].some((x) => x.textContent === "Rehearsal notes")`, "the renamed chat in b's list");
    const saved = await waitFor(async () => {
      const res = await fetch(`${new URL(app.url).origin}/chat/chats`);
      const { chats } = (await res.json()) as { chats: { name: string }[] };
      return chats.some((ch) => ch.name === "Rehearsal notes") && chats;
    }, "the chat saved on the server");
    assert.ok(saved);
  });

  test("a chat request that fails is crossed out and not kept", async () => {
    await a.click("#chatPanel textarea");
    await a.type("play song 2");
    await a.key("Enter");
    await a.waitFor(`document.querySelector("#chatPanel .chat-msg.is-error")`, "the error");
    assert.equal(await a.evaluate(`document.querySelector("#chatPanel .chat-msg.is-user").classList.contains("is-failed")`), true);
    // The failed prompt doesn't name the chat or stay in it.
    assert.equal(await a.evaluate(`document.querySelector("#chatPanel .chat-name").textContent`), "Rehearsal notes");
  });

  test("the 3D view's GO bar is the console's GO area: the same text and buttons, doing the same", async () => {
    const liveRow = `document.querySelector("#cues .fader-row.is-current")?.dataset.row`;
    const bar = `document.getElementById("stageGoLive").textContent + " → " + document.getElementById("stageGoNext").textContent`;
    /** Each of the five buttons, here and in the console: disabled and tooltip, side by side. */
    const same = `[["prevCueBtn", "stageGoPrevCue"], ["goStepBackBtn", "stageGoStepBack"], ["goBtn", "stageGoBtn"], ["goStepBtn", "stageGoStep"], ["nextCueBtn", "stageGoNextCue"]]
      .every(([c, s]) => document.getElementById(c).disabled === document.getElementById(s).disabled && document.getElementById(c).title === document.getElementById(s).title)
      && document.getElementById("stageGoReadout").textContent === document.getElementById("crossValue").textContent
      && document.getElementById("stageGoFade").textContent === document.getElementById("goNextFade").textContent
      && Math.round(Number(document.getElementById("stageGoCross").value)) === Number(document.getElementById("crossfader").value)
      && document.getElementById("stageGoTicks").childElementCount === document.getElementById("crossTicks").childElementCount`;
    await a.waitFor(`${bar} === "Cue 1 → Cue 2" && !document.getElementById("stageGoBtn").disabled`, "LIVE → UP NEXT in the bar");
    await a.waitFor(same, "the bar as the console");
    // GO here is the console's GO: the fade plays (GO lit, the readout as the console's), then cue 2 is LIVE.
    await a.click("#stageGoBtn");
    await a.waitFor(`document.getElementById("stageGoBtn").classList.contains("is-running")`, "the GO fade");
    await a.waitFor(`${liveRow} === "1" && ${bar} === "Cue 2 → End of set"`, "cue 2 LIVE", 8000);
    await a.waitFor(`${same} && document.getElementById("stageGoBtn").disabled && !document.getElementById("stageGoBtn").classList.contains("is-running")`, "no GO past the end, as the console");
    // « » make the cue before / after LIVE the LIVE one, as the console's.
    await a.click("#stageGoPrevCue");
    await a.waitFor(`${liveRow} === "0" && ${bar} === "Cue 1 → Cue 2"`, "cue 1 LIVE again");
    await a.click("#stageGoNextCue");
    await a.waitFor(`${liveRow} === "1"`, "cue 2 LIVE from »");
    await a.click("#stageGoPrevCue");
    await a.waitFor(`${liveRow} === "0" && ${same}`, "cue 1 LIVE, the bar as the console");
    // Its crossfader is the console's: dragging it blends LIVE into UP NEXT there too (and the bar doesn't change size as it moves).
    const height = await a.evaluate<number>(`document.getElementById("stageGo").offsetHeight`);
    const drag = (pct: number) => a.evaluate(`(() => { const c = document.getElementById("stageGoCross"); c.value = "${pct}"; c.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await drag(40);
    await a.waitFor(`document.getElementById("crossfader").value === "40" && document.getElementById("crossValue").textContent.startsWith("40%")`, "the console's crossfader at 40%");
    await a.waitFor(same, "the bar as the console at 40%");
    assert.equal(await a.evaluate<number>(`document.getElementById("stageGo").offsetHeight`), height);
    await drag(0);
    await a.waitFor(`document.getElementById("crossfader").value === "0"`, "the crossfader back at 0");
  });

  test("GO is Pause while its fade plays and Resume once paused, in the console and the GO bar", async () => {
    const liveRow = `document.querySelector("#cues .fader-row.is-current")?.dataset.row`;
    const says = (text: string) => `document.getElementById("goBtn").textContent === "${text}" && document.getElementById("stageGoBtn").textContent === "${text}"`;
    const cross = `Number(document.getElementById("crossfader").value)`;
    await a.waitFor(`${liveRow} === "0" && ${says("GO")}`, "GO, with cue 1 LIVE");
    // GO, and GO again at once (to be sure): the second press doesn't pause it.
    await a.click("#goBtn");
    await a.waitFor(says("Pause"), "Pause while the fade plays");
    await a.click("#stageGoBtn");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await a.evaluate(says("Pause")), true, "a quick second GO doesn't pause");
    // Pause (from the GO bar): the fade holds, and both say Resume.
    await new Promise((r) => setTimeout(r, 400));
    await a.click("#stageGoBtn");
    await a.waitFor(`${says("Resume")} && document.getElementById("goBtn").classList.contains("is-paused")`, "Resume once paused");
    const held = await a.evaluate<number>(cross);
    assert.ok(held > 0 && held < 100, `paused part way (${held}%)`);
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(await a.evaluate<number>(cross), held, "the fade holds while paused");
    // Resume (from the console): it plays on to cue 2, and GO is GO again.
    await a.click("#goBtn");
    await a.waitFor(says("Pause"), "playing again");
    await a.waitFor(`${liveRow} === "1" && ${says("GO")}`, "cue 2 LIVE, GO again", 8000);
    await a.click("#stageGoPrevCue");
    await a.waitFor(`${liveRow} === "0"`, "cue 1 LIVE again");
  });

  test("steps: added in the console, picked with ‹ › and the bars, and the console's (and the 3D bar's) › ‹ and GO", async () => {
    // LIVE is cue 1; make cue 2 LIVE (with the 3D bar's ») and give it a step.
    await a.click("#stageGoNextCue");
    await a.waitFor(`document.querySelector('#cues .fader-row.is-current')?.dataset.row === "1"`, "cue 2 LIVE");
    await a.click('#cues .fader-row[data-row="1"] .cue-step-add');
    const shown = `document.querySelector("#cues .cue-step-row .cue-step-name")?.textContent`;
    await a.waitFor(`${shown} === "Step 1 of 2"`, "the new step shown");
    // › to the cue's own look, ‹ back to the step, › again.
    await a.click("#cues .cue-step-row .cue-step-nav:nth-of-type(2)");
    await a.waitFor(`${shown}?.startsWith("Step 2 of 2")`, "the cue's own look");
    await a.click("#cues .cue-step-row .cue-step-nav:first-of-type");
    await a.waitFor(`${shown} === "Step 1 of 2"`, "step 1 again");
    await a.click("#cues .cue-step-row .cue-step-nav:nth-of-type(2)");
    await a.waitFor(`${shown}?.startsWith("Step 2 of 2")`, "the cue's own look again");
    // The bars under the tabs pick a step too.
    await a.click('#cues .fader-row[data-row="1"] .cue-timeline-part:first-child');
    await a.waitFor(`${shown} === "Step 1 of 2"`, "step 1 from its bar");
    await a.click('#cues .fader-row[data-row="1"] .cue-timeline-part:nth-child(2)');
    await a.waitFor(`${shown}?.startsWith("Step 2 of 2")`, "the cue's own look from its bar");
    // + Add step in the step row: a third look, shown; Remove step takes it out again.
    await a.click('#cues .cue-step-row .cue-step-remove[title^="Add a step"]');
    await a.waitFor(`${shown} === "Step 2 of 3"`, "the added step");
    await a.click('#cues .fader-row[data-row="1"] .cue-step-plus');
    await a.waitFor(`${shown} === "Step 3 of 4"`, "another from the tabs' + Step");
    // The console: back to cue 1, so UP NEXT is cue 2. Step › fades to its first step and makes it LIVE.
    const row = `document.querySelector('#cues .fader-row.is-current')?.dataset.row`;
    const readout = `document.getElementById("crossValue").textContent`;
    await a.click("#stageGoPrevCue");
    await a.waitFor(`!document.getElementById("goStepBtn").hidden && !document.getElementById("goStepBtn").disabled`, "the console's Step ›");
    await a.click("#goStepBtn");
    await a.waitFor(`${row} === "1" && ${readout} === "0% · on step 1 of 4"`, "LIVE on cue 2's step 1", 6000);
    // The 3D bar shows the same: LIVE's step, UP NEXT (the rest of cue 2) and the readout.
    await a.waitFor(`document.getElementById("stageGoLive").textContent === "Cue 2 · step 1 of 4" && document.getElementById("stageGoNext").textContent === "Cue 2 · step 2–4" && document.getElementById("stageGoReadout").textContent === "0% · on step 1 of 4"`, "the steps in the 3D bar");
    // ‹ Step: back to cue 1 at once.
    await a.click("#goStepBackBtn");
    await a.waitFor(`${row} === "0" && ${readout} === "0%"`, "cue 1 again");
    // Step › twice: cue 2's step 1, then its step 2 (the rest of LIVE's cue).
    await a.click("#goStepBtn");
    await a.waitFor(`${readout} === "0% · on step 1 of 4"`, "step 1 again", 6000);
    await a.click("#stageGoStep"); // the 3D bar's ›: the same
    await a.waitFor(`${row} === "1" && ${readout} === "0% · on step 2 of 4"`, "step 2", 6000);
    // GO (the 3D bar's): the rest of cue 2, to its own look.
    await a.click("#stageGoBtn");
    await a.waitFor(`${row} === "1" && ${readout} === "0%" && document.querySelector("#cues .cue-step-row .cue-step-name")?.textContent.startsWith("Step 4 of 4")`, "GO through the rest of cue 2", 10000);
  });

  test("New show clears the stage and the chats, in every window", async () => {
    await a.evaluate(`window.stageChat.addRiser({ name: "Old riser", x: 2, z: 1 })`);
    await b.waitFor(`window.stageChat.stage().risers.some((r) => r.name === "Old riser")`, "the riser in the other window");
    // A chat from the old show, on the server and in both windows' lists.
    await a.evaluate(`fetch("/chat/chats/old-chat", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "old-chat", name: "Old chat", history: [{ role: "user", text: "hi" }], used: Date.now() }) })`);
    const chatNames = `fetch("/chat/chats").then((r) => r.json()).then((b) => b.chats.map((c) => c.name).join())`;
    await a.waitFor(`${chatNames}.then((n) => n.includes("Old chat"))`, "the old chat on the server");
    await a.click("#newShowBtn");
    const open = `document.querySelector("dialog.ask[open]")`;
    await a.waitFor(`!!${open}`, "the first question");
    // "Discard unsaved changes?" first, if there are any; then the name.
    if (await a.evaluate<boolean>(`${open}.querySelector("label").hidden`)) {
      await a.click(`dialog.ask[open] button[value="confirm"]`);
      await a.waitFor(`!!${open} && !${open}.querySelector("label").hidden`, "the name question");
    }
    await a.type("Fresh");
    await a.click(`dialog.ask[open] button[value="confirm"]`);
    for (const p of [a, b]) {
      await p.waitFor(`(({ risers, positions, fixtures }) => !risers.length && !positions.length && !fixtures.length)(window.stageChat.stage())`, "a blank stage");
      await p.waitFor(`document.querySelector("#chatPanel .chat-name").textContent !== "Old chat" && !document.querySelector("#chatPanel .chat-log .is-user")`, "a new, empty chat in the panel");
    }
    assert.equal(await a.evaluate(`${chatNames}`), "");
    // Its show file is saved (downloaded) straight away.
    await a.waitFor(`document.getElementById("status").textContent === "New show · Fresh · saved"`, "the new show's file saved");
  });

  test("no window logged an error", () => {
    // The failed chat request logs nothing; anything here is a real problem.
    assert.deepEqual([...a.errors, ...b.errors], []);
  });

  test("a ?token= is kept for the tab and taken off the address bar", async () => {
    // Last: it reloads window b.
    await b.evaluate(`location.replace(location.pathname + "?token=probe-token")`);
    await b.waitFor(`document.readyState === "complete" && !!window.stageChat`, "the reloaded window");
    assert.equal(await b.evaluate("location.search"), "");
    assert.equal(await b.evaluate(`sessionStorage.getItem("unnaturallight.token")`), "probe-token");
  });
});

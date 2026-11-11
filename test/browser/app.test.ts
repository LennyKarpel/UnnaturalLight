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

  test("the 3D view's Test replays the fade into LIVE, with its In time", async () => {
    const header = () => a.evaluate<{ cues: string; btn: string; time: string; clock: string | null }>(`({
      cues: document.getElementById("testFadeCues").textContent,
      btn: document.getElementById("testFadeBtn").textContent,
      time: document.getElementById("testFadeTime").value,
      clock: document.getElementById("testFadeClock").classList.contains("is-idle") ? null : document.getElementById("testFadeClock").textContent,
    })`);
    await a.waitFor(`!document.getElementById("testFadeBtn").disabled`, "the Test button");
    assert.equal((await header()).cues, "Dark → Cue 1");
    await a.evaluate("window.consoleChat.go()");
    await a.waitFor(`document.getElementById("testFadeCues").textContent === "Cue 1 → Cue 2"`, "the cues after GO");
    // The In time set here is the LIVE cue's.
    await a.evaluate(`{ const t = document.getElementById("testFadeTime"); t.value = "1"; t.dispatchEvent(new Event("change")); }`);
    await a.waitFor(`document.getElementById("testFadeTime").value === "1"`, "the new In time");
    await a.click("#testFadeBtn");
    await a.waitFor(`document.getElementById("testFadeBtn").textContent === "■ Stop" && document.getElementById("testFadeClock").textContent === "hold"`, "the hold");
    await a.waitFor(`/ 1s$/.test(document.getElementById("testFadeClock").textContent)`, "the fade");
    await a.waitFor(`document.getElementById("testFadeBtn").textContent === "▶ Test"`, "the end of the test", 4000);
    assert.equal((await header()).clock, null);
    // Stop ends it early.
    await a.click("#testFadeBtn");
    await a.waitFor(`document.getElementById("testFadeBtn").textContent === "■ Stop"`, "the test again");
    await a.click("#testFadeBtn");
    await a.waitFor(`document.getElementById("testFadeBtn").textContent === "▶ Test"`, "stopped");
    // ‹ › step LIVE (the cue the stage edits), in the console too.
    await a.click("#cueBackBtn");
    await a.waitFor(`document.getElementById("testFadeCues").textContent === "Dark → Cue 1" && document.getElementById("cueBackBtn").disabled`, "LIVE back on cue 1");
    assert.equal(await a.evaluate(`document.querySelector('#cues .fader-row[data-row="0"]').classList.contains("is-current")`), true);
    await a.click("#cueForwardBtn");
    await a.waitFor(`document.getElementById("testFadeCues").textContent === "Cue 1 → Cue 2"`, "LIVE on cue 2 again");
  });

  test("a Live test is a real GO: back a cue, then the fade, in the console too", async () => {
    const liveRow = `document.querySelector("#cues .fader-row.is-current")?.dataset.row`;
    await a.click("#testFadeLive");
    await a.click("#testFadeBtn");
    // Cue 1 is LIVE for the hold; the bar still names the cues it's testing.
    await a.waitFor(`${liveRow} === "0" && document.getElementById("testFade").classList.contains("is-live")`, "cue 1 LIVE for the hold");
    assert.equal(await a.evaluate(`document.getElementById("testFadeCues").textContent`), "Cue 1 → Cue 2");
    await a.waitFor(`document.getElementById("testFadeBtn").textContent === "▶ Test" && ${liveRow} === "1"`, "the GO into cue 2", 5000);
    // Stopped in the hold: the tested cue is LIVE again.
    await a.click("#testFadeBtn");
    await a.waitFor(`${liveRow} === "0"`, "the hold again");
    await a.click("#testFadeBtn");
    await a.waitFor(`${liveRow} === "1" && document.getElementById("testFadeBtn").textContent === "▶ Test"`, "cue 2 back");
    // With nothing before LIVE there's nothing to go back to.
    await a.click("#cueBackBtn");
    await a.waitFor(`document.getElementById("testFadeBtn").disabled`, "no live test from cue 1");
    await a.click("#testFadeLive");
    await a.waitFor(`!document.getElementById("testFadeBtn").disabled`, "a stage-only test from cue 1");
  });

  test("steps: added in the console, picked with ‹ › and the bars, the 3D bar's ›, and the console's › ‹ and GO", async () => {
    const text = (sel: string) => a.evaluate<string>(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ""`);
    // LIVE is cue 1; make cue 2 LIVE and give it a step.
    await a.click("#cueForwardBtn");
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
    // The 3D bar: with steps, a Step button and the steps summary in place of the In time.
    await a.waitFor(`!document.getElementById("testStepBtn").hidden && document.getElementById("testFadeTime").hidden`, "the bar's Step");
    assert.match(await text("#testFadeSteps"), /^4 steps · \d+s$/);
    await a.click("#testStepBtn");
    await a.waitFor(`document.getElementById("testFadeClock").textContent === "on step 1/4"`, "held on step 1", 6000);
    await a.click("#testFadeBtn"); // the rest
    await a.waitFor(`document.getElementById("testFadeBtn").textContent === "▶ Test" && document.getElementById("testFadeClock").classList.contains("is-idle")`, "the end of the test", 8000);
    // The console: back to cue 1, so UP NEXT is cue 2. Step › fades to its first step and makes it LIVE.
    const row = `document.querySelector('#cues .fader-row.is-current')?.dataset.row`;
    const readout = `document.getElementById("crossValue").textContent`;
    await a.click("#cueBackBtn");
    await a.waitFor(`!document.getElementById("goStepBtn").hidden && !document.getElementById("goStepBtn").disabled`, "the console's Step ›");
    await a.click("#goStepBtn");
    await a.waitFor(`${row} === "1" && ${readout} === "0% · on step 1 of 4"`, "LIVE on cue 2's step 1", 6000);
    // ‹ Step: back to cue 1 at once.
    await a.click("#goStepBackBtn");
    await a.waitFor(`${row} === "0" && ${readout} === "0%"`, "cue 1 again");
    // Step › twice: cue 2's step 1, then its step 2 (the rest of LIVE's cue).
    await a.click("#goStepBtn");
    await a.waitFor(`${readout} === "0% · on step 1 of 4"`, "step 1 again", 6000);
    await a.click("#goStepBtn");
    await a.waitFor(`${row} === "1" && ${readout} === "0% · on step 2 of 4"`, "step 2", 6000);
    // GO: the rest of cue 2, to its own look.
    await a.click("#goBtn");
    await a.waitFor(`${row} === "1" && ${readout} === "0%" && document.querySelector("#cues .cue-step-row .cue-step-name")?.textContent.startsWith("Step 4 of 4")`, "GO through the rest of cue 2", 10000);
  });

  test("no window logged an error", () => {
    // The failed chat request logs nothing; anything here is a real problem.
    assert.deepEqual([...a.errors, ...b.errors], []);
  });
});

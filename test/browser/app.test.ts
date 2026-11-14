// The app in a real (headless) Chrome, against a real show server with its
// own temporary data: npm run test:browser. Skipped when there's no Chrome.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromePath, startApp, waitFor, type Page } from "./harness.ts";
import type { FixtureProfile } from "../../stage/fixture-library.ts";

type App = Awaited<ReturnType<typeof startApp>>;

const stage = (p: Page) => p.hooks(({ s }) => s.stage());
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
    await a.hooks(({ s }) => s.addRiser({ name: "Drum riser", x: 1, z: -2 }));
    await b.waitFor(`window.stageChat.stage().risers.some((r) => r.name === "Drum riser")`, "the riser in the other window");
    await useStage(a);
    await a.key("Delete");
    assert.deepEqual((await stage(a)).risers.map((r) => r.name), []);
    await b.waitFor(`!window.stageChat.stage().risers.length`, "the delete in the other window");
    await a.key("z", { meta: true });
    assert.deepEqual((await stage(a)).risers.map((r) => r.name), ["Drum riser"]);
  });

  test("Delete removes the position being looked at (with no fixtures selected)", async () => {
    await a.hooks(({ s }) => s.addPosition("DSC", { x: 0, y: 0, z: 3 }));
    await useStage(a);
    await a.key("Escape"); // nothing else picked out
    await a.hooks(({ s }) => s.addPosition("USC", { x: 0, y: 0, z: -3 })); // a new one is looked at
    await a.key("Backspace");
    assert.deepEqual((await stage(a)).positions.map((p) => p.name), ["DSC"]);
  });

  test("the chat's set and song hooks edit sets, run one, and the other window follows", async () => {
    const sets = (p: Page) => p.hooks(({ c }) => c.sets());
    const names = (list: Awaited<ReturnType<typeof sets>>, name: string) => list.find((s) => s.name === name)?.songs.map((s) => s.name);
    const undo = await a.hooks(({ c }) => c.editSnapshot());
    const was = await a.hooks(({ c }) => ({ song: c.songs()[c.show().playing.song.number - 1].id, set: c.sets().find((s) => s.running)!.id }));
    const [x, y] = await a.hooks(({ c }) => [c.addSong("Opener"), c.addSong("Closer")]);
    const id = await a.hooks(({ c }, y) => c.newSet("Tour", [y]), y);
    await a.hooks(({ c }, id, x, y) => c.addToSet(id, [x, y], 0), id, x, y); // Opener, Closer, Closer
    await a.hooks(({ c }, id) => c.moveInSet(id, 0, 2), id); // Closer, Closer, Opener
    await a.hooks(({ c }, id) => c.removeFromSet(id, 1), id); // Closer, Opener
    assert.deepEqual(names(await sets(a), "Tour"), ["Closer", "Opener"]);
    await a.hooks(({ c }, id) => c.runSet(id, 1), id);
    assert.equal((await sets(a)).find((s) => s.running)?.name, "Tour");
    assert.equal(await a.hooks(({ c }) => c.show().playing.song.name), "Opener");
    await b.waitFor(`window.consoleChat.sets().find((s) => s.name === "Tour")?.songs.length === 2`, "the set in the other window");
    // Deleting a song takes it out of every set; deleting the running set runs the first one left.
    await a.hooks(({ c }, y) => c.deleteSong(y), y);
    assert.deepEqual(names(await sets(a), "Tour"), ["Opener"]);
    await a.hooks(({ c }, id) => c.deleteSet(id), id);
    assert.equal((await sets(a)).some((s) => s.name === "Tour"), false);
    assert.equal((await sets(a))[0].running, true);
    await a.hooks(({ c }, undo) => c.restoreEdits(undo), undo);
    assert.equal(await a.hooks(({ c }) => c.songs().some((s) => s.name === "Opener")), false);
    // Back to what the later tests expect: the same set, the same song, cue 1.
    await a.hooks(({ c }, was) => { c.runSet(was.set); c.playSong(was.song, 0); }, was);
    assert.deepEqual(a.errors, []);
  });

  test("the chat's step, cue, patch and fixture hooks change the real console, and Undo's snapshot puts them back", async () => {
    const undo = await a.hooks(({ c }) => c.editSnapshot());
    const song = await a.hooks(({ c }) => c.addSong("Steps test"));
    // Steps: a copy of cue 1's own look, then one before it; a fade / hold; one deleted.
    await a.hooks(({ c }, song) => c.setCueLevels(song, 0, [[0, 200]]), song);
    assert.equal(await a.hooks(({ c }, song) => c.addStep(song, 0, {}), song), 0);
    assert.equal(await a.hooks(({ c }, song) => c.addStep(song, 0, { at: 0, holdSeconds: 3 }), song), 0);
    await a.hooks(({ c }, song) => c.setCueLevels(song, 0, [[1, 77]], 0), song);
    assert.deepEqual(await a.hooks(({ c }, song) => c.editStep(song, 0, 1, { fadeSeconds: 6 }), song), { fadeSeconds: 6, holdSeconds: 0 });
    const cue = (i: number) => a.hooks(({ c }, song, i) => c.cue(song, i), song, i);
    assert.deepEqual((await cue(0)).steps.map((s) => [s.levels[0], s.levels[1], s.fadeSeconds, s.holdSeconds]), [[200, 77, 4, 3], [200, 0, 6, 0]]);
    await a.hooks(({ c }, song) => c.deleteStep(song, 0, 0), song);
    assert.deepEqual((await cue(0)).steps.map((s) => s.fadeSeconds), [6]);
    // Cue order.
    await a.hooks(({ c }, song) => c.moveCue(song, 0, 1), song);
    assert.equal((await cue(1)).levels[0], 200);
    // Patch, fixtures and universes.
    await a.hooks(({ c }) => c.setUniverses(2));
    assert.deepEqual(await a.hooks(({ c }) => c.patchFader(255, { channels: [{ address: "2/10" }, { address: "2/11", max: 128 }], name: "Haze" })), { fader: 256, name: "Haze", channels: ["2/10", "2/11 (max 128)"] });
    const added = await a.hooks(({ c }) => c.addFixtures({ name: "Mover", channels: 2, qty: 2, roles: ["dimmer", "pan"], group: "Movers", universe: 2, mount: "movable", color: "single" }));
    assert.deepEqual(added.map((f) => f.name), ["Mover 1", "Mover 2"]);
    const fixtures = () => a.hooks(({ c }) => c.fixtures());
    const mover = (await fixtures()).find((f) => f.name === "Mover 1")!;
    assert.equal(mover.group, "Movers");
    assert.deepEqual(mover.channels.map((ch) => ch.role), ["dimmer", "pan"]);
    const faders = () => a.hooks(({ c }) => c.faders());
    assert.equal((await faders())[mover.channels[0].faders[0] - 1].name, "Mover 1 Dim");
    await a.hooks(({ c }, id) => c.editFixture(id, { name: "Spot", group: "" }), mover.id);
    assert.equal((await faders())[mover.channels[1].faders[0] - 1].name, "Spot Pan");
    assert.equal((await fixtures()).find((f) => f.id === mover.id)?.group, null);
    await a.hooks(({ c }, id) => c.deleteFixtures([id]), mover.id);
    assert.equal((await fixtures()).some((f) => f.id === mover.id), false);
    await assert.rejects(a.hooks(({ c }) => c.setUniverses(1)), /Universe 2\+ is in use/);
    await b.waitFor(`window.consoleChat.fixtures().some((f) => f.name === "Mover 2")`, "the fixture in the other window");
    await a.hooks(({ c }, undo) => c.restoreEdits(undo), undo);
    assert.equal((await fixtures()).some((f) => f.name.startsWith("Mover")), false);
    assert.equal(await a.hooks(({ c }) => c.outputs().universes), 1);
    assert.deepEqual(a.errors, []);
  });

  test("the chat's submaster, fixture, group, show and stage-link hooks work on the real console and stage", async () => {
    const undoShow = await a.hooks(({ c }) => c.editSnapshot());
    const undoStage = await a.hooks(({ s }) => s.editSnapshot().data);
    await a.hooks(({ c }) => c.setSubmasters(40, 60));
    assert.deepEqual(await a.hooks(({ c }) => c.show().submasters), { live: 40, upNext: 60 });
    await a.hooks(({ c }) => c.setSubmasters(100, 100));
    // A fixture moved to another address takes its faders' patch along; groups renamed and deleted.
    await a.hooks(({ c }) => c.addFixtures({ name: "Par", channels: 2, qty: 1, roles: ["dimmer", "red"], group: "Floor", universe: null, mount: "fixed", color: "single" }));
    const fixtures = () => a.hooks(({ c }) => c.fixtures());
    const par = async () => (await fixtures()).find((f) => f.name === "Par")!;
    const id = (await par()).id;
    assert.deepEqual(await a.hooks(({ c }, id) => c.editFixture(id, { start: "200", mount: "movable" }), id), { name: "Par", group: "Floor", channels: "Ch200×2", mount: "movable", color: "single" });
    assert.deepEqual((await par()).channels.map((ch) => [ch.channel, ch.faders.length]), [[200, 1], [201, 1]]);
    await a.hooks(({ c }) => c.renameGroup("floor", "Truss"));
    assert.deepEqual(await a.hooks(({ c }) => c.groups()), [{ name: "Truss", fixtures: ["Par"] }]);
    await a.hooks(({ c }) => c.deleteGroup("Truss"));
    assert.equal((await par()).group, null);
    assert.equal(await a.hooks(({ c }) => c.renameShow("Friday tour")), "Friday tour");
    // Stage links: a library-style fixture placed stage only, then driven by address, linked to Par, and registered.
    const profile: FixtureProfile = { manufacturer: "Acme", model: "Mini", mode: "3ch", key: "acme/mini", channels: [{ name: "Dimmer", attr: "dimmer" }, { name: "Strobe", attr: null }, { name: "Zoom", attr: "zoom" }], mount: "fixed", color: "single", panLimit: null, tiltLimit: null, zoomMin: null, zoomMax: null };
    await a.hooks(({ s }, profile) => s.addFixtures([{ x: 0, y: 4, z: 0 }], "none", profile), profile);
    const mini = async () => (await a.hooks(({ s }) => s.stage())).fixtures.find((f) => f.name === "Mini 1")!;
    assert.deepEqual([(await mini()).console, (await mini()).model], [null, "Acme Mini (3ch)"]);
    const sid = (await mini()).id;
    await a.hooks(({ s }, sid) => s.linkManual([sid], 300), sid);
    assert.equal((await mini()).console, "manual 300");
    assert.equal(await a.hooks(({ s }, sid, id) => s.linkToConsole([sid], id), sid, id), 1);
    assert.equal((await mini()).console, "Par");
    await a.hooks(({ s }, sid) => s.register([sid], "fixed/single", null), sid);
    await a.waitFor(`window.stageChat.stage().fixtures.find((f) => f.name === "Mini 1")?.console === "Mini 1"`, "the registered console fixture");
    assert.deepEqual((await fixtures()).find((f) => f.name === "Mini 1")?.channels.map((ch) => ch.role), ["dimmer", null, "zoom"]);
    await a.hooks(({ s }, sid) => s.unlink([sid]), sid);
    await a.waitFor(`!window.consoleChat.fixtures().some((f) => f.name === "Mini 1")`, "unlinking to remove the console fixture the stage made");
    // Undo, as the chat panel does it: the show, then the stage.
    await a.hooks(({ c, s }, undoShow, undoStage) => { c.restoreEdits(undoShow); s.restoreEdits(undoStage); }, undoShow, undoStage);
    assert.equal((await fixtures()).some((f) => f.name === "Par"), false);
    assert.equal((await a.hooks(({ s }) => s.stage())).fixtures.some((f) => f.name === "Mini 1"), false);
    assert.notEqual(await a.hooks(({ c }) => c.show().showName), "Friday tour");
    assert.deepEqual(a.errors, []);
  });

  test("double-clicking a rig's fixture selects the rig; with ⇧ or ⌘ it adds the rig to the selection", async () => {
    const undo = await a.hooks(({ s }) => s.editSnapshot().data);
    await a.hooks(({ s }) => s.addFixtures([{ x: -3, y: 4, z: 0, name: "Lone spot" }], "none"));
    await a.hooks(({ s }) => s.addRig({ type: "line", x: 2, y: 4, z: 0, count: 3, consoleType: "none", name: "Test line" }));
    const fixtures = () => a.hooks(({ s }) => s.stage().fixtures);
    const row = async (name: string) => `#list .item:nth-child(${(await fixtures()).findIndex((f) => f.name === name) + 1})`;
    const selected = async () => (await fixtures()).filter((f) => f.selected).map((f) => f.name);
    const line = (await fixtures()).filter((f) => f.rig === "Test line").map((f) => f.name);
    assert.equal(line.length, 3);
    await a.click(`[data-list-tab="fixtures"]`);
    await a.waitFor(`document.querySelectorAll("#list .item").length === ${(await fixtures()).length}`, "the fixture list");
    await a.click(await row("Lone spot"));
    assert.deepEqual(await selected(), ["Lone spot"]);
    await a.click(await row(line[1]), { count: 2 });
    assert.deepEqual(await selected(), line, "a plain double-click: just the rig");
    // ⇧ / ⌘ with two fixtures already selected (so the inspector, and with it the list, stays put between the two clicks).
    for (const mod of [{ shift: true }, { meta: true }]) {
      await a.click(await row("Lone spot"));
      await a.click(await row(line[0]), mod);
      assert.deepEqual(await selected(), ["Lone spot", line[0]]);
      await a.click(await row(line[2]), { count: 2, ...mod });
      assert.deepEqual(await selected(), ["Lone spot", ...line], `${mod.shift ? "⇧" : "⌘"}: the rig added`);
    }
    await a.hooks(({ s }, undo) => s.restoreEdits(undo), undo);
    assert.deepEqual(a.errors, []);
  });

  test("the chat's stage value, settings, duplicate and select hooks, and the whole patch, on the real stage and console", async () => {
    const undoShow = await a.hooks(({ c }) => c.editSnapshot());
    const undoStage = await a.hooks(({ s }) => s.editSnapshot().data);
    await a.hooks(({ s }) => s.addFixtures([{ x: 0, y: 4, z: 1, name: "Solo" }], "none"));
    const solo = async () => (await a.hooks(({ s }) => s.stage().fixtures)).find((f) => f.name === "Solo")!;
    const id = (await solo()).id;
    // Values: a stage-only fixture (no console fixture) can be lit.
    const [v] = await a.hooks(({ s }, id) => s.setValues([id], { levels: { dimmer: 128, zoom: 40 }, color: "#00ff00" }), id);
    assert.deepEqual([v.dimmer, v.zoom, v.red, v.green, v.blue], [128, 40, 0, 255, 0]);
    // Settings: ranges, beam, curve (the beam's ends kept in order), and its zero.
    const set = await a.hooks(({ s }, id) => s.editSettings([id], { panRange: 270, tiltRange: 135, beamMin: 60, beamMax: 30, dimmerCurve: "square", zero: "stage" }), id);
    assert.deepEqual(set.fixtures[0], { name: "Solo", panRange: 270, tiltRange: 135, beamMin: 30, beamMax: 60, dimmerCurve: "square" });
    await assert.rejects(a.hooks(({ s }, id) => s.editSettings([id], { dimmerCurve: "cubic" }), id), /dimmer_curve must be one of/);
    // Duplicate: the copy is selected, with the same values.
    assert.deepEqual(await a.hooks(({ s }, id) => s.duplicateFixtures([id]), id), { copies: ["Solo copy"] });
    assert.deepEqual((await a.hooks(({ s }) => s.stage().fixtures)).filter((f) => f.selected).map((f) => f.name), ["Solo copy"]);
    // Select, and none.
    assert.deepEqual(await a.hooks(({ s }, id) => s.select([id]), id), ["Solo"]);
    assert.deepEqual(await a.hooks(({ s }) => s.select([])), []);
    // The whole patch: 1:1, then none.
    assert.equal(await a.hooks(({ c }) => c.resetPatch(false)), 256);
    assert.deepEqual((await a.hooks(({ c }) => c.faders())).slice(0, 2).map((f) => f.patched), [true, true]);
    assert.equal(await a.hooks(({ c }) => c.resetPatch(true)), 0);
    await a.hooks(({ c, s }, undoShow, undoStage) => { c.restoreEdits(undoShow); s.restoreEdits(undoStage); }, undoShow, undoStage);
    assert.equal((await a.hooks(({ s }) => s.stage().fixtures)).some((f) => f.name.startsWith("Solo")), false);
    assert.deepEqual(a.errors, []);
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
    await a.hooks(({ s }) => s.addRiser({ name: "Old riser", x: 2, z: 1 }));
    await b.waitFor(`window.stageChat.stage().risers.some((r) => r.name === "Old riser")`, "the riser in the other window");
    // A chat from the old show, on the server and in both windows' lists.
    await a.evaluate(`fetch("/chat/chats/old-chat", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "old-chat", name: "Old chat", history: [{ role: "user", text: "hi" }], used: Date.now() }) })`);
    const chatNames = `fetch("/chat/chats").then((r) => r.json()).then((b) => b.chats.map((c) => c.name).join())`;
    await a.waitFor(`${chatNames}.then((n) => n.includes("Old chat"))`, "the old chat on the server");
    await a.click("#showMenuBtn");
    await a.click(`#showMenu [data-act="new"]`);
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
    await a.waitFor(`document.getElementById("saveState").textContent.startsWith("New show ")`, "the new show's file saved");
  });

  test("the Show menu holds the show's actions, ⌘S saves, and → moves along the menu bar", async () => {
    await a.click("#showMenuBtn");
    await a.waitFor(`!document.getElementById("showMenu").hidden`, "the Show menu");
    assert.deepEqual(await a.evaluate(`[...document.querySelectorAll("#showMenu [data-act]")].map((b) => b.dataset.act)`), ["new", "save", "save-as", "load", "rename"]);
    // Beside the name: unsaved changes after an edit, then when it was saved (and no toast for a save).
    const saveState = `document.getElementById("saveState").textContent`;
    await a.evaluate(`window.consoleHeader.rename("Edited")`);
    await a.waitFor(`${saveState} === "Unsaved changes"`, "unsaved changes shown");
    await a.click(`#showMenu [data-act="save"]`);
    await a.waitFor(`${saveState}.startsWith("Saved ")`, "Save show from the menu");
    await a.evaluate(`window.consoleHeader.rename("Edited again")`);
    await a.waitFor(`${saveState} === "Unsaved changes"`, "unsaved changes again");
    await a.evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyS", key: "s", metaKey: true, bubbles: true, cancelable: true }))`);
    await a.waitFor(`${saveState}.startsWith("Saved ")`, "⌘S saving the show");
    assert.equal(await a.evaluate(`document.getElementById("status").classList.contains("is-shown")`), false);
    // A menu bar: → goes from Show to Help, Esc closes it.
    await a.click("#showMenuBtn");
    const key = (k: string) => a.evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "${k}", bubbles: true, cancelable: true }))`);
    await key("ArrowRight");
    assert.deepEqual(await a.evaluate(`["showMenu", "helpMenu"].map((id) => document.getElementById(id).hidden)`), [true, false]);
    assert.equal(await a.evaluate(`document.activeElement.dataset.act`), "guide");
    await key("Escape");
    assert.equal(await a.evaluate(`document.getElementById("helpMenu").hidden`), true);
  });

  test("Show → Save as renames the show and saves it", async () => {
    await a.click("#showMenuBtn");
    await a.click(`#showMenu [data-act="save-as"]`);
    await a.waitFor(`!!document.querySelector("dialog.ask[open]") && document.activeElement === document.querySelector("dialog.ask input")`, "the name question");
    await a.type("Second Night");
    await a.click(`dialog.ask[open] button[value="confirm"]`);
    for (const p of [a, b]) await p.waitFor(`document.getElementById("showName").textContent === "Second Night"`, "the new name, in both windows");
    await a.waitFor(`document.getElementById("saveState").textContent.startsWith("Saved ")`, "the show saved");
  });

  test("Help opens the user guide, its keys section and About", async () => {
    await a.click("#helpMenuBtn");
    await a.waitFor(`!document.getElementById("helpMenu").hidden`, "the ? menu");
    assert.deepEqual(await a.evaluate(`[...document.querySelectorAll("#helpMenu [data-act]")].map((b) => b.textContent)`), ["User guide", "Keys and mouse", "About UnnaturalLight"]);
    // Opening the guide's tab: the address it asks for (the tab itself is tested below).
    await a.evaluate(`window.openedGuide = []; window.open = (url, name) => { window.openedGuide.push([String(url), name]); return null; }`);
    await a.click(`#helpMenu [data-act="keys"]`);
    assert.equal(await a.evaluate(`document.getElementById("helpMenu").hidden`), true);
    assert.deepEqual(await a.evaluate("window.openedGuide"), [[new URL("page/help.html#9-reference-keys-and-mouse", app.url).href, "unnaturallight-guide"]]);
    // About: the version and what the show server runs on, from the server.
    await a.click("#helpMenuBtn");
    await a.click(`#helpMenu [data-act="about"]`);
    await a.waitFor(`!!document.querySelector("dialog.about[open]")`, "the About box");
    const facts = await a.evaluate<string[]>(`[...document.querySelectorAll("dialog.about dd")].map((d) => d.textContent)`);
    assert.equal(facts.length, 3);
    assert.match(facts[0], /^\d+\.\d+\.\d+$/);
    assert.equal(facts[1], `Node.js ${process.versions.node}`);
    assert.match(facts[2], /^three\.js \d/);
    await a.click(`dialog.about button[type="submit"]`);
    await a.waitFor(`!document.querySelector("dialog.about")`, "the About box closed");
  });

  test("the user guide page shows USER-GUIDE.md, at the section asked for", async () => {
    const help = await app.page("page/help.html#9-reference-keys-and-mouse");
    try {
      await help.waitFor(`document.querySelectorAll("#helpToc a").length > 5`, "the guide and its contents");
      assert.equal(await help.evaluate("document.title"), "UnnaturalLight — User Guide");
      // Every #link in the guide has its heading (anchors as GitHub makes them).
      assert.deepEqual(await help.evaluate(`[...document.querySelectorAll("#guide a[href^='#'], #helpToc a")].map((a) => a.getAttribute("href").slice(1)).filter((id) => !document.getElementById(decodeURIComponent(id)))`), []);
      assert.ok(await help.evaluate(`document.getElementById("9-reference-keys-and-mouse").getBoundingClientRect().top < innerHeight`), "scrolled to the section");
      assert.deepEqual(help.errors, []);
    } finally {
      await help.close();
    }
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

describe("the chat's settings in a browser", { skip: chromePath() ? false : "no Chrome (set CHROME_PATH)" }, () => {
  let app: App;
  let p: Page;
  const shown = (sel: string) => p.evaluate<boolean>(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && getComputedStyle(e).display !== "none"; })()`);

  before(async () => {
    // The real provider, for its model list; no message ever reaches it (/chat is answered in the page below).
    app = await startApp({ chatModels: true });
    p = await app.page();
    await p.evaluate(`document.getElementById("chatBtn").click()`);
  });
  after(async () => { await app?.close(); });

  test("⚙ opens the settings: the models, the default picked; a pick shows in the header and is kept", async () => {
    await p.waitFor(`document.querySelector(".chat-model-name").textContent === "Opus 5.5"`, "the default model in the header");
    await p.click(".chat-settings-btn");
    await p.waitFor(`document.querySelectorAll("dialog.chat-settings input[type=radio]").length === 4`, "the four models");
    assert.equal(await p.evaluate(`document.querySelector("dialog.chat-settings input:checked").value`), "claude-opus-5-5");
    await p.evaluate(`document.querySelector("dialog.chat-settings input[value=claude-haiku-5-5]").click()`);
    assert.equal(await p.evaluate(`document.querySelector(".chat-model-name").textContent`), "Haiku 5.5");
    assert.equal(await p.evaluate(`JSON.parse(localStorage.getItem("unnaturallight.chat")).model`), "claude-haiku-5-5");
    await p.evaluate(`document.querySelector("dialog.chat-settings form").requestSubmit()`);
    await p.waitFor(`!document.querySelector("dialog.chat-settings")`, "the settings to close");
  });

  test("a request sends the picked model; its tool search, tool details and footer show, and Show details hides them", async () => {
    // The show server's /chat, answered here: one reply with a tool search, a tool call (GO), then a plain reply.
    await p.evaluate(`(() => {
      const real = window.fetch;
      window.sentModels = [];
      let n = 0;
      const usage = { model: "claude-haiku-5-5", input: 900, output: 40, cacheRead: 5000, cacheWrite: 0 };
      window.fetch = (url, init) => {
        if (!String(url).endsWith("/chat")) return real(url, init);
        window.sentModels.push(JSON.parse(init.body).model);
        const message = n++ === 0
          ? { role: "assistant", text: "", toolCalls: [{ id: "c1", name: "go", args: {} }], usage, serverTools: [{ name: "tool_search_tool_bm25", input: "go", result: "go" }] }
          : { role: "assistant", text: "Done.", toolCalls: [], usage };
        return Promise.resolve(new Response(JSON.stringify({ type: "done", message, model: "anthropic · claude-haiku-5-5" }) + "\\n"));
      };
    })()`);
    await p.click(".chat-input textarea");
    await p.type("GO");
    await p.key("Enter");
    await p.waitFor(`document.querySelector(".chat-turn-info")?.textContent ?? ""`, "the request's footer");
    assert.deepEqual(await p.evaluate("window.sentModels"), ["claude-haiku-5-5", "claude-haiku-5-5"]);
    assert.match(await p.evaluate<string>(`document.querySelector(".chat-turn-info").textContent`), /^Claude Haiku 5\.5 · 1 tool call · [\d.]+ s · 12k tokens in \(10k cached\) · 80 out$/);
    assert.match(await p.evaluate<string>(`document.querySelector(".chat-tool.is-server").textContent`), /Looked up tools: “go”/);
    await p.evaluate(`document.querySelector(".chat-tool:not(.is-server)").open = true`);
    assert.match(await p.evaluate<string>(`document.querySelector(".chat-tool:not(.is-server) .chat-tool-detail").textContent`), /ToolgoSent\{}Answered/);
    assert.equal(await shown(".chat-tool-detail"), true);

    await p.click(".chat-settings-btn");
    await p.waitFor(`!!document.querySelector("dialog.chat-settings input[type=checkbox]")`, "the settings");
    await p.evaluate(`document.querySelector("dialog.chat-settings input[type=checkbox]").click(); document.querySelector("dialog.chat-settings form").requestSubmit()`);
    assert.equal(await shown(".chat-turn-info"), false);
    assert.equal(await shown(".chat-tool.is-server"), false);
    assert.equal(await shown(".chat-tool-detail"), false);
    assert.equal(await shown(".chat-tool:not(.is-server)"), true);
    assert.equal(await p.evaluate(`JSON.parse(localStorage.getItem("unnaturallight.chat")).details`), false);
    assert.deepEqual(p.errors, []);
  });

  test("/usage says the chat's size and tokens; /list (and /help) lists the commands; neither is sent", async () => {
    const sent = await p.evaluate<number>("window.sentModels.length");
    const lastHint = () => p.evaluate<string>(`[...document.querySelectorAll(".chat-msg.is-hint")].at(-1).textContent`);
    await p.click(".chat-input textarea");
    await p.type("/usage");
    await p.key("Enter");
    // The last test's request: two model calls, each 900 new + 5000 cached in, 40 out.
    assert.equal(await lastHint(), [
      "This chat: 1 prompt kept (past 10 the oldest 5 are summed up; /compact sums up all now).",
      "Each model call sends about 5.9k tokens now (the last one: 5.0k from the cache, 900 new); a request makes one call, plus one per tool round.",
      "Its 2 model calls so far: 12k tokens in (10k from the cache, a tenth of the price), 80 out.",
    ].join("\n"));
    for (const cmd of ["/list", "/help"]) {
      await p.type(cmd);
      await p.key("Enter");
      assert.match(await lastHint(), /^Commands \(type one, then Enter; they're never sent to the model\):\n\/clear: empty this chat\n\/compact: .*\n\/usage: .*\n\/list: these commands\n\/help: the same as \/list$/);
    }
    assert.equal(await p.evaluate("window.sentModels.length"), sent);
    assert.deepEqual(p.errors, []);
  });

  test("typing / lists the matching commands: ↑ / ↓ pick, Tab or Enter fills one in (Enter runs the only match), Esc hides them", async () => {
    const sent = await p.evaluate<number>("window.sentModels.length");
    const box = () => p.evaluate<string>(`document.querySelector(".chat-input textarea").value`);
    const listed = () => p.evaluate<string[]>(`document.querySelector(".chat-suggest").hidden ? [] : [...document.querySelectorAll(".chat-suggest-row")].map((r) => (r.classList.contains("is-picked") ? "*" : "") + r.querySelector(".chat-suggest-name").textContent)`);
    const hints = () => p.evaluate<number>(`document.querySelectorAll(".chat-msg.is-hint").length`);
    await p.click(".chat-input textarea");
    await p.type("/");
    assert.deepEqual(await listed(), ["*/clear", "/compact", "/usage", "/list", "/help"]);
    await p.type("c");
    assert.deepEqual(await listed(), ["*/clear", "/compact"]);
    await p.key("ArrowDown");
    assert.deepEqual(await listed(), ["/clear", "*/compact"]);
    await p.key("ArrowDown");
    assert.deepEqual(await listed(), ["*/clear", "/compact"], "↓ wraps round");
    await p.key("ArrowUp");
    await p.key("Tab");
    assert.equal(await box(), "/compact");
    assert.deepEqual(await listed(), [], "a whole command: no list");
    // With several matching, Enter fills in the picked one and runs nothing; the next Enter runs it.
    await p.evaluate(`(() => { const t = document.querySelector(".chat-input textarea"); t.value = ""; t.dispatchEvent(new Event("input")); })()`);
    await p.type("/c");
    const before = await hints();
    await p.key("ArrowDown");
    await p.key("ArrowUp");
    await p.key("Enter");
    assert.equal(await box(), "/clear");
    assert.equal(await hints(), before, "nothing run yet");
    await p.evaluate(`(() => { const t = document.querySelector(".chat-input textarea"); t.value = ""; t.dispatchEvent(new Event("input")); })()`);
    // With one matching, Enter runs it.
    await p.type("/us");
    await p.key("Enter");
    assert.match(await p.evaluate<string>(`[...document.querySelectorAll(".chat-msg.is-hint")].at(-1).textContent`), /^This chat:/);
    assert.equal(await box(), "");
    // Esc hides the list (the panel stays open); not a command: no list.
    await p.type("/l");
    assert.deepEqual(await listed(), ["*/list"]);
    await p.key("Escape");
    assert.deepEqual(await listed(), []);
    assert.equal(await p.evaluate(`!!document.querySelector("#chatPanel .chat-input textarea").offsetParent`), true, "the panel is still open");
    await p.evaluate(`(() => { const t = document.querySelector(".chat-input textarea"); t.value = "/x y"; t.dispatchEvent(new Event("input")); })()`);
    assert.deepEqual(await listed(), []);
    await p.evaluate(`(() => { const t = document.querySelector(".chat-input textarea"); t.value = ""; t.dispatchEvent(new Event("input")); })()`);
    assert.equal(await p.evaluate("window.sentModels.length"), sent);
    assert.deepEqual(p.errors, []);
  });

  test("/compact sums up the open chat: the summary takes its place, here and on the server", async () => {
    // The show server's /chat/summary, answered here (no model is called).
    await p.evaluate(`(() => {
      const real = window.fetch;
      window.summaries = [];
      window.fetch = (url, init) => {
        if (!String(url).endsWith("/chat/summary")) return real(url, init);
        window.summaries.push(JSON.parse(init.body).messages.length);
        return Promise.resolve(new Response(JSON.stringify({ summary: "The person pressed GO once." })));
      };
    })()`);
    const before = await p.evaluate<number>(`document.querySelectorAll(".chat-msg.is-user").length`);
    assert.ok(before > 0, "the last test's prompt is in the chat");
    await p.click(".chat-input textarea");
    await p.type("/compact");
    await p.key("Enter");
    await p.waitFor(`[...document.querySelectorAll(".chat-msg.is-hint")].some((h) => h.textContent.startsWith("Compacted"))`, "the compacted note");
    assert.deepEqual(await p.evaluate("window.summaries"), [4], "the whole chat (prompt, GO call, its result, the reply) sent to sum up");
    assert.equal(await p.evaluate(`document.querySelectorAll(".chat-msg.is-user, .chat-tool").length`), 0);
    assert.equal(await p.evaluate(`document.querySelector(".chat-summary-text").textContent`), "The person pressed GO once.");
    const id = await p.evaluate<string>(`JSON.parse(localStorage.getItem("unnaturallight.chat")).current`);
    await waitFor(async () => {
      const res = await fetch(`${new URL(app.url).origin}/chat/chats`);
      const { chats } = (await res.json()) as { chats: { id: string; history: { role: string }[] }[] };
      return chats.find((x) => x.id === id)?.history.map((m) => m.role).join() === "summary";
    }, "the compacted chat saved on the server");
    // Nothing left to sum up.
    await p.type("/compact");
    await p.key("Enter");
    assert.equal(await p.evaluate<string>(`[...document.querySelectorAll(".chat-msg.is-hint")].at(-1).textContent`), "Nothing to compact yet.");
    assert.deepEqual(p.errors, []);
  });

  test("/clear empties the open chat, on the server too; another /word is no command and isn't sent", async () => {
    const sent = await p.evaluate<number>("window.sentModels.length");
    await p.click(".chat-input textarea");
    await p.type("/nope");
    await p.key("Enter");
    assert.match(await p.evaluate<string>(`[...document.querySelectorAll(".chat-msg.is-hint")].at(-1).textContent`), /^No command \/nope\. Commands:\n\/clear: empty this chat\n\/compact/);
    assert.equal(await p.evaluate("window.sentModels.length"), sent);
    await p.type("/clear");
    await p.key("Enter");
    assert.equal(await p.evaluate(`document.querySelectorAll(".chat-msg.is-user, .chat-tool").length`), 0);
    assert.match(await p.evaluate<string>(`document.querySelector(".chat-msg.is-hint").textContent`), /^Cleared\./);
    assert.equal(await p.evaluate(`document.querySelector(".chat-name").textContent`), "New chat");
    const id = await p.evaluate<string>(`JSON.parse(localStorage.getItem("unnaturallight.chat")).current`);
    await waitFor(async () => {
      const res = await fetch(`${new URL(app.url).origin}/chat/chats`);
      const { chats } = (await res.json()) as { chats: { id: string; name: string; history: unknown[] }[] };
      const c = chats.find((x) => x.id === id);
      return c && !c.history.length && c.name === "";
    }, "the cleared chat saved on the server");
    assert.equal(await p.evaluate("window.sentModels.length"), sent);
    assert.deepEqual(p.errors, []);
  });
});

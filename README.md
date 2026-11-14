# UnnaturalLight

A lighting console and a 3D stage visualizer that run in your web browser and work together, driven by a small show server that sends DMX.

**Using it:** see the **[User Guide](USER-GUIDE.md)** (also in the app: **Help → User guide**). This file is for working on the app: how it's built, how its parts talk, and how it's tested.

```bash
./server.sh          # installs what it needs, starts the show server, opens http://localhost:8080
npm test             # unit tests
npm run test:browser # the app in a headless Chrome
npm run typecheck
```

---

## How it's built

Plain HTML / TypeScript, no build step. Every script is a `.ts` file, kept to TypeScript that only adds types (no enums, namespaces or parameter properties; `erasableSyntaxOnly` in `tsconfig.json` enforces it), so its types can simply be stripped:

- **Server and tests:** Node runs the `.ts` files directly (`--experimental-strip-types`; developed on Node 26 LTS, works from 22.13; `@types/node` follows the Node in use). `./server.sh` installs the npm dependencies when needed and runs `node --experimental-strip-types server/server.ts` (or `npm start`), which serves the app on port 8080 with caching off.
- **Picking up edits:** files only the browser runs take effect on a page reload. Files the server runs (`server/` and what it imports from `console/` and `shared/`, e.g. `shared/engine.ts`, `console/songs.ts`) need a server restart. `./server.sh` does that by itself on save (for now it watches by default; the show is saved first, running fades are dropped and the pages reconnect). `./server.sh --nowatch` turns that off.
- **Browser:** the server strips the types from each `.ts` file as it serves it (with Node's own `stripTypeScriptTypes`, cached per file) and sends it as JavaScript, so line and column numbers match the source in the browser's devtools. The page needs the show server; opening `index.html` from disk or another static server won't run it.
- **Install scripts:** npm 11 runs a package's install script only once it's been approved (`allowScripts` in `package.json`). The one package that has one, `@serialport/bindings-cpp`, is **denied**: it ships prebuilt drivers (macOS, Windows, Linux) that load without it, so nothing runs at install. A new dependency with an install script shows up in `npm install-scripts ls`: approve it only if it can't work without.
- **Test output:** Node 26's test runner prints its summary as `ℹ pass 97` / `ℹ fail 0` (Node 22 printed `# pass 97`).
- **Type checking:** `npm run typecheck` (`tsc` from TypeScript 7, the native compiler: well under a second; strict mode, nothing written). It's only a check: Node and the server strip the types themselves, so the TypeScript version never changes what runs. three.js is an npm dependency (`three`, exact version, matching `@types/three`: `test/access.test.ts` checks they agree). **Upgrading it:** `npm install --save-exact three@X @types/three@X`, then `npm run typecheck` (removed APIs show up there), `npm test` and `npm run test:browser` (a deprecation warning in the browser fails it), then look over the 3D view; the server serves its `build/` and `examples/jsm/` folders at `vendor/three/`, which the import map in `index.html` points to. The user guide page renders `USER-GUIDE.md` with `marked` (exact version too), served from its `lib/` folder at `vendor/marked/`. Run `npm install` once to get TypeScript and the type packages.

Element lookups that must succeed use `shared/query.ts` (`elById`, `$`, `must`), which throw naming the missing element instead of returning null. Saved files, `data-*` values and other outside data are read through the checks in `shared/guards.ts` (`isRecord`, `isOneOf`) rather than cast; the Open Fixture Library's JSON is the one source taken on trust (as its documented shapes). The console ↔ stage messages (`RegisterRequest`, `StageLayout`, …) are typed in `shared/console-stage.ts`, and the messages between the page and the show server in `shared/protocol.ts`, where each request has its own reply type.

**Tests:** `npm test` (Node's built-in runner, no extra packages) runs `test/*.test.ts`: number fields (`numberFrom`), channel addresses, color mixing, the output math both ways (`shared/engine.ts`), cue steps (`test/steps.test.ts`: loading, a GO's timing through them, the server's Step and GO) reading / saving shows, cues aiming at named positions (`console/aims.ts`), sets (`console/sets.ts`: what's UP NEXT, running on into the next set song, reprises, loading, reordering), console fixtures' channel blocks (`console/fixtures.ts`: one universe per block, clashes, the next free block, loading), the fixture library (`stage/fixture-library.ts`: turning a library fixture's mode into a profile, which modes can be picked, upgrading saved profiles), meters / feet (`stage/units.ts`), risers (`stage/risers.ts`), the stage model (`stage/stage-model.ts`: loading and saving a stage, pan / tilt, aiming, where beams hit the box, rig layouts), and the chat (the `/chat` request checks, finding songs and fixtures, fixture roles and levels, the stage tools against a fake stage, tool search (which tools are deferred), the Anthropic adapter's messages, the server's chat store (saved by id, the oldest dropped past 30, kept in its file), and a whole turn against a fake server: GO, Stop, an unknown tool). `test/access.test.ts` checks which pages may talk to the server, which files it serves (no path, `..` or backslash reaches anything but the app's files, the user guide, three.js and marked), the token check, and the page's policy (`server/access.ts`: only the server's scripts and the import map, by hash, run; `index.html` and `page/help.html` have no other inline script or event handler; every fixture library address can be fetched), then starts a real server (temporary data folder, no model) to check that another site's WebSocket and chat POSTs, and other names for this computer, are refused while the app's own requests get through, that a malformed address gets a 400 and the server keeps running, that an oversized WebSocket message closes only that connection, that an encoded `..%2f` can't read the show, the server or `node_modules` while three.js and marked are served from `vendor/` (and the user guide, but not this README), that `/about` answers the app with its version and refuses other sites, and that every file carries the frame and type headers and the page its policy. The stage model does its 3D math without three.js (`stage/rotation.ts`), so Node runs it. `test/stage-cases.ts` lists a range of fixtures and rigs, and `test/data/stage-geometry.json` holds what the three.js-based version computed for them (recorded in the browser); the model must match it to within 1e-9. Only the drawing (`view3d.ts`, `plan.ts`) isn't covered.

**Browser tests:** `npm run test:browser` runs the app in a headless Chrome (`test/browser/`, about 6 s): it starts its own show server on a free port with a temporary data folder (`UNNATURALLIGHT_DATA_DIR`), so your show and chats are never touched, and opens app windows that it drives with real key presses and clicks over Chrome's DevTools protocol (with the repo's `ws`; no extra packages). They check: the app starts without errors; Delete removes the picked-out riser and ⌘Z brings it back, in the other window too; Delete removes the position being looked at; a new window gets the saved stage; a chat renamed in one window is renamed in another and saved on the server; a chat request that fails is crossed out; the 3D view's GO bar shows what the console's GO area does (text, buttons on / off, tooltips, readout, crossfader and step ticks), its GO, « and » do what the console's do, and dragging its crossfader moves the console's; GO is Pause while its fade plays and Resume once paused, in both (a quick second GO doesn't pause, a paused fade holds, Resume plays it on to the end); steps: added in the console (both ways), ‹ › and the step bars picking them, the console's › landing on a step (the GO bar showing it), ‹ back, the GO bar's › and GO playing the rest of the cue; HTML put into the page can't run script (the page's Content-Security-Policy blocks an injected `onerror` and `javascript:` link); the Show menu lists New, Save, Save as, Load and Rename, its Save and ⌘S save the show, → moves on to the Help menu and Esc closes it, and Save as renames the show (in both windows) and saves it; the Help menu lists User guide, Keys and mouse and About, Keys and mouse asks for the guide's tab at that section, and About shows the server's version, Node and three.js; the user guide page renders `USER-GUIDE.md` with every `#link` landing on a heading and opens at the section in its address; a `?token=` is kept for the tab and taken off the address bar; and no window logs an error or a policy block. Chrome is `$CHROME_PATH` or the usual install; without it the tests are skipped. The chat is pointed at a provider that doesn't exist, so the tests never call a model.

The console and the stage are one app: anything both use (and the page header, or the server) lives in `shared/`, so there's one copy of it.

| Path | What's in it |
|---|---|
| `index.html` | The app — its only page (`page/help.html` just shows the user guide): the stage's and the console's markup in two panes, the Console / Both / Stage switch, ⇄ swap, divider, the header with its menu bar (Show, Help), the console's show name and save state (Unsaved changes / Saved 9:41), DMX outputs, and the toast for its messages: each is `info` (a control already shows it: not shown), `done` (a few seconds) or `error` (until clicked), `StatusKind` in `console/state.ts` (it calls `consoleHeader` in `console/app.ts`), and the import map for three.js (its only inline script: the page's policy allows it by hash) |
| `page/keep-token.ts` | Keeps the `?token=` the app was opened with for the tab, before the app starts (a plain script, not inline: see [Other web pages](#other-web-pages)) |
| `page/page.ts`, `page.css` | The app's header, panes, menu bar (Show: New, Save, Save as, Load, Rename, with ⌘S / ⇧⌘S; Help; pointing and ← → ↑ ↓ as in a desktop app) and DMX output menu, and their styles |
| `page/help-menu.ts` | What the Help menu opens: the user guide in its own tab (`openGuide`, reused each time, at a section when asked) and the About box (from `GET /about`) |
| `page/help.html`, `help.ts`, `help.css` | The user guide page: fetches `USER-GUIDE.md`, renders it with `marked` (`vendor/marked/`), gives each heading GitHub's anchor (so the guide's `#links` work here and on GitHub) and lists the sections beside it |
| `USER-GUIDE.md` | The user guide: everything about using the app, nothing about its insides (that's this file). The one Markdown file the server serves |
| `page/chat/panel.ts`, `chat.css` | The chat panel: the chats (▾ list, New, rename, delete), the conversation, tool lines, Stop, Undo, the resize divider |
| `page/chat/store.ts` | The chats on the show server: load, save (debounced), delete, and hear other windows' changes (server-sent events) |
| `page/chat/loop.ts` | One chat turn: POST `/chat`, stream the reply, run the tools it calls, send the results back, repeat |
| `page/chat/tools.ts` | The chat's tools (playback, cues and songs, fixtures; which are deferred for tool search): name, description, JSON Schema, and what each runs (through `window.consoleChat`, `console/app.ts`) |
| `page/chat/stage-tools.ts` | The chat's stage tools (place, move, aim and follow, rigs, named positions, risers, box), through `window.stageChat` |
| `page/chat/find.ts` | Finding songs and fixtures by the names the model gives |
| `server.sh` | Starts the show server (installs dependencies first if needed) |
| `server/server.ts` | Show server: serves the app, WebSocket at `/ws`, the chat at `/chat`, 40 Hz fade / DMX loop, saving |
| `server/access.ts` | Which pages may talk to the server (the Host and Origin checks) and what the page may do (frame and type headers, the Content-Security-Policy): see [Other web pages](#other-web-pages) |
| `server/chat/chat.ts` | `POST /chat`: checks the request, asks the model, streams the reply; the system prompt. `POST /chat/summary`: sums up older messages |
| `server/chat/chats.ts` | `/chat/chats`: keeps the chats in `server/data/session.chats.json`; GET all, PUT / DELETE one by id, and `/chat/chats/events` tells every other window as each changes; a new or loaded show replaces them all (`replace`, from the console's `show-file` message) |
| `server/chat/model.ts` | The `ChatModel` interface and picking the provider / model from the environment |
| `server/chat/anthropic.ts` | The Anthropic (Claude) adapter |
| `server/show.ts` | The show as the server holds it: songs and sets, live mix, timed fades (GO runs on into the next set song), held flash / blackout |
| `server/dmx.ts` | Enttec DMX USB Pro output over USB serial (one universe per device, remembered by serial number); one frame in flight per device, so a slow link drops frames instead of falling behind |
| `server/net-dmx.ts` | Art-Net and sACN output over UDP (kept in `server/data/network.json`), Art-Net node search, sACN stream-terminated on stop |
| `server/files.ts` | Reading and writing the data files in `server/data/` (readable JSON, written to a temporary file and then put in place, so a crash never leaves half a file) |
| `test/` | `npm test`: unit tests for the shared logic (see above). `test/browser/`: `npm run test:browser`, the app in a headless Chrome (`harness.ts` starts the server and Chrome; `app.test.ts` the tests) |
| `server/data/` | `session.show.json` (the show, with the stage under `stage`; readable JSON, with each list of numbers, like a cue's 256 levels, on one line), `dmx.json` (which device is on which universe) and `network.json` (Art-Net / sACN outputs, optional), and `session.chats.json` (the show's chats, from the chat panel; a saved show file holds them too); not in git. A `session.json` from before is renamed `session.show.json` when the server starts |
| `console/styles.css` | Console styles, scoped to its pane (`:where(#consolePane)`; breakpoints are container queries on the pane) |
| `console/app.ts` | Starts the console and wires its controls; show new / load / save, universes and DMX outputs, fixtures placed on the stage, the page header's hooks (`consoleHeader`), the chat's hooks (`consoleChat`), the show-server link |
| `console/state.ts` | The console's state (the show being worked on, the active set and song, the song's cues, status), shared by its modules |
| `console/dom.ts` | The console's elements (in its pane of `index.html`), the drag helpers its lists share (`wireRowDrag`: rows dragged by their handle; `startDragScroll`: scrolling the list while a drag nears its edge), and its popup menus (`openPopup` shows one by its button and resolves with the pick, or the dismissal on Esc / a click outside / another popup opening; `menuItem`, `closePopup`) |
| `console/live.ts` | Output levels, Live strip and channel meters, LIVE / UP NEXT, GO, crossfade, submasters, master |
| `console/faders.ts` | Fader names and menu, and what's drawn on fader rows (color bars, pan / tilt pads, blackout / flash buttons, fixture outlines) |
| `console/show-tab.ts` | Show tab: the song list |
| `console/set-bar.ts` | Run tab set bar: the song playing, *song 3 of 12*, ◀ / ▶, the running order |
| `console/set-tab.ts` | Set tab: building sets by drag and drop, picking the active set |
| `console/cues.ts` | Run tab: the cue rows with their menus, and their steps (tabs, timeline, the LIVE cue's step row) |
| `console/patch-tab.ts`, `fixtures-tab.ts` | Patch and Fixtures tabs (and the channel / count / group pickers) |
| `console/nav.ts` | Tabs: show name, tab order, routing |
| `console/server-link.ts` | Console side of the show-server link |
| `console/patch.ts` | Fader patch; the show's universe count (channel addresses for the current show) |
| `console/fixtures.ts`, `show.ts`, `songs.ts`, `sets.ts` | Fixtures, show save / load, songs and cues, sets (and what's UP NEXT across set songs) |
| `console/stage-link.ts` | Console side of its link with the stage |
| `console/aims.ts` | Cues that aim fixtures at named stage positions: recording an aim, re-aiming every cue when a position moves |
| `stage/stage.css` | Stage styles, scoped to its pane (`:where(#stagePane)`; breakpoints are container queries on the pane) |
| `stage/stage.ts` | Starts the stage; keeps up with other app windows and the show server; ⌥-click traces |
| `stage/chat-hooks.ts` | The chat's hooks into the stage (`window.stageChat`): look, place, move, aim and follow, rigs, named positions, risers, box, and edit snapshots for Undo |
| `stage/state.ts` | The stage's data (box, fixtures, rigs, named positions, risers, selection), saving it, rig helpers, and what the stage is in the middle of (placing, aiming) |
| `stage/view3d.ts`, `plan.ts` | The 3D view and the plan view, with their mouse handling |
| `stage/frame.ts` | Work done at the start of each 3D frame, before it's drawn (the console's latest levels are taken there, so they show in that frame) |
| `stage/sidebar.ts` | Fixture, Positions and Risers lists, inspector and key strip |
| `stage/panel.ts` | Side panel layout: collapsing Plan / Fixtures / Inspector, and the dividers between them |
| `stage/actions.ts`, `keys.ts` | Select, place, aim, flash, right-click menu, duplicate, delete / undo / redo; keyboard |
| `stage/dialogs.ts` | Box size, View settings, Place rig and Place fixture dialogs |
| `stage/units.ts` | Meters or feet: converting what's shown and typed (the data stays in meters), snapping steps, saying where a spot is |
| `stage/link.ts` | Linking stage fixtures to console fixtures and channels, and registering them in the console |
| `stage/stage-model.ts` | Fixture, rig and named position data, DMX values ↔ angles / color / beam, aiming math, save format; no three.js, so `npm test` covers it |
| `stage/rotation.ts` | The model's 3D math: plain vectors, rotations (quaternions) and yaw / pitch / roll (three.js's formulas, order YXZ); `view3d.ts` turns them into three.js objects to draw |
| `stage/risers.ts` | Riser data and math (footprint, corners, what stands where); no three.js, so `npm test` covers it |
| `stage/console-link.ts` | Stage side of its link with the console |
| `stage/names.ts` | Whether fixture, position and riser names always show, or only on hover / pick (⚙ View, this browser) |
| `stage/go-bar.ts` | The 3D view's GO bar: the console's GO area (`GoArea`, from `console/live.ts` `goArea`) shown, its buttons pressed and its crossfader dragged through the link |
| `stage/follow.ts` | Fixtures following named positions: aiming, re-aiming when a position or fixture moves (here and in the console's cues), what each one follows |
| `stage/show-link.ts` | Stage side of the show-server link: keeps the stage with the show |
| `stage/fixture-library.ts` | Open Fixture Library browsing, picker, fixture mode → channel profile |
| `shared/json.ts` | Readable JSON for `session.show.json` and saved show files (indented; lists of numbers on one line) |
| `shared/engine.ts` | Output math (crossfade / master mix, through a cue's steps, HTP per channel, fade curve (linear) and timing) and the reverse (the fader levels that give a channel a value, for the stage), used by the console and the server |
| `shared/trace.ts` | The ⌥-click trace card (one, shared by the console and the stage; each registers what it knows) |
| `shared/pan-tilt-pad.ts` | The ✥ pan / tilt pad (hold and move the mouse), used under the console's pan / tilt faders and in the stage inspector |
| `shared/color-picker.ts` | The color picker (wheel, swatches, R/G/B; one, shared by the console and the stage) in place of the browser's |
| `shared/theme.css` | The look of the whole app: colors, fonts and type scale (`--text-2xs` … `--text-2xl`, used for every font size), title bars, thin scrollbars (`.thin-scroll`), and the styles of the shared dialog, color picker and trace card; loaded by the app page |
| `shared/ask.ts` | The confirm / name dialog (new show, new song, remove …), used by the console and the page header |
| `shared/server-socket.ts` | The window's one WebSocket to the show server (token, reconnecting), shared by the console and the stage; keeps the server's `hello` current and hands it to a side that starts listening late |
| `shared/console-stage.ts` | The console ↔ stage link inside the page: what each side may call on the other |
| `shared/panes.ts` | Which pane you're working in (the stage's keys only act there) |
| `shared/live-fields.ts` | Which show fields change while playing, used by the server and the console |
| `shared/address.ts` | Universes and channel addresses (`2/45` ↔ 557) |
| `shared/attributes.ts` | Fixture attributes (dimmer, pan, tilt, red, green, blue, zoom) and their names |
| `shared/color.ts` | Hex ↔ R/G/B, and mixing a color onto a fixture's emitters (red, green, blue, deep red, white, amber, lime, cyan, indigo, UV) and back |
| `shared/numbers.ts`, `html.ts`, `ids.ts`, `storage.ts` | Small helpers: clamping to 0–255 and ranges (`clamp`, `clampInt`, `clampByte`), escaping text for HTML and making elements (`el(tag, class, text)`, `button(class, text)`), new ids, and this browser's localStorage without the throwing (`readStored`/`store`, `readStoredJson`/`storeJson`) |
| `shared/query.ts` | Element lookups that must succeed (`elById`, `$`, `must`): they throw naming what's missing; `elById(id, HTMLButtonElement)` also checks the kind (the console's `dom.ts` uses it for all its elements) |
| `shared/guards.ts` | Checks for outside data (saved files, server messages, `data-*` values): `isOneOf`, `isRecord`, `isPresent`; `errorMessage` for caught errors |
| `shared/protocol.ts` | Types of the WebSocket messages between the page and the show server |
| `shared/chat-protocol.ts` | The chat's own message and tool types, between the page and `/chat` (no provider's format) |

## How it all talks

```
   browser (this computer or another one)               show computer
  ┌───────────────────────────────────────┐          ┌───────────────────────────────┐
  │  the app (one page)                   │   /ws    │  show server                  │   USB serial  ┌──────────────┐
  │    console ──┐   ┌── one WebSocket ───┼◀────────▶│  (server/server.ts)           │──────────────▶│ DMX USB Pro  │──▶ lights
  │              │ in-page link           │          │   · holds the show + stage    │ (per universe)└──────────────┘
  │    stage   ◀─┘   │  (both use it)     │          │   · runs fades, 40 Hz         │
  │                                       │  HTTP    │   · saves session.show.json   │   UDP         ┌──────────────┐
  │    chat panel ────────────────────────┼─────────▶│   · /chat: asks the model     │──────────────▶│ Art-Net /    │──▶ lights
  │      POST /chat, /chat/summary        │◀─────────│   · /chat/chats: the chats    │ (per universe)│ sACN nodes   │
  │      /chat/chats (+ events stream)    │          │     (session.chats.json)      │               └──────────────┘
  └───────────────────────────────────────┘          └───────────────┬───────────────┘
                                                                     │ HTTPS (only /chat)
                                                                     ▼
                                                              model provider
```

### Every connection at a glance

| # | Between | How | What travels | Code |
|---|---|---|---|---|
| 1 | browser → server | HTTP GET | the app's files (`index.html`, `USER-GUIDE.md`, `page/`, `console/`, `stage/`, `shared/`; `.ts` with types stripped), three.js and marked (`vendor/`, from `node_modules`), never cached; `/about` (the app's version, Node's and three.js's, for the About box) | `server/server.ts` (the HTTP handler, `stripped`), `server/access.ts` (`publicFile`) |
| 2 | console ↔ server | WebSocket `/ws` | the show, live mix, fader edits, GO / pause / stop, flash / blackout holds, DMX requests and status | `console/server-link.ts` |
| 3 | stage ↔ server | the same WebSocket | the whole stage after each edit; the stage for **Save show** / from **Load show** | `stage/show-link.ts` |
| 4 | console ↔ stage | function calls in the page | output levels, fixtures, aims → stage; set channel, register, select, aim → console | `shared/console-stage.ts` |
| 5 | chat panel → server | HTTP POST `/chat` | the conversation and tool list; the reply streams back (one JSON event per line) | `page/chat/loop.ts`, `server/chat/chat.ts` |
| 6 | chat panel → server | HTTP POST `/chat/summary` | older messages to sum up; a short summary back | same |
| 7 | chat panel ↔ server | HTTP GET / PUT / DELETE `/chat/chats` | the chats: all of them, or one by id | `page/chat/store.ts`, `server/chat/chats.ts` |
| 8 | server → chat panels | server-sent events `/chat/chats/events` | each chat saved or deleted by another window | same |
| 9 | server → model provider | HTTPS | a chat turn or summary (only the server holds the API key) | `server/chat/model.ts`, `anthropic.ts` |
| 10 | server → DMX USB Pro | USB serial (57600 baud, Enttec Pro packets) | 512 levels per universe, 40 times a second | `server/dmx.ts` |
| 11 | server → network nodes | UDP: Art-Net (port 6454, broadcast or a node's address) or sACN (port 5568, multicast) | the same 512 levels; Art-Net polls find nodes | `server/net-dmx.ts` |

- **The chat's tools don't use links 5–9 to change anything.** They run in the page and call the console and stage (`window.consoleChat`, `window.stageChat`), so their edits travel over links 2 and 3 like a click's.
- **Each kind of state has one owner.** The show, live mix and stage belong to the server (links 2, 3). The chats also belong to the server (7, 8) but are a separate file. Each browser keeps only conveniences: a copy of the show and stage so the page opens at once, the layout, the chat panel's width and which chat is open.
- **From another computer**, links 2, 3 and 5–8 (and `/about`) need the token (see [Other computers](#other-computers)); the app's files (1) don't.
- **From another web site**, nothing gets through: every link from a browser must name this computer (Host) and come from the app's own pages (Origin), see [Other web pages](#other-web-pages).
- **The server never starts a conversation with a browser**, apart from answering on links that the page opened (the WebSocket and the events stream). A window's console and stage share its one WebSocket; the stage often starts listening after the server's `hello` (it waits for three.js to load), so `shared/server-socket.ts` keeps that `hello` up to date with later messages and hands it to the stage when it joins. Pages reconnect by themselves when it restarts: the WebSocket every second; the events stream through the browser's `EventSource`, after which the panel reloads the chats in case it missed a change.

Links 2–4 are described below (2 and 3 share the window's one WebSocket, `shared/server-socket.ts`, and each side ignores the other's messages); the chat's links (5–9) are under [The chat server](#the-chat-server). The **show server** is the one that counts: it holds the show, runs the fades and drives the DMX interfaces, so closing or backgrounding a browser tab never affects the lights. Every app window is a view of it, and windows keep each other in step only through it.

### 1. Console ↔ show server (WebSocket `/ws`)

`console/server-link.ts`, over `shared/server-socket.ts`.

- **Connecting.** The server answers with `hello`: the show, the stage, the live mix (master, submasters, crossfade, LIVE and the selected cue, whether a transition is running, held flash / blackout faders) and the DMX status. An empty server (first run) takes the first console's show (`seed`).
- **Console → server: only what changed.** The whole show when its structure changes, single fader cells while dragging, live fields (`shared/live-fields.ts`), held flash / blackout buttons, GO / pause / stop, a loaded show file's stage, and requests (DMX, the stage for **Save show**) answered with a `reply`. Every message is in the [message reference](#message-reference-websocket-ws).

- **Server → consoles.** Each edit is passed on to the other consoles. `live` is sent on every fade step (and `show`, to every console, when GO arrives on the next set song), and `dmx` whenever the output status changes.
- **No jitter while dragging.** A value just changed on a console wins over the server's broadcasts for 0.6 s.
- **Dropped connection.** The console retries every second. Held flash / blackout buttons are released. Edits made while disconnected aren't sent: on reconnecting, the console takes the server's show.

### 2. Stage ↔ show server (the same WebSocket)

`stage/show-link.ts`, over `shared/server-socket.ts`. This keeps the stage (box, rigs, fixtures) with the show, so it's in the show file and the same on every computer.

- **Connecting.** `hello` carries the server's stage. The stage sends its own instead if the server has none yet, or if it was edited while it couldn't reach the server.
- **Edits.** After an edit made on the stage, it sends the whole stage (`stage`), and the server passes it on to the other app windows' stages. Values that only followed the console aren't sent; the console already has them.
- **Show files.** A console's **Save show** asks for the stage (`get-stage`) to put it in the file; **Load show** sends a file's stage to the server, which passes it to every window's stage, the loading window's too.
- **What the stage uses.** Only `hello`'s stage and `stage` messages: the show and fades reach it through its own console (see 3).
- **Each window keeps its own values for linked channels** when it takes another window's stage (those follow its own console). The stage is also kept in this browser (`localStorage`, `unnaturallight.stage`), so it opens straight away and works with the server offline.

### 3. Console ↔ stage (inside the page)

`console/stage-link.ts` ↔ `stage/console-link.ts`, over `shared/console-stage.ts`. The console and the stage are one page, so this link is always there: there's no "console offline", no tab to reopen, and nothing between browser tabs. Each app window has its own console and stage; other windows follow through the show server (links 1 and 2). Each side joins the link with the functions the other may call; a call runs as soon as the caller's current update is done.

- **Console → stage: `levels`.** Output levels for every universe (whole numbers, as DMX sends them, plus `exact`: the same unrounded, which the stage draws so a fade brightens smoothly rather than in DMX's whole steps; the fixtures' DMX values stay whole), which faders feed each channel, the console's fixtures, and the cues' aims at named positions (every one in the show, and those in the cue on the output). It's called on every output change, and when the stage starts (its `hello`). It also carries `go`: the console's GO area (`GoArea`: LIVE / UP NEXT and their steps, UP NEXT's fade, the readout, whether a fade plays and what GO does now (`goMode`: GO, Pause or Resume), the crossfader as shown (where a running fade is now) and UP NEXT's step ticks, and each button's on / off and tooltip), which the 3D view's GO bar shows.
- **Stage → console:**

  | Call | What |
  |---|---|
  | `set` | set channel N to V |
  | `register` / `unregister` | for fixtures it places or deletes (the console answers with the stage's `registered`) |
  | `layouts` | each fixture's console fixture and channel layout, so the console fills in roles a console fixture is missing (e.g. a library fixture's amber) |
  | `select` | which fixtures are selected, so the console highlights them |
  | `aim` | aim console fixtures at a named position (their pan / tilt values) in the cue(s) on the output, which remember it; position `null` forgets it |
  | `reaim` | a position or fixture moved: each cue that aims that fixture at that position and still has the old pan / tilt (`from`) gets the new ones (`to`) |
  | `go` | press a GO area button (`prevCue`, `stepBack`, `go`, `step`, `nextCue`) from the 3D view's GO bar: the console does exactly what its own button does |
  | `cross` | drag the GO bar's crossfader (0–100): the console does what dragging its own does |

- **Hello.** Whichever side starts second gets the other's state at once: the stage's `hello` gets the console's levels, the console's `hello` gets the stage's layouts.
- **Registering once.** A fixture another window placed (it arrives with the stage from the server, still waiting to register) is left to that window, so it isn't registered twice. If that window closes first, this one registers it after 5 s.
- **Smooth drawing.** A value just sent from the stage wins over the console's updates for 0.6 s (e.g. an older copy from the server), so dragging doesn't jitter. The stage redraws only when something changed, and not at all while it's hidden, because it shares the page's one thread with the console.

### Message reference (WebSocket `/ws`)

Every message is one JSON object with a `type`. Fader indexes are 0-based (0 = F1); cue and song ids are the ones in the show; channels are numbered across universes (513 = universe 2 channel 1).

**Show server → app window** (the console's messages; the stage's are below)

| `type` | Fields | Sent |
|---|---|---|
| `hello` | `clientId` (this connection's id on the server), `show` (a [show](#the-show-object), or `null` on an empty server), `live` (a [live object](#the-live-object), or `null`), `outputs` (the [DMX status](#dmx-status)), `stage` (the [stage object](#other-details), or `null`) | once, on connecting |
| `show` | `show`, `live` | another console changed the show's structure, or seeded an empty server; also to every console when GO arrives on the next set song |
| `live` | `live` | every fade step; another console moved a live value; flash / blackout holds changed (also when a console disconnects while holding some) |
| `levels` | `cells`: `[cueId, fader, level]` triples (level 0–255) | another console dragged faders |
| `dmx` | `outputs` | a DMX USB Pro connected, disconnected or failed; a network output set or stopped |
| `reply` | `id` (the request's), `ok`, `error` (when not ok), `stage` (for `get-stage`: the stage or `null`), `nodes` (for `net-discover`) | answer to a request |

**Console → show server**

| `type` | Fields | When |
|---|---|---|
| `seed` | `show` | the `hello` had no show: this console's show becomes the show (ignored if the server already has one) |
| `show` | `show` | the show's structure changed (anything but the live fields and fader levels): the whole show; the server keeps its own live fields |
| `levels` | `cells`: `[cueId, fader, level]` triples; the id can be a cue step's | fader cells changed (sent at most once per tick, only the cells that changed) |
| `live` | `live`: only the [live fields](#the-live-object) that changed | master, submasters, crossfade, LIVE or selected cue moved |
| `hold` | `flashing`, `blackedOut`: fader indexes this console holds | a flash / blackout button pressed or let go |
| `step` | none | **›**: fade to the next look (the LIVE cue's next step, or UP NEXT's first) and make it LIVE (no steps ahead: like GO) |
| `go` / `pause` / `stop` | none | GO (fade from the selected cue to what's next: the rest of the LIVE cue when it's on a step, else UP NEXT; from where the crossfade is; on a paused fade, resume it); pause / resume the running fade; stop it (a hand move on the crossfade, picking a cue or song, a new or loaded show) |
| `stage` | `stage` (the [stage object](#other-details)), `file: true` | a show file with a stage was loaded: the server keeps it and passes it to every window's stage, this one's too |
| `get-stage` | `id` | **Save show**: asks for the stage to put in the file |
| `dmx-connect` / `dmx-disconnect` | `id`, `universe` (1–8) | **DMX USB Pro → Connect / Disconnect** |
| `net-set` | `id`, `universe`, `output`: `{ protocol: "artnet" \| "sacn", netUniverse?, host?, priority? }` or `null` to stop | a network output picked or stopped in the DMX menu |
| `net-discover` | `id` | the DMX menu opened or **Search again**: the reply's `nodes` is `[{ ip, name, ports: [{ port, netUniverse }] }]` (Art-Net output ports, after ~1.5 s) |

Requests (those with `id`, a number the console picks) are answered with a `reply` carrying the same `id`. While the console isn't connected they resolve at once with `{ ok: false, error }`.

**Stage ↔ show server** (on the same connection; `hello` above carries the stage)

| Direction | `type` | Fields | When |
|---|---|---|---|
| server → stage | `stage` | `stage` | another app window's stage edited it, or a console loaded a show file with a stage |
| stage → server | `stage` | `stage` | after an edit on this stage (passed to the other windows); on connecting, if the server has no stage or this stage was edited offline |

#### The live object

What changes while playing (`show.live()` in `server/show.ts`; the field lists are in `shared/live-fields.ts`):

| Field | Meaning |
|---|---|
| `master`, `fromSub`, `toSub` | master and the LIVE / UP NEXT submasters, 0–100 |
| `cross` | crossfade, 0 (all LIVE) – 100 (all UP NEXT) |
| `fromCue` | the LIVE cue (index in the active song) |
| `selectedCue` | the selected cue (GO fades from it) |
| `liveStep` | the LIVE cue's step shown and edited (an index into its `steps`), or -1 for the cue's own look |
| `fade` | `null`, or `{ paused }` while a transition runs (server → console only) |
| `flashing`, `blackedOut` | fader indexes held by any console (server → console only) |

UP NEXT isn't sent: each side works it out from LIVE and the set (`upNextCue` in `console/sets.ts`). Past a song's last cue it is the index one past the end, meaning the next set song's first cue.

#### The show object

What the console saves and the server holds (`serializeShow` / `parseShow` in `console/show.ts`). A saved file adds `version` (1), `app` (`"UnnaturalLight"`), `kind` (`"show"`), `savedAt` and, when there is one, `stage`; a file with another `app` or `kind` is refused.

| Field | Meaning |
|---|---|
| `showName` | the show's name |
| `navOrder` | the console's tab order (`show`, `set`, `run`, `channels`, `fixtures`, `patch`); unknown names are dropped, and a missing tab goes in at its default place (after the tab before it in that list) |
| `universes` | 1–8 |
| `songs` | `[{ id, name, cues: [{ id, name, levels, fadeTime, aims, steps }] }]`: `levels` is 256 fader values (0–255); `fadeTime` is the cue's **In** time, 0–20 s (with steps: the fade from the last step into its own look); `steps` is `[{ id, levels, aims, fadeTime, holdTime }]`, the looks a GO passes through first (ids are unique across cues and steps); `aims` is `[{ fixture, position }]`: console fixtures whose pan / tilt in this cue aim at a named stage position (by id) |
| `activeSongId` | the song playing |
| `sets` | `[{ id, name, entries: [{ id, songId }] }]`: each entry points at a song; a song can appear more than once |
| `activeSetId` | the set the Run tab runs |
| `activeEntryId` | the entry playing in that set, or `null` (a song played from outside it) |
| `master`, `cross`, `fromSub`, `toSub`, `fromCue`, `selectedCue`, `liveStep` | the [live fields](#the-live-object) as last saved |
| `faderNames` | 256 names |
| `patch` | 256 lists of `{ channel, max }`: the channels each fader drives, and the level (0–255) a full fader sends |
| `fixtureGroups` | `[{ id, name }]` |
| `fixtures` | `[{ id, name, mount, color, channelStart, channelEnd, groupId, roles? }]`: `mount` is `fixed` / `movable`, `color` is `single` / `multi`, `roles` says what each channel does (`dimmer`, `pan`, `tilt`, `red`, `green`, `blue`, `deepred`, `white`, `amber`, `lime`, `cyan`, `indigo`, `uv`, `zoom`) |

#### DMX status

`outputs` is one entry per universe: `{ universe, connected, remembered, path, error, network }`. `connected` … `error` are its DMX USB Pro: `remembered` is true when the universe has a device it reconnects to; `path` is the device's serial port, and `error` is the last failure, if any. `network` is its Art-Net / sACN output as text (`"Art-Net 0 → 192.168.1.50"`, `"sACN 2 (multicast)"`), or `null`.

### DMX output

Every 25 ms (40 Hz) the server steps any running fade, sends `live` to the consoles if something moved (during a fade, `live.fade` carries its start, target, length and time elapsed: between these updates, which arrive unevenly, each console works the crossfade out itself every screen frame for what it shows, so the stage view fades smoothly; only the server's value is synced back), and writes the 512 levels of each universe to its DMX USB Pro (`server/dmx.ts`) and its network output (`server/net-dmx.ts`; a packet only when the frame changed, or after 1 s). Only one frame is in flight per device, so a slow device never builds up a backlog. Each universe remembers its device's serial number (`server/data/dmx.json`); after an unplug or a restart the same device comes back on the same universe (missing devices are looked for every 2 s). The show is saved to `server/data/session.show.json` half a second after a change.

### Other computers

By default the server listens only on this computer (`127.0.0.1`). With `--lan` it listens on the network and prints a **token** (new each start). A WebSocket, `/about`, `/chat`, `/chat/summary` or `/chat/chats` request (the events stream included) from another computer without the right `?token=` is refused (403); pages are served without it. The printed remote address is the app with `?token=…`; it keeps the token for that browser tab (session storage, `unnaturallight.token`) before the app starts, and the console and the stage read it from there.

### Other web pages

The token keeps other computers out, but every web page open in this computer's browser connects from this computer too. So the server also checks *which page* is asking, and limits what even its own page can be made to do. All of it is in `server/access.ts`.

**Who may ask** (every request and the WebSocket; a refusal is a 403 and a `refused …` line in the server's terminal):

- **Host** must be one of this computer's own names on the server's port: `localhost`, `127.0.0.1` or `[::1]`, and with `--lan` its network addresses and host name (`name` and `name.local`). This stops another site that points its own name at `127.0.0.1` (DNS rebinding) from reading the show or the chats.
- **Origin**, when the browser sends one, must be the server itself (`http://` and the same Host). Browsers let any page open a WebSocket to any address and send a form-style POST without asking first, so without this another site open in the browser could run the show or spend the chat's API credits. A request without an Origin isn't from a web page (curl, the tests) and only needs the Host check (and the token, from another computer). This is what stops cross-site request forgery (CSRF): the app has no cookies or logins, so there's nothing else for another site to ride on.
- **`/chat` and `/chat/summary` take JSON only** (`Content-Type: application/json`, else 415): a browser always asks before sending JSON to another site, and the server never says yes.
- **Only the app's files are served** (`publicFile`): `index.html`, `USER-GUIDE.md`, `page/`, `console/`, `stage/`, `shared/` and the vendor folders (`VENDOR`: three.js's `build/` and `examples/jsm/`, marked's `lib/`), checked on where the path *resolves to*, so an encoded `..%2f` can't reach `server/`, `server/data/` (the show, the chats), `package.json`, this README or the rest of `node_modules`. Everything else is a 404.
- **The token** is compared in constant time (`isToken`), and the page takes it off the address bar once the tab has kept it (`page/keep-token.ts`), so it isn't left on screen, in the browser's history or in a copied link; a reload still has it.
- **GET never changes anything.** A link or `<img src>` on another site sends a GET without an Origin, so a GET that changed something could be forged. Today GETs only serve files, answer `/about`, list the chats and stream chat changes; anything new that changes state must be a POST, PUT or DELETE (or a WebSocket message).

**No request can stop the server.** Any page can make the browser ask for any address (an `<img src>` is enough), so a request the server can't handle must never take it, and the lights, down: a malformed address (a stray `%`) gets a 400, anything else a request throws is logged and answered with a 500 (the HTTP handler runs inside a `try`), and a bad WebSocket frame, a message over 16 MB (`MAX_MESSAGE_BYTES`; a show is tens of KB) or a connection dropped mid-handshake only closes that connection.

**What this doesn't cover:** the network itself. The app is plain HTTP, so on a shared network the token can be read and a page changed on its way to another device; Art-Net and sACN can't be protected at all. See [Safe setup at a venue](USER-GUIDE.md#safe-setup-at-a-venue).

**What a page may do** (headers on what the server sends):

- **Never in a frame** (`X-Frame-Options: DENY` on everything, `frame-ancestors 'none'` in the policy). Otherwise another site could show the app in an invisible frame and trick clicks onto GO or Delete; requests from inside that frame would pass the checks above.
- **Content-Security-Policy** on the page, built from `index.html` as it's served (`contentSecurityPolicy`): scripts only from the server, the import map (allowed by its SHA-256 hash, worked out each time, so editing it needs nothing else) and https addresses the import map names, if any (today none: three.js comes from the server). No other inline script, no inline event handlers (`onerror="…"`), no `javascript:` links, no plugins (`object-src 'none'`), no `<base>`, no form posts. Fetches only to the server (its WebSocket included) and the fixture library's addresses (`CONNECT_ORIGINS`). Styles may be inline (style attributes are used throughout; CSS can't run code). This is the backstop against cross-site scripting (XSS): if a name from a show file ever reached the page as HTML by mistake, it still couldn't run.
- `X-Content-Type-Options: nosniff` (files are only run as what they're sent as) and `Referrer-Policy: no-referrer` (the address, with any `?token=`, is never passed on to another site).

**Writing code under these rules:**

- Put text from a show, a stage, the fixture library, the chat or another window into the page with `textContent` / `el()`, or `escapeHtml` (`shared/html.ts`) inside an HTML string: in attributes too (ids included: a loaded file can hold any id). Only fixed text and numbers go into HTML unescaped.
- No inline `<script>` in `index.html` but the import map: a script goes in its own file (as `page/keep-token.ts`, which keeps the `?token=`). No `onclick="…"` attributes: use `addEventListener`.
- A new address the page fetches from goes into `CONNECT_ORIGINS` (`test/access.test.ts` checks the fixture library's are all there). A new browser library is best added as an npm dependency and served under `VENDOR`; a script from another site would go into the import map (the policy then allows that exact address).
- A blocked script or fetch shows in the browser's console as *Refused to … because it violates the following Content Security Policy directive*, and fails the browser tests.

### The chat server

The chat panel (`page/chat/`) runs its tools **in the page**: they call the console's own functions (`window.consoleChat`), so the chat's changes reach the show server and other windows the same way a click does, and the page never talks to a model provider. The show server's `POST /chat` (`server/chat/`) only asks the model and holds the credentials; `/chat/chats` keeps the chats (below):

```
chat panel ──conversation + tool list──▶ POST /chat ──▶ model provider
     ▲                                       │
     └──── reply streamed, with tool calls ◀─┘
page runs the tools → sends the results in the next POST → repeat
```

- **Request:** `{ messages, tools }` in the chat's own format (`shared/chat-protocol.ts`): `user` / `assistant` (`text`, `toolCalls`, and `raw`, the provider's own reply passed back unchanged) / `tool` (`results`, one per call). Tools are a name, description and JSON Schema.
- **Reply:** one JSON object per line: `text` chunks as the model writes, then `done` with the whole reply (and the model's label), or `error`.
- **Provider:** only `server/chat/model.ts` and its adapters know who answers. Another provider is another adapter (`ChatModel.reply`), picked with the environment:

| Variable | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | | Credentials for the Anthropic adapter (or a profile from `ant auth login`) |
| `UNNATURALLIGHT_CHAT_PROVIDER` | `anthropic` | Which adapter |
| `UNNATURALLIGHT_CHAT_MODEL` | `claude-opus-5-5` | The provider's model id |
| `UNNATURALLIGHT_CHAT_EFFORT` | `low` | How hard it thinks (`low` … `max`); low keeps replies quick |

- **Anthropic adapter:** streams with prompt caching on, and opts into the API's server-side fallbacks (`fallbacks: "default"`), so a request the model declines is retried on a fallback model in the same call. Claude's thinking blocks are tied to the system prompt, tools and earlier messages they were made with; a saved conversation can outlive those (an update changes the prompt or tools, or the panel drops its oldest messages), so the adapter asks the API to drop blocks that no longer match (`prefix_mismatch_behavior: "drop_block"`) rather than fail with *“bound to a different conversation”*. Only the model's past reasoning is lost; the conversation itself is kept.
- **No confirming:** tools run as soon as the model calls them; the panel's **Undo** is the safety net instead. Before each prompt it takes `consoleChat.editSnapshot()` (the show as saved, minus playback and live fields) and `stageChat.editSnapshot()` (the stage as saved, minus the values linked fixtures take from the console, which change with playback) and, if the turn changed them, offers `restoreEdits(before)` for each that changed (the show first: it has the console fixtures the stage's fixtures link to), only while the snapshots still equal the ones after the turn.
- **Tool search:** a tool is `deferred` unless it's playback (`TOOLS` in `page/chat/tools.ts`). The Anthropic adapter (`toApiTools`) declares deferred tools with `defer_loading` and adds the API's tool search tool, so each request carries the few playback tools in full and the model looks up the rest (cue editing, fixtures, the stage) when a request needs them. That keeps requests small as tools are added, and keeps the model choosing well among many. A reply the API pauses in its own tool loop (`pause_turn`) is resumed in the same call. Another provider's adapter can ignore `deferred` and send every tool. A call that Stop prevented still gets a result (an error the model reads), so the conversation stays valid to send.
- **Long chats:** past 20 prompts the panel sends the oldest 10 (and any earlier summary) to `POST /chat/summary`, which has the model sum them up in plain text (`transcript` and `SUMMARY_PROMPT` in `server/chat/chat.ts`, no tools); the summary replaces them as a `summary` message at the start (to Claude: a user message marked as a summary). It runs in the background after a turn, and only if those messages are still there unchanged. If summing up keeps failing, the oldest prompts are dropped past 40. A prompt whose turn failed or was stopped before anything was done is taken back out of the conversation.
- **Chats on the server:** `GET /chat/chats` (all), `PUT` / `DELETE /chat/chats/<id>` (one, a `SavedChat` in `shared/chat-protocol.ts`), and `GET /chat/chats/events` (server-sent events: a `ChatChange` for each save or delete, to every window but the one that made it, by its `?window=` id). The page saves a chat 0.4 s after it changes, and once more as the window closes. Up to 30 are kept (the one used longest ago goes). They need the same `?token=` as `/chat` from another computer. Chats this browser kept before they moved to the server are sent up once and dropped from the browser.
- **Saved conversations are repaired** on load and before each turn (`repairHistory` in `page/chat/loop.ts`): a reload or server restart mid-turn can leave a tool call without a result, which the API refuses, so it gets a *not run* result.
- **Adding a tool:** add it to `TOOLS` in `page/chat/tools.ts` (stage tools: `page/chat/stage-tools.ts`), and a hook in `consoleChat` (`console/app.ts`) or `stageChat` (`stage/chat-hooks.ts`) if it needs one. It's deferred (found by tool search) unless it's in the playback list. Nothing on the server changes.

## Other details

**Channel numbering.** Channels run on across universes (universe 2 channel 1 = 513, up to 8 × 512); the UI shows `universe/channel` when there's more than one universe.

**Fixture library.** The Open Fixture Library API only accepts requests from its own site and `http://localhost:8080`; from other addresses the stage reads the library's files on GitHub instead (same data; list names from file names; GitHub limits that to about 60 manufacturer lookups an hour, cached).

**Browser storage.** Console show (a local copy; the server's is the one that counts): `unnaturallight.session`. Remote token: `unnaturallight.token` (session storage). Stage: `unnaturallight.stage`. App layout: `unnaturallight.shell`. Chat panel (open, width, which chat, ↑ / ↓ prompts; the chats themselves are on the server): `unnaturallight.chat`. Console tab last open: `unnaturallight.console.tab`.

**Stage (`stage` in the show file and `session.show.json`).** `box` (`w`, `d`, `h` in m), `transparent` (per side), `rigs` (type, center, yaw, tilt, size, count, console type, fixture, universe), `positions` (`id`, `name`, `x`, `y`, `z`), `risers` (`id`, `name`, center `x` / `z`, `w` / `d` / `h` in m, `yaw` in degrees; a stage saved before risers has none) and `fixtures`. Each fixture has its position, `base` (zero frame: yaw / pitch / roll), `dmx` (the 0–255 values), `panLimit` / `tiltLimit` / `zoomMin` / `zoomMax`, `dimmerCurve` (`linear`, `square`, `inverse-square` or `s-curve`; missing: linear), `rigId` / `rigIndex`, and `link`: `consoleId`, `start` channel, `layout` (attribute per channel), `owned` (the stage registered it), `type`, `register` (waiting to register), `universe`, and `fixture` (the picked fixture mode's channels and ranges).

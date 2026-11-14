# UnnaturalLight — User Guide

UnnaturalLight is a lighting console and a 3D stage visualizer that run in your web browser and work together:

- The **Console** is your lighting desk: 256 faders, cues grouped into songs, a patch, and DMX output to up to 8 universes through Enttec DMX USB Pro interfaces.
- The **Stage** is a 3D model of your performance space. Place fixtures (generic ones, real models from a library, or whole rigs), and see each beam and where it lands on the floor, walls and ceiling.

The two stay **in sync**: when you place a fixture on the stage it's set up in the console with its own faders; moving those faders moves the fixture on the stage; and adjusting the fixture on the stage moves its faders.

**Contents**

1. [Getting started](#1-getting-started)
2. [Quick start: your first fixture and cue](#2-quick-start-your-first-fixture-and-cue)
3. [The screen](#3-the-screen)
4. [The Stage](#4-the-stage)
5. [The Console](#5-the-console)
6. [Console and Stage together](#6-console-and-stage-together)
7. [Multiple universes](#7-multiple-universes)
8. [Saving your work](#8-saving-your-work)
9. [Reference: keys and mouse](#9-reference-keys-and-mouse)
10. [Troubleshooting](#10-troubleshooting)
11. [Glossary](#11-glossary)

In the app, **Help → User guide** (top left) opens this guide. How it works inside, and how to work on it, is in `README.md` in the UnnaturalLight folder.

---

## 1. Getting started

### What you need

- **Node.js 26 LTS** on the computer the DMX interfaces plug into ([nodejs.org](https://nodejs.org): the macOS installer). It runs the show server. Node 22.13 or newer still works, but 22 stops getting security fixes in April 2027. Keep it up to date: Node's security releases matter more than the app's packages.
- A current web browser (Chrome, Edge, Safari or Firefox) for the Console and Stage.
- **Internet access** only to browse the fixture library. The Stage's 3D library (three.js) comes with the app (`npm install`, which `./server.sh` runs), so a show runs with no internet.
- To drive real lights: one **Enttec DMX USB Pro** per DMX universe. You can use everything else without one.
- For the [chat](#the-chat) (optional): an **Anthropic API key**. Everything else works without one.

### Starting it

In a terminal, from the UnnaturalLight folder:

```bash
./server.sh
```

The first time, it installs what it needs (`npm install`). Then your browser opens **http://localhost:8080** with the Console and the Stage side by side. Keep the terminal running while you work; press **Ctrl+C** in it to stop (the show is saved first).

The terminal runs the **show server**: it holds the show, runs the fades and sends DMX to the interfaces. The app in your browser is a view of it, so closing, reloading or hiding a tab never affects the lights. The **Server · live** pill in the page header (top bar) turns green while the console is connected to it (**Server · offline** while it reconnects).

| Command | Does |
|---|---|
| `./server.sh` | this computer only, port 8080 |
| `./server.sh 9000` | another port |
| `./server.sh --lan` | also let other computers on the network open the console (see [Running from another computer](#running-from-another-computer)) |
| `./server.sh --fake-dmx` | pretend a DMX USB Pro is connected (the terminal prints what would be sent) |
| `./server.sh --no-open` | don't open a browser |
| `./server.sh --nowatch` | don't restart the server when one of its files changes (by default it restarts by itself when one changes, which helps while working on the app). Use this for a show |
| `UNNATURALLIGHT_DATA_DIR=/some/folder ./server.sh 9000` | keep the show, chats and DMX settings in another folder instead of `server/data` (e.g. to try something without touching your show; the browser tests do this) |

If a page ever looks out of date after an update, press **⌘⇧R** (hard reload).

---

## 2. Quick start: your first fixture and cue

1. **Size the stage.** In the Stage's header, set **Box W / D / H** (width, depth, height, in meters or feet: see **⚙ View**) to your space.
2. **Place a fixture.** Click **+ Place fixture** (or press `P`).
   - Choose a **console type**: *Movable · Multi-color* gives a moving light with color; *From fixture library…* lets you pick a real fixture (see [Real fixtures](#real-fixtures-from-the-fixture-library)).
   - Click **Place…**, then click where it goes: on the ceiling, a wall or the floor in the 3D view, on the ground outside the box, or anywhere in the plan.
3. **See it in the console.** The console now has a fixture for it on its *Fixtures* tab, and faders patched to its channels and named after it, e.g. *Fixture 4 Dim*, *Fixture 4 Pan* (the fader rows scroll to them). They start at the fixture's current values.
4. **Move a fader** in the console's **Cue 1**: the fixture on the stage changes with it (brightness, direction, color, beam width).
5. **Or adjust the fixture on the stage:** select it and use `+` / `−` (dimmer), the arrow keys (pan / tilt), `[` / `]` (zoom), or the sliders in the inspector. Its faders in the console follow.
6. **Point it somewhere:** press `A` and click a spot on the floor; the fixture swings to aim at it.
7. **Make a second look:** set up **Cue 2** (click its row to make it live, move its faders), then go back to **Cue 1**.
8. **Run the cue:** press **GO**. The console transitions from Cue 1 to Cue 2 over Cue 2's **In** time, and you watch the stage fade with it.
9. **Connect your DMX interface** (optional): plug it into the computer running `./server.sh`, click **Connect DMX** in the page header (top bar) and choose **DMX USB Pro**, or pick an Art-Net node from the same menu (see [Network DMX](#network-dmx-art-net--sacn)).
10. **Save:** everything autosaves on the show server. To keep a file, choose **Show → Save show** in the page header (or press **⌘S**): it holds the whole show, console and stage.

---

## 3. The screen

UnnaturalLight is **one app on one page**: the Stage on the left and the Console on the right. Both are always there and always live; the switch at the **top right** only chooses what you see:

| Button | Shows |
|---|---|
| **Console** | just the console |
| **Both** | stage and console side by side |
| **Stage** | just the stage |

- **⇄** (left of the switch) swaps which side each is on, in *Both*.
- **The divider** between them (the small grip in its middle marks it) drags to resize; double-click it for 50 / 50.
- The page remembers your choice, the split and the sides.
- Cues keep fading and DMX keeps flowing in every view: both run on the show server. A hidden side keeps up too (the stage follows the faders while you see only the console), so it's right the moment you show it.
- Keyboard shortcuts go to whichever side you last clicked in (or the only one shown): the stage's keys never move fixtures while you're working in the console.
- **The page header** (top bar) holds the console's show controls, in every view: the menu bar after the app's title (**Show** and **Help**), the show's name (click it to rename it) and, in gray beside it, whether it's saved: **● Unsaved changes** once you change something, otherwise when it was last **Saved**, **Loaded** or started (**New show**), e.g. *Saved 9:41* (hover for the file's name). Then the universe count, the **DMX output** button(s) and the **Server** pill. A control shows its own state (the DMX button turns green, the pill goes red), so no message repeats it. Other messages pop up as a **toast** under the header: a result you'd otherwise not see (*Added 4 · 1/1–1/20*) for a few seconds; a problem in red (**Show server offline — reconnecting…**, a fixture that doesn't fit) until you click it, or until it's fixed. The two panes keep their own title bars, **Stage** and **Console**.
- **The menu bar** works like a desktop app's: click **Show** or **Help** to open it; while one is open, pointing at the other (or ← / →) switches to it, ↑ / ↓ move through its items, and **Esc** closes it.
  - **Show:** **New show**, **Save show** (**⌘S**), **Save as…** (**⇧⌘S**), **Load show**, **Rename** (see [Saving your work](#8-saving-your-work)).
  - **Help:** this **User guide** in its own tab, **Keys and mouse** (the [reference](#9-reference-keys-and-mouse) below), and **About** (the app's version, and the Node.js and three.js it runs on).

### The chat

The **Chat** button in the page header opens a panel on the right where you can ask for things in plain words, such as "play song 2", "what's up next?", "master to 60%" or "GO". It answers briefly and does what you asked through this window's console, the same as clicking the controls yourself, so every other window follows as usual. The panes make room for the panel; it never covers them.

- **What it can do so far:**
  - *Playback:* see what's playing and what's in the show; play a song (from a given cue); make a cue LIVE (a jump, with no fade); GO, or Step forward or back one look at a time (like the console's Step buttons); pause, resume or stop a transition; set the master, the crossfader and the LIVE and UP NEXT submasters.
  - *Cues and songs:* read a cue's levels (and which fixtures it aims at named positions); set faders in a cue; copy levels from one cue to another (all of them, or just some fixtures'); add a cue (empty or a copy of another), rename it or change its fade time, move it, delete it; add a step to a cue, set a step's fade and hold, delete one (and set faders or fixtures in a step); add, rename, duplicate, delete or reorder a song (deleting one takes it out of every set).
  - *Sets:* list the sets; add songs to a set (at the end or at a place in it), take one out, move one; make a new set (empty or with songs), rename, duplicate or delete one; run a set (from its first song or a place in it). Unless you name a set, it works on the one the Run tab runs. The Set tab shows the set it changed.
  - *Fixtures and patch:* add console fixtures that aren't on the stage (one or several, with what each channel does; each gets the next free channels and its own faders); rename one, move it to a group, give it another start address or channel count (its faders' patch moves with it, and a linked stage fixture follows) or change its type; rename or delete a group; delete console fixtures (one placed on the stage is deleted on the stage); patch a fader to channels, each with its own max (the level it gets at full), or rename it; patch every fader 1:1 or unpatch them all (like the Patch tab's **1:1** and **Unpatch all**, without the question). Set a fixture's (or a group's, e.g. "Ring 1") dimmer in %, color (any color name; it's mixed onto the fixture's emitters), pan, tilt, zoom, or any channel by its role. Unless you name a cue, edits go into the **LIVE cue**, so you see them at once.
  - *Stage:* see the stage (box, rigs, fixtures and where they point); place fixtures at spots (each gets a console fixture with faders unless you say stage only), generic or a real fixture from the [fixture library](#real-fixtures-from-the-fixture-library) (the chat can search it by manufacturer and model and list a fixture's modes; it needs internet); place a rig (of either kind too) (circle, square or line: center, size, count, tilt, yaw); change a rig (its center moves it); move fixtures (to a spot or by an offset); set fixtures' dimmer, color, pan, tilt, zoom or any channel as the inspector does (this works on fixtures only on the stage too; for console fixtures the values go into the cue on stage); change fixtures' Ranges (how far pan and tilt go, the beam angle at zoom 0 and 255), dimmer curve and zero (here, or aimed at the stage), e.g. from a real fixture's spec sheet; duplicate fixtures; select fixtures so you can carry on by hand; aim fixtures (or a whole rig) at a named position (they follow it) or a spot, or home them; stop fixtures following; add, rename, move or delete named positions; add, move, resize, turn, rename or delete risers; rename or delete fixtures (a rig's fixture deletes its whole rig); set the box's size; change how fixtures get their DMX, as the inspector's [Console link](#linking-a-fixture-by-hand) does: link to a console fixture (several fixtures, or a rig, link in order to the console fixtures from it), drive them from a manual address (with a layout), register a new console fixture for each, or unlink them. What it changes is selected on the stage, so you can see it. Coordinates are in meters from the center of the stage floor (x: stage right − to left +, y: up, z: upstage − to downstage +), but plain words like "over center stage, 5 m up" work.
  - *The show:* rename it; save it (downloads the show file, like **Save show**; give a name to save it as that).
  - *DMX outputs:* see where each universe goes; connect or disconnect the DMX USB Pro; send a universe over Art-Net (to a node or broadcast) or sACN, or stop that; look for Art-Net nodes; change how many universes the show uses.
- **Undo:** after a request that changed the show or the stage (cues, steps, songs, sets, fixture levels, console fixtures, groups and patch, the show's name, fixtures placed, moved, aimed, lit, set up, duplicated or linked, rigs, the box), an **Undo** button under the reply puts all of that request's edits back. It's offered for the latest request only, and only while nothing else has changed the show or the stage since. Playback (LIVE, GO, master, submasters), DMX outputs and a saved file aren't undone.
- **Each action shows as a line in the chat** (✓ done, ✗ failed with the reason, – stopped before it ran). With **Show details** on (chat settings, below), click a line to see the tool used, what it was sent and what it answered. A **⌕ Looked up tools** line is the model finding the tools it needs (most are only found when needed, which keeps each request small). Under each request a small line says which model answered, how many tools it used, how long it took and how many tokens it read (and how many of those came cheaply from the cache) and wrote; tokens are what API usage is billed by.
- **It does what you ask straight away**, GO included: it never asks you to confirm. Word requests carefully during a show.
- **Resize it** by dragging its left edge (the grip in the middle marks it); double-click the edge for the default width. With the edge focused, ← / → resize it too (⇧ for bigger steps). The width is remembered.
- **Stop** (the Send button turns red while it's working; click it) stops it; anything it hasn't done yet isn't done (– in the chat). Enter does nothing while it's working, so it never stops a turn by surprise. **Esc** closes the panel.
- **Several chats:** **New** starts a new chat; the others are kept. A chat is named after its first prompt. The name at the top of the panel (**▾**) lists your chats, most recently used first: click one to switch to it, **✎** to rename it, **✕** to delete it (it asks first; the show isn't changed). Switching waits while a request is running (Stop it first). Up to 30 chats are kept; past that the one used longest ago goes. The list is fetched fresh from the show server each time you open it.
- **Chat settings (⚙** at the top of the panel, or click the model's name next to it**):**
  - **Model:** which model answers: **Claude Opus 5.5** (the default: smart and quick), **Claude Sonnet 5.5** (faster, cheaper), **Claude Haiku 5.5** (fastest, cheapest) or **Claude Fable 5.2** (most capable, slower, costs the most). Your pick is used from your next message on, in every chat. Switching in the middle of a chat is fine: the new model reads the conversation so far.
  - **Show details:** the tool details, tool lookups and the line under each request (above). On to start with; off keeps the chat to what was done.
  - Changes apply at once and are remembered in this browser.
- **Commands** start with **/** at the very start of the message box. Typing **/** lists the commands that match what you've typed so far (ignored anywhere else in a message, or after a space): **↑ / ↓** pick one, **Tab** or **Enter** fills it in (or click it), then **Enter** runs it (when only one command matches, **Enter** runs it straight away); **Esc** hides the list. Commands are never sent to the model.
- **/list** (or **/help**) lists the commands.
- **/usage** says how big the open chat is: how many prompts it keeps, about how many tokens each model call sends now (and how many came from the cache), and the tokens of the model calls still in it (summed-up ones are gone with their messages).
- **/compact** sums up the open chat so far; see *Long chats are summed up* below.
- **/clear** (typed in the message box, then Enter) empties the open chat for good: its messages and its name (the next prompt names it again), in every window. It doesn't ask first, and the show isn't changed; to keep the chat and start another, use **New**. Another */word* says which commands there are. Stop a running request first (Enter waits while it works).
- **↑ / ↓ in the message box** step back and forth through the prompts you sent before (the last 50, from all chats, kept across **New** and reloads), as in a terminal; past the newest is what you were typing. In a longer prompt, ↑ works from its first line and ↓ from its last, so the arrows still move the cursor inside it.
- **The chats are the show's**, kept on the show server in their own file (`server/data/session.chats.json`, next to the show's `session.show.json`). **Save show** puts them in the show file, **Load show** brings back the file's (none, for a file without them), and **New show** starts with none, in every window (a request running at the time stops). Every app window, on this computer or another, sees the same chats. Each chat has its own id, so a window only ever shows that chat's own messages. A chat open in several windows keeps up in all of them as messages arrive, and a rename or delete in one shows in the others. Each window remembers which chat it had open. Don't send in the same chat from two windows at once: the last one to finish wins. The panel's width, whether it's open, the chat settings and the ↑ / ↓ prompts stay in this browser.
- **Long chats are summed up:** past 10 of your prompts, the oldest 5 are summed up in a few lines (one short extra model call) and the summary takes their place: it keeps what you asked for, what was done and any names you gave things. It shows as *Earlier messages, summed up* (click to read it). Every request sends the conversation so far, so this keeps requests small. **/compact** sums up the whole chat at once, there and then (wait for a reply to finish first): handy before carrying on with something new when you want to keep what was done in view. The footer under each reply counts the tokens of every model call that request made (each tool round is one call and sends the whole conversation again), so a request that used tools counts the conversation more than once; most of it comes from the cache, which costs a tenth as much.
- **A prompt that fails before anything is done** is crossed out and left out of the conversation, so typing it again means it once, not twice.

**Setting it up:** the chat needs an Anthropic API key on the show computer. Set it in the terminal before starting the server, e.g. `ANTHROPIC_API_KEY=sk-ant-… ./server.sh` (or `export` it in your shell profile). Without one, the chat says so and the rest of the app works as usual. It uses the internet, and each message costs a little API usage. By default it uses Claude Opus 5.5 with a light thinking effort for quick replies; pick another in the chat settings (⚙), or see *The chat server* in `README.md` to change the default.

### Running from another computer

Start the server with `./server.sh --lan`. The terminal prints a **remote** address with a `token=` on the end; open that address on the other computer (same network). It opens the app (console and stage); use the Console / Both / Stage switch to show just one. Any number of app windows can be open at once, here or elsewhere: each is the whole app, they all show and edit the same show, and a move on one appears on the others (its stage included). The DMX interfaces stay plugged into the server's computer. Other computers can't connect without the token, which changes each time the server starts.

### Safe setup at a venue

The app keeps other web pages and other computers out (see *Other web pages* in `README.md`), but the network around it matters as much:

- **Keep the lighting network to yourself.** Art-Net and sACN have no password: anything on the same network as your nodes can send them DMX directly, without the app. Give the lights their own router or switch (or their own VLAN), and never put them on the venue's guest Wi-Fi.
- **Phones and tablets join a private Wi-Fi** (yours, with a password), not a shared one. On a shared network someone could read the `token=` on its way to a phone, or change the page as it loads (the app is served over plain HTTP).
- **Give the chat its own API key with a spending limit.** Anyone with the token can use the chat. Make a key just for UnnaturalLight in the Anthropic Console (a workspace of its own) and set a monthly limit, so a leaked key or token can only cost that much.
- **Restart the server for a new token.** It changes each time the server starts: restart it if the address has been shared with someone who shouldn't keep it. The page takes the token off the address bar once it's open, so it isn't left on screen.
- **Lock the laptop** when you step away from it: the terminal shows the token, and the console runs the show.

---

## 4. The Stage

### The stage area

- **Box W / D / H** in the header set the size of the performance area.
- **Meters or feet:** **⚙ View → Units** picks the unit every size and place on the stage is shown and typed in: the box size, a fixture's **Location**, a rig's center and size, positions, the readout and banners, and the grids: 1 m squares, or in feet 5 ft squares with 1 ft lines between (in 3D those fade out where they'd crowd together; the plan switches to 5 ft when zoomed out). Dragging and placing snap to 0.1 m, or 3 inches in feet (⌥ for 1 cm / 1 inch). It's remembered in this browser; the show itself is always saved in meters, so other windows can use the other unit. The chat answers in your unit too.
- **The GO bar**, at the top of the 3D view, is the console's GO area in miniature, laid out the same way: **LIVE** on the left (with its step, e.g. **Cue 2 · step 1 of 3**), **«** **‹** **GO** **›** **»** in the middle with the readout under them (**23% · into step 1 of 2**), **UP NEXT** on the right with its fade (**4s**, **3 steps · 12s**). Each button does exactly what the console's own does, on the lights (GO fades to UP NEXT, and is Pause / Resume while that fade plays, as the console's; › / ‹ step through a cue's [steps](#songs-and-cues); « » make the cue before or after LIVE the LIVE one, across set songs too). A long cue name is cut short (…); hover it for all of it. Under them, the console's **crossfader**: it moves as a fade plays (smoothly, as the stage draws it), shows where UP NEXT's steps land, and dragging it blends LIVE into UP NEXT exactly as dragging the console's does (it stops a running fade, as there). A button is off whenever the console's is, with the same tooltip; GO lights up while a fade plays. The buttons keep their places whatever the cues are called. (Both are drawn from one place, `goArea` in `console/live.ts`, so they can't disagree.)
- The **amber line** marks the audience edge. *Stage left / right* are from the performer's point of view, facing the audience.
- **Names:** fixtures, positions and risers are named only while you point at them (in 3D, the plan or a list) or pick them out, so a busy stage stays readable. **⚙ View → Always show names** names them all, as before (in the plan for fixtures; 3D names a fixture only while you point at it). It's remembered in this browser.
- **⚙ View** opens view settings: the units (above), names (above), and tick which sides of the box are **transparent** (see-through, so you can see fixtures placed beyond them) or untick for solid. The floor is always solid, and the walls nearest you always stay see-through so you can look in. Beams always show where they land, even on a transparent side.

### Looking around

| To | Do |
|---|---|
| Orbit the camera | drag empty space in the 3D view |
| Zoom | scroll |
| Pan the camera | right-drag, or ⇧ / ⌘ / Ctrl + drag |

The **plan** (top of the right-hand sidebar) is a 2D view of the stage from one of four sides — choose with **Top · Front · SR · SL**:

| View | Looking from | Good for |
|---|---|---|
| **Top** | above (audience at the bottom) | positions on the floor plan |
| **Front** | the audience | heights, side to side |
| **SR** / **SL** | stage right / stage left | heights, up / downstage |

Each view shows every fixture's beam direction, the dot where its beam lands, and rig outlines.

### Placing fixtures

1. Click **+ Place fixture** or press `P`.
2. Pick a **console type**. This decides what the fixture can do and how many console channels and faders it gets:

   | Console type | Channels / faders | Controls |
   |---|---|---|
   | Movable · Multi-color | 7 | Dimmer, Pan, Tilt, Red, Green, Blue, Zoom |
   | Movable · Single color | 4 | Dimmer, Pan, Tilt, Zoom |
   | Fixed · Multi-color | 4 | Dimmer, Red, Green, Blue |
   | Fixed · Single color | 1 | Dimmer |
   | **From fixture library…** | the fixture mode's own | a real fixture |
   | Stage only | none | the fixture exists only on the stage |

   With several DMX universes you also choose the **Universe**.
3. Click **Place…**, then click where it goes:

   | Click | The fixture goes |
   |---|---|
   | a floor, wall or ceiling in 3D | on that surface, inside the box |
   | ⌥ + click a wall in 3D | on the outside of that wall |
   | the ground outside the box in 3D | standing on the ground outside |
   | anywhere in the plan | at that spot (Top view: hung just under the ceiling height) |

   A marker follows the pointer in 3D: **cyan** = inside the box, **amber** = outside. `Esc` cancels.

A new fixture starts at full dimmer and white, pointing at the center of the stage floor. You can have up to 32 fixtures.

### Real fixtures from the fixture library

Choose **From fixture library…** as the console type to use a real, named fixture from the free [Open Fixture Library](https://open-fixture-library.org) (ETC, Martin, Chauvet, Robe and many more):

1. Pick the **Manufacturer**, type in **Search** to find the **Fixture**, and choose its **Mode** (fixtures often have several modes with different numbers of channels).
2. The preview lists the mode's channels in order. Channels marked **→** are drawn on the stage (dimmer, pan, tilt, red / green / blue, zoom).
3. Click **Place…** and place it as usual.

The fixture is named after the model (e.g. *MAC Aura 1*) and uses the fixture's real pan / tilt range and beam angles. In the console it gets **every channel of the mode, in order, each with its own fader** named after the channel (e.g. *MAC Aura 1 Shutter*, *MAC Aura 1 Pan fine*), so you can control everything, including channels the stage can't show (strobe, gobos, color wheels, "fine" channels…).

- Browsing needs internet; a placed fixture keeps working offline.
- Modes with more than 64 channels, and pixel-mapping modes, can't be picked.
- The picker remembers your last manufacturer, fixture and mode.

### Selecting fixtures

- **Click** a fixture in the 3D view, the plan or the fixture list to select it. **⌘-click** (or **⇧-click**) adds or removes fixtures from the selection.
- `Tab` / `⇧Tab` steps through the fixtures. `Esc` clears the selection.
- Keys and most actions apply to **every selected fixture**.

### Moving fixtures

- **Drag** a fixture in the 3D view to slide it around at its height; hold **⇧** (Shift) to raise or lower it instead. You can press or let go of ⇧ partway through a drag to switch.
- **Drag** it in the plan; in the Front / SR / SL views dragging also changes its height.
- Hold `⌥` while dragging for fine steps (1 cm instead of 10 cm).
- Or type exact numbers in the inspector's **Location** (x / height / z, in your unit).

### Controlling a fixture: the 0–255 values

Every fixture is controlled by values from **0 to 255**, just like a dimmer channel or fader:

| Value | 0 … 255 means |
|---|---|
| **Dimmer** | off … full |
| **Pan** | turned fully one way … the other; **128 = straight ahead** (its "zero") |
| **Tilt** | tilted fully down … up; **128 = straight ahead** |
| **Red / Green / Blue** | the amount of each color |
| **Deep Red / White / Amber / Lime / Cyan / Indigo / UV** | the amount of each extra emitter, for fixtures that have them |
| **Zoom** | narrowest … widest beam |

Change them with the keys, or the sliders and numbers in the inspector. Like the fixture's faders in the console, they have a line around them with the fixture's name on it, in the same color as its outline in the console (gold when it isn't linked), and each value sits in its own box, like a fader. Each color channel has a thin upright strip between its name and slider in the color it controls, like the console's color faders; the color rows follow the fixture's channel order, like its console faders; a linked fixture shows only the channels it has — e.g. no pan and tilt on a fixed light (a stage-only fixture shows them all); a library fixture's channels the stage doesn't draw — strobe, dimmer curve, fan, fine channels, … — are under **Other channels**, whose sliders set those channels in the console, with nothing changing on the stage. After **Dimmer** are small **B** and **F** buttons that work like the console's under a dimmer fader: hold **B** to black the fixture out, hold **F** to flash it full and white; both last only while held. On a fixture linked to the console they hold its dimmer fader's B / F there (so the real lights do it, and the console's buttons light up); on a stage-only fixture they just change how it looks on the stage. Beside the **Pan** and **Tilt** sliders, in the color strips' column, is the same **✥** pan / tilt pad as in the console (upright, spanning both rows): hold the mouse button on it and move the mouse — left / right = pan, up / down = tilt, ⇧ = fine:

| Key | Does |
|---|---|
| `+` / `−` | dimmer up / down |
| `←` / `→` | pan left / right |
| `↑` / `↓` | tilt up / down |
| `]` / `[` | zoom wider / narrower |
| hold `⇧` | steps of 10 instead of 1 |
| `H` | **Home**: pan and tilt back to 128 |

The inspector's upright color bar beside the color rows (filled with the fixture's color, like the console's color bar; click it to pick a color) and **color** in the key strip sets the fixture's color channels together — mixed onto every color channel it's linked with (see [Mixing onto extra emitters](#mixing-onto-extra-emitters)), or red, green and blue when it has none (see [The color picker](#the-color-picker); its second row, **On stage**, shows the colors of the fixtures on the stage). **Ranges** set what the ends mean for that fixture: how far pan and tilt go (± degrees) and the beam angle at zoom 0 and 255. **Dimmer curve** (under them) is how the real fixture turns its dimmer value into light, as set in its menu: **Linear** (the default), **Square law** (low values stay dim; common on LED fixtures), **Inverse square** (low values come up quickly) or **S-curve** (gentle at both ends). Set it to match the fixture and the stage draws it as bright as it really is: with square law, dimmer 64 (25%) draws at about 6% and dimmer 1 at next to nothing. The % beside the dimmer, the list's level bar and the HUD show that light. It only changes the drawing: the DMX sent is the same. It's saved with the stage, and a rig's new members copy it.

#### The color picker

The console's color bars and the stage's color pickers all open the same picker (`shared/color-picker.ts`) instead of the browser's own:

- **Wheel:** hue around the edge, saturation toward the center. Click or drag. It picks at full brightness; the dimmer sets how bright the fixture is.
- **Swatches:** common lighting colors (warm white, white, cool white, amber, orange, red, pink, magenta, UV, blue, cyan, green), then a row of colors already in use (**In use** in the console, **On stage** on the stage).
- **R / G / B and hex:** the color's 0–255 values; type in them to set a color exactly. On a fixture with extra emitters these are the color you're asking for, not the faders' values (see below).

Every change applies straight away. Click anywhere outside the picker, or press `Esc` or `Enter`, to close it. That click only closes the picker, so nothing under it is clicked (the fixture stays selected). While it's open, keys go to the picker, not the stage or console.

#### Mixing onto extra emitters

Some fixtures have more than red, green and blue: deep red, white, amber, lime, cyan, indigo, UV. The picker still picks one color, and `shared/color.ts` works out the level of every emitter the fixture has so the mix **is that color** (accurate color, not "everything up"). Each emitter is treated as the color it gives at full (white = equal red, green and blue; deep red ≈ a darker red leaning toward crimson; amber ≈ red with some green; lime ≈ green with some red; cyan = green and blue; indigo ≈ blue with a little red), and they take their share in order:

1. **White** takes the part red, green and blue have in common.
2. **Deep red**, **amber**, **lime**, **cyan** and **indigo** take as much of what's left as they can — the one nearest in hue first, so a crimson goes to deep red, an orange to amber, a yellow-green to lime, a sea green to cyan and a violet to indigo. Plain red stays on red.
3. **Red, green and blue** make up the rest.

So white on an RGBW fixture is the white channel alone, a warm white is white plus amber, and a fixture with only red, green and blue gets the picked values exactly, as before. **UV isn't mixed** — it's barely visible — so it stays on its own fader and the picker leaves it alone. The color shown (color bars, the stage's beams) is worked out the other way round, from all the emitters, UV included. The emitter colors are general values; real LEDs differ a little by manufacturer.

Library fixtures get these roles from their channels automatically (warm and cold white count as white; a channel named *Deep Red* is deep red, since the library calls it just red). Fixtures placed before the extra emitters were supported pick them up the next time the stage and console are open together. If a fixture has two channels of one kind (e.g. *Deep Red* and *Red*), they move together: the picker sets both, and on the stage the first is the color (the inspector lists both channels on its row); changing that color on the stage sets the second too, while moving just one fader in the console leaves the other alone.

**The keys bar** along the bottom of the 3D view works with the mouse too: click any key in it to do what that key does (**hold** an arrow, `+`/`−` or `[`/`]` to repeat; **⇧-click** for steps of 10). A key goes dim, and a held key stops, once the selected fixtures reach 0 or 255 in that direction (or when nothing is selected); the keyboard keys stop there too. It also has a **color** picker that sets the color of the selected fixtures.

### Aiming

- **Aim at spot** (`A`): select one or more fixtures, press `A`, and click a spot on the floor, a wall or the ceiling (or in the plan). Every selected fixture points at it. Great for focusing several fixtures on one spot.
- **Aim at a position:** select fixtures (double-click a rig's fixture for the whole rig), then right-click and pick **Aim at position ▸** and the position (pointing at one in that sub-menu lights it up on the stage), or click **Aim** beside the position in the Positions list (see [Named positions](#named-positions)). The fixtures then **follow** the position: see [Following a position](#following-a-position).
- **Each fixture has its own "zero"**: the direction it points at pan / tilt 128, and which way is "up" for it. It's shown as a dashed cyan line on the selected fixture.
  - **Set zero here** (`Z`): make the current direction the new zero.
  - **Aim zero at stage**: point the zero at the center of the stage.
  - Fine-tune it as yaw / pitch / roll in the inspector's **Zero frame** (roll matters for fixtures hung upside down).
- The inspector's readout tells you which wall the beam's center hits, where, and how far away.

### Named positions

A **position** is a named spot on the stage (e.g. *DSC*, *drum riser*, *lectern*) to aim fixtures at by name, here or in the [chat](#the-chat): the stage's version of a console's *position presets*, but a place on the stage rather than pan / tilt values, so each fixture works out its own pan / tilt to hit it. Positions are saved with the stage, so they go with the show.

- **+ Position** (stage header), then click a spot on the floor, a wall or the ceiling in 3D, or in the plan (the floor in Top; the back or side wall in the other views). `Esc` cancels.
- **Before you click**, a violet diamond shows where the position will go (snapped as it will land: 0.1 m, or 3 inches in feet), with dotted lines through it across the stage (red: stage right to left, green: floor to ceiling, blue: upstage to downstage) and its position and surface beside it and in the banner, e.g. *x 2.4 (SL) · height 0 · z 0.4 (DS) · Floor*. The plan shows the same for its two axes.
- The new position opens in the **Positions** tab (beside **Fixtures** above the inspector) with its name ready to type. There you can rename it, set x / height / z, **Aim** the selected fixtures at it, or delete it (✕).
- **Move a position** by dragging it: in 3D it slides level, at the height it's at (a floor position stays on the floor, also past the walls); hold **⇧** while dragging to move it **straight up or down** (e.g. to head height over the floor spot). Let go of ⇧ mid-drag and it slides level at its new height. In the plan it moves in that view's two directions (Front / SR / SL change its height too). The same dotted lines and x / height / z show while you drag. Fixtures following it re-aim as it moves. Or type its x / height / z in the list.
- Positions show as violet diamonds, in 3D (with a dashed line down to the floor when raised) and in the plan. Click one (in 3D, the plan or the list) to pick it out.
- **Hover over a position** (in 3D, the plan, or its row in the Positions list) to light it up: it grows, gets a glow, its name gets bigger, dashed lines run to it from the fixtures following it, and the banner says where it is and how many fixtures follow it. Handy when it's lost in a beam.
- **Delete a position:** click it to look at it (with no fixtures selected) and press `⌫` / `Delete`; **⌘Z** brings it back. `Esc` stops looking at it.
- **Right-click a position** (in 3D, the plan or its row in the list) for its menu: **Delete position** for now. It stays lit up while the menu is open.

### Risers

A **riser** is a box standing on the stage floor: a platform, a drum riser, a deck. Beams light its top and sides like the floor and walls, so you can see what lands on it. Risers are saved with the stage, so they go with the show.

- **+ Riser** (stage header), then click a spot on the floor in 3D (inside or outside the box) or in the plan, for its center. An outline shows where it will stand. It starts as an 8 × 4 ft deck (2.4 × 1.2 m), 0.4 m high. `Esc` cancels.
- The new riser opens in the **Risers** tab (beside **Fixtures** and **Positions**) with its name ready to type. There you set its **W · D · H** (width, depth, height) and its **x · z** center and **turn** (degrees about the vertical; + is counterclockwise from above), or delete it (✕). Lengths are in the unit from **⚙ View**.
- **Pick a riser out** by clicking it (in 3D, the plan or its row in the list): its edges and outline go white and its **handles** show. Click it again, or empty floor, to put it back.
- **Resize, turn and raise it with the handles** (in 3D and the plan; the banner shows its size and turn as you drag):
  - **Squares** on its corners and edge middles **resize** it: the opposite corner or edge stays put. A riser can't be dragged inside out; it stops at 0.1 m.
  - The **round knob** past its upstage edge **turns** it: drag it around the riser. It snaps to 15° steps (hold `⌥` for 1°).
  - The **arrow** above its top (in 3D), or the **triangle** on its top in the plan's Front / SR / SL views, sets its **height**: drag up or down.
  - Sizes snap to 0.1 m, or 3 inches in feet; hold `⌥` for 1 cm / 1 inch. The plan's Top view shows the corner, edge and turn handles; Front / SR / SL show the height one.
- **Move a riser** by dragging it across the floor. In 3D, drag the picked-out one; pressing on any other riser still turns the view, so a big riser doesn't get in the way of looking around. In the plan any riser drags straight away (Front / SR / SL move it along their one floor direction; they don't lift it). It snaps like everything else (⌥ for fine).
- **On top of a riser:** clicking a riser's top while placing a fixture, placing a position or aiming lands on the riser, at its height. So for "aim at the drummer", put a position on the drum riser's top (the banner says e.g. *Drum riser (top)*), ⇧-drag it up to head height, and aim fixtures at it.
- Risers show in the plan as sand-colored outlines, with their name and height when named (see **Names** under the stage area): their turned footprint in Top, and floor-to-top in the other views.
- **Delete a riser:** pick it out and press `⌫` / `Delete`, or right-click it (in 3D, the plan or its row in the list) for **Delete riser**; the same menu has **Duplicate riser** (a copy beside it, to stage left). **⌘Z** brings it back.
- A riser and fixtures aren't picked at the same time: picking out a riser deselects the fixtures, and selecting a fixture puts the riser back, so `⌫` always deletes what's highlighted. `Esc` puts a picked-out riser back.
- Each riser stands on the floor; for levels, put risers of different heights side by side (or overlap them: the tallest one wins where they overlap).


### Following a position

Fixtures aimed at a named position **follow** it: move the position (or the fixtures, or their rig) and they re-aim to stay on it.

- **Fixtures in the console** (pan / tilt on faders): the aim goes into the **cue on stage** (both cues while the crossfader is between them), like recording a position preset into it. The cue keeps the pan / tilt values, and remembers that they aim at the position. Move the position later and **every cue that aims at it** re-aims, played or not, in every song. So *"Lead → DSC"* in cue 3 still finds DSC after you move it, when cue 3 comes round.
- **Other cues are untouched:** a cue that sets its own pan / tilt plays those. The fixture follows the position only while a cue that aims it there is on stage.
- **Changing pan / tilt any other way lets go**, in that cue only: moving the pan or tilt fader, the ✥ pad, the inspector, **Aim at spot**, **Home**, or the chat. The fixture stays where it is; it just stops following.
- **Fixtures only on the stage** follow the same way, without cues, until their pan / tilt are changed some other way.
- **You can see it:** the inspector shows **Following ‹position›** (for several fixtures, *8 of 8 following*), and the fixture list shows *→ ‹position›* after the name.
- **Change it in the inspector:** the position is a dropdown: pick another and the selected fixtures aim at it and follow it instead (*(several)* when they follow different ones). When none follow, the same line reads **Aim at** *Choose a position…*. **Stop following** keeps them aimed where they are but stops following.
- **Deleting a position** leaves the fixtures and cues aimed where they are (⌘Z brings it back, still followed). Copying a cue copies its aims.
- Aims use the pan nearest the fixture's home, so a position always gives a fixture the same pan / tilt.
### Rigs: circles, squares and lines of fixtures

A **rig** is a group of fixtures in a fixed arrangement that you place and move as one:

| Rig | Fixtures are | They point |
|---|---|---|
| **Circle** | evenly around a ring | at its center |
| **Square** | evenly around its edges | at its center |
| **Line** | evenly along a bar | all the same way (down, when flat) |

1. Click **+ Place rig**. Choose the type, its **size** (diameter, side or length), how many **fixtures**, **tilt** (0 = flat / hanging, 90 = upright facing the audience; for a line, −90 points it at the audience), **yaw** (rotation), and the **console type** (generic or from the fixture library) and universe.
2. Click **Place…**, then click where the rig's center goes. Every fixture in it starts at full dimmer and white.

Working with a rig:

- All its fixtures are selected after placing, so the keys move them all together (e.g. `⇧↓` tilts every fixture down evenly).
- Click one fixture to adjust just it; double-click any of its fixtures (in 3D, the plan or the fixture list), or use **Select whole rig** (inspector or right-click), to select them all again. **⇧- or ⌘-double-click** adds the whole rig to what's already selected (e.g. two rigs, or a rig and a few single fixtures).
- Dragging any of its fixtures moves the whole rig.
- The inspector's **Rig** section changes the rig's position, size and number of fixtures, and its **tilt** (−90…90°) and **yaw** (−180…180°) with sliders; the fixtures rearrange live. A new number of fixtures applies when you press `Enter`, leave the field or click its arrows, so typing e.g. 12 doesn't first rebuild the rig with 1.
- In the console, a rig's fixtures are grouped under the rig's name.

### Flash

Hold `F` (or the **Flash** button) to show the selected fixtures — or all fixtures if none is selected — at **white, full**, for as long as you hold it. It's a preview only; it doesn't change anything in the console.

### Copy, delete, undo

- **Duplicate** (right-click or inspector) copies the selected fixtures. If the original was set up in the console, the copy gets its own console fixture and faders too.
- **Delete** (`⌫` or `Delete`, right-click, or inspector) removes the selected fixtures. Deleting a fixture in a rig removes the whole rig. Fixtures the stage set up in the console are removed there too, and their faders freed.
- **⌘Z** brings back what you deleted: fixtures, rigs, a named position or a riser (up to 50 times, in any stage window, even after a reload). **⇧⌘Z** (or **⌘Y**) deletes it again; a new delete clears what can be redone. Only deletes are undone: moves, aims and other edits aren't (the chat's **Undo** covers its own changes).

### The right-click menu

Right-click a fixture (3D view, plan or list) for: **Aim at spot…**, **Aim at position ▸** (a sub-menu of the named positions), **Stop following** (when a selected fixture follows one), **Home**, **Set zero here**, **Aim zero at stage**, **Select whole rig**, **Flash**, **Duplicate** and **Delete**. Shortcut keys are shown beside each item. Right-click a named position for **Delete position**, and a riser for **Duplicate riser** and **Delete riser**.

### The inspector

The stage's right-hand panel has three parts: **Plan**, **Fixtures** and **Inspector**. Click the arrow beside a heading to collapse or expand that part. Drag the divider on the panel's left edge to make the whole panel wider or narrower (the 3D view gets the rest), the one under **Plan** to make the plan smaller or larger, and the one under **Fixtures** to make the list shorter or taller; the inspector gets the rest. Double-click a divider to reset it. The browser remembers which parts are collapsed and the sizes you dragged. The fixture list and the inspector scroll on their own, with their headings pinned.

The inspector, at the bottom, shows the selected fixture:

- **Name**, **Position**.
- **DMX values** (Dimmer … Zoom) with what each means (%, degrees). If the fixture is linked to the console, each also shows its **channel and fader** (e.g. `12 F12`).
- **Color**, **Ranges**, **Zero frame**, and the beam hit readout.
- **Console link**: which console fixture it's connected to (see [Console and Stage together](#6-console-and-stage-together)).
- **Rig** settings for rig fixtures.

With several fixtures selected (for example a whole rig) it shows **Dimmer**, **Zoom**, **Color** and **Dimmer curve** (**Mixed** when they differ), which set every selected fixture at once. The sliders start at the selection's average. Zoom is the 0–255 value; each fixture turns it into a beam angle using its own **Ranges**.

The small overlay in the 3D view's top-left corner (the **HUD**) shows the selected fixture's main values at a glance.

---

## 5. The Console

### Tabs

Switch with the tabs along the top. **Drag a tab** left or right to reorder them (a line shows where it will land): the order is saved with the show, so every console showing it has the same tabs, and a show file brings its order back (**New show** starts with the default, Show · Set · Run · Channels · Fixtures · Patch). Each browser reopens on the tab it last had open:

| Tab | What it's for |
|---|---|
| **Show** | every song in the show: add, rename (click the name), reorder (drag **⋮⋮**; a line shows where it will land), and **⋮** to **Duplicate** (a copy, *“… copy”*, right after it) or **Delete** it; each song says which sets it's in; click a song to play it |
| **Set** | build a set (the running order for one event) from the show's songs, and choose which set the Run tab runs (see [Sets](#sets)) |
| **Run** | runs the active set: the song playing and where it is in the set, its cues, GO, and the faders |
| **Channels** | meters showing every DMX channel's output, and the live cue's faders |
| **Fixtures** | your lighting fixtures and the DMX channels each one uses |
| **Patch** | which DMX channels each fader controls |

### Songs and cues

- A **song** holds as many **cues** as you like (at least 2). Each cue is one look: a value for every fader.
- Cues are numbered by their place in the list (**Cue 1**, **Cue 2**, …) and renumber themselves when you add, remove or reorder them. Each cue also has a name, shown after its number (*Cue 3: Chorus*). Until you give it one, a dim *name* placeholder shows there. Double-click the title to edit the name; the number stays put. Clear the name to remove it.
- One cue is **LIVE** (on stage now) and the one after it is **UP NEXT**. Their cards say so at the top right. **GO** runs the **transition** from LIVE to UP NEXT: a fade lasting UP NEXT's **In** time. When it finishes, that cue is live and the following one is up next (after a song's last cue, that's the next song in the set: see [Sets](#sets)). While a transition plays, **GO turns into Pause**: press it to hold the fade where it is, and it says **Resume** (in amber) until you press it again. A second GO pressed within about half a second of the first doesn't pause, so pressing GO twice to be sure is safe. Or use the blend fader to crossfade by hand. The **« / »** buttons either side of GO make the previous / next cue LIVE at once, with no fade (the same as clicking that cue). They carry on across songs in the set's order: » on a song's last cue goes to the next set song's first cue, « on its first cue to the previous set song's last cue. They stop at the ends of the set. **‹ / ›**, just either side of GO, do the same a [step](#songs-and-cues) at a time (below).
- Each cue's **In** time is the length of the transition *into* that cue: pick 0–20 s from its menu (0 = a snap). Fades are linear: halfway through the time, the levels are halfway there.
- **Steps.** A cue can have **steps**: looks a GO passes through on the way into it (*Build → Hit → Chorus*), up to 15. A cue's **+ Step** adds one, a copy of the look shown, to change. A cue with steps shows them as tabs (**1 · 2s**, **2 · 1s** …, the last being the cue's own look, where GO ends), **+ Step** to add another after the one shown, and the total time; a bar under them (one part per step, sized by its time) fills in as a GO runs through them. Click a tab, or its part of the bar, to make that step LIVE (no fade) and edit it: the faders below are that step's levels, and fixture aims, the stage and the chat's changes go into it too. On the LIVE cue a row shows the step being edited (**Step 1 of 3**), **‹ ›** to go to the step before or after at once (no fade, like « » for cues), its **Fade** (the time to fade into it from the look before) and **Hold** (how long GO stays on it before the next fades in; 0 by default), **+ Add step** (after it; on the cue's own look, before it) and **Remove step**. The cue's own look keeps the cue's **In** as its Fade. A cue's time is all its fades and holds added up; old shows load with no steps.
  - **GO** into a cue with steps fades through each in turn, on time. The crossfader has a tick where each step arrives, and its readout says where the fade is (*45% · into step 2 of 3*).
  - **LIVE on a step** (*Cue 3 · step 1 of 3*; the readout says *on step 1 of 3*): the cue isn't finished, so UP NEXT is the rest of it (*Cue 3 · step 2–3*), and GO plays its remaining steps, on time, to its own look. Its timeline shows how far through it is.
  - **›** (right of GO) fades to the next look and makes it LIVE: the LIVE cue's next step, or (on a cue's own look) UP NEXT's first step; with no steps ahead it's GO. **‹** (left of GO) makes the look before LIVE's LIVE at once: the step before, from a cue's own look its last step, from its first step (or with no steps) the cue before's own look. GO from part way (after moving the blend fader by hand) goes on from where the crossfade is, rather than starting over. Making another cue or step LIVE puts the crossfade back to 0.
- Click a cue's row to make it LIVE. Use its **⋮** menu to name, duplicate or remove it (**Duplicate** puts a copy right after it and makes the copy LIVE), **⋮⋮** to drag it (a line shows where it will land), and **+ Add cue** (at the right of the song bar) to add a new cue at the end.
- You can have up to 32 songs.

### Sets

The **show** holds every song. A **set** is the running order for one event (*Brooklyn 11/2*): a list of the show's songs. A show can have many sets (up to 32); a new show starts with one, **Set 1**, holding its song.

- **Build a set on the Set tab.** Pick the set at the top (**⋮** for **New set**, **Rename**, **Duplicate** or **Delete**). The show's songs are on the left (type in **Find a song** to narrow them). Drag one into the running order on the right (a line shows where it will land), or press its **+** to add it at the end. Drag songs in the running order to reorder them; press **✕**, or drag one back onto the show's songs, to take it out. A song can be in a set more than once (a reprise); the show's list says *in this set ×2*.
- A set lists the show's songs, not copies: change a song's cues and it changes in every set. Deleting a song from the show takes it out of every set (it asks first).
- **Run a set.** **Run this set** makes it the **active set**: the Run tab runs it from its first song. Clicking a song in the running order runs the set from that song.
- **On the Run tab**, the bar at the top shows the song playing and *song 3 of 12*, with **◀ / ▶** for the previous and next song in the set, and the running order as a list to the left of GO (the song playing is highlighted, the next one dashed; click one to play it; a long set scrolls, with a scrollbar while the pointer is over the list).
- **GO runs on into the next song.** On a song's last cue, UP NEXT is the next set song's first cue (*Ballad · Cue 1*); GO transitions to it and the Run tab moves to that song. On the set's last song's last cue, UP NEXT says **End of set** and GO does nothing.
- **Songs not in the set.** Clicking a song on the Show tab plays it even if it isn't in the active set (it shows *Playing · not in set*, and the Run tab *Not in Set 1*). Its last cue goes back to its first, as a song on its own does.

### Faders

- There are **256 faders**, F1–F256. Each row of faders scrolls sideways (trackpad or ⇧ + mouse wheel over any row, or the one scrollbar along the bottom of the cue area, shown while the pointer is over the cues); the Live strip and every cue row scroll together, so everything stays lined up. The console uses the full width of its window (or its side of the divider), so a wider window shows more faders at once, and more channel meters per row on the Channels tab.
- The **Live** row shows what each fader is actually putting out after the submasters, the blend and the Master.
- A fader only does something once it's **patched** to a channel; unpatched faders are grayed out.
- **Rename** a fader by right-clicking it (or on the Patch tab). Fixtures placed on the stage name their faders automatically.
- **Blackout / flash (dimmer faders):** each fader that controls a fixture's dimmer has two small buttons under it, next to any color bar. Hold **B** to black that fixture out (output 0); hold **F** to flash it at full **and white** (its red, green and blue — and any deep red, white, amber, lime, cyan or indigo channel — go to full too; UV doesn't; pan, tilt and zoom stay where they are). Both last only while held. They change only what's sent out — the fader and your cues aren't touched — and the stage shows the result. (Fixtures placed from the stage are recognized automatically; for your own, name the fader ending in *Dim*, *Dimmer* or *Intensity*.)
- **Fixture outlines:** each run of side-by-side faders that controls one fixture has a colored line around it, labeled with the fixture's name (neighboring fixtures get different colors), and a little space after it so fixtures stand apart. They appear on the Live strip, every cue and the Channels-tab strip, and update when you change the patch.
- **Color fader strips:** each fader in a color bar's group has a thin strip along its bottom in the color it controls (red, amber, lime, indigo, …), so you can tell the emitters apart at a glance.
- **Color bars:** when faders side by side control the **color channels** of the same fixture — red, green and blue, plus any deep red, white, amber, lime, cyan, indigo or UV — a color bar appears under them showing their mix. In a cue (or the Channels-tab strip), **click the bar** to pick a color: all of them are set at once (you can still fine-tune each one), mixed as described in [Mixing onto extra emitters](#mixing-onto-extra-emitters). The color picker is the same one the stage uses (see [The color picker](#the-color-picker)); its second row, **In use**, shows the colors on the console's color bars. On the Live strip the bar just shows the color going out. This works for fixtures placed from the stage (including library fixtures); for fixtures you add yourself, name the faders ending in *R / G / B* (or *Red / Green / Blue*), and any extras *W / A / L / C / I / UV* (or *White / Amber / Lime / Cyan / Indigo*).
- **Pan / tilt pad:** when a fixture has both a **pan** and a **tilt** fader, a small **✥** pad appears under them in each cue (and on the Channels-tab strip). **Hold the mouse button on it and move the mouse:** left / right changes pan, up / down changes tilt. Hold **⇧** for fine moves. The pointer is hidden while you hold, so you can keep moving without running off the pad; let go to stop. (Fixtures placed from the stage are recognized automatically; for your own fixtures, name the faders ending in *Pan* and *Tilt*.)

### Master and submasters

- **Master** scales everything that goes out.
- The two **submasters** scale the LIVE and UP NEXT cues before they're blended.

### Fixtures

The Fixtures tab lists your fixtures. Each has a **DMX start channel and channel count** (up to 64 channels), a type (**Fixed / Movable**, **Single / Multi-color**) and an optional **group**. Fixtures placed on the stage add themselves here; you can also add your own.

### Patch

The Patch tab connects **faders to DMX channels**. A fader can drive several channels, each with a **max** (the level the channel gets when the fader is full). **1:1** patches fader 1 to channel 1, fader 2 to channel 2, and so on. When two faders drive the same channel, the higher one wins ("HTP").

### Connecting to your fixtures

Plug your Enttec DMX USB Pro into the computer running the show server, click **Connect DMX** in the page header and choose **DMX USB Pro**; the server finds it. The button turns green and reads **DMX · USB** once it's connected (a red message under the header says if it couldn't). (For a network node instead, see [Network DMX](#network-dmx-art-net--sacn).) The server remembers the device: after a restart, or if it's unplugged and plugged back in, it reconnects by itself. **DMX USB Pro → Disconnect** in the same menu makes it forget. (For more than one universe, see [Multiple universes](#7-multiple-universes).)

---

## 6. Console and Stage together

The page always has both open side by side, so they're always linked.

### Fixtures set themselves up in the console

When you place a fixture with a console type, the console automatically:

1. adds a **fixture** for it at the next free DMX channels (in the universe you chose),
2. gives it **one fader per channel**, **named after the fixture**: a fader already patched to just that channel and still unnamed (e.g. after *Patch 1:1*) is reused, otherwise a free fader is patched to it,
3. sets those faders to the fixture's current values, so nothing jumps, and
4. scrolls the fader rows to them and highlights them while the fixture is selected on the stage.

If there aren't enough faders or channels, the fixture stays on the stage only and a message (shown for 15 s) tells you why; it isn't linked, so changing it on the stage doesn't reach the console.

To set up a fixture that's already on the stage, use **Register** in its inspector's *Console link* section.

### Finding a fixture's faders

Select a fixture on the stage (click it, or `Tab` to it) and the console's fader rows **scroll to its faders** and highlight its outline for as long as it stays selected, so you can grab them straight away. Selecting something else moves the highlight; clicking empty space clears it. This works for fixtures linked to the console.

### Staying in sync

- **Console → Stage:** faders, cues fading, the blend, submasters and Master all show on the stage as they happen. The stage draws a fade's in-between levels too, so it can look a touch smoother than the real lights, which only get DMX's 256 steps.
- **Stage → Console:** changing a linked fixture on the stage (keys, sliders, Home, Aim at spot…) moves its faders in the console, allowing for Master and the submasters (with Master at 50%, setting the dimmer to 100 on the stage puts its fader at 200).
- When a fixture is first linked, or the console opens, the **console's values win**.
- Only channels that have a fader patched are synced. A channel without a fader stays under the stage's control.
- If one fader drives several fixtures, changing one of them on the stage changes the others too.

### Linking a fixture by hand

In the stage inspector's **Console link** section you can instead link a fixture to an **existing console fixture**, type a **manual address** (e.g. `45`, or `2/45` for universe 2), or choose **— not linked —**. The **Layout** shows what each of its channels drives on the stage, and can be changed. For a rig, **Link rig** links all its fixtures to consecutive console fixtures at once.

### Tracing a signal (⌥-click)

**⌥-click** (Option-click) something to see what controls it, what it controls, and the current values:

| ⌥-click | Shows |
|---|---|
| a **fader** (console) | its cue values, Master → its live level → the channels it feeds → the console and stage fixtures on them |
| a **channel** (console Channels-tab meter, or a channel badge in the stage inspector) | the faders feeding it (and which one wins) → what it drives |
| a **fixture** (console Fixtures tab) | each of its channels, its value, what it does on the stage, and the fader driving it |
| a **fixture** (stage) | each of its values ← its channel ← its fader |

The card updates live. ⌥-click something else to trace that; `Esc` or ✕ closes it. ⌥-click never changes anything.

---

## 7. Multiple universes

A DMX **universe** is 512 channels sent down one cable by one interface. For bigger rigs:

1. In the page header, change **1 universe** to the number you need (up to 8). It's saved with the show.
2. Each universe gets its own button, **U1, U2, …**, which opens that universe's output menu; it turns green when the universe has an output. For USB, plug in one Enttec DMX USB Pro per universe and choose **DMX USB Pro** in each button's menu, one at a time: each takes a device not already on another universe, and remembers it (by serial number) from then on. Or send the universe to a network node.

With several universes, channel numbers are shown and typed as **universe/channel**, e.g. **`2/45`** is channel 45 of universe 2. This works everywhere: the patch, the channel picker (type `2/45`, or just `45` to see channel 45 in every universe), fixtures, the stage and traces.

- When placing a fixture (or rig) on the stage, choose which **Universe** it goes in, or *First with room*.
- A fixture always fits inside one universe.
- On the Channels tab, a switch picks which universe the meters show.
- You can't reduce the number of universes while something is using the ones that would go; move or remove it first.
- Universes can also go out over the network as Art-Net or sACN; see [Network DMX (Art-Net / sACN)](#network-dmx-art-net--sacn).

### Network DMX (Art-Net / sACN)

Instead of (or as well as) a DMX USB Pro, the server can send any universe over Ethernet to an **Art-Net** or **sACN** (E1.31) node, or to a fixture with a network port. The node goes on the same network as the computer running the show server.

Click the universe's DMX button in the page header (**Connect DMX**, or **U1**, **U2**, …). Its menu:

- **Art-Net nodes found**: the server searches the network each time the menu opens (Art-Net "ArtPoll"; many sACN devices answer it too). Each node's DMX outputs are listed with the Art-Net universe they're set to listen on; pick one to send this universe straight to it. **Search again** repeats the search.
- **Art-Net broadcast**: send to every node on the network, as Art-Net universe *U − 1* (Art-Net counts from 0).
- **sACN multicast**: send as sACN universe *U*, to that universe's multicast address (nodes listening to it pick it up).
- **Stop …**: stop the network output. An sACN output tells the receivers it's gone (as it does when the server stops), so a backup console takes over at once.

The button turns green and shows the output (**DMX · Art-Net**, **DMX · USB + sACN**, …; hover for the details). A universe has at most one network output, and can also have a DMX USB Pro. The choice is kept in `server/data/network.json`, which can also be edited by hand (restart the server after):

```json
{
  "interface": "192.168.1.10",
  "outputs": [
    { "universe": 1, "protocol": "artnet", "host": "192.168.1.50" },
    { "universe": 2, "protocol": "sacn" }
  ]
}
```

| Field | Meaning |
|---|---|
| `universe` | the console's universe (1, 2, …) |
| `protocol` | `"artnet"` or `"sacn"` |
| `netUniverse` | universe number on the network (optional). Default: one less for Art-Net, which counts from 0 (U1 → Art-Net 0); the same for sACN (U1 → sACN 1) |
| `host` | the node's IP address (optional). Default: broadcast for Art-Net, the universe's multicast address for sACN |
| `priority` | sACN only, 0–200 (optional, default 100) |
| `interface` | this computer's IP on the lighting network (optional; picks the network card for broadcast / multicast) |

The terminal lists each network output at start (`network : U1: Art-Net 0 → 192.168.1.50`). A frame is sent when it changes and at least once a second otherwise. On Wi-Fi, or with a switch that handles multicast badly, pick a node from the list (or give each output a `host`) so it's sent to that node only.

If no nodes are found: check the node and this computer are on the same network (and subnet), and that the Mac's firewall lets `node` receive connections. If another lighting program on this computer has the Art-Net port (6454), the menu says the search can't run; Art-Net broadcast, sACN and outputs set by hand still work.

---

## 8. Saving your work

**Everything autosaves** as you work, on the show server (`server/data/session.show.json`): the console's show and the stage. The chat panel's chats are kept next to it, in `server/data/session.chats.json`. Closing and reopening the page, restarting the server, or opening the show in another browser or from another computer brings it all back. Closing the window is safe at any moment: console edits reach the server at once, and a stage edit still waiting (stage edits are sent 0.2 s after you stop) is sent as the window closes. (Each browser also keeps a copy of the stage, so it shows straight away; the server's copy replaces it as soon as the page connects. Edits made while the server is unreachable are sent when it's back.) Stage windows keep each other up to date, in any browser: an edit in one (placing, moving, renaming, deleting a fixture…) shows in the others within a moment, so no window's later save undoes another's work. A fixture being registered stays the job of the window that placed it. ⌘Z after a delete works in any stage window (the undo list is saved with the stage, so it also survives a reload).

To keep copies, share them or move to another computer:

- **Console** (the **Show** menu in the page header): **Save show** (**⌘S**) downloads the show (songs, sets, cues, patch, fixtures, fader names, universes, tab order) as a file; **Load show** opens one; **New show** starts fresh (it asks first if you have unsaved changes) and downloads its show file straight away, as **Save show** does. **Save as…** (**⇧⌘S**) asks for a new name, renames the show and saves its file under that name: from then on you're working on the renamed show, and files you saved before stay as they were. **Rename** changes the name where it stands, without saving.
- The show file also holds the **stage** (box size, fixtures, rigs, view settings) and the **chats**, so one file is the whole show. Loading a show file replaces the stage and chats with the file's, in every window; a file saved without them (older, or the show server was offline) gets a blank stage and no chats, as **New show** does (the default box, nothing in it).

---

## 9. Reference: keys and mouse

### Anywhere

| Key | Action |
|---|---|
| `⌘S` (Ctrl+S) | Save show |
| `⇧⌘S` (Ctrl+Shift+S) | Save as… |

### Stage keys

| Key | Action |
|---|---|
| `←` `→` | pan (`⇧` ×10) |
| `↑` `↓` | tilt (`⇧` ×10) |
| `+` `−` | dimmer (`⇧` ×10) |
| `]` `[` | zoom wider / narrower (`⇧` ×10) |
| `H` | Home (pan / tilt to 128) |
| `A` | Aim at spot |
| `Z` | Set zero here |
| `F` (hold) | Flash |
| `P` | Place fixture |
| `Tab` / `⇧Tab` | next / previous fixture |
| `⌫` / `Delete` | delete the picked-out riser, else the selected fixtures, else the position you're looking at |
| `⌘Z` | undo delete |
| `⇧⌘Z` / `⌘Y` | redo (delete again) |
| `Esc` | close menu / cancel / clear selection |

Keys are ignored while you're typing in a field (press `Esc` or `Enter` to leave it) or while a dialog is open. The keys shown in the bar under the 3D view can also be clicked (hold to repeat, ⇧-click for ×10), and the bar has a color picker for the selected fixtures.

### Stage mouse

| Where | Action |
|---|---|
| 3D: drag empty space · scroll · right-drag | orbit · zoom · pan the camera |
| 3D: click / ⌘-click (or ⇧-click) a fixture | select / add to selection |
| 3D: drag a fixture · ⇧-drag | move it · change its height |
| Plan: drag a fixture | move it (`⌥` for fine steps) |
| 3D: click a riser · drag the picked-out one | pick it out · move it across the floor |
| Plan: drag a riser | move it across the floor |
| Drag a picked-out riser's squares · knob · arrow | resize it · turn it (15° steps, `⌥` 1°) · change its height |
| Right-click a fixture | fixture menu |
| ⌥-click a fixture | trace |

### Console mouse

| Where | Action |
|---|---|
| drag a fader | set its level |
| click a color bar (under a fixture's color faders) | pick a color for those faders |
| hold **B** under a dimmer fader | black that fixture out while held |
| hold **F** under a dimmer fader | flash that fixture at full, in white |
| hold **✥** under pan / tilt faders and move the mouse | left / right = pan, up / down = tilt (⇧ = fine) |
| right-click a fader | rename / show in patch |
| ⌥-click a fader, meter or fixture | trace |

---

## 10. Troubleshooting

| Problem | Try |
|---|---|
| The console says **Connecting to the show server…** | Start `./server.sh` (or check it's still running in its terminal). The console reconnects by itself. |
| **Connect DMX** is grayed out | The console isn't connected to the show server (see above). |
| **No DMX USB Pro found** | Plug it into the computer running the server, check the USB cable, close other software using it, unplug and replug. |
| Another computer can't open the console | Start the server with `--lan` and use the full address it prints, including `?token=…`. The token changes each time the server starts. |
| The page says **Forbidden** (or the terminal says `refused …`) | Open the app at `http://localhost:8080` or the address the server prints. Other names for this computer (an alias in `/etc/hosts`, a tunnel) are refused on purpose; another computer's address also needs `--lan`. |
| A part of the app doesn't load, and the browser's console says *Refused to … Content Security Policy* | The page's policy blocked it: a script or address it doesn't allow (see *Other web pages* in `README.md`). Add the address to `CONNECT_ORIGINS` or the import map, or move an inline script into a file. |
| The fixture library won't load | Check your internet connection. Generic console types still work. |
| A fixture wasn't added to the console | Read the message: there may be no free faders (a fader counts as free if it's unpatched, or patched to just that channel and not renamed), no free channels in that universe, or the console may already have 64 fixtures. Free some up, then use **Register** in the fixture's inspector. |
| Moving a fixture on the stage also moved another | They share a fader in the console's patch. |
| The page looks out of date after an update | Press **⌘⇧R**. |
| Can't reduce the number of universes | Something still uses the higher universes; the message names it. |

---

## 11. Glossary

| Term | Meaning |
|---|---|
| **DMX** | the standard signal lighting fixtures listen to: up to 512 channels, each 0–255 |
| **Universe** | one set of 512 DMX channels, sent by one interface |
| **Channel** | one control of one fixture, e.g. its dimmer or pan |
| **Fader** | a slider on the console; patched to one or more channels |
| **Patch** | which channels each fader controls |
| **HTP** | "highest takes precedence": when two faders feed a channel, the higher one wins |
| **Cue** | one saved look (a value for every fader) |
| **Transition** | the fade from one cue to the next that **GO** runs; its length is the next cue's **In** time |
| **Song** | a list of cues |
| **Show** | every song (plus fixtures, patch, sets): what **Save show** saves |
| **Set** | the running order for one event: a list of the show's songs; the Run tab runs the active set |
| **LIVE / UP NEXT** | the cue on stage now / the cue GO will transition to |
| **Master / submaster** | faders that scale everything / one cue |
| **Fixture** | a lighting unit; on the console it owns a block of channels |
| **Mode** | one of a real fixture's channel layouts (e.g. 5-channel or 14-channel) |
| **Rig** | a group of fixtures arranged in a circle, square or line |
| **Zero** | the direction a fixture points at pan / tilt 128 |
| **Position** | a named spot on the stage (e.g. *DSC*) that fixtures aim at and follow, like a console's position preset; cues remember aims at it |
| **Riser** | a box standing on the stage floor (platform, drum riser, deck) |

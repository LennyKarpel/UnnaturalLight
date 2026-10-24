# UnnaturalLight — User Guide

UnnaturalLight is a lighting console and a 3D stage visualizer that run in your web browser and work together:

- The **Console** is your lighting desk: 256 faders, cues grouped into songs, a patch, and DMX output to up to 8 universes through Enttec DMX USB Pro interfaces.
- The **Stage** is a 3D model of your performance space. Place lights (generic ones, real fixtures from a library, or whole rigs), and see each beam and where it lands on the floor, walls and ceiling.

The two stay **in sync**: when you place a light on the stage it's set up in the console with its own faders; moving those faders moves the light on the stage; and adjusting the light on the stage moves its faders.

**Contents**

1. [Getting started](#1-getting-started)
2. [Quick start: your first light and cue](#2-quick-start-your-first-light-and-cue)
3. [The screen](#3-the-screen)
4. [The Stage](#4-the-stage)
5. [The Console](#5-the-console)
6. [Console and Stage together](#6-console-and-stage-together)
7. [Multiple universes](#7-multiple-universes)
8. [Saving your work](#8-saving-your-work)
9. [Reference: keys and mouse](#9-reference-keys-and-mouse)
10. [Troubleshooting](#10-troubleshooting)
11. [Glossary](#11-glossary)
12. [For developers](#12-for-developers)

---

## 1. Getting started

### What you need

- **Node.js 20 or newer** on the computer the DMX interfaces plug into ([nodejs.org](https://nodejs.org)). It runs the show server.
- A current web browser (Chrome, Edge, Safari or Firefox) for the Console and Stage.
- **Internet access** the first time you open the Stage (it downloads its 3D library), and whenever you browse the fixture library.
- To drive real lights: one **Enttec DMX USB Pro** per DMX universe. You can use everything else without one.

### Starting it

In a terminal, from the UnnaturalLight folder:

```bash
./server.sh
```

The first time, it installs what it needs (`npm install`). Then your browser opens **http://localhost:8080** with the Console and the Stage side by side. Keep the terminal running while you work; press **Ctrl+C** in it to stop (the show is saved first).

The terminal runs the **show server**: it holds the show, runs the fades and sends DMX to the interfaces. The browser pages are views of it, so closing, reloading or hiding a tab never affects the lights. The **Server · live** pill in the console's header turns green while the console is connected to it (**Server · offline** while it reconnects). The stage reaches the server through the console: its **Console · live** pill shows that link.

| Command | Does |
|---|---|
| `./server.sh` | this computer only, port 8080 |
| `./server.sh 9000` | another port |
| `./server.sh --lan` | also let other computers on the network open the console (see [Running from another computer](#running-from-another-computer)) |
| `./server.sh --fake-dmx` | pretend a DMX USB Pro is connected (the terminal prints what would be sent) |
| `./server.sh --no-open` | don't open a browser |

If a page ever looks out of date after an update, press **⌘⇧R** (hard reload).

---

## 2. Quick start: your first light and cue

1. **Size the stage.** In the Stage's header, set **Box W / D / H** (width, depth, height in metres) to your space.
2. **Place a light.** Click **+ Place fixture** (or press `A`).
   - Choose a **console type**: *Movable · Multi-color* gives a moving light with color; *From fixture library…* lets you pick a real fixture (see [Real fixtures](#real-fixtures-from-the-fixture-library)).
   - Click **Place…**, then click where it goes: on the ceiling, a wall or the floor in the 3D view, on the ground outside the box, or anywhere in the plan.
3. **See it in the console.** The console now has a fixture for it on its *Fixtures* page, and faders patched to its channels and named after it, e.g. *Fixture 4 Dim*, *Fixture 4 Pan* (the fader rows scroll to them). They start at the light's current values.
4. **Move a fader** in the console's **Cue 1**: the light on the stage changes with it (brightness, direction, color, beam width).
5. **Or adjust the light on the stage:** select it and use the arrow keys (pan / tilt), `+` / `−` (dimmer), `[` / `]` (beam width), or the sliders in the inspector. Its faders in the console follow.
6. **Point it somewhere:** press `T` and click a spot on the floor; the light swings to aim at it.
7. **Make a second look:** set up **Cue 2** (click its row to make it live, move its faders), then go back to **Cue 1**.
8. **Run the cue:** press **GO**. The console transitions from Cue 1 to Cue 2 over Cue 2's **In** time, and you watch the stage fade with it.
9. **Connect your DMX interface** (optional): plug it into the computer running `./server.sh` and click **Connect DMX Pro** in the console header.
10. **Save:** everything autosaves on the show server. To keep a file, use **Save set** in the console and **Export** on the stage.

---

## 3. The screen

The page shows the Stage on the left and the Console on the right. The switch at the **top right** chooses what you see:

| Button | Shows |
|---|---|
| **Console** | just the console |
| **Both** | stage and console side by side |
| **Stage** | just the stage |

- **⇄** (left of the switch) swaps which side each is on, in *Both*.
- **The divider** between them (the small grip in its middle marks it) drags to resize; double-click it for 50 / 50.
- The page remembers your choice, the split and the sides.
- Cues keep fading and DMX keeps flowing in every view: both run on the show server.
- Keyboard shortcuts go to whichever side you last clicked in.

You can also open each on its own: `localhost:8080/console/console.html` and `localhost:8080/stage/stage.html`. If you do, open both in the same browser so they can talk to each other.

### Running from another computer

Start the server with `./server.sh --lan`. The terminal prints a **remote** address with a `token=` on the end; open that address on the other computer (same network). Any number of consoles can be open at once, here or elsewhere: they all show and edit the same show, and a move on one appears on the others. The DMX interfaces stay plugged into the server's computer. Other computers can't connect without the token, which changes each time the server starts.

---

## 4. The Stage

### The stage area

- **Box W / D / H** in the header set the size of the performance area in metres.
- The **amber line** marks the audience edge. *Stage left / right* are from the performer's point of view, facing the audience.
- **⚙ View** opens view settings: tick which sides of the box are **transparent** (see-through, so you can see lights placed beyond them) or untick for solid. The floor is always solid, and the walls nearest you always stay see-through so you can look in. Beams always show where they land, even on a transparent side.

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

Each view shows every light's beam direction, the dot where its beam lands, and rig outlines.

### Placing lights

1. Click **+ Place fixture** or press `A`.
2. Pick a **console type**. This decides what the light can do and how many console channels and faders it gets:

   | Console type | Channels / faders | Controls |
   |---|---|---|
   | Movable · Multi-color | 7 | Dimmer, Pan, Tilt, Red, Green, Blue, Zoom |
   | Movable · Single color | 4 | Dimmer, Pan, Tilt, Zoom |
   | Fixed · Multi-color | 4 | Dimmer, Red, Green, Blue |
   | Fixed · Single color | 1 | Dimmer |
   | **From fixture library…** | the fixture mode's own | a real fixture |
   | Stage only | none | the light exists only on the stage |

   With several DMX universes you also choose the **Universe**.
3. Click **Place…**, then click where it goes:

   | Click | The light goes |
   |---|---|
   | a floor, wall or ceiling in 3D | on that surface, inside the box |
   | ⌥ + click a wall in 3D | on the outside of that wall |
   | the ground outside the box in 3D | standing on the ground outside |
   | anywhere in the plan | at that spot (Top view: hung just under the ceiling height) |

   A marker follows the pointer in 3D: **cyan** = inside the box, **amber** = outside. `Esc` cancels.

A new light starts pointing at the centre of the stage floor. You can have up to 32 lights.

### Real fixtures from the fixture library

Choose **From fixture library…** as the console type to use a real, named fixture from the free [Open Fixture Library](https://open-fixture-library.org) (ETC, Martin, Chauvet, Robe and many more):

1. Pick the **Manufacturer**, type in **Search** to find the **Fixture**, and choose its **Mode** (fixtures often have several modes with different numbers of channels).
2. The preview lists the mode's channels in order. Channels marked **→** are drawn on the stage (dimmer, pan, tilt, red / green / blue, zoom).
3. Click **Place…** and place it as usual.

The light is named after the model (e.g. *MAC Aura 1*) and uses the fixture's real pan / tilt range and beam angles. In the console it gets **every channel of the mode, in order, each with its own fader** named after the channel (e.g. *MAC Aura 1 Shutter*, *MAC Aura 1 Pan fine*), so you can control everything, including channels the stage can't show (strobe, gobos, color wheels, white, "fine" channels…).

- Browsing needs internet; a placed fixture keeps working offline.
- Modes with more than 64 channels, and pixel-mapping modes, can't be picked.
- The picker remembers your last manufacturer, fixture and mode.

### Selecting lights

- **Click** a light in the 3D view, the plan or the fixture list to select it. **⇧-click** adds or removes lights from the selection.
- `Tab` / `⇧Tab` steps through the lights. `Esc` clears the selection.
- Keys and most actions apply to **every selected light**.

### Moving lights

- **Drag** a light in the 3D view to slide it around at its height; **⇧-drag** to raise or lower it.
- **Drag** it in the plan; in the Front / SR / SL views dragging also changes its height.
- Hold `⌥` while dragging for fine steps (1 cm instead of 10 cm).
- Or type exact numbers in the inspector's **Position** (x / height / z, in metres).

### Controlling a light: the 0–255 values

Every light is controlled by values from **0 to 255**, just like a dimmer channel or fader:

| Value | 0 … 255 means |
|---|---|
| **Dimmer** | off … full |
| **Pan** | turned fully one way … the other; **128 = straight ahead** (its "zero") |
| **Tilt** | tilted fully down … up; **128 = straight ahead** |
| **Red / Green / Blue** | the amount of each color |
| **Zoom** | narrowest … widest beam |

Change them with the keys, or the sliders and numbers in the inspector:

| Key | Does |
|---|---|
| `←` / `→` | pan left / right |
| `↑` / `↓` | tilt up / down |
| `+` / `−` | dimmer up / down |
| `]` / `[` | beam wider / narrower |
| hold `⇧` | steps of 10 instead of 1 |
| `H` | **Home**: pan and tilt back to 128 |

The inspector's **Color** picker sets red, green and blue together. **Ranges** set what the ends mean for that light: how far pan and tilt go (± degrees) and the beam angle at zoom 0 and 255.

**The keys bar** along the bottom of the 3D view works with the mouse too: click any key in it to do what that key does (**hold** an arrow, `+`/`−` or `[`/`]` to repeat; **⇧-click** for steps of 10). It also has a **color** picker that sets the color of the selected lights.

### Aiming

- **Aim at spot** (`T`): select one or more lights, press `T`, and click a spot on the floor, a wall or the ceiling (or in the plan). Every selected light points at it. Great for focusing several lights on one spot.
- **Each light has its own "zero"**: the direction it points at pan / tilt 128, and which way is "up" for it. It's shown as a dashed cyan line on the selected light.
  - **Set zero here** (`Z`): make the current direction the new zero.
  - **Aim zero at stage**: point the zero at the centre of the stage.
  - Fine-tune it as yaw / pitch / roll in the inspector's **Zero frame** (roll matters for lights hung upside down).
- The inspector's readout tells you which wall the beam's centre hits, where, and how far away.

### Rigs: circles, squares and lines of lights

A **rig** is a group of lights in a fixed arrangement that you place and move as one:

| Rig | Lights are | They point |
|---|---|---|
| **Circle** | evenly around a ring | at its centre |
| **Square** | evenly around its edges | at its centre |
| **Line** | evenly along a bar | all the same way (down, when flat) |

1. Click **+ Place rig**. Choose the type, its **size** (diameter, side or length), how many **fixtures**, **tilt** (0 = flat / hanging, 90 = upright facing the audience; for a line, −90 points it at the audience), **yaw** (rotation), and the **console type** (generic or from the fixture library) and universe.
2. Click **Place…**, then click where the rig's centre goes.

Working with a rig:

- All its lights are selected after placing, so the keys move them all together (e.g. `⇧↓` tilts every light down evenly).
- Click one light to adjust just it; **Select whole rig** (inspector or right-click) selects them all again.
- Dragging any of its lights moves the whole rig.
- The inspector's **Rig** section changes the rig's position, size, number of lights, tilt and yaw; the lights rearrange live.
- In the console, a rig's lights are grouped under the rig's name.

### Flash

Hold `F` (or the **Flash** button) to show the selected lights — or all lights if none is selected — at **white, full**, for as long as you hold it. It's a preview only; it doesn't change anything in the console.

### Copy, delete, undo

- **Duplicate** (right-click or inspector) copies the selected lights. If the original was set up in the console, the copy gets its own console fixture and faders too.
- **Delete** (`⌫` or `Delete`, right-click, or inspector) removes the selected lights. Deleting a light in a rig removes the whole rig. Lights the stage set up in the console are removed there too, and their faders freed.
- **⌘Z** brings back what you deleted (up to 50 times; until you reload).

### The right-click menu

Right-click a light (3D view, plan or list) for: **Aim at spot…**, **Home**, **Set zero here**, **Aim zero at stage**, **Select whole rig**, **Flash**, **Duplicate** and **Delete**. Shortcut keys are shown beside each item.

### The inspector

The panel at the bottom right shows the selected light:

- **Name**, **Position**.
- **DMX values** (Dimmer … Zoom) with what each means (%, degrees). If the light is linked to the console, each also shows its **channel and fader** (e.g. `12 F12`).
- **Color**, **Ranges**, **Zero frame**, and the beam hit readout.
- **Console link**: which console fixture it's connected to (see [Console and Stage together](#6-console-and-stage-together)).
- **Rig** settings for rig lights.

The small overlay in the 3D view's top-left corner (the **HUD**) shows the selected light's main values at a glance.

---

## 5. The Console

### Pages

Switch with the tabs along the top (drag them to reorder):

| Page | What it's for |
|---|---|
| **Set** | your list of songs: add, rename, reorder; click one to open it |
| **Songs** | the cues of the open song, GO, and the faders |
| **Channels** | meters showing every DMX channel's output, and the live cue's faders |
| **Fixtures** | your lighting fixtures and the DMX channels each one uses |
| **Patch** | which DMX channels each fader controls |

### Songs and cues

- A **song** holds as many **cues** as you like (at least 2). Each cue is one look: a value for every fader.
- Cues are numbered by their place in the list (**Cue 1**, **Cue 2**, …) and renumber themselves when you add, remove or reorder them. Each cue also has a name, shown after its number (*Cue 3: Chorus*). Until you give it one, a dim *name* placeholder shows there. Double-click the title to edit the name; the number stays put. Clear the name to remove it.
- One cue is **LIVE** (on stage now) and the one after it is **UP NEXT**. **GO** runs the **transition** from LIVE to UP NEXT: a fade lasting UP NEXT's **In** time (2–10 s). When it finishes, that cue is live and the following one is up next. **Pause / Resume** a transition, or use the blend fader to crossfade by hand.
- Each cue's **In** time is the length of the transition *into* that cue.
- Click a cue's row to make it LIVE. Use its **⋮** menu to name or remove it, **⋮⋮** to drag it, and **+** to add a new cue at the end.
- You can have up to 32 songs.

### Faders

- There are **256 faders**, F1–F256. Each row of faders scrolls sideways (trackpad, ⇧ + mouse wheel, or the scrollbar); scrolling one row scrolls the others too, so everything stays lined up. The console uses the full width of its window (or its side of the divider), so a wider window shows more faders at once, and more channel meters per row on the Channels page.
- The **Live** row shows what each fader is actually putting out after the submasters, the blend and the Master.
- A fader only does something once it's **patched** to a channel; unpatched faders are greyed out.
- **Rename** a fader by right-clicking it (or on the Patch page). Lights placed on the stage name their faders automatically.
- **Blackout / flash (dimmer faders):** each fader that controls a fixture's dimmer has two small buttons under it, next to any color bar. Hold **B** to black that fixture out (output 0); hold **F** to flash it at full **and white** (its red, green and blue — and any white channel — go to full too; pan, tilt and zoom stay where they are). Both last only while held. They change only what's sent out — the fader and your cues aren't touched — and the stage shows the result. (Fixtures placed from the stage are recognised automatically; for your own, name the fader ending in *Dim*, *Dimmer* or *Intensity*.)
- **Fixture outlines:** each run of side-by-side faders that controls one fixture has a colored line around it, labelled with the fixture's name (neighbouring fixtures get different colors), and a little space after it so fixtures stand apart. They appear on the Live strip, every cue and the Channels-page strip, and update when you change the patch.
- **Color bars:** when three faders side by side control the **red, green and blue** of the same light, a color bar appears under them showing their mix. In a cue (or the Channels-page strip), **click the bar** to pick a color: all three faders are set at once (you can still fine-tune each one). On the Live strip the bar just shows the color going out. This works for lights placed from the stage (including library fixtures); for fixtures you add yourself, name the faders ending in *R / G / B* (or *Red / Green / Blue*).
- **Pan / tilt pad:** when a fixture has both a **pan** and a **tilt** fader, a small **✥** pad appears under them in each cue (and on the Channels-page strip). **Hold the mouse button on it and move the mouse:** left / right changes pan, up / down changes tilt. Hold **⇧** for fine moves. The pointer is hidden while you hold, so you can keep moving without running off the pad; let go to stop. (Lights placed from the stage are recognised automatically; for your own fixtures, name the faders ending in *Pan* and *Tilt*.)

### Master, submasters, blackout

- **Master** scales everything that goes out.
- The two **submasters** scale the LIVE and UP NEXT cues before they're blended.
- The **×** buttons are blackouts: they drop that master to 0; click again to restore.

### Fixtures

The Fixtures page lists your fixtures. Each has a **DMX start channel and channel count** (up to 64 channels), a type (**Fixed / Movable**, **Single / Multi-color**) and an optional **group**. Lights placed on the stage add themselves here; you can also add your own.

### Patch

The Patch page connects **faders to DMX channels**. A fader can drive several channels, each with a **max** (the level the channel gets when the fader is full). **1:1** patches fader 1 to channel 1, fader 2 to channel 2, and so on. When two faders drive the same channel, the higher one wins ("HTP").

### Connecting to your lights

Plug your Enttec DMX USB Pro into the computer running the show server and click **Connect DMX Pro** in the header; the server finds it. The status next to it shows when it's connected. The server remembers the device: after a restart, or if it's unplugged and plugged back in, it reconnects by itself. **Disconnect** makes it forget. (For more than one universe, see [Multiple universes](#7-multiple-universes).)

---

## 6. Console and Stage together

When both are open (the combined page does this for you), the stage's header shows **Console · live** in green. Otherwise it says **Console · offline**, and the stage simply works on its own.

### Lights set themselves up in the console

When you place a light with a console type, the console automatically:

1. adds a **fixture** for it at the next free DMX channels (in the universe you chose),
2. gives it **one fader per channel**, **named after the light**: a fader already patched to just that channel and still unnamed (e.g. after *Patch 1:1*) is reused, otherwise a free fader is patched to it,
3. sets those faders to the light's current values, so nothing jumps, and
4. scrolls the fader rows to them and briefly highlights them.

If there aren't enough faders or channels, the light stays on the stage only and a message (shown for 15 s) tells you why; it isn't linked, so changing it on the stage doesn't reach the console. If the console isn't open yet, the light waits and sets itself up as soon as the console opens.

To set up a light that's already on the stage, use **Register** in its inspector's *Console link* section.

### Finding a fixture's faders

Select a fixture on the stage (click it, or `Tab` to it) and the console's fader rows **scroll to its faders** and briefly highlight its outline, so you can grab them straight away. This works for fixtures linked to the console.

### Staying in sync

- **Console → Stage:** faders, cues fading, the blend, submasters and Master all show on the stage as they happen.
- **Stage → Console:** changing a linked light on the stage (keys, sliders, Home, Aim at spot…) moves its faders in the console, allowing for Master and the submasters (with Master at 50%, setting the dimmer to 100 on the stage puts its fader at 200).
- When a light is first linked, or the console opens, the **console's values win**.
- Only channels that have a fader patched are synced. A channel without a fader stays under the stage's control.
- If one fader drives several lights, changing one of them on the stage changes the others too.

### Linking a light by hand

In the stage inspector's **Console link** section you can instead link a light to an **existing console fixture**, type a **manual address** (e.g. `45`, or `2/45` for universe 2), or choose **— not linked —**. The **Layout** shows what each of its channels drives on the stage, and can be changed. For a rig, **Link rig** links all its lights to consecutive console fixtures at once.

### Tracing a signal (⌥-click)

**⌥-click** (Option-click) something to see what controls it, what it controls, and the current values:

| ⌥-click | Shows |
|---|---|
| a **fader** (console) | its cue values, Master → its live level → the channels it feeds → the fixtures and stage lights on them |
| a **channel** (console Channels-page meter, or a channel badge in the stage inspector) | the faders feeding it (and which one wins) → what it drives |
| a **fixture** (console Fixtures page) | each of its channels, its value, what it does on the stage, and the fader driving it |
| a **light** (stage) | each of its values ← its channel ← its fader |

The card updates live. ⌥-click something else to trace that; `Esc` or ✕ closes it. ⌥-click never changes anything.

---

## 7. Multiple universes

A DMX **universe** is 512 channels sent down one cable by one interface. For bigger rigs:

1. In the console header, change **1 universe** to the number you need (up to 8). It's saved with the set.
2. Each universe gets its own button, **U1, U2, …**. Plug in one Enttec DMX USB Pro per universe and click its button to connect it; it turns green when connected. Connect them one at a time: each button takes a device not already on another universe, and remembers it (by serial number) from then on.

With several universes, channel numbers are shown and typed as **universe/channel**, e.g. **`2/45`** is channel 45 of universe 2. This works everywhere: the patch, the channel picker (type `2/45`, or just `45` to see channel 45 in every universe), fixtures, the stage and traces.

- When placing a light (or rig) on the stage, choose which **Universe** it goes in, or *First with room*.
- A fixture always fits inside one universe.
- On the Channels page, a switch picks which universe the meters show.
- You can't reduce the number of universes while something is using the ones that would go; move or remove it first.
- Only USB interfaces are supported (network DMX such as Art-Net / sACN isn't).

---

## 8. Saving your work

**Everything autosaves** as you work: the console's set on the show server (`server/data/session.json`), the stage in the browser. Closing and reopening the page, or restarting the server, brings it all back.

To keep copies, share them or move to another computer:

- **Console:** **Save set** downloads the set (songs, cues, patch, fixtures, fader names, universes) as a file; **Load set** opens one; **New set** starts fresh (it asks first if you have unsaved changes). Click the set's name beside the title to rename it.
- **Stage:** **Export** downloads the stage (box size, lights, rigs, view settings) as `stage.json`; **Import** opens one.

Save both: the set and the stage are separate files.

---

## 9. Reference: keys and mouse

### Stage keys

| Key | Action |
|---|---|
| `←` `→` | pan (`⇧` ×10) |
| `↑` `↓` | tilt (`⇧` ×10) |
| `+` `−` | dimmer (`⇧` ×10) |
| `]` `[` | beam wider / narrower (`⇧` ×10) |
| `H` | Home (pan / tilt to 128) |
| `T` | Aim at spot |
| `Z` | Set zero here |
| `F` (hold) | Flash |
| `A` | Place fixture |
| `Tab` / `⇧Tab` | next / previous light |
| `⌫` / `Delete` | delete selected |
| `⌘Z` | undo delete |
| `Esc` | close menu / cancel / clear selection |

Keys are ignored while you're typing in a field (press `Esc` or `Enter` to leave it) or while a dialog is open. The keys shown in the bar under the 3D view can also be clicked (hold to repeat, ⇧-click for ×10), and the bar has a color picker for the selected lights.

### Stage mouse

| Where | Action |
|---|---|
| 3D: drag empty space · scroll · right-drag | orbit · zoom · pan the camera |
| 3D: click / ⇧-click a light | select / add to selection |
| 3D: drag a light · ⇧-drag | move it · change its height |
| Plan: drag a light | move it (`⌥` for fine steps) |
| Right-click a light | light menu |
| ⌥-click a light | trace |

### Console mouse

| Where | Action |
|---|---|
| drag a fader | set its level |
| click a color bar (under R/G/B faders) | pick a color for those three faders |
| hold **B** under a dimmer fader | black that fixture out while held |
| hold **F** under a dimmer fader | flash that fixture at full, in white |
| hold **✥** under pan / tilt faders and move the mouse | left / right = pan, up / down = tilt (⇧ = fine) |
| right-click a fader | rename / show in patch |
| ⌥-click a fader, meter or fixture | trace |

---

## 10. Troubleshooting

| Problem | Try |
|---|---|
| The stage says **Console · offline** | Open the combined page (`localhost:8080`), or open the console in the same browser. |
| The console says **Connecting to the show server…** | Start `./server.sh` (or check it's still running in its terminal). The console reconnects by itself. |
| **Connect DMX Pro** is greyed out | The console isn't connected to the show server (see above). |
| **No DMX USB Pro found** | Plug it into the computer running the server, check the USB cable, close other software using it, unplug and replug. |
| Another computer can't open the console | Start the server with `--lan` and use the full address it prints, including `?token=…`. |
| The fixture library won't load | Check your internet connection. Generic console types still work. |
| A light wasn't added to the console | Read the message: there may be no free faders (a fader counts as free if it's unpatched, or patched to just that channel and not renamed), no free channels in that universe, or the console may already have 64 fixtures. Free some up, then use **Register** in the light's inspector. |
| Moving a light on the stage also moved another | They share a fader in the console's patch. |
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
| **LIVE / UP NEXT** | the cue on stage now / the cue GO will transition to |
| **Master / submaster** | faders that scale everything / one cue |
| **Fixture / fixture / light** | a lighting unit; on the console it owns a block of channels |
| **Mode** | one of a real fixture's channel layouts (e.g. 5-channel or 14-channel) |
| **Rig** | a group of lights arranged in a circle, square or line |
| **Zero** | the direction a light points at pan / tilt 128 |

---

## 12. For developers

Plain HTML / JavaScript, no build step. `./server.sh` installs the npm dependencies (`serialport`, `ws`) when needed and runs `node server/server.js`, which serves the pages on port 8080 with caching off. Open the folder in IntelliJ as a Web module; `console/jsconfig.json` sets up JavaScript checking for the console files.

| Path | What's in it |
|---|---|
| `index.html` | The combined page: console + stage frames, Console / Both / Stage switch, ⇄ swap, divider |
| `server.sh` | Starts the show server (installs dependencies first if needed) |
| `server/server.js` | Show server: serves the pages, WebSocket at `/ws`, 40 Hz fade / DMX loop, saving |
| `server/show.js` | The show as the server holds it: set, live mix, timed fades, held flash / blackout |
| `server/dmx.js` | Enttec DMX USB Pro output over USB serial (one universe per device, remembered by serial number); one frame in flight per device, so a slow link drops frames instead of falling behind |
| `server/data/` | `session.json` (the set) and `dmx.json` (which device is on which universe); not in git |
| `console/console.html`, `app.js`, `styles.css` | Console page, logic and styles |
| `console/server-link.js` | Console side of the show-server link |
| `console/patch.js` | Fader patch; universe and channel-address helpers |
| `console/fixtures.js`, `set.js`, `tunes.js` | Fixtures, set save / load, songs and cues (called tunes and transitions in the code) |
| `console/stage-link.js` | Console side of the live link with the stage |
| `stage/stage.html`, `stage.css`, `stage.js` | Stage page (with the import map for three.js), styles, 3D view / plan / inspector / input |
| `stage/stage-model.js` | Light and rig data, DMX values ↔ angles / color / beam, aiming maths, save format |
| `stage/console-link.js` | Stage side of the live link |
| `stage/fixture-library.js` | Open Fixture Library browsing, picker, fixture mode → channel profile |
| `shared/engine.js` | Output math (crossfade / master mix, HTP per channel, fade ease), used by the console and the server |
| `shared/trace.js` | The ⌥-click trace card, used by both pages |

**Show server link.** Consoles connect to `/ws` (other machines add `?token=`). On connect the server sends `hello` (set, live mix, DMX status); an empty server takes the first console's set (`seed`). Consoles send only what changed: the whole `set` for structural edits, single-cell `levels` while dragging, `live` fields (master, subs, crossfade, Current / Next, fade time, blackout snapshots), `hold` (flash / blackout buttons held, released if the console disconnects), `go` / `pause` / `stop`, and `dmx-connect` / `dmx-disconnect` (answered with a `reply`). The server rebroadcasts edits to the other consoles and sends `live` on every fade step and `dmx` when output status changes. A value just changed on a console wins over the server's broadcasts for 0.6 s so dragging doesn't jitter.

**Live link.** The console and stage talk over a `BroadcastChannel` named `unnaturallight.dmx` (same origin, any tabs or frames). The console sends its output levels for every universe, which faders feed each channel, its fixtures, fader names and levels, and the master / submaster / crossfade state, on every change and once a second. The stage sends "set channel N to V" requests, register / unregister requests for lights it places or deletes, and its light list (for traces). With several consoles open in one browser, only the one holding the `unnaturallight.stage-link` Web Lock carries out the stage's set / register / unregister requests (so nothing is applied twice) and passes on changes that came from the server. A change made in a console is sent by that console straight away, marked as local, so it never waits on the leader (which may be in a background window the browser runs slowly); for a moment after, the stage ignores other consoles' slightly older copies of it. The console's reply to a register request reaches every stage tab; each tab acts only on replies for lights it asked about, so a second stage window never undoes another's new lights. The stage takes the console's latest values once per frame (however fast messages arrive) and draws its 3D view only when something changed, since in the split view it shares one browser thread with the console.

**Channel numbering.** Channels run on across universes (universe 2 channel 1 = 513, up to 8 × 512); the UI shows `universe/channel` when there's more than one universe.

**Fixture library.** The Open Fixture Library API only accepts requests from its own site and `http://localhost:8080`; from other addresses the stage reads the library's files on GitHub instead (same data; list names from file names; GitHub limits that to about 60 manufacturer lookups an hour, cached).

**Browser storage.** Console set (a local copy; the server's is the one that counts): `unnaturallight.setlist.session.v1`. Remote token: `unnaturallight.token` (session storage). Stage: `unnaturallight.stage.v1`. Combined-page layout: `unnaturallight.shell`.

**Stage file (`stage.json`, version 2).** `box` (`w`, `d`, `h` in m), `transparent` (per side), `rigs` (type, centre, yaw, tilt, size, count, console type, fixture, universe) and `fixtures`. Each fixture has its position, `base` (zero frame: yaw / pitch / roll), `dmx` (the 0–255 values), `panLimit` / `tiltLimit` / `zoomMin` / `zoomMax`, `rigId` / `rigIndex`, and `link`: `consoleId`, `start` channel, `layout` (attribute per channel), `owned` (the stage registered it), `type`, `register` (waiting to register), `universe`, and `fixture` (the picked fixture mode's channels and ranges). Version 1 files (angles, 0–1 intensity, hex color, beam degrees) still load.

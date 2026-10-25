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

The terminal runs the **show server**: it holds the show, runs the fades and sends DMX to the interfaces. The app in your browser is a view of it, so closing, reloading or hiding a tab never affects the lights. The **Server · live** pill in the page header (top bar) turns green while the console is connected to it (**Server · offline** while it reconnects).

| Command | Does |
|---|---|
| `./server.sh` | this computer only, port 8080 |
| `./server.sh 9000` | another port |
| `./server.sh --lan` | also let other computers on the network open the console (see [Running from another computer](#running-from-another-computer)) |
| `./server.sh --fake-dmx` | pretend a DMX USB Pro is connected (the terminal prints what would be sent) |
| `./server.sh --no-open` | don't open a browser |

If a page ever looks out of date after an update, press **⌘⇧R** (hard reload).

---

## 2. Quick start: your first fixture and cue

1. **Size the stage.** In the Stage's header, set **Box W / D / H** (width, depth, height in meters) to your space.
2. **Place a fixture.** Click **+ Place fixture** (or press `A`).
   - Choose a **console type**: *Movable · Multi-color* gives a moving light with color; *From fixture library…* lets you pick a real fixture (see [Real fixtures](#real-fixtures-from-the-fixture-library)).
   - Click **Place…**, then click where it goes: on the ceiling, a wall or the floor in the 3D view, on the ground outside the box, or anywhere in the plan.
3. **See it in the console.** The console now has a fixture for it on its *Fixtures* page, and faders patched to its channels and named after it, e.g. *Fixture 4 Dim*, *Fixture 4 Pan* (the fader rows scroll to them). They start at the fixture's current values.
4. **Move a fader** in the console's **Cue 1**: the fixture on the stage changes with it (brightness, direction, color, beam width).
5. **Or adjust the fixture on the stage:** select it and use `+` / `−` (dimmer), the arrow keys (pan / tilt), `[` / `]` (zoom), or the sliders in the inspector. Its faders in the console follow.
6. **Point it somewhere:** press `T` and click a spot on the floor; the fixture swings to aim at it.
7. **Make a second look:** set up **Cue 2** (click its row to make it live, move its faders), then go back to **Cue 1**.
8. **Run the cue:** press **GO**. The console transitions from Cue 1 to Cue 2 over Cue 2's **In** time, and you watch the stage fade with it.
9. **Connect your DMX interface** (optional): plug it into the computer running `./server.sh`, click **Connect DMX** in the page header (top bar) and choose **DMX USB Pro**, or pick an Art-Net node from the same menu (see [Network DMX](#network-dmx-art-net--sacn)).
10. **Save:** everything autosaves on the show server. To keep a file, use **Save show** in the page header: it holds the whole show, console and stage.

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
- **The page header** (top bar) holds the console's show controls, in every view: the show's name (click it, or **⋮ → Rename**, to rename it), **New show**, **Save show**, **Load show**, the universe count and the **DMX output** button(s), the **Server** pill, and the console's latest status message (empty until something happens, like a save or a DMX connect; **Show server offline — reconnecting…** in red if the server goes away). The two panes keep their own title bars, **Stage** and **Console**.

### Running from another computer

Start the server with `./server.sh --lan`. The terminal prints a **remote** address with a `token=` on the end; open that address on the other computer (same network). It opens the app (console and stage); use the Console / Both / Stage switch to show just one. Any number of app windows can be open at once, here or elsewhere: each is the whole app, they all show and edit the same show, and a move on one appears on the others (its stage included). The DMX interfaces stay plugged into the server's computer. Other computers can't connect without the token, which changes each time the server starts.

---

## 4. The Stage

### The stage area

- **Box W / D / H** in the header set the size of the performance area in meters.
- The **amber line** marks the audience edge. *Stage left / right* are from the performer's point of view, facing the audience.
- **⚙ View** opens view settings: tick which sides of the box are **transparent** (see-through, so you can see fixtures placed beyond them) or untick for solid. The floor is always solid, and the walls nearest you always stay see-through so you can look in. Beams always show where they land, even on a transparent side.

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

1. Click **+ Place fixture** or press `A`.
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

A new fixture starts pointing at the center of the stage floor. You can have up to 32 fixtures.

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

- **Click** a fixture in the 3D view, the plan or the fixture list to select it. **⇧-click** adds or removes fixtures from the selection.
- `Tab` / `⇧Tab` steps through the fixtures. `Esc` clears the selection.
- Keys and most actions apply to **every selected fixture**.

### Moving fixtures

- **Drag** a fixture in the 3D view to slide it around at its height; **⇧-drag** to raise or lower it.
- **Drag** it in the plan; in the Front / SR / SL views dragging also changes its height.
- Hold `⌥` while dragging for fine steps (1 cm instead of 10 cm).
- Or type exact numbers in the inspector's **Position** (x / height / z, in meters).

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

Change them with the keys, or the sliders and numbers in the inspector (each color channel has a thin upright strip between its name and slider in the color it controls, like the console's color faders; the color rows follow the fixture's channel order, like its console faders; channels a linked fixture doesn't have — e.g. pan and tilt on a fixed light — are dimmed and can't be changed; a library fixture's channels the stage doesn't draw — strobe, dimmer curve, fan, fine channels, … — are under **Other channels**, whose sliders set those channels in the console, with nothing changing on the stage):

| Key | Does |
|---|---|
| `+` / `−` | dimmer up / down |
| `←` / `→` | pan left / right |
| `↑` / `↓` | tilt up / down |
| `]` / `[` | zoom wider / narrower |
| hold `⇧` | steps of 10 instead of 1 |
| `H` | **Home**: pan and tilt back to 128 |

The inspector's **Color** picker (and **color** in the key strip) sets the fixture's color channels together — mixed onto every color channel it's linked with (see [Mixing onto extra emitters](#mixing-onto-extra-emitters)), or red, green and blue when it has none (see [The color picker](#the-color-picker); its second row, **On stage**, shows the colors of the fixtures on the stage). **Ranges** set what the ends mean for that fixture: how far pan and tilt go (± degrees) and the beam angle at zoom 0 and 255.

#### The color picker

The console's color bars and the stage's color pickers all open the same picker (`shared/color-picker.js`) instead of the browser's own:

- **Wheel:** hue around the edge, saturation toward the center. Click or drag. It picks at full brightness; the dimmer sets how bright the fixture is.
- **Swatches:** common lighting colors (warm white, white, cool white, amber, orange, red, pink, magenta, UV, blue, cyan, green), then a row of colors already in use (**In use** in the console, **On stage** on the stage).
- **R / G / B and hex:** the color's 0–255 values; type in them to set a color exactly. On a fixture with extra emitters these are the color you're asking for, not the faders' values (see below).

Every change applies straight away. Click anywhere outside the picker, or press `Esc` or `Enter`, to close it. That click only closes the picker, so nothing under it is clicked (the fixture stays selected). While it's open, keys go to the picker, not the stage or console.

#### Mixing onto extra emitters

Some fixtures have more than red, green and blue: deep red, white, amber, lime, cyan, indigo, UV. The picker still picks one color, and `shared/color.js` works out the level of every emitter the fixture has so the mix **is that color** (accurate color, not "everything up"). Each emitter is treated as the color it gives at full (white = equal red, green and blue; deep red ≈ a darker red leaning toward crimson; amber ≈ red with some green; lime ≈ green with some red; cyan = green and blue; indigo ≈ blue with a little red), and they take their share in order:

1. **White** takes the part red, green and blue have in common.
2. **Deep red**, **amber**, **lime**, **cyan** and **indigo** take as much of what's left as they can — the one nearest in hue first, so a crimson goes to deep red, an orange to amber, a yellow-green to lime, a sea green to cyan and a violet to indigo. Plain red stays on red.
3. **Red, green and blue** make up the rest.

So white on an RGBW fixture is the white channel alone, a warm white is white plus amber, and a fixture with only red, green and blue gets the picked values exactly, as before. **UV isn't mixed** — it's barely visible — so it stays on its own fader and the picker leaves it alone. The color shown (color bars, the stage's beams) is worked out the other way round, from all the emitters, UV included. The emitter colors are general values; real LEDs differ a little by manufacturer.

Library fixtures get these roles from their channels automatically (warm and cold white count as white; a channel named *Deep Red* is deep red, since the library calls it just red). Fixtures placed before the extra emitters were supported pick them up the next time the stage and console are open together. If a fixture has two channels of one kind (e.g. *Deep Red* and *Red*), they move together: the picker sets both, and on the stage the first is the color (the inspector lists both channels on its row); changing that color on the stage sets the second too, while moving just one fader in the console leaves the other alone.

**The keys bar** along the bottom of the 3D view works with the mouse too: click any key in it to do what that key does (**hold** an arrow, `+`/`−` or `[`/`]` to repeat; **⇧-click** for steps of 10). A key goes dim, and a held key stops, once the selected fixtures reach 0 or 255 in that direction (or when nothing is selected); the keyboard keys stop there too. It also has a **color** picker that sets the color of the selected fixtures.

### Aiming

- **Aim at spot** (`T`): select one or more fixtures, press `T`, and click a spot on the floor, a wall or the ceiling (or in the plan). Every selected fixture points at it. Great for focusing several fixtures on one spot.
- **Each fixture has its own "zero"**: the direction it points at pan / tilt 128, and which way is "up" for it. It's shown as a dashed cyan line on the selected fixture.
  - **Set zero here** (`Z`): make the current direction the new zero.
  - **Aim zero at stage**: point the zero at the center of the stage.
  - Fine-tune it as yaw / pitch / roll in the inspector's **Zero frame** (roll matters for fixtures hung upside down).
- The inspector's readout tells you which wall the beam's center hits, where, and how far away.

### Rigs: circles, squares and lines of fixtures

A **rig** is a group of fixtures in a fixed arrangement that you place and move as one:

| Rig | Fixtures are | They point |
|---|---|---|
| **Circle** | evenly around a ring | at its center |
| **Square** | evenly around its edges | at its center |
| **Line** | evenly along a bar | all the same way (down, when flat) |

1. Click **+ Place rig**. Choose the type, its **size** (diameter, side or length), how many **fixtures**, **tilt** (0 = flat / hanging, 90 = upright facing the audience; for a line, −90 points it at the audience), **yaw** (rotation), and the **console type** (generic or from the fixture library) and universe.
2. Click **Place…**, then click where the rig's center goes.

Working with a rig:

- All its fixtures are selected after placing, so the keys move them all together (e.g. `⇧↓` tilts every fixture down evenly).
- Click one fixture to adjust just it; **Select whole rig** (inspector or right-click) selects them all again.
- Dragging any of its fixtures moves the whole rig.
- The inspector's **Rig** section changes the rig's position, size and number of fixtures, and its **tilt** (−90…90°) and **yaw** (−180…180°) with sliders; the fixtures rearrange live.
- In the console, a rig's fixtures are grouped under the rig's name.

### Flash

Hold `F` (or the **Flash** button) to show the selected fixtures — or all fixtures if none is selected — at **white, full**, for as long as you hold it. It's a preview only; it doesn't change anything in the console.

### Copy, delete, undo

- **Duplicate** (right-click or inspector) copies the selected fixtures. If the original was set up in the console, the copy gets its own console fixture and faders too.
- **Delete** (`⌫` or `Delete`, right-click, or inspector) removes the selected fixtures. Deleting a fixture in a rig removes the whole rig. Fixtures the stage set up in the console are removed there too, and their faders freed.
- **⌘Z** brings back what you deleted (up to 50 times, in any stage window, even after a reload).

### The right-click menu

Right-click a fixture (3D view, plan or list) for: **Aim at spot…**, **Home**, **Set zero here**, **Aim zero at stage**, **Select whole rig**, **Flash**, **Duplicate** and **Delete**. Shortcut keys are shown beside each item.

### The inspector

The stage's right-hand panel has three parts: **Plan**, **Fixtures** and **Inspector**. Click the arrow beside a heading to collapse or expand that part. Drag the divider under **Plan** to make the plan smaller or larger, and the one under **Fixtures** to make the list shorter or taller; the inspector gets the rest. Double-click a divider to reset it. The browser remembers which parts are collapsed and the sizes you dragged. The fixture list and the inspector scroll on their own, with their headings pinned.

The inspector, at the bottom, shows the selected fixture:

- **Name**, **Position**.
- **DMX values** (Dimmer … Zoom) with what each means (%, degrees). If the fixture is linked to the console, each also shows its **channel and fader** (e.g. `12 F12`).
- **Color**, **Ranges**, **Zero frame**, and the beam hit readout.
- **Console link**: which console fixture it's connected to (see [Console and Stage together](#6-console-and-stage-together)).
- **Rig** settings for rig fixtures.

With several fixtures selected (for example a whole rig) it shows **Dimmer**, **Zoom** and **Color**, which set every selected fixture at once. The sliders start at the selection's average. Zoom is the 0–255 value; each fixture turns it into a beam angle using its own **Ranges**.

The small overlay in the 3D view's top-left corner (the **HUD**) shows the selected fixture's main values at a glance.

---

## 5. The Console

### Pages

Switch with the tabs along the top. **Drag a tab** left or right to reorder them (a line shows where it will land): the order is saved with the show, so every console showing it has the same tabs, and a show file brings its order back (**New show** starts with the default, Show · Set · Run · Channels · Fixtures · Patch). Each browser reopens on the tab it last had open:

| Page | What it's for |
|---|---|
| **Show** | every song in the show: add, rename (click the name), reorder (drag **⋮⋮**; a line shows where it will land), and **⋮** to **Duplicate** (a copy, *“… copy”*, right after it) or **Delete** it; each song says which sets it's in; click a song to play it |
| **Set** | build a set (the running order for one event) from the show's songs, and choose which set the Run page runs (see [Sets](#sets)) |
| **Run** | runs the active set: the song playing and where it is in the set, its cues, GO, and the faders |
| **Channels** | meters showing every DMX channel's output, and the live cue's faders |
| **Fixtures** | your lighting fixtures and the DMX channels each one uses |
| **Patch** | which DMX channels each fader controls |

### Songs and cues

- A **song** holds as many **cues** as you like (at least 2). Each cue is one look: a value for every fader.
- Cues are numbered by their place in the list (**Cue 1**, **Cue 2**, …) and renumber themselves when you add, remove or reorder them. Each cue also has a name, shown after its number (*Cue 3: Chorus*). Until you give it one, a dim *name* placeholder shows there. Double-click the title to edit the name; the number stays put. Clear the name to remove it.
- One cue is **LIVE** (on stage now) and the one after it is **UP NEXT**. Their cards say so at the top right. **GO** runs the **transition** from LIVE to UP NEXT: a fade lasting UP NEXT's **In** time. When it finishes, that cue is live and the following one is up next (after a song's last cue, that's the next song in the set: see [Sets](#sets)). **Pause / Resume** a transition, or use the blend fader to crossfade by hand. The **◀ / ▶** buttons either side of GO make the previous / next cue LIVE at once, with no fade (the same as clicking that cue). They carry on across songs in the set's order: ▶ on a song's last cue goes to the next set song's first cue, ◀ on its first cue to the previous set song's last cue. They stop at the ends of the set.
- Each cue's **In** time is the length of the transition *into* that cue: pick 0–20 s from its menu (0 = a snap).
- Click a cue's row to make it LIVE. Use its **⋮** menu to name, duplicate or remove it (**Duplicate** puts a copy right after it and makes the copy LIVE), **⋮⋮** to drag it (a line shows where it will land), and **+ Add cue** (at the right of the song bar) to add a new cue at the end.
- You can have up to 32 songs.

### Sets

The **show** holds every song. A **set** is the running order for one event (*Brooklyn 11/2*): a list of the show's songs. A show can have many sets (up to 32); a new show starts with one, **Set 1**, holding its song.

- **Build a set on the Set page.** Pick the set at the top (**⋮** for **New set**, **Rename**, **Duplicate** or **Delete**). The show's songs are on the left (type in **Find a song** to narrow them). Drag one into the running order on the right (a line shows where it will land), or press its **+** to add it at the end. Drag songs in the running order to reorder them; press **✕**, or drag one back onto the show's songs, to take it out. A song can be in a set more than once (a reprise); the show's list says *in this set ×2*.
- A set lists the show's songs, not copies: change a song's cues and it changes in every set. Deleting a song from the show takes it out of every set (it asks first).
- **Run a set.** **Run this set** makes it the **active set**: the Run page runs it from its first song. Clicking a song in the running order runs the set from that song.
- **On the Run page**, the bar at the top shows the song playing and *song 3 of 12*, with **◀ / ▶** for the previous and next song in the set, and the running order as a list to the left of GO (the song playing is highlighted, the next one dashed; click one to play it; a long set scrolls, with a scrollbar while the pointer is over the list).
- **GO runs on into the next song.** On a song's last cue, UP NEXT is the next set song's first cue (*Ballad · Cue 1*); GO transitions to it and the Run page moves to that song. On the set's last song's last cue, UP NEXT says **End of set** and GO does nothing.
- **Songs not in the set.** Clicking a song on the Show page plays it even if it isn't in the active set (it shows *Playing · not in set*, and the Run page *Not in Set 1*). Its last cue goes back to its first, as a song on its own does.

### Faders

- There are **256 faders**, F1–F256. Each row of faders scrolls sideways (trackpad or ⇧ + mouse wheel over any row, or the one scrollbar along the bottom of the cue area, shown while the pointer is over the cues); the Live strip and every cue row scroll together, so everything stays lined up. The console uses the full width of its window (or its side of the divider), so a wider window shows more faders at once, and more channel meters per row on the Channels page.
- The **Live** row shows what each fader is actually putting out after the submasters, the blend and the Master.
- A fader only does something once it's **patched** to a channel; unpatched faders are grayed out.
- **Rename** a fader by right-clicking it (or on the Patch page). Fixtures placed on the stage name their faders automatically.
- **Blackout / flash (dimmer faders):** each fader that controls a fixture's dimmer has two small buttons under it, next to any color bar. Hold **B** to black that fixture out (output 0); hold **F** to flash it at full **and white** (its red, green and blue — and any deep red, white, amber, lime, cyan or indigo channel — go to full too; UV doesn't; pan, tilt and zoom stay where they are). Both last only while held. They change only what's sent out — the fader and your cues aren't touched — and the stage shows the result. (Fixtures placed from the stage are recognized automatically; for your own, name the fader ending in *Dim*, *Dimmer* or *Intensity*.)
- **Fixture outlines:** each run of side-by-side faders that controls one fixture has a colored line around it, labeled with the fixture's name (neighboring fixtures get different colors), and a little space after it so fixtures stand apart. They appear on the Live strip, every cue and the Channels-page strip, and update when you change the patch.
- **Color fader strips:** each fader in a color bar's group has a thin strip along its bottom in the color it controls (red, amber, lime, indigo, …), so you can tell the emitters apart at a glance.
- **Color bars:** when faders side by side control the **color channels** of the same fixture — red, green and blue, plus any deep red, white, amber, lime, cyan, indigo or UV — a color bar appears under them showing their mix. In a cue (or the Channels-page strip), **click the bar** to pick a color: all of them are set at once (you can still fine-tune each one), mixed as described in [Mixing onto extra emitters](#mixing-onto-extra-emitters). The color picker is the same one the stage uses (see [The color picker](#the-color-picker)); its second row, **In use**, shows the colors on the console's color bars. On the Live strip the bar just shows the color going out. This works for fixtures placed from the stage (including library fixtures); for fixtures you add yourself, name the faders ending in *R / G / B* (or *Red / Green / Blue*), and any extras *W / A / L / C / I / UV* (or *White / Amber / Lime / Cyan / Indigo*).
- **Pan / tilt pad:** when a fixture has both a **pan** and a **tilt** fader, a small **✥** pad appears under them in each cue (and on the Channels-page strip). **Hold the mouse button on it and move the mouse:** left / right changes pan, up / down changes tilt. Hold **⇧** for fine moves. The pointer is hidden while you hold, so you can keep moving without running off the pad; let go to stop. (Fixtures placed from the stage are recognized automatically; for your own fixtures, name the faders ending in *Pan* and *Tilt*.)

### Master and submasters

- **Master** scales everything that goes out.
- The two **submasters** scale the LIVE and UP NEXT cues before they're blended.

### Fixtures

The Fixtures page lists your fixtures. Each has a **DMX start channel and channel count** (up to 64 channels), a type (**Fixed / Movable**, **Single / Multi-color**) and an optional **group**. Fixtures placed on the stage add themselves here; you can also add your own.

### Patch

The Patch page connects **faders to DMX channels**. A fader can drive several channels, each with a **max** (the level the channel gets when the fader is full). **1:1** patches fader 1 to channel 1, fader 2 to channel 2, and so on. When two faders drive the same channel, the higher one wins ("HTP").

### Connecting to your fixtures

Plug your Enttec DMX USB Pro into the computer running the show server, click **Connect DMX** in the page header and choose **DMX USB Pro**; the server finds it. The button turns green and reads **DMX · USB**, and the status message in the header shows when it's connected. (For a network node instead, see [Network DMX](#network-dmx-art-net--sacn).) The server remembers the device: after a restart, or if it's unplugged and plugged back in, it reconnects by itself. **DMX USB Pro → Disconnect** in the same menu makes it forget. (For more than one universe, see [Multiple universes](#7-multiple-universes).)

---

## 6. Console and Stage together

The page always has both open side by side, so they're always linked.

### Fixtures set themselves up in the console

When you place a fixture with a console type, the console automatically:

1. adds a **fixture** for it at the next free DMX channels (in the universe you chose),
2. gives it **one fader per channel**, **named after the fixture**: a fader already patched to just that channel and still unnamed (e.g. after *Patch 1:1*) is reused, otherwise a free fader is patched to it,
3. sets those faders to the fixture's current values, so nothing jumps, and
4. scrolls the fader rows to them and highlights them while the fixture is selected on the stage.

If there aren't enough faders or channels, the fixture stays on the stage only and a message (shown for 15 s) tells you why; it isn't linked, so changing it on the stage doesn't reach the console. If the console isn't open yet, the fixture waits and sets itself up as soon as the console opens.

To set up a fixture that's already on the stage, use **Register** in its inspector's *Console link* section.

### Finding a fixture's faders

Select a fixture on the stage (click it, or `Tab` to it) and the console's fader rows **scroll to its faders** and highlight its outline for as long as it stays selected, so you can grab them straight away. Selecting something else moves the highlight; clicking empty space clears it. This works for fixtures linked to the console.

### Staying in sync

- **Console → Stage:** faders, cues fading, the blend, submasters and Master all show on the stage as they happen.
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
| a **channel** (console Channels-page meter, or a channel badge in the stage inspector) | the faders feeding it (and which one wins) → what it drives |
| a **fixture** (console Fixtures page) | each of its channels, its value, what it does on the stage, and the fader driving it |
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
- On the Channels page, a switch picks which universe the meters show.
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

**Everything autosaves** as you work, on the show server (`server/data/session.json`): the console's show and the stage. Closing and reopening the page, restarting the server, or opening the show in another browser or from another computer brings it all back. (Each browser also keeps a copy of the stage, so it shows straight away; the server's copy replaces it as soon as the page connects. Edits made while the server is unreachable are sent when it's back.) Stage windows keep each other up to date, in any browser: an edit in one (placing, moving, renaming, deleting a fixture…) shows in the others within a moment, so no window's later save undoes another's work. A fixture being registered stays the job of the window that placed it. ⌘Z after a delete works in any stage window (the undo list is saved with the stage, so it also survives a reload).

To keep copies, share them or move to another computer:

- **Console** (buttons in the page header): **Save show** downloads the show (songs, sets, cues, patch, fixtures, fader names, universes, tab order) as a file; **Load show** opens one; **New show** starts fresh (it asks first if you have unsaved changes). Click the show's name beside the title (or **⋮ → Rename**) to rename it.
- The show file also holds the **stage** (box size, fixtures, rigs, view settings), so one file is the whole show. Loading a show file that has a stage replaces the stage; one saved without it (the show server was offline) leaves the stage as it is. **New show** keeps the stage.

---

## 9. Reference: keys and mouse

### Stage keys

| Key | Action |
|---|---|
| `←` `→` | pan (`⇧` ×10) |
| `↑` `↓` | tilt (`⇧` ×10) |
| `+` `−` | dimmer (`⇧` ×10) |
| `]` `[` | zoom wider / narrower (`⇧` ×10) |
| `H` | Home (pan / tilt to 128) |
| `T` | Aim at spot |
| `Z` | Set zero here |
| `F` (hold) | Flash |
| `A` | Place fixture |
| `Tab` / `⇧Tab` | next / previous fixture |
| `⌫` / `Delete` | delete selected |
| `⌘Z` | undo delete |
| `Esc` | close menu / cancel / clear selection |

Keys are ignored while you're typing in a field (press `Esc` or `Enter` to leave it) or while a dialog is open. The keys shown in the bar under the 3D view can also be clicked (hold to repeat, ⇧-click for ×10), and the bar has a color picker for the selected fixtures.

### Stage mouse

| Where | Action |
|---|---|
| 3D: drag empty space · scroll · right-drag | orbit · zoom · pan the camera |
| 3D: click / ⇧-click a fixture | select / add to selection |
| 3D: drag a fixture · ⇧-drag | move it · change its height |
| Plan: drag a fixture | move it (`⌥` for fine steps) |
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
| **Set** | the running order for one event: a list of the show's songs; the Run page runs the active set |
| **LIVE / UP NEXT** | the cue on stage now / the cue GO will transition to |
| **Master / submaster** | faders that scale everything / one cue |
| **Fixture** | a lighting unit; on the console it owns a block of channels |
| **Mode** | one of a real fixture's channel layouts (e.g. 5-channel or 14-channel) |
| **Rig** | a group of fixtures arranged in a circle, square or line |
| **Zero** | the direction a fixture points at pan / tilt 128 |

---

## 12. For developers

Plain HTML / JavaScript, no build step. `./server.sh` installs the npm dependencies (`serialport`, `ws`) when needed and runs `node server/server.js`, which serves the pages on port 8080 with caching off. Open the folder in IntelliJ as a Web module; `console/jsconfig.json` sets up JavaScript checking for the console files.

The console and the stage are one app: anything both use (and the page header, or the server) lives in `shared/`, so there's one copy of it.

| Path | What's in it |
|---|---|
| `index.html` | The app — the only page: the stage's and the console's markup in two panes, the Console / Both / Stage switch, ⇄ swap, divider, the header with the console's show name, show buttons, DMX outputs and status (it calls `consoleHeader` in `console/app.js`), and the import map for three.js |
| `page/page.js`, `page.css` | The app's header, panes, show menu and DMX output menu, and their styles |
| `server.sh` | Starts the show server (installs dependencies first if needed) |
| `server/server.js` | Show server: serves the pages, WebSocket at `/ws`, 40 Hz fade / DMX loop, saving |
| `server/show.js` | The show as the server holds it: songs and sets, live mix, timed fades (GO runs on into the next set song), held flash / blackout |
| `server/dmx.js` | Enttec DMX USB Pro output over USB serial (one universe per device, remembered by serial number); one frame in flight per device, so a slow link drops frames instead of falling behind |
| `server/net-dmx.js` | Art-Net and sACN output over UDP (kept in `server/data/network.json`), Art-Net node search, sACN stream-terminated on stop |
| `server/data/` | `session.json` (the show, with the stage under `stage`), `dmx.json` (which device is on which universe) and `network.json` (Art-Net / sACN outputs, optional); not in git |
| `console/styles.css` | Console styles, scoped to its pane (`:where(#consolePane)`; breakpoints are container queries on the pane) |
| `console/app.js` | Starts the console and wires its controls; show new / load / save, universes and DMX outputs, fixtures placed on the stage, the page header's hooks, the show-server link |
| `console/state.js` | The console's state (the show being worked on, the active set and song, the song's cues, status), shared by its modules |
| `console/dom.js` | The console's elements (in its pane of `index.html`) |
| `console/live.js` | Output levels, Live strip and channel meters, LIVE / UP NEXT, GO, crossfade, submasters, master |
| `console/faders.js` | Fader names and menu, and what's drawn on fader rows (color bars, pan / tilt pads, blackout / flash buttons, fixture outlines) |
| `console/show-page.js` | Show page: the song list |
| `console/set-bar.js` | Run page set bar: the song playing, *song 3 of 12*, ◀ / ▶, the running order |
| `console/set-page.js` | Set page: building sets by drag and drop, picking the active set |
| `console/cues.js` | Run page: the cue rows with their menus |
| `console/patch-page.js`, `fixtures-page.js` | Patch and Fixtures pages (and the channel / count / group pickers) |
| `console/nav.js` | Page tabs: show name, tab order, routing |
| `console/server-link.js` | Console side of the show-server link |
| `console/patch.js` | Fader patch; the show's universe count (channel addresses for the current show) |
| `console/fixtures.js`, `show.js`, `songs.js`, `sets.js` | Fixtures, show save / load, songs and cues, sets (and what's UP NEXT across set songs) |
| `console/stage-link.js` | Console side of its link with the stage |
| `stage/stage.css` | Stage styles, scoped to its pane (`:where(#stagePane)`; breakpoints are container queries on the pane) |
| `stage/stage.js` | Starts the stage; keeps up with other app windows and the show server; ⌥-click traces |
| `stage/state.js` | The stage's data (box, fixtures, rigs, selection), saving it, rig helpers, and what the page is in the middle of (placing, aiming) |
| `stage/view3d.js`, `plan.js` | The 3D view and the plan view, with their mouse handling |
| `stage/sidebar.js` | Fixture list, inspector and key strip |
| `stage/panel.js` | Side panel layout: collapsing Plan / Fixtures / Inspector, and the dividers between them |
| `stage/actions.js`, `keys.js` | Select, place, aim, flash, right-click menu, duplicate, delete / undo; keyboard |
| `stage/dialogs.js` | Box size, View settings, Place rig and Place fixture dialogs |
| `stage/link.js` | Linking stage fixtures to console fixtures and channels, and registering them in the console |
| `stage/stage-model.js` | Fixture and rig data, DMX values ↔ angles / color / beam, aiming math, save format |
| `stage/console-link.js` | Stage side of its link with the console |
| `stage/show-link.js` | Stage side of the show-server link: keeps the stage with the show |
| `stage/fixture-library.js` | Open Fixture Library browsing, picker, fixture mode → channel profile |
| `shared/engine.js` | Output math (crossfade / master mix, HTP per channel, fade ease), used by the console and the server |
| `shared/trace.js` | The ⌥-click trace card (one, shared by the console and the stage; each registers what it knows) |
| `shared/color-picker.js` | The color picker (wheel, swatches, R/G/B; one, shared by the console and the stage) in place of the browser's |
| `shared/theme.css` | The look of the whole app: colors, fonts and type scale (`--text-2xs` … `--text-2xl`, used for every font size), title bars, thin scrollbars (`.thin-scroll`), and the styles of the shared dialog, color picker and trace card; loaded by the app page |
| `shared/ask.js` | The confirm / name dialog (new show, new song, remove …), used by the console and the page header |
| `shared/server-socket.js` | The window's one WebSocket to the show server (token, reconnecting), shared by the console and the stage |
| `shared/console-stage.js` | The console ↔ stage link inside the page: what each side may call on the other |
| `shared/panes.js` | Which pane you're working in (the stage's keys only act there) |
| `shared/live-fields.js` | Which show fields change while playing, used by the server and the console |
| `shared/address.js` | Universes and channel addresses (`2/45` ↔ 557) |
| `shared/attributes.js` | Fixture attributes (dimmer, pan, tilt, red, green, blue, zoom) and their names |
| `shared/color.js` | Hex ↔ R/G/B, and mixing a color onto a fixture's emitters (red, green, blue, deep red, white, amber, lime, cyan, indigo, UV) and back |
| `shared/numbers.js`, `html.js`, `ids.js` | Small helpers: clamping to 0–255 and ranges, escaping text for HTML, new ids |

### How it all talks

```
   browser (this computer or another one)            show computer
  ┌──────────────────────────────────────┐        ┌──────────────────────────┐
  │  the app (one page)                  │  /ws   │  show server             │
  │    console ──┐   ┌── one connection ─┼◀──────▶│  (server/server.js)      │    USB    ┌───────────────┐
  │              │ in-page link          │        │   · holds the show       │──────────▶│ DMX USB Pro   │──▶ lights
  │    stage   ◀─┘   │  (both use it)    │        │   · runs fades, 40 Hz    │  (one per │ (per universe)│
  │                                      │        │   · saves session.json   │  universe)└───────────────┘
  │                                      │        └──────────────────────────┘
  └──────────────────────────────────────┘
```

There are three links; the first two share the window's one WebSocket (`shared/server-socket.js`), and each side ignores the other's messages. The **show server** is the one that counts: it holds the show, runs the fades and drives the DMX interfaces, so closing or backgrounding a browser tab never affects the lights. Every app window is a view of it, and windows keep each other in step only through it.

#### 1. Console ↔ show server (WebSocket `/ws`)

`console/server-link.js`, over `shared/server-socket.js`.

- **Connecting.** The server answers with `hello`: the show, the stage, the live mix (master, submasters, crossfade, LIVE and the selected cue, whether a transition is running, held flash / blackout faders) and the DMX status. An empty server (first run) takes the first console's show (`seed`).
- **Console → server: only what changed.**

  | Message | When |
  |---|---|
  | `show` | the show's structure changed (the whole show) |
  | `levels` | single fader cells, while dragging |
  | `live` | live fields (`shared/live-fields.js`) |
  | `hold` | flash / blackout buttons held |
  | `go` / `pause` / `stop` | transport |
  | `stage` (`file`) | a show file with a stage was loaded |
  | `dmx-connect` / `dmx-disconnect` / `get-stage` | requests, answered with a `reply` |

- **Server → consoles.** Each edit is passed on to the other consoles. `live` is sent on every fade step (and `show`, to every console, when GO arrives on the next set song), and `dmx` whenever the output status changes.
- **No jitter while dragging.** A value just changed on a console wins over the server's broadcasts for 0.6 s.
- **Dropped connection.** The console retries every second. Held flash / blackout buttons are released. Edits made while disconnected aren't sent: on reconnecting, the console takes the server's show.

#### 2. Stage ↔ show server (the same WebSocket)

`stage/show-link.js`, over `shared/server-socket.js`. This keeps the stage (box, rigs, fixtures) with the show, so it's in the show file and the same on every computer.

- **Connecting.** `hello` carries the server's stage. The stage sends its own instead if the server has none yet, or if it was edited while it couldn't reach the server.
- **Edits.** After an edit made on the stage, it sends the whole stage (`stage`), and the server passes it on to the other app windows' stages. Values that only followed the console aren't sent; the console already has them.
- **Show files.** A console's **Save show** asks for the stage (`get-stage`) to put it in the file; **Load show** sends a file's stage to the server, which passes it to every window's stage, the loading window's too.
- **What the stage uses.** Only `hello`'s stage and `stage` messages: the show and fades reach it through its own console (see 3).
- **Each window keeps its own values for linked channels** when it takes another window's stage (those follow its own console). The stage is also kept in this browser (`localStorage`, `unnaturallight.stage`), so it opens straight away and works with the server offline.

#### 3. Console ↔ stage (inside the page)

`console/stage-link.js` ↔ `stage/console-link.js`, over `shared/console-stage.js`. The console and the stage are one page, so this link is always there: there's no "console offline", no tab to reopen, and nothing between browser tabs. Each app window has its own console and stage; other windows follow through the show server (links 1 and 2). Each side joins the link with the functions the other may call; a call runs as soon as the caller's current update is done.

- **Console → stage: `levels`.** Output levels for every universe, which faders feed each channel, and the console's fixtures. It's called on every output change, and when the stage starts (its `hello`).
- **Stage → console:**

  | Call | What |
  |---|---|
  | `set` | set channel N to V |
  | `register` / `unregister` | for fixtures it places or deletes (the console answers with the stage's `registered`) |
  | `layouts` | each fixture's console fixture and channel layout, so the console fills in roles a console fixture is missing (e.g. a library fixture's amber) |
  | `select` | which fixtures are selected, so the console highlights them |

- **Hello.** Whichever side starts second gets the other's state at once: the stage's `hello` gets the console's levels, the console's `hello` gets the stage's layouts.
- **Registering once.** A fixture another window placed (it arrives with the stage from the server, still waiting to register) is left to that window, so it isn't registered twice.
- **Smooth drawing.** A value just sent from the stage wins over the console's updates for 0.6 s (e.g. an older copy from the server), so dragging doesn't jitter. The stage redraws only when something changed, and not at all while it's hidden, because it shares the page's one thread with the console.

#### Message reference (WebSocket `/ws`)

Every message is one JSON object with a `type`. Fader indexes are 0-based (0 = F1); cue and song ids are the ones in the show; channels are numbered across universes (513 = universe 2 channel 1).

**Show server → app window** (the console's messages, then the stage's)

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
| `levels` | `cells`: `[cueId, fader, level]` triples | fader cells changed (sent at most once per tick, only the cells that changed) |
| `live` | `live`: only the [live fields](#the-live-object) that changed | master, submasters, crossfade, LIVE or selected cue moved |
| `hold` | `flashing`, `blackedOut`: fader indexes this console holds | a flash / blackout button pressed or let go |
| `go` / `pause` / `stop` | none | GO (fade from the selected cue to UP NEXT); pause / resume the running fade; stop it (a hand move on the crossfade, picking a cue or song, a new or loaded show) |
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

##### The live object

What changes while playing (`show.live()` in `server/show.js`; the field lists are in `shared/live-fields.js`):

| Field | Meaning |
|---|---|
| `master`, `fromSub`, `toSub` | master and the LIVE / UP NEXT submasters, 0–100 |
| `cross` | crossfade, 0 (all LIVE) – 100 (all UP NEXT) |
| `fromCue` | the LIVE cue (index in the active song) |
| `selectedCue` | the selected cue (GO fades from it) |
| `fade` | `null`, or `{ paused }` while a transition runs (server → console only) |
| `flashing`, `blackedOut` | fader indexes held by any console (server → console only) |

UP NEXT isn't sent: each side works it out from LIVE and the set (`upNextCue` in `console/sets.js`). Past a song's last cue it is the index one past the end, meaning the next set song's first cue.

##### The show object

What the console saves and the server holds (`serializeShow` / `parseShow` in `console/show.js`). A saved file adds `version` (1), `app` (`"UnnaturalLight"`), `kind` (`"show"`), `savedAt` and, when there is one, `stage`; a file with another `app` or `kind` is refused.

| Field | Meaning |
|---|---|
| `showName` | the show's name |
| `navOrder` | the console's tab order (`show`, `set`, `run`, `channels`, `fixtures`, `patch`); unknown names are dropped, and a missing tab goes in at its default place (after the tab before it in that list) |
| `universes` | 1–8 |
| `songs` | `[{ id, name, cues: [{ id, name, levels, fadeTime }] }]`: `levels` is 256 fader values (0–255); `fadeTime` is the cue's **In** time, 0–20 s |
| `activeSongId` | the song playing |
| `sets` | `[{ id, name, entries: [{ id, songId }] }]`: each entry points at a song; a song can appear more than once |
| `activeSetId` | the set the Run page runs |
| `activeEntryId` | the entry playing in that set, or `null` (a song played from outside it) |
| `master`, `cross`, `fromSub`, `toSub`, `fromCue`, `selectedCue` | the [live fields](#the-live-object) as last saved |
| `faderNames` | 256 names |
| `patch` | 256 lists of `{ channel, max }`: the channels each fader drives, and the level (0–255) a full fader sends |
| `fixtureGroups` | `[{ id, name }]` |
| `fixtures` | `[{ id, name, mount, color, channelStart, channelEnd, groupId, roles? }]`: `mount` is `fixed` / `movable`, `color` is `single` / `multi`, `roles` says what each channel does (`dimmer`, `pan`, `tilt`, `red`, `green`, `blue`, `deepred`, `white`, `amber`, `lime`, `cyan`, `indigo`, `uv`, `zoom`) |

##### DMX status

`outputs` is one entry per universe: `{ universe, connected, remembered, path, error, network }`. `connected` … `error` are its DMX USB Pro: `remembered` is true when the universe has a device it reconnects to; `path` is the device's serial port, and `error` is the last failure, if any. `network` is its Art-Net / sACN output as text (`"Art-Net 0 → 192.168.1.50"`, `"sACN 2 (multicast)"`), or `null`.

#### DMX output

Every 25 ms (40 Hz) the server steps any running fade, sends `live` to the consoles if something moved, and writes the 512 levels of each universe to its DMX USB Pro (`server/dmx.js`) and its network output (`server/net-dmx.js`; a packet only when the frame changed, or after 1 s). Only one frame is in flight per device, so a slow device never builds up a backlog. Each universe remembers its device's serial number (`server/data/dmx.json`); after an unplug or a restart the same device comes back on the same universe (missing devices are looked for every 2 s). The show is saved to `server/data/session.json` half a second after a change.

#### Other computers

By default the server listens only on this computer (`127.0.0.1`). With `--lan` it listens on the network and prints a **token** (new each start). A WebSocket from another computer without the right `?token=` is refused (403); pages are served without it. The printed remote address is the app with `?token=…`; it keeps the token for that browser tab (session storage, `unnaturallight.token`) before the app starts, and the console and the stage read it from there.

### Other details

**Channel numbering.** Channels run on across universes (universe 2 channel 1 = 513, up to 8 × 512); the UI shows `universe/channel` when there's more than one universe.

**Fixture library.** The Open Fixture Library API only accepts requests from its own site and `http://localhost:8080`; from other addresses the stage reads the library's files on GitHub instead (same data; list names from file names; GitHub limits that to about 60 manufacturer lookups an hour, cached).

**Browser storage.** Console show (a local copy; the server's is the one that counts): `unnaturallight.session`. Remote token: `unnaturallight.token` (session storage). Stage: `unnaturallight.stage`. Combined-page layout: `unnaturallight.shell`.

**Stage (`stage` in the show file and `session.json`).** `box` (`w`, `d`, `h` in m), `transparent` (per side), `rigs` (type, center, yaw, tilt, size, count, console type, fixture, universe) and `fixtures`. Each fixture has its position, `base` (zero frame: yaw / pitch / roll), `dmx` (the 0–255 values), `panLimit` / `tiltLimit` / `zoomMin` / `zoomMax`, `rigId` / `rigIndex`, and `link`: `consoleId`, `start` channel, `layout` (attribute per channel), `owned` (the stage registered it), `type`, `register` (waiting to register), `universe`, and `fixture` (the picked fixture mode's channels and ranges).

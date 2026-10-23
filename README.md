# UnnaturalLight

Two browser pages that work together:

- **Console** — 256 faders, tunes / transitions, an instrument list and a fader → DMX patch, driving an Enttec DMX USB Pro.
- **Stage** — a 3D model of the performance area: place instruments and rigs, and see each beam's cone and where it lands on the floor, walls and ceiling.

They open together in one page, and stay **in sync**: console faders drive the stage's instruments, and changing an instrument on the stage moves its fader.

Plain HTML / JS, no build step. Chrome or Edge (the console uses the **Web Serial API**).

## Run

```bash
./server.sh
```

It opens [http://localhost:8080](http://localhost:8080): the console and the stage in one page. The switch at the top right shows:

- **Console** — just the console
- **Both** — stage on the left, console on the right; **⇄** (left of the switch) swaps the sides. Drag the divider between them to resize (double-click it for 50 / 50)
- **Stage** — just the stage

The page remembers the view, the split and which side each is on. The console keeps running in every view, including **Stage**, where it's hidden behind the stage: GO fades, the link and DMX output carry on.
Keyboard shortcuts go to whichever side you last clicked in.

Each also still opens on its own: `console/console.html` and `stage/stage.html`.

For the console, plug in the DMX Pro, click **Connect DMX Pro**, and pick the serial port.
The stage loads three.js from a CDN (jsdelivr) the first time, so it needs internet access then.

`server.sh` disables caching so **⌘R** reloads HTML/JS/CSS. Restart the server after updating `server.sh`. If an old tab still looks stale, use **⌘⇧R** once (hard reload).

## Files

| Path | What's in it |
|---|---|
| `index.html` | The combined page: console + stage side by side, with the Console / Both / Stage switch and ⇄ swap |
| `server.sh` | Local no-cache web server on port 8080 |
| `console/console.html`, `app.js`, `styles.css` | Console page, logic and styles |
| `console/dmx.js` | Enttec DMX USB Pro output (Web Serial) |
| `console/patch.js`, `instruments.js`, `setlist.js`, `tunes.js` | Patch, instruments, setlist save / load, tunes |
| `console/stage-link.js` | Console side of the live link with the stage |
| `stage/stage.html` | Stage page layout, plus the import map that says where three.js is loaded from (change the version here) |
| `stage/stage.css` | Stage styles |
| `stage/stage.js` | 3D view, plan, instrument list, inspector, keyboard / mouse, autosave |
| `stage/stage-model.js` | No DOM or drawing: instrument and rig data, DMX values ↔ angles / color / beam, zero frame and pan / tilt maths, beam / wall hit test, JSON parse / serialize |
| `stage/console-link.js` | Stage side of the live link with the console |
| `shared/trace.js` | The ⌥-click trace card, used by both the console and the stage |

---

# Console

## Save / Load setlist

**New setlist** asks for a setlist name, then starts blank (one tune with two empty transitions, default masters, empty patch). The name appears beside the title — click it or **⋮** → Rename to edit inline. Saved with the setlist.
**Save setlist** downloads a JSON file with patch, tunes/transitions, master, crossfade, and names.
**Load setlist** restores from a previously saved setlist file. New/Load ask first if the current setlist changed since the last save/load. Older v1 files (flat scenes) migrate into a single tune.

The full setlist also autosaves to `localStorage`, so a refresh restores your last settings without an explicit Save.

## Pages

Drag tabs to reorder; order is saved with the setlist.

- **Setlist** (`#setlist`) — tunes in the setlist: add / rename / remove / drag-reorder; click a tune to open it on Tunes.
- **Tunes** (`#tunes`) — transitions for the active tune. **GO** fades Current → Next (Next’s fade-in time), then advances. Manual blend fader + **Pause** / **Resume**. Each transition has its own **In** time (2–10s). Transition **⋮** menu: rename / remove. Drag **⋮⋮** to reorder. Click a row to set Current.
- **Channels** (`#channels`) — DMX meters for channels 1–256. Bottom strip is the current transition’s faders; click the name to rename, or **⋮ → Select transition** to switch.
- **Instruments** (`#instruments`) — register fixtures with a non-overlapping DMX block (**start** + **channel count**), optional **groups**, plus **Fixed / Movable** and **Single / Multi-color**. Saved with the setlist. The stage links to these (see *Console ↔ Stage*). ⌥-click a row to trace it.
- **Patch** (`#patch`) — wire each fader to DMX channels with per-channel **max** (`fader × max / 255`). Shared across all transitions. Click a fader elsewhere to highlight it here; right-click a fader for **Rename** / **Show in Patch**. On Patch, **Rename** or double-click the title edits inline; **Clear** and **Unpatch all** ask for confirmation.

## Tunes, transitions & fader names

- **Tunes:** up to 32; each has its own reorderable transitions. GO Current/Next stay within the active tune.
- **Transitions:** 2–24 per tune; each has a fade-in time (2–10s) used when GO arrives at it. **+** asks for a name.
- **Faders:** 256, default names **F1–F256**; rename via right-click or Patch. Names are shared across transitions and saved in the setlist.
- **Fader blocks** (Live, each transition, the Channels-page strip) show one row of all 256 faders that **scrolls sideways** (trackpad, ⇧-scroll, or the scrollbar). Scrolling one scrolls the others too, so Live stays lined up with the transitions. The Channels-page meters (1–256) still wrap into rows of 32.
- Setlists saved with 32 faders load as they were; faders 33–256 start at 0 and unpatched.

Faders start unpatched and are disabled until they have channels. Use **1:1 (Fader → Ch)** for a quick default (fader N → channel N, so channels 1–256). Shared channels use **HTP** (highest takes precedence).

**Blackout** (×) takes Master / that submaster to 0%; click again to restore.

## Notes

- Transition submasters scale Current/Next before the blend; Master scales the mixed result. GO uses each transition’s fade-in time to arrive at it.
- Keep the browser tab visible while outputting for the most stable refresh: fades only run while the tab is showing. (In the combined page that covers the console in every view. If you open `console/console.html` and `stage/stage.html` as separate tabs instead, keep the console visible, e.g. in its own window.)

---

# Stage

A box (the performance area) you place instruments and rigs in. Each instrument projects a cone of light, and the box's floor, walls and ceiling light up where the cone hits them.

## Instrument values (0–255)

Every instrument is controlled by DMX-style values from **0 to 255**, the same as a console fader / dimmer channel:

| Value | 0 … 255 means |
|---|---|
| **Dimmer** | off … full |
| **Pan** | −pan limit … +pan limit, relative to the instrument's zero. **128 = zero** (exactly). Higher = turn left |
| **Tilt** | −tilt limit … +tilt limit, relative to zero. **128 = zero**. Higher = tilt up |
| **Red / Green / Blue** | each color component |
| **Zoom** | narrowest … widest beam (the zoom range) |

What the ends mean is set per instrument under **Ranges**: pan and tilt limits (default ±270° and ±135°) and the zoom range (default 5°–60°). Changing a range keeps the 0–255 values and changes the angle they mean, like a real fixture.

With ±270° pan, one step is about 2.1°, so angles (and Aim at spot) land on the nearest step.

A new instrument starts at dimmer 191 (75%), pan / tilt 128, zoom 88 (≈24°), with a color from a palette.

## Keys

| Key | Action |
|---|---|
| `←` / `→` | Pan +1 / −1 (`⇧` = ±10) |
| `↑` / `↓` | Tilt +1 / −1 (`⇧` = ±10) |
| `+` / `−` | Dimmer +1 / −1 (`⇧` = ±10) |
| `]` / `[` | Zoom wider / narrower by 1 (`⇧` = 10) |
| `F` (hold) | Flash: white at full while held (selected instruments, or all if none selected) |
| `T` | Aim at spot: click a spot to point every selected beam at it |
| `H` | Home: pan and tilt back to 128 (zero) |
| `Z` | Set zero here: the current direction becomes the new zero (not for rig instruments) |
| `A` | Toggle place mode |
| `⌫` / `Delete` | Delete the selected instrument(s); a rig instrument deletes its whole rig |
| `⌘Z` (Ctrl+Z) | Undo the last delete (repeatable, up to 50) |
| `Tab` / `⇧Tab` | Select next / previous instrument |
| `Esc` | Close the menu, cancel place / aim mode, or clear the selection |

The keys act on **every selected instrument**, each on its own values.
They're ignored while you're typing in a text or number field (press `Esc` or `Enter` to leave the field) and while a dialog is open.
The keys bar along the bottom of the 3D view lists the always-on controls; the letter keys are shown in the right-click menu.

## Mouse

| Where | Action |
|---|---|
| 3D view: drag empty space / scroll | Orbit / zoom the camera (right-drag, or ⇧ / ⌘ / Ctrl + drag, pans) |
| 3D view: click instrument | Select it (`⇧`-click adds / removes it) |
| 3D view: drag instrument | Slide it around at its current height (snaps to 0.1 m; hold `⌥` for 0.01 m) |
| 3D view: `⇧`-drag instrument | Raise / lower it (height only) |
| 3D view: click empty space | Clear the selection |
| Plan: **Top / Front / SR / SL** | Switch the plan's viewpoint (see *Plan views*) |
| Plan: click instrument | Select it (`⇧`-click adds / removes it) |
| Plan: drag instrument | Move it in that view's two directions (snaps to 0.1 m; hold `⌥` for 0.01 m) |
| Instrument list: click row | Select it (`⇧`-click adds / removes it) |
| Right-click an instrument (3D, plan or list) | Instrument menu (see *Right-click menu*; ctrl-click works too on a Mac) |

Dragging a rig instrument moves the whole rig. The camera position isn't saved.

## Placing instruments

Press `A` or click **+ Place instrument**. First pick its **console type** (remembered for next time):

| Console type | Channels / faders | |
|---|---|---|
| Movable · Multi-color | 7 | Dimmer, Pan, Tilt, Red, Green, Blue, Zoom |
| Movable · Single color | 4 | Dimmer, Pan, Tilt, Zoom |
| Fixed · Multi-color | 4 | Dimmer, Red, Green, Blue |
| Fixed · Single color | 1 | Dimmer |
| Stage only | — | not added to the console |

The light is **registered in the console** (see *Console ↔ Stage → Registering lights*). Then click where it goes:

| Where you click | Where the instrument goes |
|---|---|
| **Plan**, anywhere | Top: at that x / z, 0.3 m below the ceiling height. Front / SR / SL: at that spot, on the centre line. Inside or outside the box. |
| **3D**, a floor / wall / ceiling | On that surface, 0.3 m in from it (inside) |
| **3D**, `⌥`-click a wall | On the **outside** of the nearest wall, 0.3 m out from it |
| **3D**, the ground off the box | Standing on the ground **outside** the box, 0.3 m up |

In 3D a ghost marker shows where the instrument will land: **cyan** = inside the box, **amber** = outside, with a dashed line down to the floor. `Esc` cancels.

The plan shows plenty of room around the box (at least 4 m, or 60% of the box's largest dimension), and grows to include any instrument placed further out.
A new instrument starts with its zero pointing at the centre of the stage floor (or the centre of the box if it sits on the floor).
Instruments outside the box are marked "outside" in the list and the inspector. Up to 32 instruments in total.

## Coordinates

Metres. The origin is the **centre of the box floor**.

| Axis | − | + |
|---|---|---|
| x | stage right | stage left |
| y | floor (0) | up |
| z | upstage | downstage / audience |

Stage left / right is from the performer's view, facing the audience. The amber line marks the audience edge (in 3D and in the Top / SR / SL plan views).

## Zero frame, pan and tilt

Each instrument has its own **zero frame**, so "up/down" and "left/right" mean the instrument's own directions.

- **Zero frame** (`base`): yaw, pitch, roll in degrees, in world space.
  - yaw 0 = facing upstage; +90 = facing stage right.
  - pitch −90 = pointing straight down.
  - roll sets which way counts as "up" for the arrow keys (e.g. a fixture hung upside down).
- **Pan / tilt** (0–255) turn the beam away from the zero direction, 128 = no turn.
- **Home** sets pan / tilt to 128.
- **Set zero here** turns the current direction into the new zero and sets pan / tilt to 128.
- **Aim zero at stage** points the zero at the stage centre and sets pan / tilt to 128.

When an instrument is selected, the 3D view shows a dashed cyan line for its zero direction, a short cyan tick for its "up", and a dashed white line along the centre of the beam.

## Inspector

**One instrument selected:**

- **Name** and **Position** (x / height / z; greyed out for rig instruments).
- **DMX values · 0–255**: Dimmer, Pan, Tilt, Red, Green, Blue, Zoom, each a slider + number. Beside each: what it means (%, ° or beam °) and, when linked to the console, its **channel** and **fader** (green, e.g. `2 F2`) or the channel alone if no fader is patched to it.
- **Color** picker: sets Red / Green / Blue together.
- **Ranges**: pan / tilt ±° and zoom min / max °.
- **Zero frame** (yaw / pitch / roll; greyed out for rig instruments) and the **hit readout**: inside / outside, beam direction, and which wall the centre of the beam hits (or enters and exits), with the point and distance.
- **Console link** (see *Console ↔ Stage*).
- **Rig** section for rig instruments (see *Rigs*).
- Buttons: Flash, Aim at spot, Home, Set zero here + Aim zero at stage (or Select whole rig), Duplicate, Delete (Delete rig).

**Several selected:** a shared Dimmer slider and Color, the Rig section if they're all one rig, and Flash, Aim at spot, Home all, Set zero here (all), Aim zero at stage, Delete all.

The **HUD** (top-left of the 3D view) shows the selected instrument's dimmer, pan, tilt and zoom as 0–255 with their meaning, its red / green / blue, and **FLASH** while flashing.

## Right-click menu

Right-click an instrument in the 3D view, the plan or the list. If it's part of the selection, the menu acts on every selected instrument (Duplicate / Delete show the count); otherwise it selects just that one first.

| Item | Key | What it does |
|---|---|---|
| Aim at spot… | `T` | Click a spot to point the beam(s) at it |
| Home | `H` | Pan / tilt to 128 |
| Set zero here | `Z` | The current direction becomes the new zero (not shown for rig instruments) |
| Aim zero at stage | | Point zero at the stage centre, pan / tilt 128 (not shown for rig instruments) |
| Select whole rig | | Rig instruments only: select every instrument in the rig |
| Flash (hold) | `F` | White at full while the item is held down |
| Duplicate | | Copy, 0.5 m to stage left |
| Delete | `⌫` | Remove (⌘Z to undo); on a rig instrument: "Delete rig", removes the whole rig |

In the 3D view a right-*drag* pans the camera; the menu opens on a right-click without dragging.

## Aim at spot

1. Select the instruments (`⇧`-click; for a rig, **Select whole rig**).
2. Press `T` or choose **Aim at spot**.
3. Click the spot: on the floor, a wall or the ceiling in 3D, or in the plan (Top: a floor spot; Front: the upstage wall; SR: the stage-left wall; SL: the stage-right wall). A white ring follows the pointer, with dashed lines from each selected instrument to it.

Each instrument's **pan / tilt** change so the centre of its beam hits that spot (to the nearest 0–255 step). Its **zero** is unchanged. If the spot is beyond an instrument's limits it aims as close as it can, and a message names it. `Esc` or `T` again cancels.

## Duplicate, delete, undo

- **Duplicate** (right-click or inspector): copies every selected instrument with all its values, named "… copy", 0.5 m to stage left, and selects the copies. Copies are free instruments: not in a rig and not linked to the console.
- **Delete** (`⌫` / `Delete`, right-click, or the inspector): removes every selected instrument. A rig instrument deletes its **whole rig**.
- **⌘Z** undoes the last delete (up to 50 back), putting instruments (and rigs) back where they were, selected. It doesn't undo duplicates or other edits. Undo history is lost on reload.

## Flash

Hold the **Flash** button (inspector or right-click menu) or the `F` key: the selected instruments (or every instrument if none is selected) show **white at full** for as long as you hold it, then return to their own values. A quick tap still flashes for at least 150 ms. Flash is display-only: it never changes the saved values and isn't sent to the console.

## Plan views

The plan (top of the sidebar) has four viewpoints. Switch with **Top · Front · SR · SL** in its header; this browser remembers your choice.

| View | Looking from | → right | ↑ up | Dragging moves | Clicking to place | Clicking to aim |
|---|---|---|---|---|---|---|
| **Top** | above | stage left | upstage | x, z | at that spot, 0.3 m below ceiling height | at that floor spot |
| **Front** | the audience | stage left | up | x, **height** | at that spot, on the centre line (z 0) | at that spot on the upstage wall |
| **SR** | stage right | audience | up | z, **height** | at that spot, on the centre line (x 0) | at that spot on the stage-left wall |
| **SL** | stage left | upstage | up | z, **height** | at that spot, on the centre line (x 0) | at that spot on the stage-right wall |

- Front, SR and SL show the floor line, the ceiling and real heights; dragging there is the quickest way to change height.
- Each view shows each beam's direction, the dot where its centre lands, and rig outlines.
- Instruments at the same spot in a view overlap; pick another view to separate them.

## Rigs

A **rig** is a preset group of instruments with fixed placement within the rig. You place, move and edit the rig as one thing.

| Type | Size is | Placement | Zero (beams at pan / tilt 128) | ↑ ↓ (tilt) |
|---|---|---|---|---|
| **Circle** | diameter | evenly around the ring, starting upstage | at the rig's centre | out of the ring's plane |
| **Square** | side | evenly around the edges, half a step in from the corners (4 = one mid-side each, 8 = two per side, …) | at the rig's centre | out of the square's plane |
| **Line** | length | evenly from end to end | all the same way: straight down when flat | toward / away from the audience when flat |

Every rig also has a number of **instruments** (2 up to the free slots), **tilt °**, **yaw °** (turns it about the vertical), and a **console type** for its instruments (or Stage only; see *Registering lights*). Each rig instrument is registered in the console, grouped under the rig's name.

- **Tilt** for circle and square: 0 = flat (hanging), 90 = upright, facing the audience.
- **Tilt** for a line turns it about its own length: 0 = beams straight down, −90 = at the audience (a front-light bar), +90 = upstage. A line's "up" turns with it, like fixtures on a pipe: at −90 ↑ raises the beams, at +90 it lowers them.

**Placing:** click **+ Place rig**, pick the type (this loads its defaults and relabels the size), set it up, **Place…**, then click where the rig's **centre** goes (3D surface or ground, or the plan). An outline previews it in 3D. A rig is lifted if needed to stay above the floor. Its instruments are then all selected.

**Working with a rig:**

- Click one rig instrument to select just it: its 0–255 values are its own.
- **Select whole rig** (inspector or right-click menu) selects them all, so the keys and Aim at spot act on all of them.
- Dragging any rig instrument moves the **whole rig**. Its instruments' position and zero are locked.
- The **Rig** section in the inspector (when the selection is one rig) edits the rig name, centre (x / height / z), size (labelled diameter / side / length), instruments, tilt / yaw. The instruments re-arrange live and keep their own values. Added instruments copy the first one's dimmer, color, zoom and ranges; removing drops the last ones.
- **Link rig** links the members, in order, to consecutive console instruments starting from the one you pick (or unlinks them all).
- Rigs are named "Ring 1", "Square 1", "Line 1", …; instruments "‹rig name› · 1", "· 2", …; renaming the rig renames them.
- Rigs are drawn as a grey outline (cyan when selected) in 3D and the plan.

## View settings (⚙ View)

**Transparent sides**: a checkbox for each side except the floor (stage-left, stage-right, ceiling, downstage / audience, upstage). Ticked = see-through (10% opacity, its grid still faint), so instruments beyond it show; unticked = solid. Beams always show on a side where they land. The floor is always solid, and the walls nearest the camera always stay see-through. **All transparent** / **All solid** set every side. Default: all transparent. Saved with the stage.

## How light is drawn

- **Cone**: translucent, in the instrument's color, clipped at every wall the instrument is inside of, so it ends where it lands. An instrument outside the box shines in through the near wall and stops at the far one.
- **Wall patches**: a surface point is lit if it's inside a cone; brightness depends on dimmer, the angle the light hits at, and distance, with a soft edge and a thin bright rim. Overlapping colors add up.

---

# Console ↔ Stage

In the combined page (or with `console/console.html` and `stage/stage.html` open in two tabs of the same browser, both from `localhost:8080`) they stay in sync. The stage header shows **Console · live** (green) or **Console · offline**.

## Linking an instrument

In the stage inspector's **Console link** section, pick:

- **A console instrument** (from the console's Instruments page): the stage uses its start channel, and a layout from its type:

  | Console type | Channels |
  |---|---|
  | Fixed · Single color | Dimmer |
  | Fixed · Multi-color | Dimmer, Red, Green, Blue |
  | Movable · Single color | Dimmer, Pan, Tilt, Zoom |
  | Movable · Multi-color | Dimmer, Pan, Tilt, Red, Green, Blue, Zoom |

  Channels beyond the preset are left unused (—). If the console instrument's address changes, the stage follows it.
- **Manual address…**: type a start channel yourself.
- **— not linked —**: values are set on the stage only.

The **Layout** lists each channel and what it drives; change any with its dropdown, **+ ch** / **− ch** to add or remove channels, **Preset** to go back to the console type's preset.
For a rig, **Link rig** links all its members at once (see *Rigs*).

## Registering lights

When you place a light (or a rig) with a console type, the stage asks the console to set it up:

1. A **console instrument** with the light's name and type, at the **next free DMX block** (a rig's instruments go in a console group named after the rig).
2. **One free fader per channel** (the lowest unpatched ones), patched 1:1 with max 255 and **named** after the light, e.g. `Inst 4 Dim`, `Inst 4 Pan`, `Ring 1 · 2 Dim`.
3. Those faders are set to the light's **current values** in the transition(s) on the output, so it doesn't change.
4. The light is linked to it, so the two-way sync and ⌥-click traces work straight away.

- **Out of room** (not enough free faders, no free DMX block, or the console's 64-instrument limit): the light stays on the stage, unregistered, and a message says why.
- **Console closed**: the light waits ("Will register in the console when it opens") and registers as soon as the console opens.
- **Deleting** a light the stage registered (or shrinking a rig) removes its console instrument and frees its faders: unpatched, back to their F-number names, 0 in every transition. An emptied rig group is removed. ⌘Z on the stage registers it again (possibly on different faders / channels).
- **Duplicating** a registered light registers the copy too. Picking a different console instrument (or "— not linked —") for a registered light removes the one the stage made.
- Lights the stage didn't register (linked by hand to an existing console instrument) are never removed from the console.
- **Register in console** (inspector, Console link section, for an unlinked light): pick a type and register an already-placed light.

## How syncing works

- Only channels that have a **console fader patched** to them are synced. Each linked value shows its channel and fader(s) in the inspector, e.g. `2 F2`; a channel with no fader patched is shown without one and stays under stage control.
- **Console → stage**: the console's output (all faders, crossfades and GO fades, master and submasters) sets the linked values live.
- **Stage → console**: changing a linked value on the stage (keys, sliders, color, Home, Aim at spot, …) moves the fader(s) patched to that channel, in the transition currently on the output (both transitions mid-crossfade), so the output matches. The patch **max**, **Master** and **submasters** are allowed for: e.g. with Master at 50%, setting the stage's dimmer to 100 puts the fader at 200.
- When you link an instrument, or the console opens, the **console's values win**. Opening the stage never moves a fader.
- If one fader drives several channels, changing one instrument on the stage moves the others on that fader too. With Master (or the active submaster) at 0, the stage can't raise the output.
- Console offline: the stage works on its own; when the console opens again its values take over.
- Flash on the stage is preview-only and isn't sent.

Under the hood the two pages talk over a `BroadcastChannel` (`unnaturallight.dmx`): the console sends its 512 output levels, which faders feed each channel, its instruments, and (for traces) fader names, live levels, transition values and the master / submasters / crossfade, on every change and once a second; the stage sends "set channel N to V", and its lights (for the console's traces). While the console is closed, the stage reads its instrument list from the console's saved session.

## Trace (⌥-click)

**⌥-click** (Option-click) something to see what controls it, what it controls, and the current values, in a card next to the pointer:

| ⌥-click | Where | The card shows |
|---|---|---|
| A **fader** | console: transition rows, Live meters, Channels-page fader strip, a fader's card on the Patch page | its transition value(s), submasters if not 100%, crossfade, Master → its live level; then each channel it's patched to (max, what it sends, the channel's output, and whether a higher fader wins there), and the console instrument and stage light(s) on that channel |
| A **DMX channel** | console: a Channels-page meter · stage: a channel badge in the inspector (e.g. `2 F2`) | the faders patched to it (what each sends; highest wins), its output, and the console instrument / stage light(s) it drives |
| A **console instrument** | console: its row on the Instruments page | its channel block and type; the stage lights linked to it; then each of its channels: output, which stage light / attribute uses it (and what that means), ← the fader(s) driving it |
| A **light** | stage: in the 3D view, the plan or the list | which console instrument it's linked to and Master; then every value (0–255 and its meaning) ← the channel ← the fader(s) driving it, or "set on the stage" |

- ⌥-click only shows the card: it doesn't move a fader, change the selection, start a rename or begin a drag.
- The card updates live while it's open. ⌥-click something else to trace that instead; **✕**, `Esc` or clicking elsewhere closes it.
- It works in the combined page and in the standalone pages. The console's card shows stage lights only while the stage is open, and the stage's card shows fader values only while the console is open.

## Saving (stage)

- **Autosave**: the stage saves to browser storage under `unnaturallight.stage.v1`, so a refresh restores it.
- **Export** downloads `stage.json`; **Import** loads one and replaces the current stage.

```json
{
  "app": "UnnaturalLight.stage",
  "version": 2,
  "box": { "w": 12, "d": 8, "h": 6 },
  "transparent": { "sl": true, "sr": true, "ceiling": true, "downstage": true, "upstage": true },
  "rigs": [
    { "id": "…", "name": "Ring 1", "type": "circle", "x": 0, "y": 5.7, "z": 0, "yaw": 0, "tilt": 0, "size": 4, "count": 8 }
  ],
  "instruments": [
    {
      "id": "…",
      "name": "Inst 1",
      "x": -3, "y": 5.7, "z": 2.5,
      "base": { "yaw": -50.19, "pitch": -55.58, "roll": 0 },
      "dmx": { "dimmer": 191, "pan": 128, "tilt": 128, "red": 255, "green": 217, "blue": 160, "zoom": 88 },
      "panLimit": 270, "tiltLimit": 135, "zoomMin": 5, "zoomMax": 60,
      "link": { "consoleId": null, "start": null, "layout": [] },
      "rigId": null, "rigIndex": 0
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `box.w / d / h` | Box width (x), depth (z), height (y) in m |
| `transparent` | Which sides are see-through (`true`) or solid. Missing → all `true` |
| `rigs` | `id`, `name`, `type` (`circle` / `square` / `line`), centre `x, y, z`, `yaw`, `tilt`, `size` (older `diameter` is read as `size`), `count`, `consoleType` (`{ mount, color }` its instruments register as, or `null`) |
| `x, y, z` | Instrument position in m |
| `base` | Zero frame: yaw / pitch / roll in degrees |
| `dmx` | The instrument's values, each 0–255 |
| `panLimit, tiltLimit` | What pan / tilt 0 and 255 mean (± degrees) |
| `zoomMin, zoomMax` | Beam angle at zoom 0 and 255 (degrees) |
| `link` | `consoleId` (linked console instrument, or `null`), `start` channel (or `null` = not linked), `layout` (attribute per channel, `null` = unused), `owned` (the stage registered it), `type` (its console type), `register` (console type still waiting to be registered) |
| `rigId, rigIndex` | The rig it belongs to and its slot (`rigId: null` = free). Position and `base` are recomputed from the rig on load |

Version 1 files (angles, `intensity` 0–1, `color` hex, `beam` °) still load and are converted to 0–255 values.

---

## IntelliJ

Open this folder as a project (`File → Open → ~/Code/UnnaturalLight`).
It’s a **Web** module (plain HTML/JS) — not Java. Reload the project if IntelliJ still shows JDK warnings.
Use the built-in preview or run `server.sh` from the terminal. `console/jsconfig.json` sets up JavaScript checking for the console files.

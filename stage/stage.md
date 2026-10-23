# Stage (`stage/`)

A 3D view of the performance area: a box you place instruments in. Each instrument projects a cone of light, and the box's floor, walls and ceiling light up where the cone hits them.

Run `./server.sh` from the project root, then pick **Stage** on the start page, or go straight to **http://localhost:8080/stage/stage.html**.
The page loads three.js from a CDN (jsdelivr) the first time, so it needs internet access then.

## Files

All stage files live in `stage/`. The DMX console lives in `console/` (`console/console.html`), and the root `index.html` is a start page linking to both. The stage doesn't use any console files.

| File | What's in it |
|---|---|
| `stage.html` | Page layout, plus the import map that says where three.js is loaded from (change the version here) |
| `stage.css` | Styles |
| `stage.js` | 3D view, plan, instrument list, inspector, keyboard / mouse, autosave |
| `stage-model.js` | No DOM or drawing: instrument data, zero frame and pan/tilt maths, beam/wall hit test, JSON parse / serialize |
| `stage.md` | This file |

## Keys

| Key | Action |
|---|---|
| `←` / `→` | Pan left / right 1° |
| `↑` / `↓` | Tilt up / down 1° |
| `⇧` + arrow | Pan / tilt 10° |
| `⌥` + arrow | Pan / tilt 0.1° |
| `+` / `−` | Intensity ±5% |
| `⌥` + `+` / `−` | Intensity ±1% |
| `[` / `]` | Narrow / widen beam 1° (`⇧` for 5°) |
| `F` (hold) | Flash: white at full intensity while held (selected instruments, or all if none selected) |
| `T` | Aim at spot: click a spot to point every selected beam at it |
| `H` | Home: pan and tilt back to 0 |
| `Z` | Set zero here: the current direction becomes the new zero |
| `A` | Toggle place mode |
| `⌫` / `Delete` | Delete the selected instrument(s); a rig instrument deletes its whole rig |
| `⌘Z` (Ctrl+Z) | Undo the last delete (repeatable, up to 50) |
| `Tab` / `⇧Tab` | Select next / previous instrument |
| `Esc` | Cancel place / aim mode, or clear the selection |

The keys act on **every selected instrument**, each relative to its own zero.
They're ignored while you're typing in a text or number field (press `Esc` or `Enter` to leave the field).

## Mouse

| Where | Action |
|---|---|
| 3D view: drag empty space / scroll | Orbit / zoom the camera |
| 3D view: click instrument | Select it (`⇧`-click adds it to the selection) |
| 3D view: drag instrument | Slide it around at its current height (snaps to 0.1 m; hold `⌥` for 0.01 m) |
| 3D view: `⇧`-drag instrument | Raise / lower it (height only) |
| 3D view: click empty space | Clear the selection |
| Plan: **Top / Front / SR / SL** | Switch the plan's viewpoint (see below) |
| Plan: click instrument | Select it (`⇧`-click adds it to the selection) |
| Plan: drag instrument | Move it in that view's two directions (snaps to 0.1 m; hold `⌥` for 0.01 m) |
| Instrument list: click row | Select it (`⇧`-click adds it to the selection) |
| Right-click an instrument (3D, plan or list) | Instrument menu (see below; ctrl-click works too on a Mac) |
| **+ Place rig** (header) | Place a rig (see Rigs) |

## Plan views

The plan (top of the sidebar) has four viewpoints. Switch with **Top · Front · SR · SL** in its header. The page remembers your choice in this browser.

| View | Looking from | → right | ↑ up | Dragging moves | Clicking to place | Clicking to aim |
|---|---|---|---|---|---|---|
| **Top** | above | stage left | upstage | x, z | at that spot, 0.3 m below ceiling height | at that floor spot |
| **Front** | the audience | stage left | up | x, **height** | at that spot, on the centre line (z 0) | at that spot on the upstage wall |
| **SR** | stage right | audience | up | z, **height** | at that spot, on the centre line (x 0) | at that spot on the stage-left wall |
| **SL** | stage left | upstage | up | z, **height** | at that spot, on the centre line (x 0) | at that spot on the stage-right wall |

- The Front, SR and SL views show the floor as a line, the ceiling at the top of the box, and the instruments at their real heights. Dragging there is the quickest way to change height.
- The audience edge is amber in Top, SR (right side) and SL (left side). Front is drawn from the audience's seat, so it has no audience edge.
- Each view shows the beam direction and the dot where the beam's centre lands, seen from that side.
- Instruments at the same spot in a view overlap (e.g. Inst 1 and Inst 2 in SR / SL, since they share z and height). Pick a different view to separate them.

## Right-click menu

Right-click an instrument in the 3D view, the plan or the list. If it's part of the selection, the menu acts on every selected instrument (Duplicate / Delete show the count); otherwise it selects just that one first.

| Item | Key | What it does |
|---|---|---|
| Aim at spot… | `T` | Click a spot to point the beam(s) at it |
| Home | `H` | Pan / tilt back to 0 |
| Set zero here | `Z` | The current direction becomes the new zero (not for rig instruments) |
| Aim zero at stage | | Point zero at the stage centre, pan / tilt 0 (not for rig instruments) |
| Select whole rig | | Rig instruments only: select every instrument in the rig |
| Flash (hold) | `F` | White at 100% while the item is held down |
| Duplicate | | Copy, 0.5 m to stage left |
| Delete | `⌫` | Remove (⌘Z to undo); on a rig instrument: "Delete rig", removes the whole rig |

The letter keys still work without opening the menu; the menu shows them so you don't have to remember them. The keys bar along the bottom of the 3D view only lists the always-on controls.

## Rigs

A **rig** is a preset group of instruments with fixed (hard) placement within the rig. You place, move and edit the rig as one thing; its instruments follow.

### Rig types

Every rig has a **size** (m), a number of **instruments** (2 up to the free slots; max 32 instruments in total), a **tilt °** and a **yaw °** (turns it about the vertical).

| Type | Size is | Placement | Zero (where beams point at pan / tilt 0) | ↑ ↓ (tilt) |
|---|---|---|---|---|
| **Circle** | diameter | evenly around the ring, starting upstage | at the rig's centre | out of the ring's plane |
| **Square** | side | evenly around the edges, half a step in from the corners (4 = one mid-side each, 8 = two per side, 12 = three…) | at the rig's centre | out of the square's plane |
| **Line** | length | evenly from end to end (first and last at the ends) | all the same way: straight down when flat | toward / away from the audience when flat |

- **Tilt** for circle and square: 0 = flat (hanging), 90 = upright, facing the audience.
- **Tilt** for a line turns it about its own length: 0 = beams straight down, −90 = beams at the audience (a front-light bar), +90 = beams upstage.
- A line's "up" turns with the line, like fixtures bolted to a pipe: at −90 ↑ raises the beams, at +90 ↑ lowers them. ← → always swing beams along the line.
- To make a line's beams converge on one spot: **Select whole rig**, then **Aim at spot**.

### Placing a rig

1. Click **+ Place rig** in the header.
2. Pick the type (switching type loads that type's defaults and relabels the size), set it up, then **Place…**.
3. Click where the rig's **centre** goes: a surface or the ground in 3D, or the plan (as for an instrument). An outline of the rig previews it in 3D.

The new rig's instruments are all selected, so the keys act on every one, each relative to its own zero. E.g. ⇧↓ tilts every beam down 10°, symmetrically.
An upright or tilted ring is lifted if needed so it stays above the floor.

### Working with a rig

- **Click** a rig instrument to select just that one: its pan / tilt, intensity, color and beam are its own.
- **Select whole rig** (inspector or right-click menu) selects all its instruments.
- **Dragging** any rig instrument (plan or 3D) moves the **whole rig**.
- A rig instrument's **position and zero are locked**: the inspector shows them greyed out, "Set zero here" / "Aim zero at stage" aren't offered, and `Z` skips rig instruments.
- **Rig section** in the inspector (shown when the selection is one rig): rig name, centre (x / height / z), size (labelled diameter / side / length), instruments, tilt / yaw. Changing these re-lays-out the instruments and keeps each one's pan / tilt / look. Adding instruments copies the first instrument's look; removing drops the last ones.
- **Duplicate** on a rig instrument makes a free (non-rig) copy.
- **Delete** on any rig instrument deletes the **whole rig** (the menu says "Delete rig (N)"). ⌘Z brings the rig back.
- Rigs are named "Ring 1", "Square 1", "Line 1", …; their instruments "‹rig name› · 1", "· 2", …; renaming the rig renames them.
- Rigs are drawn as a grey outline (ring, square or line) in 3D and in every plan view (cyan when selected).

## Placing instruments

Press `A` or click **+ Place instrument**, then:

| Where you click | Where the instrument goes |
|---|---|
| **Plan**, anywhere | Top: at that x / z, 0.3 m below the ceiling height. Front / SR / SL: at that spot, on the centre line. Inside or outside the box. |
| **3D**, a floor / wall / ceiling | On that surface, 0.3 m in from it (inside) |
| **3D**, `⌥`-click a wall | On the **outside** of the nearest wall, 0.3 m out from it |
| **3D**, the ground off the box | Standing on the ground **outside** the box, 0.3 m up |

In 3D a ghost marker shows where the instrument will land: **cyan** = inside the box, **amber** = outside, with a dashed line down to the floor. `Esc` cancels.

The plan shows plenty of room around the box (at least 4 m, or 60% of the box's longest side) so there's space to place outside. It also grows to include any instrument placed further out.
After placing, move instruments by dragging (in the plan or 3D; `⇧`-drag in 3D for height), or type exact x / height / z in the inspector.

A new instrument starts with its zero pointing at the centre of the stage floor (or the centre of the box if it sits on the floor).
Instruments outside the box are marked "outside" in the list and the inspector.
You can have up to 32 instruments.

## Coordinates

Metres. The origin is the **centre of the box floor**.

| Axis | − | + |
|---|---|---|
| x | stage right | stage left |
| y | floor (0) | up |
| z | upstage | downstage / audience |

Stage left / right is from the performer's view, facing the audience. In the plan the audience is at the bottom, marked in amber.

## Zero frame, pan and tilt

Each instrument has its own **zero frame**, so "up/down" and "left/right" mean the instrument's own directions.

- **Zero frame** (`base`): yaw, pitch, roll in degrees, in world space.
  - yaw 0 = facing upstage; +90 = facing stage right.
  - pitch −90 = pointing straight down.
  - roll sets which way counts as "up" for the arrow keys (e.g. a fixture hung upside down).
- **Pan / tilt**: degrees away from the zero direction. Positive pan = left, positive tilt = up. Each is clamped to its limit (default ±270° pan, ±135° tilt).
- **Home** returns pan / tilt to 0.
- **Set zero here** turns the current direction into the new zero and resets pan / tilt to 0.
- **Aim zero at stage** points the zero at the stage centre and resets pan / tilt to 0.

When an instrument is selected, the 3D view shows a dashed cyan line for its zero direction, a short cyan tick for its "up", and a dashed white line along the centre of the beam.

## How light is drawn

- **Cone**: a translucent cone in the instrument's color. It's clipped at every wall the instrument is inside of, so it ends where it lands. For an instrument outside the box, the beam passes in through the near wall and stops at the far one.
- **Wall patches**: each surface point is lit if it lies inside a cone. Brightness depends on intensity, the angle the light hits at, and distance. The edge is soft, with a thin bright rim at the boundary.
  - Inside the box: one patch where the beam lands.
  - Outside the box: an entry patch and an exit patch.
- **Hit readout** (inspector): inside or outside, beam direction, and which wall the centre of the beam hits (or enters and exits), with the point and distance.
- **Plan**: each instrument's beam direction seen from above, and a dot where the centre of the beam lands.

## Inspector

With one instrument selected you can edit: name, color, position (x / height / z), intensity, beam angle, pan, tilt, pan and tilt limits, and zero yaw / pitch / roll.
Buttons: Flash, Aim at spot, Home, Set zero here, Aim zero at stage, Duplicate, Delete.

With several selected: a shared color and intensity slider, plus Flash, Aim at spot, Home all, Set zero here (all), Aim zero at stage, and Delete all.

### Color

Each instrument's beam has its own color. It sets the color of the cone, the patch it lights on the walls, the lens, and its dot in the plan and list.

- Pick it with the color box. With several instruments selected, it sets the color of all of them.
- The HUD shows the color as a hex code.
- Where beams of different colors overlap, their light adds up (red + blue on the floor looks pink/white).

### Aim at spot

Point several instruments at the same spot:

1. Select the instruments (`⇧`-click in the 3D view, plan or list).
2. Press `T` or click **Aim at spot**.
3. Click the spot: anywhere on the floor, a wall or the ceiling in 3D, or a floor spot in the plan. A white ring follows the pointer, with dashed lines from each selected instrument to it.

Each instrument's **pan / tilt** changes so the centre of its beam hits that spot. Its **zero** stays as it was, so ← → / ↑ ↓ and Home still work relative to it.
If an instrument can't reach the spot within its pan / tilt limits, it goes as close as it can, and a message names it.
`Esc` or `T` again cancels.

### Duplicating

- **Right-click** an instrument (3D view, plan or list) and choose **Duplicate**, or click **Duplicate** in the inspector.
- If the instrument is part of the selection, every selected instrument is copied (the menu shows how many). Otherwise just that one.
- Each copy keeps all its settings (zero, pan / tilt, color, intensity, beam, limits), is named "… copy", and sits 0.5 m to stage left of the original.
- The copies become the selection, so you can drag them straight away.
- ⌘Z doesn't undo a duplicate (it only undoes deletes); delete the copies instead.

### Deleting

- **Right-click** an instrument in the 3D view, the plan or the list, and choose **Delete**.
  - If that instrument is part of the selection, every selected instrument is deleted (the menu shows how many).
  - If not, it's selected and deleted on its own.
- Or press **⌫** (the Mac "delete" key) / **Delete**, or click **Delete** in the inspector (**Delete all** with several selected). Same rules: a rig instrument deletes its whole rig.
- In the 3D view, a right-*drag* still pans the camera; the menu only opens on a right-click without dragging.
- The keys do nothing while you're typing in a field (there they edit the text as usual).
- `⌘Z` (Ctrl+Z) undoes the last delete and puts the instruments back where they were in the list, selected. You can undo up to 50 deletes back.
- The undo history only lasts until you reload the page.

### Flash

Hold the **Flash** button (inspector) or the `F` key: the selected instruments (or every instrument if none is selected) turn **white at 100%** for as long as you hold it. Releasing returns them to their own color and intensity.

- A quick tap still flashes for at least 150 ms, so it's visible.
- The HUD shows **FLASH** while it's on.
- Flash is display-only: it never changes the saved color or intensity.

## View settings (⚙ View)

The **⚙ View** button in the header opens the View settings dialog.

**Transparent sides:** a checkbox for each side of the box except the floor (stage-left wall, stage-right wall, ceiling, downstage / audience, upstage wall).

- Ticked = see-through (10% opacity, so its grid still shows faintly). You can see instruments placed beyond it, e.g. above the ceiling or behind the upstage wall.
- Unticked = solid; it hides whatever is behind it.
- Light from beams always shows on a side, even a transparent one, because lit areas get more opaque.
- The floor is always solid.
- The near walls (the ones facing the camera) always stay see-through so you can look into the box.
- **All transparent** / **All solid** set every side at once.

Default: every side transparent. The setting is saved with the stage (and in Export).
Close the dialog with **✕**, `Esc`, or by clicking outside it. Stage keys are ignored while it's open.

## Saving

- **Autosave**: everything is saved to browser storage under `unnaturallight.stage.v1`, so a refresh restores it.
- **Export**: downloads `stage.json`.
- **Import**: loads a stage JSON file and replaces the current stage.

### File format

```json
{
  "app": "UnnaturalLight.stage",
  "version": 1,
  "box": { "w": 12, "d": 8, "h": 6 },
  "transparent": { "sl": true, "sr": true, "ceiling": true, "downstage": true, "upstage": true },
  "rigs": [
    { "id": "…", "name": "Ring 1", "type": "circle", "x": 0, "y": 5.7, "z": 0, "yaw": 0, "tilt": 0, "size": 4, "count": 8 }
  ],
  "instruments": [
    {
      "id": "…",
      "name": "Inst 1",
      "color": "#ffd9a0",
      "x": -3, "y": 5.7, "z": 2.5,
      "base": { "yaw": -50.19, "pitch": -55.58, "roll": 0 },
      "pan": 0, "tilt": 0,
      "panLimit": 270, "tiltLimit": 135,
      "intensity": 0.75,
      "beam": 24,
      "rigId": null,
      "rigIndex": 0
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `box.w / d / h` | Box width (x), depth (z), height (y) in m |
| `rigs` | List of rigs: `id`, `name`, `type` (`"circle"`, `"square"` or `"line"`), centre `x, y, z`, `yaw`, `tilt`, `size` (diameter / side / length; older files' `diameter` is read as `size`), `count` |
| `rigId`, `rigIndex` | On an instrument: which rig it belongs to and its slot. `rigId: null` = free instrument. A rig instrument's position and `base` are recomputed from the rig when loading. |
| `transparent` | Which sides are see-through (`true`) or solid (`false`). The floor is always solid. Missing → all `true`. |
| `color` | Beam color, as `#rrggbb` |
| `x, y, z` | Instrument position in m |
| `base` | Zero frame: yaw / pitch / roll in degrees |
| `pan, tilt` | Degrees away from the zero direction |
| `panLimit, tiltLimit` | ± limits in degrees |
| `intensity` | 0–1 |
| `beam` | Full cone angle in degrees (2–120) |

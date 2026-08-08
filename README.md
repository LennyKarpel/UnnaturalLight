# UnnaturalLight

Local web UI with 32 faders for an Enttec DMX USB Pro.

Uses the browser **Web Serial API** (Chrome or Edge). No build step.

## Run

```bash
./server.sh
```

Open [http://localhost:8080](http://localhost:8080), plug in the DMX Pro, click **Connect DMX Pro**, and pick the serial port.

`server.sh` disables caching so **⌘R** reloads HTML/JS/CSS. Restart the server after updating `server.sh`. If an old tab still looks stale, use **⌘⇧R** once (hard reload).

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
- **Instruments** (`#instruments`) — register fixtures with a non-overlapping DMX block (**start** + **channel count**), optional **groups**, plus **Fixed / Movable** and **Single / Multi-color**. Saved with the setlist.
- **Patch** (`#patch`) — wire each fader to DMX channels with per-channel **max** (`fader × max / 255`). Shared across all transitions. Click a fader elsewhere to highlight it here; right-click a fader for **Rename** / **Show in Patch**. On Patch, **Rename** or double-click the title edits inline; **Clear** and **Unpatch all** ask for confirmation.

## Tunes, transitions & fader names

- **Tunes:** up to 32; each has its own reorderable transitions. GO Current/Next stay within the active tune.
- **Transitions:** 2–24 per tune; each has a fade-in time (2–10s) used when GO arrives at it. **+** asks for a name.
- **Faders:** default **F1–F32**; rename via right-click or Patch. Names are shared across transitions and saved in the setlist.

Faders start unpatched and are disabled until they have channels. Use **1:1 (Fader → Ch)** for a quick default. Shared channels use **HTP** (highest takes precedence).

**Blackout** (×) takes Master / that submaster to 0%; click again to restore.

## IntelliJ

Open this folder as a project (`File → Open → ~/Code/UnnaturalLight`).  
It’s a **Web** module (plain HTML/JS) — not Java. Reload the project if IntelliJ still shows JDK warnings.  
Use the built-in preview or run `server.sh` from the terminal.

## Notes

- Transition submasters scale Current/Next before the blend; Master scales the mixed result. GO uses each transition’s fade-in time to arrive at it.
- Keep the tab visible while outputting for the most stable refresh.

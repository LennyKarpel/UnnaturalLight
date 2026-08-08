# UnnaturalLight

Local web UI with 32 faders for an Enttec DMX USB Pro.

Uses the browser **Web Serial API** (Chrome or Edge). No build step.

## Run

```bash
./serve.sh
```

Open [http://localhost:8080](http://localhost:8080), plug in the DMX Pro, click **Connect DMX Pro**, and pick the serial port.

## Save / Load show

**New show** asks for a show name, then starts blank (two empty scenes, default masters, empty patch). The name appears beside the title (**⋮** → Rename) and is saved with the show.
**Save show** downloads a JSON file with patch, scenes, master, crossfade, and names.
**Load show** restores from a previously saved show file. New/Load ask first if the current show changed since the last save/load.

The full show also autosaves to `localStorage`, so a refresh restores your last settings without an explicit Save.

## Pages

- **Faders** (`#faders`) — **Live** output after submasters + crossfade + master; scene presets below. Crossfade From (cyan) → To (amber), **Submaster** sliders for current/next scenes, timed **2 / 4 / 6 / 8 / 10** s with **Pause** / **Resume**. Scene **⋮** menu: rename / remove. Double-click a scene name to edit inline.
- **Channels** (`#channels`) — DMX meters for channels 1–256. Bottom strip is the current scene’s faders; click the scene name to rename, or **Choose scene** to switch.
- **Patch** (`#patch`) — wire each fader to DMX channels with per-channel **max** (`fader × max / 255`). Shared across scenes. Click a fader elsewhere to highlight it here; right-click a fader for **Rename** / **Show in Patch**. On Patch, **Rename** or double-click the title edits inline; **Clear** and **Unpatch all** ask for confirmation.

## Scenes & fader names

- Scenes: 2–24; **+** asks for a name. Names are saved in the show.
- Faders: default **F1–F32**; rename via right-click or Patch. Names are shared across scenes and saved in the show.

Faders start unpatched and are disabled until they have channels. Use **1:1 (Fader → Ch)** for a quick default. Shared channels use **HTP** (highest takes precedence).

**Blackout** (×) takes Master / that submaster to 0%; click again to restore.

## IntelliJ

Open this folder as a project (`File → Open → ~/Code/UnnaturalLight`).  
It’s a **Web** module (plain HTML/JS) — not Java. Reload the project if IntelliJ still shows JDK warnings.  
Use the built-in preview or run `serve.sh` from the terminal.

## Notes

- Scene submasters scale From/To before crossfade; Master scales the mixed result.
- Keep the tab visible while outputting for the most stable refresh.

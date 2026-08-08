# UnnaturalLight

Local web UI with 32 faders for an Enttec DMX USB Pro.

Uses the browser **Web Serial API** (Chrome or Edge). No build step.

## Run

```bash
./serve.sh
```

Open [http://localhost:8080](http://localhost:8080), plug in the DMX Pro, click **Connect DMX Pro**, and pick the serial port.

## Save / Load

**Save config** downloads a JSON file with patch, scenes, master, crossfade, and names.  
**Load config** restores from a previously saved file. If settings changed since the last save/load, you’ll get a confirmation dialog first.

The full show state also autosaves to `localStorage`, so a refresh restores your last settings without an explicit Save.

## Pages

- **Faders** (`#faders`) — **Live** output after crossfade + master; scene presets below. Crossfade From (cyan) → To (amber), timed **2 / 4 / 6 / 8 / 10** s with **Pause** / **Resume**. Scene **⋮** menu: rename / remove. Double-click a scene name to edit inline.
- **Channels** (`#channels`) — DMX meters for channels 1–256. Bottom strip is the current scene’s faders; click the scene name to rename, or **Choose scene** to switch.
- **Patch** (`#patch`) — wire each fader to DMX channels with per-channel **max** (`fader × max / 255`). Shared across scenes. Click a fader elsewhere to highlight it here; right-click a fader for **Rename** / **Show in Patch**. On Patch, **Rename** or double-click the title edits inline; **Clear** and **Unpatch all** ask for confirmation.

## Scenes & fader names

- Scenes: 2–24; **+** asks for a name. Names are saved in config.
- Faders: default **F1–F32**; rename via right-click or Patch. Names are shared across scenes and saved as `faderNames`.

Faders start unpatched. Use **1:1 (Fader → Ch)** for a quick default. Shared channels use **HTP** (highest takes precedence).

**Blackout** zeros every scene’s fader levels (not just live output) and autosaves that state.

## IntelliJ

Open this folder as a project (`File → Open → ~/Code/UnnaturalLight`).  
Use the built-in preview or run `serve.sh` from the terminal.

## Notes

- Master scales all fader levels before output.
- Keep the tab visible while outputting for the most stable refresh.

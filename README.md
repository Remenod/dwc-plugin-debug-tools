# Vision Miner Debug Tools

A Duet Web Control 3 plugin for interacting with the VisionMiner debug build of
RepRapFirmware. It drives the firmware's `global.debugGCode` variable, which
echoes each executed G-code line to one or more output channels for debugging.

## Compatibility

[![Latest compatible firmware build](https://img.shields.io/github/v/release/Remenod/RepRapFirmware?label=latest%20debug%20build&sort=date)](https://github.com/Remenod/RepRapFirmware/releases/latest)

This plugin talks to debug-only hooks (`global.debugGCode`) that exist solely
in the [VisionMiner debug branch of RepRapFirmware](https://github.com/Remenod/RepRapFirmware/tree/visionminer-3.5.4-debug)
(`visionminer-3.5.4-debug`) — it is not compatible with stock/mainline Duet3D
firmware. Always flash the release linked above (or a newer one from the
same [releases page](https://github.com/Remenod/RepRapFirmware/releases))
before using this plugin.

Targets DWC `3.5.4` (see `plugin.json`).

## Features

- Independent checkboxes to route running-G-code debug output to any
  combination of **USB** (ACM serial), **Telnet**, and **DWC** (web console),
  read from and written to `global.debugGCode` via the Object Model and
  `/rr_gcode`. With none selected, echo is off.
- Understands the legacy `both` value (USB + DWC) from the old debug build, and
  preserves any metadata options (e.g. `:all`, `:stack,pos`) set from the
  console when you toggle a destination.
- Creates the `global.debugGCode` variable in firmware automatically if it
  doesn't exist yet.

## Building

Run `build.sh`:

```sh
./build.sh
```

DWC plugins are compiled inside a [DuetWebControl](https://github.com/Duet3D/DuetWebControl)
checkout and share that checkout's webpack module registry at runtime, so the
plugin **must** be built against the *same* DWC version that runs on the printer
(**3.5.4**). `build.sh` handles this: it maintains its own throwaway DWC 3.5.4
checkout under `.dwc-build/` (leaving any DWC tree you develop in untouched),
builds the plugin there, and copies the packaged zip into `dist/`. The first run
clones DWC and installs its dependencies (a few minutes); later runs are quick.

The result is `dist/dwc-plugin-debug-tools-<version>.zip`, which can be installed
from DWC's Plugins page (System → Plugins → Install plugin).

To build against a different DWC version (e.g. after the printer is upgraded),
override the tag: `DWC_VERSION=v3.6.3 ./build.sh`. Use `./build.sh clean` to
discard the cached checkout.

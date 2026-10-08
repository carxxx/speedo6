# SAMC Telemetry HUD — redesigned

This version is a full visual redesign of the original speedometer. The round dual-dial/canvas layout and speed-reactive artwork were removed.

## What stays compatible
- FiveM/NUI-style `window.postMessage` telemetry input.
- Speed input in m/s by default, matching `GetEntitySpeed` conventions.
- `km/h` / `kmh` / `kph` and `mph` input units are accepted.
- Fuel and vehicle health accept either `0..1` or `0..100`.
- Gear, engine, headlights, indicators, seatbelt and odometer fields remain supported.
- Existing PeerJS sync file is retained.
- HUD position/scale are still stored in localStorage.

## Demo
Open `index.html?demo=1` in a browser to preview live telemetry.

## Main files
- `index.html` — new asymmetrical telemetry HUD structure.
- `style.css` — new visual system with no opaque full-screen backdrop.
- `app.js` — new DOM-based telemetry renderer and retained sync transport.
- `peer.js` — retained PeerJS client bundle from the original resource.

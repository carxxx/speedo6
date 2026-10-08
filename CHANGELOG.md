# SAMC HUD Redesign

## v2 redesign
- Replaced dual circular gauges with a compact asymmetrical telemetry console.
- Removed canvas-based dial rendering, needles, circular overlays and reactive PNG backgrounds.
- Removed dependency on the old `assets/01..06.png` artwork.
- Added segmented RPM strip, large digital speed, speed progress rail, gear state, engine/lights state, indicators and resource bars.
- Kept FiveM/NUI-style telemetry message handling.
- Kept drag-to-position, scale controls and localStorage settings.
- Kept PeerJS sync support using the bundled `peer.js`.
- Added `?demo=1` browser demo mode.

# Meridian

**An explorable, real-time vision of humanity's capital city in the year 5026.**

Meridian stands on the equator in a restored volcanic caldera lagoon. At its heart is the Axis, the
ground anchor of a space elevator whose tether climbs past four orbital rings to a harbour in
geostationary orbit. Around it you'll find arcologies, floating gardens, a monument made of programmable
matter, and a rewilded island landscape. Everything is generated procedurally and rendered live in
the browser with Three.js and WebGL 2.

## Run it

Requires Node 18+.

```bash
npm install
npm run dev        # opens http://localhost:5173 with hot reload
```

Or build a single self-contained file:

```bash
npm run build      # → dist/index.html (open it directly, no server needed)
```

A prebuilt `dist/index.html` is committed, so you can simply double-click it. Fonts load from
Google Fonts when you're online; without a connection the page falls back to system fonts.

### Performance

The default preset is **High**. It is tuned to hold 60 fps on an Apple M4 Pro, with MSAA, 4096 px sun
shadows and planar water reflections. On an M-series Pro or Max, or a recent desktop GPU, you can choose
**Ultra** under Settings, which renders at full retina resolution. Resolution scales automatically to hold
the frame rate. You can force a preset with `?quality=low|medium|high|ultra`.

Chrome, Edge, Arc and Safari 17+ all work. For the smoothest result, keep the browser window on the
built-in display, and on battery power turn on High Power mode.

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` / arrows | Fly |
| `Space` / `E` · `C` / `Q` | Rise · descend |
| Drag · right-drag | Look · zoom lens |
| `Shift` · `Alt` | Boost · fine control |
| Scroll | Cruise speed |
| `Z` (hold) | Zoom lens |
| `1`–`0` | Fly to a landmark |
| `T` | Guided tour |
| `P` · `[` `]` | Let time flow · scrub the time of day |
| `H` · `F` | Hide the interface · fullscreen |

Touch: drag to look, and use two fingers to fly.

## What's in the scene

- **Sky and atmosphere.** The atmosphere is physically based (Hillaire 2020: transmittance,
  multiple-scattering and sky-view lookup tables), and distant geometry fades into the actual sky colour.
  At night you get flux-conserving stars and a procedural Milky Way oriented to the real galactic
  coordinates for the June sky at the equator. Glints from a Dyson swarm surround the Sun.
- **Orbital infrastructure.** The Halo is an equatorial orbital ring 620 km up. Aurea, Selene and a
  polar ring hang lower in the sky. Earth's shadow sweeps across the rings with a reddened penumbra. The
  space-elevator tether, with its climbers, rises to the Geostationary Harbour, and the terraformed Moon
  shows seas, clouds and night-side city lights.
- **The Axis.** The elevator's anchor is a 3.2 km hyperboloid diagrid built from straight ruled struts.
  It stands on root arches, with sky decks, luminous power conduits, a crown of counter-rotating
  gyroscopic rings, and climber pods riding the tether.
- **Arcologies.** Five procedural tower families: twisted petal helices, canopy trees carrying garden
  discs, stacked lens plates, hyperboloid lattices and twisting crescent sails. Their facades are shaded
  with a filtered window and rib pattern, lit windows at night, and energy veins pulsing up the ribs.
- **Landscape.** The caldera lagoon has a reef, beaches, a northern volcanic massif with a cloud forest,
  and the lone peak of Mount Anchor. The lagoon floor shows spectral light absorption and caustics.
  Trees come in a detailed near field and a lightweight far field, and the canopy shades translucent when
  backlit.
- **Water.** Planar reflections render through an oblique-clipped mirror camera, with layered wave
  normals, GGX sun glitter, shore foam, and a seamless handover to an analytic ocean at the horizon.
- **City life.** Thousands of GPU-animated vehicles fly banked lanes with light trails, and starships
  climb out of the Skyport. The Chorus is a monument of 100,000 motes that retells the human story, from
  stardust to the galaxy. Floating gardens drop waterfalls that dissolve into mist, and citizens stroll
  the Commons.
- **Rendering pipeline.** The scene renders into an HDR MSAA target, then goes through physically
  inspired bloom (Karis-averaged downsample and tent upsample), crepuscular rays, a pseudo lens flare,
  AgX tone mapping with a time-of-day grade, and subtle grain and vignette.

## Project layout

```
src/
  main.js              app, render loop, exposure, dynamic resolution
  core/                shared uniforms, sun & sky ephemeris, controls, lighting, presets
  sky/                 atmosphere LUTs, sky dome, rings / moon / tether (km-scale sky scene)
  world/               terrain, water, Axis, towers, districts, vegetation, floating islands, infrastructure
  life/                traffic, the Chorus, clouds, people
  post/                HDR pipeline: bloom, god rays, tone mapping
  shaders/             shared GLSL (noise, atmosphere, aerial perspective)
  ui/                  HUD, landmarks & lore, guided tour, ambient audio
tools/capture.mjs      headless capture harness (Chromium + SwiftShader) for visual review
scripts/               packaging helpers
```

## Visual review tooling

```bash
npm run build
node tools/capture.mjs views.json shots/view 1280 720
python3 tools/contact-sheet.py shots/view 6 shots/sheet.jpg
```

`views.json` is a list of `{ "t": 17.5, "x": 0, "y": 200, "z": 5000, "look": [0, 900, 0] }` camera
definitions. The harness steps the renderer deterministically and saves JPEGs.

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
shadows and planar water reflections. Recent M-series Pro, Max and Ultra chips start on **Max**. You can
change the preset under Settings:

| Preset | Resolution | Notes |
| --- | --- | --- |
| Low · Medium · High | 1x–1.5x, scales down to hold the frame rate | |
| Ultra | full retina | scales down under heavy load |
| **Max** | full retina, never lowers | 8192 px shadows, denser clouds, wider near-detail radius, gentle sharpening |
| Cinematic | 2.5x supersampled | for slow flying and recording |
| Reference | 3x supersampled, densest clouds | for stills; not meant for real time |

You can force a preset with `?quality=low|medium|high|ultra|max|cinematic|reference`.

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
| `M` · `K` | Atlas · photo mode |
| `O` | Leave for orbit (and return) |
| `H` · `F` | Hide the interface · fullscreen |

Touch: drag to look, and use two fingers to fly.

In orbit, drag or use `W` `A` `S` `D` to orbit the current target, scroll or `E` / `Q` to zoom, and
press `Space` to pause the clock. The number keys pick a target:

| Key | Target | Key | Target |
| --- | --- | --- | --- |
| `1` | Earth | `6` | The Sun and the Swarm |
| `2` | Meridian | `7` | The Hearth (Sun–Earth L2) |
| `3` | The Halo | `8` | Concord-class Liner |
| `4` | Geostationary Harbour | `9` | Reclamation Tenders |
| `5` | The Moon | `0` | Selene Works |

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
- **Towns.** Every island carries a planned town: ring streets, radial avenues toward the Axis, and
  lanes. Plots are laid along the street frontages and built as terraces, cloisters, ribbons, mews,
  pavilions and small towers, each with real window bays. Kerbs, setts, verges, street trees, benches,
  fountains and lamps come from one shared street field, so paving, planting and light all agree.
- **Promenades.** Maglev tubes and deck roadways link the central plaza to the islands. Each lands on
  ground at both ends, at a glass station with a light column.
- **City life.** Thousands of GPU-animated vehicles fly banked lanes with light trails. Starships climb
  out of the Skyport on streaked engine plumes, and courier skiffs trail plasma exhaust through the
  floating gardens. The Chorus is a monument of 100,000 motes that retells the human story, from stardust
  to the galaxy. Floating gardens drop waterfalls that dissolve into mist. Articulated citizens walk the
  plaza, the promenade decks, the streets and the squares.
- **Orbit.** Press `O` to rise to orbit. The view is rendered in depth slices, with camera-relative
  precision so stations 42,000 km out stay steady. There you can see Earth with baked clouds and city
  lights, the rings with their tethers and traffic, the Geostationary Harbour with its spinning habitat
  rings, and a Concord-class liner berthed at the Harbour while a second one comes in on approach.
  Reclamation tenders work above the Halo, and Selene Works refines lunar ice over the Moon's near side.
  There is also the Dyson swarm, and the Hearth at L2. Exposure is metered, and sun glare is occluded by
  the Earth's and Moon's limbs.
- **Rendering pipeline.** The scene renders into an HDR MSAA target, then goes through physically
  inspired bloom (Karis-averaged downsample and tent upsample), crepuscular rays, a pseudo lens flare,
  AgX tone mapping with a time-of-day grade, and subtle grain and vignette. Metered auto exposure
  adapts around the designed exposure curve, and at Max and above a contrast-adaptive sharpen restores
  fine detail.

## Project layout

```
src/
  main.js              app, render loop, exposure, dynamic resolution
  core/                shared uniforms, sun & sky ephemeris, controls, lighting, presets
  sky/                 atmosphere LUTs, sky dome, rings / moon / tether (km-scale sky scene)
  world/               terrain, water, Axis, towers, town plan (urban.js), buildings, streetscape,
                       vegetation, floating islands, promenades and stations
  life/                traffic, skiffs, the Chorus, clouds, people
  craft/               ship hulls, craft material, engine plumes and trails
  space/               orbital mode: sim clock, Earth, Moon, rings, elevator, fleet, traffic, Sun, Hearth
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

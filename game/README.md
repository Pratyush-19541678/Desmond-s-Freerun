# Desmon Run — parkour through Monteriggioni

A parkour game built on your local **three.js** copy.
**Desmond is the only humanoid character** — he sprints, jumps, vaults,
climbs/mantles, wall-runs, wall-jumps and rolls through the city of Monteriggioni.

## Play it — Windows app (easiest, uses your real Desmond model)

Double-click **`dist/DesmonRun-win32-x64/DesmonRun.exe`**
(or the root `Play-DesmonRun.bat` shortcut). No server, no browser, no installs —
the game, the city, and your converted Desmond model are all inside.

## Play it — browser

The game uses ES modules + `scene.gltf`/`scene.bin`, so you must serve the folder:

```powershell
cd "C:\Users\PRATUYSH\Downloads\Desmon Run"
python -m http.server 8000
```

then open **http://localhost:8000/game/**

Or just double-click / run:

- `run-game.bat` (Windows)
- `.\run-game.ps1` (PowerShell)

Both start the server and open the browser for you.

## Controls (Assassin's parkour)

| Input | Action |
|---|---|
| W A S D / arrows | walk (camera-relative, no stamina cost) |
| Shift + move | sprint / free-run (drains stamina) |
| Mouse drag, or click canvas for pointer-lock + mouse | look / scroll = zoom |
| Space | jump — tap = hop, hold = full height; Space again = wall-jump / wall-eject |
| Sprint at a wall | auto-vault (low) or auto-climb (tall) |
| On a wall | W up · S down · A/D across · Space jumps off · reach the top = auto pull-up (holds ≤12 m, then arms give out) |
| Falling past a ledge | auto-grab → hang: W pull up · S drop · A/D shimmy (drains grip) |
| E | sprinting: feint juke · airborne: swan dive · else: manual vault / mantle |
| Q / double-tap A/D | feint juke while sprinting |
| C (hold) / Z (toggle) | crouch (1 m) / prone crawl (0.5 m) for tunnels and window reveals |
| R | respawn (back to the viewpoint tower) |
| Touch | left stick + JUMP / SPRINT / VAULT / CROUCH buttons |

Parkour guide:
- **Walk / sprint** — Desmond walks by default with matching stride and footsteps; Shift commits to a weighty sprint with arcing turns.
- **Climb** — sprint into any tall face (or jump at it holding Space); steer with WASD, Space ejects, topping out pulls up automatically. Sprinting into an unclimbable face auto-steers along it instead of face-planting.
- **Hang** — drop past a ledge to catch it; shimmy along it, pull up, or drop (a lower ledge may save you).
- **Vault / mantle** — low obstacles vault automatically at sprint; E forces it.
- **Slide** — C while sprinting dives into a feet-first powerslide under bars and through low tunnels, flowing back into the run.
- **Ledge drop** — hold S at a roof edge to step into a controlled drop with forward drift.
- **Wall-run** — sprint + jump *alongside* (not into) a wall, then Space to wall-jump.
- **Roll** — land from high up while moving to keep speed.
- **Leap of faith** — dive from the tower (or press E mid-air); falls magnetize toward the central hay bale, which catches big drops and refills stamina.
- **Crouch / prone** — hold C to sneak 1 m tall, toggle Z to crawl 0.5 m through tunnels, archways and low window reveals; ceilings auto-stand you when clear.
- **Feint** — Q / E or double-tap A/D mid-sprint for a lateral juke with its own lunge animation.

Pure free-run sandbox: no checkpoints, no timers to beat — flow across the rooftops, climb the towers, hang the ledges, dive the hay bale.

## Precision collision (how the town holds you)

Every wall, roof, shed, street and tower floor collides at the **exact triangle level**:
the game builds a BVH acceleration tree over all ~2M town polygons at startup
(`three-mesh-bvh`, ~1 s), then every footstep, wall, mantle, climb, hang and
camera probe raycasts the real mesh. Movement slides along exact wall faces
with step-up onto low ledges, so there is no proxy geometry to fall through.

## Body physics: cannon-es bound to three.js

`game/physics.js` runs your `cannon-es/` copy (v0.20.0) as the dynamics layer:
a 75 kg two-sphere player body, gravity −24, contact friction 0 (the
controller owns damping), restitution 0, solver at 10 iterations, fixed
1/60 steps with substeps on fast falls. Static twins exist for the street
plane and hay bales. The ~2M-triangle city stays on BVH rays (a cannon
Trimesh that large has no acceleration tree and cannot step in real time) —
each physics step is slide-corrected against the real polygons, so the two
systems agree exactly. Verified headless: free-fall rests at 0.400 m, sprint
holds 8 m/s, hay catches at 1.400 m, jump peaks at 2.01 m.

## Files

```
Desmon Run/
  scene.gltf / scene.bin / textures/   city of Monteriggioni (authored scale: 1 unit = 1 m, ~270 m town, ~45 m great tower)
  AC1-Desmond_Miles.blend              your Desmond source model
  three.js/                            local three.js r186 (used via importmap, not modified)
  game/
    index.html                         game page (imports ../three.js/build/three.module.js)
    main.js                            third-person controller + parkour + HUD
    style.css
    desmond.glb  (optional, you create it)
```

## Your real Desmond model (already converted)

`game/desmond.glb` was converted from your `AC1-Desmond_Miles.blend`
(a Mixamo-style "Jack" rig: 7 meshes, 127 bones, packed textures).
The `.blend` had no animations, so fourteen were authored for it —
Run / Idle / Jump / Rise / Fall / Walk / Hang / Hold / Climb / Dive /
Crouch / Prone / Dodge / Slide — and the game blends between them by state
and speed (rising extends, falling tucks, run cycle speeds up with your
speed, feet stride-matched).

Pipeline (re-runnable, needs the portable Blender in your Temp folder):
`tools/fix-desmond-rig.py` → `tools/animate-desmond.py` →
`tools/export-desmond.py`, e.g.:

```powershell
& "$env:LOCALAPPDATA\Temp\opencode\blender\blender-4.2.23-windows-x64\blender.exe" `
  --background "AC1-Desmond_Miles.blend" `
  --python "tools/fix-desmond-rig.py" `
  --python "tools/animate-desmond.py" `
  --python "tools/export-desmond.py" -- `
  "game/desmond.glb" "tools/desmond-stats.json"
```

If you re-export a new `desmond.glb`, re-copy it into `desktop-app/game/`,
then rebuild the exe: `cd desktop-app; npm run dist`.

## Parkour brain: Dynamic Parkour System port (Unity C# → Three.js)

The vault logic is adapted from the Dynamic Parkour System you provided
(MIT © 2023 Èric Canela).
C# can't execute in a browser, so each system was re-implemented against
three.js + BVH raycasts with the original tuning values:

| DPS (C#) | Three.js port (`game/main.js`) |
|---|---|
| VaultingController priority chain | state machine order: vault → hang → climb → feint/slide → wallrun → free |
| VaultObstacle (Jump, knee 0.5/0.7, land beyond+1.2, hand IK) | auto-vault lerp onto the landing, verified footing |
| VaultOver (box, facing dot>0.6, land+2, 0.85 s) | sprint box-vault along facing with landing validation |
| VaultReach (climb ≤2 m, Reach/Reach-High) | quick mantle ≤1 m + sustained climbwall to ~3.4 m, 12 m cap |
| VaultSlide (Drop input, knee 1.5/1.5) | C while sprinting → 0.7 s feet-first powerslide (new Slide clip), flows back to sprint |
| VaultClimbLedge → ClimbController | climbwall (WASD + eject + auto pull-up) + hang (shimmy/pull-up/drop) + Hold pose |
| VaultDown (S at edge → controlled drop + drift) | S at a ledge edge steps into a pushed drop |
| VaultJumpPrediction (authored poles) | skipped — the city has no pole markers |
| AutoStep 0.8 / stepHeight | step-up ≤0.55 m + sticky ground inside the slide solver |
| CheckBoundaries edge tangent | sprint auto-brake at deadly edges (Space overrides for leaps) |
| Feet IK planting | twin sole rays tilt the pelvis + lift per frame |
| Detection fan/ledge/foot rays | multi-offset sill sampling + BVH first-hit rays |

## Credits (required by the city license)

This work is based on "Monteriggioni"
(https://sketchfab.com/3d-models/monteriggioni-5a0bcecb63524854b231feba34c6fbf9)
by Olaf.Rodowald (https://sketchfab.com/Olaf.Rodowald)
licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/).

Keep this credit + `license.txt` wherever you share the game.

## Library credits

- three.js (MIT © three.js authors) — local copy in `three.js/`, unmodified.
- three-mesh-bvh (MIT) — vendored at `game/libs/three-mesh-bvh.module.js` for exact raycasts.
- cannon-es (MIT © cannon.js authors) — vendored from your `cannon-es/` folder at
  `game/libs/cannon-es.module.js` as the rigid-body dynamics layer.
- Dynamic Parkour System design (MIT © 2023 Èric Canela) — vault/climb logic
  ported from the C# reference to JavaScript (see table above).

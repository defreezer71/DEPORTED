# DEPORTED — Arena MVP Build Parameters (blockout)

*Companion to `DEPORTED_Arena_MVP_Build_Spec.md`. This file gives Claude Code the concrete numbers to build the gray-box blockout. All values are starting points — tune once the space is walkable.*

---

## Coordinate system

- All units are meters (same scale as `playerHeight: 1.7`, `playerRadius: 0.25`).
- Origin `(0,0)` = arena center.
- `+x` = east, `-x` = west (short axis / width).
- `+z` = south, `-z` = north (long axis / length).
- **180° rotational symmetry:** rotating any point about center = negate BOTH x and z. Every cover object below has its rotational partner. Preserve this exactly — it is what makes the two spawns fair.
- `rotationY` is degrees about the vertical axis: `0` = long side runs along z, `90` = long side runs along x.

## Top-down reference (north = Spawn A at top)

```
              SPAWN A  (0, -31)  faces +z
                 ┌────┐  tunnel
 ════════════════┘    └════════════════   z = -28  (north wall)
    [pocketAL]              [pocketAR]      containers along x,  z = -22
    -9,-22                    9,-22
              · crateN -3.5,-8
 [laneWN]                      [laneEN]     lane containers,     z = -9
 -13,-9                         13,-9
   ~ ~ ~ ~ rotation lane  (open, z ≈ -11) ~ ~ ~ ~
                  ▛▀▀▜
                  ▙▄▄▟   MONUMENT (0,0) high ground, 11 x 9, +2m
   ~ ~ ~ ~ rotation lane  (open, z ≈ +11) ~ ~ ~ ~
 [laneWS]                      [laneES]     lane containers,     z = +9
 -13,9                          13,9
              crateS 3.5,8 ·
    [pocketBL]              [pocketBR]      containers along x,  z = +22
    -9,22                     9,22
 ════════════════┐    ┌════════════════   z = +28  (south wall)
                 └────┘  tunnel
              SPAWN B  (0, 31)  faces -z
```

## CONFIG block (add to `CONFIG` in `js/src/01_config.js`)

```js
CONFIG.arena = {
  // Playable floor — clamp players inside these bounds. 36m wide x 56m long.
  bounds: { minX: -18, maxX: 18, minZ: -28, maxZ: 28 },
  floorColor: 0x5E8C41,

  // Enclosing bowl wall (breached only by the two tunnels).
  // wallHeight is visual — tall walls sell scale cheaply; collision only needs
  // to stop players leaving `bounds`.
  wallHeight: 18,
  wallColor: 0xC3BAA6,
  tierColorDark: 0xA99B7C,

  // Central high ground. MUST block the straight spawn-to-spawn sightline.
  // Reachable by ramp/step on the +x and -x sides.
  monument: { x: 0, z: 0, sizeX: 11, sizeZ: 9, height: 2.0, color: 0xA99B7C },

  // Spawns sit inside the tunnel mouths, facing arena center.
  spawns: [
    { id: 'A', x: 0, z: -31, facing:  1 },
    { id: 'B', x: 0, z:  31, facing: -1 },
  ],

  // Tunnel openings breach the north/south walls.
  tunnel: { width: 6, length: 10, height: 4, color: 0x262523 },

  // Cover objects. Each has its 180°-rotational partner (negate x AND z).
  //   container = 6 x 2.6 x 2.5m  -> blocks a standing sightline (full cover)
  //   crate     = 1.5m cube       -> crouch cover, shoot over while standing
  cover: [
    { id: 'pocketAL', type: 'container', x:  -9, z: -22, rotationY: 90 },
    { id: 'pocketAR', type: 'container', x:   9, z: -22, rotationY: 90 },
    { id: 'pocketBL', type: 'container', x:  -9, z:  22, rotationY: 90 },
    { id: 'pocketBR', type: 'container', x:   9, z:  22, rotationY: 90 },
    { id: 'laneWN',   type: 'container', x: -13, z:  -9, rotationY:  0 },
    { id: 'laneWS',   type: 'container', x: -13, z:   9, rotationY:  0 },
    { id: 'laneEN',   type: 'container', x:  13, z:  -9, rotationY:  0 },
    { id: 'laneES',   type: 'container', x:  13, z:   9, rotationY:  0 },
    { id: 'crateN',   type: 'crate',     x:-3.5, z:  -8, rotationY:  0 },
    { id: 'crateS',   type: 'crate',     x: 3.5, z:   8, rotationY:  0 },
  ],

  containerSize: { x: 6, y: 2.6, z: 2.5 },
  crateSize:     { x: 1.5, y: 1.5, z: 1.5 },
  containerColor: 0x2E6DB0,
  crateColor:     0xA8865A,
};
```

## Design intent (do not "optimize away")

- The monument at center is load-bearing: it must break line of sight between the two spawns. If a player standing at Spawn A can see Spawn B, the monument is too short or too narrow — raise/widen it, don't move it.
- The two **rotation lanes** (open field around z ≈ ±11) are deliberately empty. They let a player cut between the west and east lanes. Do not fill them with cover.
- **Spawn pockets** exist so a player is not sniped the instant they leave the tunnel. Keep cover just off each tunnel mouth.
- Container height (2.6m) is above standing eye height on purpose — full cover. Crate height (1.5m) is crouch cover on purpose — variety. Keep both.

## Tunable knobs (expect to adjust after first walkthrough)

- Long axis (`minZ`/`maxZ`): 56m now; competitive range ~45–70m.
- Monument `sizeX`/`sizeZ`/`height`: tune until it just blocks the spawn line with a little margin.
- Cover x/z spacing: widen or tighten lanes to taste once you can strafe them.
- Optional orientation aid: tint the A-side cover vs the B-side cover slightly differently (does NOT affect fairness — color is not an advantage) so players can tell which end they're facing.

## Build order (per the main spec)

1. On-screen debug HUD first: draw calls + triangles (`renderer.info`) + ms/fps.
2. Gray-box blockout at these coordinates — no Roman detailing yet.
3. Walk it / playtest the 1v1. Tune the knobs above.
4. Only then skin it "chunky Roman" low-poly. Instance every repeated piece.

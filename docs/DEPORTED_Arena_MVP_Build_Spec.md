# DEPORTED — Arena MVP Build Spec (v1)

*1v1 coliseum map. Reference for future Claude / Claude Code. Ship this rock-solid before anything else.*

---

## Prime directive

Frame stability beats everything. This map exists to ship a smooth, provable 1v1 MVP. If a feature threatens frames, cut it. Visual fidelity loses to competitive smoothness every time.

## Map identity

A generic American coliseum fused with a Roman circus. Fully original — it evokes the *type*, copies no real venue, and uses no real names, logos, or trade dress, so there is zero copyright exposure. It fits the DEPORTED theme: combatants emerging from holding tunnels into a stadium-turned-arena.

## Visual style — "chunky Roman" low-poly (OSRS-style)

- Flat-shaded, flat colors, faceted geometry. No PBR. No texture where a flat color reads fine.
- Faceted hexagonal/octagonal columns, not round. Stepped blocky arches, not curved. Flat travertine/stone color blocks.
- Cut or drastically simplify statues and ornament — pure triangle cost, zero gameplay value.
- Keep the palette calm and muted so **players are the loudest thing on screen**. The environment must never out-read an enemy silhouette. Test in-engine: an enemy model must pop against a blue container at max engagement range.

## Competitive layout (matches the top-down plan)

- **180° rotational symmetry** about the arena center. Non-negotiable — it guarantees spawn fairness.
- Long axis **~45–70m playable** (tune in-engine; a full ~110m field is too long). Perceived scale comes from tall walls, not floor area.
- Two **spawn tunnels** on the short ends of the long axis, mirrored.
- A central raised **monument (high ground)** at midfield that **must break the direct spawn-to-spawn sightline**. This forces the left / right / over-the-top decision instead of a first-to-click snipe.
- **Three routes:** west lane, east lane, center high ground. High ground sees the most but is exposed to both flanks — a gamble, not a free win.
- **Spawn safety pockets:** cover just outside each tunnel mouth so no one gets sniped the instant they emerge.
- **Two lateral rotation lanes** connecting west and east so the map isn't two dead-parallel corridors.
- **Cover:** low-poly muted shipping containers on the flanks; wooden crates for mid-field micro-cover.

## Tunnel walkout (entrance moment)

- Player spawns *inside* a dark tunnel, walks toward the light, bursts into the bright bowl.
- **Player-controlled during the existing countdown — not a scripted cinematic camera.** Keeps it deterministic and reuses the gate mechanic already built.
- Doubles as an occlusion gate: only the corridor draws during the countdown, so the arena is fully ready before the reveal (hides the load hitch). The dark-to-bright contrast is the reveal beat.

## Crowd

- No crowd. Empty instanced stone seating reads as a packed coliseum through scale alone.
- A few static, instanced, un-animated guards on the rim for menace. No animated spectators, ever, for the MVP.

## Performance budget (hard targets — build against these, not by feel)

| Metric | Target | Ceiling |
|---|---|---|
| Frame time | 8.3ms (120fps) | 16.6ms (60fps) — hard floor |
| Draw calls | under 100 | ~150 |
| Triangles in view | ~150k | ~300k |
| Lights | 1 directional + 1 ambient | — |
| Real-time shadows | none | none for MVP |
| Unique materials | as few as possible, atlas textures | a few MB total |

- **Instance everything that repeats:** arches, tiers, columns, seats, containers, guards.
- The enclosed bowl occludes the outside world — hard-cap render distance, no distant terrain or foliage.
- **Zero per-frame allocation in the update loop** (reuse vectors/objects). This is the number-one cause of periodic stutter (GC) — the "smooth, then hitches every few seconds" pattern.
- Ship an on-screen debug HUD: live draw calls + triangles (`renderer.info`) + ms/fps. "No frame drops" must be two numbers you watch, not a hope.

## Do not repeat the likely jungle-map culprits

Transparent foliage overdraw, non-instanced scattered objects (draw-call bloat), and per-frame allocation (GC stutter). This arena avoids all three by design — that's the point of it.

## Workflow (unchanged)

Edit `js/src/` → `bash build.sh` → test on localhost → `git add -A && git commit && git push`. Never edit `js/game.js` directly. Second map and multiplayer modes stay tabled until after this MVP ships.

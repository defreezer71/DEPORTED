# Performance investigation — frame drops in auto-join matches (handoff)

Status as of 2026-06-26: **substantially improved.** Handing off to a future model
(Mythos / Fable 5) — start here instead of re-deriving.

## CRITICAL CONTEXT — the dev's display is 75Hz, not 60Hz
`requestAnimationFrame` runs at the monitor refresh rate; it is NOT capped at 60.
On this machine open play now reads **75fps** (HUD `FPS:`). This means:
- "Smooth" for this user = **75**, so every earlier dip to 47/40/30 was a drop from
  75 (very noticeable), and targeting 60 was wrong.
- **Adaptive resolution (`_adaptResolution`) currently targets ~60** (drops <57, raises
  >59.5). On a 75Hz display it should target the actual refresh rate — detect it
  (e.g. measure rAF interval, or assume 75/144) and aim there, or it will sit at ~60
  and feel like a permanent drop from native. **This is the first knob to revisit.**
- The big win that got open play to 75: the **countdown load-gate** (shipped) moved
  the one-time rig-clone cost onto a blank loading hold BEFORE the match, so the early
  game (where the drops lived) now runs clean. The load-in/gate/canal drops were
  largely the clone cost happening during play.

## Captured numbers (2026-06-27) — real M1/Metal render via headless harness
First hard measurement of the scene workload. Drove the actual game in Google Chrome
(ANGLE Metal, Apple M1) and read `renderer.info` on true GPU renders. Geometry counts
are GPU-independent and exact; the frame-cost figures are **render-only** (exclude the
per-frame game CPU: bot AI, physics, mixers, gun-fit IK) at a 1641×1026 backbuffer, so
treat their fps as a render ceiling, not end-to-end (end-to-end on-device is 75).

- **Triangles: ~1.55M baseline, ~1.578M facing the open island.** The static world is
  the *entire* geometry budget — it barely moves as you spin 360°. Characters are noise
  (~1 draw call + a few k tris each).
- **Scene census:** 1,398 meshes (1,389 visible), ~1,155 geometries, 219 shadow-casters,
  24 InstancedMesh, 10 textures, 26 shader programs.
- **Draw calls swing 62 → 852 on camera direction alone** (360° sweep from prison spawn:
  62 facing a cliff @120°, 852 facing the island @300°). Confirms: no occlusion culling.
- **Render frame cost (M1, 1641×1026, render-only):** worst island view = 852 calls /
  1.578M tris / **10.9ms median** (~92fps ceiling); same view no-shadow = 10.0ms; looking
  away = 65 calls / **4.9ms** (~204fps). Shadows add only ~0.9ms at this view.
- **Refines the fill-bound read:** the ~790 extra draw calls at the corner cost ~6ms
  (4.9→10.9ms) at the *same* tris and resolution — that's real draw-call / command-
  encoding (CPU) cost, not fill. So there are **two distinct hot spots**: the corner
  spawn is **draw-call bound** (no occlusion culling → 852 calls; fix = step 4 below),
  while the drop-to-30-when-shot is **fill bound** (full-screen vignette; fix = adaptive
  res). They are different problems and want different fixes.
- **Bandwidth is a non-issue:** down `(6+N·17)·60` B/s ≈ 20KB/s at the 20-player cap;
  up `24·60` ≈ 1.4KB/s. Bots are client-simulated and never hit the wire.

`DBG.perfProbe()` now prints all of the above live in any browser tab: the scene census,
the current-view main/shadow split + tri count, AND a 360° draw-call sweep (min/max calls
with the yaw where each occurs). Run it standing at the prison corner to see the swing.

## Earlier status (2026-06-25)
Game held ~60fps in open play but dropped at: (1) bot load-in / countdown, (2) gate
opening, (3) canal crossing, (4) the moment the player is shot.

## What the data established (high confidence)
- **Each character is exactly 1 draw call.** Parsed the GLBs: 1 mesh, 1 primitive,
  1 material, 66 bones. 10 bots ≈ ~24 draw calls total. **Bots are not the draw-call load.**
- **Not draw-call bound:** measured **47fps at 651 calls AND 47fps at 1156 calls**
  (same FPS, very different call counts). A draw-call ceiling can't produce that.
- **Strong signal it's GPU fill-rate bound:** getting shot drops to ~30fps for ~1s,
  and the only thing that adds is a full-screen CSS damage vignette
  (`#damage-vignette`). A full-screen overlay only costs frames when pixel-shading
  is the bottleneck. The bad spots are all "screen filled with close-up characters."
- Draw calls DO climb with a wide corner view (prison spawn sees the whole island;
  three.js has **no occlusion culling**, so everything in the frustum is drawn even
  behind walls). But that's the main pass, and FPS didn't track it cleanly.

## What was tried (all currently in the code unless noted)
Helped somewhat:
- Shadow map `autoUpdate=false`, regenerated ~30Hz; 2048²→1024².
- **Shadow frustum now follows the player** (140×140) instead of covering the whole
  340×340 island — this took the prison view from ~9fps to ~47fps. (`_sunDir` follow
  in 12_main.js, setup in 02_setup.js.)
- Shadow caster cap: only nearest 4 characters cast (`_updateAllCharShadows`).
- Merged bot guns (~13 part-meshes → 1) and bushes (5 meshes/bush → 1, shared mat).
- Removed per-frame heap allocations (Object.entries/values in the char loop, array
  spreads, Vector3 churn) to cut GC stutter.
- Bot LOS raycast moved to only-when-about-to-fire (was every frame per engaging bot).
- Rig cloning (the big one-time CPU cost: SkeletonUtils.clone + mixer binding, ~12
  rigs/bot) staggered, then pre-warmed during the idle countdown. NEW: the countdown
  timer now **waits for all rigs to load** before starting (`charLoadComplete`,
  countdown gate in 12_main.js) so the load cost is on a "…" hold, not mid-match.
- **Adaptive resolution** (`_adaptResolution`, `window._curPR`, HUD shows `Res:`):
  drops pixel ratio under load (1.5→0.7) to hold 60fps. **User reports it "still does
  it"** — so either it's not reacting fast/hard enough, OR the bottleneck is not GPU
  fill after all (i.e. CPU). Verify with the HUD `Res:` value during a drop: if it's
  pinned at 0.70 and FPS still tanks, it's NOT fill rate.

Reverted (caused a bug):
- Re-enabling `frustumCulled` on character meshes made bodies vanish up close while
  the gun stayed (bind-pose bounding sphere unreliable). Kept `frustumCulled=false`.

## Recommended next steps (data-driven, not guessing)
1. **Get a real CPU/GPU profile.** Chrome DevTools Performance trace during a canal
   cross / when-shot. `DBG.perfProbe()` has now been run (see Captured numbers above):
   it prints the census, current-view main/shadow split, and a 360° draw-call sweep.
   Still want a DevTools timeline trace of the *when-shot* spike to confirm it's the
   vignette fill cost end-to-end (the harness render-only bench can't see game CPU).
2. **If GPU/fill:** adaptive res should work — make it react harder/faster, and note
   the damage vignette composites at *device* resolution (not affected by renderer
   pixel ratio) so it may need to be drawn into the WebGL canvas or made cheaper.
3. **If CPU:** the prime suspect is the **rig architecture** — separate cloned scene
   per animation per character (10 bots × ~13 rigs = ~130 clones). The correct fix is
   ONE skinned mesh per character with all clips as `AnimationAction`s on a single
   mixer (~10 clones total, 13× fewer). Risk: the manual crossfade + hips XY root-
   motion lock were carefully tuned (see memory `feedback_animation_rootmotion`) and
   could regress. Also check `updateCharacterVisual`'s per-bot `updateMatrixWorld(true)`
   (forces a 66-bone recompute every frame for the gun-fit IK).
4. **Reduce main-pass overdraw at the corner spawn:** distance-cull or merge the
   static world (prison ~80 meshes, loot temples, etc.) since there's no occlusion
   culling and the whole island is in the frustum from the prison.

Key globals: `DBG.perfProbe()`, HUD `Res:`/`Calls:`/`Tris:`, `window._curPR`,
`_adaptResolution`, `_updateAllCharShadows`, `charLoadComplete` (all 06_bots/12_main).

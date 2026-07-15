# Browser client

The integration shell + cross-cutting plumbing. `stellata.ts` is the
Three.js scene + state machine + event bus that composes the
per-subsystem controllers. Per-subsystem folders (every other
directory under `src/client/`) own their own topic and document
themselves.

## Folder layout

- `main.ts`, `stellata.ts`, `index.html`, `styles.css`, `globals.d.ts`
  — bootstrap + integration shell.
- `stellata-events.test.ts` — integration-shell event-emission test.
- `util/` — project-agnostic plumbing (event bus, URL state).
- `camera/` — camera controllers split across `controls/`, `warp/`,
  `observe/`, `arrival/`.
- `star-pipeline/`, `solar-system/`, `local-group/`, `milkyway/`,
  `galactic/`, `molecular-clouds/`, `chart-mode/`, `dust/` — render
  layers.
- `hover/`, `overlays/`, `ui/`, `typeahead/`, `modals/`, `debug/` —
  cross-cutting UI.
- `loaders/` — runtime fetch/parse of `public/` artifacts.

## Event bus on `Stellata`

Subscribers register via `stellata.on(name, fn)` and receive a typed
payload per event. `on` returns an unsubscribe — call it to detach.
The payload map is `StellataEventMap` in `stellata.ts`.

- `'focus'` (`number | null`) — focused star changed (from any source).
- `'cloudFocus'` (`number | null`) — focused molecular cloud changed.
- `'lgFocus'` (`number | null`) — focused Local Group object changed.
- `'planetSystem'` (`PlanetSystem | null`) — focused star's planet
  system loaded, cleared, or swapped.
- `'vector'` / `'vectorCloud'` / `'vectorLg'` (`number | null`) —
  distance-vector destination changed (the three destination kinds are
  mutually exclusive).
- `'filter'` (`Readonly<FilterState>`) — any filter patch applied.
- `'cameraMode'` (`'navigate' | 'observe'`) — camera mode flipped.
  Used by the mode toggle, search-row label swap, and scale-bar
  (which switches to angular degrees in observe).
- `'warp'` (`boolean`) — warp animation start/finish.
- `'pois'` (`readonly number[]`) — pinned-star list changed (shared
  across camera modes — see `poi/README.md`).
- `'noopClick'` (`{ x, y }`) — a canvas click ran its per-mode
  dispatch and changed nothing (empty sky, rejected pin). Drives the
  click-ripple feedback overlay; clicks that did something don't emit
  it.
- `'frame'` (no payload) — called after each render, used by all SVG
  overlays.
- `'state'` (no payload) — fires on any discrete state mutation. This
  is what the URL-sync module listens to. Don't fire it from a
  `'frame'` handler for camera changes — the URL sync has its own
  frame hook with hash comparison for that.

Emission pairing: each fine-grained mutation event (`'focus'`,
`'cloudFocus'`, `'vector'` / `'vectorCloud'`, `'filter'`,
`'cameraMode'`, `'pois'`, warp start) is followed by a `'state'` emit
from the same mutation site, so a `'state'` subscriber observes every
mutation without enumerating the fine-grained names. `'planetSystem'`
(derived from a focus change that already paired with `'state'`),
`'frame'`, `'focusLerp'`, `'noopClick'` (transient feedback, not a
state mutation), and the warp-end edge emit alone.

## Click-state machine (`stellata.ts`)

Canvas clicks in BOTH modes are held for `DBL_CLICK_MS` (280 ms) by a
shared `PendingClickDispatcher` (`util/pending-click.ts`) so single
and double clicks disambiguate; the deferred handlers re-check the
warp / aim / transition guards at fire time.

Navigate single-click on a star (`applyStarClick`):

| condition | action |
| --- | --- |
| no focus | focus on clicked star |
| clicked = focused, no vector | unfocus |
| clicked = focused, vector drawn | clear vector (stay focused; the destination stays pinned) |
| clicked = other star, unpinned | pin as POI (ladder rung 1 — Sol / at-cap fall through to rung 2) |
| clicked = other star, pinned, not vector destination | set vector focus → clicked |
| clicked = other star, pinned + vector destination | clear vector AND unpin |

The ladder decision table is `poi/click-ladder-pure.ts`; the pin
rungs require the HUD (`showHud`) to be on — pins are HUD widgets, so
with the HUD hidden clicks step only the vector rungs. Navigate
**double-click** on any star travels to it (`focusStar` — the
focus-park teleport that clicking the vector tip used to trigger;
lerps over `FOCUS_LERP_MS` or no-ops when already inside park);
double-click on a cloud runs `flyToCloud`. The POI overlay's
on-screen labels route through the same `applyStarClick` semantics.

Cloud clicks keep the pre-ladder vector-first semantics (orbit-target
on first pick from no focus, vector destination on pick from a focus,
click-destination-to-travel) — unreachable while the MC layer is
shelved (`src/client/molecular-clouds/README.md`); revisit the ladder
fit at un-shelve.

In OBSERVE mode single-click is the pin/unpin toggle
(`applyStarClick`'s observe branch, gated on `showHud`) and
double-click slerps the camera so the clicked direction lands at view
centre; drags land on the custom look-around controller
(direct-manipulation drag + wheel-FOV). The SVG-layer Sol/GC arrow
labels remain clickable; they route through `aimAt(localPoint)`,
which has its own observe-mode branch that slerps the camera
quaternion in place.

## Floating origin (large-world precision)

Close-range orbit of a star far from Sol used to jitter visibly because
Three.js composes its `modelViewMatrix` at float32 precision. At 1 kpc
from Sol, the translation column quantises to ~10⁻⁴ pc — 2–3% of the
min-orbit radius — so every frame the projected position snapped around
by a few pixels.

Fix: the renderer runs in a **floating local frame** whose origin tracks
the currently focused star.

- `Stellata.worldOffset` is the absolute-space coordinate that
  currently sits at the renderer's (0,0,0). Starts at Sol.
- `Stellata._localPositions` (exposed via `stellata.localPositions`)
  is a `Float32Array` of `catalog.positions − worldOffset`. It's bound
  to the `iPosition` instance attribute and is what every overlay and
  pick path projects through.
- `Stellata.recenterOrigin(newOrigin)` (exposed via the `FrameAnchor`
  seam) rewrites the local-positions buffer using JS Number (= float64)
  subtraction and shifts `camera.position` and `controls.target` by the
  same delta so the user sees no jump. The two callers are
  `FocusController.recenterFocusToStar` (focus mutations) and
  `WarpController.tryMidFlyRecentre` (mid-flight pivot onto the
  destination).
- `FocusController.setFocus(idx)` calls `recenterOrigin` on focus, then
  snaps `controls.target` onto the focal star's **live** local position
  (catalog baseline + orbital perturbation), not the bare local origin —
  a binary member sits at its perturbed position. For a non-orbiting star
  that live position IS the local origin. **Unfocus does *not* recenter**
  — `worldOffset` stays at the former focal object so
  camera/target/iPosition all remain in their float32-clean local frame.
  Recentering on unfocus used to cause a visible jump (the `idx===null`
  branch shifted `target` by the focal star's full world position,
  breaking the pin invariant below and re-introducing cancellation in the
  projection chain).
- **Focal-frame ride.** A focused binary member drifts along its orbit
  each frame; the shell translates `camera.position` + `controls.target`
  (and in-flight camera-transition pose caches) by that per-frame drift
  so the star stays under the camera and the pin stays engaged. Focus and
  unfocus of a pair member therefore cause no position discontinuity —
  see `binaries/README.md` § Focal-frame ride.
- **Default-load** (a7d.2.8) auto-engages `setFocus(catalog.solIndex)`
  before the first frame so URL-less loads start with the pin engaged
  and the per-Sol orbit floor in effect, matching every other entry
  point (warp arrival, observe→navigate, search-select). The URL
  encoder treats Sol as the canonical default focus and *omits* the
  field when focused on Sol; "explicitly unfocused" rides a separate
  presence bit so the three states (default-Sol / specific star /
  cleared) round-trip unambiguously.

The key precision win: the big `absolute − offset` subtractions happen
in JS float64 on the CPU, producing small float32 deltas near zero with
~10⁻³⁸ resolution. The GPU's modelview matrix then only carries
kilo-parsec-scale values when the camera is far from the local origin
(i.e. zoomed out, where pixel-level jitter is imperceptible anyway).

Implications for code that reads positions:
- **Rendering / projection math** must use `stellata.localPositions`
  (same frame as `camera.position` and `controls.target`). The disc
  mask, focus ring, distance vector, constellation overlay, and all
  `Picker.pickStar` / `renderedSizePx` / `aimAtConstellation` paths
  do this.
- **Distance-from-Sol** (the distSol filter, the Sol locator-arrow
  label) must use `catalog.positions` *or* must compute
  `||localPosition + worldOffset||` in JS float64. (Hover-card and
  focus-card distances are camera-relative by design — they read the
  local frame directly.) The shader's
  distSol filter consumes a precomputed per-instance `iDistSol`
  attribute instead of `length(iPosition)`, because the latter is now
  a local-frame value. The Sol arrow uses the float64 sum approach so
  its distance label updates correctly under any focus.
- `starLocalPosition(i)` (formerly `starWorldPosition`) returns the
  local-frame vector — use it for camera math, never for Sol-distance.

URL round-trip works without special handling for the focused case
because sender and receiver both recenter on the same focus star.
Camera/target serialise in local frame; loading the URL recenters to
the same absolute origin and the local coordinates apply unchanged.

For unfocused-but-not-at-Sol, the URL serialises a `worldOffset` field
(FIELDS_V2 bit 20, vec3 Float32, appended to the end for forward-compat
with older clients). The encoder emits it when `focusedStar === null`
AND `worldOffset` isn't ≈Sol; cam/tgt then encode in the local frame
and round-trip with full Float32 precision. The loader applies
`setWorldOffset` *before* cam/tgt and resets cam/tgt to defaults so a
missing `view.cam` / `view.tgt` produces a sane pose in the new local
frame. Old URLs without `worldOffset` decode as Sol-anchored (legacy
behaviour).

The general design treats `worldOffset` as a free Float32 vec3 anchor
(not a catalog ref): future object types (clouds, planets, probes,
exoplanets) can each set it on focus without coupling to the star
catalog index space. Float32 precision is sufficient at any magnitude
because the user-visible pose is the cam/tgt offset *within* the
local frame, stored at full Float32 precision relative to the anchor.

## Full render stack — front to back

The full layer composition is something `stellata.ts` owns at the
integration shell — each subsystem renders into the same scene, and
which layer wins which pixel is the property that emerges here.
Each row links to the README that owns the layer's implementation.

There is no z-ordering between WebGL and SVG. The WebGL canvas paints
first; the SVG `#overlay` always sits above it (`z-index: 5`,
`pointer-events: none`). Inside each layer the ordering is local:
WebGL by `THREE.Object3D.renderOrder`, SVG by source order in
`src/client/index.html` (later child = on top). The disc-mask cuts
holes through the constellation stick-figure path so close discs read
as if they were in front of the lines — it is not a real z-order
mechanism.

| Layer                                            | Surface | Mechanism                                          | Order | Owner |
| ------------------------------------------------ | ------- | -------------------------------------------------- | :---: | ----- |
| Focus ring                                       | SVG     | source order (last child)                          | front | [overlays/](overlays/README.md) |
| Click ripple                                     | SVG     | source order                                       |       | [overlays/](overlays/README.md) |
| Heliopause label                                 | SVG     | source order                                       |       | [solar-system/](solar-system/README.md) |
| Planet labels                                    | SVG     | source order                                       |       | [solar-system/](solar-system/README.md) |
| POI labels                                       | SVG     | source order                                       |       | [overlays/](overlays/README.md) |
| POI rings                                        | SVG     | source order                                       |       | [overlays/](overlays/README.md) |
| POI arrows                                       | SVG     | source order                                       |       | [overlays/](overlays/README.md) |
| Sol/GC arrow labels                              | SVG     | source order                                       |       | [galactic/](galactic/README.md) |
| Distance label + warp pill                       | SVG     | source order                                       |       | [overlays/](overlays/README.md), [camera/warp/](camera/warp/README.md) |
| Distance vector + bg                             | SVG     | source order                                       |       | [overlays/](overlays/README.md) |
| Sol/GC arrows + bg                               | SVG     | source order                                       |       | [galactic/](galactic/README.md) |
| HUD ring                                         | SVG     | source order                                       |       | [galactic/](galactic/README.md) |
| Galactic grid l/b labels                         | SVG     | source order (just above constellation figure)     |       | [galactic/](galactic/README.md) |
| **Constellation stick-figure**                   | SVG     | first SVG child + `mask="url(#disc-occlude-mask)"` |       | [overlays/](overlays/README.md) |
| *— SVG / WebGL boundary —*                       | —       | `.overlay { z-index: 5 }`                          | —     | — |
| Planet glow                                      | WebGL   | `renderOrder: 4`                                   |       | [solar-system/](solar-system/README.md) |
| Planet disc                                      | WebGL   | `renderOrder: 3`                                   |       | [solar-system/](solar-system/README.md) |
| Planet restore (depth-only)                      | WebGL   | `renderOrder: 2.5`                                 |       | [solar-system/](solar-system/README.md) |
| Orbit rings                                      | WebGL   | `renderOrder: 2`                                   |       | [solar-system/](solar-system/README.md) |
| Dust particles                                   | WebGL   | `renderOrder: 2`                                   |       | [dust/](dust/README.md) |
| Planet corrupt (depth-only)                      | WebGL   | `renderOrder: 1.5`                                 |       | [solar-system/](solar-system/README.md) |
| Star glow + heliopause shell                     | WebGL   | `renderOrder: 1`                                   |       | [star-pipeline/](star-pipeline/README.md), [solar-system/](solar-system/README.md) |
| Star disc                                        | WebGL   | `renderOrder: 0`                                   |       | [star-pipeline/](star-pipeline/README.md) |
| Galactic disc + grid                             | WebGL   | `renderOrder: -1`                                  |       | [galactic/](galactic/README.md), [local-group/](local-group/README.md) |
| Molecular clouds (shelved)                       | WebGL   | `renderOrder: -2`                                  |       | [molecular-clouds/](molecular-clouds/README.md) |
| Milky Way volume + Local Group emission          | WebGL   | `renderOrder: -3`                                  |       | [milkyway/](milkyway/README.md), [local-group/](local-group/README.md) |
| Star core depth-mask + planet core (depth-only)  | WebGL   | `renderOrder: -4`, `colorWrite: false`             | back  | [star-pipeline/](star-pipeline/README.md), [solar-system/](solar-system/README.md) |

### Per-layer visibility gates and tuning

Each layer owns its own visibility gates, magnitude cutoffs, and
shader tuning in its README. Look there when investigating a
"layer-isn't-showing" or "wrong layer wins this pixel" report.

The two cross-layer pinning rules `stellata.ts` is responsible for:

- **`-4` core depth masks** run first so background layers (MW,
  clouds, galactic grid — all with `depthTest: true`) depth-fail
  behind close-range bright cores instead of bleeding through. Stars
  and planets share this slot; both write opaque depth with
  `colorWrite: false`.
- **`1.5` + `2.5` planet outer-disc corrupt + restore pair** is the
  mechanism that keeps the planet reading as a solid body across an
  orbit ring. The corrupt pass at 1.5 writes `gl_FragDepth = 0.0`
  across the planet's core region; the orbit ring at `renderOrder 2`
  then depth-fails at every fragment landing on the planet's body —
  far-side AND near-side, regardless of the ring's actual 3D
  position. The restore pass at 2.5 writes the planet's actual
  `gl_FragCoord.z` back across the same region (with
  `depthFunc: AlwaysDepth` so it can overwrite the 0.0), so the disc
  and glow passes at 3 / 4 still depth-test correctly against other
  planets and stars. The `planet-body-field` test pins these values
  for the five planet passes; a future reorder fails CI rather than
  silently regressing. See [solar-system/](solar-system/README.md)
  for the rationale in context.

Within the same `renderOrder` value, the opaque-before-transparent
rule of the three.js renderer determines order; opaque depth-write
meshes establish the depth buffer that transparent passes test
against.

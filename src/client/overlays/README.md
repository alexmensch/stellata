# SVG overlays

The SVG layer above the canvas. The focus ring, the distance vector
with near-plane clipping, the HUD ring + Sol/GC arrows, the per-frame
world-to-screen projector, and the shared arrow geometry helper. The
constellation stick figure is now WebGL line geometry — see
`../constellation-figure/README.md`.

## Files in this area

```
src/client/overlays/
  distance-vector-overlay.ts      Yellow distance line A → B with
                                  near-plane clipping; chevrons +
                                  distance label (click = aim at the
                                  destination; warp stays on W).
  focus-ring-overlay.ts           SVG ring around the focused object
                                  (any hard kind — kind-generic).
  hud-overlay.ts                  HUD ring + Sol/GC SVG arrows — see
                                  src/client/galactic/README.md.
  poi-overlay.ts (+ test)         Pinned-POI labels + rings + arrows
                                  (both camera modes).
  click-ripple.ts (+ test)        Noop-click feedback: a ring ripples
                                  out from the click point to the
                                  POI-ring radius and collapses back —
                                  fires ONLY for clicks that changed
                                  nothing (empty sky, POI cap);
                                  successful actions carry their own
                                  feedback. Driven by the 'noopClick'
                                  bus event.
  dirty-attr.ts (+ test)          Dirty-tracked SVG attribute writer
                                  (sentinel-init pattern — see
                                  docs/authoring-patterns.md).
  overlay-project.ts (+ test)     Shared world → screen-space projector
                                  with near-plane clipping. projectToScreen
                                  allocates a fresh tuple per call;
                                  projectToScreenInto writes into a
                                  caller-owned tuple for per-frame hot
                                  paths (focus ring, HUD).
  anchored-label.ts (+ test)      placeAnchoredLabel — position an SVG
                                  label at its anchor's projected point
                                  plus an offset, or hide it when the
                                  anchor is at/behind the near plane.
                                  The per-entry half of the object-label
                                  families (planets, probes); the
                                  offset is a parameter, since each
                                  family owns its own gap from its
                                  referent.
  arrow-fade.ts (+ test)          Shared shaft-fade curve for Sol/GC
                                  arrows + future arrow consumers.
  arrow-path.ts (+ test)          Shared arrow geometry (shaft + head)
                                  used by hud-overlay and others.
  target-name.ts                  targetDisplayName — per-kind display
                                  name for any Target; shared by the
                                  POI labels and the distance-vector
                                  destination label.
```

## Vector clipping at the near plane

When the destination star is behind the camera (common at close zoom —
Betelgeuse goes behind the camera when the camera is within ~20 pc of Sol),
`distance-vector-overlay.ts projectWithNearClip`:

1. transforms both endpoints to view space,
2. if destination's `viewZ >= -near`, solves for the line/near-plane
   intersection and uses it as an "effective destination" strictly in front,
3. caps the off-screen point at 1.5× viewport diagonal so SVG coords stay
   sane,
4. when the chevron tip is off-screen, anchors the distance label to
   the line's viewport-exit point (Liang-Barsky `tExit`) so it stays
   attached to the visible shaft, then clamps to `LABEL_PADDING_PX`
   from any edge.

If you see a disappearing vector, check this logic first.

## OBSERVE-mode hides

Two SVG layers conditionally hide while `cameraMode === 'observe'`:

- **Focus ring** (`focus-ring-overlay.ts`) — hidden in steady-state
  observe (the ring is meaningless when the camera sits *at* the focal
  object), but during the navigate↔observe transition its radius lerps to
  0 (enter) or back to 24 px (exit) instead of hard-hiding so it visually
  morphs through the HUD ring. The eased progress comes from
  `Stellata.getObserveTransitionProgress()`.
- **Distance vector + To-row** — distance-vector measurement is
  meaningless from a camera parked on its own anchor; the search
  box's To-row hides via `syncFocusUI` and the underlying
  `setVector` slot guards against observe-mode writes defensively.

The Sol/GC arrows + the HUD ring do **not** hide — they're the HUD,
gated by `filter.showHud` independently of camera mode. In OBSERVE the
arrows attach to the HUD ring rim and swivel around it; through the
transition the focus ring shrinks while the HUD ring grows so the
arrows stay tangent to whichever circle is dominant.

## Chart-mode labels and glyphs

`chart-labels.ts` adds two SVG layers under `#overlay` while chart
mode is active:

- `<g id="chart-labels">` — `<text>` elements for proper-named stars,
  Bayer-letter Greek glyphs, constellation Latin names, and molecular
  cloud names. Greedy collision pass over axis-aligned bounding rects;
  constellation names bypass it entirely (outline-style typography
  that reads as a sparse semi-transparent overlay à la Sky Atlas).
- `<g id="chart-glyphs">` — `<circle class="chart-variable-ring">`
  around variable stars, `<line class="chart-binary-wings">` through
  binary primaries. Both screen-aligned by construction (SVG line
  uses viewport coords; circles are circles regardless of camera
  roll).

Both layers pool their elements by stable key per frame so adding /
removing entries is free. The same `renderableAppMag` filter that
gates the GPU disc also gates the glyphs — a hidden inner disc takes
its ring or wings offscreen with it. The magnitude-driven sizing
formula + flux-weighted constellation centroid math live in chart
mode's renderer.

## Points of interest

`poi-overlay.ts` renders the user-pinned object list — every pinnable
kind through one Target-keyed pool (state + pin semantics in
`../poi/README.md`); positions dispatch through
`stellata.focusables`, names through `target-name.ts`, so a new
pinnable kind needs no overlay edit — in BOTH camera modes. Three SVG
groups under `#overlay`:

- `<g id="poi-arrows">` — pooled `<path>` + `<text>` per POI for
  off-screen arrows. Arrow geometry comes from `buildArrowSvgPath()`
  (shared with Sol/GC arrows in `hud-overlay.ts`); anchor + shaft
  start reuse `hudAnchorInto()` / `computeShaftStartRadius()` so POI
  arrows attach to the same active ring as Sol/GC (focus ring in
  navigate, HUD ring in observe). The arrow set shares one
  disc-coverage fade alpha keyed on its longest drawn shaft
  (`arrow-fade.ts`), mirroring the Sol/GC pair. Label text is the
  POI's best name only.
- `<g id="poi-rings">` — pooled `<circle class="poi-ring">` per POI,
  shown when the POI projects on-screen. Fixed 24 px radius (matches
  `focus-ring-overlay.ts`) so the ring + label sit at a constant pixel
  distance from the star regardless of camera FOV — important because
  the rendered disc grows/shrinks with FOV, but the ring doesn't.
- `<g id="poi-labels">` — pooled `<text>` per POI for on-screen labels
  anchored just outside the ring rim along a 45° diagonal. Format:
  `name · constellation-code · distance-from-camera` (constellation
  code is a star-kind field; planet labels carry name + distance) (live camera, per
  the tier-1/2 frame principle — in observe the camera is parked at
  the focal star, so it reads as distance from the observed star).

Click affordances (both label classes set `pointer-events: auto`):
- **On-screen label** → `Stellata.applyObjectClick(target)` — the same
  per-mode semantics as clicking the object itself (unpin toggle in
  observe, click ladder in navigate); the label is a second, larger
  click target.
- **Off-screen arrow label** → `Stellata.aimAt(localPositions[idx])`
  slerps the camera so the POI lands at view centre. Mirrors the
  Sol/GC label affordance in `hud-overlay.ts`.
- **Ring** stays `pointer-events: none` so the star underneath remains
  the primary click target.

Visibility is gated as a single HUD layer: the whole stack hides when
`filter.showHud` is off, during warp (via `body.warping #overlay`
CSS), and during the navigate↔observe transition. The FOCUSED star's
own pin is chrome-suppressed per frame (ring/label/arrow hidden; the
pin itself survives and its chrome returns on unfocus or refocus
elsewhere) — a POI badge on the object the camera is parked at is
noise. Chart-mode (`body.monochrome`) styling flips every HUD
stroke (gal-arrows, HUD ring, POI ring + arrow + labels) to a deep
saturated blue (`rgba(30, 64, 175, 0.85)`, the existing `--accent`
token) with a thin white halo on labels — distinct from pure-black
chart ink so the HUD reads as a separate navigational layer, ~7:1
contrast against the beige paper background. See `.poi-arrow`,
`.poi-label`, `.poi-arrow-label`, and `.poi-ring` in `styles.css`.

POIs survive page reloads via the `?v=` blob (encoded as frozen
Stellata IDs in any camera mode — see `../util/url-state/README.md`)
and persist across observe↔navigate switches; unpinning is always an
explicit per-POI action.

## Dirty-track strategies: signature vs per-attribute

Two dirty-track styles coexist in this layer; both are valid but they have
different sweet spots, and **the next overlay's author should pick on
purpose, not by mimicry of whichever neighbour they read first.**

- **Whole-frame signature** (used by `scale-bar.ts`). Build one
  `sig = '...|...'` string at the top of `onFrame` keyed on every input
  that drives any output, compare against `lastSig`, bail when matched.
  When the signature differs, redraw every attribute unconditionally.
  - **Wins when:** every attribute is keyed off the same small set of
    inputs (bar pixel count + label string drive both the horizontal
    bar geometry AND every z-axis line). A stationary frame skips the
    whole geometry computation; a changing frame redoes it wholesale.
  - **Loses when:** independent attributes can change at different rates
    — one independent input flipping forces the full redraw even though
    only one attribute would actually change.

- **Per-attribute dirty-track** (used by `distance-vector-overlay.ts`,
  `hud-overlay.ts`, `poi-overlay.ts`). Always run the full per-frame
  computation, then gate
  each `setAttribute` / `setStyle` / `textContent` write through
  `dirty-attr.ts` helpers (`setNumAttr`, `setStrAttr`, `setStyle`,
  `setText`) against a per-attribute sentinel.
  - **Wins when:** independent attributes change at different rates (HUD
    ring radius + arrow path + label all driven by independent inputs).
    The cheap attributes skip their writes even when an expensive
    attribute changed.
  - **Loses when:** the per-frame computation itself dominates and every
    attribute keys off the same input — strictly more JS work than the
    signature gate on a stationary frame.

The **default for new overlays is per-attribute**, matching the pattern's
existing consumers. Pick whole-frame signature only when the
inputs collapse cleanly into a small key string AND the per-frame
computation is more expensive than the SVG writes it would gate. Mixing
the two strategies on a single overlay's outputs is a mistake — the
shapes don't compose.

The poison-init rule applies to both: sentinels (closure variables for
signature, helper-call arguments for per-attribute) must be initialised
to a value the first real write cannot match (`'\0'` for strings, `NaN`
or `-Infinity` for numbers depending on the gate direction, `null` for
booleans). Without poison init, the first matching-state write silently
no-ops and the element paints at SVG defaults.

## SVG hide semantics

Missing coordinate attributes on SVG elements default to **0**, not "don't
render". So `line.removeAttribute('x1')` leaves a stale line at x=0. Hide
using either:

- `element.style.display = 'none'` (used for the focus ring circle), or
- `path.setAttribute('d', '')` (used for the chevron path), or
- `polygon.setAttribute('points', '')` (used for the constellation hull).

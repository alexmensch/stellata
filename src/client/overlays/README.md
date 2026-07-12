# SVG overlays

The SVG layer above the canvas. Constellation stick-figures, the disc
mask that lets WebGL stars show through SVG paths, the focus ring,
the distance vector with near-plane clipping, the HUD ring + Sol/GC
arrows, the per-frame world-to-screen projector, and the shared arrow
geometry helper.

## Files in this area

```
src/client/overlays/
  constellation-overlay.ts        Stellarium HIP polyline asterism
                                  renderer; masked by disc-mask.
  disc-mask.ts (+ pure + test)    Per-frame circle cutouts for the
                                  most-recently-focused star + binary
                                  companion + highlighted constellation's
                                  vertex discs.
  distance-vector-overlay.ts      Yellow distance line A → B with
                                  near-plane clipping; chevrons +
                                  distance label (click = aim at the
                                  destination; warp stays on W).
  focus-ring-overlay.ts           SVG ring around the focused star.
  hud-overlay.ts                  HUD ring + Sol/GC SVG arrows — see
                                  src/client/galactic/README.md.
  poi-overlay.ts (+ test)         Pinned-POI labels + rings + arrows
                                  (both camera modes).
  dirty-attr.ts (+ test)          Dirty-tracked SVG attribute writer
                                  (sentinel-init pattern — see
                                  docs/authoring-patterns.md).
  overlay-project.ts (+ test)     Shared world → screen-space projector
                                  with near-plane clipping. projectToScreen
                                  allocates a fresh tuple per call;
                                  projectToScreenInto writes into a
                                  caller-owned tuple for per-frame hot
                                  paths (disc-mask, focus ring,
                                  constellation lines, HUD).
  arrow-fade.ts (+ test)          Shared shaft-fade curve for Sol/GC
                                  arrows + future arrow consumers.
  arrow-path.ts (+ test)          Shared arrow geometry (shaft + head)
                                  used by hud-overlay and others.
```

## Constellation stick-figure overlay

`FilterState.showConstellation` is the master visibility flag for both
the stick-figure overlay and the chart-mode Latin-name labels (default
on, panel toggle at the top of Overlays). When false the overlay clears
itself and skips the per-frame projection pass entirely; the picker UI
in the panel is also disabled while the flag is off so users can't
mutate the unseen `highlightCon`.

When a constellation is highlighted, `constellation-overlay.ts` draws
the classical asterism lines (sourced from Stellarium at build time
and embedded in `public/constellations.json`) as an SVG
`<path id="con-figure">`. Every segment is emitted as a separate
`M..L..` subpath with both endpoints pulled back by `STAR_GAP_PX`, and
the path uses `stroke-linecap: round`. Net effect: each stick-figure
line is a rounded-end segment with a circular gap around every
vertex star, so the actual star glyphs remain visible through the figure.

The `<path>` also applies `mask="url(#disc-occlude-mask)"`. The mask is
driven per-frame by `disc-mask.ts` which cuts out circles at the
projected position + rendered size of every visible disc that the lines
might pass through: the **most-recently-focused** star + its binary
companion (not the *current* focus — the mask persists after Esc so the
just-unfocused star stays masked while its disc still clears the
threshold; the entry self-evicts when the disc shrinks below it), plus
every vertex star in the highlighted constellation whose disc still
exceeds the threshold. Iterating constellation members (rather than
scanning the catalog) bounds the work to the few dozen vertex stars per
constellation; the cutout pool grows on demand. That gives the visual
effect of constellation lines passing *behind* a close-range resolved
disc rather than being painted on top of it. The cutout circle's radius
tracks the disc's variable-star pulsation exactly via `renderedSizePx`
replicating the shader math, so there's no stale gap as a variable
shrinks. SVG renders above the canvas unconditionally, so this masking
is the only practical substitute for real z-ordering between WebGL
content and SVG overlays.

Earlier versions also drew a convex hull around the top-N brightest
constellation members. That layer was removed — the hull is defined by
*what's bright from Earth*, while the figure is defined by *what humans
traditionally drew as the shape*. When the camera isn't at Sol those
two answers diverge, and showing the hull was more confusing than
helpful. The 3D-deforming stick figure alone conveys the intent.

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

Three SVG layers conditionally hide while `cameraMode === 'observe'`:

- **Focus ring** (`focus-ring-overlay.ts`) — hidden in steady-state
  observe (the ring is meaningless when the camera sits *at* the focal
  star), but during the navigate↔observe transition its radius lerps to
  0 (enter) or back to 24 px (exit) instead of hard-hiding so it visually
  morphs through the HUD ring. The eased progress comes from
  `Stellata.getObserveTransitionProgress()`.
- **Disc mask cutouts** (`disc-mask.ts`) — all cutouts (focal,
  companion, and constellation members) are skipped when in observe.
  The focal disc isn't rendered, and any other disc-rendering star
  would have to be near enough to a camera parked at the focal star
  to clear the threshold — far enough away in practice that the
  whole-mask early-return is a safe simplification. The
  camera-position invariant is enforced in `stellata.ts setFocus` —
  on observe entry the camera moves to the focal star's local origin
  (`camera.position.set(0, 0, 0)` after the floating-origin recentre),
  so every other catalog star sits at least one inter-star gap away
  (parsec-scale at minimum), well beyond `DISC_THRESHOLD_PX` at any
  reasonable FOV.
- **Distance vector + To-row** — distance-vector measurement is
  meaningless from a camera parked on its own anchor; the search
  box's To-row hides via `syncFocusUI` and the underlying
  `setVectorTo` / `setVectorToCloud` setters guard against
  observe-mode calls defensively.

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

`poi-overlay.ts` renders the user-pinned star list (state + pin
semantics in `../poi/README.md`) in BOTH camera modes. Three SVG
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
  `name · constellation-code · distance-from-camera` (live camera, per
  the tier-1/2 frame principle — in observe the camera is parked at
  the focal star, so it reads as distance from the observed star).

Click affordances (both label classes set `pointer-events: auto`):
- **On-screen label** → `Stellata.applyStarClick(idx)` — the same
  per-mode semantics as clicking the star itself (unpin toggle in
  observe, click ladder in navigate); the label is a second, larger
  click target.
- **Off-screen arrow label** → `Stellata.aimAt(localPositions[idx])`
  slerps the camera so the POI lands at view centre. Mirrors the
  Sol/GC label affordance in `hud-overlay.ts`.
- **Ring** stays `pointer-events: none` so the star underneath remains
  the primary click target.

Visibility is gated as a single HUD layer: the whole stack hides when
`filter.showHud` is off, during warp (via `body.warping #overlay`
CSS), and during the navigate↔observe transition. Chart-mode (`body.monochrome`) styling flips every HUD
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

- **Per-attribute dirty-track** (used by `constellation-overlay.ts`,
  `disc-mask.ts`, `distance-vector-overlay.ts`, `hud-overlay.ts`,
  `poi-overlay.ts`). Always run the full per-frame computation, then gate
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

The **default for new overlays is per-attribute**, matching the five files
the pattern scaled to in PR #55. Pick whole-frame signature only when the
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

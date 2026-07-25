# Hover labels

The hover-label subsystem (`src/client/hover/`) surfaces a small floating
card next to the cursor after a 280 ms dwell. One engine, many providers:
each renderable layer (stars, Sol planets, Local Group wireframes,
boundary shells — Local Bubble + heliopause, future nebulae / Radcliffe
Wave segments / probes)
implements `HoverProvider` and registers with the engine; the engine
owns the pointer listener, the dwell timer, the cross-provider
disambiguator, and the `#tooltip` render.

## Files in this area

The full file roster is in § Architecture below. The hover subsystem
lives entirely under `src/client/hover/`:

- `hover-engine.ts` — the engine.
- `hover-types.ts` — the `HoverProvider` contract.
- `hover-pick-disambiguator.ts` — cross-provider picker tiebreak.
- `*-hover-provider.ts` (one per layer) — stars, planets, Local Group,
  heliopause, boundary shells (`shell-hover-provider.ts`, dispatching
  over the `ShellRegistry`), …
- `formatters/*-hover-format.ts` (one per layer) — pure functions with
  their own vitest coverage.

## Architecture

- **`hover-engine.ts`** — canvas pointer listener, 280 ms dwell, 14 px
  pick threshold, hide-on-drag / hide-on-leave / hide-on-pointermove
  gating, tooltip placement and on-screen clamping. Provider-agnostic;
  pulled out of the prior `bindHoverTooltip` so future layers wire in
  without engine edits. The bottom/right clamps come from a
  `getBoundingClientRect()` measure of the rendered card — never from a
  copy of the CSS `max-width` or a hand-calibrated worst-case height, so
  tooltip padding / line-height edits can't drift the clamp.
  Measurement runs with the card parked at the origin: it's
  shrink-to-fit, so measuring at its previous position would size it
  against the viewport space left over there. Both clamps then inset by
  the shared page margins (`../ui/page-margins.ts`), so a cornered card
  lines up with the panel and scale bar rather than sitting flush to the
  viewport edge.

  Only `pick` receives the pixel threshold. Providers whose pick surface
  is a whole silhouette (boundary shells, clouds) ignore it, and their
  `Picker` methods don't accept it — the parameter belongs to
  centroid-plus-radius pick surfaces only.
- **`hover-types.ts`** — the `HoverProvider` contract:
  `pick(event) → HoverHit | null` and
  `format(hit) → HoverPayload | null`. Both halves signal "nothing
  here" with `null`, and the engine skips the render on either — a
  formatter whose state moved between pick and format must return
  `null`, never `{ name: '', lines: [] }`, which would paint a blank
  card at the cursor.
  `HoverPayload` is `{ name, lines: string[] }` — at most ~5 sub-lines
  per the design gate so the card stays glanceable. `HoverHit`'s
  optional `hostStarIdx` sub-key is deliberate and stays: a planet is
  identified by `(hostStarIdx, planetIdx)`, and the SID resolver does
  NOT subsume it — its planet domain maps sid → planet index with the
  host only implicit (Sol today), so replacing the field with a
  resolver detour would hardcode Sol and lose the multi-host readiness
  the exoplanet epic needs.
- **`hover-pick-disambiguator.ts`** — when multiple providers return a
  hit for the same cursor position, pick the closest to the camera, with
  the prime/fallback tier as the higher-priority key. Prime always beats
  fallback regardless of camera distance.
- **`*-hover-provider.ts`** — one per layer. Owns the pick path,
  typically mirroring the renderer's draw predicate (see Rule 2 below).
- **`formatters/*-hover-format.ts`** — one per layer. Pure functions
  with their own vitest coverage; the provider calls into them.

## UX conventions

These rules apply to every provider and to any future always-on hover
affordance added later (click-to-pin, sticky tooltips, mobile-touch
hover analogue, etc.).

### Rule 1 — Spell out unit / quantity terms

Sub-lines write quantity names out in full (`Radius`, `Period`, `Vmag`)
rather than the bare initial letter (`R`, `P`, `V`). Single-letter
labels are too compressed for the user's eye to parse at a 280 ms hover
delay; the user has time to read a word.

`Vmag` is the canonical shorthand for V-band apparent magnitude in this
UX. Use `Vmag` verbatim in new providers that surface a V-band apparent
magnitude.

The prefix convention is for measured-quantity sub-lines, not for
free-form location strings. The bare distance-and-context first line
is fine without a label when it reads as a location (`Lyra · 7.1 pc`,
`0.310 AU · Vmag -2.5`).

**The one exception: standard orbital-element symbols.** The binary
companion lines (`../format/star-companion-format.ts`) label with
`P` / `e` / `ρ` / `PA`, and new orbital fields should too. These are how
every source catalogue names the elements (WDS, ORB6, Gaia NSS), the
symbols read as a set on one line (`P = 79.91 yr · e = 0.52`), and
spelling them out (`Eccentricity 0.52`) is *less* legible to anyone
reading an orbit — the opposite of what the rule is for. The exception is
this symbol set only; every other quantity spells its name out.

### Rule 1a — Line ordering for object cards

The planet/moon hover card layout:

```
<name>
<distance> · Vmag <m>
Period <years> yr        (a moon reads days: "Period 3.55 d")
Radius <R⊕> (<km> km)
Moons Io, Europa, …      (moon-parenting planets only; capped at
                          HOVER_MOON_NAME_CAP names with a "+N more"
                          tail — the natural inverse of a moon's
                          "Orbits Jupiter" breadcrumb)
```

Reasoning: the distance line pairs naturally with apparent magnitude —
both are camera-relative quantities that change as the camera moves
(every tier-1/2 distance is from the CAMERA, per the lo5 frame
principle; Sol-centred values are tier-3 territory). Period sits on its
own line as the user's first "is this a fast inner planet or a slow
outer one?" tell — sourced from the shared `OrbitDescriptor`
(`../solar-system/orbit-descriptor.ts`) so it matches the focus card
exactly and a moon's period derives from its parent planet's mass (in
days), not the solar-mass years a planet uses. Radius sits on the bottom as the physical-body fact
that doesn't change with viewpoint.

Layout shape (distance+mag line, then per-quantity stack lines)
generalises to other layers: camera-relative quantities on the first
sub-line; intrinsic per-object quantities on their own lines below.

### Rule 2 — Visibility ⇒ hoverable. No focus-gate on hover.

Hover providers do NOT gate `pick` or `format` on the focused-host or
focused-star state. Any object the user can see on screen — and only
objects the user can see — should surface a hover card.

How to apply:

- Providers gate ONLY on visibility — magnitude-cutoff for emissive
  objects, distance / extent culling for wireframes, layer-shelved flags
  for un-registered providers. The same visibility logic the renderer
  uses to decide "draw this quad or not" is the right gate.
- For the planet layer specifically: the planet shader emits no quad
  when `appMag > maxAppMag + 0.5`; the picker mirrors that exact kill
  condition. NO additional gate on `focusedPlanetSystem !== null`.
  The one non-visibility drop: a body collapsed onto its parent
  (`isCollapsedOntoParent` — sub-pixel from host / parent planet) is
  not individually hoverable; its point belongs to the parent's pick
  surface, and the parent's card swaps to the system roster
  (`../system-membership/README.md`).
- For boundary shells (Local Bubble, heliopause): the shared shell
  provider gates each `ShellPickSurface.visible()` on the shell's
  `isVisible()` (mirrors `group.visible` — the actual rendered state), so
  a decluttered / chart-hidden / camera-inside shell isn't hoverable.

When designing or auditing a new hover provider, walk through this
checklist:

- What's the renderer's "is this drawn?" predicate? Mirror it in the
  picker.
- Is there ANY state about focus / selection / route / mode involved in
  the gating? If yes, that's wrong — strip it.

### Rule 3 — Whole-object hit surface for extended visible objects

For extended objects whose silhouette occupies meaningful screen real
estate (heliopause shell, molecular clouds, future nebulae, Radcliffe
Wave segments, large DSOs), hover hit-tests the WHOLE projected
silhouette plus the SVG label's bounding rect (when present), not a
centroid + small radius. Tier is fallback so stars and planets visible
"through" the object still win their own prime hover via the
cross-layer disambiguator.

Different layers have different natural pick mechanisms — reuse the
existing one rather than rolling a new pickbox:

- **Three.js raycast against the rendered mesh** (clouds, via
  `MolecularClouds.raycast`) — naturally hits the whole ellipsoid
  silhouette.
- **Projected sample-point AABB** (boundary shells, via the shared
  `pickShellSilhouette` helper — each shell exposes a `ShellPickSurface`
  of the same silhouette samples its label engine projects, so the hover
  surface can't drift from the label; the heliopause feeds
  `HELIOPAUSE_SAMPLE_POINTS_SOL`, the Local Bubble its wall samples).
- **Per-object angular-size disc** (Local Group wireframes — already
  small enough that the disc reads as "the whole object").

When the layer has an SVG label, also hit-test the label's
`getBoundingClientRect()`. Pull the element id from a shared exported
constant (e.g. `HELIOPAUSE_LABEL_ELEMENT_ID`) so the picker and the
label engine can't drift. The bounding rect returns zero-width-zero-
height when the element is `display: none`, so the inside-bbox check
harmlessly fails whenever the label engine has hidden the label — no
extra visibility plumbing needed for the label gate.

Compact objects (stars, planet bodies, individual catalog rows) keep
the centroid + small-radius pickbox pattern. The "extended object"
trigger is "the user sees it as a shape", not "the layer has > N
rows".

This projected-sample-AABB + label-rect logic is lifted to
`fresnel-shell/shell-pick.ts` (`pickShellSilhouette`), parameterised on a
`ShellPickSurface` (sample iterator + label id + visibility) — shared by
both boundary shells per the DRY-at-second-usage rule. A third extended
object with the same shape reuses it.

### Rule 4 — HTML hover-card typography stays monospace, even in chart mode

The `#tooltip` element is an HTML overlay, not an SVG annotation. In
chart mode the `body.monochrome .tooltip` CSS rule flips background +
text colour to the paper palette (white card, dark ink); that's
sufficient for the paper aesthetic. Do NOT additionally swap the
tooltip's font-family to match the chart-labels engraved sans-serif
glyphs — the whole HTML UI (panel, search, topbar, modals) stays
`var(--font-mono)` in chart mode, and a sans-serif tooltip breaks that
visual consistency.

The boundary is HTML-vs-SVG, not chart-vs-not-chart:

- **New HTML overlay surfaces** (tooltips, cards, modals, future
  hover-equivalent affordances): inherit `var(--font-mono)` from `body`
  and stay that way in both default and chart modes.
- **Chart-mode-specific styling for HTML overlays** is limited to
  background, colour, and border treatments — typography stays mono.
  The existing `body.monochrome .tooltip` rule is the template.
- **SVG annotations** (chart-labels, chart-glyphs,
  distance-vector-overlay, etc.) are the surfaces that adopt the
  engraved sans-serif look in chart mode.
- Backdrop-filter blur is fine in chart mode on HTML overlays — the
  panel keeps it, the tooltip should keep it. The "paper isn't glassy"
  intuition is overruled by "match the panel".

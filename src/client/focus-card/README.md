# Focus card & card rolodex

The tier-2 object-info surface: a persistent, curated card stack for
the FOCUSED object and every pinned POI (`../poi/README.md`), docked at
the bottom of the right-side control stack (`#ui-top`, below the
settings panel). Tier 1 is the hover card (`../hover/`); tier 3 is the
future public catalogue page. Cards are a field-superset of hover in
the SAME frame of reference — hovering the focused object must show the
identical value for any shared field, which is why both tiers format
through `../format/` (see that README).

## Frame-of-reference principle

Every row is camera-relative or intrinsic — never Sol-relative.
Vantage-dependent values (distance, apparent magnitude) use the CAMERA
and update live as it moves; intrinsic properties (radius, temperature,
absolute magnitude, designations, provenance) are frame-free.
Sol-centred quantities (distance-from-Sol, apparent-mag-from-Sol)
belong to tier 3 only. Constellation is the one deliberate exception —
an Earth-vantage catalog tag kept for familiarity.

## Rolodex behaviour

All tier-2 cards — the focus card plus one card per pinned object — form
ONE stack (`#card-stack` in `.ui-top-bottom`) with a single visible
front card; the other cards show as overlapping header strips above it,
so the whole unit stays card-sized regardless of pin count.

- **Front card** — full header + body. Its header click collapses /
  expands the ENTIRE stack; its × unfocuses (focus card) or unpins
  (POI card). The focus card's title renders bold (`.is-focus`)
  wherever it sits, front or strip.
- **Strips** — one header-height row per behind-card, top to bottom:
  focus card first, then pins newest-first. Click promotes that card
  to front; each strip keeps its × (unfocus / unpin). Strip height
  compresses with count (`stripHeightPx`, floor 15 px) so the stack
  never scrolls, even at the 16-pin cap.
- **Auto-front** — the focus card jumps to front on any focus change;
  a newly pinned object's card jumps to front on pin. A manual promote
  holds until the next such event. With no focus card in the stack the
  newest pin is front; with no cards at all the stack is hidden.
- **Minimized** — the front card's header row alone, with the
  behind-card count on its own line below the name ("Sol" / "9 POI");
  strips reappear on expand. The name shown is the focused object's,
  not whatever card happens to be fronted — a manually promoted POI
  card still minimizes to the focus, since that's what "N POI" is
  counting against. With no focus visible, minimizing falls back to
  the front card's own name (unchanged from expanded). The count sits
  on its own line rather than appended inline so a long star name just
  wraps instead of crowding the count onto the same line. The one
  collapse state covers the whole stack and persists at
  `stellata.focus-card-collapsed`; front-card choice does not persist.
- **Observe mode** hides the focus card (the camera sits on the focal
  object, so the camera-frame rows are degenerate there); POI cards
  render in BOTH camera modes. The focused object's POI card is
  suppressed while focused — pin retained, card returns on unfocus —
  mirroring the overlay suppressing its ring/label/arrow. POI card
  content dispatches through `FocusCardProviders` by the pin's kind.
- **Live rows** tick only on the front card, and only while the stack
  is neither hidden nor collapsed (the `CardBody` gate points at
  `#card-stack`).

## Files

- `focus-card-types.ts` — the `FocusCardProvider` contract and the
  `FocusKind` union (`'star' | 'cloud' | 'lg' | 'planet'`).
  `FocusCardProviders` is a
  mapped type EXHAUSTIVE over the union: **adding a focusable kind
  without a focus-card provider fails `tsc`** — that compile-time
  guarantee is the point of the registry shape, don't weaken it to a
  partial map. `focus-card-contract.test.ts` pins it with
  `@ts-expect-error`.
- `card-body.ts` — the shared content renderer: fills a card's title +
  body from `FocusCardContent`, tracks LIVE rows (function-valued
  `FocusCardRow.value`), and re-evaluates them on `tick()` while the
  card is neither `hidden` nor `.collapsed`. Sole consumer today: the
  rolodex front card.
- `card-rolodex.ts` — the stack wiring over `card-body`. Owns the
  `#card-stack` DOM (built in `index.html`, styled via `.card-stack` /
  `.card-strip` + the `.panel` chrome in `styles.css`), rebuilds on
  `'focus'` / `'cameraMode'` / `'pois'`, and ticks
  LIVE rows on `'frame'`. Collapse rides the shared `bindCollapse`
  helper (`../ui/panel-layout.ts`).
- `card-rolodex-pure.ts` (+ test) — the rolodex plan (front card +
  strip order from pins / focus / promote state) and the strip-height
  compression curve.
- `star-focus-provider.ts` — tier-2 star rows (designations, cleaned
  spectral — "(estimated)" for a synthetic companion's
  brightness-derived class, radius, live camera distance, temperature
  — Gaia teff or "~" spectral-class-derived, abs mag, live camera
  apparent mag, variability, space velocity, "Known companions" names,
  coarse provenance — omitted for Sol, constellation). Companion-of
  blocks ("Orbits <A> · ρ …") render as full-width live lines below
  the rows.
- `lg-focus-provider.ts` — tier-2 Local Group rows (type + aliases as
  identity lines, live camera distance, live far-field apparent mag
  off the catalog m_V, absolute mag, axis pair, provenance).
- `planet-focus-provider.ts` — tier-2 planet/moon rows keyed on the
  PlanetBodyField flat instance index: "Orbiting <parent>" breadcrumb +
  type descriptor as identity lines, radius (R⊕ + km), live camera
  distance, live apparent mag (shader mirror), orbital period, and
  semi-major axis. Period/orbit and the breadcrumb parent come from the
  `OrbitDescriptor` (`../solar-system/orbit-descriptor.ts`): a planet
  reads its host star + solar-mass period (AU / years); a moon reads its
  parent planet + parent-GM period (km / days) and labels as a moon —
  no host-star reach or solar-mass assumption in the provider.
- `cloud-focus-provider.ts` — tier-2 cloud rows. Clouds are not a
  wired focus target while the layer is shelved
  (`../molecular-clouds/README.md`); the provider exists to satisfy
  the exhaustive contract and is ready for the un-shelve.

## Placement

`#card-stack` lives in `#ui-top`'s `.ui-top-bottom` group, directly
above the meta readout / time scrubber; the group's `margin-top: auto`
pins it to the column floor, and an expanding scrubber pushes the stack
up through normal flex layout. Living inside `#ui-top` means the `U`
hide-controls shortcut covers it for free. Card headers carry the
object's display name (text-transform none — Greek-letter Bayer forms
must not uppercase) so a collapsed stack still says what its front card
describes.


# Focus card

The tier-2 object-info surface: a persistent, curated, collapsible
panel for the FOCUSED object, docked at the bottom of the right-side
control stack (`#ui-top`, below the settings panel). Tier 1 is the
hover card (`../hover/`); tier 3 is the future public catalogue page.
The card is a field-superset of hover in the SAME frame of reference —
hovering the focused object must show the identical value for any
shared field, which is why both tiers format through
`../format/` (see that README).

## Frame-of-reference principle

Every row is camera-relative or intrinsic — never Sol-relative.
Vantage-dependent values (distance, apparent magnitude) use the CAMERA
and update live as it moves; intrinsic properties (radius, temperature,
absolute magnitude, designations, provenance) are frame-free.
Sol-centred quantities (distance-from-Sol, apparent-mag-from-Sol)
belong to tier 3 only. Constellation is the one deliberate exception —
an Earth-vantage catalog tag kept for familiarity.

## Files

- `focus-card-types.ts` — the `FocusCardProvider` contract and the
  `FocusKind` union (`'star' | 'cloud'`). `FocusCardProviders` is a
  mapped type EXHAUSTIVE over the union: **adding a focusable kind
  without a focus-card provider fails `tsc`** — that compile-time
  guarantee is the point of the registry shape, don't weaken it to a
  partial map. `focus-card-contract.test.ts` pins it with
  `@ts-expect-error`.
- `card-body.ts` — the shared content renderer: fills a card's title +
  body from `FocusCardContent`, tracks LIVE rows (function-valued
  `FocusCardRow.value`), and re-evaluates them on `tick()` while the
  card is neither `hidden` nor `.collapsed`. Two consumers: the focus
  card below and the per-POI cards (`../poi/poi-card-stack.ts`).
- `focus-card.ts` — the focused-object wiring over `card-body`. Owns
  the `#focus-card` DOM (built in `index.html`, styled via `.panel` +
  `.focus-card` in `styles.css`), rebuilds content on `'focus'` /
  `'cloudFocus'` / `'cameraMode'`, and ticks LIVE rows on `'frame'`.
  Hidden in OBSERVE mode — the camera sits on the focal object, so the
  camera-frame rows are degenerate there. The header's left-side ×
  unfocuses (`Stellata.unfocus`), aligned with the POI cards' unpin ×.
  Collapse rides the shared `bindCollapse` helper
  (`../ui/panel-layout.ts`), persisted at
  `stellata.focus-card-collapsed`.
- `star-focus-provider.ts` — tier-2 star rows (designations, cleaned
  spectral — "(estimated)" for a synthetic companion's
  brightness-derived class, radius, live camera distance, temperature
  — Gaia teff or "~" spectral-class-derived, abs mag, live camera
  apparent mag, variability, space velocity, "Known companions" names,
  coarse provenance — omitted for Sol, constellation). Companion-of
  blocks ("Orbits <A> · ρ …") render as full-width live lines below
  the rows.
- `cloud-focus-provider.ts` — tier-2 cloud rows. Clouds are not a
  wired focus target while the layer is shelved
  (`../molecular-clouds/README.md`); the provider exists to satisfy
  the exhaustive contract and is ready for the un-shelve.

## Placement

`#focus-card` lives in `#ui-top`'s `.ui-top-bottom` group (with the
meta readout / time scrubber below it and the `#poi-cards` stack
directly above the group), pinned to the column floor by the stack's
`margin-top: auto` — the scrubber expanding pushes the
card up through normal flex layout. Living inside `#ui-top` means the
`U` hide-controls shortcut covers it for free. The card header carries
the object's display name (text-transform none — Greek-letter Bayer
forms must not uppercase) so a collapsed card still says what it
describes.

## Planet focus (future)

Planets are not FocusTargets today. When they become one, `'planet'`
joins `FocusKind` and the compile-time contract forces a planet
provider in the same change.

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
- `focus-card.ts` — the engine. Owns the `#focus-card` DOM (built in
  `index.html`, styled via `.panel` + `.focus-card` in `styles.css`),
  rebuilds content on `'focus'` / `'cloudFocus'` / `'cameraMode'`, and
  re-evaluates LIVE rows (function-valued `FocusCardRow.value`) on each
  `'frame'` while visible and expanded. Hidden in OBSERVE mode — the
  camera sits on the focal object, so the camera-frame rows are
  degenerate there. Collapse rides the shared `bindCollapse` helper
  (`../ui/panel-layout.ts`), persisted at
  `stellata.focus-card-collapsed`.
- `star-focus-provider.ts` — tier-2 star rows (designations, cleaned
  spectral, radius, live camera distance, temperature, abs mag, live
  camera apparent mag with the "—" gate, space velocity, companions,
  coarse provenance, constellation).
- `cloud-focus-provider.ts` — tier-2 cloud rows. Clouds are not a
  wired focus target while the layer is shelved
  (`../molecular-clouds/README.md`); the provider exists to satisfy
  the exhaustive contract and is ready for the un-shelve.

## Placement

`#focus-card` is the LAST child of `#ui-top` with `margin-top: auto`,
pinning it to the bottom of the flex column directly above the
`.ui-bottom` row. Living inside `#ui-top` means the `U` hide-controls
shortcut covers it for free. The card header carries the object's
display name (text-transform none — Greek-letter Bayer forms must not
uppercase) so a collapsed card still says what it describes.

## Planet focus (future)

Planets are not FocusTargets today. When they become one, `'planet'`
joins `FocusKind` and the compile-time contract forces a planet
provider in the same change.

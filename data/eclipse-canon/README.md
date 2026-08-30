# NASA Five Millennium Canon — eclipse truth set

Frozen rows from Espenak & Meeus's *Five Millennium Catalog of Solar
Eclipses: −1999 to +3000* and its lunar companion, published by NASA
GSFC. Consumed only by
`src/client/solar-system/planets/eclipses/eclipse-canon.test.ts`. Never
read at build time.

This is the one corpus in `data/` that is not an ephemeris: it is an
**independent prediction** of events, which is the point. Horizons pins
where the Moon is; this pins that the model actually produces the eclipse
that follows from it, at the right instant, on the right part of the
globe.

## Provenance

- Source: `https://eclipse.gsfc.nasa.gov/SEcat5/` and `.../LEcat5/`,
  100-year catalogue pages, retrieved 2026-08-15.
- Espenak's own computation uses VSOP87/ELP-2000-85 with a lunar tidal
  acceleration of −25.858″/cy², and the same ΔT polynomial set the model
  carries in `src/client/solar-system/time/delta-t-pure.ts` — including
  the −0.000012932·(y−1955)² s correction reconciling the polynomials'
  assumed −26″/cy² with that −25.858, so the `delta_t_s` column checks
  that module to ~1 s across the whole corpus.

## `solar-eclipse-canon.tsv`

| Column | Meaning |
|---|---|
| `date` | Catalogue date label, astronomical year numbering (`-0584` = 585 BC). |
| `jd_tt` | Julian Date **TT** of greatest eclipse, derived from the catalogue's calendar date + TD time. |
| `delta_t_s` | ΔT Espenak used for this event, seconds. |
| `type` | `T` total, `A` annular, `H` hybrid, plus the catalogue's suffix (`Tm`, `H2`, …). |
| `gamma` | Least distance from Earth's centre to the shadow axis, Earth radii, **signed**. |
| `magnitude` | Ratio of apparent lunar to solar diameter at greatest eclipse. |
| `lat_deg` / `lon_east_deg` | Greatest-eclipse ground point, geodetic, **whole degrees** — the catalogue's own resolution, so ~55 km of any residual against it is rounding. |
| `path_width_km` | Umbral path width. |

## `lunar-eclipse-canon.tsv`

Same leading columns; then `umbral_magnitude` (fraction of the Moon's
diameter inside Earth's umbra at greatest eclipse) and the zenith point.
Only total eclipses are carried, deep ones (umbral magnitude > 1.2), so
"the Moon is fully inside the umbra" is an unambiguous claim.

The canons enlarge Earth's shadow by ~2 % for the atmosphere; the model
mirrors that via `CANON_SHADOW_ENLARGEMENT`. The geometric cone alone
reads ~0.03 magnitudes shallow, which is a convention difference, not an
error.

## Calendar

The catalogue tabulates dates in the **Julian** calendar before
1582 Oct 15 and the Gregorian one after, which is what the `jd_tt` column
was derived with (Meeus ch. 7). Getting that wrong shifts pre-1582 events
by up to 10 days while leaving every modern one correct — so it would
look like a deep-time model failure rather than a date bug.

## Selection

23 solar and 12 lunar events. Named ones are pinned by hand (2017 Aug 21,
2024 Apr 08, 2026 Aug 12, 1919 May 29 — Eddington, −0584 May 28 —
Thales, 1133 Aug 02, 1999 Aug 11); the rest are the two most central
events on each sampled catalogue page. Central by design: |γ| < 0.95
throughout, and mostly ≪ that, because a grazing eclipse satisfies every
assertion the test makes without proving the shadow lands anywhere in
particular.

## Refresh

Re-scrape the catalogue pages and rebuild. Like `data/horizons/`, a
refresh should only ever mean *adding* events — these rows are settled
predictions, and a change upstream would be a catalogue revision to
investigate rather than a reason to re-pin.

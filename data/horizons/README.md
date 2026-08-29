# JPL Horizons ephemeris truth set

Frozen geocentric astrometric RA/Dec for the eight major planets,
Pluto, and the Sun at three fixed epochs, fetched once from the JPL
Horizons API. Consumed only by the sky-truth regression corpus
(`src/client/solar-system/ephemerides/sky-truth.test.ts`), which asserts the
production Standish-ephemeris → ecliptic→ICRS chain lands each body
within tolerance of these positions. Never read at build time.

A second table, `sub-observer-truth.tsv`, freezes geocentric
sub-observer and sub-solar lon/lat for Mars, Ganymede, Io and the Moon at
the same three epochs (`QUANTITIES='14,15'`; Mars/Ganymede/Io retrieved
2026-07-19, the Moon 2026-08-19 with `COMMAND='301'`).
Consumed by `src/client/solar-system/planets/rotation/texture-orientation.test.ts`,
which pins the full IAU-orientation → texture-UV chain. Columns:
`body`, `jd_ut`, then `ob_lon_west_deg` / `ob_lat_deg` (quantity 14)
and `subsol_lon_west_deg` / `subsol_lat_deg` (quantity 15). All three
bodies use the IAU **positive-west** planetographic longitude
convention (`{West-longitude positive}` in the Horizons header) —
east longitude = 360 − value. **The Moon does not**: its frame is
`MOON_ME`, which Horizons reports `{East-longitude positive}`, so its
rows were converted by the same 360 − value on the way in to keep one
schema. Re-fetch it and the conversion has to be applied again — this is
the one row where reading the Horizons output straight into the column
would be wrong by twice the libration. Latitudes are planetographic; the
planetocentric difference is bounded by ~0.35° for Mars's flattening
and sits inside the test tolerance. Horizons evaluates both
quantities at the light-time-corrected emission epoch, so the
consumer retards the spin angle by one light time.

A third table, `moon-radec-truth.tsv`, freezes geocentric astrometric
RA/Dec (`QUANTITIES='1'`, retrieved 2026-07-19) for all 18 major moons
plus their outer-parent planets (Jupiter, Saturn, Uranus, Neptune) at
the three epochs above **plus JD 2461240.5** (2026-07-19 00:00 UT) —
the extra epoch exists because satellite mean-anomaly drift grows with
time from J2000, so a present-day sample is the sensitive one.
Consumed by `src/client/solar-system/ephemerides/moon-sky-truth.test.ts`, which
pins each moon's parent-relative on-sky position angle + separation
through the production chain (the defect class it exists to catch:
truncated mean motions scrambling orbital phase).

A fourth table, `planet-vector-truth.tsv`, freezes **heliocentric
ecliptic state vectors** rather than an on-sky direction — see its own
section below. It is the only table here that reaches outside the
1800–2050 window the RA/Dec epochs sit in.

A fifth table, `earth-orientation-truth.tsv`, freezes Earth's apparent
sub-solar lon/lat at 18 epochs across the model clock — the one table
here that pins a body's *rotation* rather than its position. See its own
section below.

A sixth table, `moon-vector-truth.tsv`, freezes **geocentric ecliptic
state vectors for the Moon** at 174 epochs spanning the model clock's
whole 3000 BC – 3000 AD clamp — by far the widest corpus here. Consumed
by `src/client/solar-system/ephemerides/moon-vector-truth.test.ts`. See
its own section below.

## Provenance

- Source: JPL Horizons API (`https://ssd.jpl.nasa.gov/api/horizons.api`),
  ephemeris DE441.
- Retrieved: 2026-07-02 (RA/Dec + sub-observer tables), 2026-07-26
  (`planet-vector-truth.tsv`).
- Query shape per body: `EPHEM_TYPE=OBSERVER`, `CENTER='500@399'`
  (geocentric), `QUANTITIES='1'` (astrometric ICRF RA/Dec),
  `ANG_FORMAT='DEG'`, `TLIST` = the three JDs below, `TLIST_TYPE='JD'`.
- Bodies: 199, 299, 499, 599, 699, 799, 899 (Mercury–Neptune body
  centres), 999 (Pluto), 10 (Sun).

## `planet-radec-truth.tsv`

| Column | Meaning |
|---|---|
| `body` | Lowercase body name matching `PlanetName` in `ephemeris.ts`, plus `sun`. |
| `jd_ut` | Julian Date (UT) of the sample. |
| `ra_icrs_deg` | Astrometric ICRF right ascension, decimal degrees. |
| `dec_icrs_deg` | Astrometric ICRF declination, decimal degrees. |

Epochs: JD 2451545.0 (J2000.0, 2000-01-01 12:00 UT), JD 2461223.5
(2026-07-02 00:00 UT), JD 2466154.5 (2040-01-01 00:00 UT) — past /
present / near-future, all inside the Standish 1800–2050 primary fit
window.

Astrometric (light-time-corrected) rather than geometric positions:
the difference is bounded by ~0.03° (Mercury), far under the corpus
tolerance, and astrometric is Horizons' default high-fidelity
observer quantity.

## `planet-vector-truth.tsv`

| Column | Meaning |
|---|---|
| `body` | Lowercase name matching `PlanetName` in `ephemeris.ts`. |
| `jd_tdb` | Julian Date, **TDB**. |
| `x_au` / `y_au` / `z_au` | Heliocentric position, AU, **J2000 ecliptic** axes. |

Consumed by
`src/client/solar-system/ephemerides/vector-truth.test.ts`, which pins
the element evaluation against these vectors directly — no clock, no
ecliptic→ICRS rotation, no light-time. Three deliberate differences
from the RA/Dec tables:

- **Barycentre targets, not body centres** (`1`…`9`). Standish's
  elements fit the barycentric orbits, and `earth` is the Earth/Moon
  barycentre the ephemeris actually resolves. The body-vs-barycentre
  offset is ≤1.4e-5 AU (Pluto, the largest), three orders under the
  corpus tolerance.
- **`jd_tdb`, and the consumer feeds it straight in** as
  `T = (jd − 2451545.0)/36525`. The RA/Dec corpus goes through the
  clock; this one deliberately does not, so a timescale change can
  never move these rows.
- **Geometric, not astrometric.** There is no observer.

Epochs: JD 807920.0 (Julian year −2500) and JD 2780270.0 (year 2900) —
one near each end of the model clock's 3000 BC – 3000 AD clamp, which
no other corpus here reaches. Query shape: `EPHEM_TYPE=VECTORS`,
`CENTER='500@10'`, `REF_PLANE='ECLIPTIC'`, `VEC_TABLE='1'`,
`OUT_UNITS='AU-D'`, `CSV_FORMAT='YES'`, `TLIST` = the two JDs.

## `moon-vector-truth.tsv`

| Column | Meaning |
|---|---|
| `set` | `fit` or `check` — see below. |
| `jd_tt` | Julian Date, **TT**. Fed straight to the theory; no clock. |
| `x_km` / `y_km` / `z_km` | Geocentric position, km, **J2000 ecliptic** axes. |

Query shape: `COMMAND='301'`, `EPHEM_TYPE=VECTORS`, `CENTER='500@399'`,
`REF_PLANE='ECLIPTIC'`, `VEC_TABLE='1'`, `OUT_UNITS='KM-S'`,
`TLIST_TYPE='JD'`. Retrieved 2026-08-15, DE441.

The sets exist because the lunar theory's DE441 recalibration (mean
longitude + D/M′/F arguments) was **derived from** part of this corpus,
and a test that only checked the fit against its own basis would prove
nothing:

- **`fit`** — 134 epochs at a 16033.7-day step from T = −49.5 to +9.2
  centuries. The step is deliberately non-commensurate with the synodic
  (29.53 d), anomalistic (27.55 d) and draconic (27.21 d) months, so the
  sample cannot alias a periodic term into a secular fit.
- **`fit2`** — 1462 epochs at a uniform 1499-day step spanning the whole
  clamp (retrieved 2026-08-30, DE441; same query shape). A second, much
  denser fit basis whose different cadence aliases differently from
  `fit`, so a correction cannot hide in one grid's blind spots.
- **`check`** — 40 epochs on a plain 150-year grid, never used in any
  fit. `moon-vector-truth.test.ts` bounds these separately.

## `earth-orientation-truth.tsv`

| Column | Meaning |
|---|---|
| `jd_ut` | Julian Date, **UT** — Horizons OBSERVER tables take and report UT, unlike the VECTORS tables above, which are TDB. |
| `subsol_lon_east_deg` | Apparent sub-solar longitude, **positive east** (Horizons uses ITRF93 for Earth and says so in its header — the positive-west convention the Mars/Ganymede/Io table carries does NOT apply here). |
| `subsol_lat_deg` | Apparent sub-solar latitude, planetodetic. |

18 epochs from year −2900 to +2900. Query shape: `COMMAND='399'`,
`EPHEM_TYPE=OBSERVER`, `CENTER='500@0'`, `QUANTITIES='15'`,
`ANG_FORMAT=DEG`, `TLIST_TYPE='JD'`. Retrieved 2026-08-15, DE441.

Consumed by
`src/client/solar-system/planets/rotation/earth-orientation.test.ts`.
The values are *apparent*, so the consumer retards Earth's spin by one
light time — skipping that shows up as a flat 2.0° offset at every
epoch, which is 499 s of rotation and nothing to do with the model.

## Refresh

Re-run the query above per body and regenerate the TSV. There is no
`scripts/refresh/` helper — the set is three fixed instants of
settled ephemeris truth, so a refresh should only ever mean *adding
epochs or bodies*, not revising existing rows. If DE441 values for
these instants ever change upstream, that is a Horizons regression,
not a reason to re-pin.

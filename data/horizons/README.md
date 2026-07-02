# JPL Horizons ephemeris truth set

Frozen geocentric astrometric RA/Dec for the eight major planets,
Pluto, and the Sun at three fixed epochs, fetched once from the JPL
Horizons API. Consumed only by the sky-truth regression corpus
(`src/client/solar-system/sky-truth.test.ts`), which asserts the
production Standish-ephemeris → ecliptic→ICRS chain lands each body
within tolerance of these positions. Never read at build time.

## Provenance

- Source: JPL Horizons API (`https://ssd.jpl.nasa.gov/api/horizons.api`),
  ephemeris DE441.
- Retrieved: 2026-07-02.
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

## Refresh

Re-run the query above per body and regenerate the TSV. There is no
`scripts/refresh/` helper — the set is three fixed instants of
settled ephemeris truth, so a refresh should only ever mean *adding
epochs or bodies*, not revising existing rows. If DE441 values for
these instants ever change upstream, that is a Horizons regression,
not a reason to re-pin.

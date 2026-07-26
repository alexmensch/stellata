# Planet osculating-element tables

Heliocentric osculating elements for the nine Standish bodies across
**1900–2100**, sampled on a uniform grid. One JSON per planet, committed
plain text (~1.5 MB total, no LFS).

Consumed at runtime by `src/client/solar-system/ephemerides/`, which
interpolates the six elements and solves Kepler from them; outside the window
it falls back to the inlined Standish series.
`scripts/ephemerides/sync-ephemerides.ts` mirrors this folder to
`public/ephemerides/` on every `pnpm run dev` / `build`; the allowlist
(`sync-ephemerides-pure.ts`) keeps this README out of the deployed bundle.

Not read at build time — nothing in `pnpm run build` parses these beyond
copying them.

## Why this exists

The Standish 1992 series the runtime falls back to is within its published
budget, and that budget is **0.05–0.06 AU at Saturn, Uranus and Neptune**
(`../../src/client/solar-system/ephemerides/README.md` § Planet ephemeris).
That is not a precision nicety: under a probe flythrough the camera rides
within Voyager 2's true 0.0007 AU Uranus approach while the rendered planet
sits 0.06 AU away, so the swing-by reads as a distant pass. These tables
bring the in-window planets to the same 1e-5 AU the probe trajectories hold.

`../horizons/` is a different corpus for a different purpose — a handful of
frozen truth rows for regression tests. No overlap with this folder.

## Provenance

- Source: JPL Horizons API (`https://ssd.jpl.nasa.gov/api/horizons.api`),
  ephemeris DE441.
- Retrieved: 2026-07-26. Each file carries its own `source.retrievedUtc`.
- Refresh: `pnpm run fetch:ephemerides` — manual and infrequent, never part
  of `pnpm run build` (`../README.md` § Frozen external data).
- Query shape per planet: `EPHEM_TYPE=ELEMENTS`, `CENTER='500@10'`
  (Sun centre), `REF_PLANE=ECLIPTIC`, `OUT_UNITS=AU-D`, `CSV_FORMAT=YES`,
  spanning JD 2415020.0 (Julian year 1900.0) to JD 2488070.0 (year 2100.0)
  in fixed steps.
- Horizons targets are the **barycentres** `1`…`9`: Standish's series fits
  the barycentric orbits, `earth` must be the Earth/Moon barycentre that
  `earthMoonSplit` divides, and a Pluto barycentre skips the 6.4-day
  Pluto–Charon wobble. Targets `1` and `2` resolve to the Mercury and Venus
  *body* centres, which is the same point — neither has a satellite.

## Schema

```json
{
  "id": "saturn",
  "horizonsId": "6",
  "jd0": 2415020,
  "stepDays": 50,
  "source": { "frame": "Ecliptic of J2000.0", "center": "Sun (10) …",
              "units": "AU-D, deg, …", "outputType": "GEOMETRIC osculating elements",
              "targetBody": "Saturn Barycenter (6) …", "retrievedUtc": "…" },
  "positionToleranceAu": 0.00001,
  "columns": ["a", "h", "k", "p", "q", "lambda"],
  "samples": [[9.5787…, -0.00287…, 0.05543…, 0.01897…, -0.00875…, 268.10…], …]
}
```

`columns` names the row layout; the TypeScript contract is
`PlanetElementTableFile` in
`../../scripts/ephemerides/planet-element-schema.ts`, imported by both the
emitter and the runtime table.

- **No epoch column.** `samples[i]` is at `jd0 + i * stepDays`, Julian Date
  **TDB**. That is why the cadence must divide the window exactly.
- `a` — semi-major axis, AU.
- `h`, `k` — `e·sin ϖ` and `e·cos ϖ`, dimensionless.
- `p`, `q` — `tan(i/2)·sin Ω` and `tan(i/2)·cos Ω`, dimensionless.
- `lambda` — mean longitude λ = M + ϖ, **degrees, unwrapped**: continuous
  across the whole file rather than folded into [0, 360), so it reaches
  ~3e5 degrees at Mercury. The runtime holds it in float64 for exactly that
  reason — float32's 0.02° resolution there would be four orders coarser
  than the accuracy claim needs.
- The equinoctial pairs rather than classical Ω/ω/e/i: **the classical set is
  singular for these bodies.** The Earth/Moon barycentre's osculating
  inclination to the ecliptic of J2000 crosses 0.0001°, and Horizons' Ω jumps
  215° across that one sample while the orbit does not move.
  `scripts/ephemerides/README.md` § Unwrapping the mean longitude has the
  detail.
- Rounded to 11 significant digits from Horizons' 16 — the binding column is
  `lambda`, where 11 digits leaves three orders of headroom on what the 1e-5
  AU bound needs.

## Accuracy

Every file is built to one guarantee — **a position reconstructed from its
interpolated elements stays within `positionToleranceAu` (1e-5 AU, 1,496 km)
of Horizons** — the same bound the probe trajectory grids hold, so a rendered
flyby's error is the encounter geometry's own. How the pipeline finds the
cadence, and why the interpolation is cubic, is
`scripts/ephemerides/README.md` § Cadence.

Measured by `fetch:ephemerides` at the time of the retrieval above. *Midpoint*
is the max over every interval midpoint — epochs the table was never fitted
to; *on-grid* is the max at the sample epochs, where only the emitted
rounding and the element-to-Cartesian round trip remain.

| File | Step | Rows | Size | On-grid | Midpoint |
|---|---|---|---|---|---|
| `mercury.json` | 50 d | 1,462 | 132 KB | 4.1e-8 | 5.4e-6 |
| `venus.json` | 30 d | 2,436 | 232 KB | 6.3e-8 | 4.0e-6 |
| `earth.json` | 30 d | 2,436 | 244 KB | 8.9e-9 | 2.6e-6 |
| `mars.json` | 30 d | 2,436 | 223 KB | 1.5e-8 | 2.6e-6 |
| `jupiter.json` | 50 d | 1,462 | 135 KB | 4.8e-9 | 2.9e-6 |
| `saturn.json` | 50 d | 1,462 | 138 KB | 8.7e-9 | 4.1e-6 |
| `uranus.json` | 50 d | 1,462 | 138 KB | 1.6e-8 | 3.1e-6 |
| `neptune.json` | 50 d | 1,462 | 137 KB | 2.7e-9 | 3.7e-6 |
| `pluto.json` | 50 d | 1,462 | 132 KB | 4.6e-9 | 4.6e-6 |

Venus, Earth and Mars carry a finer cadence than Jupiter–Pluto, which is the
opposite of the intuition that distant bodies need more data. The residual is
set by how fast the *osculating elements* wiggle relative to the sample
spacing, not by orbital size: the inner planets' short-period terms run at
their own orbital periods, so a 50-day step samples them near Nyquist. The
giants' perturbations are centuries-long and a 50-day step resolves them
easily.

**Two facts that follow from this data, worth knowing before reading a number
off the model:**

- **Inside 1900–2100 the planet ephemeris is no longer the dominant error
  term.** It was 0.002–0.06 AU; it is now ~5e-6 AU, at parity with the probe
  trajectories. Any probe-vs-planet distance measured in this codebase is now
  a statement about the two datasets' agreement with reality, not about the
  ephemeris.
- **Outside the window nothing changed.** The clock reaches 3000 BC – 3000 AD,
  and out there the Standish series is what runs, at its published budget.
  The runtime blends across one Julian year at each edge so scrubbing over
  1900 or 2100 does not pop.

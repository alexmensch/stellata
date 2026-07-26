# Planet element-table pipeline

Fetch + sync for the nine per-planet osculating-element tables that give the
runtime a Horizons-grade ephemeris across 1900–2100. Data contract,
provenance, units, and the measured accuracy table live in
`data/ephemerides/README.md`; the runtime side is
`src/client/solar-system/ephemerides/README.md` § Horizons element tables.
This folder owns the scripts.

- `planet-element-roster.ts` — the nine targets, their sample cadence, and
  the window every table spans (`TABLE_JD_START` / `TABLE_JD_END`,
  `POSITION_TOLERANCE_AU`). The authoring source; editing a cadence needs a
  re-run of `fetch:ephemerides`. `tableEpochs` refuses a cadence that does
  not divide the window exactly — a truncated last interval would leave the
  runtime on the Standish fallback inside the window the table claims.
- `planet-element-schema.ts` — `PlanetElementTableFile` + `ELEMENT_COLUMNS`,
  the wire contract shared by the emitter here and the runtime table.
- `horizons-elements.ts` — pure parser for a Horizons ELEMENTS text
  response. Sibling of `../probes/horizons-vectors.ts`; both sit on
  `../util/horizons-response.ts`. See § Header pins.
- `element-unwrap-pure.ts` (+ test) — `unwrapMeanLongitude`. See
  § Unwrapping the mean longitude.
- `fetch-planet-elements.ts` — `pnpm run fetch:ephemerides`, optionally
  narrowed to one or more planets (`pnpm run fetch:ephemerides saturn`).
  Manual and infrequent; **not** in the build chain (`data/README.md`
  § Frozen external data). Needs network. Writes
  `data/ephemerides/{id}.json` and exits non-zero if any table misses its
  accuracy bound. See § Cadence.
- `sync-ephemerides.ts` (+ `-pure.ts`) — mirrors the committed JSONs to
  `public/ephemerides/` (gitignored) via `../util/mirror-to-public.ts` on
  every `pnpm run dev` / `build`, so CI and deploy never touch the network.
  The allowlist predicate keeps this README out of the deployed bundle;
  `tests/bundle-content.test.ts` guards the built tree.

## Header pins

Every fetch re-reads the header fields its query set — `Reference frame`,
`Output units`, `Center body name`, **and `Output type`** — and throws on a
mismatch, so an upstream default change fails the fetch instead of quietly
reframing committed data. `Output type` is the pin with no analogue on the
probe side: Horizons can emit *mean* elements instead of the geometric
osculating ones, and mean elements would look entirely plausible while
carrying none of the short-period perturbation this table exists to capture.

## Unwrapping the mean longitude

Horizons reports the mean anomaly folded into [0, 360). Interpolating that
directly would sweep a planet backwards through most of an orbit at every
wrap, so the emitter accumulates a continuous mean longitude
λ = M + Ω + ω instead.

The revolution count per step comes from the **mean motion Horizons reports
in the same row**, not from a shortest-arc guess. That distinction is what
makes the cadence a free parameter: a shortest-arc unwrap silently drops a
revolution wherever one interval covers more than half an orbit, which at
Mercury is any cadence over 44 days — and the cadences below are 50.

The other five columns need no unwrapping at all, because the wire format
carries **equinoctial** rather than classical elements (see
`src/client/solar-system/ephemerides/equinoctial-pure.ts`): eccentricity
rides with perihelion in `h`/`k` and inclination rides with the node in
`p`/`q`, so neither pair goes singular. That is not a nicety — the
Earth/Moon barycentre's osculating inclination to the ecliptic of J2000
passes through 0.0001° near J2000, and across that sample Horizons' Ω jumps
by 215° while the orbit does not move at all. Interpolating the classical Ω
and ω separately puts Earth on the wrong side of the Sun for a decade
either side.

## Cadence

Every table is uniform-cadence, so the runtime finds its bracketing interval
by arithmetic and the file carries no per-row epoch. What the cadence is set
by is the same kind of bound the probe grids use — **the largest distance a
position reconstructed from interpolated elements may sit from Horizons**,
`POSITION_TOLERANCE_AU` = 1e-5 AU, matching the probe grids so a rendered
flyby's error is the encounter geometry's own rather than either dataset's.

Elements rather than positions is what makes 1e-5 AU affordable: the orbital
motion is already in the Kepler solve, so what the table has to resolve is
only the slow perturbation on top of it. Positions at the same accuracy
would need a Chebyshev fit some fifty times larger.

The fetch script measures rather than asserts. After emitting, it re-reads
its own file and reconstructs positions at:

- **every interval midpoint** — epochs the table was never fitted to, and the
  worst case for the interpolation, and
- **every grid epoch**, where the interpolation is exact and what remains is
  the emitted rounding plus the element-to-Cartesian round trip.

Both are compared against a fresh Horizons VECTORS query in the same frame.
Cadences are then set so the midpoint figure stays under ~60% of the bound;
`data/ephemerides/README.md` § Accuracy carries the per-planet results. The
run fails loudly rather than shipping a table that misses its claim.

**Interpolation is cubic (Catmull–Rom), not linear**, and the two boundary
intervals extrapolate their missing outer control point rather than clamping
it. Both choices are measured, not stylistic: cubic buys 3–5× the cadence at
equal accuracy, which is the whole artifact-size budget, and clamping the end
tangent halves the mean longitude's advance across the table's first and last
interval — 6° of Mercury, 0.036 AU, in a file that otherwise holds 5e-6.

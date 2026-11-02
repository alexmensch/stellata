# Planet element tables — the wire contract

`data/ephemerides/{id}.json`, mirrored to `public/ephemerides/`: one
uniform-cadence table of osculating elements per planet across 1900–2100.
The fetch writes it ([`/scripts/ephemerides/`](/scripts/ephemerides/README.md));
the viewer's planet ephemeris reads it
([Horizons element tables](/src/client/solar-system/ephemerides/README.md#horizons-element-tables)).
Provenance, units and the measured accuracy are `data/ephemerides/README.md`.

- `planet-element-roster.ts` — `PlanetName`, the nine targets
  (`ELEMENT_TARGETS`), their sample cadence, and the window every table
  spans (`TABLE_JD_START` / `TABLE_JD_END`, `POSITION_TOLERANCE_AU`). The
  authoring source; editing a cadence needs a re-run of
  `fetch:ephemerides`. `tableEpochs` refuses a cadence that does not
  divide the window exactly — a truncated last interval would leave the
  runtime on the [Standish 1992](/data/papers/index.md#standish1992) fallback
  inside the window the table claims.
- `planet-element-schema.ts` — `PlanetElementTableFile` + `ELEMENT_COLUMNS`,
  the wire contract shared by the emitter and the runtime table.
- `element-table.ts` (+ test) — the decoded table and its interpolating
  sampler, `buildElementTable` / `elementTableSampleAt`. The fetch
  re-reads its own output through it to measure the accuracy it claims
  ([Cadence](/scripts/ephemerides/README.md#cadence)), so the measured
  sampler and the shipped one are the same code.
- `sync-ephemerides-pure.ts` — `planetElementFilename` and the mirror's
  allowlist predicate, `isPlanetElementPublicAsset`: the public name of
  each table, which the mirror writes and the loader fetches.

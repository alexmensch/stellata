# WDS — the summary and ORB6 readers

The TypeScript readers of the Washington Double Star summary and the Sixth
Orbit Catalog (`data/wds/`, [their provenance](/data/wds/README.md)), and the
one parse of a WDS pair's `components` field. Two steps read them: the
binaries pipeline's Stage 1 ([`../binaries/load/`](../binaries/load/README.md))
and the SIMBAD WDS cross-ID pull
([`../refresh/simbad-wds-xids/`](../refresh/simbad-wds-xids/README.md)), so
they live in neither step's folder and import nothing from either.

## Files in this area

```
scripts/wds/
  wds-pure.ts (+ test)   parseWdsSumm, parseOrb6 (the fixed-width formats),
                         splitComponents (a components field as its two
                         tokens), dedupWdsPairRows (the duplicate-row
                         collapse) and measuredOffset (a row's ρ > 0 and θ,
                         or null), which every (ρ, θ) consumer reads.
  wds-source.ts          WDS_SUMM, ORB6: the two files, declared.
  wds-fixture.ts         Test-only WdsPair and Orb6Entry builders.
```

## How the readers read

The cell rules are the one reader's
([Reading a table](../util/tsv/README.md#reading-a-table)), plus `.` — the
catalogues' explicit "no value" — and the two ρ / θ sentinels: a negative
value, and ρ's `999.9` field overflow (`WDS_RHO_OVERFLOW_SENTINEL_ARCSEC`),
both read as no measurement. A row with no WDS id or discoverer is skipped. A
precise-coordinate fill under `WDS_SUMM_PRECISE_COORD_FLOOR`, or an ORB6
period fill under `ORB6_PERIOD_COVERAGE_FLOOR`, throws: the fixed-width
offsets moved.

## The components field

`splitComponents` is the only split of it. A blank field is WDS's implied
single A,B pair and answers null, as does a form with no confident split
(`ABC`, three comma-separated tokens), so both steps decompose the same rows.
The truncated secondary (`Aa1,2`) comes back as written; re-anchoring it is
`pairComponentTokens` in `../binaries/component-tokens-pure.ts`.

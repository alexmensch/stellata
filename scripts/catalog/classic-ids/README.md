# Classic-ID overlay build

Joins the four frozen CDS classic-designation tables onto Gaia DR3
source_ids and writes `data/classic-ids/classic_id_overlay.tsv`. Run via
`pnpm run build:classic-ids`. The contract it implements is
`docs/catalog-driver.md` § 2 (sources) and § 4 (HD route, ambiguity,
precedence); the measured coverage the join achieves — and why the
inherited spine is load-bearing beside it — is
`data/classic-ids/README.md` § Coverage.

Not wired into `pnpm run build` or `build-catalog.ts`. This folder
produces a committed artifact only; the record build starts consuming it
in `stellata-3bsf.4`.

## Files in this area

```
scripts/catalog/classic-ids/
  build-classic-id-overlay.ts     I/O orchestrator: reads the frozen tables +
                                  both Gaia cross-walks, writes the overlay,
                                  the route-disagreement queue, and asserts
                                  the count snapshot.
  classic-ids-parse.ts (+ test)   The four frozen-TSV parsers.
  classic-id-overlay-pure.ts      The join, its counts, the TSV serializer, and
    (+ test)                      the AT-HYG label-parity measurement. Pure.
  classic-id-overlay-expected.json
                                  Pinned count snapshot. Refresh with
                                  UPDATE_BUILD_COUNTS=1 (same env var
                                  build-catalog.ts uses).
```

## Join routes

```
hd        IV/25 hd → tyc → gaia_dr3_tyc_xmatch → source_id      (primary)
hr        V/50 hr → hd → the hd route
bayer     IV/27A hd → the hd route, else its own hip → hip walk
flamsteed same as bayer
hip       gaia_dr3_hip_xmatch, plus CNS5's own hip column
gj        CNS5's EDR3 source_id, else its hip → hip walk
```

**HD routes entirely through TYC.** Every HD-bearing AT-HYG row also
carries a TYC (audit 2026-07-27), so the HIP route is a cross-check, not
a second authority: where both resolve and disagree, the HD route keeps
the label and the row is appended to
`data/classic-ids/hd_hip_route_disagreements.tsv` for the parity
ledger's review queue rather than resolved mechanically.

**An ambiguous designation attaches to every matching record** (§ 4) —
`buildClassicIdOverlay` never picks a winner, so overlay cells are
`|`-separated lists and `sourcesWithMultipleHd` / `hdOnMultipleSources`
are pinned counts rather than assertions of uniqueness. Search dispatch
resolving to the brightest, and SID allocation keying no row off such a
designation, are the consumer's job.

The TYC cross-walk is 2.5 M rows for a ~350 k-row join, so
`readGaiaTycXmatch` (`../parse/gaia-xmatch.ts`) streams it line-by-line
and takes a keep-set of the Tycho ids IV/25 actually mentions. Reading it
as one string peaks near a gigabyte alongside the join's own maps.

## Counts and the parity measurement

`classic-id-overlay-expected.json` pins 45 counts through the same
`compareBuildCounts` / `UPDATE_BUILD_COUNTS` machinery
`build-catalog.ts` uses (`assertOrUpdateSnapshot` in
`../../util/snapshot-assert.ts`). Three groups:

- **Input + route sizes** — upstream row counts, how many Tycho ids
  resolve, the HIP-route agree / disagree / HIP-only split.
- **Overlay sizes** — rows, and per-identifier how many sources carry
  each designation, plus the multi-valued cardinalities.
- **`athygLabelParity`** — per identifier, AT-HYG rows that resolve to a
  source_id and carry the identifier (`*Keyed`) versus those the overlay
  reproduces under that same source_id (`*Covered`). This is the
  transitional acceptance measurement: it moves to the inherited spine
  when AT-HYG leaves the build's input set.

`hd` / `hip` / `hr` compare values; `gl` compares the bare GJ number
(the `Gl`/`GJ` prefix and component suffix are display forms);
**`bayer` compares presence only** — IV/27A spells Bayer letters `alf`
where AT-HYG spells them `Alp`, and reconciling the two is the
naming-authority ladder's gate, not this join's.

`athygBrightRowsWithoutOverlayEntry` is the count to watch: Gaia
saturates near G ≈ 3, so a source_id-keyed table structurally cannot
carry the brightest stars, and a future session reading a high `overlayHd`
could otherwise conclude the overlay replaces AT-HYG's label columns
outright.

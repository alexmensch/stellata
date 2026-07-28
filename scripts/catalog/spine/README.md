# Inherited-spine generator

Emits `data/athyg/inherited-spine.tsv` — one row per AT-HYG-derived record
of the final AT-HYG-driven build, carrying that record's resolved
designation set plus AT-HYG's printed cells. Run via `pnpm run build:spine`.
The contract is `docs/catalog-driver.md` § 3; why the spine is load-bearing
rather than a rare fallback is `data/classic-ids/README.md` § Coverage.

Not wired into `pnpm run build` or `build-catalog.ts`. This folder produces
a committed artifact only; the record build starts consuming the spine as
its membership term in `stellata-3bsf.4`, and `stellata-cns.7`'s label
parity gate reads overlay ∪ spine.

## Files in this area

```
scripts/catalog/spine/
  build-inherited-spine.ts        I/O orchestrator: runs the readStars walk,
                                  re-reads the CSV for printed cells, writes
                                  the TSV, asserts the count snapshot.
  inherited-spine-pure.ts         Column layout, row assembly, TSV codec,
    (+ test)                      per-column counts, and the designation
                                  recovery (spineDesignations). Pure.
  inherited-spine-guard.test.ts   Assertions over the COMMITTED artifact —
                                  counts, keyless rows, Sol, duplicate
                                  source_ids (§ Why a guard, not a rebuild).
  inherited-spine-expected.json   Pinned count snapshot. Refresh with
                                  UPDATE_BUILD_COUNTS=1 (same env var
                                  build-catalog.ts uses).
```

## Where each column comes from

`COLUMN_SPEC` in `inherited-spine-pure.ts` is the single ordered table
driving file layout, per-column origin, and the counts. Two origins:

- **`star`** — `hip`, `hd`, `hr`, `gl`, `flam`, `bayer`, `proper`,
  `gaia_source_id` come off the in-memory record, so they are the values
  the shipped build resolved: `gaia_source_id` has been through the native
  → HIP-cross-walk precedence and both binding gates, the three
  `multiples.tsv` HD-only primaries carry their backfilled HIP + source_id,
  and ξ UMa B carries the one written by the collocated-double merge. That
  is what makes the per-record designation set — and therefore every SID —
  identical by construction.
- **`printed`** — every other column is the AT-HYG cell **verbatim**, under
  its own upstream name. No parse/format round-trip, so the spine is a
  faithful slice of what AT-HYG printed and the file is trivially
  reproducible.

Rows are emitted in AT-HYG `id` order (readStars preserves CSV order), so
there is no sort key to disagree about.

`pm_ra` / `pm_dec` / `pm_src` are in the file although § 3's column list
predates them: the direction cascade's `athyg_printed` tier and the
space-motion velocity's `athyg_pm` tier both bottom out at AT-HYG's printed
proper motion (65 and 64 records respectively). A frozen artifact cannot
grow a column later, so they ship now.

## Membership comes from readStars, not from a re-derivation

The generator calls `readStars` with the same inputs `build-catalog.ts`
uses — `loadReadStarsInputs` (`../parse/read-stars-inputs.ts`) is shared by
both for exactly that reason. Membership depends on the distance stack
(a Bailer-Jones or LMC override can push a row past `MAX_DIST_PC`) and on
the direction cascade (a row no tier resolves is dropped), so re-deriving
the drop conditions here would be a second implementation of the thing the
spine must agree with. Every pass that then writes an identifier onto an
AT-HYG-derived record runs too, in the shipped order: the `multiples.tsv`
identifier backfill, then distance coherence, then companion promotion —
whose collocated-double merge writes a Gaia id onto ξ UMa B's record instead
of minting a twin, and which only recognises that record by finding it
sitting exactly on its anchor, which is what makes the coherence pass
load-bearing here. Promotion's minted records are discarded; they are not
AT-HYG-derived.

Verified at authoring time against the built catalog: over all 313,257
AT-HYG-derived records, the `starDesignations` multiset from
`catalog.bin` + `search-index.json` and the `spineDesignations` multiset
from the committed TSV agree exactly.

The join back to the printed cells keys on AT-HYG's own `id`, carried
through as `Star.athygRowId`. Non-null `athygRowId` is also the
AT-HYG-derived predicate: promoted companions get `null`, and they are not
spine rows — companion promotion is driver-independent and re-runs after
the swap.

## Why a guard, not a rebuild

Every other generated artifact in the repo has a CI step that regenerates
it and diffs (`multiples.tsv`, `classic_id_overlay.tsv`). The spine
deliberately does not: it is a **snapshot of the final AT-HYG-driven
build**, so a legitimate refresh of an upstream input (a new Bailer-Jones
pull moving one row past the distance cutoff) would make a regeneration
gate demand rewriting a file whose whole purpose is to stop moving.

`inherited-spine-guard.test.ts` is the substitute: it reads the committed
TSV and pins the row count, the per-column fill rates, one Sol record, no
keyless row, and no duplicate source_id. Determinism itself was verified at
authoring time by generating twice and comparing bytes.

The generator retires with the driver swap — after `stellata-3bsf.4`
rewrites the AT-HYG row walk there is nothing for it to read, and
`stellata-3bsf.8` retires the spine itself in favour of Tycho-2 and the
other primaries AT-HYG merged.

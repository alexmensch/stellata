# Spine corrections — where review says AT-HYG merged wrong

The curated `data/membership/spine-corrections.tsv`, its parse, and the spine
as `build:membership` reads it once the corrections apply. The generator and
its gate are `../README.md`; the frozen spine itself is `../../spine/README.md`.

## Files in this area

```
scripts/catalog/membership/spine-corrections/
  spine-corrections-source.ts     SPINE_CORRECTIONS, the file's declaration
                                  (../../../util/sources/).
  spine-corrections-pure.ts       parseSpineCorrectionsTsv and
                                  applySpineCorrections. Tested through
                                  ../membership-manifest-pure.test.ts.
```

## Correcting a merge decision

The spine states which designations name one star, and that is the one thing no
primary supplies — so it is also the one thing no other curated file can
correct. `data/membership/spine-corrections.tsv` is where review says AT-HYG
merged wrong, keyed on `tyc`/`hip`/`hd`/`gl`, which is unique across all
<!-- count:inherited-spine/rows -->313,257<!-- /count --> spine rows. Two operations:

- **`set`** rewrites one cell. It accepts **`tyc` alone**: every other
  identifier the spine states is the label merge's, and a curated exception to
  a LABEL belongs in `classic_id_overrides.tsv` where the merge can see it.
- **`fold`** says the row is another spine row's duplicate, `value` naming that
  row's key. The folded row becomes no manifest row of its own.

A key matching no spine row, a `set` writing the value the spine already
states, a fold onto a folded row, and a row stating no evidence are all hard
errors — a curated file that silently does nothing is worse than none. So is a
row naming **no** key cell, which is the one blank that would resolve rather
than miss: Sol is the single spine row whose four key cells are all empty, so
an unkeyed correction lands on the Sun.

**A fold has to be a merge, not a drop.** After the rows are built the
generator holds every folded row's `spineDesignations` against the surviving
manifest row's, and fails on any the survivor does not answer to. It is an
identity event too: the folded row's SID retires with the survivor's as
successor ([§ 4.3](/docs/sid.md#43-ledger--datasidledgertsv)). Both today:

| Row | Op | What review found |
|---|---|---|
| TYC 2265-1793-1 / HIP 1997 | `set tyc` | the row is HD 2094 A on its HIP, its bound source and its HD, and carried B's TYC — 5.1″ away, and what the direction, V and PM cascades key on |
| the Gaia-keyed `Gl 277A` | `fold` | AT-HYG carried VV Lyn twice, 0.65″ apart at the same magnitude; `multiples.tsv`, CNS5 and SIMBAD each pair HIP 36626 with that source |

Both corrections **retire** a curated row rather than adding one: HD 2094's
queue verdict stays `differs` but its TYC route now agrees with the HIP and
SIMBAD ones, and the fold clears the `collision` the twin caused, so its
disposition goes. The survivor also gains the Gaia 5p solution the twin held —
83.3788 ± 0.0487 mas against Hipparcos-2's blended 84.26 ± 3.45.

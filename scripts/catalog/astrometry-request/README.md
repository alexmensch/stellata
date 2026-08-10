# Full-catalog astrometry request

The source_id list the Gaia 5p pull is made against. `pnpm run
build:astrometry-request` emits `data/gaia/gaia_catalog_source_id_request.tsv`
— **312,654** ids, the union of two contributions the table's two consumers
need (§ The request is a union). Not a network pull and not on the
`build:catalog` path: this is **input preparation** for `scripts/refresh/`,
which is why it sits beside the record build rather than inside it
(`../README.md` owns the output contract).

## Files in this area

```
scripts/catalog/astrometry-request/
  export-astrometry-request.ts    The generator. Streams the spine through
                                  iterSpineTsv for the membership half, adds
                                  the gate candidates, sorts, writes.
  export-astrometry-request-pure.ts
    (+ test)                      sortSourceIdsNumeric — the BigInt sort.
                                  Also imported by ../classic-ids/ and
                                  scripts/sid/export-dr-risk-set.ts, so it
                                  is a shared source_id helper rather than
                                  this script's private half.
```

The candidate half lives in `../classic-ids/binding-candidates.ts`, with the
gate that consumes it, not here — this folder decides what to *request*, not
what a classic-ID route may propose.

**source_ids exceed 2^53.** A lexicographic sort misorders unequal-length
ids and a `Number` sort collides them, so `BigInt` is the only correct
comparator — and it is what matches the ordering
`write_astrometry_request` gives the binaries-scope request file.

## Request and record build name the same set by construction

**311,886 source_ids** over 313,257 spine rows; the 1,371 rows carrying
none are the no-Gaia tier.

Reading the column is what makes the two agree. The generator used to walk
`data/athyg/athyg_33_classic_ids.csv` and re-run `resolveGaiaSourceId`
**ungated** — re-deciding a binding the spine had frozen, against reference
tables that have moved since, and without the G−V / sibling-letter gates
the frozen build applied (`../spine/README.md` § The identifier columns are
read, never re-derived). The two lists then agreed only because the walk
over-pulled.

Rebasing dropped 3,304 ids and gained 134. The drops are rows the walk
never turned into records (2,968 with no distance, 1 past `MAX_DIST_PC`)
plus bindings the frozen gates had scrubbed to empty (205) or re-bound to
a different source (130). Those 130 re-bindings are the same ids as 130 of
the gains — the walk kept a rejected native `gaia` cell where the build
took the HIP cross-walk's answer.

The remaining **four gains are the substantive win**: ξ UMa A, ξ UMa B,
ξ Sco and HD 75632, whose identifiers the frozen build resolved AFTER its
walk (`../spine/README.md` § The identifier columns are read). Nothing had
ever requested their tier-1 astrometry.

## The request is a union, and why that is not a compromise

`data/gaia/gaia_dr3_astrometry_catalog.tsv` has **two** consumers wanting
different sets, so the request is the union of both:

| Contribution | Ids | Consumer |
|---|---|---|
| the spine's `gaia_source_id` column | 311,886 | the record build: direction / rv / V / ci cascades |
| `../classic-ids/`' binding-gate candidates | +768 beyond the spine | the gate's `phot_g_mean_mag` evidence |

**The second one is not optional, and a spine-only request silently breaks
the gate.** The gate vets a *candidate* — whatever source a cross-walk
names for a designation — and the whole reason it exists is that a
candidate is frequently NOT the star, so candidates are routinely not spine
members. With no `phot_g_mean_mag` for one, `resolveGaiaSourceId`'s
magnitude check has nothing to compare and **passes by default**: rejections
become silent acceptances. Measured, on a spine-only request:
`gateRejectedMag` 102 → **0** and `rejected_bindings.tsv` 187 → 101 rows.

Nothing shipped moved when that happened — `label_flips.tsv` stayed
byte-identical and every SID resolved — because the extra bindings key
sources that are not records, so the label merge never applies them. That
is what makes it a *latent* fault rather than a visible one, and why it has
to be fixed rather than pinned: `stellata-3bsf.8` re-sources the spine, and
a source that becomes a record is one whose binding was never vetted.

`bindingCandidateSourceIds` (`../classic-ids/binding-candidates.ts`) is
shared with the overlay build so the two cannot drift, and
`binding-candidates.test.ts` pins the correspondence against a built overlay
rather than leaving it to inspection. It is 768 ids rather than the ~59k
every route could propose, because `applyBindingGate` skips what it cannot
weigh: an entry with no HIP (the TYC→HD route never attaches one) and a HIP
with no printed V are both skipped, so a `G` for either decides nothing.

That first narrowing is also why this script loads only two of the four
cross-walk inputs (`loadBindingCandidateInputs`): a `hip` reaches an overlay
entry from the HIP cross-walk or a CNS5 row and nowhere else, so the 2.5 M-row
TYC table decides no candidate and the overlay build is the only caller that
streams it.

**Requesting a candidate is not the same as pulling one.** A requested id the
archive returns no row for lands the gate right back in pass-by-default, which
is why `gateSkippedNoGMag` is pinned at **0**: it counts candidates that reached
the gate with no row in the pull, so a request that quietly stops covering them
fails the overlay snapshot instead of silently accepting bindings. It reads 0
today — the pull does return 6 fewer rows than the request (312,648 of 312,654),
but all 6 are spine members rather than candidates. What it cannot fix is
`gateSkippedNullGMag` (63): sources Gaia has a row for and publishes no
`phot_g_mean_mag` for, which stay unvettable at any request size.

## What the pulled set feeds

The request drives `scripts/refresh/refresh-gaia-astrometry-catalog.py` →
the astrometry catalog, which is tier 1 of the direction cascade and the rv
cascade, the source of the BP/RP the V and ci cascades transform, and the
gate's evidence above. `pnpm run build:classic-ids` — CI asserts the
overlay byte-identical — is what proves a change to this request did not
move the gate.

# Full-catalog astrometry request

The source_id list the Gaia 5p pull is made against. `pnpm run
build:astrometry-request` emits `data/gaia/gaia_catalog_source_id_request.tsv`
— **378,111** ids, the union of three contributions the table's three
consumers need (§ The request is a union). Not a network pull and not on the
`build:catalog` path: this is **input preparation** for `scripts/refresh/`,
which is why it sits beside the record build rather than inside it
(`../README.md` owns the output contract).

## Files in this area

```
scripts/catalog/astrometry-request/
  export-astrometry-request.ts    The generator. Streams the membership
                                  manifest through iterManifestTsv for the
                                  membership half, adds the gate candidates
                                  and the bound-pair siblings, sorts, writes.
  export-astrometry-request-pure.ts
    (+ test)                      sortSourceIdsNumeric — the BigInt sort.
                                  Also imported by ../classic-ids/ and
                                  scripts/sid/export-dr-risk-set.ts, so it
                                  is a shared source_id helper rather than
                                  this script's private half.
```

Each non-membership contribution lives with the consumer that defines it, not
here
— this folder decides what to *request*, not what a route may propose:
`bindingCandidateSourceIds` in `../classic-ids/binding-candidates.ts`, and
`pairMemberSourceIds` in `../distance/parallax/pair-member-parallax.ts`.

**source_ids exceed 2^53.** A lexicographic sort misorders unequal-length
ids and a `Number` sort collides them, so `BigInt` is the only correct
comparator — and it is what matches the ordering
`write_astrometry_request` gives the binaries-scope request file.

## Request and record build name the same set by construction

**370,311 source_ids** over 376,934 manifest rows; the 6,623 rows carrying
none are the no-Gaia tier.

Reading the column is what makes the two agree — `readStars` reads the same
cell. Re-running `resolveGaiaSourceId` here instead would re-decide a binding
the manifest justified, against reference tables that have moved since, and
without the G−V / sibling-letter gates
(`../membership/README.md` § The identifier columns are read, never
re-derived).

## The request is a union, and why that is not a compromise

`data/gaia/gaia_dr3_astrometry_catalog.tsv` has **three** consumers wanting
different sets, so the request is the union of all three:

| Contribution | Ids | Consumer |
|---|---|---|
| the manifest's `gaia_source_id` column | 370,311 | the record build: direction / rv / V / ci cascades |
| `../classic-ids/`' binding-gate candidates | 99,799, +521 beyond the manifest | the gate's `phot_g_mean_mag` evidence |
| `multiples.tsv`' kept-physical pair members | 16,108, +7,279 beyond the two above | the parallax cascade's `pair_member_parallax` tier |

**The third one is the same shape as the second**, and arrived the same way —
by a consumer being added without the request following. A bound pair's member
is routinely not a manifest row (a component Gaia resolved that no primary
indexes), and the tier lends that member's parallax to the sibling Gaia fitted
none for. Measured before the widening: of the 44 parked rows `multiples.tsv`
covers, 15 had a sibling carrying its own source_id and **8 of those siblings
had no row in the table**, so the tier's reach was a property of the request
rather than of the sky.

It asks for every kept-physical pair member rather than only the roots holding
a parked row. Which rows park is an *output* of the build this request feeds,
so keying the request on it would leave the two defining each other and the set
unstable under any cascade change (`pairMemberSourceIds` says so at the
definition).

**The second one is not optional, and a membership-only request silently
breaks the gate.** The gate vets a *candidate* — whatever source a cross-walk
names for a designation — and the whole reason it exists is that a
candidate is frequently NOT the star, so candidates are routinely not
membership rows. With no `phot_g_mean_mag` for one, `resolveGaiaSourceId`'s
magnitude check has nothing to compare and **passes by default**: rejections
become silent acceptances. Measured on a membership-only request at the time
the fault was found: `gateRejectedMag` 102 → **0** and
`rejected_bindings.tsv` 187 → 101 rows. The extra bindings key sources that
are not records, so nothing shipped moved — which is what made it a *latent*
fault, and why it is fixed rather than pinned: a source that becomes a record
is one whose binding was never vetted.

`bindingCandidateSourceIds` (`../classic-ids/binding-candidates.ts`) is
shared with the overlay build so the two cannot drift, and
`binding-candidates.test.ts` pins the correspondence against a built overlay
rather than leaving it to inspection. It is far short of the ~59k
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
today — the pull does return 6 fewer rows than the request (378,105 of 378,111),
but all 6 are membership rows rather than candidates: they are the DR2 ids of
`data/athyg/stale_gaia_source_ids.tsv`, which DR3 does not publish
(`../spine/README.md` § Six source_ids DR3 does not publish). What it cannot
fix is
`gateSkippedNullGMag` (63): sources Gaia has a row for and publishes no
`phot_g_mean_mag` for, which stay unvettable at any request size.

## What the pulled set feeds

The request drives `scripts/refresh/refresh-gaia-astrometry-catalog.py` →
the astrometry catalog, which is tier 1 of the direction cascade and the rv
cascade, the source of the BP/RP the V and ci cascades transform, and the
gate's evidence above. `pnpm run build:classic-ids` — CI asserts the
overlay byte-identical — is what proves a change to this request did not
move the gate.

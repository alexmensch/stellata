# Full-catalog astrometry request

The source_id list the Gaia 5p pull is made against. `pnpm run
build:astrometry-request` emits `data/gaia/gaia_catalog_source_id_request.tsv`
— **378,840** ids, the union of four contributions the table's four
consumers need (§ The request is a union). Not a network pull and not on the
`build:catalog` path: this is **input preparation** for `scripts/refresh/`,
which is why it sits beside the record build rather than inside it
(`../README.md` owns the output contract).

## Files in this area

```
scripts/catalog/astrometry-request/
  export-astrometry-request.ts    The generator. Streams the membership
                                  manifest through iterManifestTsv for the
                                  membership half, adds both gates' candidates
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
`bindingCandidateSourceIds` in `../classic-ids/binding-candidates.ts`,
`derivationCandidateSourceIds` in `../membership/binding-derivation-pure.ts`,
and `pairMemberSourceIds` in `../distance/parallax/pair-member-parallax.ts`.

**source_ids exceed 2^53.** A lexicographic sort misorders unequal-length
ids and a `Number` sort collides them, so `BigInt` is the only correct
comparator — and it is what matches the ordering
`write_astrometry_request` gives the binaries-scope request file.

## Request and record build name the same set by construction

**371,098 source_ids** over 376,929 manifest rows; the 5,831 rows carrying
none are the no-Gaia tier.

Reading the column is what makes the two agree — `readStars` reads the same
cell, and the binding it carries was derived once, in the generator, through
the G−V / sibling-letter gates (`../membership/README.md` § The binding is
derived). The derivation's own candidates are the third contribution below,
so the pull carries a G for every source it might bind before it binds one.

## The request is a union, and why that is not a compromise

`data/gaia/gaia_dr3_astrometry_catalog.tsv` has **four** consumers wanting
different sets, so the request is the union of all four:

| Contribution | Ids | Consumer |
|---|---|---|
| the manifest's `gaia_source_id` column | 371,098 | the record build: direction / rv / V / ci cascades |
| `../classic-ids/`' binding-gate candidates | 99,799, +493 beyond the manifest | the gate's `phot_g_mean_mag` evidence |
| `../membership/`' binding-derivation candidates | 313,290, +231 beyond the two above | the derivation's `phot_g_mean_mag` evidence — every source any spine row could be bound to |
| `multiples.tsv`' kept-physical pair members | 16,108, +7,018 beyond the three above | the parallax cascade's `pair_member_parallax` tier |

**The derivation's contribution is the second one's shape again, on the record
side**: the manifest generator weighs candidates before it writes a binding,
so the candidates cannot be read off the manifest column — the column is the
outcome. Requesting them all, whatever a row ends up bound to, is what lets
the generator's `derivedWeighedNoGMag` pin at zero the same way the overlay's
`gateSkippedNoGMag` does; the reviewed bindings a disposition keeps
against every source are in the manifest column and so requested by the first
contribution.

**The pair-member one is the same shape as the second**, and arrived the same way —
by a consumer being added without the request following. A bound pair's member
is routinely not a manifest row (a component Gaia resolved that no primary
indexes), and the tier lends that member's parallax to the sibling Gaia fitted
none for. Its coverage now has a zero-pin of its own,
`pairMemberSiblingNoAstrometryRow` — the sibling sources this pull holds no row
for, which is the only reason the tier misses one that a re-pull can fix
(`../distance/parallax/README.md` § The tier's reach is bounded by measurement
quality). Every other refusal there is a measurement, and
`pairMemberSiblingNotAnchorGrade` — the anchor gate on fit quality alone —
dominates them.

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

That narrowing is why the gate's contribution loads only two of the cross-walk
inputs (`loadBindingCandidateInputs`): a `hip` reaches an overlay entry from
the HIP cross-walk or a CNS5 row and nowhere else. The derivation's
contribution is what streams the 2.5 M-row TYC table here, narrowed to the
spine's own Tycho ids (`loadBindingTables`), because the TYC walk on the
record's own TYC is one of its four sources.

**Requesting a candidate is not the same as pulling one.** A requested id the
archive returns no row for lands the gate right back in pass-by-default, which
is why `gateSkippedNoGMag` and `derivedWeighedNoGMag` are pinned at **0**: each
counts candidates that reached its gate with no row in the pull, so a request
that quietly stops covering them fails a snapshot instead of silently accepting
bindings. Both read 0 today — the pull does return 2 fewer rows than the
request (378,838 of 378,840), but both are reviewed bindings rather than
candidates: the two DR2 ids of `data/athyg/stale_gaia_source_ids.tsv` SIMBAD
holds no DR3 successor for (`../spine/README.md` § Six source_ids DR3 does not
publish). What no request can fix is `gateSkippedNullGMag` (63) and
`derivedWeighedNullGMag` (77): sources Gaia has a row for and publishes no
`phot_g_mean_mag` for, which stay unvettable at any request size.

## What the pulled set feeds

The request drives `scripts/refresh/refresh-gaia-astrometry-catalog.py` →
the astrometry catalog, which is tier 1 of the direction cascade and the rv
cascade, the source of the BP/RP the V and ci cascades transform, and both
gates' evidence above. `pnpm run build:classic-ids` and `pnpm run
build:membership` — CI asserts both artifacts byte-identical — are what prove a
change to this request did not move either gate.

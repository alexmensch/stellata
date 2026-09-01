# The parallax cascade

The measured parallax behind every record's distance. The last § 5 cascade to
retire its printed cell, and the only one whose residual is a membership event:
rv and PM fall back to a null — zero motion, the star stays where it is —
whereas a record with no distance cannot be placed at all.

`../README.md` § Multi-layer distance refinement owns the two override layers
that sit *above* this cascade; this file owns which parallax they override.

## Files in this area

```
scripts/catalog/distance/parallax/
  parallax-cascade.ts (+ test)  The cascade, its tier enum, the two precision
                                constants, and the `DistVia → BuildCounts` key
                                map. Imports both skip predicates from
                                ../gaia-distrust.
  pair-member-parallax.ts       The `pair_member_parallax` index: multiples.tsv
    (+ test)                    pair rows × the DR3 astrometry table, per WDS
                                root. Built once before the walk, in
                                ../../parse/read-stars-inputs.ts.
  simbad-sourced-ledger.ts      The `simbad_plx` records, by the two keys a
    (+ test)                    SIMBAD-based validator joins on — § 5's
                                validation independence. Written by
                                build-catalog.ts, read by
                                ../../validate/validate-simbad-sample.ts.
  parked-ledger.ts (+ test)     The § 6.1 dropped list — where it is committed,
                                its closed reason enum, and the spine key the
                                parity gate matches it on. The producer is
                                build-catalog.ts, the consumer
                                ../../spine/inherited-spine-parity.test.ts.
```

## The cascade

`resolveParallax` runs per row inside `readStars`, and `dist = 1000 / plx`
unless an override layer replaces it. Counts pin as `dist*`.

| Tier | Key | Rows |
|---|---|---|
| `gaia_dr3_inversion` | the record's own DR3 5p parallax | see note |
| `hip2_parallax` | its own HIP, above the S/N floor | |
| `cns5_plx` | its own GJ, non-Gaia citation only | |
| `gliese_plx` | its own GJ in V/70A | |
| `simbad_plx` | bibcoded, neither skip rule firing | |
| `pair_member_parallax` | a bound sibling's clean DR3 fit | |
| `curated` | Sol alone | 1 |
| `none` | — | § 6 ledger drop |

Most `gaia_dr3_inversion` rows are then superseded by `bailer_jones`, which is
counted in its place rather than alongside it, so the two never double-count.
`lmc_kinematic` likewise replaces whatever tier a supergiant resolved.

**Gaia leads, and § 5's table has the order wrong.** § 5 lists HIP2 above the
inversion, which was right while that tier fired only for the Gaia-saturated
bright set. Re-keyed onto the record's own HIP it governs ~2,600 records, and
that order would hand 115 of them to 1991 Hipparcos over a converged DR3 fit.
The direction cascade already answers this — `hip2_saturated` fires only where
Gaia states no usable parallax — so distance follows the same astrometric
solution the position did.

**The bottom tier lends rather than serves.** Every tier above it states a
measurement of *this* record; `pair_member_parallax` states one of its bound
sibling's. That is why it sits below even the second-order indices — a
neighbour's fit is a weaker claim than a poor citation of the star's own — and
above `none` only because the alternative is no record at all. The physical
warrant is the one `applySystemDistanceCoherence` already ships
catalogue-wide (`../../multiplicity/README.md` § System distance coherence): a
bound pair's components share a distance to a part in a million. It borrows
that pass's anchor gate outright (`isCoherenceAnchorGrade` — parallax > 0,
RUWE ≤ 1.4, `ipd_frac_multi_peak` ≤ 2 on the 0–100 scale, G ≥ 3.0), plus this
cascade's own S/N floor, so a sibling that could not anchor a system cannot
place a member either.

σ Orionis is the case the tier was built for. Its own source publishes no
parallax at all and reads `ipd_frac_multi_peak` 37; HIP2 states 3.04 ± 8.92 mas
(S/N 0.34), which the floor refuses. The same WDS root holds HIP 26551 D on its
own clean 5p solution — 2.4744 ± 0.0622 mas, RUWE 1.0689, `ipd` 0 — inverting
to 404.1 ± 10.2 pc. Schaefer et al. 2016's dynamical parallax, 387.5 ± 1.3 pc,
agrees at 1.62 σ. Both say the 328.9 pc the floor refused is ~20% wrong.

**The tier's reach is bounded by measurement quality, not by our request.**
Of the 44 parked rows `multiples.tsv` carries a row for, **15** have a sibling
carrying its own `source_id` rather than the blended primary's: **8 rescue**,
and the other 7 have a sibling the anchor gate refuses — 4 on RUWE alone, 2 on
RUWE and a blended image, 1 on the blend, and 3 whose sibling publishes no
parallax either. Every one of those 15 siblings now has a row in the frozen
table; the request the table is pulled against was widened to cover them
(`../../astrometry-request/README.md` § The request is a union), which is what
took the tier from 5 to 8. The 29 remaining parked rows with a `multiples.tsv`
row have no sibling carrying an id of its own at all — Stage 2/3 bound the
primary's blended source to every component.

**A sibling's parallax is read on the sibling's OWN `gaia_source_id`**, and the
index drops a repeated one per root. Stage 2/3 bind a single blended source to
every component row of a sub-arcsec pair, so a root's rows routinely repeat the
primary's id; reading the astrometry table on it twice would hand a member back
the fit it already carries, dressed as a sibling's.

**Sol needs a curated tier** for the third time in this epic: it carries no
identifier any tier keys on, and its distance is zero rather than a parallax.
Direction and V each hit the same wall.

## Two precision lines, and why only one is a gate

`PARALLAX_SN_FLOOR = 1` and `PARALLAX_LOW_PRECISION_SN = 5` measure different
failures, which is why the tighter one does not gate:

- **Below S/N 1** the parallax is not distinguishable from zero, so its inverse
  is unbounded above. Inverting is not imprecise but *undefined*, and the value
  is refused. Ungated, this tier puts 19 rows past 1,000 pc and one at
  25,000 pc off a parallax of S/N 0.11 — a V 5.89 naked-eye star — which is the
  catastrophic inversion the SU Cru report is about. None survives the floor.
- **Between 1 and 5** the inversion is biased (the ~20% fractional-error bound;
  Bailer-Jones 2015) but still carries information. These rows have no second
  source, so refusing would cost each its record rather than its precision.
  They ship, counted as `distHip2LowPrecision`.

That count is the whole mechanism keeping the low-precision population visible
for a Gaia DR4 revisit. It is deliberately a count and not a committed list: the
set is one predicate away — `plx / e_plx < PARALLAX_LOW_PRECISION_SN` over the
`hip2_parallax` tier — and a derived file would drift against a HIP2 refresh
while reading as authoritative.

## The skip rules — one principle, two publications

**A courier may not re-serve a value attributed to a publication a tier above it
already refused.** The Gaia rule shipped first (`../radial-velocity/`,
`../pm-rescue/`) and reads like a Gaia-specific policy; it is not, and the
parallax cascade is where the general shape became visible.

- **Gaia releases, on a 2p row.** DR3 published a position for the source and
  *withdrew* the parallax DR2 had. A CNS5 or SIMBAD value citing a release is
  that withdrawn fit returning. Where the record carries no Gaia solution there
  is no blend to distrust and the citation is ordinary, so the rule gates on the
  2p solution rather than on the tier.
- **van Leeuwen 2007, where the S/N floor refused HIP2.** For a HIP-bearing
  record SIMBAD's parallax usually *is* van Leeuwen's. Without this rule the
  floor refuses a value and the tier below re-admits the identical number
  stripped of the error bar the refusal was based on — measured at **574**
  records matching to the digit. HIP 37 is the shape: HIP2 states 2.62 ± 2.55
  mas, SIMBAD serves 2.62.

**A SIMBAD-sourced distance is excluded from SIMBAD-based validation**, which
is § 5's validation-independence rule reaching this field for the first time —
no earlier cascade had a SIMBAD tier under a validator that checks the same
quantity. Both validators honour it: `distance-regression-check` reads
`distVia` in-process, and `validate-simbad-sample` reads
`data/athyg/simbad_sourced_distances.tsv`, because it runs off `catalog.bin`,
which carries no tier. Without it 93 records would report a residual of zero
against the parallax they were derived from and bias the metric toward
agreement that was never measured.

Gliese `V/70A` is subject to neither: its parallaxes are ground-based
trigonometric astrometry predating both instruments, so no later reduction
stands behind them to withdraw. That is also what makes it the tier that keeps
44 Boötis (Gl 423 A/B, V 4.33/4.80 at 10.4 pc) — CNS5 holds a parallax for the
pair, cites Gaia DR2, and is refused.

**Both indices cite Gaia by two different forms** and `../gaia-distrust.ts`
must hold both: SIMBAD names the VizieR table (`2018yCat.1345....0G`), CNS5 the
release paper (`2018A&A...616A...1G`, on 45 of its parallaxes). A set holding
one form lets the other walk a withdrawn value straight through. DR1/TGAS is
deliberately *not* in that set — its astrometry is a joint solution over Gaia
**and** the Hipparcos/Tycho-2 positions, so it is a different measurement rather
than the same fit returning.

## Why the residual drops rather than degrading

§ 5's residual policy allows a deliberate ledgered drop, and this is the cascade
that needs it. The alternative was admitting a Gaia-release parallax wherever it
was the row's last tier, which was weighed and rejected on measurement rather
than on principle:

Checked against Hipparcos — an independent instrument — on the 270 refused rows
where both exist, the withdrawn Gaia value sits a median **2.19 σ** from the
Hipparcos one where Hipparcos is trustworthy (S/N ≥ 10), inside 2 σ only 44% of
the time, a median **13.6%** apart in absolute terms. Worst cases are not
marginal: HIP 100241 reads 26.776 mas against 10.810 ± 0.540 (29.6 σ); HIP 80553
reads 0.099 mas — 10 kpc — against 9.500 mas, or 105 pc. The disagreement tracks
Gaia's own blend flag, the worst offenders at `ipd_frac_multi_peak` 39–79%. The
withdrawal was justified, so these are refusals of a measurement known to be
wrong, not of an old one.

**The residual is not the nearby cohort**, which is the thing worth checking
before dropping anything: only 24 rows sit inside 50 pc on the printed cell, and
that cell *is* the refused value. All 24 have exactly one parallax across CNS5,
SIMBAD and Gliese and it cites Gaia DR2; 11 have none at all. Of the 11 the
refused value places inside 25 pc, **8 are absent from CNS5** — a
volume-complete 25 pc census whose compilers held the same DR2 data and declined
to list them. Their only claim to proximity is the measurement that measures
wrong. The 20 carrying GJ 3xxx/4xxx supplement numbers neither CNS5 nor V/70A
indexes are the Gliese shortfall the spine retirement already tracks; closing it
needs a dedicated nearby-star parallax programme, not a re-pull.

Records the pipeline stops producing are **presence events, not retirements**
(`docs/sid.md`), so every dropped record keeps its SID and reinstates on the
same identity when Gaia DR4 fits these blends. The drop is a park, and the
reason code says so.

**A park is a ledger entry, never a membership-gate drop.** The five
`spineDropped*` counts are the spine's own promises and stay pinned at zero —
a non-zero one means a refreshed reference table moved a row out from under the
snapshot, which is a different and unintended event. The park is counted as
`distNone`, enumerated in `parked_no_owned_parallax.tsv`, and gated by
`../../spine/inherited-spine-parity.test.ts`, which subtracts it from the
parity arithmetic only as far as the committed ledger accounts for it.

**Companion promotion may not walk a parked record back in.** multiples.tsv
states a distance for every component, and for a parked row that distance is
the measurement a tier above already refused — σ Ori Aa's pair row reads
`astrometry_via=hip2_long_baseline` at 328.947368 pc, which is 3.0400000 mas,
the refused HIP2 value to eight significant figures. Promoting it would
re-serve a refusal through a courier, which is the general rule at the head of
§ The skip rules. Measured across all 44 parked rows multiples.tsv carries a
row for: `astrometry_via` is `system_inherited` 65 and `hip2_long_baseline` 61,
and `gaia_5p` **zero** — not one of them has an independent per-component fit
behind it, so there is no case where promotion supplies an owned distance. The
refusal is counted as `companionDroppedParkedRecord`.

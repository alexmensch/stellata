# The proper-motion rescue cascade

A proper motion for the rows the direction cascade leaves without one, so they
stop shipping static under the epoch scrub. The tangential term's fall-back
tier; the radial term's is `../radial-velocity/`, and the direction tiers that
supply a PM alongside their own position are `../README.md` § Direction
resolution.

## Files in this area

```
scripts/catalog/distance/pm-rescue/
  pm-rescue.ts (+ test)   The cascade, its route enum, and the map crediting
                          each route to the `velocityVia` bucket for the
                          catalogue it reached. Imports `isGaiaCatalogueBibcode`
                          from ../gaia-distrust — the same predicate the rv
                          cascade's skip rule turns on.
```

## What reaches it, and where it goes

`resolvePmRescue` fires only where the winning direction tier's own solution
carries no PM. The motion it supplies then carries **both** terms: the velocity,
and the tier's position forward to the scene epoch (§ The rescued motion
advances the position too). It reaches **276** rows in two shapes:

- **273** resolve to a Gaia row with a 2p (position-only) solution and have no
  HIP2 cover, so they take the `gaia_5p` route's PM-less anchor. The 1,264
  other 2p rows route `hip2_saturated`, take HIP2's motion, and were never
  static — the whole 2p population is 1,537, and only this slice of it was the
  bug.
- **3** are Tycho-2 rows with no mean solution (`pflag='X'`, plus one
  supplement `flag='T'`), whose PM cells are empty.

Routing, pinned in `../../build-catalog-expected.json` as `pmRescue*`:

| Route | Key | Rows |
|---|---|---|
| `tycho2` | the record's own TYC | **242** |
| `cns5` | its own GJ, non-Gaia citation only | **2** |
| `simbad` | bibcoded `pmra`/`pmdec`, non-Gaia citation only | **17** |
| `gaia_bibcode_skipped` | — | **13** |
| `none` | — | **2** |

The order is the direction cascade's own designation-joined order, so a
first-order catalogue always outranks the second-order index.

**`velocityVia` credits the catalogue, not the route to it.** A row's PM came
from Tycho-2 whether the direction tier or this cascade found it, so
`velocityTycho2Pm` reads **282** against a `directionTycho2` of 43 and the two
counts answer different questions. `velocityZero` drops 285 → **24**: Sol, the
8 rows the sanity ceiling clamped, and the 15 this cascade leaves.

Do not read the cohort's 273 against Tycho-2's **1,537 `pflag='X'` rows**
(`data/tycho2/README.md`): that the 2p population and that flag count match to
the digit is a coincidence of two unrelated catalogues.

**Neither join widens, and that is measured rather than argued.** A 2p row is
a close pair by construction, so this cohort is exactly where
`../../classic-ids/README.md`'s warning bites — a TYC names the Tycho entry,
which for a close pair is the system rather than the component. It does not
bite here, on either side:

- all **242** Tycho-2 routes key on the full three-part TYC, and not one of
  those ids is carried by a second spine row, so no rescued motion is shared
  across records by the join itself (ξ UMa A and B share a motion because
  Tycho-2 publishes the same photocentre solution under both component ids —
  `2520-2634-1` and `-2` state identical `pm_ra`/`pm_de` — not because one row
  was reused);
- all **31** TYC-less cohort rows reach SIMBAD on their own `gaia_source_id`,
  none through the widening ladder's HIP / TYC / GJ rungs, so the pull's
  widening veto has nothing to adjudicate for this cascade.

Both hold today and neither is structural — a re-pull that widens more, or a
spine that splits a Tycho entry into components, moves them. Re-derive against
the spine before leaning on either.

## Why an owned PM on a blended row is admissible at all

A 2p solution says Gaia's own five-parameter fit did not converge on this
source, which on a close pair is the blend it could not separate. It does not
say the object has no measurable motion, and it forbids only a PM **from that
fit**.

Tycho-2's is a different measurement, not a better-behaved copy of the refused
one: its proper motions tie the 1991-epoch star-mapper positions to the
Astrographic Catalogue and ~140 other ground-based catalogues, a ~90-year
baseline against Gaia's 34 months. On an unresolved pair it measures the light
centre's mean motion, which averages the orbit rather than sampling one phase
of it — closer to the systemic motion the epoch-advance wants than a converged
short-baseline fit would be. That is the argument `hip2_pm_discrepant` already
makes one tier up.

**The one-solution pairing is not really broken.** A 2p Gaia position *is* the
blend's light centre at J2016, and a Tycho-2 mean PM *is* that same light
centre's motion; the two describe one object, which is what the rule protects
(`../../parse/README.md` § Space-motion velocity). Both `pflag='P'` rows in the
cohort — ξ UMa A and B — are the case in point: the flag warns that the mean
*position* is a light centre, the PM is the quantity being taken, and handing
both components the one Tycho-2 motion is what stops the advance shearing the
pair apart. They ship a tangential 36.81 km/s each.

## The rescued motion advances the position too

`directionOnPm` (`../direction-cascade.ts`) re-advances the tier's position over
the rescued PM, so a row never tracks the right rate from a place its own tier
left stale. Only the **3** Tycho-2-shaped rows move: their `ra_icrs` is stated at
J2000 and everything else in the cohort is a Gaia 2p row already native to
J2016.0, where the advance is a zero-Δt no-op.

| Row | Distance | \|μ\| | Moves |
|---|---|---|---|
| TYC 1269-128-1 (HD 285742) | 52.6 pc | 94.4 mas/yr | **1.511″** |
| TYC 158-2314-1 | 546.7 pc | 6.0 mas/yr | 0.095″ |
| TYC 1867-2317-1 | 835.9 pc | 4.4 mas/yr | 0.070″ |

**What says the advance is right is an identity, not the residual.** The rescued
PM is SIMBAD's on all three, and SIMBAD states its own J2000 position, so
advancing *that* over the same 16 yr is an independent J2016 estimate. After the
change each row sits exactly the two catalogues' J2000 disagreement away from it
— 0.948″ / 0.395″ / 0.077″ — because the epoch term has cancelled and nothing
but the frame offset survives. Before, that offset was compounded with a full
16 yr of uncorrected motion: HD 285742 was **2.457″** out and is now 0.948″.

Two consequences worth stating rather than discovering:

- **The residual is now a positional disagreement, not an epoch error**, and on
  HD 285742 it is the larger of the two terms. Tycho-2 supplement 1's J2000 cell
  is a Tycho-1-era position; SIMBAD's is Gaia EDR3 back-propagated. Preferring
  SIMBAD's *position* where its PM is what rescued the row would close it, at
  the cost of moving these rows off the `tycho2` tier — `stellata-3bsf.35`.
- **TYC 1867-2317-1 gets 0.038″ worse** (0.039″ → 0.077″), because its two error
  terms used to partly cancel by luck. Sub-0.1″ on an 836 pc star, and a
  systematic correction is preferred over an accidental one.

## The Gaia-bibcode skip rule, and what it costs

CNS5 and SIMBAD both republish Gaia's own earlier fit of the same source under
a Gaia release bibcode — 87% of CNS5's proper motions cite one — so on a 2p row
the cascade **skips** those candidates and falls through. Admitting them would
return the motion DR3 declined to state, and they are not a marginal case of
that: for **241** of the 273 the spine's retired `pm_src` reads `G_R2`, and the
printed cell matches the SIMBAD value to the digit on **253**. Reading the
printed cell back in and taking the DR2 tier are the same number under
different labels, and `docs/catalog-driver.md` § 5 retires that number either
way.

Tycho-2 needs no such check — it is a completed 1997-epoch publication and no
Gaia reduction can hide behind its citation.

**The rule gates on the record's own 2p solution, not on the tier.** Where
there is no Gaia fit at all there is no blend to distrust and a Gaia bibcode is
an ordinary citation; all 3 Tycho-2-shaped rows route `simbad` on an
EDR3-cited PM for exactly that reason. This mirrors the rv cascade, which
keeps 363 ordinary Gaia citations while skipping 309 on blended rows.

**The cost is 13 rows that stay static, concentrated where it hurts most**:
Gl 1245A at 4.69 pc and Gl 791.2 at 7.47 pc are the two nearest, and zero is
not a better estimate than the value refused. The rule is preferred anyway for
the reason the rv cascade gives (`../radial-velocity/README.md` § The
Gaia-bibcode skip rule) — a value this build cannot defend does not become
defensible by arriving through an index — and § 5's residual policy is explicit
that a residual is enumerated rather than silently absorbed. Admitting a
Gaia-bibcoded PM only where nothing else reaches the row would rescue all 13
and is one condition; it is not taken because it would key on what our pull
happens to hold rather than on the star.

The **2** `none` rows (GJ 3536, GJ 3673) had nothing to refuse: no owned source
reaches them at all.

## What the cohort's worked cases ship

| Star | Distance | Route | Tangential |
|---|---|---|---|
| EZ Aqr (Gl 866A) | 3.41 pc | `simbad`, UCAC4 | **52.63 km/s** |
| Gl 747A | 8.32 pc | `simbad` | 66.20 km/s |
| ξ UMa A / B | 10.42 pc | `tycho2` | 36.81 km/s each |
| Gl 1245A | 4.69 pc | skipped | 0 |
| Gl 791.2 | 7.47 pc | skipped | 0 |

EZ Aqr is the case the rv cascade predicted: its 6,824.7 km/s SIMBAD velocity
is still rejected on its own, and the row keeps the 3.26″/yr motion the
whole-vector clamp would have taken with it
(`../radial-velocity/README.md` § The sanity thresholds).

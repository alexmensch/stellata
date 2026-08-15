# Radial velocity

The radial term of the space-motion velocity: which source supplies it, the
gate that withholds Gaia's, and the rule stopping a withheld value from
returning through SIMBAD. The tangential term and the velocity assembly that
consumes both are `../README.md` § Direction resolution and
`../../parse/README.md` § Space-motion velocity.

## Files in this area

```
scripts/catalog/distance/radial-velocity/
  radial-velocity.ts (+ test)   The cascade, the Gaia-bibcode taxonomy the
                                skip rule turns on, the error banding, and
                                the ceiling test that rejects a nonphysical
                                radial term on its own. Imports
                                `gaiaHas5pSolution` and the sanity ceiling
                                from ../direction-cascade — one predicate and
                                one bound, so the radial and tangential terms
                                distrust a row for the same reason.
```

## The cascade

`resolveRadialVelocity` runs three tiers:

```
Gaia DR3 radial_velocity   the RVS median, on a row with a 5p solution
  → SIMBAD rvz_radvel      bibcoded, over the § 5 value cohort
  → zero radial term
```

The spine's printed `rv` cell is **not** a tier and is no longer read: it is
an AT-HYG transcription we cannot re-pull, so `docs/catalog-driver.md` § 5
retires it. Its 871 `rv_src=OTHER` cells were unattributable even by that
standard and drop unconditionally — EZ Aqr's −60.0 among them.

Per-tier counts are pinned as `rvGaiaDr3` **266,128** / `rvSimbad` **7,273** /
`rvNone` **39,856**, the same discipline the direction cascade pins
`directionVia` under. The SIMBAD tier is not the printed cell renamed:
against the 7,126 rows that cell used to cover it drops 655 (560 the pull
does not reach, 95 the skip rule rejects) and adds 804 rows that had no
printed velocity at all.

A genuine zero is a velocity, not an absence: the cascade routes on
null-vs-present, never on truthiness, or every star with no measured
line-of-sight motion would fall to the next tier.

**The fall-through is not a degraded copy of the tier above it.** RVS is
magnitude-limited to G_RVS ≲ 14, so it reaches roughly a third of Gaia
sources; for the bright cohort the SIMBAD tier serves, the older literature
is the only velocity there has ever been.

## The 5p gate

**The Gaia tier needs a 5p solution, not merely an `rv` cell.** RVS measures the
same window the astrometric fit does, so a 2p row — parallax and PM both
unfitted — is one whose spectrum is a blend of the components, and its median RV
is not the primary's. ξ UMa is the case that fixed the rule: source
756853643638639104 is 2p with `ipd_frac_multi_peak` 24 on a ~2″ pair, and its
`radial_velocity` is −26.78 km/s against the printed −15.9. `gaiaHas5pSolution`
is the same predicate the direction cascade's tier-1 branch turns on, so the
radial term and the tangential term distrust a row for one reason.

## The Gaia-bibcode skip rule

The gate above withholds a Gaia rv for a physical reason, and SIMBAD serves
the very same value back under a Gaia catalogue bibcode — so on rows where
the record's own gate withheld one, the SIMBAD tier **skips** candidates
whose `rvz_bibcode` names a Gaia release (`isGaiaCatalogueBibcode`), falling
to zero rather than laundering the withheld value in. It fires on **205** of
the 354 gate-withheld rows.

What it catches is not a near-match but the identical measurement. Over those
354 rows, |Δrv| against the withheld Gaia value splits cleanly by bibcode:

| Bibcode class | n | p50 \|Δrv\| | p90 | max |
|---|---|---|---|---|
| Gaia DR3 (`2022yCat.1355....0G`) | 84 | **0.0026** | 0.0044 | 0.0049 |
| Gaia DR2 (`2018yCat.1345....0G`) | 121 | 0.9752 | 4.7227 | 69.955 |
| literature | 61 | 3.0107 | 16.878 | 75.485 |

The DR3 row is the value coming straight back, agreeing to the print
precision SIMBAD stores it at. DR2 is a different reduction of the same
instrument and literature is an independent measurement, which is why the
rule keys on the bibcode rather than on agreement.

**Nothing was withheld on a row Gaia never measured**, so a Gaia catalogue
bibcode there is an ordinary citation, not laundering: **465** shipped rows
carry one — **380 DR2 and 85 DR3** — and the skip rule leaves them alone.
Every one of the 85 is a record the spine carries no `gaia_source_id` for, so
no gate could have withheld anything: SIMBAD resolved the object to a Gaia
source this build cannot key, and that DR3 velocity reaches the record only
through the citation. `rvSimbad`, `rvSimbadGaiaBibcode` and
`rvGaiaBibcodeSkipped` pin all three populations.

**Where the rule stops, and why.** Its precondition is a *withheld* value —
the record's own Gaia row carries an rv the 5p gate refused. A 2p row Gaia
published no rv for has nothing to launder back, so its SIMBAD candidate
ships: **102** rows, all DR2. The blend argument distrusts those spectra
equally, but the only alternative on offer is a zero radial term, and for a
bound pair the blended systemic velocity is nearer the component's truth than
zero is. They ship deliberately; `radial-velocity.test.ts` pins the boundary
so widening the rule is a decision rather than a drift.

A DR4 release adds one entry to `GAIA_CATALOGUE_BIBCODES`.

## What the tier reaches is decided by other fields

`is_simbad_value_cohort` (`scripts/refresh/simbad/inputs.py`) enumerates a
spine row when **any** of `pos_src` / `dist_src` / `mag_src` / `rv_src` /
`pm_src` carries a non-first-order mark, or the row has no source_id at all.
So this tier's reach is the union cohort, not an rv-specific one: it is why
804 rows gain a velocity they never had a printed cell for, and why 560 rows
the printed cell used to cover are not in the pull. A row whose rv was absent
and whose every other mark is first-order is unreachable here however good a
velocity SIMBAD holds for it.

**No SIMBAD-based rv validation exists to exclude these rows from.** § 5's
validation-independence rule bites where a SIMBAD tier and a SIMBAD validator
meet the same field; `data/simbad/simbad_sample.tsv` carries no rv column and
neither `validate-simbad-sample` nor the distance-regression check reads one,
so there is nothing here for a value to verify itself against. The exclusion
becomes real at `stellata-3bsf.28`, where the distance cascade gains a SIMBAD
tier under validators that *do* check distance.

## `rvz_type` decides whether the value is a velocity at all

SIMBAD's `rvz_radvel` is a radial velocity only where `rvz_type` reads `v`;
a `z` row carries a redshift-derived quantity. `../../simbad-values-parse.ts`
drops those two rows, both white dwarfs, and the reason is not pedantry —
EGGR 252's reads **243,879 km/s**.

## The sanity thresholds are the filter on a bad SIMBAD value

The tier ships what the bibcode says, so a published-but-wrong velocity
arrives with it and is caught downstream by the two thresholds
`../../parse/README.md` § Space-motion velocity describes, not by a quality
or magnitude gate here. Both moved when the tier landed, and both are pinned:

- `velocityAboveEscape` **45 → 56**. Fourteen tier values exceed 550 km/s,
  most of them quality-`A` rows from one APOGEE-era compilation
  (`2020AJ....160..120J`) plus τ Sco at 650 km/s — near-certainly upstream
  fit artifacts on hot stars, but legitimately published and cited. Keeping
  them visible in the ratchet is exactly its stated job.
- `rvRadialRejected` **1**, `velocityClamped` unmoved at **8**. One tier value
  exceeds the 1500 km/s ceiling: **EZ Aqr** (Gl 866A, 3.4 pc) at
  **6,824.7 km/s**, quality `D`, bibcode `2021MNRAS.508.5148C`.

**A radial term past the ceiling is rejected on its own** —
`radialTermExceedsCeiling`, applied before the velocity is assembled, so a
nonphysical rv costs the row its radial term and not its tangential motion.
The whole-vector clamp is the wrong instrument here: it exists for a
PM×distance artifact, where the *tangential* term is what cannot be trusted.

**On EZ Aqr specifically this moves no shipped bytes**, and the earlier claim
that the clamp cost it a 3.3″/yr proper motion was wrong. Its Gaia row is 2p
with no PM at all, and the 2,314.8 / 2,295.3 mas/yr the spine prints under
`pm_src=GJ` never reaches the velocity assembly — so the record ships at zero
velocity either way. That gap is real and separate — 1,537 rows carry a
printed PM their 2p Gaia row does not, 27 of them inside 25 pc — and is
`stellata-13dx`, not fixed here.

What the rejection buys is that the ratchet now names the right failure, and
that the first row arriving with both a real PM and a nonphysical rv keeps
the PM. The rejected row is still counted under the tier that supplied the
value (`rvSimbad`) — the cascade routed correctly and the threshold, not the
cascade, refused it. No |rv| bound is added to the tier itself: § 5
authorises none, and this reuses the ceiling the assembly already enforces.

Note what these thresholds do NOT cover: all are ceilings, so they see a
1500 km/s artifact and not the ~11 km/s error a blended RVS median carries.
Distrusting the row it came from is the 5p condition's job, not theirs.

## `radial_velocity_error` is tracked, never gated

The refresh landed the column, and DR3's value is taken **as published**
whatever uncertainty it states. There is no reliability threshold on it, for
one reason: nothing in this project can calibrate where such a threshold would
go.

Scoring the Gaia value needs a velocity measured somewhere else, and the only
non-Gaia radial velocities here are the SIMBAD tier's 7,273 — led by
Gontcharov's Pulkovo compilation (`2006AstL...32..759G`, 2,809 rows) and the
GCRV (`1953GCRV..C......0W`, 884), which is the same pre-Gaia literature the
retired spine cells transcribed, quoted to the nearest km/s or half rather
than measured by a better instrument. Nine of those rows sit on a Gaia row
stating more than 20 km/s of uncertainty, and their median disagreement is
4.9 km/s. The one large disagreement in that set (Gaia 7.26 ± 23.94 against
−148.00) is a 6σ gap in which the older value is the likelier suspect. Nine
rows against a coarser reference cannot locate a knee, and the ~266k rows the
Gaia tier itself supplies score nothing at all.

So the uncertainty is **counted rather than obeyed** — the same treatment
`velocityAboveEscape` gives an unbound velocity, and for the same reason: an
extreme value can be real, and a filter tuned on nine stars would remove real
ones. `rvGaiaErrorBands` bands the Gaia tier's rows by stated uncertainty and
`rvGaiaErrorMaxKmS` pins the largest, so a DR4 pull that shifts the
distribution has to be reviewed rather than absorbed silently. Today: 183,039
rows ≤ 1 km/s, 60,595 ≤ 5, 15,026 ≤ 10, 6,128 ≤ 20, **1,340** above 20, and a
maximum of **39.9433** — under DR3's own publication ceiling of 40, which no
pulled row reaches. The `none` band is pinned at **0**: the published
catalogue always pairs an `rv` with an error, so a non-zero count there is an
upstream schema change, not a tolerable miss.

Revisit at DR4, which reprocesses RVS and is the first event that could supply
either a better reference or a published bound to defer to.

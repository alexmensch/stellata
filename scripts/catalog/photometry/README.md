# Photometry

Per-record photometric quantities derived from Gaia DR3 broadband
magnitudes: the Johnson V and B−V cascades, and the published relations
behind them. The contract is `docs/catalog-driver.md` § 5; the per-row
pipeline that consumes this is `../parse/README.md` § Per-row pipeline.

## Files in this area

```
scripts/catalog/photometry/
  gaia-photometry-pure.ts        The GaiaPhotometry band bundle, the
    (+ test)                     saturation bound, calibratedPhotometry
                                 (the validity gate both relations share),
                                 and the ascending-powers polynomial
                                 evaluator. Pure.
  v-magnitude-pure.ts (+ test)   Riello+ 2021 G−V relation, the gated
                                 transform over it, the three-tier V
                                 cascade, and which tiers yield a system
                                 blend. Pure.
  colour-index-pure.ts (+ test)  Table 5.9 G−B relation, B−V as the
                                 difference of the two relations, the
                                 synthetic tier's measured colour bound, and
                                 the five-tier ci cascade with its
                                 observed-vs-intrinsic verdict. Pure.
  gspc-parse.ts (+ test)         data/gaia/gaia_dr3_gspc.tsv → source_id →
                                 synthetic Johnson B−V + the archive's
                                 validated-range flag.
  hip-photometry-parse.ts        data/hipparcos/hip_main_vmag.tsv → HIP →
    (+ test)                     printed Johnson V and B−V, as two maps off
                                 one walk. Four consumers, disjoint by column:
                                 the V cascade's bright tier, ../classic-ids/'s
                                 binding gate and ../astrometry-request/ (which
                                 narrows the gate's candidates by it) all take
                                 V; the ci cascade takes B−V.
  photometry-fixture.ts          Test-only GaiaPhotometry builders. A module,
                                 not an export from a test file: all three
                                 suites here build these rows, and both
                                 relations are functions of BP−RP alone, so
                                 `atColour` belongs with them.
```

## The published relations

Both transforms come from **one table** — Gaia DR3 documentation Table 5.9,
§ Photometric relationships with other photometric systems, the release-3
restatement of Riello+ 2021 App. C — as polynomials in `BP − RP`:

| Relation | Degree | σ | Stated range |
| --- | --- | --- | --- |
| `G − V` | cubic | 0.03017 | −0.5 … 5.0 |
| `G − B` | quartic | 0.0633 | −0.5 … 4.0, M giants only past 1.75 |

That shared provenance is what makes `B − V = (G − V) − (G − B)` a published
quantity rather than a composed guess: same independent variable, same fit
population, and `G` cancels out of the difference entirely.

`calibratedPhotometry` is the gate both apply first — every band present and
finite, and `G` above `GAIA_PHOTOMETRY_SATURATION_G` — returning the values
rather than a boolean, so the algebra downstream reads the very numbers the
gate accepted instead of re-deriving them behind non-null assertions. Each
relation then applies its own colour range on top.

## The V cascade

```
V = G − f(BP−RP)      Riello+ 2021, inside the relation's validity
  → printed HIP V      data/hipparcos/hip_main_vmag.tsv (I/239 Vmag)
  → catalogued mag     the driver's own printed cell
```

`resolveVMagnitude` returns the value **and** the tier that produced it, so
`vVia` routing counts are pinned in build-counts the same way the direction
cascade pins `directionVia`. The tier also rides on the record, because it
answers a question no consumer can answer from the magnitude alone.

## The ci cascade

```
B−V = (G−V)(BP−RP) − (G−B)(BP−RP)    inside both relations' validity
  → printed `I/239` B−V               data/hipparcos/, keyed on the record's HIP
  → Gaia synthetic B−V                data/gaia/gaia_dr3_gspc.tsv, BP−RP ≤ 3.0
  → intrinsic spectral-class colour   no-Apsis rows only
  → SOLAR_BV_FALLBACK
```

Per-tier routing, pinned in build-counts: `gaia_relation` **291,943** ·
`printed_hip_bv` **10,341** · `gspc` **9,169** · `spectral_derived` **279** ·
`solar_fallback` **1,525**. The relation carries the bulk; the two tiers under
it split the 21,314 rows past its colour and saturation bounds, and **1,804**
reach neither and take a derived colour.

The spine's printed `ci` cell used to sit where those two tiers now do,
carrying all 20,241 of them. It is not a source — it is AT-HYG's
amalgamation of catalogues we can pull ourselves
(`docs/catalog-driver.md` § 5) — so retiring it costs 731 rows a measured
colour and hands them to the derived tiers. That is the trade the residual
policy asks for.

`resolveColourIndex` returns the value, the tier, **and** whether the value
is observed-convention. That last one is not a convenience: build-time
de-extinction subtracts `A_V / R_V` from an observed B−V and must leave an
intrinsic one alone, and deciding that at the dust integral means deciding
it a second time, in a place that no longer knows which tier ran. The two
measured tiers are observed; the two derived ones are intrinsic.
`companionCiIsObserved` states the same contract for promoted companions.

The derived tiers are gated on `apsisTeff === null` because the shader is a
two-tier read — `iTeffApsis > 0 ? Ballesteros(iTeffApsis) : iCi` — so an
Apsis star never renders its baked `ci`. The measured tiers are ungated:
storing a measurement costs nothing and the field is read by more than the
shader.

### Why the GSPC tier does not gate on the flag

The synthetic photometry ships a per-band flag for whether the source sits
inside the range the Johnson standardisation was *validated* over. Gating on
it would leave the tier serving **zero** rows: the flag's region and this
tier's window do not intersect anywhere in this catalogue, which is bright
enough that 96% of it sits below the flag's own bright bound
(`data/gaia/README.md` § The GSPC validated-range flag has the measured
region). `ciGspcValidatedRange` pins that zero as a tripwire.

Ignoring a published validity bound is what § Where the colour bound comes
from refuses to do for the Table-5.9 relation, so the difference matters:
**that bound is on a fit, this one is mostly on a correction.** The relation
is a polynomial in `BP−RP` whose extrapolation is unconstrained by anything.
GSPC's magnitudes are each star's own BP/RP spectrum integrated through the
passband — a measurement of that star — and Montegriffo+ 2023 § 6.2 calls a
flag-0 magnitude *"an extrapolation of the adopted standardisation"*, i.e. of
the correction tying the result to the ground system, not of the integration.

**"Mostly" is load-bearing on the bright side.** Past the flag's `G` ≈ 10.7
edge, § 3.2 of the same paper attributes the loss of millimag accuracy to a
BP/RP spectrometer configuration change at `G` ≈ 11.5 — that one degrades
XP's *internal* calibration, not just the standardisation on top. This whole
catalogue sits there, so the tier is knowingly using XP spectra outside their
best-calibrated regime, and the measurement below is what bounds the cost.

Against the Table-5.9 relation over the rows the relation *does* cover, the
flag makes no difference — flag-valid rows disagree by p50 0.020 / p99 0.141
(n=21,863), flag-invalid ones by p50 0.023 / p99 0.139 (n=242,534), and the
flag-invalid median holds between 0.037 (`G` 4–5) and 0.016 (`G` 11–12).
That is inside the composed σ of the two relations (0.030 ⊕ 0.063 = 0.070),
so the bright-side cost is real but small against the alternative, which for
these rows is a colour guessed from a spectral-class letter.

Against printed `I/239` B−V, binned by colour:

| BP−RP | n | p50 | p90 |
|---|---|---|---|
| 1.75 – 2.50 | 5,775 | 0.031 | 0.108 |
| 2.50 – 3.00 | 858 | 0.043 | 0.127 |
| 3.00 – 4.00 | 339 | 0.135 | 0.253 |
| 4.00+ | 40 | 0.338 | 0.444 |

`GSPC_BP_RP_MAX = 3.0` is that knee — the same discipline as
`GAIA_PHOTOMETRY_SATURATION_G`, a bound calibrated against a distribution
rather than adopted from a header. The paper backs it independently: the
flag's red edge sits at 2.6 because the Landolt/Stetson standard collections
thin out past `BP−RP` ≈ 2 and disagree by 3–5% there, but § 3.2 reports that
the handful of red giants they do carry over `1.5 < BP−RP < 3.5` *"match the
same locus of the bulk of the other stars ... within <10.0 mmag"*. The
standardisation was checked past its own flag, and held.

**Printed sits ABOVE synthetic**, inverting the tier order
`docs/catalog-driver.md` § 5 states, and for the same reason the bound
exists: outside the standardisation the synthetic value is not tied to the
ground system, while `I/239` B−V is a calibrated measurement on it. Both
corpus rows carrying values from both tiers prefer printed — Barnard's Star
(pinned 1.57; printed 1.570, synthetic 1.694) and HD 75632 (pinned 1.39;
printed 1.385, synthetic 1.357) — and both fail the corpus at the ±0.03
tolerance under the contract's order. The synthetic tier's job is the ~9.2k
rows Hipparcos never observed, which no other measured source reaches.

**Neither |Δ|-against-the-relation figure on this page ranks the two tiers**,
and read side by side they appear to — synthetic disagrees with Table 5.9 by
p50 0.023 where § Where the colour bound comes from has a printed cell
disagreeing by p50 0.052. Two reasons that is not a ranking. The references
differ: that section measures the **spine's** cell, not the `I/239` tier.
And both are measured only where the relation itself applies, `BP−RP` ≤ 1.75
— which is precisely where neither of these tiers runs. Where they do
compete, past the relation's bound, there is no third measurement to rank
them by, so the ordering rests on the physical argument above and on the two
corpus rows that carry both.

### Where the colour bound comes from

Table 5.9 note (k) restricts `G − B` to **M giants** past `BP−RP` 1.75, and
this build cannot tell a giant from a dwarf on the no-Apsis population the
tier serves — `lumClass` is 255 for most of it. So 1.75, not the relation's
stated 4.0, is what `gaiaBMinusV` gates on.

Measured against the **spine's** printed `ci` cell over the no-Apsis
population — not the `I/239` tier that replaced it, and both sides
observed-convention, so the comparison is like-for-like — the published note
is visible in the data:

| BP−RP | n | p50 | p99 | max |
|---|---|---|---|---|
| −0.5 – 0.4 | 22,406 | 0.041 | 0.368 | 2.768 |
| 0.4 – 0.8 | 15,642 | 0.063 | 0.545 | 1.876 |
| 0.8 – 1.2 | 3,304 | 0.094 | 0.685 | 1.441 |
| 1.2 – 1.75 | 1,672 | 0.222 | 0.776 | 2.241 |
| 1.75 – 2.5 | 504 | 0.209 | 0.951 | 1.385 |
| 2.5 – 3.0 | 133 | 0.574 | 2.104 | 2.668 |
| 3.0 – 4.0 | 189 | 1.258 | 2.727 | 3.911 |

Whole accepted range: **p50 0.052, p99 0.513, max 2.768** over 43,024 rows.

**The measured knee is at 2.5, not 1.75** — the published bound is the more
conservative of the two, and it is the one applied, because a note about
which luminosity class a fit covers is a statement about validity that a
disagreement distribution cannot overturn. It costs 912 no-Apsis rows
(2% of the population reachable at 4.0), which fall through to the two
measured tiers below rather than to a derived colour.

## Which tiers give a system blend — `vTierIsSystemBlend`

A printed tier publishes one magnitude per catalogue entry, and a close pair is
one entry, so `printed_hip` and `catalogued` V sum every component the
catalogue failed to split. `gaia_riello` does not: Gaia deblends a large part of
the sub-arcsec population into per-component sources, and on 2,971 of the pairs
whose secondary row carries the primary's source_id the transformed V lands
nearer WDS's component-A magnitude than the pair blend in ~46% of cases —
against ~13% for the printed tier, which is the signature of Gaia having
resolved the pair the cross-match could not.

Anything subtracting a companion's flux from a record must gate on this or it
double-counts: `../companions/README.md` § Anchor flux conservation is the
consumer, and `RIELLO_G_MINUS_V_SIGMA` is the decisive margin its subset solve
compares hypotheses at, since a Gaia-derived V is only good to that σ.

**absmag is derived from this V, never tabulated.** `apparentToAbsoluteMagnitude`
runs once on the final distance the override stack settled, so a distance
override cannot place a star at a new distance while lighting it for the old
one — that class of bug is unreachable rather than guarded against.

## The bright rescue tier is a condition, not a magnitude cut

`docs/catalog-driver.md` § 5 defines the bright tier as *rows whose Gaia
photometry is missing or outside the transform's validity*, and the
`printed_hip` branch is exactly that set — saturated sources, rows with a
band missing, and colours outside the published range all land there without
anything applying a magnitude threshold from outside. A star is never
routed by how famous it is.

## Where the validity bound comes from

`GAIA_PHOTOMETRY_SATURATION_G = 4.0` is calibrated, not assumed. Joining
HIP → source_id → (G, BP, RP) over the 98,920 rows carrying both a printed
`I/239` V and in-range Gaia photometry gives the median |V_printed −
V_transformed| per G bin:

| G | 2.5–3 | 3–3.5 | 3.5–4 | 4–4.5 | 5–5.5 | 7–8 | 9–9.5 | 10.5–11 | 11–11.5 |
|---|---|---|---|---|---|---|---|---|---|
| median &#124;ΔV&#124; | 0.056 | 0.041 | 0.022 | 0.012 | 0.012 | 0.013 | 0.013 | 0.026 | 0.039 |

The agreement is flat at ~0.012–0.013 mag — comfortably inside the relation's
own σ = 0.03017 — from G ≈ 4 upward, and degrades monotonically below it as
Gaia's CCDs saturate. The knee is at **G = 4.0**, where the median doubles
against the bin above it.

**The faint-end rise past G ≈ 10 is the printed side degrading, not the
transform**, so it earns no upper bound: Hipparcos photometry loses precision
toward its own limit while Gaia's improves. Reading that rise as a transform
failure and capping the tier there would hand the faintest stars to the
*worse* of the two sources.

Three joined rows sit at G > 15 against a bright printed V (|ΔV| up to 19.7).
Those are cross-walk mis-bindings, not photometry, and never reach this
cascade: the `resolveGaiaSourceId` gates scrubbed them when the inherited
spine was frozen, and the record build reads the surviving binding off the
spine column rather than re-deciding it (`../spine/README.md` § The
identifier columns are read, never re-derived; `data/classic-ids/README.md`
§ The binding gate for the same gate on the label side).

## Citation

Riello, M., De Angeli, F., Evans, D. W., et al. 2021, *A&A* 649, A3 — "Gaia
Early Data Release 3: Photometric content and validation", § Photometric
relationships with other photometric systems. DR3 ships EDR3's photometry
unchanged, so the EDR3 calibration is the one that applies. The coefficients,
σ, and colour range are pinned as literals in the test rather than imported
from the module, so a transcription slip fails rather than round-trips.

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
                                 difference of the two relations, and the
                                 four-tier ci cascade with its
                                 observed-vs-intrinsic verdict. Pure.
  hip-vmag-parse.ts (+ test)     data/hipparcos/hip_main_vmag.tsv → HIP →
                                 printed Johnson V. Shared by the cascade's
                                 bright tier and ../classic-ids/'s binding
                                 gate, which need the same HIP-keyed V.
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

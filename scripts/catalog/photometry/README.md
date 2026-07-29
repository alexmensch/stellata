# Photometry

Per-record photometric quantities derived from Gaia DR3 broadband
magnitudes: the Johnson V cascade, and the published relations behind it.
The contract is `docs/catalog-driver.md` § 5; the per-row pipeline that
consumes this is `../parse/README.md` § Per-row pipeline.

## Files in this area

```
scripts/catalog/photometry/
  v-magnitude-pure.ts (+ test)   Riello+ 2021 G−V relation, its validity
                                 gate, and the three-tier V cascade. Pure.
```

## The V cascade

```
V = G − f(BP−RP)      Riello+ 2021, inside the relation's validity
  → printed HIP V      data/hipparcos/hip_main_vmag.tsv (I/239 Vmag)
  → catalogued mag     the driver's own printed cell
```

`resolveVMagnitude` returns the value **and** the tier that produced it, so
`vVia` routing counts are pinned in build-counts the same way the direction
cascade pins `directionVia`.

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
Those are cross-walk mis-bindings, not photometry: the record build's
`resolveGaiaSourceId` gates reject them before this cascade sees them
(`../parse/README.md` § Per-row pipeline, and `data/classic-ids/README.md`
§ The binding gate for the same gate on the label side).

## Citation

Riello, M., De Angeli, F., Evans, D. W., et al. 2021, *A&A* 649, A3 — "Gaia
Early Data Release 3: Photometric content and validation", § Photometric
relationships with other photometric systems. DR3 ships EDR3's photometry
unchanged, so the EDR3 calibration is the one that applies. The coefficients,
σ, and colour range are pinned as literals in the test rather than imported
from the module, so a transcription slip fails rather than round-trips.

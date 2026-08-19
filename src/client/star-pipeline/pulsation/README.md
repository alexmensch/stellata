# Variable-star pulsation

The two pure tables driving variable-star pulsation: the per-type
{ρ radius-swing, ΔB−V colour-swing} params and the eclipsing-binary
suppress mask. Both are built at catalog load and consumed as
per-instance attributes by `../star.vert.glsl`.

Full physics, the per-type table, and interferometry citations are in
`docs/science-stellar-modelling.md` § Variable-star pulsation; this file
is the runtime contract.

## Files in this area

```
src/client/star-pipeline/pulsation/
  pulsation-params-pure.ts        buildPulsationParams(varType): the
    (+ test)                     per-instance {ρ, ΔB−V} table driving the
                                 iPuls attribute + the CPU disc mirror.
                                 Called at catalog load
                                 (catalog.pulsRho / catalog.pulsColorSwing).
                                 interleavePulsParams packs the pair into
                                 the vec2 backing array (WebGL2 + WebGPU
                                 geometries). Vitest-pinned.
  pulsation-suppress-pure.ts     buildPulsationSuppressMask(varType): the
    (+ test)                     per-instance iSuppressPulsation mask
                                 (1 on every eclipsing binary — an eclipse
                                 is orbital geometry, not a radius swing,
                                 and BinaryOrbitField already renders it).
                                 Vitest-pinned.
```

Consumers: `../../loaders/catalog-loader.ts` and `catalog-mock.ts` build
the arrays at load; `../star-pipeline.ts` binds them as instanced
attributes; `stellata.ts` wires the uniforms.

## Running on the model clock

Per-instance `iPeriodDays` + `iAmplitudeMag` (0 = not variable).
Pulsation runs on the **model clock** (`getT()`), at real GCVS periods —
like binary orbital motion, and responding to the same time-warp.
`uModelDays` is model time in days since J2000; `phase = uModelDays /
periodDaysEff`. The consequence is deliberate: at 1× a real period is far
longer than a frame, so long-period variables (Miras, hundreds of days)
are imperceptible until the time-scrubber engages — exactly how binary
orbits behave. `uMinPeriodSec` survives ONLY as an anti-strobe guard:
`periodDaysEff = max(iPeriodDays, uModelDaysPerRealSec × uMinPeriodSec)`
floors the effective period so no cycle completes faster than
`uMinPeriodSec` in real time under heavy warp (at 1× the floor is a few
seconds of model time, below every real period, so it never bites).
`uSecondsPerDay` and the old real-seconds `uTime` clock are gone.

## The three phase-locked modulations

`φ = 0 = maximum light`, cos convention — the convention the GCVS M0
absolute-phase anchoring folds onto later as
`phase = (uModelDays − iEpochDays) / periodDaysEff`. This is the R+T
amplitude split:

- `magMod = −0.5 × iAmplitudeMag × cos(2π × phase)` adjusts `appMag` —
  the **full** GCVS V-band amplitude, affecting point-glow size for
  distant stars (a Mira still fades toward invisibility at minimum).
- `radiusFactor = pow(iPuls.x, −0.5 × cos(2π × phase))` applies to
  `physSize`. `iPuls.x` = ρ, the **per-type peak-to-peak radius ratio**
  (interferometry, not V-band): the disc spans `[ρ^−0.5, ρ^+0.5]` with
  its **minimum at maximum light** (negative exponent — matches
  interferometry). Miras carry a small ρ (≈1.4) because their V-band
  amplitude is almost all temperature, not radius.
- the LUT-input B−V is shifted by `−0.5 × iPuls.y × cos(2π × phase)`
  (`iPuls.y` = ΔB−V, per-type colour swing) so the disc runs
  bluer/hotter at maximum light and reddens toward minimum.

`iPuls` is a per-instance `vec2` built by `buildPulsationParams` from
`catalog.varType`; ρ + ΔB−V are packed into one attribute to stay under
the WebGL2 16-attribute budget. The ρ-bounded swing (≤1.4) replaces the
old per-frame amplitude-compression machinery; a single up-clamp
(`physSize ≤ uMaxPhysFrac × min(viewport)`) keeps a supergiant at the
orbit floor inside the viewport.

`renderedSizePx` in `../../camera/controls/star-physics.ts` replicates
this whole shader pipeline on the CPU (reading `catalog.pulsRho`) so the
SVG focus-ring and distance-vector overlays follow the pulsating disc
size exactly frame-by-frame.

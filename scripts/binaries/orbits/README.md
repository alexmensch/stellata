# Stage 4 — orbital elements, in TypeScript

The TypeScript side of the binaries pipeline's orbit knowledge. Today it holds
the Gaia DR3 NSS two-body conversion alone, which Stage 3's NSS inner-pair
synthesis gates on (`../astrometry/`); Stage 4's orbit selection lands beside
it. Until the switch, `build:binaries` runs `../build-binaries.py` and only
tests call this
([Porting to TypeScript](../README.md#porting-to-typescript--one-stack-one-switch)).
What each NSS solution type constrains, the Thiele-Innes algebra and why the
photocentre's a0 is never the relative orbit's a, is the parent README's
([Stage 4](../README.md#stage-4--orbital-element-selection-per-pair)).

## Files in this area

```
scripts/binaries/orbits/
  nss-elements-pure.ts (+ test)  OrbitElements; NSS_SOLUTION_KINDS, one
                                 table naming what each solution type's
                                 columns constrain; thieleInnesToCampbell;
                                 nssToCanonicalElements; nssInRegime, the
                                 detectability regime (P < 3 yr or a0 < 1″).
  nss-fixture.ts                 Test-only: tiFromCampbell (the forward
                                 transform) and NSS row builders.
```

## Conventions the port keeps

- **Ω is folded into [0, π)**, ω turned by π with it: the algebra cannot tell
  the ascending node from the descending one, and the fold picks one
  orientation. ω then wraps into [0, 2π) as Python's `%` does (`floorMod`).
- **`t_periastron` counts days from J2016.0**, `GAIA_DR3_REF_EPOCH_JD`,
  derived from `../../catalog/distance/`'s `GAIA_DR3_REF_EPOCH`.
- **`aAu` is always null** for an NSS solution: Stage 6 estimates it from
  Kepler's third law.
- **A solution type the table does not name converts to null**, and a row
  stating neither a period nor a Thiele-Innes quartet is outside the regime.

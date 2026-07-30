# Physical-luminance emission — into the scene-wide HDR unit

The normalisers that put a planet's mesh and glare on the one physical
luminance scale, and the reason a body does not brighten per-pixel on
approach. `../README.md` owns the two layers that read these scalars;
`../../../hdr/README.md` § Unit is the contract they emit into.

```
src/client/solar-system/planets/emission/
  mesh-surface-pure.ts (+ test)   Mirrored limb constants, the disc-mean
                                  normalisers, and the two per-body
                                  luminance scalars the mesh shader reads.
  map-mean-luminance.ts (+ test)  Sphere-weighted mean linear luminance of a
                                  day map, measured once on load — reduces a
                                  stretched mosaic to an albedo pattern.
```

Both planet layers emit into the scene-wide HDR unit — the glare through
the point-source rule, the mesh through the surface-brightness rule. There
is no per-layer brightness encoding left: `uExposure` is the one exposure,
and `uGlareGain` is a debug multiplier rather than a calibration knob
(`../glare/README.md`).

**The mesh anchor is a closed form.** A body's mean disc surface
brightness drops both its radius and the viewer distance, because they
cancel in `m + 2.5·log10(Ω_disc)`:

```
S₀ = m_host@body + 2.5·log10( π / (ARCSEC_TO_RAD² · p) )
```

so surface brightness depends only on host irradiance and geometric
albedo — which is why a body does not brighten per-pixel on approach, the
failure the old `^0.25` display compression existed to hide. The
full-Moon case lands on +3.4 mag/arcsec², the measured value, from the
same `p` that anchors the −12.7 flux; both are vitest-pinned.

**Phase is carried once, by the shading.** `S₀` deliberately excludes
φ(α): the shader's own Lambert terminator integrates to φ_Lambert on its
own, and `uPhaseScale` corrects that to the body's measured Mallama
curve. Folding φ into the anchor as well would count it twice.

**Two disc means divide out**, which is what makes everything the shader
multiplies on top a pure redistribution rather than a dimming:

- `lambertLimbDiscMean` — the closed form `2·(F/3 + (1−F)/(3+E))` for
  Lambert × limb darkening. The Lambert term contributes the 2/3 that
  reconciles mean radiance with the geometric-albedo convention
  `planetApparentMagnitude` uses; limb darkening then redistributes at
  unit mean. Atmospheric bodies substitute `F = 1` (no limb term — the
  scattering governs their limb), recovering the pure 2/3.
  **`LIMB_FLOOR` / `LIMB_EXP` are mirrored as literals in
  `../planet-mesh.frag.glsl`** and drift-pinned; changing one side alone
  shifts every body off its flux with no other symptom.
- The **day map's own mean linear luminance** (`map-mean-luminance.ts`),
  measured once on load from a downscaled copy, cos-latitude weighted.
  The maps are brightness-stretched mosaics whose absolute level is not
  radiometric — the build calibrates their mean *chromaticity* and
  preserves whatever mean luminance the source had
  (`data/textures/README.md` § Colour fidelity) — so the map may supply
  only the pattern and the level has to come from `p`. Texture-less
  bodies use the representative colour's own luminance, which is exactly
  what that branch emits, so it is exact. Dividing by the measured mean
  also makes the texture arriving mid-approach **flux-neutral**: both
  branches target the same disc integral, so the map fades in as pattern
  without a brightness step.

**The resolve step is continuous by construction.** Past 1 px the glare's
point-source rule emits `L(m)/(π·r_phys²)` — the disc's mean surface
brightness — and the mesh emits that same quantity from the same `p` and
irradiance. `mesh-surface-pure.test.ts` pins the two against each other
to 1e-12 relative. This is what retired the old resolve-step luminosity
step, where a dim-surfaced body's compressed mesh could read dimmer than
its own peak-1 glare and a bright moon could outshine a resolved parent:
that step existed only because mesh and glare were on unrelated scales.

**Colour bookkeeping.** Day maps still load `NoColorSpace` and the mesh
shader decodes them with `stellataSrgbDecode` before lighting — a raw
display-encoded texel multiplied by a physical luminance would light the
body with a gamma-bent albedo. `Planet.colour` is already linear and is
not decoded. Ring strips are **not** decoded: their RGB was authored as a
linear reflectance proxy anchored to the ~0.05 particle albedo, so
decoding would darken the rings ~5x against the true-opacity alpha they
were built with. That leaves the strip the one hand-anchored reflectance
in these layers (`../rings/README.md`).

**Both render paths.** Each planet shader applies the operator inline
when `uHdrTarget` is 0, undithered — the mesh, ring annulus and
atmosphere shell composite over each other, so a fragCoord-keyed dither
would bias a pixel once per layer (`../../../hdr/README.md` § Operator).
The shell runs the operator on its airlight *before* `uFade` premultiplies,
since the crossfade is a compositing weight, not light.

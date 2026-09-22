# src/client/molecular-clouds/absorption/ — the cloud absorption raymarch

The per-fragment raymarch of the calibrated Zucker density model that dims
every diffuse layer drawn behind a cloud (`docs/science-molecular-clouds.md`
§§ 4, 9). **Physics, so it is always on in realistic mode — never
declutter-gated** — and it hides only in chart mode. The rim shell that
annotates the same cloud's silhouette is annotation and lives in the parent
(`../README.md` § Rim shell render).

## Files

- `cloud-presence-pure.ts` (+ test) — the CPU mirror of the math (Plummer
  density, absorption alpha) plus the constants the march reads:
  `TAU_PER_AV`, `AV_RATE_PER_NH`, `AV_PER_DENSITY`, `ALPHA_CAP`,
  `AV_SATURATED`, `ENVELOPE_TAPER_FRAC`, `MARCH_MIN_STEPS`,
  `MARCH_MIN_CHORD_T`. Vitest-pinned, and imported by the graph
  (`../../webgpu/molecular-clouds/cloud-absorption-tsl.ts`), so neither
  can drift from the other. The **dither** is owned by
  `../../hdr/tonemap/tonemap-pure.ts` and read from there.

The materials that consume these — the seam, the per-cloud
`CloudAbsorptionSpec`, and the brick texture's lifetime — stay in the
parent: `../cloud-materials.ts` and `../README.md` § The material seam.

## The march

Every cloud is one shared `SphereGeometry(1.03, 32, 16)` scaled per-instance
to its semi-axes and rotated by its quaternion (the 3% inflation covers
tessellation sag; the shader clips to the analytic envelope sphere). The
fragment shader raymarches the ellipsoid segment (4–14 jittered steps,
screen-adaptive) and converts the A_V column to `α = 1 − exp(−0.921·A_V)`,
capped at 0.95.

**Traced clouds march the per-cloud Edenhofer density brick** (`USE_FIELD`
define; a linear-u8 `Data3DTexture` from `cloud-surfaces.bin`,
`A_V = 2.742·∫E dl`, clip at the brick's u = 1.05 taper edge) — the same
volume the rim isosurface was traced from, so the shadow matches the
silhouette 1:1 and the dimming matches per-star extinction physics. Fallback
clouds march the calibrated Plummer profile, clipped at the mass-budget
envelope `u = uEnv`.

Per `docs/science-molecular-clouds.md` § 9.1 the ray start carries static IGN
jitter (never reseeded per frame) and the output carries ±0.5-LSB dither.

## Invariants

- **`BackSide`, and it is load-bearing.** Exactly one fragment per covered
  pixel from outside *and* inside (the raymarch segment is analytic either
  way); `FrontSide` would kill the inside-the-cloud absorption. The rim
  shell is `FrontSide` for the opposite reason — see the parent's
  hide-when-inside contract.
- **No `#version 300 es` directive, and no redeclaring auto-injected
  attributes** (`position`, `normal`, `modelMatrix`, …). Doing either
  silently breaks the GLSL3 compile.
- **The blend is alpha-only premultiplied over** — rgb = 0 under
  `premultipliedAlpha: true` + `NormalBlending`, i.e.
  `background × (1 − absorption)`. Nothing is added. The TSL twin reaches
  the same blend through explicit `CustomBlending` factors because the flag
  itself breaks an MRT output struct
  (`../../webgpu/molecular-clouds/README.md`); the two factories are meant
  to differ there.

## Fragment budget

The march is clipped to the envelope sphere `u = uEnv` (density is
identically zero outside it; a mass-budget-tightened cloud like Orion λ at
uEnv 0.22 discards ~95% of its projected disc in one dot product), the step
count adapts to the chord's projected pixel extent (capped by the `uSteps`
lever), and the march breaks once the column saturates the alpha cap.

## Render order, and the attachment that is easy to drop

**Render-order contract** (`docs/science-molecular-clouds.md` § 9.1 rule 5):
the absorption alpha dims only layers drawn *before* the absorption meshes
(`renderOrder −2`). Every diffuse background the clouds should extinct — the
MW band and LG emission (−3), any future HiPS / sky-imagery layer — must
render earlier; a layer added after the mesh silently escapes extinction.
Point sources are exempt (the per-star raymarch owns their extinction; no
double-count). The reference chrome at −1 (galactic disc/grid, Local Bubble
shell, the cloud rim shells themselves) deliberately draws after the mesh —
annotation shouldn't be extincted.

**Order is necessary and no longer sufficient**, because the band and the LG
glow write the HDR target's *third* attachment now, not the one the
absorption draw would reach by default. The mesh is `markAbsorber`ed
(`../../hdr/attachments/README.md` § The gate) and the shader writes its
alpha-only texel to `location = 2` as well as `location = 0`; one blend
equation covers both, so the multiply is identical on each. Drop either half
and the clouds keep drawing, keep sorting correctly, and extinct nothing —
no error, no missing draw, just no dark rift. The `location = 2` write is
what becomes **per-cloud conditional** once the band reads the measured grid
itself; `location = 0` is unaffected.

## Which clouds may dim the band, decided per cloud

`docs/science-galactic-structure.md` § The dust stack. The band's dust comes
from the highest-resolution source covering each point, so a cloud either
supplies its own volume — and is carved out of the band's read of the voxel
grid — or is left to the grid, which already holds it. The test is whether
the cloud's own model out-resolves the grid *and* the grid resolves the
cloud across enough voxels to carry shape. Of 74 clouds inside grid coverage
that splits 52 / 22: the 22 are the 21 fallback ellipsoids plus Cygnus X
(brick 15.2 pc at 1163 pc, coarser than the grid it sits in), and they stop
dimming the band, which then shows their measured shape instead of an
authored ellipse. The 22 clouds beyond coverage always supply their own.
Until the band reads the grid this is contract, not code: today every cloud
dims the band and the overlap with the slab costs ~0.006 mag sky-mean.

A cloud's tier changes only its **absorption** role. Rim shells, chart
outlines, labels, picking and focus are annotation and never move.

Treating the clouds as a pure foreground *screen* is sound toward the inner
Galaxy — only 2.3 % of the GC column's emission originates inside 500 pc, so
they really are in front of the light. It is weakest toward the anticentre,
where 65 % of that column is within 2.5 kpc and the clouds sit *inside* the
emitting volume. Second-order, because the anticentre column is small.

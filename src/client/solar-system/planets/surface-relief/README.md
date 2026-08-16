# Surface relief

DEM-derived normal maps shading the Moon, Mercury and Mars on the planet
mesh: the frame the map is sampled in, which terms the perturbed normal is
allowed to reach, and the limb bound on how far past the terminator it may
light. The shader consuming all three is `../planet-mesh.frag.glsl` and the
uniforms are written in `../planet-mesh-layer.ts`; this README is the
authority on the relief half of both.

```
src/client/solar-system/planets/surface-relief/
  surface-relief-pure.ts (+ test)   The equirect tangent frame (CPU mirror of
                                    the mesh shader's) and the per-body limb
                                    bound off the DEM elevation span. The test
                                    also source-pins the shader it mirrors.
```

## What ships

Moon, Mercury and Mars ship a DEM-derived tangent-space normal map
(`<body>-normal.webp`, `data/textures/README.md` § Surface relief),
lazy-loaded on the same `TEXTURE_PREFETCH_PX` approach lane as the colour
map. Nothing branches on which bodies have one: a 404 is expected data and
leaves `uHasNormalMap` at 0, so the smooth spheroid normal is the base case
rather than a fallback. Slopes are true and unexaggerated, so a crater reads
as its real relief at any camera distance.

## The tangent frame

Built analytically from the equirect UV rather than shipped as a vertex
attribute — east is `cross(pole, n)`, the direction of increasing longitude,
and north the meridian tangent completing it, both exact on a surface of
revolution. `surface-relief-pure.ts` is the pinned CPU mirror; the map's blue
channel is a constant and is never read (z reconstructs from x and y).

## The perturbed normal feeds the direct term and nothing else

Everything else in the shader keeps the geometric normal, each for its own
reason, and the test counts the mentions so another use cannot appear
quietly:

- `lit` (attachment 1) — the exposure pin divides the masked mean by claimed
  lit coverage, and the pin is defined at the geometric terminator
  (`../../../hdr/exposure/README.md`). A speckled coverage mask moves the
  whole scene's exposure.
- `ndotv` — `lambertLimbDiscMean` divides the limb term out in closed form,
  which perturbing it breaks.
- `stellata_skyIrradiance(sunCos, …)` — solar depression is measured against
  the ground observer's true local horizontal, and a mountainside tilted away
  from the sun still sees the whole sky hemisphere.
- The airlight march's `surf` / shell-entry geometry — the shell is a smooth
  ellipsoid.

## The direct term's own terminator is the LOCAL horizon

Both halves of `dayside` ride the perturbed cosine — the Lambert term and
`terminatorSoftness`, a by-eye widening of that same Lambert edge — so a
sunward slope still catches the sun where the smooth sphere has turned away,
and the terminator reads as ragged ground rather than a clean arc. Nothing
atmospheric follows it there: physical twilight is `stellata_skyIrradiance`,
additive and strictly geometric (`../../atmosphere/README.md` § Skylight).
Neither does the exposure pin — light past the geometric terminator carries
no coverage claim, so it joins the frame mean and leaves the lit-hemisphere
mean the pin holds untouched (`../../../hdr/attachments/README.md` § The
unit).

## How far past the terminator — the body bounds it, and the term is fenced

Ground at elevation Δh sees the sun only down to a depression of √(2Δh/R),
because past that the body's own limb is in the way. **Slope alone buys
nothing**: at zero elevation the sun goes under the horizon the instant the
geometric terminator passes, whichever way the ground faces. So `dayside`
carries a gate on the GEOMETRIC cosine, derived per body from its DEM
elevation span (`reliefHorizonSines`; the span is the build's own, pinned by
`scripts/textures/dem-relief.test.ts`) — full out to a summit's bound over
ground at the reference sphere, nothing past that same summit over terrain at
the span's floor, tapering between, where only high ground over a basin is
lit:

| body | relief lights in full to | and not at all past |
|---|---|---|
| Moon | 6.36° | 8.65° |
| Mercury | 3.47° | 5.15° |
| Mars | 6.40° | 7.53° |

The gate is saturated across the entire terminator band a smooth sphere
lights on its own — an atmospheric body's `terminatorSoftness` widening
included — so it can only ever remove light the relief term added, and the
no-map path stays byte-identical.

**Inside the bound the term still over-lights.** Measured off the shipped map
before the fence, sun along an equatorial row, horizon integrated to 426 km:

| solar depression | lit by this term | lit once the horizon is honoured |
|---|---|---|
| 0–2° | 30 % of area | 13 % |
| 2–5° | 27 % | 2 % |
| 5–10° | 10 % | 0 % |
| 10–20° | 3 % | 0 % |

The fence takes the bottom row out entirely and the 5–10° row from 6.4° up;
what is left is the 0–5° bulk, where only a real per-texel horizon can tell a
lit ridge from a shadowed one. That residual is **lit area, not lit
brightness** — each lit facet is at `cos(i)` on its true normal, area-mean
0.07 and p99 0.30 of the sub-solar value, and the disc integral moves under
0.01 mag — so it reads as a speckle near the terminator, not as a flux error.
`stellata-2f6.43` is the fix, and it can only shadow terrain this term has
lit, which is why the two are ordered this way.

## No flux renormalisation

Deliberate, and measured rather than assumed — `../emission/README.md`
carries the numbers.

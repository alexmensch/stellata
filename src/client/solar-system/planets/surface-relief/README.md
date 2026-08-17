# Surface relief

DEM-derived maps shading the Moon, Mercury and Mars on the planet mesh: the
frame they are sampled in, which terms the perturbed normal is allowed to
reach, and how the two occluders that can hide the sun from a patch of ground
are composed. The shader consuming all of it is `../planet-mesh.frag.glsl`
and the uniforms are written in `../planet-mesh-layer.ts`; this README is the
authority on the relief half of both.

```
src/client/solar-system/planets/surface-relief/
  surface-relief-pure.ts (+ test)   The equirect tangent frame, the normal
                                    perturbation and the horizon lookup built
                                    on it (CPU mirrors of the mesh shader's),
                                    plus the per-body limb bound off the DEM
                                    elevation span. The test also source-pins
                                    the shader it mirrors.
```

## What ships

Moon, Mercury and Mars ship a DEM-derived tangent-space normal map
(`<body>-normal.webp`, `data/textures/README.md` § Surface relief) and a pair
of horizon maps (`<body>-horizon-{a,b}.webp`, § Cast shadows there), all
lazy-loaded on the same `TEXTURE_PREFETCH_PX` approach lane as the colour
map. Three planes for three of ~30 bodies, so the fetch is gated on
`RELIEF_ELEV_SPAN_M` — `reliefSpanOf` in `../planet-mesh-layer.ts` is the one
lookup, shared with the fallback limb bound, because "does this body ship
relief" and "how far past the terminator may it light" are one question. The
SHADER still branches on nothing: a body that somehow arrives without the
maps leaves `uHasNormalMap` / `uHasHorizonMap` at 0 and the smooth spheroid
normal is the base case rather than a fallback. Slopes are true and
unexaggerated, so a crater reads as its real relief at any camera distance.

The horizon pair is all-or-nothing — `uHasHorizonMap` waits for **both**
files. The shader interpolates across the seam between them, so one
placeholder would read as a skyline pinned at the encoding's floor over the
azimuths that file covers.

## The tangent frame

Built analytically from the equirect UV rather than shipped as a vertex
attribute — east is `cross(pole, n)`, the direction of increasing longitude,
and north the meridian tangent completing it, both exact on a surface of
revolution. `surface-relief-pure.ts` is the pinned CPU mirror; the map's blue
channel is a constant and is never read (z reconstructs from x and y).

That frame only lines up with the map if the drawn sphere agrees on which way
east and north run, which is the disagreement with no other symptom — terrain
would shade lit from the wrong side and look plausible doing it. The test pins
both against the real `SphereGeometry`: increasing u steps along
`cross(pole, n)`, increasing v steps toward the +Y pole that `POLE_TILT` maps
to the body's north. Pure geometry, so the IAU rotation chain on top cannot
change the answer — a rotation carries a cross product with it.

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

## Two occluders, composed — the facet's own slope and the skyline

A patch of ground sees the sun only if the sun clears **both** the patch's own
slope and everything beyond it, and those are two different maps at two
different scales:

- The **normal map** is the slope, at 4096. It is the ψ → 0 limit of the
  horizon — what you can see standing on the facet itself — and it already
  rides `dayside` through `sunCosRelief`.
- The **horizon map** is everything else: terrain from one DEM texel out to
  the body's limb bound, at 2048 in 8 azimuths. It deliberately excludes the
  ground at your feet, because that is the normal map's job at four times the
  resolution.

`dayside` multiplies the two, so the sun has to clear whichever of them stands
higher — `max` of the two horizons, saturated; inside the penumbra band the
product is darker than either factor alone.

**The coarse map therefore CAN veto a facet the fine map lights, and that is
the point** — it is the whole 38.7 % → 8.5 % of § What the composition is worth.
The cost of that power is that a 2048 skyline it over-estimates darkens real
lit ground: linear interpolation between stored azimuths over-shadows, because
a skyline has narrow peaks and averaging two neighbours over-states the gap
between them (`data/textures/README.md` § Cast shadows measures it — 0.32°
mean at 8 azimuths). What keeps this one-sided rather than compounding is that
the map's OWN error over flat ground runs the other way: the march never
samples closer than its first step, so flat ground at the reference sphere
reads that step's curvature drop — −0.044° at the shipped 4096 DEM, never 0 —
which is slack toward lighting, not shadowing.

The horizon test rides the **GEOMETRIC** cosine, and that is not the same
choice as the list above: a skyline is measured from the ground's true local
horizontal, so the facet's tilt must not enter it twice. Its penumbra is
`uSunAngRad` — the host's disc crossing that skyline, the same physical
softening the inter-body caster loop uses, rather than a tuned width.

**The limb bound is now only the fallback.** Ground at elevation Δh sees the
sun only down to a depression of √(2Δh/R), and **slope alone buys nothing** —
at zero elevation the sun goes under the horizon the instant the geometric
terminator passes, whichever way the ground faces. Before the horizon maps
land (they are a separate fetch on the same lane) `dayside` carries a
per-body gate standing in for them, derived from the DEM elevation span
(`reliefHorizonSines`; the span is the build's own, pinned by
`scripts/textures/dem-relief.test.ts`) — full out to a summit's bound over
ground at the reference sphere, nothing past that same summit over terrain at
the span's floor, tapering between:

| body | relief lights in full to | and not at all past |
|---|---|---|
| Moon | 6.36° | 8.65° |
| Mercury | 3.47° | 5.15° |
| Mars | 6.40° | 7.53° |

That gate is saturated across the entire terminator band a smooth sphere
lights on its own — an atmospheric body's `terminatorSoftness` widening
included — so it can only ever remove light the relief term added, and the
no-map path stays byte-identical. Its "not at all past" column is the same
`arccos(r_floor / r_summit)` the precompute searches to, so the two cannot
drift.

**What the composition is worth**, Moon, sun in the equatorial plane, lit area
against the same march run at full DEM width — the reference isolates the cost
of the output grid and the encoding, and shares the first-step floor above
rather than being ground truth (`scripts/textures/measure_relief_lighting.py`,
method and the width/azimuth evidence in `data/textures/README.md`
§ Cast shadows):

| solar depression | normal map + fence | + horizon maps | full-DEM |
|---|---|---|---|
| 0–2° | 38.7 % | 8.5 % | 8.4 % |
| 2–5° | 17.7 % | 0.2 % | 0.2 % |
| 5–10° | 6.7 % | 0.0 % | 0.0 % |

## The exposure coverage mask stays geometric

`lit` (attachment 1) is still `step(0, sunCos) · step(0.5, shadow)` — terrain
shadow is deliberately **not** in it, unlike the inter-body caster term that
is. A moon's shadow is one large coherent disc; a terrain shadow is
fine-grained speckle, and a speckled coverage mask moves the whole scene's
exposure (`../../../hdr/exposure/README.md`). The lit hemisphere the pin is
defined over is slightly over-claimed as a result, which is the cheaper of
the two errors.

## No flux renormalisation

Deliberate, and measured rather than assumed — `../emission/README.md`
carries the numbers.

# Surface relief

DEM-derived maps shading the Moon, Mercury, Mars and Earth on the planet
mesh: the
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

Moon, Mercury, Mars and Earth ship a DEM-derived tangent-space normal map
(`<body>-normal.webp`, `data/textures/relief/README.md` § Surface relief) and a pair
of horizon maps (`<body>-horizon-{a,b}.webp`, § Cast shadows there), all
lazy-loaded on the same `TEXTURE_PREFETCH_PX` approach lane as the colour
map. Three planes for four of ~30 bodies, so the fetch is gated on
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

- The **normal map** is the slope, at 4096 (8192 on Earth). It is the ψ → 0 limit of the
  horizon — what you can see standing on the facet itself — and it already
  rides `dayside` through `sunCosRelief`. Both widths are **fixed per artifact**,
  so unlike a colour rung neither can be lowered to fit a device: a body whose
  map exceeds `KindContext.maxTextureSize` is refused it and shades without
  relief (`../textures/README.md` § Four rules).
- The **horizon map** is everything else: terrain from **two output texels**
  out to the body's limb bound, at half the DEM's width in 8 azimuths. It
  excludes the ground at your feet, because that is the normal map's job at
  four times the resolution — 10.7 km on the Moon, 15.0 on Mercury, 20.8 on
  Mars, 19.5 on Earth.

**Where the march starts is a physical claim, not a tuning knob.** It used to
begin one DEM texel out, 2.7 km on the Moon, and that first step alone set
**35 %** of every stored skyline value. Two things were wrong with it. The
caster was unrenderable — 2.7 km is half a colour-map texel, so a third of the
cast shadows were thrown by ground the screen has no way to draw, which reads
as a shadow on an empty plain however right the physics. And it double-counted
against the normal map, whose own facet slope already rides `sunCosRelief`
before `dayside` multiplies the two. Starting past both domains costs real
near-field shadowing that the normal map only partly substitutes for — it
carries the facet's own tilt, not a neighbour blocking it — and that is the
trade this distance makes deliberately.

`dayside` multiplies the two, so the sun has to clear whichever of them stands
higher — `max` of the two horizons, saturated; inside the penumbra band the
product is darker than either factor alone.

**The coarse map therefore CAN veto a facet the fine map lights, and that is
the point** — it is the whole 38.7 % → 9.6 % of § What the composition is worth.
The cost of that power is that a 2048 skyline it over-estimates darkens real
lit ground: linear interpolation between stored azimuths over-shadows, because
a skyline has narrow peaks and averaging two neighbours over-states the gap
between them (`data/textures/relief/README.md` § Cast shadows measures it — 0.37°
mean at 8 azimuths). What keeps this one-sided rather than compounding is that
the map's OWN error over flat ground runs the other way: the march never
samples closer than its start distance, so flat ground at the reference sphere
reads that distance's curvature drop — **−0.176°** at two output texels, never
0 — which is slack toward lighting, not shadowing.

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
| Earth | 2.93° | 2.93° |

Earth's two columns COINCIDE, because its DEM is clamped at the sea surface
and no ground sits below the reference sphere for a summit to stand over. The
shader hands that pair to `smoothstep`, which is undefined on equal edges, so
`reliefHorizonUniform` widens the band by 1e-4 where the uniform is written —
`reliefHorizonSines` itself stays exactly the geometry, since its `none` is the
same `arccos(r_floor / r_summit)` the precompute searches to.

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
method and the width/azimuth evidence in `data/textures/relief/README.md` § Cast shadows):

| solar depression | normal map + fence | + horizon maps | full-DEM |
|---|---|---|---|
| 0–2° | 38.7 % | 9.6 % | 9.5 % |
| 2–5° | 17.7 % | 0.3 % | 0.3 % |
| 5–10° | 6.7 % | 0.0 % | 0.0 % |

The reference marches from the shipped map's start distance, not from its own
width's — so the 0.1-point gap in the 0–2° band is what the output grid and the
encoding cost, and nothing else. It used to read 0.9, which was mostly the
reference beginning at half the distance.

## Shadows are lit by the terrain

A shadowed patch on an airless body has no ambient path, so `horizonGate`
reaching 0 used to emit exactly nothing and the shadows read as holes. What
actually lights lunar shadow is **terrain interreflection** — the sunlit slopes
around the patch scattering light into it. The other candidates are not worth
modelling: earthshine is ~5×10⁻⁵ of sunlight and reaches the near side only,
zodiacal light ~10⁻⁸, and the solar disc's own penumbra is already `uSunAngRad`.

For a horizontal patch the cosine-weighted sky view factor is the mean of cos²h
over the azimuths, and a skyline is stored as sin h — so the terrain's share is
`mean(max(sin h, 0)²)`. That is one scalar per texel and it rides its own map,
`<body>-skyview.webp`, for the reason § F comes from its own map gives: the
horizon planes deliberately skip the near field, which is where the answer
mostly lives. Writing ρ for the body's geometric albedo and F for that terrain
fraction:

```
L_fill = surfaceScale · ρ · F · max(sunCos, 0) · limb
```

Each factor earns its place. `surfaceScale` already carries **this** patch's
reflectance, so `uTerrainAlbedo` is the **second** bounce — the one off the
illuminating slope, which is why a shadow on a dark body is darker than the
albedo ratio alone. `max(sunCos, 0)` stands in for the mean illumination of the
terrain in view, taken at the sun's true elevation here rather than at this
facet's tilt: the light is coming off the neighbours, not off this facet. Both
terms carry the same cosine, so **the ratio ρ·F is free of solar elevation** —
walls of a given height give the same ratio at a 3° sun and at noon alike.

`uPhaseScale` rides it exactly as it rides the direct term. It corrects the
whole **reflected** disc to the measured phase curve, so leaving it off the
fill alone would divide in: Mercury sits on the clamp's 0.25 floor from 60°
through 150°, which would make its shadows 4× brighter relative to lit ground
there than at full phase, and the elevation-free ratio above would stop being
phase-free. Skylight is the one additive term legitimately outside
`uPhaseScale` — air scatter carries no surface albedo and its disc mean divides
out separately (`../emission/README.md` § Two disc means).

**A skyline below the local horizontal is sky, not terrain.** Over open ground
every azimuth reads the body's own limb bound — negative — and squaring that
unclamped would give every flat plain a crater floor's fill light. `max(sinH,
0)` before the square is what keeps the term self-scaling: deep craters get
fill, plains get essentially none, and on open ground near the terminator the
honest answer really is close to black.

It is added to `col`, never folded into `dayside`. Folding it in would put it
inside the direct term, and `dayside` is what the coverage mask below is cut
from. The CPU mirror is `terrainViewFactor` in `surface-relief-pure.ts`, source-
pinned to the GLSL clamp because a `max()` dropped on the shader side alone
would brighten every plain with nothing in the TS suite noticing.

**No flux renormalisation**, and measured rather than assumed — the fourth
column of `../emission/README.md`'s phase table.

### F comes from its own map, not from the horizon planes

Deriving `F` from the eight horizon channels is what the shader does while the
sky-view map is still loading, and it **under-reads by about half**: those
planes march from two output texels out and skip everything nearer, because a
caster that close throws a shadow no camera distance can resolve. A crater
floor's sky is taken mostly by walls inside that skipped near field. Sky
occlusion carries no renderability requirement — a wall too small to draw still
blocks its share — so the two readings need different marches, and `terrainView`
now samples `<body>-skyview.webp`, marched from one DEM texel out
(`data/textures/relief/README.md` § Sky view factor).

Measured off the shipped maps, area-weighted by `cos(lat)`, with `ρ·F` read as
the shadow-to-lit ratio, against what the horizon planes alone gave:

| body | F p99 | F max | ρ·F p99 | ρ·F max | ρ·F p99, planes only |
|---|---|---|---|---|---|
| Moon | 0.0445 | 0.1424 | 0.53 % | 1.71 % | 0.28 % |
| Mercury | 0.0114 | 0.1069 | 0.16 % | 1.52 % | 0.08 % |
| Mars | 0.0082 | 0.0781 | 0.14 % | 1.33 % | 0.05 % |
| Earth | 0.0021 | 0.0463 | 0.09 % | 2.01 % | 0.02 % |

**The 1.4 % worked example is now inside the data.** It assumes
`F = sin²20°` = 0.117; the shipped Moon map reaches 0.142, where the far-field
planes topped out at 0.101 and sat fifty times under it at p99.

### What the exposure has to be for it to show

The faint-end toe (`../../../hdr/README.md` § Operator) crushes anything more
than `TOE_BLACK_MAG` = 1.5 mag under `L_THRESH` to black, and it measures that
against the GLOBAL threshold rather than against the lit ground beside it. So
"will this shadow show" is a question about the lit surface's own level, not
about the ratio alone. Pushing the ratio through `faintToe` →
`reinhardExtended` → `srgbEncode`, the smallest shadow-to-lit ratio that still
clears one 8-bit code:

| lit surface reads | 128/255 | 160/255 | 200/255 |
|---|---|---|---|
| smallest visible ρ·F | 1.85 % | 0.94 % | 0.375 % |
| share of the Moon's surface above it | 0.00 % | 0.13 % | 2.6 % |

**None of those exposures is clipping**, which is the result that matters: the
observed 1–2 % lunar shadow brightness survives the operator from about
128/255 upward, so the toe was never what made this term invisible — the
missing near field was. At a bright-but-unclipped 200/255 the deepest ~2.6 % of
the surface carries visible fill and open plain stays at 0/255, which is the
physically right split rather than a threshold to tune: a plain's every azimuth
reads the body's own limb bound, negative, and `max(sinH, 0)` puts it at zero.

Mercury and Mars stay far below the Moon at p99 — their p99 skylines are 4.9°
and 3.4° against 10.8° — so on those two the term reaches the screen only in
their deepest craters, where ρ·F still tops 1.3 %. That is a fact about their
terrain, not about the pipeline: the Moon is the rough one, which is why the
whole of surface relief is scoped around it.

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

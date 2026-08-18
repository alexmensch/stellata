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
- The **horizon map** is everything else: terrain from **two output texels**
  out to the body's limb bound, at 2048 in 8 azimuths. It excludes the ground
  at your feet, because that is the normal map's job at four times the
  resolution — 10.7 km on the Moon, 15.0 on Mercury, 20.8 on Mars.

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
between them (`data/textures/README.md` § Cast shadows measures it — 0.32°
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
| 0–2° | 38.7 % | 9.6 % | 8.7 % |
| 2–5° | 17.7 % | 0.3 % | 0.2 % |
| 5–10° | 6.7 % | 0.0 % | 0.0 % |

The reference column shares the start distance, so both moved together when it
did — the shipped map lights 9.6 % of the 0–2° band against the reference's
8.7 %, and that 0.9-point gap is what the output grid and the encoding cost.

## Shadows are lit by the terrain

A shadowed patch on an airless body has no ambient path, so `horizonGate`
reaching 0 used to emit exactly nothing and the shadows read as holes. What
actually lights lunar shadow is **terrain interreflection** — the sunlit slopes
around the patch scattering light into it. The other candidates are not worth
modelling: earthshine is ~5×10⁻⁵ of sunlight and reaches the near side only,
zodiacal light ~10⁻⁸, and the solar disc's own penumbra is already `uSunAngRad`.

**The horizon map already carries the input, so this costs no fetch.** For a
horizontal patch the cosine-weighted sky view factor is the mean of cos²h over
the stored azimuths, and the map stores sin h — so the terrain's share is
`mean(sin²h)` over the eight channels `stellataHorizonSin` has already read.
Writing ρ for the body's geometric albedo and F for that terrain fraction:

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
whole **reflected** disc to the measured Mallama curve, so leaving it off the
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

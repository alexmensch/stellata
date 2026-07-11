# Hover formatters

One pure formatter per hoverable layer. Each is a thin function from
the layer's `HoverHit` payload to the engine's `{ name, lines: string[] }`
contract. Vitest-pinned because the on-screen text is user-visible
and the format conventions (units spelled out in full, two-decimal
distances, etc.) are easy to drift.

```
star-hover-format.ts             Star — name + constellation · distance
                                 FROM THE CAMERA (fmtDistAuto, so close
                                 approach reads in AU), cleaned spectral
                                 (formatSpectral: primary component +
                                 plain-language descriptor), variability,
                                 and binary companion lines. Tier-ordered
                                 name fallback (proper → Bayer → Flamsteed →
                                 HIP/HD/HR/Gl → "Unnamed #idx"). The
                                 companion blocks (secondary "Orbits <A>"
                                 per-tier detail + primary "Known
                                 companions:" name list) live in
                                 ../../format/star-companion-format.ts,
                                 shared with the focus card.
planet-hover-format.ts           Planet — camera distance · apparent
                                 V mag, period (years), radius (R⊕ + km).
cloud-hover-format.ts            Cloud — camera distance + major × minor
                                 span. Z2020 spheres collapse to
                                 "<r> × <r>".
local-group-hover-format.ts      Local Group object — display name,
                                 camera distance, "Disc"/"Ellipsoid",
                                 axis pair.
heliopause-hover-format.ts       Static — upwind + lateral + downwind
                                 extents. Geometry is fixed.
*.test.ts                        vitest pin per formatter. Tests pin
                                 the unit via setUnit('pc') for
                                 stable golden strings.
```

See [`../README.md`](../README.md) for the hover engine, the
`HoverProvider` contract, and the four UX conventions the formatters
follow.

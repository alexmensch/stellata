# Hover formatters

One pure formatter per hoverable layer. Each is a thin function from
the layer's `HoverHit` payload to the engine's `{ name, lines: string[] }`
contract, or `null` when the hit no longer resolves to an object.
Vitest-pinned because the on-screen text is user-visible
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
                                 HIP/HD/HR/Gl → "Gaia DR3 <id>" →
                                 "Unnamed (SID #<n>)" — stable identifiers,
                                 never the rebuild-shuffled record index;
                                 both typeable in search). The
                                 companion blocks (secondary "Orbits <A>"
                                 per-tier detail + primary "Known
                                 companions:" name list) live in
                                 ../../format/star-companion-format.ts,
                                 shared with the focus card.
                                 System card: when the hovered star's
                                 system has 3+ members AND its own
                                 collapsed cluster has 2+ members, the
                                 card swaps to the shared roster card
                                 (system-card-format.ts). Membership
                                 and clusters come from the kind-
                                 generic registry (../../system-
                                 membership/), so a host star's
                                 collapsed planets ride the same roster
                                 as multi-star clusters; each cluster
                                 is the renderer's own live verdict, so
                                 card and rendering can't disagree. A
                                 visibly separated member (Proxima off
                                 the α Cen A+B point) keeps its own
                                 card. Plain binaries keep the
                                 per-component card; close-in viewing
                                 (nothing suppressed) does too.
system-card-format.ts            Shared "<lead> system" roster card for
                                 a screen-collapsed system — count line
                                 ("N components:" / "N of M components
                                 here:") + comma roster capped at
                                 SYSTEM_ROSTER_MAX_NAMES with "+ N
                                 more". Star and planet formatters both
                                 build their swap card here.
planet-hover-format.ts           Planet / moon — camera distance ·
                                 apparent V mag, orbital period, radius
                                 (R⊕ + km). Period comes from the shared
                                 OrbitDescriptor (../../solar-system/
                                 ephemerides/orbit-descriptor.ts) so it
                                 matches the
                                 focus card: years for a planet, days for
                                 a moon (whose period is set by its parent
                                 planet's mass, not the Sun's). Swaps to
                                 the shared roster card when the hovered
                                 body has its own collapsed cluster (a
                                 planet whose moons read as one point
                                 with it).
cloud-hover-format.ts            Cloud — camera distance + major × minor
                                 span. Z2020 spheres collapse to
                                 "<r> × <r>".
local-group-hover-format.ts      Local Group object — display name,
                                 camera distance, "Disc"/"Ellipsoid",
                                 axis pair.
shell-hover-format.ts            Boundary shell (Local Bubble, heliopause)
                                 — display name, camera distance, type
                                 descriptor, size. Reads the registered
                                 ShellInstance's card.
*.test.ts                        vitest pin per formatter. Tests pin
                                 the unit via setUnit('pc') for
                                 stable golden strings.
```

See [`../README.md`](../README.md) for the hover engine, the
`HoverProvider` contract, and the four UX conventions the formatters
follow.

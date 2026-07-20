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
                                 system has 3+ components AND its own
                                 collapsed cluster — members reachable
                                 through currently-suppressed relations
                                 (Stellata.isCompositeSuppressed, the
                                 orbit walk's own sub-pixel verdict, so
                                 card and rendering can't disagree) —
                                 has 2+ members, the card swaps to
                                 "<primary> system" + the CLUSTER
                                 roster ("2 of 6 components here:" when
                                 partial). A visibly separated member
                                 (Proxima off the α Cen A+B point)
                                 keeps its own card. Plain binaries
                                 keep the per-component card; close-in
                                 viewing (nothing suppressed) does too.
planet-hover-format.ts           Planet / moon — camera distance ·
                                 apparent V mag, orbital period, radius
                                 (R⊕ + km). Period comes from the shared
                                 OrbitDescriptor (../../solar-system/
                                 orbit-descriptor.ts) so it matches the
                                 focus card: years for a planet, days for
                                 a moon (whose period is set by its parent
                                 planet's mass, not the Sun's).
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

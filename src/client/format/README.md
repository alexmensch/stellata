# Shared field formatters

Pure display formatters shared between the tier-1 hover cards
(`../hover/`) and the tier-2 focus card (`../focus-card/`). Both tiers
are camera-relative / intrinsic by design, and any field they both
surface must show the IDENTICAL value — one formatter per field is
what enforces that. All functions are pure and vitest-pinned.

```
spectral-format.ts        formatSpectral(raw, spectClass, lumClass) →
                          { label, descriptor }. Label keeps the PRIMARY
                          component of a composite ("K0III+K7V" →
                          "K0 III") and normalises spacing; descriptor
                          is plain language ("orange giant") composed
                          from the shipped numeric class bytes, with
                          white-dwarf / Wolf-Rayet / carbon overrides.
                          This is a runtime mini-formatter — the full
                          parser in scripts/catalog/catalog-pure.ts is
                          BUILD-only.
physical-format.ts        Radii (stars "X R☉" — catalog physicalRadius
                          is already solar radii; planets "X R⊕ (km)"),
                          axis pairs, apparent-mag-from-camera (always
                          shown; "—" only for degenerate distances),
                          signed magnitude, variability line, coarse
                          provenance ("Gaia DR3 · Hipparcos · HD ·
                          Gliese" from populated id fields; a synthetic
                          promoted companion reads "WDS" — its record
                          was minted from a WDS measurement; a row with
                          no ids at all reads "Tycho-2"), formatKm.
velocity-format.ts        spaceVelocity(vx, vy, vz) → { kms, lDeg,
                          bDeg }: km/s magnitude of the catalog's
                          pc/yr heliocentric space motion + galactic
                          ℓ/b of the velocity VECTOR (its instantaneous
                          heading, via ICRS_TO_GAL_M3 from
                          ../galactic/galactic-coords.ts). The
                          formatter puts the heading on its own line
                          (consumers use white-space: pre-line).
moon-list-format.ts       formatMoonsLine(names, maxNames?) → the
                          "Moons: …" roster line for a moon-parenting
                          planet. Hover passes its name cap
                          (truncating to "+N more"); the focus card
                          shows the uncapped list. Names come from
                          moonNamesOf (solar-system/planet-system.ts)
                          in semi-major-axis order on both tiers.
star-companion-format.ts  Binary-role card lines, read from
                          binaries.bin: companionOfLines (secondary
                          "Orbits <A>" blocks with per-tier detail),
                          companionNames (primary side — both cards
                          render them under a "Known companions"
                          label), and the hover-composed companionLines.
                          Hover and focus card call the same functions
                          so the visual-vs-orbit tiering never forks.
*.test.ts                 vitest pin per module.
```

Distances are NOT formatted here — `../ui/distance-util.ts`
(`fmtDist` / `fmtDistAuto`) is the existing single source for those and
both tiers call it directly.

Layer-specific formatters stay with their layer: `../hover/formatters/`
holds the per-class hover card assembly; this folder holds only fields
shared across tiers or across object classes.

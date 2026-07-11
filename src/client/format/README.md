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
                          apparent-mag-from-camera + the "—" display
                          gate (value shown only when it differs from
                          absMag by > APP_MAG_GATE), signed magnitude,
                          coarse provenance ("Gaia DR3 · Hipparcos ·
                          HD" from populated id fields), formatKm.
velocity-format.ts        spaceVelocity(vx, vy, vz) → { kms, lDeg,
                          bDeg }: km/s magnitude of the catalog's
                          pc/yr heliocentric space motion + galactic
                          ℓ/b of the velocity VECTOR (its instantaneous
                          heading, via ICRS_TO_GAL_M3 from
                          ../galactic/galactic-coords.ts).
star-companion-format.ts  Binary-role card lines (secondary "Orbits <A>"
                          block with per-tier detail; primary "N known
                          companions:" list), read from binaries.bin.
                          Hover shows these verbatim; the focus card
                          calls the same function so the visual-vs-orbit
                          tiering never forks.
*.test.ts                 vitest pin per module.
```

Distances are NOT formatted here — `../ui/distance-util.ts`
(`fmtDist` / `fmtDistAuto`) is the existing single source for those and
both tiers call it directly.

Layer-specific formatters stay with their layer: `../hover/formatters/`
holds the per-class hover card assembly; this folder holds only fields
shared across tiers or across object classes.

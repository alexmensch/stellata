# src/client/binaries/ — multi-star runtime layer

Runtime support for binary / multiple-star systems. The loader here
parses `public/binaries.bin` (written by
`scripts/binaries/build-runtime-binaries.py`) into a typed record-set
that the `BinaryOrbitField` walks per frame to apply orbital motion to
star catalog records.

## Files

- `binaries-loader.ts` — parses the v1 `BIN1` binary format into a
  `BinariesData` struct: per-pair Kepler elements + `sep_arcsec` /
  `pa_deg` for the static-placement fallback, plus index maps
  (`primaryIdxToRelations`, `secondaryIdxToRelation`) for runtime
  lookups. Round-trip + fail-mode coverage in `binaries-loader.test.ts`.

## Format contract

The v1 wire format is the single contract between the Python writer
(`scripts/binaries/build-runtime-binaries.py`) and this loader:

- Header (16 B): `BIN1` magic + uint32 version + uint32 count + 4 B
  reserved.
- Record (72 B): see `RECORD_LAYOUT` in `binaries-loader.ts` for the
  per-field byte offsets. Float64 fields land on 8-byte boundaries.
  Trailing 8 bytes are reserved for forward-compat.

Flag bits on each record (`flags` uint32):
- `0x1` has_orbit — Kepler elements present (P, T, e, a, ω, Ω all valid).
- `0x2` has_inclination — inclination i_rad is valid (Tier-1 canonical
  Kepler). When unset, runtime uses the galactic-Z fallback orbit normal
  (Tier 2).
- `0x4` is_inner_of_hierarchy — pair sits inside another pair (Algol
  Aa1,Aa2 inside Aa,Ab). `parentRelation` then points at the outer
  pair's record index.

Records are walked in topological (outer-before-inner) order, so a
single forward pass through `relations` is enough for the runtime to
evaluate parents before children.

## Tier mapping

The runtime layer reads this artifact under three tier rules (set by
the per-pair flags):

- Tier 1 (`has_orbit & has_inclination`) — full Kepler + Thiele-Innes
  + sky→ICRS tangent-plane projection.
- Tier 2 (`has_orbit & !has_inclination`) — Kepler eval with the orbit
  normal forced to the galactic Z-axis.
- Tier 3 (`!has_orbit`) — no per-frame Kepler eval. The companion's
  static placement is already baked into `catalog.bin` by the
  build-time companion-promotion pass (see
  `scripts/catalog/companion-promotion.ts`), so the runtime layer can
  skip these records entirely.

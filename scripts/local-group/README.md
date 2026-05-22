# Local Group build

`build-local-group.ts` — LVDB `dwarf_all` snapshot + hand-curated
overrides → `public/local-group.json`. `build-local-group-pure.ts`
holds the pure helpers (RA/Dec→ICRS, orient → quaternion, override
merge, standalone-row builder, display-name + catalog-designation
rules, distance filter); vitest-pinned in `*.test.ts`.

The TSV parser handles both LVDB-merge and standalone-position
override rows.

## Display-name rules

`displayName(lvdbName)` decides the on-screen string for each object
through three branches:

1. **DISPLAY_NAME_OVERRIDES** — explicit map entries take precedence.
   Covers Magellanic acronyms (LMC → "Large Magellanic Cloud") and
   named non-dSph dwarfs the regex below would otherwise mis-suffix
   (WLM, Leo A, Phoenix, Sextans A/B, Pegasus dIrr, …).
2. **`isCatalogDesignation`** — names matching catalog prefixes
   (NGC / IC / UGC / DDO / M / KK / PGC / HIPASS …) followed by digits
   bypass the suffix and render as-is. "NGC 205", "M 32", "M31" all
   pass through unchanged.
3. **Default** — append "Dwarf Spheroidal". Used for bare constellation
   names ("Sculptor", "Draco") and Roman-numeral satellites
   ("Andromeda I", "Bootes II") where the suffix disambiguates from
   the constellation and matches catalogue-paper convention.

## MAX_DISTANCE_PC

`build-local-group-pure.ts` exports `MAX_DISTANCE_PC = 2_000_000` —
the heliocentric envelope the build filter applies. 2 Mpc covers the
canonical Local Group (M31 + M33 + their satellites, plus the outer
dIrrs out to ~1.4 Mpc) with comfort headroom past the ~1.5 Mpc
IAU-style boundary; beyond 2 Mpc we'd be picking up the
IC 342 / Maffei groups — a separate decision. The constant is
shared: the runtime camera envelope (`stellata.ts` —
`controls.maxDistance = 2 Mpc`, PerspectiveCamera far = 3 Mpc) is
paired with this filter so a fully zoomed-out view shows the entire
rendered catalogue.

## Orientation specs

| Spec                 | Semantics |
| -------------------- | --------- |
| `pa:X`               | Long axis (a) in sky plane at PA X east of north; b in sky plane perpendicular; c along line of sight to/from Sol. Used for typical dSph projection. |
| `disc:i=X,pa=Y`      | Disc plane normal at inclination X from line of sight (0 = face-on); line of nodes at PA Y east of north. a, b lie in the disc plane; c along the disc normal. Used for the Magellanic-style LMC disc. |
| `los`                | c-axis aligned with line of sight from Sol; a, b in the perpendicular plane (sky-east / sky-north basis seed). Used for SMC's line-of-sight elongation. |

The build script computes each object's local→ICRS quaternion via
Shepperd's method on a right-handed orthonormal basis. The basis
construction is exercised end-to-end in
`build-local-group-pure.test.ts` (rotated +Z lands on line of sight
for `los`, rotated +X lies in the sky plane for `pa`, disc normal at
i=0 lands on line of sight for `disc`, etc.).

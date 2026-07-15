# Local Group build

`build-local-group.ts` — LVDB `dwarf_all` snapshot + hand-curated
overrides → `public/local-group.json`. `build-local-group-pure.ts`
holds the pure helpers (RA/Dec→ICRS, orient → quaternion, override
merge, standalone-row builder, display-name + catalog-designation
rules, distance filter, emission assembly);
`emission-solver-pure.ts` holds the DENSITY0 solver maths. All
vitest-pinned in `*.test.ts`.

The TSV parser handles both LVDB-merge and standalone-position
override rows; optional emission columns are resolved by header name.

## Inputs and output

Reads two committed source files under `data/local-group/`:

- `lvdb-snapshot.csv` — Pace et al. 2024 LVDB dwarf_all table (CC0).
- `overrides.tsv` — hand-curated structural detail for LMC, SMC,
  Sagittarius dSph, M 32, NGC 205; plus standalone-position rows for
  M31 and M33 which LVDB's dwarf_all table excludes.
- `aliases.tsv` — search crosswalk (type + alias designations) merged
  into each object's `type` / `aliases` output fields; unmatched rows
  fail the build.

Emits `public/local-group.json` with one entry per renderable object
within `MAX_DISTANCE_PC` of Sol. Output schema is documented at the
`LgObject` type in `build-local-group-pure.ts`; the client loader at
`src/client/local-group-loader.ts` mirrors it 1:1.

Each object also carries a `sid` (frozen Stellata ID, docs/sid.md § 7),
stamped after this script by `scripts/sid/stamp-sibling-sids.ts` (the tail
of `pnpm run build:local-group`) — it resolves each `lg:<id>` slug against
the committed ledger; this build never touches the ledger. A new slug
hard-fails the stamp until `pnpm run sid:allocate` mints it; a rename needs
a `data/sid/sameas-overrides.tsv` bridge. See `scripts/sid/README.md`
§ Sibling-artifact stamping.

Idempotent — exits early if `public/local-group.json` is newer than
the script and both source files. Run via
`pnpm run build:local-group`. No live fetches at build time; refresh
of the LVDB snapshot is a manual `curl` of
`raw.githubusercontent.com/apace7/local_volume_database/main/data/dwarf_all.csv`
→ `data/local-group/lvdb-snapshot.csv`.

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

## Emission solver — per-object DENSITY0

Physics and calibration rationale in `docs/science-local-group.md`
§ Local Group luminosity model; this section carries the implementation
contract.

Every rendered object gets an `emission` block (JSON format version 2):
`family: "sersic"` carries `{ mV, reffAxesPc, n, bn, pn, uMax,
density0 }`; `family: "disc"` carries `{ mV, rdPc, zdPc, rEnvPc,
zEnvPc, density0 }` plus an optional `bulge` sub-block shaped like the
sersic params (M31 only). Everything is precomputed — the shader
consumes raw numbers and never re-derives photometry.

- `buildEmission` (build-local-group-pure.ts) owns the family routing
  and geometry rules: family from the override `profile` column (empty
  → Sérsic); default-path R_e ellipsoid = the wireframe axes;
  override-path R_e = shell axes rescaled so the sky-projected
  semi-major equals LVDB `rhalf_physical`; z_d = wireframe c / 3;
  disc envelope max(4·R_d, wireframe a) × max(4·z_d, wireframe c);
  spheroid envelope u_max = max(u₉₉(n), shell/R_e).
- `emission-solver-pure.ts` solves ρ₀ = d₀² · 10^(−0.4·m_V) / G with
  G integrated **over the actual truncated mesh volume** through one
  numeric quadrature path (`integrateOverEllipsoid`, Gauss–Legendre in
  unit-ball coordinates) for every profile; the analytic
  incomplete-gamma closed forms exist only as vitest cross-pins.
- **M31 bulge contract:** the bulge density0 is solved over the disc
  proxy volume with the profile cut at u ≤ uMax. The emission shader
  must apply the same cut, or the bulge flux drifts from the solved
  calibration.
- Missing photometry, a disc row without `r_d_pc`, or a spheroid
  structure override without LVDB `rhalf_physical` fail the build
  loudly — an uncalibratable object must not ship silently dark.

`build-local-group.test.ts` pins the solved density0 for LMC / SMC /
M31 (disc + bulge) / Fornax against the committed data, plus the
⟨μ⟩_e ↔ `surface_brightness_rhalf` definitional consistency sweep. A
catalogue refresh that shifts photometry moves those pins —
re-derive, don't loosen.

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

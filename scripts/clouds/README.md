# Molecular cloud build

`build-clouds.py` — Zucker 2020 Table A1 + Zucker 2021 Tables 1–3 →
`public/clouds.json` (v3). Z2021 entries take precedence over Z2020
for the clouds both cover. Consumed by the runtime presence layer
(`src/client/molecular-clouds/`).

`cloud_model.py` is the shared physics module (stdlib-pure where
`build-clouds.py` needs it — CI runs it without numpy): the
galactic↔ICRS frame math, Zucker table parsers, the calibrated
Plummer density model (column calibration + mass-budget envelope
tightening), the curated class taxonomy, and the substructure-noise
constants exported as the `noiseModel` block. `build-dust.py` imports
it for the per-cloud extinction column check. Physics + measured
numbers: `docs/science-molecular-clouds.md` §§ 2–5.

`clouds-json.test.ts` pins the emitted v3 payload (11 calibrated
clouds, class defaults, noiseModel, in-grid split, the alias /
canonical-name table); it self-skips until `public/clouds.json` is
built.

Sources under `data/molecular-clouds/`:

- `zucker2020-tablea1.tsv` — 326 sightlines, ~96 unique cloud names.
- `zucker2021-table1.dat` — 12 famous local SF clouds with 3D bounding
  boxes.
- `zucker2021-table2.dat` — fitted radial profiles (Plummer columns)
  for 11 of the 12 (Corona Australis has no fit and takes class
  defaults).
- `zucker2021-table3.dat` — masses + peak A_K for the same 11 clouds
  (joined on the raw cloud name).

Idempotent — exits early if `public/clouds.json` is newer than the
scripts and source files. Run via `pnpm run build:clouds`.

## Output schema

`{version: 3, count, noiseModel, clouds[]}` — `noiseModel` carries
the substructure noise-ladder constants (docs/science-molecular-clouds.md
§ 5.2; build-side only — the client no longer reads them, see § 5).
One entry per cloud:

| Field      | Meaning |
| ---------- | ------- |
| `name`     | Canonical display name (§ Alternate names). |
| `id`       | Slug, also used by URL/search. |
| `aliases`  | Cross-catalogue / common names for search + the focus-card alias row (§ Alternate names). Absent when none are curated. |
| `center`   | `[x, y, z]` ICRS heliocentric pc. |
| `axes`     | `[a, b, c]` semi-axes in pc. Sphere = `[r, r, r]`. |
| `quat`     | `[qx, qy, qz, qw]` rotation. Identity = `[0, 0, 0, 1]`. |
| `source`   | `"Z2021T1"` or `"Z2020"` provenance. |
| `distance` | Heliocentric distance to centroid (pc). |
| `mass`     | Cloud mass, M☉ (Z2021 clouds only — Table 3 `mass_nicest`; the Leike-map `mass_leike` saturates in dense gas and underestimates by up to ~14×). Absent for Z2020 clouds. |
| `sid`      | Frozen Stellata ID (docs/sid.md § 7). |
| `class`    | `dark` / `sf` / `hii` taxonomy (curated seed; a planned build-time embedded-star cross-match will supersede). |
| `n0Cal`, `uEnv`, `rflat`, `p` | Calibrated presence-pass density model (docs/science-molecular-clouds.md § 4). |
| `sigmaS`, `seed` | Log-normal σ_s by class + FNV-1a noise seed. |
| `massLeike`, `akPeak` | Zucker Table 3 Leike-resolution calibration anchors; null unless profiled. |
| `inGrid`   | Cloud lies fully inside the ±1250 pc dust voxel cube. |
| `embedded` | Embedded-star/cavity list — currently empty (the cross-match + cavity carve are tracked, not yet shipped). |

`sid` is stamped after this script runs by `scripts/sid/stamp-sibling-sids.ts`
(the tail of `pnpm run build:clouds`), resolving each `cloud:<id>` slug against
the committed ledger — this Python build never touches the ledger. A new cloud
slug hard-fails the stamp until `pnpm run sid:allocate` mints it; a rename needs
a `data/sid/sameas-overrides.tsv` bridge. See `scripts/sid/README.md`
§ Sibling-artifact stamping.

## Merge logic

- **Z2021 Table 1** → 12 ellipsoid clouds with axis-aligned bounding
  boxes in galactic Cartesian. The bbox is converted to centroid +
  semi-axes; the orientation `quat` is the `GAL_TO_ICRS` rotation so
  the ellipsoid local axes correctly point along galactic +X/+Y/+Z
  when scaled by the renderer.
- **Z2020 Table A1** → 84 sphere clouds (sightline-aggregated by name;
  sphere radius = max distance of any sightline from the centroid,
  with a 5 pc default for singletons and a 3 pc floor). `quat` =
  identity.
- **Precedence** — Z2021 entries override Z2020 for the clouds both
  cover (Chamaeleon, Ophiuchus, Lupus, Taurus, Perseus, Pipe, Cepheus,
  Corona Australis, Orion → A/B/λ split). Sub-regions like
  `Ophiuchus_Arc` / `Pipe_B59` stay separate Z2020 spheres.

## Alternate names

`CLOUD_ALT_NAMES` (in `build-clouds.py`) curates the cross-catalogue and
common names per cloud, mirroring the Local Group `aliases.tsv` pattern.
Each cloud gets one canonical `name` (label + focus-card title + search
`primary`) plus an `aliases[]` list that feeds the Fuse search index and
the focus-card alias row — so "Eagle Nebula", "M16", and "NGC 6611" all
find the same cloud, the way star / LG aliasing works.

**Canonical-name precedence:** common/proper name > Messier > NGC/IC >
other catalogue (Sh2 / RCW / LBN / LDN / Caldwell) > Zucker region.
Applied uniformly — a whole-cloud common name wins over its Messier or
IC designation (M16 → "Eagle Nebula", IC 443 → "Jellyfish Nebula"), with
the designations kept as aliases. Composite labels split into one
canonical name plus aliases ("Mon OB1 / NGC 2264" → "NGC 2264" +
`["Mon OB1", …]`). No label joins two names.

**Carve-out:** a common name that labels a *sub-feature*, not the whole
cloud, does NOT win — the catalogue / region name stays canonical
(Carina keeps "Carina"; "Carina Nebula" / NGC 3372 is one HII region
within it. IC 1396 keeps its designation; "Elephant's Trunk" is one
globule inside it).

The table is **keyed by the stable slug `id`, not the display name** —
`id` is the frozen SID / URL key (docs/sid.md § 7), so a canonical-name
change never churns it and needs no `sameas` bridge. An entry matching no
cloud id is a curation typo and fails the build loudly.

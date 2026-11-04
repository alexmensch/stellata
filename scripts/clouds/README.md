# Molecular cloud build

`build-clouds.ts` — [Zucker 2020](/data/papers/index.md#zucker2020) Table A1 +
[Zucker 2021](/data/papers/index.md#zucker2021) Tables 1–3 →
`public/clouds.json`, consumed by the runtime presence layer
(`src/client/molecular-clouds/`), and
`data/molecular-clouds/zucker-profiled.json`, the dust bake's column-check
inputs ([Outputs](#outputs)). Z2021 entries take precedence over Z2020 for
the clouds both cover.

- `cloud-model-pure.ts` (+ test) — the calibrated density model: frame
  helpers, the column and volume integrals, the column calibration with its
  mass-budget envelope tightening, the curated class taxonomy and the
  substructure-noise constants exported as the `noiseModel` block. The
  profile it integrates is `/src/astro-core/cloud-density-pure.ts`, the one
  the absorption march evaluates. Physics + measured numbers:
  [§ 2](/docs/science-molecular-clouds.md#2-extinction-physics-and-the-units-chain) to [§ 5](/docs/science-molecular-clouds.md#5-substructure-noise-build-side-spec).
- `build-clouds-pure.ts` (+ test) — the ellipsoid and sphere records, the
  display-name and alias tables, the merge, and both output payloads.
  Every rounded field goes through `../util/round-pure.ts`.
- `zucker-parse.ts` (+ test) / `zucker-source.ts` — the four tables' parsers
  and declarations (`../util/sources/`).
- `clouds-outputs.ts` — the emitArtifacts declaration.
- `clouds-inputs.test.ts` — pins the up-to-date gate's input set,
  `stepInputPaths('build:clouds')`.
- `clouds-json.test.ts` pins the emitted payload (11 calibrated clouds, class
  defaults, noiseModel, in-grid split, the alias / canonical-name table); it
  self-skips until `public/clouds.json` is built.

Sources under `data/molecular-clouds/`:

- `zucker2020-tablea1.tsv` — 326 sightlines, ~96 unique cloud names.
- `zucker2021-table1.dat` — 12 famous local SF clouds with the 3D
  bounding box of each cloud's spine skeleton.
- `zucker2021-table2.dat` — fitted radial profiles (Plummer columns)
  for 11 of the 12 (Corona Australis has no fit and takes class
  defaults).
- `zucker2021-table3.dat` — masses + peak A_K for the same 11 clouds
  (joined on the raw cloud name).

Idempotent — exits early if both artifacts are newer than every input
`stepInputPaths` derives (the entry's import closure, its sibling files and
the declarations it reads, `src/astro-core/baker-constants.json` among them).
Run via `pnpm run build:clouds`.

## Outputs

One `emitArtifacts` call lands `clouds.json`, `zucker-profiled.json` and,
on a run that mints, the `cloud` SID registry partition.

`zucker-profiled.json` (committed; name and version are `artifacts.zuckerProfiled`
in `src/astro-core/baker-constants.json`) is
`{version, galToIcrs, clouds[]}`: the galactic→ICRS rotation as rows, and per
profiled cloud its raw table `name`, `centreIcrsPc`, `axesGalPc` (floored
semi-axes along galactic X, Y, Z) and `avColumnTarget` (Table 3's
Leike-resolution peak A_K ÷ 0.117), at full precision. `build-dust.py`'s
Zucker column check reads it ([Encoding](../dust/README.md#encoding)), so the
dust bake's record names a committed input and no Python copy of the cloud
model exists.

## Output schema

`{version, count, envelopeFadeStart, noiseModel, clouds[]}`, typed for writer
and loader alike by `/src/catalog-format/clouds/clouds-schema.ts` — the version is
`artifacts.clouds` in `src/astro-core/baker-constants.json`, which the client loader
gates on too. `envelopeFadeStart` is `ENVELOPE_FADE_START` (`cloud-model-pure.ts`), the
fraction of `uEnv` where the density model's taper begins: the calibration
of `n0Cal` / `uEnv` assumed it, so the client's analytic march reads it from
here rather than restating it. `noiseModel` carries
the substructure noise-ladder constants ([§ 5.2](/docs/science-molecular-clouds.md#52-the-multiplicative-field);
build-side only — the client no longer reads them, see [§ 5](/docs/science-molecular-clouds.md#5-substructure-noise-build-side-spec)).
One entry per cloud:

| Field      | Meaning |
| ---------- | ------- |
| `name`     | Canonical display name ([Alternate names](#alternate-names)). |
| `id`       | Slug, also used by URL/search. |
| `aliases`  | Cross-catalogue / common names for search + the focus-card alias row ([Alternate names](#alternate-names)). Absent when none are curated. |
| `center`   | `[x, y, z]` ICRS heliocentric pc. |
| `axes`     | `[a, b, c]` semi-axes in pc. Sphere = `[r, r, r]`. |
| `quat`     | `[qx, qy, qz, qw]` rotation. Identity = `[0, 0, 0, 1]`. |
| `source`   | `"Z2021T1"` or `"Z2020"` provenance. |
| `distance` | Heliocentric distance to centroid (pc). |
| `mass`     | Cloud mass, M☉ (Z2021 clouds only — Table 3 `mass_nicest`; the [Leike 2020](/data/papers/index.md#leike2020) map's `mass_leike` underestimates it by 1.0–1.6× for clouds wholly inside the Leike grid, and by up to ~14× for clouds at its edge). Absent for Z2020 clouds. |
| `sid`      | Frozen Stellata ID ([§ 7](/docs/sid.md#7-storage--sid-in-every-artifact)). |
| `class`    | `dark` / `sf` / `hii` taxonomy (curated seed; a planned build-time embedded-star cross-match will supersede). |
| `n0Cal`, `uEnv`, `rflat`, `p` | Calibrated presence-pass density model ([§ 4](/docs/science-molecular-clouds.md#4-per-cloud-density-model--the-presence-pass-field)). |
| `sigmaS`, `seed` | Log-normal σ_s by class + FNV-1a noise seed. |
| `massLeike`, `akPeak` | [Zucker 2021](/data/papers/index.md#zucker2021) Table 3 [Leike 2020](/data/papers/index.md#leike2020)-resolution calibration anchors; null unless profiled. |
| `inGrid`   | Cloud lies fully inside the ±1250 pc dust voxel cube. |
| `embedded` | Embedded-star/cavity list — currently empty (the cross-match + cavity carve are tracked, not yet shipped). |

`sid` is allocated in-process before the emit (`allocateSibling`,
`../sid/sibling-allocation.ts`): each `cloud:<id>` slug resolves against the
registry, and this step is the sole writer of the `cloud` partition
(`data/sid/ledger-cloud.tsv`, `events-cloud.tsv`, `ledger-head-cloud.json`),
which it rewrites only on a run that appends. A new slug mints under
`allocation.mint.cloud`; a vanished slug fails the build, and a rename needs
a `data/sid/sameas-overrides.tsv` bridge. See [Sibling-artifact stamping](/scripts/sid/README.md#sibling-artifact-stamping).

## Merge logic

- **[Zucker 2021](/data/papers/index.md#zucker2021) Table 1** → 12 ellipsoid
  clouds from axis-aligned bounding boxes in galactic Cartesian — the extents
  of each cloud's spine skeleton, not of its volume. The bbox is
  converted to centroid + semi-axes; the orientation `quat` is the `GAL_TO_ICRS`
  rotation so the ellipsoid local axes correctly point along galactic +X/+Y/+Z
  when scaled by the renderer.
- **[Zucker 2020](/data/papers/index.md#zucker2020) Table A1** → 84 sphere
  clouds (sightline-aggregated by name; sphere radius = max distance of any
  sightline from the centroid, with a 5 pc default for singletons and a 3 pc
  floor). `quat` = identity.
- **Precedence** — Z2021 entries override Z2020 for the clouds both
  cover (Chamaeleon, Ophiuchus, Lupus, Taurus, Perseus, Pipe, Cepheus,
  Corona Australis, Orion → A/B/λ split). Sub-regions like
  `Ophiuchus_Arc` / `Pipe_B59` stay separate Z2020 spheres.

## Alternate names

`CLOUD_ALT_NAMES` (in `build-clouds-pure.ts`) curates the cross-catalogue and
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
`id` is the frozen SID / URL key ([§ 7](/docs/sid.md#7-storage--sid-in-every-artifact)), so a canonical-name
change never churns it and needs no `sameas` bridge. An entry matching no
cloud id is a curation typo and fails the build loudly.

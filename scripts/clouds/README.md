# Molecular cloud build

`build-clouds.py` — Zucker 2020 Table A1 + Zucker 2021 Table 1 →
`public/clouds.json`. Z2021 entries take precedence over Z2020 for the
clouds both cover. Renderer is currently shelved at the runtime.

Sources under `data/molecular-clouds/`:

- `zucker2020-tablea1.tsv` — 326 sightlines, ~96 unique cloud names.
- `zucker2021-table1.dat` — 12 famous local SF clouds with 3D bounding
  boxes.

Idempotent — exits early if `public/clouds.json` is newer than the
script and both source files. Run via `npm run build:clouds`.

## Output schema

One entry per cloud in `public/clouds.json`:

| Field      | Meaning |
| ---------- | ------- |
| `name`     | Display name. |
| `id`       | Slug, also used by URL/search. |
| `center`   | `[x, y, z]` ICRS heliocentric pc. |
| `axes`     | `[a, b, c]` semi-axes in pc. Sphere = `[r, r, r]`. |
| `quat`     | `[qx, qy, qz, qw]` rotation. Identity = `[0, 0, 0, 1]`. |
| `source`   | `"Z2021T1"` or `"Z2020"` provenance. |
| `distance` | Heliocentric distance to centroid (pc). |
| `sid`      | Frozen Stellata ID (docs/sid.md § 7). |

`sid` is stamped after this script runs by `scripts/sid/stamp-sibling-sids.ts`
(the tail of `npm run build:clouds`), resolving each `cloud:<id>` slug against
the committed ledger — this Python build never touches the ledger. A new cloud
slug hard-fails the stamp until `npm run sid:allocate` mints it; a rename needs
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

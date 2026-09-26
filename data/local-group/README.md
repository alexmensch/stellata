# Local Group reference data

Frozen reference data feeding the build script
`scripts/local-group/build-local-group.ts` → `public/local-group.json`,
which the runtime renderer (`src/client/local-group/`) consumes.

```
lvdb-snapshot.csv   committed snapshot of Pace 2025
                    (/data/papers/index.md#pace2025) dwarf_all
                    (CC0, peer-reviewed). 909 rows.
overrides.tsv       hand-curated structural detail for LMC, SMC,
                    Sagittarius dSph, M 32, NGC 205, plus full
                    standalone rows for M31 and M33 (omitted from
                    LVDB's dwarf_all table — they're major spirals).
aliases.tsv         search crosswalk + morphological type for notable
                    objects: name → type + |-separated alias
                    designations (Messier/NGC/IC cross-IDs, common
                    names) + an optional `canonical` promotion. Each
                    designation is listed once, in conventional form
                    (M31, NGC 224); the build normalises what it reads
                    and regenerates typeable variants at search time.
                    Objects without a row default their type from the
                    display-name suffix; an alias row naming no rendered
                    object fails the build, and so does a `canonical`
                    naming a designation the row itself doesn't list.
```

Refresh of `lvdb-snapshot.csv` is a manual step — the build never
reaches the network (frozen-data policy in `data/README.md`):

```
curl -sSL \
  https://raw.githubusercontent.com/apace7/local_volume_database/main/data/dwarf_all.csv \
  -o data/local-group/lvdb-snapshot.csv
pnpm run build:local-group -- --force
```

## Override schema

`overrides.tsv` carries one row per object whose LVDB summary is too
coarse for meaningful 3D rendering, **plus** the rare case of an object
that's not in LVDB at all (M31, M33 — LVDB's `dwarf_all` table excludes
the major spirals).

| Column              | Notes |
| ------------------- | ----- |
| `name`              | Matches LVDB's `name` column for merge, **or** names a standalone object not in LVDB. |
| `a_pc / b_pc / c_pc`| Local-frame semi-axes in parsecs. |
| `orient`            | Orientation spec: `pa:X` (sky-plane PA), `disc:i=X,pa=Y` (Magellanic-style inclined disc), `los` (line-of-sight elongated). |
| `source`            | Primary structural reference, as an index citation in label form ([Cited papers](/data/papers/README.md#how-the-tree-cites-a-work)). Documentation only; the build does not read it. |
| `ra_deg`            | *Optional standalone position.* Populated for objects not in LVDB; leave empty for LVDB-merge rows. |
| `dec_deg`           | *Optional standalone position.* Same — all three must be set together or all three empty. |
| `distance_kpc`      | *Optional standalone position.* Same. |
| `m_v`               | *Optional.* Integrated apparent V magnitude — standalone rows only (M31 / M33, [de Vaucouleurs 1991](/data/papers/index.md#devaucouleurs1991)); LVDB-merge rows take photometry from LVDB. |
| `profile`           | *Optional.* Emission family `disc` \| `sersic`; empty falls to the family rule (Sérsic spheroid). Set `disc` for LMC / M31 / M33. |
| `n_sersic`          | *Optional.* Hand-curated Sérsic index (M 32 → 1.5: the bulge component of [Graham 2002](/data/papers/index.md#graham2002)'s bulge + exponential-disc fit, applied here as a single-component index). |
| `r_d_pc`            | *Optional.* Exponential-disc scale length; required on `disc` rows. |
| `bulge_to_total` / `bulge_re_pc` / `bulge_n` | *Optional.* Sérsic-bulge composite (M31 only) — all three set together or all empty. |
| `source_profile`    | *Optional.* Profile-parameter source, separate from the structural `source`. |
| `color`             | *Optional.* Population tint (hex); empty → the renderer's per-family default. |

A `source` cell credits the values its paper carries, not the whole row.
Values no cited paper carries, and values that depart from their source, are
stated with both numbers in
[Local Group wireframes](/docs/science-local-group.md#local-group-wireframes)
and [the luminosity model](/docs/science-local-group.md#local-group-luminosity-model):
the LMC inclination and PA, the Sagittarius semi-axes, the M 32 and NGC 205
extents, the NGC 205 PA, the M31 PA, radius and thickness, and M31's
`bulge_to_total` — each an open decision under `stellata-uadc.69`.

For LVDB-merge rows, the override **replaces** the structural detail
an LVDB row would otherwise produce; **position (RA/Dec/distance)
still comes from LVDB.** For standalone rows (M31, M33), the override
provides the position directly — no LVDB merge happens. Other
LVDB-only dwarfs render as sky-plane oblate ellipsoids from
`rhalf_physical` + `ellipticity` + `position_angle` — no override row
needed, and their luminosity model solves entirely from LVDB
photometry ([Local Group luminosity model](/docs/science-local-group.md#local-group-luminosity-model)).

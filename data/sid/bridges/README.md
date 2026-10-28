# SID bridges — cross-release Gaia same-as edges

One `<from>_<to>.tsv` per Gaia data-release transition (`gaia_dr3_dr4.tsv`, …):
the carried one-to-one source matches `pnpm run sid:dr-reconcile` drafts into
`build/sid/dr-reconcile-bridges.tsv`, reviewed by hand and committed here
when a release bump lands ([§ 6](/docs/sid.md#6-gaia-data-release-reconciliation)).
Each file has the same `a`, `b`, `note` columns as `../sameas-overrides.tsv`,
and every SID read takes the union of that file and every bridge here as the
stored same-as edges ([§ 4.1](/docs/sid.md#41-same-as-equivalence-graph)).

The folder holds no bridge until the first release transition; this README
keeps it present, since the readers declare the folder itself as a required
input (`SAMEAS_BRIDGES`) and a new bridge file changes their input set.

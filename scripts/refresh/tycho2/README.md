# Tycho-2 pull

`refresh:tycho2`: Tycho-2's main table and supplement 1 (VizieR `I/259/tyc2`,
`I/259/suppl_1`) filtered to the TYCs the membership manifest and IV/25
mention and the rows naming a manifest HIP, written to `data/tycho2/tycho2_{main,suppl1}.tsv` on the
TypeScript runtime ([pull/README.md](../pull/README.md)) as a phased pull.
What the tables are for and which position a consumer propagates from:
[data/tycho2/README.md](/data/tycho2/README.md).

## Files

- `tycho2-pure.ts` — the request set, the TYC1 bands, both tables' columns,
  formats and spot rows, the kept-share band, the cover gate and
  `tycho2Pull`.
- `tyc-request.ts` — `readTycRequest`: the TYC request read off the manifest
  (`MEMBERSHIP_MANIFEST`) and IV/25 (`TYC2_HD`), both named in the record's
  `requestFrom`, which `refresh:simbad-tyc-hd` asks; `readTycho2Inputs`, the
  same plus the manifest's HIPs, which only this pull reads.
- `refresh-tycho2.ts` — the entry. `tycho2-outputs.ts`, its `declareOutputs`.
- `{main,suppl1}.cfa.{tsv,fits}` — the [replies](#replies) recorded from CfA.
- `tycho2.test.ts` — the request, bands, gates and run over a faked `ask`,
  and each table's [replies](#replies) replayed into its committed lines.

## The request set

The manifest's `tyc` cells and IV/25's Tycho ids, each parsed to integers and
written back as one key (`3694-2544-1`), so two spellings of one entry
collapse. The manifest's own TYCs are kept apart as the set the cover gate
holds to. `refresh:simbad-tyc-hd` asks the same TYCs
([The request set](/data/tycho2/README.md#the-request-set--manifest--iv25)).

A row is also kept when its `hip` names a manifest HIP. Tycho-2 gives one HIP
to both entries of a resolved pair, and the pair rule
([The pair rule](/scripts/catalog/membership/merge-derivation/README.md#connected-is-not-unique--the-pair-rule))
finds a pair only when both entries' rows are in the table. A move leaves the
manifest naming one entry, so a TYC-keyed request alone would drop the other
on the next pull, and the rule would no longer see the pair it moved. The
recorded request lists the HIPs after the TYCs (`HIP 7751`), so a manifest HIP
change makes the pull stale too; `refresh:simbad-tyc-hd` asks and records the
TYCs only.

## Bands, not a key filter

VizieR can express no server-side filter on the full identifier
([Why the pull is range-batched](/data/tycho2/README.md#why-the-pull-is-range-batched-rather-than-key-filtered)),
so each table is scanned in 24 bands of 400 TYC1 values over
[`TYC1_MIN`, `TYC1_MAX`], one declared phase per band and table, and each
band's rows are filtered as they land: one band is held at a
time, not the 2.5 M-row table. `TYC1_BAND_ROWS` (160,000) bounds a band; the
largest holds 155,282 (8401–8800, measured on the CfA mirror). A mentioned
TYC whose TYC1 lies outside the span stops the run before any query, since
it would otherwise read as an entry Tycho-2 lacks.

Each band's reply is checkpointed like any pull's
([The checkpoint](../pull/README.md#the-checkpoint)), about 400 MB of CSV for
both tables until the outputs land; a failed gate keeps it, so the fix
re-run costs no network.

## Gates

- **Kept share**, per table: kept rows as a share of the mentioned TYCs,
  floored at both ends (main 0.98–1.01, supplement 0.008–0.024), so a request
  that moves moves the band with it. The rows kept by HIP alone push both
  above the TYC-only share: measured 2026-11-16, main 1.0004 (2,643 rows a
  manifest HIP names and no TYC does), supplement 0.0159 (3,197, every one a
  `flag='H'` Hipparcos star).
- **Spot rows**: the main table's on `ra_mdeg` (TYC 3694-2544-1, HD 14039,
  carries no HIP, and the TYC is three columns); the supplement's on `hip` 6.
- **The cover gate** (`membershipCover`): every manifest TYC reaches a row of
  either table, or is a `TYC3>1` component whose pair's `TYC3=1` entry was
  reached, Tycho-2 having merged it into the pair. Anything else fails the
  emission as a membership event to adjudicate.

Every gate runs before the one emission, so a failure leaves both tables and
the record as they were.

## Replies

Each table's replies are CfA's TSV and FITS answers to one query,
`<table>.cfa.{tsv,fits}` beside the suite (2026-11-15): the spot row's
entry, asked by TYC1 and TYC2, read through `tapClient` as a live band is. CDS's
replies wait on CDS answering, as the whole-table pulls' do
([Replies](../vizier/README.md#replies)).

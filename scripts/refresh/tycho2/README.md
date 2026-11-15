# Tycho-2 pull

`refresh:tycho2`: Tycho-2's main table and supplement 1 (VizieR `I/259/tyc2`,
`I/259/suppl_1`) filtered to the TYCs the membership manifest and IV/25
mention, written to `data/tycho2/tycho2_{main,suppl1}.tsv` on the
TypeScript runtime ([pull/README.md](../pull/README.md)) as a phased pull.
What the tables are for and which position a consumer propagates from:
[data/tycho2/README.md](/data/tycho2/README.md).

## Files

- `tycho2-pure.ts` — the request set, the TYC1 bands, both tables' columns,
  formats and spot rows, the kept-share band, the cover gate and
  `tycho2Pull`.
- `refresh-tycho2.ts` — the entry: reads the request off the manifest
  (`MEMBERSHIP_MANIFEST`) and IV/25 (`TYC2_HD`), both named in the record's
  `requestFrom`. `tycho2-outputs.ts`, its `declareOutputs`.
- `tycho2.test.ts` — the request, bands, gates and run over a faked `ask`,
  and each table's [replies](#replies) replayed into its committed lines.

## The request set

The manifest's `tyc` cells and IV/25's Tycho ids, each parsed to integers and
written back as one key (`3694-2544-1`), so two spellings of one entry
collapse. The manifest's own TYCs are kept apart as the set the cover gate
holds to. `refresh-simbad-tyc-hd.py` reads the same set through
`refresh_lib.read_mentioned_tycs` until it ports
([The request set](/data/tycho2/README.md#the-request-set--manifest--iv25)).

## Bands, not a key filter

VizieR can express no server-side filter on the full identifier
([Why the pull is range-batched](/data/tycho2/README.md#why-the-pull-is-range-batched-rather-than-key-filtered)),
so each table is scanned in 24 bands of 400 TYC1 values over
[`TYC1_MIN`, `TYC1_MAX`], one declared phase per band and table, and each
band's rows are filtered to the request as they land: one band is held at a
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
  floored at both ends (main 0.98–1, supplement 0.004–0.012), so a request
  that moves moves the band with it.
- **Spot rows**: the main table's on `ra_mdeg` (TYC 3694-2544-1, HD 14039,
  carries no HIP, and the TYC is three columns); the supplement's on `hip` 6.
- **The cover gate** (`membershipCover`): every manifest TYC reaches a row of
  either table, or is a `TYC3>1` component whose pair's `TYC3=1` entry was
  reached, Tycho-2 having merged it into the pair. Anything else fails the
  emission as a membership event to adjudicate.

Every gate runs before the one emission, so a failure leaves both tables and
the record as they were.

## Replies

CDS was unreachable when the pull was ported, so the suite's replies are
synthetic: committed rows in the CSV dialect ESA, ARI and SIMBAD-Harvard
answer with. The record was written from a checkpoint seeded with the
committed rows, band by band, so its `answeredBy` is empty until its first
live run.

# The additions — primaries rows the spine lacks

The manifest rows the primaries add beyond the spine: every IV/25 Tycho-2 star,
I/239 HIP and CNS5 census row the inherited spine does not carry, grouped into
stars and admitted as manifest rows or ledgered onto the record they resolve
to. `addition-items-pure.ts` enumerates the items and the cells each derives
from; grouping, the binding derivation and admission run in
`../membership-manifest-pure.ts`, and the ledger's codec is
`../additions-ledger-tsv.ts`. This README is the authority for all of it. The
manifest it feeds: `../README.md`.

## Files in this area

```
scripts/catalog/membership/additions/
  addition-items-pure.ts   The items, one per primary row the spine lacks,
                           and the cells an item or group derives its binding
                           from. Imports nothing from the generator module, so
                           build:astrometry-request enumerates them without
                           reaching the manifest's declaration
                           (../../../util/sources/README.md#reached-means-read).
                           Unit-tested in ../membership-manifest-pure.test.ts,
                           over that suite's primaries fixture.
```

## Grouping and admission

`findAdditions` (the audit) yields three cohorts the spine lacks: IV/25 Tycho-2
stars by TYC, I/239 HIPs, CNS5 census rows. The same star reaches that list
once per primary, so the cohorts are **grouped** before admission
(`groupAdditions`): an HD item joins the HIP item Tycho-2's own `hip` column
or IV/27A names for it (123 + 5 groups), and items deriving one source are one
star — except two TYC items, which are two Tycho-2 stars whatever the
best-neighbour walk says. Each item derives on its own cells through the
binding derivation, so a SIMBAD object carrying both a HIP and a TYC joins an
I/239 HIP with no HD link to its Tycho-2 star (19 such, plus 4 CNS5 rows),
where the raw walks alone left two records for one star.

**Admission applies the collision guard's rule at the door.** A group takes
only designations **no record already answers to** — display cell or alias,
compared on `hd` / `hr` / `hip` / normalised GJ — and only a raw source no
spine record carries. A designation on two records names a granularity and
keys no SID ([§ 4.1](/docs/sid.md#41-same-as-equivalence-graph)), so attaching one another record holds would
cost that record its key for nothing. The claim set is the spine's after the
label merge and **grows as each group is admitted**, so the rule reads the same
whether the record already answering is a spine row or an earlier addition.
The consequences, measured 2026-09-29:

| Outcome | Groups | What it is |
|---|---|---|
| `admitted:hd_link_gap` | 54,813 | IV/25 star, lowest admitted HD < 100,000 — AT-HYG's link defect |
| `admitted:hd_omitted` | 5,063 | IV/25 star, HD ≥ 100,000 |
| `admitted:hip_omitted` | 425 | I/239 HIP with no IV/25 star |
| `admitted:cns5_census` | 3,352 | CNS5 `GJ 1xxxx` row |
| `component:<anchor>` | 465 | every designation it arrived with is another record's. 460 are the second Tycho-2 entry of a resolved pair whose HD (and, through Tycho-2's `hip`, HIP) a spine record carries; 5 are the second of a pair neither component of which is on the spine. Not a row; ledgered onto the record it resolves to. Five left the class when the curated HD corrections freed the number their anchor was wrongly displaying ([Curated overrides](../../classic-ids/label-merge/README.md#curated-overrides-and-what-does-not-belong-in-them)) |
| source left empty, on a spine record | 133 | Gaia fitted one source where Tycho-2 resolved two stars |
| source left empty, gate refused | 170 | the derivation reached candidates and both gates refused every one |

The audit's headline cohort sizes (60,344 / 566 / 3,362) are pre-grouping and
pre-admission; the table above is what the manifest carries.

**Those 5 are two groups arriving with one designation and no spine record to
lose it to.** IV/25 resolves HD 23068, 37703, 45900, 63846 and 86269 onto two
Tycho-2 stars each — close doubles at 1.5–3″, HD 45900's pair at 8.5″, flagged
`n_tyc > 1` — and neither component is on the spine. Admission is sequential,
so its order fixes which one takes the designation: the group whose bound
source publishes a Gaia parallax first, then one bound to a source with none,
then an unbound one — the designation goes to the record that ships, since the
others park for want of a parallax — then TYC, HIP, GJ. A total order over
content, never over walk order. HD 86269 is why the parallax is read rather
than inferred from the binding: both entries bind, and SIMBAD's A (the lower
TYC) sits on a 2-parameter source, so the number goes to B and ships.

The guard is keyed on the **normalised GJ, letter included**: `GJ 3131B` is the
other component of `GJ 3131A`'s pair, a second star under a second designation,
and matching the bare number as well ledgers 21 CNS5 component stars away as
components of their own primaries. Whether the system is represented at all is
the cohort filter's question, and `spineKeys` answers it against the bare
number there.

Three admitted rows ship without a designation their primaries publish
(`addition.blocked-designation`): TYC 8188-4142-1 on HIP 50798 without
HD 90034, TYC 1567-2517-2 on HD 166479 without HR 6803, TYC 8374-2988-1 on
HIP 93538 without HD 176555, each held by a spine record. The record ships; only the label is withheld.

No admitted row keys on a Gaia id alone — admission throws on one, since a
group with no classical designation left is ledgered as a component — and no
designation one carries sits on a second row (`sharedDesignations`, <!-- count:membership-manifest/sharedDesignations -->68<!-- /count -->, every
one a spine-side `hd:` or `hr:` pair), so SID allocation mints every addition under `hd:` /
`hip:` / `gl:`. The two answer only together: the first says the row has a classical
designation, the second that the designation is its own.

<a id="admission-is-not-a-promise-of-a-record"></a>**Admission is not a promise of a record.** An admitted row walks the [§ 5](/docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers)
cascades like any other, so one that reaches no owned parallax or no V parks on
`data/membership/parked-ledger.tsv` under the existing reason codes
([Per-row pipeline](../../parse/README.md#per-row-pipeline)). Manifest rows are the membership
term; the record count is that term less the parks.

An addition's other labels come by **designation-keyed** joins over the same
primaries — HR from V/50 by HD, HIP and Flamsteed from IV/27A by HD, HIP from
Tycho-2's own column — never through the source-keyed overlay.

**An addition binds through the spine's own derivation** — the same four
sources, consensus ranking and both gates
([The four sources, in precedence order](../binding/README.md#the-four-sources-in-precedence-order)),
on the group's TYC, HIP and CNS5 GJ. One derivation for every primaries row is
what keeps the magnitude term from drawing a named star twice: the union
dedupes on bound source_ids only ([The union dedupes on the derived binding](../magnitude-term/README.md#the-union-dedupes-on-the-derived-binding)),
so a source an addition could bind but does not comes back as a second,
unnamed record. SIMBAD is the route that matters here — its object under the
row's own TYC names the source where Tycho-2's best-neighbour walk reaches
nothing. A winner a spine record already holds, or that two groups reach,
leaves the cell empty, as a spine collision does. The `admit.magnitude.*` codes
count the magnitude rows that are still some primaries row's unshipped
candidate, by why it was not shipped. Each such row's lineage code is
`admit.magnitude.<reason>`, citing the proposing row's origin, and
`MEMBERSHIP_INVARIANTS` fails the build on any `admit.magnitude.withheld` row
([Invariants](../../lineage/README.md#invariants)). A derived source a
`pair_component` disposition declines counts as `component`, since the review
names it the other star of the pair (44 Boo A's derivation reaching i Boo B);
any other disposition that declines it leaves it `withheld`, which fails.
`runner_up` and `component`
are allowed because most of their rows are a resolved pair's second star; the
defects inside them — a star drawn twice, a designation on the wrong
component, an unrelated star ledgered as a component, a pair's light counted
twice — each carry their own fix and check.

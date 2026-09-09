# The label merge — overlay ∪ spine, per identifier

The per-identifier rule that turns the source_id-keyed overlay (`../README.md`)
and the inherited spine's cells into the manifest's final labels, with the
collision guard, the curated overrides and the review queue behind it. The
contract is `docs/catalog-driver.md` § 4.

## Files in this area

```
scripts/catalog/classic-ids/label-merge/
  label-merge-pure.ts (+ test)    The merge itself: the per-identifier rule,
                                  the collision guard, the curated overrides,
                                  the review-queue codec, the designation
                                  delta the manifest parity gate replays, and
                                  the unnetted removals the parity ledger's
                                  canonical-key audit reads. Pure.
```

`mergeClassicIdLabels` (`label-merge-pure.ts`) runs in **one place**, and one
producer is what makes `label_flips.tsv` describe the labels actually shipped:
it used to take a byte-identity assertion between two runs, and that assertion
is what pinned the merge to the spine's frozen `gaia_source_id` cell.

**The key is the DERIVED binding** (`../../membership/README.md` § The binding
is derived). Keyed on the frozen cell a label names a source the record is no
longer bound to, and 1,371 rows reach no overlay entry where the derivation
leaves 578 — mostly the bright end, whose saturated 2-parameter sources are an
identity statement rather than a measurement.

**`build:catalog` runs no merge**: `readStars` reads the manifest's cells,
`hd_alt` / `hr_alt` included, as FINAL. A second pass would re-apply an overlay
already applied.

Per identifier (`hip`, `hd`, `hr`, `gl`, `flam`), first hit wins:

```
overlay asserts nothing        -> the spine's value stands (the backstop)
overlay confirms the spine     -> the spine's own SPELLING is kept
spine has no value             -> the overlay's is added
the two disagree               -> the overlay wins (§ 4 precedence)
```

**Bayer STRINGS are not merged.** IV/27A spells Bayer letters `alf` where the
spine spells them `Alp`; choosing between the conventions is the naming
ladder's gate (`docs/star-naming.md` § 4). So the overlay's `flamsteed` cell is
read for its NUMBER only, its `bayer` cell for nothing at all, and the
constellation those cells carry reaches the build through the separate
designation-keyed route (`../README.md` § The designation constellation).

Record fields are single-valued while overlay cells are not, so where the
overlay asserts several values the field takes ONE for display and the rest go
to the record's alias list — `hdAlt` / `hrAlt`, queued as `extra-alias`. The
record answers to every one of them: they become extra keys on the search
index's `hdMap` / `hrMap` (`src/client/typeahead/README.md` § Star search) and
extra `hd:` / `hr:` designations in its same-as class (`docs/sid.md` § 4.1).
The overlay asserts 130 such values today (129 hd + 1 hr); **95 are carried**,
and which ones is the next section's rule.

**HD and HR are the only fields with an alias list**, and that follows from the
join rather than from today's data: HD numbered both components of many close
pairs, and the `hr` route resolves through `hd`. `sourcesWithMultipleGj` and
`sourcesWithMultipleFlamsteed` are 0 because a GJ carries its component letter
and a Flamsteed number names one star. `hip`, `gl` and `flam` therefore have
nowhere to put an extra and queue it as `extra-dropped` instead — a label the
record will not answer to.

## An alias stops at the blend

**A second HD number names the pair's other COMPONENT, not a second name for
one star**, so whether the record may answer to it turns on whether that
component is a record of its own. 14 Lyncis is the shape: the Henry Draper
survey photographed two spectra of a 0.3″ pair and numbered them 49618 and
49619, Tycho-2 carries the pair as the single entry TYC 3778-1982-1 (IV/25
flags it `n_hd=2`), and the overlay hangs both numbers on the one Gaia source
without saying which component is which. Three outcomes:

| Disposition | Values | When |
|---|---|---|
| `extra-alias` | 95 | the pair is unresolved — one record, both components' light |
| `extra-sibling-rendered` | 35 | the secondary is a record of its own, so the number is its |
| `extra-dropped` | 0 | the field has no alias list, or the guard withheld the value |

Where the pair is unresolved the single record **is** the granularity the
catalogue has, and answering to both numbers is accurate rather than sloppy:
**93 of the 95 have no `multiples.tsv` row at all**, so no separation, position
angle or component magnitude exists to split them with, and the two HD numbers
are the entire trace of duplicity.

The predicate is `sourceIdsWithSiblingComponent`
(`../../companions/companion-promotion.ts`), keyed on the `multiples.tsv`
SYSTEM rather than the source_id — a secondary routinely carries its own
source_id or none, so grouping by source_id misses the sibling on exactly the
resolved pairs this asks about. Promotion can still decline to render a member
row, so the set is a deliberate **superset** of what ships — 35 withheld
(34 hd + the 1 hr) across the 34 records whose system names a sibling, of which
33 render one today.

An alias also clears § The collision guard's rule, which the guard itself
cannot apply — aliases are not display cells, so its tally never sees them.
Those are withheld to `extra-dropped`; 0 fire today, measured and guarded.

The **68** ambiguous designations `sid:allocate` drops are spine-side component
pairs, unrelated to this list (`../../../sid/README.md` § Ambiguous
designations). No carried alias is among them, and none keys a ledger row, so
the additions cannot fuse two same-as classes or move a canonical key.

A promoted companion inherits neither list. The overlay names no component, so
handing the anchor's alternative HD to the companion would invent the very
attribution the table declines to make (`../../companions/README.md`
§ Promoted-companion field inheritance). Attributing each number to its
component where IV/27A's own columns disambiguate — 49618 carries HR 2520 and
HIP 33048 where 49619 carries neither — is `stellata-3bsf.39`.

## The collision guard

**The merge may not turn an unambiguous spine designation into an ambiguous
one** — the rule, and why attaching a designation another record holds costs
both records their SID key rather than buying one, is
`docs/catalog-driver.md` § 4. It fires on 31 cells; p Eridani is the case, the
overlay attaching HIP 7751 to the HD 10361 component. A record whose only
claim is a duplicate's is corrected as a merge decision
(`../../membership/README.md`).

Scored against the POST-merge assignment, on the designation a value would key
— `gl` keeps its component letter — so the four HD mutual swaps stay legal,
neither value gaining an owner. A fixpoint, not one pass: withholding one
proposal can re-expose a value its partner had proposed to vacate.

## Curated overrides, and what does NOT belong in them

`data/classic-ids/classic_id_overrides.tsv` pins one record's one identifier —
an explicit value, or empty for "keep the spine's". It is for the case
`docs/catalog-driver.md` § 4 names: review finding the CDS join wrong. It holds
**one row**, whose evidence the file's own header states: Propus, where a Gaia
source keyed to the wrong component of a resolved Tycho-2 pair would take
η Gem's own HD off the star.

Four shapes that LOOK like exceptions are reached mechanically instead, and
the file's header names the first three: a proposal that would make another
record's designation ambiguous (§ The collision guard); a Gliese renumbering
(`Gl 157.1` → CNS5's `GJ 9140`), an IDENTITY bridge in
`data/sid/sameas-overrides.tsv` since both designations name the star and `gl:`
is the canonical key of all five affected records; and a swapped GJ component
letter (§ The gl comparison is specificity-aware). The fourth is upstream of
this file entirely — IV/27A stating a Bayer or Flamsteed designation for a
star that is not the one it names, which leaves the cross index before any
consumer reads it (`../README.md` § One designation, two HD numbers).

## What the merge compares values on

`gl` compares on its bare GJ number (the `Gl`/`GJ` prefix is a display form and
CNS5's trailing `.0` a formatting artifact — not collapsing it scored 14
same-star pairs as disagreements), `flam` on the number alone (its row is
already keyed on one source_id, so a same-number-different-constellation match
is not reachable). The merge's `label*` routing and the spine-side coverage
counts are pinned in `../../membership/membership-manifest-expected.json`, the
build that runs it.

### The gl comparison is specificity-aware

The number decides the STAR; the component letter takes a PAIRWISE rule beside
it (`FieldSpec.confirms`) and its own ownership key (`FieldSpec.identity`),
because neither strict nor collapsed comparison is right. Two different
components of one system disagree and § 4 precedence decides them — collapsed,
Gl 563.2's swap read as agreement, though CNS5 rows 3664/3665, SIMBAD and the
HIP all letter HIP 72509 B and HIP 72511 A against AT-HYG. But a SYSTEM-level
claim contradicts nothing on EITHER side: `gj_comp` states a multi-component
entry's letters COMBINED (Gl 423 is one entry reading `ABCD`) and a bare number
names the system too, so strict comparison would read a hundred-odd such pairs
as disagreements and swap a component for a system spelling.

`labelFlipped.gl` reaches **13 records**, 8 as four mutual A↔B swaps (Gl 66,
Gl 150.1, Gl 421, Gl 563.2), each on CNS5's own Gaia-keyed row rather than a
walk. Two key `gl:` and nothing else, so the relabel renames the canonical key
and identity rides a `data/sid/sameas-overrides.tsv` bridge as the Gliese
renumberings do: `GJ 3196A`→`B`, `GJ 4378A`→`B`, each a star whose pair sibling
holds its own GJ number (`GJ 3197`, `GJ 4379`), so no second record can claim
the retired spelling — `../parity-ledger.test.ts` pins that bridged set. On
GJ 4378 the letter is contested (SIMBAD and `multiples.tsv` both root the star
as WDS J23573-1259**A**); precedence takes CNS5's B, and `stellata-3bsf.47`
adjudicates.

`normaliseGjKey` (`../../catalog-pure.ts`) is where the `.0` is collapsed once,
for this comparison and for the joins that key off the same cells
(`../README.md` § The GJ fold stops at the component). `glieseNumber` states
the same rule for the label side, where the component letter it strips is
compared separately.

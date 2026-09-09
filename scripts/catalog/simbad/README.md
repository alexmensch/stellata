# SIMBAD table readers, and what they adjudicate

The parsers for the two per-source SIMBAD pulls the catalogue build joins on,
and the identifier rule the TYC → HD witness settles. What the tables ARE, how
they were pulled and what they cover is `data/simbad/README.md`; this folder
owns how they are read and what a consumer may conclude from them.

## Files in this area

```
scripts/catalog/simbad/
  simbad-values-parse.ts          data/simbad/simbad_values.tsv indexed by
    (+ test)                      every namespace the pull keyed on. Bottom
                                  tier of the rv, direction/PM and distance
                                  cascades alike.
  simbad-tyc-hd-parse.ts          data/simbad/simbad_tyc_hd.tsv on the full
    (+ test)                      TYC, plus `hdNumbers` — the component letter
                                  dropped, for the integer comparison against
                                  IV/25. The test carries the adjudication
                                  below, pinned over the committed tables.
```

## Which witness decides a close pair's HD

Some records display a neighbour's HD number, and the shape is always the
same: Gaia fits ONE source across a pair Tycho-2 resolves into two entries, so
the row's TYC cell and its HD cell can end up naming different components. The
question a rule has to answer is **which cell is the crossed one**, and the
answer is not the one two TYC witnesses give.

**A record's identity is its Gaia binding.** The `gaia_source_id` is what the
manifest justified and what `readStars` builds the record from
(`../membership/README.md` § The identifier columns are read, never
re-derived), so the star the record IS is the star SIMBAD's object for that
source is. A TYC cell is a designation the row carries, and on a resolved pair
it can be the sibling's — that is the crossed-cell case, and it cannot move
an HD on its own however many printed indexes agree with it.

So the rule takes **four witnesses**, and only moves a cell where they all
name the record's own component:

```
IV/25 for the row's own TYC, read as a SET  ┐
SIMBAD's HD for that same TYC               ┤ agree on an HD the row does not ship
SIMBAD's object for that TYC                ┤ names the same component as
SIMBAD's object for the record's SOURCE     ┘ the record's own binding
```

Measured over the manifest, 2026-09-09. 23 rows have both TYC witnesses
against the shipped HD (`data/simbad/README.md` § The TYC → HD pull); the
fourth witness splits them:

| Verdict | Rows | What it is |
|---|---|---|
| move | 9 | the record's source and its TYC are the same component, and the shipped HD is the neighbour's — α Psc A, f Eri A, ζ¹ Cnc A, δ Ser A, κ¹ CrA, κ² CrA, 12 Aqr A, ζ² Aqr, HD 330123 |
| refuse | 12 | the record's source is the OTHER component, so the TYC cell is the crossed one and the HD stands |
| silent | 2 | no SIMBAD object for the record's source (TYC 8568-3121-1, 2604-1777-1) |

**HD and HR move together or not at all.** V/50 pairs an HR with an HD, so
moving one while the other stays composes a pair no catalogue publishes: every
row in the move set carries both (α Psc A's HR 595 → 596, and so on), and
HD 330123 carries neither.

**ε Bootis is the case the rule exists for, and it lands in `refuse`.** Its
record holds HIP 72105 and TYC 2019-1250-1; IV/25, SIMBAD-by-TYC and I/239 all
call that Tycho entry HD 129988 (ε Boo B), and a rule keyed on the TYC would
hand Izar its companion's number. SIMBAD's object for the record's own source
is `* eps Boo` — Izar — so the shipped HD 129989 is right and the TYC cell is
the crossed one. **`kappa` Pup, ζ Boo and 32 Eri sit in `refuse` on the same
evidence**, which is why `stellata-3bsf.50`'s first rule — prefer the own-TYC
HD — was reverted after reaching them.

**I/239's HD for a HIP is not a fourth opinion.** Hipparcos resolved a close
pair as ONE star (`../naming/README.md` § The record-side join), so its HD is
whichever component the blended entry printed; it backs the shipped cell on 18
of the 23 and agrees with the TYC on 5, and neither reading is component
evidence.

**Silence is silence.** 21,613 manifest rows carrying both a TYC and an HD get
no answer from the pull at all, f Pup among them, and 2 of these 23 have no
object for their source — a rule must leave those alone rather than treat
absence as agreement.

The partition is pinned in `simbad-tyc-hd-parse.test.ts` § the four-witness
split, over the committed tables, so a re-pull that moves a row fails the suite
rather than ageing this section. Asserting the move set — both fields, the SID
keys that follow and the sibling admissions that follow those — is
`stellata-hooj.14`.

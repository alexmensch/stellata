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

## What the TYC → HD pull adjudicates

Held against the manifest's shipped `hd` and IV/25's HD for the row's own TYC,
over the 331,734 manifest rows carrying both a TYC and an HD that this file
answers for — the two classes, and only the first is reachable without it:

- **SIMBAD shares no HD with IV/25 on the row's own TYC — 219 rows.** IV/25 is
  internally consistent on every one (`n_hd=1 n_tyc=1`, and its HD→TYC
  direction agrees with its TYC→HD one), so **no committed table could detect
  this class**. It splits two ways, and the split is the load-bearing part:
  - **209** where the manifest faithfully carries IV/25's HD and SIMBAD
    rejects both. Many are mutual swaps between a pair's two entries, and the
    set is full of named stars: τ Oph, ξ Sco and ε² Lyr (both entries of
    each), 20 Lyn, 8 Lac, 65 Psc, 55 Eri, ε Ari, μ¹ Cyg.
  - **10 where SIMBAD backs the manifest's shipped HD against IV/25** —
    γ¹ Ari, π Aql B, λ Oct B, TYC 2772-917-1, HD 17479A, HD 18281 and
    HD 18282 (a mutual swap), HD 48766, HD 213973B, HD 224646B. A rule keyed
    on the row's own TYC in IV/25 would corrupt every one, which is why the
    second witness is a prerequisite rather than a refinement.

  **Compare against IV/25's HD SET for the TYC, never one row of it.** An
  entry IV/25 marks `n_hd=2` occupies **two rows**, one per HD — 197 TYCs do —
  so a single-valued lookup keeps one and reads SIMBAD's agreement with the
  other as a disagreement. That is the difference between 219 and the 226 this
  section first reported: all 7 of the surplus were rows where SIMBAD names an
  HD IV/25 does publish for the entry, on the row the lookup dropped. β Lyr is
  the shape — IV/25 gives TYC 2642-2929-1 both 174638 and 174639, SIMBAD says
  174638, the manifest ships 174638, and nothing disagrees with anything.
- **SIMBAD and IV/25 agree and the manifest ships a different HD — 23 rows.**
  Both TYC witnesses against the shipped cell: α Psc A, f Eri A, 32 Eri B,
  β Mon B, k¹ Pup, ζ¹ Cnc A, ζ Boo B, ε Boo B, δ Ser A, ρ Her A, κ¹/κ² CrA (a
  mutual swap), ε¹ Lyr B, 12 Aqr A, ζ² Aqr, and 8 plain-HD stars.

  **Two witnesses agreeing about a TYC is not two witnesses agreeing about the
  RECORD**, and this section read the 23 as manifest errors "with no remaining
  doubt" before that was measured. A fourth witness splits them, and it does
  not back the shipped cell on all 23: § Which witness decides a close pair's
  HD partitions them and carries the enumerated move set.

So 232 shipped HD cells are contradicted and 10 are vindicated against the
printed index. Both of the two dissents `stellata-3bsf.50` measured live
reproduce exactly — π Aql (IV/25 187259, SIMBAD 187260) and TYC 2772-917-1
(224635 / 224636) — which is what says the file agrees with the hand
measurement that motivated it, and both are in the vindicating 10.

Every count in this section is pinned against the committed tables by
`simbad-tyc-hd-parse.test.ts` § adjudication over the committed tables, so a
re-pull that moves one fails the suite rather than ageing this prose.

A consumer therefore has three verdicts to handle, not two — agrees, dissents,
and silent, the last being the rows the pull answers for at all (§ Which
witness decides a close pair's HD, Silence is silence).

**No consumer reads it on the build path yet.** It is the evidence a rule
needs, the rule it settles is the next section, and asserting what that rule
licenses is `stellata-hooj.14`.

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
rather than ageing this section.

**Eight of the nine are asserted**, in
`data/classic-ids/classic_id_overrides.tsv` (`../classic-ids/label-merge/README.md`
§ Curated overrides), and the move set the test pins is what is left. What the
assertion cost: `labelOverridden` hd 1 → 9 / hr 0 → 7, five freed HD numbers
admitted as manifest rows of their own, one `hd:` SID minted (δ Ser B, on its
own Gaia source), `namingDuplicateLabels` 48 → **47**. Each record's spectral
type — keyed on its Gaia source, so independent of every witness above — now
matches the component whose HD it carries.

**α Psc is the ninth and is held back.** Correcting it letters the anchor A
where the authority letters HD 12446 B, and promotion's twin guard keys on
exactly that letter, so the 02020+0246-AB row would mint a copy of its own
anchor again — the defect `sid:193218` was retired for. `stellata-hooj.16`.

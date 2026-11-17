# SIMBAD sp_type — the manifest-keyed spectral types

`refresh:simbad-sptype` — SIMBAD's `sp_type`, `sp_qual`, `sp_bibcode` and
`otype` for every membership-manifest row, with each object's HIP, Gaia DR3,
TYC and GJ ids, written to `data/simbad/simbad_sptype.tsv`. The catalogue's
top spectral tier and a binding source of the membership build
([Consumed by](/data/simbad/README.md#consumed-by)). A phased pull on the
[pull runtime](../pull/README.md#a-phased-pull) over the
[SIMBAD core](../simbad/README.md#the-typescript-core).

## Files

- `refresh-simbad-sptype.ts` — the entry: reads the manifest, `describe` and
  `main`.
- `simbad-sptype-pure.ts` (+ test) — the columns, phases, gates and
  `sptypePull`.
- `simbad-sptype-outputs.ts` — the step's output declaration.

## The request and the gates

Every manifest row's keys (`membershipKeys`, no cohort), resolved by Phase A
with the widening ladder; then the basic table per oid; then the value-keyed
union, which asks the namespaces of each row no bound object types
([The union asks every namespace a record reaches](../simbad/README.md#the-union-asks-every-namespace-a-record-reaches));
then cross-IDs for every object either pass found. The run log prints the
union's counts and a sample of `RECOVERED_SAMPLE` recovered rows.

- **Band**: 90% to 110% of the manifest's keyed rows: a key binds at most one
  object, and the union adds objects beyond them.
- **Floors**: `sp_type` filled per membership term (`SP_TYPE_FLOORS`), over
  the objects that term's rows' Gaia ids bound: 80% for the primaries and 15%
  for the magnitude term, whose fainter stars SIMBAD seldom types (measured
  2026-11-08: 90.6% and 21.4%), so the magnitude term cannot mask a primaries
  regression.
- **Spot rows**: Arcturus (oid 2252964) and alf Cen A (oid 3396054), main_id,
  `sp_type` and HIP exact, alf Cen A's GJ too.
- **Parse ledger**: an id shape the namespace rules do not know fails the pull.

Re-pulling it re-opens the binding review by construction
([`simbad_sptype.tsv` is a cycle](../README.md#the-staleness-gate--pin-the-shortfall-never-the-numerator)):
expect `binding-review-dispositions.tsv` rows to need re-review in the same
change.

## The request set

Every SIMBAD pull keys on the membership
term — **no refresh script reads the AT-HYG CSV** ([Consumed by](/data/athyg/README.md#consumed-by)).
The spine's `gaia_source_id` is the resolved, gate-passed
binding rather than a raw cell, so request and record build name the same
sources by construction; rebasing the sp_type set dropped 3,172 source_ids
the CSV walk over-pulled and gained 193 (measured 2026-08-15). Realised on
the 2026-08-25 re-pull: the committed file's `source_id`-keyed rows fell
325,479 → 323,228, and `simbadSptypeEntries` in build-counts with them.

The no-Gaia tier (1,371 rows) falls through **HIP → TYC → GJ**: 1,317
carry a HIP, 41 are keyed on a TYC, 12 on a GJ, and Sol carries none.
The fall-through is strict, so those 41 are keyed on TYC whether or not
they also carry a GJ — **5 of them do**, and their GJ is never requested
([The ladder is ordered by what an identifier names](/scripts/catalog/spectral/README.md#the-ladder-is-ordered-by-what-an-identifier-names)).
Resolution against SIMBAD's `ident` table is 100% for HIP and TYC and
10/12 for GJ — `Gl 165A` and `GJ 3406A` are component designations SIMBAD
does not index, and stripping the letter would key the system rather than
the component, so they stay unresolved rather than mis-bound.

<a id="the-widening-ladder-and-its-corroboration-rule"></a>**The widening ladder, and its corroboration rule.** A source_id SIMBAD's
`ident` table does not carry leaves its row unreachable under the Gaia
namespace — so each pull retries those rows on the record's own **HIP,
then TYC, then GJ**, the order the no-Gaia tier itself falls through, each
rung asking only for what the rungs above left unbound. Read-back does not
depend on that order — see [The widening falls through on resolution, not on cell presence](/scripts/refresh/simbad/README.md#the-widening-falls-through-on-resolution-not-on-cell-presence).
Every binding made on a designation alone — these, and the union's below —
is adjudicated against SIMBAD's own Gaia cross-IDs **across releases**: kept
where SIMBAD holds the asking id under any release, dropped where it
holds a *DR3* id that is not the asking one, kept-and-counted where it
holds no DR3 id to contradict it. Over the value cohort, **8 vetoed** and
142 kept (62 corroborated, 80 with no DR3 id against them) out of 150
candidate bindings — bindings, not rows: a row vetoed on one rung is
offered again to the next, so the 150 exceeds the distinct rows widened by
at most the 8 vetoed. Mechanism and why only DR3 can contradict:
[The widening](/scripts/refresh/simbad/README.md#the-widening-falls-through-on-resolution-not-on-cell-presence) carries its own
corroboration rule.

Reading a differing DR3 id as a different star is what used to lose the
six rows of `data/athyg/stale_gaia_source_ids.tsv`, whose spine cell is a
**Gaia DR2 id sitting in the DR3 column** — a release disagreement, not a
star disagreement. All six now reach the pull. The ladder also moved 67
rows off `HD nnnnnA`-style WDS-component entries onto the star's own
entry, every one gaining a parallax, and cost no row the row it had.

**What the widening itself was worth**, measured when it landed
(2026-08-25, the pull that added the `tyc` / `gj` cross-ID columns and took
the file from 329,268 rows to 330,141). It had 34,849 no-`sp_type` rows
carrying a TYC; what the widening reaches and what reaches a RECORD are
different numbers, and only the second one matters:

| build-count | before → after |
|---|---|
| `spectralBySimbad` | 278,326 → **280,495** |
| … by `source_id` | 277,014 → 277,048 |
| … by HIP | 1,312 → 1,494 |
| … by **TYC** | 0 → **1,940** |
| … by **GJ** | 0 → **13** |
| `spectralByGspspec` | 33,535 → 31,714 |
| `spectralFallback` | 1,394 → **1,046** |

The +2,169 into SIMBAD is exactly the 1,821 leaving GSP-Spec plus the 348
leaving unknown, so no record changed tier for any other reason. 348 fewer
stars display as unknown. The TYC and GJ rows only reach records because
the resolver gained matching tiers in the same change — the pull's cross-ID
columns are inert without them ([The resolver](/scripts/catalog/spectral/README.md#the-resolver)).

**The union closed the 34 the ladder could not** (re-pulled 2026-09-02).
Those 34 records had lost a spectral type to a vanished HIP key: the object
that owned the HIP in the AT-HYG-derived request carried **no
`source_id`** (`HD 1209`, `[R78b] 16`, `HD 6194`, …), while the
spine-derived request asks under the record's own resolved `source_id` and
gets SIMBAD's Gaia-keyed object for the same star, which carries no
`sp_type`. The widening ladder falls through on *resolution* and here it
resolved, so no rung ever fired.

The pull now asks every namespace a record reaches wherever the object it
bound answers with nothing ([The union asks every namespace a record reaches](/scripts/refresh/simbad/README.md#the-union-asks-every-namespace-a-record-reaches)),
and the reach is far wider than
those 34: measured on the spine-scoped pull that introduced it, 280,676 of
313,257 rows were answered by a bound object and asked nothing at all,
32,581 were not, and **3,267 of those were recovered** on 3,188 added
objects. That ratio is what the union is for; the rebase onto the manifest
re-ran it over a larger request without changing the rule, and the pull's
own report is where its figures come from. `simbad_sptype.tsv` is now
**966,847 rows** (2026-11-08, the whole manifest, magnitude term included)
and reads 48.5% `sp_type`-filled
(`awk -F'\t' 'NR>1{t++; if($3!="") f++} END{print f/t}'`): 90.6% over the
primaries' objects, 21.4% over the magnitude term's fainter stars.

Every one of those bindings rests on a designation alone, so every one goes
through the corroboration rule above — the guard the union does NOT get to
skip for being a union, and one shared implementation with the widening
ladder rather than a second one. It **vetoed 111 bindings**
on a contradicting Gaia DR3 id (50 HIP, 57 TYC, 4 GJ); without it 57 records
would have taken a spectral type, and so a rendered radius, from a star
SIMBAD names as a different object.

| build-count | before → after |
|---|---|
| `spectralBySimbad` | 280,236 → **283,606** |
| … by `source_id` | 276,809 → 276,810 |
| … by **HIP** | 1,482 → **4,236** |
| … by TYC | 1,927 → 2,538 |
| … by GJ | 18 → 22 |
| `spectralByGspspec` | 31,696 → **28,787** |
| `spectralFallback` | 1,025 → **564** |

The +3,370 into SIMBAD is exactly the 2,909 leaving GSP-Spec plus the 461
leaving unknown, so no record changed tier for any other reason. **461
fewer stars render with an unknown class**, and 2,909 trade GSP-Spec's
letter-only enum — subclass defaulted to 5, no luminosity class — for a
full Morgan-Keenan type, which moves their rendered radius. `ν Scorpii` is
the shape, and its `known-stars.tsv` row had recorded the defect before the
fix existed: SIMBAD's `* nu. Sco A` carries no type for the record's Gaia
source, so it took GSP-Spec's bare `O`, where `* nu. Sco` under HIP 79374
says `B2V` — and that object carries no Gaia id at all, so nothing
contradicts the binding. 5 records also leave the solar colour fallback for
the intrinsic spectral-class colour their new class supports.

`multiplicityUnresolved` moves by **1** on the same pull, which is the one
place the sp_type index is read for something other than a spectral type:
the catalogue build (`scripts/catalog/stages/sorted-stage.ts`) takes the `otype = '**'` unresolved-multiplicity flag off
`bySourceId`. A vetoed object leaves the file, and its `otype` leaves with
it. Expected rather than incidental — the veto's judgement is about which
star the object IS, so every cell it carries is subject to it.

**One object per key is still the invariant, and the union does not
threaten it.** Two SIMBAD objects for one star both reach the pull, but
under different keys: SIMBAD's `ident` table maps an id to exactly one
object, so a designation the union asks under can only resolve to the
object that holds it, and an object an earlier phase already pulled adds
nothing ([The union adds rows, never a second row under one key](/scripts/refresh/simbad/README.md#the-union-adds-rows-never-a-second-row-under-one-key)
— it carries the check to re-run). No key repeats
in any of the four namespaces. A repeated `source_id` fails the read for
every consumer of the file; a repeat under a designation key (`hip`, `tyc`,
`gj`) merges to whichever row states a type, which decides nothing today.
`data/binaries/multiples.tsv` is byte-identical across the re-pull: the
binaries-side join keys on `simbad_oid` through `simbad_wds_xids.tsv`, so
the sp_type namespaces are not on its path at all.

**7 spectral strings changed at the 2026-08-25 pull** on records that kept
a type, all through `source_id`, all upstream re-typings rather than
re-bindings: `G0V:`→`G1V`, `B5`→`B2V`, `G5V`→`G5`, `G0/2`→`F9`,
`G0IV-V`→`G0V`, `K7`→`M0`, `M7`→`M7/10`. The fifth was 26 Draconis, whose
`known-stars.tsv` row pinned the old string and was re-pinned with the
reason recorded. SIMBAD is a living database with no citable release, so a
re-typing is the expected cost of the tier, not a regression — and the
corpus is where each one gets caught, since `known-stars.test.ts` pins
`primary_spect` per row.

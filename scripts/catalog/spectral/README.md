# Spectral resolution and size lineage

The seven-tier resolver over SIMBAD's `sp_type` that picks each record's
Morgan-Keenan class, and the lineage stage recording how each record was
sized from it. The MK parser it walks with and the Stefan-Boltzmann
chain that turns a class plus an absolute magnitude into a rendered radius
are read by the viewer's focus card too, so they live in
[`/src/catalog-format/spectral/`](/src/catalog-format/spectral/README.md).

## Files in this area

```
scripts/catalog/spectral/
  simbad-sptype-source.ts         SIMBAD_SPTYPE, the pull declared
                                  (../../util/sources/). One parse yields the
                                  spectral index (typed rows, plus a typeless
                                  row only under its source_id and only where
                                  its otype is `**`, the one flag
                                  build-catalog reads off one) and each source_id's
                                  hip / tyc / gj cross-IDs, which the binding
                                  derivation and the spine audits read, plus
                                  the cross-IDs of the objects carrying no
                                  source_id, which contest the derivation's
                                  keys; a repeated source_id fails it.
  sptype-overrides-source.ts      SPTYPE_OVERRIDES, the curated tier's MK
                                  types by HIP, declared; each classified
                                  at the read.
  spectral-resolve.ts (+ test)    The seven-tier resolver and the SIMBAD
                                  sp_type index it walks, through the
                                  namespace ladder in
                                  `../simbad/simbad-namespace-ladder-pure.ts`
                                  (`walkSimbadNamespaces`, `indexSimbadRow`,
                                  `simbadHipKey`) both SIMBAD pulls share.
  size-lineage-pure.ts (+ test)   The physical radius as a lineage stage:
                                  its codes, the Size each shipped walked
                                  record hands on, and its one serialiser
                                  (#size-lineage).
```

## The resolver

`resolveSpectralInfo` in `spectral-resolve.ts` resolves each star's
`SpectralInfo` ([the variant](/src/catalog-format/spectral/README.md#spectralinfo-is-a-variant))
via a seven-tier priority chain:

0. **Curated HIP → sp_type override** (`data/simbad/sptype_overrides.tsv`,
   declared as `SPTYPE_OVERRIDES`) — saturated stars whose SIMBAD entry is a
   component-lettered main_id carrying neither hip nor source_id, so both
   machine tiers below miss (Castor: '* alf Gem A' A1.5IV+, curated as
   [Gray 2003](/data/papers/index.md#gray2003)'s A1.5 IV+). Mirrors the binaries pipeline's
   `component_sptype_overrides.tsv` curated tier. Each type is classified
   where it is read (`curatedSpectralValue`), so one that does not classify
   fails the read and the tier never refuses. A curated record's own type
   (Sol's G2V, [Curated records](../record/README.md#curated-records))
   outranks a HIP-keyed one.
1. **SIMBAD `sp_type` by Gaia source_id** (`data/simbad/simbad_sptype.tsv`
   from `refresh:simbad-sptype`, `scripts/refresh/simbad-sptype/`). SIMBAD canonicalises
   sp_type to Morgan-Keenan only — variability annotations live in `otype`,
   never in sp_type — so the parser (`classifyFromSimbad`, `/src/catalog-format/spectral/spectral-classify.ts`) is a strict MK
   walker covering plain MK (`G2V`, `K0III`, `M1.5Iab-b`), white dwarfs
   (`DA`, `DB2`, `DAH`), subdwarfs (`sdB5`), carbon / Wolf-Rayet (`C5,2e`,
   `WN5`), and Am/Ap composites (`kA5hA8mF1(III)SiEuBa` → metallic-line
   type wins).
2. **SIMBAD `sp_type` by HIP** — the same TSV also carries the
   Gaia-saturated bright stars (Algol, Alsephina, Betelgeuse, Rigel, Vega,
   Arcturus, ~700 others) whose SIMBAD row has a valid MK type but **no
   Gaia source_id**, so tier 1's source_id key misses them. Without it the
   radius chain runs the cool unknown-Teff fallback against a bright absmag
   and inflates R ~4× (Algol 12.47 → 3.2 R☉; Alsephina 12.0 → 4.0).
   SIMBAD's full MK is preferred over the ESP-ELS letter-only enum, so this
   tier sits above the ESP-ELS tier.

   It also carries the population tier 1 reaches and cannot answer: a
   source_id that resolves onto a component-lettered object with no
   `sp_type`, beside the star's own HD/HIP-keyed object that has one. The
   pull unions the namespaces a record reaches so BOTH objects ship
   ([The union asks every namespace a record reaches](/scripts/refresh/simbad/README.md#the-union-asks-every-namespace-a-record-reaches))
   — under different keys, so no key ends up carrying two
   rows (same README, [The union adds rows, never a second row under one
   key](/scripts/refresh/simbad/README.md#the-union-adds-rows-never-a-second-row-under-one-key)). The walk passes over the typeless one on its own: `accept` returns
   null and the ladder keeps going.
3. **SIMBAD `sp_type` by GJ**, folded through `normaliseGjKey`
   (`../simbad/simbad-namespace-ladder-pure.ts`) so `Gl 165A` / `GJ 165A` / `165 A` meet as one
   key. Above TYC per [The ladder is ordered by what an identifier names](#the-ladder-is-ordered-by-what-an-identifier-names).
4. **SIMBAD `sp_type` by TYC** — the only namespace that reaches an object
   SIMBAD holds no Gaia id and no HIP for, which is exactly the population
   the values pull's widening ladder exists for; same ladder
   `lookupSimbadValues` walks (`../simbad-values-parse.ts`). What reaches
   the file is already adjudicated — every designation-only binding, the
   widening's and the union's alike, is vetoed where SIMBAD's own Gaia
   cross-IDs contradict the asking id
   ([The corroboration rule](/scripts/refresh/simbad/README.md#the-corroboration-rule)) — so the
   risk this tier carries is a system-blend spectral type on an unvetoed
   pair, never a wrong star.

   **Which namespace found each SIMBAD-tier row is the authority on what
   each tier wins**, pinned as `spectralSimbadBySourceId` / `ByHip` /
   `ByTyc` / `ByGj` in `../build-catalog-expected.json` and summing to
   `spectralBySimbad` — so a tier that stops firing shows up as its own
   count rather than as noise inside a <!-- count:build-catalog/spectralBySimbad k2 -->460k<!-- /count --> total. Read the per-tier figures
   there rather than restating them here, which is how the ones this section
   used to carry went stale.
5. **Gaia DR3 ESP-ELS `spectraltype_esphs`** ([Creevey 2023](/data/papers/index.md#creevey2023); a column on
   `data/gaia/gaia_dr3_apsis.tsv`, keyed by source_id). Letter-only enum;
   `classifyFromGspspec` (same module) maps each letter to an `mk` class
   stating no subclass and no luminosity class (CSTAR to `carbon`).
6. **`none`** — no upstream covers the row, and the walk renders it as
   `SPECTRAL_UNKNOWN`, the `unknown` kind.

`resolveSpectralInfo` returns the shared cascade shape
(`CascadeResult`, `../cascade-result.ts`) over `SPECTRAL_VIA_VALUES` —
`curated`, `simbad` (with the namespace that found it), `gspspec`, `none` — the
tuple the walk tallies `spectralBy*` over. A typed SIMBAD or ESP-ELS row it
reaches and does not take is a refusal on the result:
`gaia_id_contradicts` ([below](#a-stated-gaia-id-the-record-contradicts-ends-the-walk))
or `unclassifiable`, a SIMBAD one naming the namespace that reached it. Answer
and refusal cite their row: a SIMBAD row by its `simbad_oid`, an override by
its HIP, an ESP-ELS type by its Apsis row; a curated record's own type cites
none.

AT-HYG's contaminated `spect` cell is no longer consulted for
classification (build-counts over the walked records: SIMBAD
**<!-- count:build-catalog/spectralBySimbad -->464,424<!-- /count -->** / ESP-ELS **<!-- count:build-catalog/spectralByGspspec -->494,467<!-- /count -->** / `none` **<!-- count:build-catalog/spectralFallback -->6,065<!-- /count -->**); it is still used as a
last-resort hover-display fallback when both upstream sources are blank.

The class it resolves feeds the radius chain:
[The radius chain](/src/catalog-format/spectral/README.md#the-radius-chain).

### A stated Gaia id the record contradicts ends the walk

`matchSimbadRow` refuses a row whose `source_id` cell is non-empty and is
NOT the record's own, and the walk continues to the next namespace. That is
SIMBAD stating the two are separate stars, so a type crossing between them
would render this record at another star's size.

It is the read-side half of the pull's corroboration rule, and it is not
redundant with it. The pull vetoes the binding, which keeps the object out
of the file **unless something else pulled it** — another record's own
source_id will do. One record was in exactly that position when the rule
landed, and only this gate closes it.

Coarser than the pull's check on purpose, and only ever a backstop: the
shipped `source_id` column is single-valued (`fetch_ident_lookups` keeps the
last id in table order), where `corroborate` reads every id under every Gaia
release. So this gate can see a disagreement the pull judged harmless, never
the reverse. Three populations it must NOT refuse, all pinned in the test:
a row stating no Gaia id at all (the tier-2 population proper — Algol, Vega,
~700 more), a record carrying no Gaia id of its own, and the source_id tier,
where the two ids are equal by construction.

`../simbad-values-parse.ts` walks the same ladder and has no such gate,
because every row in `simbad_values.tsv` was adjudicated at its own pull —
that cohort has no un-corroborated tier for a gate to catch.

### The ladder is ordered by what an identifier names

`SIMBAD_NAMESPACE_VALUES` walks **source_id → HIP → GJ → TYC**: prefer the
identifier naming the component (tier 3) over the one naming the system (tier
4), so a system blend can never displace a component value. Block size (TYC
317,487 keys against GJ's 3,727) is a throughput argument, not an argument
about which value is right. Both joins share this walk, so the spectral
resolver and the values cascade move together — the point, not a side effect.

**This order is load-bearing on 14 records, and only became so with the
union.** Re-measured 2026-09-16 against the committed `simbad_sptype.tsv`:
**1,576** records reach a typed row under BOTH their GJ and their TYC, and on
**14** of them the two strings differ. Before the union the same measurement
read 5 reachable and 0 differing — every one of the 5 resolved to the
*identical* row under both keys, so the order decided nothing and was kept as
policy rather than for effect. The union asks every namespace a record
reaches, so both rows now genuinely exist for a large population, and on the
14 the component-naming identifier is what stops a system blend displacing a
component type.

Re-derive it with:

```bash
python3 - <<'EOF'
import csv, re
def gj(c):
    t = (c or '').strip()
    if not t: return None
    p = t.split(' ')
    s = ' '.join(p[1:]) if re.fullmatch(r'(gj|gl)', p[0], re.I) else t
    k = re.sub(r'\s+', '', s).upper()
    return (k[:-2] if k.endswith('.0') else k) or None
byGj, byTyc = {}, {}
with open('data/simbad/simbad_sptype.tsv', newline='') as f:
    for r in csv.DictReader(f, delimiter='\t'):
        sp = (r['sp_type'] or '').strip()
        if gj(r['gj']): byGj[gj(r['gj'])] = sp
        if r['tyc'].strip(): byTyc[r['tyc'].strip()] = sp
both = differ = 0
with open('data/membership/membership-manifest.tsv', newline='') as f:
    for r in csv.DictReader(f, delimiter='\t'):
        a, b = byGj.get(gj(r['gl'])), byTyc.get(r['tyc'].strip())
        if a and b:
            both += 1
            differ += a != b
print(both, 'reach both;', differ, 'differ')
EOF
```

**The pull's own order still decides something else: which rung spends the
request.** `membershipKeys` (`scripts/refresh/simbad/membership-keys-pure.ts`) is a
strict fall-through down `WIDENING_LADDER` — HIP, then TYC, then GJ — so a no-Gaia row carrying
**both** ids is requested by TYC alone and its GJ is never asked for; no
record-side reorder can reach a row the pull did not fetch. Of the 54 spine
rows with neither source_id nor HIP, 41 go by TYC and 5 of those also carry a
GJ (TYC 3694-2544-1 / Gl 92.1 · 1269-128-1 / GJ 3281 · 2409-737-1 / GJ 3363 ·
2488-121-1 / GJ 3516 · 1043-1399-1 / Gl 734A), reachable by GJ only because
the TYC-keyed request returned an object carrying a GJ cross-id.

## Size lineage

`build:catalog`'s record walk writes the size stage of the
[lineage](../lineage/README.md) contract (`size-lineage-pure.ts`), after
brightness-colour. `readStars` hands on one `Size` per shipped record, keyed
on its origin key: the `RadiusResolution` the radius pass returned
([The radius chain](/src/catalog-format/spectral/README.md#the-radius-chain)),
the record's Apsis row with the Teff resolution read from it, and the source
rows its spectral class rests on. `sizeLineageRows` serialises it through an
exhaustive `switch`:

- one outcome row per record, its code the route — `size.class-teff`,
  `size.apsis-teff`, `size.white-dwarf` or `size.non-finite-luminosity`;
- a Stefan–Boltzmann row carries the de-extincted `absmag` it used, to
  `ABSMAG_PARAM_DECIMALS` places, `class_index` (`stated`, `default` where
  the tables read `DEFAULT_SUBCLASS`, `unknown-class`), `clamp` where a bound
  clamped it, and on the Apsis route the `solution` (gspphot or gspspec);
- a `refused` row per Apsis solution outside the sanity window, and one where
  a white dwarf's or Wolf-Rayet's own treatment overrides the Teff, each
  naming its `solution` and citing the Apsis row;
- the outcome cites the class's source rows, and the Apsis row on that route.

A parked row writes nothing here: it never reached a radius. The stage founds
no record, writes no identity rows, and every code's effect is `none`. It
describes the walk's radius only: coherence rescales a snapped member's,
promotion re-derives some walked records' and sizes every minted companion
(`stellata-hhaw.45.32.5.10`).

Measured 2026-11-11 on the full tree: 964,982 rows (152 MB plain), 24.2 MB
gzipped in 1.3 s without a diff — 863,562 `apsis-teff`, 101,117 `class-teff`,
279 `white-dwarf`, 24 refusals, 692 clamped. Nearly every row cites its Apsis
row's Gaia id and carries its own absmag, which is what the gzip cannot
shrink. `SIZE_LINEAGE_BUDGET` pins 26.7 MB and 30 s; CI has not timed it yet.
Its lines spill to a `LineSpill` during the walk like brightness-colour's
([Storage and cost](../lineage/README.md#storage-and-cost)): `build:catalog`
peaked at 3,335 MiB against its 3,482 MiB budget
([CI heap budget](../../util/heap-budget/README.md)).

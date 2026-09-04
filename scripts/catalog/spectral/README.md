# Spectral classification and physical radius

Morgan-Keenan spectral parsing, the seven-tier resolver over SIMBAD's
`sp_type`, and the Stefan-Boltzmann chain that turns a class plus an absolute
magnitude into a rendered radius. Extracted from `../catalog-pure.ts`, which
keeps the SIMBAD namespace ladder this folder joins through.

## Files in this area

```
scripts/catalog/spectral/
  spectral-classify.ts (+ test)   The MK walker over SIMBAD `sp_type`, the
                                  GSP-Spec letter enum, the `SpectralInfo`
                                  shape both produce, and the hover-display
                                  string. No catalogue joins — pure parsing.
  spectral-resolve.ts (+ test)    The seven-tier resolver and the SIMBAD
                                  sp_type index it walks. The one file here
                                  that reaches back to `../catalog-pure.ts`,
                                  for the namespace ladder
                                  (`walkSimbadNamespaces`, `indexSimbadRow`,
                                  `simbadHipKey`) both SIMBAD pulls share.
  physical-radius.ts (+ test)     Effective temperature and bolometric
                                  correction by class, the Apsis Teff sanity
                                  window, `physicalRadius`, and the
                                  absolute-magnitude inverse used to impute a
                                  companion's class.
```

**Why this is not in `../catalog-pure.ts`.** It was, and the folder README
documenting it was `../parse/README.md` — neither the code's home nor its
caller's. The topic is self-contained (nine files import it, one of them a
runtime module), it is the largest single subject in a 2.4k-line module, and a
session asking "why is this star that size" is better served landing here.

**The one direction of the dependency that matters:** this folder imports from
`../catalog-pure.ts`, never the reverse. `catalog-pure.ts` no longer references
a spectral symbol at all, so the seam is one-way and a cycle cannot form.

## The resolver and the radius chain

`resolveSpectralInfo` in `spectral-resolve.ts` resolves
`{ classIdx, subclass, lumClass, isWhiteDwarf }` per star via a seven-tier
priority chain:

0. **Curated HIP → sp_type override** (`CURATED_SPTYPE_BY_HIP`) —
   saturated stars whose SIMBAD entry is a component-lettered main_id
   carrying neither hip nor source_id, so both machine tiers below miss
   (Castor: '* alf Gem A' A1.5IV). Mirrors the binaries pipeline's
   `component_sptype_overrides.tsv` curated tier. Sol takes the same
   curated route via a proper-name special case in `stars-parse.ts`.
1. **SIMBAD `sp_type` by Gaia source_id** (`data/simbad/simbad_sptype.tsv`
   from `scripts/refresh/refresh-simbad-sptype.py`). SIMBAD canonicalises
   sp_type to Morgan-Keenan only — variability annotations live in `otype`,
   never in sp_type — so the parser (`classifyFromSimbad`) is a strict MK
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
   SIMBAD's full MK is preferred over GSP-Spec's letter-only enum, so this
   tier sits above GSP-Spec.

   It also carries the population tier 1 reaches and cannot answer: a
   source_id that resolves onto a component-lettered object with no
   `sp_type`, beside the star's own HD/HIP-keyed object that has one. The
   pull unions the namespaces a record reaches so BOTH objects ship
   (`scripts/refresh/simbad/README.md` § The union asks every namespace a
   record reaches) — under different keys, so no key ends up carrying two
   rows (same README, § The union adds rows, never a second row under one
   key). The walk passes over the typeless one on its own: `accept` returns
   null and the ladder keeps going.
3. **SIMBAD `sp_type` by GJ**, folded through `normaliseGjKey`
   (`../catalog-pure.ts`) so `Gl 165A` / `GJ 165A` / `165 A` meet as one
   key. Above TYC per § The ladder is ordered by what an identifier names.
4. **SIMBAD `sp_type` by TYC** — the only namespace that reaches an object
   SIMBAD holds no Gaia id and no HIP for, which is exactly the population
   the values pull's widening ladder exists for; same ladder
   `lookupSimbadValues` walks (`../simbad-values-parse.ts`). What reaches
   the file is already adjudicated — every designation-only binding, the
   widening's and the union's alike, is vetoed where SIMBAD's own Gaia
   cross-IDs contradict the asking id
   (`scripts/refresh/simbad/README.md` § The corroboration rule) — so the
   risk this tier carries is a system-blend spectral type on an unvetoed
   pair, never a wrong star.

   **Which namespace found each SIMBAD-tier row is the authority on what
   each tier wins**, pinned as `spectralSimbadBySourceId` / `ByHip` /
   `ByTyc` / `ByGj` in `../build-catalog-expected.json` and summing to
   `spectralBySimbad` — so a tier that stops firing shows up as its own
   count rather than as noise inside a 280k total. Read the per-tier figures
   there rather than restating them here, which is how the ones this section
   used to carry went stale.
5. **Gaia DR3 GSP-Spec `spectraltype_esphs`** (a column on
   `data/gaia/gaia_dr3_apsis.tsv`, keyed by source_id). Letter-only enum;
   `classifyFromGspspec` maps each letter to its `classIdx` with neutral
   subclass=5 / lumClass=255.
6. **`SPECTRAL_UNKNOWN` fallback** — `classIdx=UNKNOWN_CLASS_IDX` (8) /
   `lumClass=255` for rows no upstream covers.

AT-HYG's contaminated `spect` cell is no longer consulted for
classification (build-counts: ~89.5% SIMBAD / ~10.1% GSP-Spec / ~0.3%
fallback against the v3.3 classic-IDs subset); it is still used as a
last-resort hover-display fallback when both upstream sources are blank.

`physicalRadius` then computes R/R☉ via Stefan–Boltzmann:

```
T       = Apsis Teff (gspphot → gspspec) when measured, else
          interp(T_TABLE[classIdx], subclass)
BC      = interp(BC_TABLE[classIdx], subclass)
Mbol    = absmag + BC
L/L☉    = 10^((4.74 − Mbol) / 2.5)
R/R☉    = sqrt(L/L☉) × (T_sun/T)²
```

`resolveApsisTeff` supplies the measured Teff (2–60 kK sanity window);
R ∝ T⁻², so the class-table fallback misized GSP-Spec-tier stars
(letter-only, subclass defaulted to 5) by up to ~36% and unknown-class
stars by up to ~2×. Tables are main-sequence values — cooler for
giants/supergiants in reality — but the Mbol side of the equation
absorbs the luminosity-class difference, so the end result lands close
to published radii (`docs/science-stellar-modelling.md` § Physical radius carries the current
per-star numbers; `known-stars.test.ts` pins them end-to-end via the
corpus `primary_radius_rsun` / `primary_ci` columns). Clamped to
`[0.08, 2500]` so pathological catalog rows don't produce absurd
sizes. White dwarfs are special-cased to 0.013 R☉ (typical WD radius;
absmag doesn't translate reliably for them); Wolf-Rayets ride their
own Teff/BC ramps and ignore Apsis.

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

**This order is load-bearing on 11 records, and only became so with the
union.** Re-measured 2026-09-02 against the committed `simbad_sptype.tsv`:
**1,497** records reach a typed row under BOTH their GJ and their TYC, and on
**11** of them the two strings differ. Before the union the same measurement
read 5 reachable and 0 differing — every one of the 5 resolved to the
*identical* row under both keys, so the order decided nothing and was kept as
policy rather than for effect. The union asks every namespace a record
reaches, so both rows now genuinely exist for a large population, and on the
11 the component-naming identifier is what stops a system blend displacing a
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
with open('data/athyg/inherited-spine.tsv', newline='') as f:
    for r in csv.DictReader(f, delimiter='\t'):
        a, b = byGj.get(gj(r['gl'])), byTyc.get(r['tyc'].strip())
        if a and b:
            both += 1
            differ += a != b
print(both, 'reach both;', differ, 'differ')
EOF
```

**The pull's own order still decides something else: which rung spends the
request.** `spine_request_keys` (`scripts/refresh/simbad/inputs.py`) is a
strict fall-through — `elif tyc … elif gl` — so a no-Gaia row carrying
**both** ids is requested by TYC alone and its GJ is never asked for; no
record-side reorder can reach a row the pull did not fetch. Of the 54 spine
rows with neither source_id nor HIP, 41 go by TYC and 5 of those also carry a
GJ (TYC 3694-2544-1 / Gl 92.1 · 1269-128-1 / GJ 3281 · 2409-737-1 / GJ 3363 ·
2488-121-1 / GJ 3516 · 1043-1399-1 / Gl 734A), reachable by GJ only because
the TYC-keyed request returned an object carrying a GJ cross-id.

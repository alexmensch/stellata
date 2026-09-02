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
   record reaches), which means one HIP or TYC now legitimately keys two
   rows. `parseSimbadSptypeTsv` indexes every row under every namespace it
   carries and **keeps whichever row states a type**, throwing only where
   both do — an ambiguity the union cannot produce and curation has to
   settle. The walk itself already passes over a typeless row: `accept`
   returns null and the ladder keeps going.
3. **SIMBAD `sp_type` by GJ**, folded through `normaliseGjKey`
   (`../catalog-pure.ts`) so `Gl 165A` / `GJ 165A` / `165 A` meet as one
   key. Above TYC per § The ladder is ordered by what an identifier names.
   Wins **18** — the 13 records TYC cannot reach, plus the 5 both reach.
4. **SIMBAD `sp_type` by TYC** — the only namespace that reaches an object
   SIMBAD holds no Gaia id and no HIP for, which is exactly the population
   the values pull's widening ladder exists for; same ladder
   `lookupSimbadValues` walks (`../simbad-values-parse.ts`). What reaches
   the file is already adjudicated — the pull vetoes a widened binding
   SIMBAD's own Gaia cross-IDs contradict
   (`scripts/refresh/simbad/README.md` § The widening carries its own
   corroboration rule) — so the risk this tier carries is a system-blend
   spectral type on an unvetoed pair, never a wrong star. Wins **1,935**
   records.

   Which namespace found each SIMBAD-tier row is pinned as
   `spectralSimbadBySourceId` / `ByHip` / `ByTyc` / `ByGj`, summing to
   `spectralBySimbad` — so a tier that stops firing shows up as its own
   count rather than as noise inside a 280k total.
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

### The ladder is ordered by what an identifier names

`SIMBAD_NAMESPACE_VALUES` walks **source_id → HIP → GJ → TYC**: prefer the
identifier naming the component (tier 3) over the one naming the system (tier
4), so a system blend can never displace a component value. Block size (TYC
317,487 keys against GJ's 3,727) is a throughput argument, not an argument
about which value is right. Both joins share this walk, so the spectral
resolver and the values cascade move together — the point, not a side effect.

**No record's value changes, on either join** (measured 2026-08-28 against the
committed `simbad_sptype.tsv` / `simbad_values.tsv`). Under the old order the
`sp_type` join's TYC tier won 1,940 records, 5 of them also reachable by GJ,
with **0** where the two strings differ; the values join won 121, 5 also
reachable, **0** differing because all 5 resolve to the *identical* row under
both keys — SIMBAD itself says the TYC and the GJ name one object.

**Two build counts still move — the credit, not the value.**
`spectralSimbadByTyc` 1,940 → **1,935**, `spectralSimbadByGj` 13 → **18**: the
same 5 records, re-credited, resolving the same type. `spectralBySimbad` holds
at 280,495 and the other 183 counts are untouched; a delta past this ±5, or any
movement downstream, means the measurement above has gone stale.

**The load-bearing order is the pull's, not this one.** `spine_request_keys`
(`scripts/refresh/simbad/inputs.py`) is a strict fall-through — `elif tyc …
elif gl` — so a no-Gaia row carrying **both** ids is requested by TYC alone and
its GJ is never asked for; no record-side reorder can reach a row the pull did
not fetch. Of the 54 spine rows with neither source_id nor HIP, 41 go by TYC and
5 of those also carry a GJ (TYC 3694-2544-1 / Gl 92.1 · 1269-128-1 / GJ 3281 ·
2409-737-1 / GJ 3363 · 2488-121-1 / GJ 3516 · 1043-1399-1 / Gl 734A) — the same
5 as above, reachable by GJ only because the TYC-keyed request returned an
object carrying a GJ cross-id.

So this order was correct-by-policy and cheap insurance for the day two
distinct rows exist — which the union has since made the ordinary case. The
pull now asks every namespace a record reaches wherever no object it bound
carries a type, so both rows exist and this order is what chooses between
them: the component-naming identifier wins, and a system blend cannot
displace a component value. What the pull's own order still decides is
which rung spends the request, not which value a record takes.

# Stage 4 — orbital elements, in TypeScript

The TypeScript Stage 4 of the binaries pipeline: one orbit per
`DecomposedPair` Stage 3 returned (`../astrometry/`), from ORB6, Gaia DR3 NSS
or the MSC, keyed by its pair. The NSS conversion here is also what Stage 3's
NSS inner-pair synthesis gates on; `../build-binaries.ts` calls it. What each
route's gate decides, what each NSS solution type constrains, the
Thiele-Innes algebra and why the photocentre's a0 is never the relative orbit's
a: [What each route decides](#what-each-route-decides).

## Files in this area

```
scripts/binaries/orbits/
  nss-elements-pure.ts (+ test)  OrbitElements; thieleInnesToCampbell;
                                 nssToCanonicalElements; nssInRegime, the
                                 detectability regime (P < 3 yr or a0 < 1″).
  nss-fixture.ts                 Test-only: tiFromCampbell (the forward
                                 transform) and NSS row builders.
  catalog-elements-pure.ts       ORB6 and MSC rows as OrbitElements (the
    (+ test)                     unit codes, the T0 readings), and
                                 pickBestOrb6 / pickBestMsc among one
                                 pair's rows.
  select-orbit-pure.ts (+ test)  PairOrbit; selectOrbit, the cascade for
                                 one pair; nssSeparationConsistent and
                                 keplerSemimajorAxisAu.
  attach-orbits.ts (+ test)      attachStage4 (every pair's candidates,
                                 then selectOrbit), Stage4Result,
                                 orbitTally, stage4Counts, stage4Rates.
  stage4-report-pure.ts          The build-log line, read off the result.
```

## The shape of a result

`PairOrbit` is `none`, carrying nothing, or a route of `OrbitViaOnFile` with
its `OrbitElements` — a route with elements never coexists with a null
orbit. The routes, their order and what each carries (`hasElements`, the
legacy `regime`, whether Stage 6 estimates its missing q / ω / a) are one
table in the codec, `ORBIT_VIA_PROPERTIES` (`../multiples-tsv.ts`);
`selectOrbit` walks `ORBIT_VIA_ON_FILE` in that order with one route function
per member, the first to return elements winning. A route whose best row
converts to nothing (an unreadable period) falls through to the next.

`attachStage4` gathers each pair's candidates: its ORB6 rows by (WDS id,
components field), its MSC rows by its tokens with the secondary's WDS
truncation re-anchored (`canonicalCompLetter`), and its system's parallax
([System anchors](../astrometry/README.md#system-anchors)), which the NSS
separation gate reads when neither side measured one. An emitted periastron
epoch outside the plausible window (`../epochs-pure.ts`'s `isPlausibleT0Jd`,
1700–2600) throws in `selectOrbit`. The year and MSC readings refuse one, but
ORB6's `d` / `m` epochs and NSS's `t_periastron` are taken as stated, so a
refresh carrying one outside the window stops the build at Stage 4.

## Counts

`stage4Counts` returns the `orbit_*` keys, one per route, folded through the
one tally helper; `stage4Rates` derives `nss_orbit_rate`, the NSS share of
the pairs with elements, through the tally module's `share`, which throws
when no pair has any; `stage4Report` logs it. The keys are held to the
committed count snapshot, as Stage 3's are
([Counts](../astrometry/README.md#counts)).

## Conventions the outputs rest on

- **Ω is folded into 0 ≤ Ω < π**, ω turned by π with it: the algebra cannot tell
  the ascending node from the descending one, and the fold picks one
  orientation. ω then wraps into 0 ≤ ω < 2π with the divisor's sign (`floorMod`).
- **`t_periastron` counts days from J2016.0**, `GAIA_DR3_REF_EPOCH_JD`,
  derived from `../../catalog/distance/`'s `GAIA_DR3_REF_EPOCH`.
- **`aAu` is always null** for an NSS solution: Stage 6 estimates it from
  Kepler's third law.
- **A solution type the table does not name converts to null**, and a row
  stating neither a period nor a Thiele-Innes quartet is outside the regime.
- **Ties**: among one grade band, the most recent ref year and then the
  first row; among MSC rows, the most complete and then the last.

## What each route decides

Picks the most-trustworthy set of orbital elements per pair, then
converts to a canonical (P, T, e, a, i, ω, Ω, q, distance) tuple. Routes
in `ORBIT_VIA`, in priority order:

| Route | When |
| --- | --- |
| `orb6` | ORB6 visual orbit with grade ∈ {1, 2, 3, 4, 5} (definitive → indeterminate). Best grade wins; ref-year secondary tiebreak. ORB6's `a` is the genuine relative A–B orbit, so this route outranks `gaia_nss`, where no solution type yields a relative semi-major axis (see the photocentre note below — Stage 6 estimates one for the non-visual routes). |
| `gaia_nss` | A component has an `nss_two_body_orbit` row, its pair partner is NOT a different resolved source (a distinct-source partner means the orbit is interior to the carrying component — Stage 3 re-homes it on a synthesized inner pair), the orbit is in Gaia's astrometric-detectability regime: `period < 3 yr` (`NSS_PERIOD_THRESHOLD_DAYS = 1095.75`) OR apparent photocentre semi-major axis `a0 < 1″` (`NSS_SEPARATION_THRESHOLD_MAS = 1000`), AND the pair's WDS separation isn't far too wide to be that orbit (`nssSeparationConsistent`). 95.8% of DR3 NSS rows pass the period gate; the few longer-period rows are picked up by the sub-arcsec branch. |
| `orb6_spectroscopic` | ORB6 grade ∈ {7, 8, 9} — non-visual fits: 8 = interferometric-visibilities-only, 9 = astrometric / spectroscopic per orb6text.html; grade 7 is undocumented there but the file's grade-7 rows are photometric / eclipsing orbits (YY Gem, EQ Tau, BX And) with real fitted elements. |
| `msc` | MSC compiled orbit, **sub-resolution pairs only** (WDS ρ = 0 or unmeasured). MSC compiles from the same primary sources the routes above curate, so it ranks below all of them; the sub-resolution gate keeps measured WDS placements from acquiring a compiled orbit that would widen the baked-vs-R(epoch) ratchet in `/tests/integration/multi-star-regression.test.ts`, and makes the route safe for Stage 6's Kepler a-estimation (an estimate can only add motion). The spectroscopic-subsystem rows the route exists for (AR Cas Aa,Ab, ν Sco Aa1,Aa2) live on Stage 1-synthesized pairs, ρ = 0 by construction. MSC `t0` is a Besselian year when the period unit is years and JD−2400000 when it is days (Tokovinin 2018, /data/papers/index.md#tokovinin2018); `mscT0Jd` disambiguates by magnitude instead of reading the period unit, same window validation as `orb6T0Jd`. Maps to `regime` 3. |
| `none` | Visual-only pair with no orbital information on file. |

An NSS orbit is keyed to a Gaia **source**, not a WDS pair, so it can
leak onto the wrong pair when a saturated / blended primary shares its
source across several visual companions. The distinct-source gate stops
the leak only when the partner is a *different* resolved source; a
partner that shares the blended source or resolved to nothing slips
through. `nssSeparationConsistent` is the backstop: it projects the
pair's WDS ρ to AU at the system distance and rejects the orbit when that
exceeds `NSS_SEPARATION_SANITY_RATIO` × a Kepler upper-bound relative
semi-major axis (at `NSS_MAX_SYSTEM_MASS_MSUN`) for the NSS period — a
bound orbit's projected separation can't outrun its apastron. Sub-
resolution / synthesized inner pairs carry ρ = 0 and are exempt (the
orbit's true home). Canonical failure: υ⁴ Eri, where the 0.97-day inner
orbit was attaching to the 5.5″ and 49″ visual companions.

The Thiele-Innes → Campbell algebra for NSS TI-derived solution types
(`Orbital`, `OrbitalAlternative*`, `OrbitalTargetedSearch*`,
`AstroSpectroSB1`) is inlined in `thieleInnesToCampbell`
([Heintz 1978](/data/papers/index.md#heintz1978) / [Halbwachs 2023](/data/papers/index.md#halbwachs2023)
Appendix A). The ESA NSSTools package isn't a dependency — the closed form is ~10 lines and NSSTools has been
unmaintained since 2022.

The TI constants describe the **photocentre's** orbit around the
system barycentre, not the relative A–B orbit ([Halbwachs 2023](/data/papers/index.md#halbwachs2023)): the
recovered semi-major axis is `a0 = |q − β|·a_rel`, where
`q = M₂/(M₁+M₂)` is the secondary's mass fraction (the same q the
pipeline stores per pair) and `β = F₂/(F₁+F₂)` its flux fraction — so
a0 → 0 for near-equal-brightness pairs. Reconstructing `a_rel` needs a
mass ratio AND a flux ratio we don't reliably have per pair, so `a_AU`
is left `None` here; Stage 6's `orbitFields`
estimates it from Kepler's third law for the non-visual routes
([Stage 6](../multiples/README.md#what-each-column-carries)). The plane angles `i` /
`Ω` are shared between the photocentre and relative orbits and
populate as-is; `ω` is the photocentre's, which sits π away from the
secondary's relative-orbit ω whenever the primary carries most of the
flux.

Eclipsing solution types
(`EclipsingBinary`, `EclipsingSpectro`) read inclination and
arg_periastron directly from the catalogue columns; `a` and Ω are not
recoverable from eclipse photometry alone and remain `None`.
Spectroscopic solution types (`SB1`, `SB2`, `SB1C`, `SB2C`) populate
arg_periastron only when stored.

ORB6's `P_unit` column carries the period unit (`y` = year, `d` = day,
`c` = century, `h` = hour, `m` = minute). The `a_unit` column carries
arcseconds (`a`) or milliarcseconds (`m`, with `M` accepted as a known
typo). Unknown unit codes are skipped — Stage 4 prefers `None` over a
guessed conversion that would silently land on the wrong scale.

The periastron epoch `T0` needs the same care, with a twist. Per
`orb6format.txt` its `T0_unit` code is `d` = truncated JD (the file
stores JD − 2,400,000, **not** a full JD — Algol Aa1,Aa2 carries
`41771.353` = HJD 2441771.353), `m` = MJD (JD − 2,400,000.5), or `y` =
fractional Besselian year. <a id="year-form-epochs"></a>**A year-form epoch — ORB6's `y` and
the MSC's year-valued `t0` — is read on the Julian formula**
(J2000 + (y − 2000) × 365.25 d, `jdOfJulianYear`), not the Besselian one
(`besselianEpochToJd`): −0.31 d at 1900, +0.47 d at 2000, +0.70 d at
2030, a fixed phase offset of that fraction of the period at every date
on the clock. The twist: ORB6 mislabels ~50 truncated-JD
epochs with the `y` flag (e.g. WDS 04227+1503 Aa,Ab stores
`59501.496 y` for a 4-day pair), and the year formula throws those out
past JD 2e7. `orb6T0Jd` therefore validates a `y` conversion against
a physically-possible epoch window (years 1700–2600, read the same way) and
retries the truncated-JD reading when it falls outside; unrecoverable
rows (and the non-conforming `c` / blank flags) get a `None` epoch and
place statically at the WDS observation epoch. `selectOrbit`
asserts every emitted `T_jd` stays inside the window — and since the `d` /
`m` flags and NSS epochs are taken as stated, a refresh carrying one outside
it stops the build there. A wrong epoch
isn't visible in a rendered orbit — baseline cancellation at
`sep_pa_epoch_jd` hides it — but it shifts the pair's configuration at
any *other* date, so conjunction / eclipse timing (Algol's minima
included) would miss published ephemerides without this normalisation.

The mass-ratio `q` rides through this stage when present. Only Gaia NSS
`EclipsingSpectro` solutions publish `mass_ratio` (Gaia's M_S/M_P ratio,
converted here to the `q = M₂/(M₁+M₂)` fraction the rest of the pipeline
stores); everything else gets `q = None` here and falls through to Stage
6's spectral-class mass-ratio backfill below.

The same `q` also feeds **systemic-velocity composition** for
proper-motion propagation. catalog.bin bakes a per-star space-motion
velocity ([Current-epoch star positions](/docs/science-catalog-ingestion.md#current-epoch-star-positions--space-motion-propagation-to-t));
a bound pair's
members must share one systemic velocity or the runtime epoch-advance
shears a static (Tier-3) pair. `scripts/catalog/companions/companion-promotion.ts`
uses this `q` for the barycentric blend `v_sys = (1−q)·v_p + q·v_s` on a
lone renderable-orbit pair, and a promoted companion with no own PM
inherits its primary's velocity. **Full** systemic coherence for every
`binaries.bin` pair — keyed on the authoritative resolved pairing,
`planRecords` in `runtime-binaries-pure.ts` — is deferred to
`stellata-zau1`; v1 ships the promoted-companion + lone-pair subset.

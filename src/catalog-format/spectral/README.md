# Spectral classification and physical radius

Morgan-Keenan spectral parsing and the Stefan-Boltzmann chain that turns a
class plus an absolute magnitude into a rendered radius. The catalogue
build sizes every record with them and the viewer's focus card reads the
same chain, so one copy serves both. Which class a record gets — the
seven-tier SIMBAD resolver — is the build's:
[`/scripts/catalog/spectral/`](/scripts/catalog/spectral/README.md#the-resolver).

## Files in this area

```
src/catalog-format/spectral/
  spectral-classify.ts (+ test)   The MK walker over SIMBAD `sp_type`, the
                                  ESP-ELS letter enum, the `SpectralInfo`
                                  shape both produce, and the hover-display
                                  string. No catalogue joins — pure parsing.
  physical-radius.ts (+ test)     Effective temperature and bolometric
                                  correction by class, the Apsis Teff sanity
                                  window, `physicalRadius`, and the
                                  absolute-magnitude inverse used to impute a
                                  companion's class.
```

## The radius chain

`physicalRadius` computes R/R☉ via Stefan–Boltzmann:

```
T       = Apsis Teff (gspphot → gspspec) when measured, else
          interp(T_TABLE[classIdx], subclass)
BC      = interp(BC_TABLE[classIdx], subclass)
Mbol    = absmag + BC
L/L☉    = 10^((4.74 − Mbol) / 2.5)
R/R☉    = sqrt(L/L☉) × (T_sun/T)²
```

`resolveApsisTeff` supplies the measured Teff (2–60 kK sanity window);
R ∝ T⁻², so the class-table fallback misized ESP-ELS-tier stars
(letter-only, subclass defaulted to 5) by up to ~36% and unknown-class
stars by up to ~2×. Tables are main-sequence values — cooler for
giants/supergiants in reality — but the Mbol side of the equation
absorbs the luminosity-class difference, so the end result lands close
to published radii ([Physical radius](/docs/science-stellar-modelling.md#physical-radius) carries the current
per-star numbers; `known-stars.test.ts` pins them end-to-end via the
corpus `primary_radius_rsun` / `primary_ci` columns). Clamped to
`[0.08, 2500]` so pathological catalog rows don't produce absurd
sizes. White dwarfs are special-cased to 0.013 R☉ (typical WD radius;
absmag doesn't translate reliably for them); Wolf-Rayets ride their
own Teff/BC ramps and ignore Apsis.

### The absolute-magnitude tables

`absmagFromSpectral` reads `MV_MS_TABLE` / `MV_GIANT_TABLE`, credited to
[Cox 2000](/data/papers/index.md#cox2000) Sect. 15.3 (no copy held). The dwarf
row departs from the online table of [Mamajek 2022](/data/papers/index.md#mamajek2022):
of its anchors only M0V (8.80) agrees — A0V ships 0.65 against 0.99, B5V −1.2
against −0.85, M5V 12.3 against 14.15, M9V 16.0 against 19.40. Which source to
adopt is an open decision, `stellata-uadc.69.28`.


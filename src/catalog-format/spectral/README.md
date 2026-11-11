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
                                  variant both produce, and the hover-display
                                  string. No catalogue joins — pure parsing.
  spectral-record-bytes.ts        The record's spectClass / lumClass byte
    (+ test)                      pair: encode and decode. See below.
  physical-radius.ts (+ test)     Effective temperature and bolometric
                                  correction by class, the Apsis Teff sanity
                                  window, `physicalRadius`, and the
                                  absolute-magnitude inverse used to impute a
                                  companion's class.
```

## `SpectralInfo` is a variant

A class is one of `mk` (an O–M letter, a subclass, a luminosity class),
`carbon` (C/S/N/R), `wolf-rayet`, `white-dwarf` (its Sion temperature index;
a luminosity class of VII parses as one) or `unknown`. Every consumer matches on `kind`; nothing compares a class
number. **A subclass, index or luminosity class the source did not state is
`null`**, never a filled-in number: ESP-ELS's letter enum and a bare SIMBAD
`K` are the same `mk` with both null, and the radius and absolute-magnitude
tables read a null subclass at `DEFAULT_SUBCLASS` (5) at the moment they
look it up. `classifyFromSimbad` returns `MkSpectral`, which excludes
`unknown`, so a caller holding its result never handles an unknown class.

**The on-disk codes exist only in `spectral-record-bytes.ts`.** The record
packs a class into two bytes — spectClass 0–6 for O–M, 7 carbon (Wolf-Rayet
too), 8 none; lumClass 1–9, 255 none — and a white dwarf as `8 / 0`. The
build writes them once, where a `Star` becomes a record; companion promotion
decodes them back
([Reading a record's class back](/scripts/catalog/companions/README.md#reading-a-records-class-back));
the viewer's descriptor (`/src/client/format/spectral-format.ts`) reads the
same named codes. The bytes drop the subclass, the WD index and the
Wolf-Rayet kind, so a decode reads the first two back as not stated and a
Wolf-Rayet as carbon. **The decoder accepts exactly the 73 pairs the encoder
writes** and throws on any other, pinned over all 65,536 pairs.

## The radius chain

`physicalRadius` computes R/R☉ via Stefan–Boltzmann:

```
T       = Apsis Teff (gspphot → gspspec) when measured, else
          interp(T_TABLE[class], subclass)
BC      = interp(BC_TABLE[class], subclass)
Mbol    = absmag + BC
L/L☉    = 10^((4.74 − Mbol) / 2.5)
R/R☉    = sqrt(L/L☉) × (T_sun/T)²
```

`resolveApsisTeff` supplies the measured Teff (2–60 kK sanity window);
R ∝ T⁻², so the class-table fallback misized ESP-ELS-tier stars
(letter-only, no subclass stated) by up to ~36% and unknown-class
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


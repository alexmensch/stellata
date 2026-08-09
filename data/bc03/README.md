# BC03 — Bruzual & Charlot 2003 simple stellar populations

GALAXEV SSP model output. Three `.4color` tables carrying, per log-age,
the population's absolute B and V magnitudes and its stellar
mass-to-light ratios for 1 M⊙ formed.

## Provenance

| | |
|---|---|
| Source | Bruzual & Charlot 2003, MNRAS 344, 1000 (DOI 10.1046/j.1365-8711.2003.06897.x) |
| Distribution | `http://www.bruzual.org/bc03/Original_version_2003/bc03.models.padova_1994_chabrier_imf.tar.gz` |
| Retrieved | 2026-08-09 |
| Tracks | Padova 1994 + Charlot 1997 |
| IMF | Chabrier (lognormal 0.1–1 M⊙ + x = 1.3 power law to 100 M⊙) |
| Resolution | `hr` (high spectral resolution variant of the same SSP) |
| Photometry | Vega system |

Committed files, by the model's metallicity code:

| File | Z | ≈ [Fe/H] |
|---|---|---|
| `bc2003_hr_m52_chab_ssp.4color` | 0.008 | −0.4 |
| `bc2003_hr_m62_chab_ssp.4color` | 0.020 | 0.0 |
| `bc2003_hr_m72_chab_ssp.4color` | 0.050 | +0.4 |

The three bracket the Galactic bulge's metallicity distribution, which is
broad and centred near solar. `m62` is the one the shipped constants are
read from; the other two exist so the metallicity sensitivity quoted in
`src/client/milkyway/README.md` § Calibration is reproducible rather than
asserted.

## Schema

Whitespace-delimited, `#`-prefixed header block. Ten columns:

| # | Column | Meaning |
|---|---|---|
| 1 | `log-age-yr` | log₁₀ of the population age in years |
| 2 | `Mbol` | bolometric absolute magnitude |
| 3 | `Bmag` | absolute B magnitude |
| 4 | `Vmag` | absolute V magnitude |
| 5 | `M*/Lb` | stellar mass-to-light ratio in B, solar units |
| 6 | `M*/Lv` | stellar mass-to-light ratio in V, solar units |
| 7 | `M*` | surviving stellar mass — living stars **plus** remnants |
| 8 | `Mgas` | mass returned to the ISM |
| 9 | `Mgalaxy` | 1 by construction (columns 7 + 8) |
| 10 | `SFR/yr` | 0 for an SSP |

Magnitudes and `M*` are all per 1 M⊙ **formed**, so a colour taken as
`Bmag − Vmag` is normalisation-free and column 6 is directly Υ\*_V.

## Consumers

- `src/client/milkyway/diffuse-reference.ts` — Υ\*_V of the bulge
  population at 10 Gyr, solar Z, which converts the Galaxy's published
  stellar-mass B/T into the V-band **light** ratio the emissivity solve
  needs.
- `src/client/milkyway/milkyway.test.ts` — reads `m62` back and pins the
  constant against the file, so a hand-edited value fails.

## Refresh

There is deliberately **no `scripts/refresh/refresh-bc03.py`**. BC03 is a
2003 model release, frozen upstream — it is not a catalogue that grows.
Re-derive with two commands:

```bash
curl -O http://www.bruzual.org/bc03/Original_version_2003/bc03.models.padova_1994_chabrier_imf.tar.gz
tar xzf bc03.models.padova_1994_chabrier_imf.tar.gz --strip-components=4 \
  --include='*hr_m[567]2_chab_ssp.4color'
```

Reaching for a *different* IMF or track set is not a refresh — it changes
the Υ\*_V the solve rests on, so it belongs in a bead with the
recalibration it forces.

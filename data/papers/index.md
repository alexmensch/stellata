# Citation index

One entry per work the tree cites. A tree citation points at its entry by key
— [Esposito 2002](/data/papers/index.md#esposito2002) in markdown, the bare
`/data/papers/index.md#esposito2002` in a code comment — and carries no
journal or identifier of its own: the entry is the only place those live.
Rules, tests and file roles: [Cited papers](README.md#cited-papers).

Each entry opens with an explicit anchor, so its key stays fixed whatever the
heading says. **Copy** names the version of the private copy a page number was
read from ([What a page number means](README.md#version-decides-what-a-page-number-means)),
or why none is held. **Identification** appears only when the work is not
plainly identified: `book`, `ambiguous` (the tree's wording fits several works,
listed), `mismatch` (the work exists but does not carry the claim credited to
it) or `not_found`. A **Note** records what identification found beside that:
an erratum, a near-namesake, a value the abstract gives differently.

The claims table holds what the tree takes from the work: **Value** is the
value as the tree uses it, **Page** and **Passage** where the copy carries
it. **Status** is `verified` (the page carries that value, or defines the
method the tree credits it for), `disagrees` (the page carries the quantity
with a different value; the passage quotes the paper's), `not in paper` (the
work does not carry what the tree credits it for) or `unverified` (not
checked against a copy, usually because none is held). A `disagrees` or `not
in paper` row is a defect in the tree, open until the tree or its citation
changes.

## Entries

<a id="abdurrouf2022"></a>
### Abdurro'uf et al. 2022 — The Seventeenth Data Release of the Sloan Digital Sky Surveys: Complete Release of MaNGA, MaStar, and APOGEE-2 Data

ApJS 259, 35 (2022) · [doi:10.3847/1538-4365/ac4414](https://doi.org/10.3847/1538-4365/ac4414) · [arXiv:2112.02026](https://arxiv.org/abs/2112.02026) · [2022ApJS..259...35A](https://ui.adsabs.harvard.edu/abs/2022ApJS..259...35A)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| SDSS DR17 release paper (planned Tier-4 citation for the SDSS Main Galaxy Sample route) |  | verified | p. 1 | “THE SEVENTEENTH DATA RELEASE OF THE SLOAN DIGITAL SKY SURVEYS: COMPLETE RELEASE OF MANGA, MASTAR AND APOGEE-2 DATA” |

<a id="andrae2023"></a>
### Andrae et al. 2023 — Gaia Data Release 3

A&A 674, A27 · [doi:10.1051/0004-6361/202243462](https://doi.org/10.1051/0004-6361/202243462) · [arXiv:2206.06138](https://arxiv.org/abs/2206.06138)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| GSP-Phot fits BP/RP spectra + parallax, emits Teff/logg/[M/H]/A0 |  | verified | p. 2 (abstract); p. 3, Sect. 2.1 | “GSP-Phot uses a Bayesian forward-modelling approach to simultaneously fit the BP/RP spectrum, parallax, and apparent G magnitude.” |
| A0 reference wavelength | 547.7 nm | disagrees | p. 3, Sect. 2.1 | “the line-of-sight monochromatic extinction A0 at 541.4 nm, where A0 is the extinction parameter from the adopted Fitzpatrick extinction law” |

<a id="archinal2018"></a>
### Archinal et al. 2018 — Report of the IAU Working Group on Cartographic Coordinates and Rotational Elements: 2015

Celest Mech Dyn Astr 130:22 · [doi:10.1007/s10569-017-9805-5](https://doi.org/10.1007/s10569-017-9805-5)

- **Copy:** `publishedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Mercury-Neptune pole RA/Dec + rates and W0/Wdot (linear terms) | e.g. Mercury 281.0103 -0.0328T, 61.4155 -0.0049T, W 329.5988 + 6.1385108d; Venus 272.76/67.16/160.20 -1.4813688d; Jupiter 268.056595/64.495303/284.95 + 870.5360000d; Saturn 40.589/83.537/38.90 + 810.7939024d; Uranus 257.311/-15.175/203.81 -501.1600928d; Neptune 299.36/43.46/249.978 + 541.1397757d | verified | pp. 8-9, Table 1 | “Mercury α0 = 281.0103 − 0.0328 T” |
| Neptune periodic N term (pole nod and W) | RA 0.70 sin N, Dec -0.51 cos N, W -0.48 sin N, N = 357.85 + 52.316T | verified | p. 9, Table 1 | “W = 249.978 + 541.1397757d − 0.48 sin N” |
| Mars rotation elements, 71-kyr terms linearised at J2000 | 317.681106 -0.10859696T; 52.886346 -0.06158182T; W 176.631819 + 350.891982430062d | verified | p. 8, Table 1 | “W = 176.049863 + 350.891982443297d ... + 0.584542 sin(95.391654 + 0.5042615T )” |
| Pluto pole and prime meridian | 132.993, -6.163, W 302.695 + 56.3625225d | verified | p. 15, Table 3 | “(134340) Pluto α0 = 132◦.993 δ0 = − 6◦.163 W = 302◦.695 + 56◦.3625225d” |
| Earth linear rotation row | 0 -0.641T, 90 -0.557T, W 190.147 + 360.9856235d | not in paper | p. 9, footnote 2 | “Previous reports also included approximate expressions for the Earth. Their accuracy was poor” |
| Moon pole/W linear row and E1/E2 libration terms | 269.9949 +0.0031T, 66.5392 +0.0130T, W 38.3213 + 13.17635815d; E1 -3.8787/1.5419/3.561, E2 -0.1204/0.0239/0.1208 | not in paper | p. 14, Sect. 3 | “Previous reports included the rotation and pole position for the ME system using closed formulae in Table 2. We are not continuing” |
| 17 non-lunar major moons' linear pole/W terms (Galilean, Saturnian, Uranian, Triton) | e.g. Io 268.05 -0.009T, 64.50 +0.003T, W 200.39 + 203.4889538d; Titan 39.4827/83.4279/186.5855 + 22.5769768d; Iapetus 318.16 -3.949T, 75.03 -1.143T, 355.2 + 4.5379572d; Triton W 296.53 - 61.2572637d | verified | pp. 10-13, Table 2 | “II Europa α0 = 268.08 − 0.009T + 1.086 sin J4 + 0.060 sin J5” |
| Moon periodic terms kept (Europa J4, Ganymede J5, Callisto J6, Mimas S3/S5, Tethys S4/S5, Rhea S6, Triton N7 series) | e.g. Mimas 13.56/-1.53/-13.48 on S3 = 177.40 - 36505.5T, W -44.85 sin S5; Triton -32.35/22.55/22.25 ... on N7 = 177.85 + 52.316T | verified | pp. 11-14, Table 2 | “W = 333.46 + 381.9945550d − 13.48 sin S3 − 44.85 sin S5” |

<a id="arzoumanian2011"></a>
### Arzoumanian et al. 2011 — Characterizing interstellar filaments with Herschel in IC 5146

A&A 529, L6 (2011) · [doi:10.1051/0004-6361/201116596](https://doi.org/10.1051/0004-6361/201116596) · [arXiv:1103.0201](https://arxiv.org/abs/1103.0201) · [2011A&A...529L...6A](https://ui.adsabs.harvard.edu/abs/2011A%26A...529L...6A)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| 0.1 pc filament width | ~0.1 pc | verified | p. 1 (abstract) | “a narrow distribution of widths having a median value of 0.10 ± 0.03 pc” |

<a id="arzoumanian2019"></a>
### Arzoumanian et al. 2019 — Characterizing the properties of nearby molecular filaments observed with Herschel

A&A 621, A42 (2019) · [doi:10.1051/0004-6361/201832725](https://doi.org/10.1051/0004-6361/201832725) · [arXiv:1810.00721](https://arxiv.org/abs/1810.00721) · [2019A&A...621A..42A](https://ui.adsabs.harvard.edu/abs/2019A%26A...621A..42A)

- **Copy:** `acceptedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| 0.1 pc filament width | ~0.1 pc | verified | p. 1 (abstract) | “crest-averaged inner widths, with a median value of 0.10 pc and an interquartile range of 0.07 pc” |

<a id="bahcall1980"></a>
### Bahcall & Soneira 1980 — The universe at faint magnitudes. I - Models for the galaxy and the predicted star counts

ApJS 44, 73 (1980) · [doi:10.1086/190685](https://doi.org/10.1086/190685) · [1980ApJS...44...73B](https://ui.adsabs.harvard.edu/abs/1980ApJS...44...73B)

- **Copy:** `ADS scan of published article`
- **Note:** M_V=-20.5 not verified against text

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| older direct-integration Galaxy M_V | M_V = -20.5 | verified | p. 96, Table 4 | “Absolute Visual magnitude (no obscuration) -20.4 -18.4 -20.5” |

<a id="bailerjones2015"></a>
### Bailer-Jones 2015 — Estimating Distances from Parallaxes

PASP 127, 994-1009 (2015) · [doi:10.1086/683116](https://doi.org/10.1086/683116) · [arXiv:1507.02105](https://arxiv.org/abs/1507.02105) · [2015PASP..127..994B](https://ui.adsabs.harvard.edu/abs/2015PASP..127..994B)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| parallax-inversion bias at 1 < S/N < 5 (~20% fractional-error bound) | ~20% fractional parallax error (S/N 5) | verified | p. 1 (abstract) | “doing this is not trivial once the fractional parallax error is larger than about 20%” |

<a id="bailerjones2021"></a>
### Bailer-Jones et al. 2021 — Estimating Distances from Parallaxes. V. Geometric and Photogeometric Distances to 1.47 Billion Stars in Gaia Early Data Release 3

AJ 161, 147 · [doi:10.3847/1538-3881/abd806](https://doi.org/10.3847/1538-3881/abd806) · [arXiv:2012.05220](https://arxiv.org/abs/2012.05220)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Bayesian geometric/photogeometric distance posteriors, median r_med as the estimate (top distance tier) |  | verified | p. 1 (abstract); p. 3 | “The second, photogeometric, additionally uses the colour and apparent magnitude of a star” |
| r_med_photogeo preferred over r_med_geo |  | verified | p. 1 (abstract) | “photogeometric estimates generally have higher accuracy and precision for stars with poor parallaxes” |
| why photogeo is absent for a source | 'fail their photometric joint fit' (validate-distances.py); 'no usable G or BP-RP' (catalog-pure.ts) | disagrees | p. 7, Sect. 2.5; p. 3, Sect. 2.2 | “If both models are null, or if the source is outside of the colour range of the mock CQD, we do not infer a photogeometric distance.” |
| Lindegren parallax zero-point applied inside the posteriors |  | verified | p. 26, item 6; p. 3, Sect. 2.2 | “We applied the parallax zero-point correction derived by Lindegren et al. (2020a)” |
| Galactic prior has no LMC |  | verified | p. 4, Fig. 2 caption | “The LMC/SMC are excluded from our prior.” |
| coverage: posteriors for every Gaia DR3 source | every Gaia DR3 source | disagrees | p. 1 (abstract); p. 13 | “We provide a catalogue of 1.47 billion geometric and 1.35 billion photogeometric distances” |

<a id="ballesteros2012"></a>
### Ballesteros 2012 — New insights into black bodies

Europhysics Letters 97, 34008 · [doi:10.1209/0295-5075/97/34008](https://doi.org/10.1209/0295-5075/97/34008) · [arXiv:1201.1809](https://arxiv.org/abs/1201.1809)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| B-V -> Teff relation | Teff = 4600 (1/(0.92(B-V)+1.7) + 1/(0.92(B-V)+0.62)) K | verified | p. 4, eq. 14 | “T = 4600 ( 1/(0.92(B−V)+1.7) + 1/(0.92(B−V)+0.62) )” |
| analytic inverse Teff -> B-V | u = (2 - 2.32k + sqrt(4 + 1.1664k^2))/(2k), B-V = u/0.92, k = T/4600 | verified | p. 4, eq. 14 |  |
| characterisation: empirical fit calibrated against stars; works well A-K |  | disagrees | p. 4 | “As a direct application of eq. (12), it can be use to estimate the temperature from the widely used color index B − V.” |

<a id="benedict2002"></a>
### Benedict 2002 — Astrometry with the Hubble Space Telescope: A Parallax of the Fundamental Distance Calibrator delta Cephei

AJ 124, 1695-1705 (2002) · [doi:10.1086/342014](https://doi.org/10.1086/342014) · [arXiv:astro-ph/0206214](https://arxiv.org/abs/astro-ph/0206214) · [2002AJ....124.1695B](https://ui.adsabs.harvard.edu/abs/2002AJ....124.1695B)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| delta Cep HST parallax distance (cross-check) | 273 ± 11 pc | verified | p. 2 (abstract); p. 10 | “we find πabs = 3.66 ± 0.15 mas” |

<a id="bessell1979"></a>
### Bessell 1979 — UBVRI photometry. II - The Cousins VRI system, its temperature and absolute flux calibration, and relevance for two-dimensional photometry

PASP 91, 589 (1979) · [doi:10.1086/130542](https://doi.org/10.1086/130542) · [1979PASP...91..589B](https://ui.adsabs.harvard.edu/abs/1979PASP...91..589B)

- **Copy:** `ADS scan of published article`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Johnson V-R -> Cousins V-Rc transform underlying the STScI paired columns | table pairs (0.41,0.27) (0.47,0.31) (0.52,0.35) (0.61,0.42) (0.67,0.46) (0.73,0.50) (0.80,0.55) (0.86,0.60) (0.97,0.68) | verified | p. 591 | “(V−R)c = 0.73 (V−R)J − 0.03, (V−R)J < 1.0” |
| table pair at Johnson V-R = 0.45 | (0.45, 0.30) | disagrees | p. 591 | “(V−R)c = 0.73 (V−R)J − 0.03, (V−R)J < 1.0” |

<a id="blandhawthorn2016"></a>
### Bland-Hawthorn & Gerhard 2016 — The Galaxy in Context: Structural, Kinematic, and Integrated Properties

ARA&A 54, 529 · [doi:10.1146/annurev-astro-081915-023441](https://doi.org/10.1146/annurev-astro-081915-023441) · [arXiv:1602.07702](https://arxiv.org/abs/1602.07702)

- **Copy:** `publishedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Galaxy integrated M_V | -21.37 | verified | p. 534, Table 2 | “U B V R I -20.67 -20.70 -21.37 -21.90 -22.47” |
| Galaxy integrated B-V | 0.73 | verified | p. 534, Table 2 | “U−V U−B B−V V−R R−I 0.86 0.14 0.73 0.54 0.58” |
| magnitudes vs colour indices mutually inconsistent (~0.1 mag), from Milky Way analogues | ~0.1 mag | verified | p. 534, Table 2 notes | “Different calibration schemes are needed for the sdss total magnitudes and the unbiassed galaxy colours which leads to inconsistencies” |
| older direct-integration values run dimmer and bluer |  | verified | p. 536 | “These values are mostly dimmer and bluer than the” |
| thin-disc scale height | 300 ± 50 pc | verified | p. 561, Sect. 5.1 (margin summary) | “z t : 300±50 pc, thin disk vertical scalelength at R0” |
| thick-disc scale height | 900 ± 180 pc | verified | p. 561, Sect. 5.1 (margin summary) | “z T : 900±180 pc, thick disk vertical scalelength at R0” |
| thin-disc scale length | 2.6 ± 0.5 kpc | verified | p. 561, Sect. 5.1 (margin summary) | “Rt : 2.6±0.5 kpc, thin disk radial scalelength” |
| thick/thin local density ratio | f_ρ = 4 ± 2 % (0.04) | verified | p. 561, Sect. 5.1 (margin summary) | “fρ : 4%±2%, thick / thin disk local density ratio at R0” |
| thick/thin surface density ratio | f_Σ = 12 ± 4 % | verified | p. 561, Sect. 5.1 (margin summary) | “fΣ : 12%±4%, thick / thin disk surface density ratio at R0” |

<a id="bodhaine1999"></a>
### Bodhaine et al. 1999 — On Rayleigh Optical Depth Calculations

J. Atmos. Oceanic Technol. 16, 1854-1861 (1999) · [doi:10.1175/1520-0426(1999)016<1854:ORODC>2.0.CO;2](https://doi.org/10.1175/1520-0426(1999)016<1854:ORODC>2.0.CO;2)

- **Copy:** `publishedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Earth sea-level Rayleigh optical depth at 650/550/450 nm | [0.049, 0.097, 0.221] | verified | p. 1859, eq. 30 | “τR(sea level, 45°N) = 0.002 152 0 (1.045 599 6 − 341.290 61λ−2 − 0.902 308 50λ2)/(1 + 0.002 705 988 9λ−2 − 85.968 563λ2)” |
| blue/red Rayleigh ratio (450/650 nm) | 4.51 | disagrees | p. 1859, eq. 30 |  |

<a id="bohlin1978"></a>
### Bohlin, Savage & Drake 1978 — A survey of interstellar H I from L-alpha absorption measurements. II

ApJ 224, 132 (1978) · [doi:10.1086/156357](https://doi.org/10.1086/156357) · [1978ApJ...224..132B](https://ui.adsabs.harvard.edu/abs/1978ApJ...224..132B)

- **Copy:** `ADS scan of published article`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| N_H/E(B-V) | 5.8×10²¹ cm⁻² mag⁻¹ | verified | p. 132 (abstract) | “(N(H I + H2)/E(B − V)) = 5.8 × 10^21 atoms cm−2 mag−1” |
| N_H per A_V (derived at R_V = 3.1) | 1.87×10²¹ cm⁻² mag⁻¹ | verified | p. 132 (abstract) | “(N(H I + H2)/E(B − V)) = 5.8 × 10^21 atoms cm−2 mag−1” |

<a id="bruzual2003"></a>
### Bruzual & Charlot 2003 — Stellar population synthesis at the resolution of 2003

MNRAS 344, 1000 · [doi:10.1046/j.1365-8711.2003.06897.x](https://doi.org/10.1046/j.1365-8711.2003.06897.x) · [arXiv:astro-ph/0309134](https://arxiv.org/abs/astro-ph/0309134)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| bulge Υ*_V (M/L_V), Chabrier SSP, Z = 0.02, 10 Gyr | 3.15 | verified | p. 8, Sect. 3 (model definition) | “mass-to-light ratio M/LV of simple stellar populations” |
| bulge B-V, same SSP row | 0.9574 | verified | p. 8, Sect. 3 (model definition) |  |
| Chabrier IMF, 0.1-100 Msun | lognormal to 1 Msun + x = 1.3 power law, 0.1-100 Msun | verified | p. 8, eq. 2 | “We adopt here the Chabrier (2003b) IMF because it is physically motivated” |
| evolutionary tracks: Padova 1994 | Padova 1994 | verified | p. 3, Sect. 2.1, Table 1 | “We refer to this set of tracks as the ‘Padova 1994 library’.” |
| evolutionary tracks: 'Charlot 1997' | Padova 1994 + Charlot 1997 (section 2.1) | not in paper | p. 2-3, Sect. 2.1; references p. 30 |  |

<a id="butkevich2014"></a>
### Butkevich & Lindegren 2014 — Rigorous treatment of barycentric stellar motion

A&A 570, A62 (2014) · [doi:10.1051/0004-6361/201424483](https://doi.org/10.1051/0004-6361/201424483) · [arXiv:1407.4664](https://arxiv.org/abs/1407.4664) · [2014A&A...570A..62B](https://ui.adsabs.harvard.edu/abs/2014A%26A...570A..62B)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| rigorous epoch-propagation form |  | verified | p. 1 (abstract) | “We present rigorous and explicit formulae for the transformation of stellar positions, parallaxes, proper motions, and radial velocities from one epoch to another” |

<a id="cardelli1989"></a>
### Cardelli, Clayton & Mathis 1989 — The relationship between infrared, optical, and ultraviolet extinction

ApJ 345, 245 · [doi:10.1086/167900](https://doi.org/10.1086/167900)

- **Copy:** `ADS scan of published article`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| R_V = 3.1 for the diffuse ISM | 3.1 | verified | p. 245 (abstract) | “for values of Rv near 3.1, the value in the diffuse interstellar medium” |
| A_K/A_V at R_V = 3.1 | 0.117 | verified | p. 249, eq. 2 and Table 3 | “a(x) = 0.574x^1.61 ; b(x) = −0.527x^1.61” |
| per-channel reddening multipliers (shipped REDDENING_RGB) | (0.76, 1.0, 1.35) | disagrees | p. 249, Table 3 | “R 1.43 0.8686 -0.3660 0.751 ... B 2.27 0.9982 1.0495 1.337” |
| 'CCM default' reddening in milkyway.ts / milkyway-tuning.ts | (0.751, 1.0, 1.32) | disagrees | p. 249, Table 3 | “B 2.27 0.9982 1.0495 1.337 1.322 1.325” |

<a id="casagrande2018"></a>
### Casagrande & VandenBerg 2018 — On the use of Gaia magnitudes and new tables of bolometric corrections

MNRAS 479, L102-L107 (2018) · [doi:10.1093/mnrasl/sly104](https://doi.org/10.1093/mnrasl/sly104) · [arXiv:1806.01953](https://arxiv.org/abs/1806.01953) · [2018MNRAS.479L.102C](https://ui.adsabs.harvard.edu/abs/2018MNRAS.479L.102C)

- **Copy:** `submittedVersion`
- **Note:** Same authors also have 2018 MNRAS 475, 5023 (Synthetic photometry II); the Gaia-colour letter is the one carrying BP-RP of the Sun

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| solar BP-RP | 0.82 | verified | p. 4, Sect. 4 | “(GBP − GRP ) = 0.82 for the Sun” |

<a id="chapman2009"></a>
### Chapman et al. 2009 — The Mid-Infrared Extinction Law in the Ophiuchus, Perseus, and Serpens Molecular Clouds

ApJ 690, 496-511 (2009) · [doi:10.1088/0004-637X/690/1/496](https://doi.org/10.1088/0004-637X/690/1/496) · [arXiv:0809.1106](https://arxiv.org/abs/0809.1106) · [2009ApJ...690..496C](https://ui.adsabs.harvard.edu/abs/2009ApJ...690..496C)

- **Copy:** `submittedVersion`
- **Note:** Crossref issued-date 2008 (online); print 2009

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| R_V ≈ 3.1-3.5 for A_V ≲ 4-5 | R_V 3.1-3.5 at A_V ≲ 4-5 | disagrees | p. 1 (abstract) | “Below AKs = 0.5, our extinction law is well-fit by the Weingartner & Draine (2001) RV = 3.1 diffuse interstellar medium dust model.” |
| R_V ~5 only at A_V ≳ 10-18 | A_V ≳ 10-18 | disagrees | p. 1 (abstract) | “for AKs ≥ 1, the data are more consistent with the Weingartner & Draine RV = 5.5 model” |
| R_V ≈ 5.5 in dense cores | 5.5 | verified | p. 1 (abstract) | “the data are more consistent with the Weingartner & Draine RV = 5.5 model that uses larger maximum dust grain sizes” |

<a id="cioni2000"></a>
### Cioni et al. 2000 — The tip of the red giant branch and distance of the Magellanic Clouds: results from the DENIS survey

A&A 359, 601 (2000) · [arXiv:astro-ph/0003223](https://arxiv.org/abs/astro-ph/0003223) · [2000A&A...359..601C](https://ui.adsabs.harvard.edu/abs/2000A%26A...359..601C)

- **Copy:** `submittedVersion`
- **Note:** No DOI (A&A 2000)

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| SMC distance modulus (DENIS TRGB, via LVDB) | µ = 18.99 ± 0.1 (62.81 kpc) | verified | p. 1 (abstract); p. 10 | “m − M = 18.99 ± 0.03 (formal) ±0.08 (systematic) for the Small Magellanic Cloud (SMC)” |

<a id="ciotti1999"></a>
### Ciotti & Bertin 1999 — Analytical properties of the R^(1/m) luminosity law

A&A 352, 447 (1999) · [arXiv:astro-ph/9911078](https://arxiv.org/abs/astro-ph/9911078) · [1999A&A...352..447C](https://ui.adsabs.harvard.edu/abs/1999A%26A...352..447C)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Sérsic b_n asymptotic expansion | b_n = 2n - 1/3 + 4/(405n) | verified | p. 5, eq. 18 | “b(m) ∼ 2m − 1/3 + 4/(405m) + 46/(25515m²) + 131/(1148175m³)” |

<a id="cook2023"></a>
### Cook et al. 2023 — NED-LVS

ApJS 268, 14 · [arXiv:2306.06271](https://arxiv.org/abs/2306.06271)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| NED-LVS size at publication | 1.9M objects | verified | p. 1 (abstract) | “a subset of ∼1.9 million objects with distances out to 1000 Mpc” |
| NED-LVS dataset DOI | 10.26132/NED8 | verified | p. 34 (references) | “NED Local Volume Sample (NED-LVS), IPAC, doi: 10.26132/NED8” |

<a id="corbelli2014"></a>
### Corbelli et al. 2014 — Dynamical signatures of a ΛCDM-halo and the distribution of the baryons in M 33

A&A 572, A23 · [doi:10.1051/0004-6361/201424033](https://doi.org/10.1051/0004-6361/201424033) · [arXiv:1409.2665](https://arxiv.org/abs/1409.2665)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| M33 disc scale length | 1.8 kpc | verified | p. 7, Sect. 3.5 | “This scalelength, 1.8±0.1 kpc, is consistent with that inferred in our stellar surface density maps beyond R∼ 2 kpc.” |
| M33 disc orientation from tilted-ring fit | i = 54°, PA = 22° | verified | p. 8, Fig. 3 | “The inclination and position angle of the 11 free tilted rings used for deconvolving the 21-cm data.” |
| M33 is a pure disc (no bulge) |  | verified | p. 1 (Introduction); p. 11 | “it hosts no bulge nor prominent bars” |
| M33 B/T ≲ 0.04 | B/T ≲ 0.04 | not in paper |  |  |

<a id="costaalmeida2021"></a>
### Costa-Almeida E. et al. 2021 — M dwarf spectral indices at moderate resolution: accurate Teff and [Fe/H] for 178 southern stars

MNRAS 508, 5148 · [2021MNRAS.508.5148C](https://ui.adsabs.harvard.edu/abs/2021MNRAS.508.5148C)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| EZ Aqr (GJ 866) radial velocity as published | 6824.7 km/s | verified | p. 19, Table A3 | “GJ 866 22:38:33.7 -15:17:57.3 3480 305 0.16 0.46 6824.7 3.3” |

<a id="courteau2011"></a>
### Courteau et al. 2011 — THE LUMINOSITY PROFILE AND STRUCTURAL PARAMETERS OF THE ANDROMEDA GALAXY

ApJ 739, 20 · [doi:10.1088/0004-637X/739/1/20](https://doi.org/10.1088/0004-637X/739/1/20) · [arXiv:1106.3564](https://arxiv.org/abs/1106.3564)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| M31 disc scale length | R_d = 5.3 ± 0.5 kpc | verified | p. 2 (abstract); p. 21 | “a dust-free exponential disk of scale length Rd = 5.3 ± .5 kpc” |
| M31 Sérsic bulge R_e and n | R_e = 1.0 ± 0.2 kpc, n = 2.2 ± 0.3 | verified | p. 2 (abstract); p. 19, Sect. 7.1 | “Sérsic bulge with shape index n ≃ 2.2 ± .3 and effective radius Re = 1.0 ± 0.2 kpc” |
| M31 bulge-to-total light | B/T = 0.31 | disagrees | p. 24, Sect. 7; p. 2 | “yield light fractions for the bulge and disk equal to 29% and 71% respectively, for a B/D ratio of 0.41.” |
| M31 distance adopted by the paper | 785 ± 25 kpc | verified | p. 3 | “we adopt a distance DM31 = 785 ± 25 kpc (McConnachie et al. 2005)” |

<a id="cox2000"></a>
### Cox 2000 — Allen's Astrophysical Quantities, 4th ed.

AIP Press / Springer, New York (2000); ISBN 0-387-98746-0 · [doi:10.1007/978-1-4612-1186-0](https://doi.org/10.1007/978-1-4612-1186-0) · [2000asqu.book.....C](https://ui.adsabs.harvard.edu/abs/2000asqu.book.....C)

- **Copy:** not held
- **Identification:** book — Crossref Springer book record (DOI 10.1007/978-1-4612-1186-0, dated 2002 reprint) Section/table numbers (15.2, Table 15.7, 15.3, 12) not verified

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| per-class stellar masses (Sect. 15.2 / Table 15.7), incl. K III ~1.5 Msun |  | unverified |  |  |
| subgiant bias from evolutionary tracks (Sect. 15.7) |  | unverified |  |  |
| M_V per spectral class / luminosity class (Sect. 15.3) |  | unverified |  |  |
| solar apparent V (Sect. 12) |  | unverified |  |  |
| lunar phase law m = -12.73 + 1.49\|phi\| + 0.043 phi^4 (DeltaV = 0.026 alpha + 4e-9 alpha^4, to 150 deg) |  | unverified |  |  |
| twilight illuminance 0.008 lx at 12 deg / 0.0006 lx at 18 deg solar depression |  | unverified |  |  |

<a id="creevey2023"></a>
### Creevey et al. 2023 — Gaia Data Release 3

A&A 674, A26 · [doi:10.1051/0004-6361/202243688](https://doi.org/10.1051/0004-6361/202243688) · [arXiv:2206.05864](https://arxiv.org/abs/2206.05864)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Gaia DR3 Apsis astrophysical-parameters pipeline (GSP-Phot, GSP-Spec among its modules) |  | verified | p. 1, Abstract; p. 2, Sect. 1 | “They were produced by the Astrophysical parameters inference system (Apsis) within the Gaia Data Processing and Analysis Consortium.” |
| GSP-Phot A0 reference wavelength | 547.7 nm | disagrees | p. 10, Sect. 4.3 | “We use the parameter A0, which is the monochromatic extinction at λ0 = 541.4 nm” |
| Coarse spectral-type enum (spectraltype_esphs) emitted by gspspec | O, B, A, F, G, K, M, CSTAR, unknown — from gspspec | disagrees | p. 16, Sect. 6.1.3 and fn. 16; p. 7, Sect. 3.7 | “ESP-ELS provides for 218 million targets with G ≤ 17.65 one of the following spectral type tags spectraltype_esphs” |

<a id="cutri2003"></a>
### Cutri R. M. et al. 2003 — The 2MASS All-Sky Catalog of Point Sources

VizieR II/246 · [2003yCat.2246....0C](https://ui.adsabs.harvard.edu/abs/2003yCat.2246....0C)

- **Copy:** `VizieR ReadMe`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Gl 863.1A SIMBAD coordinate is the 2MASS PSC position | J2000 RA/Dec (back-propagated from the J2016 pin: 338.23656, +53.79460) | verified | l. 103-104 | “RAdeg (ra) Right ascension (J2000) ... DEdeg (dec) Declination (J2000)” |
| 2MASS coordinate treated as epoch J2000 and advanced 16 yr | epoch 2000.0, Δt = 16 yr | disagrees | l. 146; l. 485 | “JD (jdate) Julian date of source measurement” |

<a id="deau2013"></a>
### Déau et al. 2013 — The opposition effect in Saturn's main rings as seen by Cassini ISS: 1. Morphology of phase functions and dependence on the local optical depth

Icarus 226, 591-603 (2013) · [doi:10.1016/j.icarus.2013.01.015](https://doi.org/10.1016/j.icarus.2013.01.015) · [2013Icar..226..591D](https://ui.adsabs.harvard.edu/abs/2013Icar..226..591D)

- **Copy:** `acceptedVersion`
- **Note:** HWHM 0.20 deg not verified in text; Paper 2 is Icarus 253 (2015)

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Opposition-surge half-width (HWHM) in the A and B rings | 0.20° | verified | p. 23, Sect. 5; p. 37, Fig. 5 | “A and HWHM stabilize to constant values of 1.7 and 0.2o, respectively, for τ > 1.5.” |
| HWHM in the C ring and Cassini Division | 0.26–0.28° | disagrees | p. 19, Sect. 3.1.1 | “The opposition surges in the C Ring and Cassini Division show larger angular widths (HWHM ≥ 0.26°) than in the A and B Rings.” |
| Surge amplitude, B ring | 1.25 | verified | p. 18, Sect. 3.1.1 | “The B Ring’s opposition surge has the smallest amplitude of all the main rings (A ~ 1.25)” |
| Surge amplitude, A ring | 1.39 | verified | p. 19, Sect. 3.1.1 | “The A Ring’s surge has, on average, an amplitude of about 1.4 (with a wide range of values)” |
| Surge amplitude, C ring and Cassini Division | 1.45 (C), 1.47 (Cassini Division) | not in paper | p. 19, Sect. 3.1.1 | “The opposition surges in the Cassini Division and the C Ring are of similar amplitude on average, A ~ 1.5.” |
| Linear-regime slope range across the rings | 0.030–0.105 per deg | verified | p. 19, Sect. 3.1.1 | “The B Ring has the steepest slope (<S> ~ 0.105 deg-1) ... <S> = 0.030 deg-1 for the C Ring” |
| Amplitude–optical-depth relation turns over (positive below τ≈0.5, negative above τ≈1), reported as per-region correlation coefficients | turnover near τ ≈ 0.5–1 | disagrees | p. 20, Sect. 3.2; p. 19, Sect. 3.1.1 | “clear decreasing trends of A(τ) and HWHM(τ) are visible in the range 0 < τ < 0.7. For the high optical depth regime (τ > 1), values of A and HWHM are nearly constant” |

<a id="delporte1930"></a>
### Delporte 1930 — Delimitation scientifique des constellations (tables et cartes)

Cambridge University Press for the IAU (1930)

- **Copy:** not held
- **Identification:** book — The IAU constellation boundaries at B1875 Not network-verified

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| IAU constellation boundary arcs at equinox B1875 |  | unverified |  |  |
| boundary equinox B1875.0 = 1874 Dec 31.76 | 1874 Dec 31.76 | unverified |  |  |

<a id="devaucouleurs1960"></a>
### de Vaucouleurs 1960 — Magnitudes and Colors of the Magellanic Clouds

ApJ 131, 574 (1960) · [doi:10.1086/146870](https://doi.org/10.1086/146870) · [1960ApJ...131..574D](https://ui.adsabs.harvard.edu/abs/1960ApJ...131..574D)

- **Copy:** `ADS scan of published article`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| LMC integrated (B−V) | 0.51 ± 0.02 | verified | p. 574, Abstract | “LMC: B = 0.94 ± 0.03, B — V = +0.51 ± 0.02 in 100 square degrees” |

<a id="devaucouleurs1978"></a>
### de Vaucouleurs & Pence 1978 — An outsider's view of the Galaxy - Photometric parameters, scale lengths, and absolute magnitudes of the spheroidal and disk components of our Galaxy

AJ 83, 1163 (1978) · [doi:10.1086/112305](https://doi.org/10.1086/112305) · [1978AJ.....83.1163D](https://ui.adsabs.harvard.edu/abs/1978AJ.....83.1163D)

- **Copy:** `ADS scan of published article`
- **Identification:** mismatch — Abstract gives face-on total M_T(B) = -20.08, not -20.2 +/- 0.15 The -20.2 +/- 0.15 value is de Vaucouleurs 1983 (ApJ 268, 451) — diffuse-reference.ts cites 1978 for it while SCIENCE.md cites 1983

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Galaxy face-on total absolute B magnitude | M_B = −20.2 ± 0.15 | disagrees | p. 1163, Abstract; p. 1166, Sect. V | “the face-on total absolute magnitude of the Galaxy ... is M°T(B) = −20.08” |

<a id="devaucouleurs1983"></a>
### de Vaucouleurs 1983 — The galaxy as fundamental calibrator of the extragalactic distance scale. I - The basic scale factors of the galaxy and two kinematic tests of the long and short distance scales

ApJ 268, 451 (1983) · [doi:10.1086/160971](https://doi.org/10.1086/160971) · [1983ApJ...268..451D](https://ui.adsabs.harvard.edu/abs/1983ApJ...268..451D)

- **Copy:** `ADS scan of published article`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Galaxy total absolute B magnitude | M_B = −20.2 ± 0.15 | verified | p. 451, Abstract | “RQ = 8.5 ± 0.5 kpc, M°T(B) = −20.2 ± 0.15, (B − V)°T = 0.53 ± 0.04” |

<a id="devaucouleurs1991"></a>
### de Vaucouleurs et al. 1991 — Third Reference Catalogue of Bright Galaxies (RC3)

Springer-Verlag, New York (1991), 3 vols; de Vaucouleurs, de Vaucouleurs, Corwin, Buta, Paturel, Fouque · [doi:10.1007/978-1-4757-4363-0](https://doi.org/10.1007/978-1-4757-4363-0)

- **Copy:** not held
- **Identification:** book — Crossref Springer book records Vol II DOI 10.1007/978-1-4757-4360-9 also exists; bibcode 1991rc3..book.....D did not resolve via ADS link gateway (may be valid but lacks a full-text link)

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| M31 integrated V magnitude | 3.44 mag | verified | l. 152, l. 165 (VII/155 ReadMe); rc3 row NGC 224 | “BT (total B magnitude) ... (B-V)T (total (B-V))” |
| M33 integrated V magnitude | 5.72 mag | verified | l. 152, l. 165 (VII/155 ReadMe); rc3 row NGC 598 | “BT (total B magnitude) ... (B-V)T (total (B-V))” |

<a id="dolan2002"></a>
### Dolan & Mathieu 2002 — A Photometric Study of the Young Stellar Population throughout the lambda Orionis Star-Forming Region

AJ 123, 387-403 (2002) · [doi:10.1086/324631](https://doi.org/10.1086/324631) · [arXiv:astro-ph/0110160](https://arxiv.org/abs/astro-ph/0110160) · [2002AJ....123..387D](https://ui.adsabs.harvard.edu/abs/2002AJ....123..387D)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| λ Ori ring size (used as a curated cavity radius) | ≈ 30 pc (R_curated = 30 pc, a radius) | disagrees | p. 4, Sect. 1 | “The star-forming complex contains a tight knot of OB stars encircled by a 40 pc diameter ring of dense molecular gas and dust” |

<a id="dommanget1994"></a>
### Dommanget & Nys 1994 — Catalogue of the Components of Double and Multiple stars (CCDM), first edition

Comm. Obs. Royal de Belgique, Ser. A, No. 115 (1994); VizieR I/211 · [1994CoORB.115....1D](https://ui.adsabs.harvard.edu/abs/1994CoORB.115....1D)

- **Copy:** not held
- **Identification:** book — CDS ReadMe I/211: Dommanget J., Nys O., =1994CoORB.115....1D

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| CCDM register behind the Hipparcos CCDM column (visual-doubles flag) |  | verified | l. 15-17 | “the fundamental ties between the CCDM and the HIPPARCOS INPUT CATALOGUE (HIC)” |

<a id="drimmel2001"></a>
### Drimmel & Spergel 2001 — Three‐dimensional Structure of the Milky Way Disk: The Distribution of Stars and Dust beyond 0.35R⊙

ApJ 556, 181 · [doi:10.1086/321556](https://doi.org/10.1086/321556) · [arXiv:astro-ph/0101259](https://arxiv.org/abs/astro-ph/0101259)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Thin-disc dust radial scale length | 3500 pc (exp(−(R−R0)/3500pc)) | disagrees | p. 35, Table 1; p. 1, Abstract | “scale length hr 2.26 kpc 0.16” |
| Thin-disc dust vertical profile / scale height | exp(−\|z\|/125pc) | disagrees | p. 8, eqs. 13-14; p. 35, Table 1 | “ρaxi = ρ0 exp(−r/hr) sech2(z/hd)” |

<a id="ducati2001"></a>
### Ducati et al. 2001 — Intrinsic Colors of Stars in the Near-Infrared

ApJ 558, 309-322 (2001) · [doi:10.1086/322439](https://doi.org/10.1086/322439) · [2001ApJ...558..309D](https://ui.adsabs.harvard.edu/abs/2001ApJ...558..309D)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Johnson (V−R)0 of main-sequence G0–K5 stars (Johnson side of the V−R → V−Rc pairs) | 0.41, 0.45, 0.47, 0.52, 0.61, 0.67, 0.73, 0.80, 0.86, 0.97 (G0, G2, G5, G8, K0–K5) | verified | p. 11, Table 3 | “INTRINSIC COLORS OF MAIN-SEQUENCE STARS ... G0 ... 0.41 ... K5 ... 0.97” |

<a id="dupuy2023"></a>
### Dupuy & Courtois 2023 — Dynamic cosmography of the local Universe: Laniakea and five more watershed superclusters

A&A 678, A176 · [doi:10.1051/0004-6361/202346802](https://doi.org/10.1051/0004-6361/202346802) · [arXiv:2305.02339](https://arxiv.org/abs/2305.02339)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Six watershed basins (Laniakea + five superclusters) | 6 basin shells | verified | p. 1, Abstract | “Five more known superclusters are now dynamically defined in the same way: Apus, Hercules, Lepus, Perseus-Pisces and Shapley.” |
| Watershed data product: 128³ integer-labelled grid (1 = Laniakea, 2 = Apus), hosted on the IP2I CosmicFlows page | 128³ voxels; 1 = Laniakea, 2 = Apus; projets.ip2i.in2p3.fr/cosmicflows/ | verified | p. 6, Availability of data and materials | “voxels filled with 1 are part of Laniakea, 2 of Apus, 3 of Hercules, etc.” |

<a id="dyudina"></a>
### Dyudina U. A. et al. 2005 — Phase Light Curves for Extrasolar Jupiters and Saturns

ApJ 618, 973-986 (2005) · [doi:10.1086/426050](https://doi.org/10.1086/426050) · [arXiv:astro-ph/0406390](https://arxiv.org/abs/astro-ph/0406390) · [2005ApJ...618..973D](https://ui.adsabs.harvard.edu/abs/2005ApJ...618..973D)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Pioneer-derived Saturn scattering model behind M&H Eq. 12 |  | verified | p. 12, Sect. 2.1.2, Table 2 | “The coefficients are fitted by Dones et al. (1993) to Pioneer 11 fitted phase function tables” |

<a id="edenhofer2024"></a>
### Edenhofer et al. 2024 — A parsec-scale Galactic 3D dust map out to 1.25 kpc from the Sun

A&A 685, A82 · [doi:10.1051/0004-6361/202347628](https://doi.org/10.1051/0004-6361/202347628) · [arXiv:2308.01295](https://arxiv.org/abs/2308.01295)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| 3D dust extinction map to 1.25 kpc, in ZGR23 (E_ZGR) differential-extinction units | E_ZGR pc⁻¹; ≤ 1.25 kpc | verified | p. 1, Abstract; p. 2, Sect. 3 and fn. 1 | “The ZGR23 extinction is in arbitrary units but can be translated to an extinction at any given wavelength by using the extinction curve” |
| ZGR23 → V-band factor 'Edenhofer 2024 round to 2.8' | 2.8 (tree uses 2.742 at ~544 nm) | verified | p. 7, Sect. 5 | “we adopted the extinction curve published in ZGR23 and multiplied the unitless ZGR23 extinction by a factor of 2.8.” |
| Posterior mean map plus 12 posterior samples released | posterior mean (cloud-surface tracing, voxel resample) | verified | p. 1, Abstract | “We generated 12 samples from the variational posterior of the 3D dust distribution and release the samples alongside the mean 3D dust map” |
| Map used as the per-star extinction raymarch and resampled voxel grid |  | verified | p. 1, Abstract | “We aim to construct a new 3D map of the spatial distribution of interstellar dust extinction out to a distance of 1.25 kpc” |

<a id="esa1997"></a>
### ESA 1997 — The Hipparcos and Tycho Catalogues

ESA SP-1200 · [1997HIP...C......0E](https://ui.adsabs.harvard.edu/abs/1997HIP...C......0E)

- **Copy:** `publishedVersion` — Volume 1 (Introduction and Guide to the Data) only

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Tycho VT → Johnson V reduction coefficient | V = VT − 0.090(BT−VT) | verified | p. 57, Sect. 1.3 Appendix 4, eq. 1.3.20; p. 142, eq. 2.2.1 | “VJ = VT − 0.090 (B − V)T” |
| BT−VT validity range of the reduction | [−0.25, 2.0] | disagrees | p. 57, Sect. 1.3 Appendix 4; p. 142, Sect. 2.2 | “the following approximate linear transformations were derived between the two systems over the range −0.2 < (B − V)T < 1.8” |
| Hipparcos main catalogue entry count | 118,218 | verified | p. 6, Sect. 1.1 | “The Hipparcos Catalogue contains 118 218 entries corresponding to 129 332 stellar components” |
| I/239 fields used: printed Johnson V (H5), B−V (H37), CCDM (H55), MultFlag (H59), HD (H71) |  | verified | p. 107, Field H5; p. 115, Field H37; p. 124, Field H55; p. 126, Field H59; p. 133, Field H71 | “The magnitude, V, in the Johnson UBV photometric system.” |
| Standard epoch-transformation model | linear space motion (Vol. 1 Sect. 1.5.5) | verified | p. 94, Sect. 1.5.5 | “the standard model assumes uniform space velocity for the object: its path on the celestial sphere ... is a great-circle arc.” |

<a id="espenak2006"></a>
### Espenak F. & Meeus J. 2006 — Five Millennium Canon of Solar Eclipses: -1999 to +3000 (NASA/TP-2006-214141)

NASA Goddard Space Flight Center Technical Publications

- **Copy:** `publishedVersion` — Text volume only; the eclipse map plates are separate PDFs
- **Note:** Carries the Delta-T polynomial set

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| ΔT polynomial set, −1999 to +3000 (every coefficient and interval boundary) | eqs. 11–25 as coded in delta-t-pure.ts | verified | p. 14–16, Sect. 2.7, eqs. 11–25 | “a series of polynomial expressions have been created to simplify the evaluation of ∆T for any time during the interval –1999 to +3000.” |
| Lunar secular-acceleration correction and its −26 vs −25.858 ″/cy² basis | c = −0.000012932·(y−1955)² s; 202 s at 2000 BC | verified | p. 16, eq. 26; p. 6, eq. 1 and Table 1-2 | “c = –0.000012932 (y – 1955)2.” |
| 2005–2050 segment is a 2006 extrapolation | reads ~75 s in 2026 | verified | p. 16, eq. 23 | “This expression is derived from estimated values of ∆T in the years 2010 and 2050.” |

<a id="espenak2009"></a>
### Espenak F. & Meeus J. 2009 — Five Millennium Catalog of Solar Eclipses: -1999 to +3000 (NASA/TP-2009-214174)

NASA Goddard Space Flight Center Technical Publications

- **Copy:** `publishedVersion`
- **Note:** Carries the eclipse rows, including the per-event Delta-T

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Solar eclipse truth rows (ΔT, type, γ, magnitude, greatest-eclipse lat/lon, path width) | 23 rows in data/eclipse-canon/solar-eclipse-canon.tsv | verified | Appendix A, e.g. p. A-59 (cat. no. 3379, −0584 May 28), p. A-162 (cat. no. 9546, 2017 Aug 21) | “3379 169 -0584 May 28 19:28:50 18384 ... T n- 0.3201 1.0798 38.2N 45.0W 71 158 271” |
| Lunar eclipse truth rows | 12 rows in data/eclipse-canon/lunar-eclipse-canon.tsv | not in paper | whole volume |  |
| Catalog's lunar ephemeris and tidal acceleration | VSOP87 / ELP-2000-85, −25.858″/cy² | disagrees | p. 5, Sect. 1.3; p. 6, Sect. 1.4 | “For the Moon, use has been made of the theory ELP-2000/82 of Chapront-Touzé and Chapront (1983)” |
| Catalog uses the same ΔT polynomial set and −0.000012932(y−1955)² correction |  | verified | p. 6, eq. 1-1 and Table 1-2; p. 12, Sect. 2.7 | “The Canon and the Catalog both use the same solar and lunar ephemerides as well as the same values of ∆T.” |

<a id="esposito2002"></a>
### Esposito L. W. 2002 — Planetary rings

[doi:10.1088/0034-4885/65/12/201](https://doi.org/10.1088/0034-4885/65/12/201)

- **Copy:** `publishedVersion` — Table 1 (p. 1747): Uranus ring radii and single-value optical depths, no widths

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Uranus main-ring radii (Table 1) | 6 41837, 5 42234, 4 42570, α 44718, β 45661, η 47175, γ 47627, δ 48300, λ 50023, ε 51149 km | verified | p. 1747, Table 1 | “6 41 837 0.3 <1% q > 3.5” |

<a id="fabricius2002a"></a>
### Fabricius, Makarov, Knude & Wycoff 2002 — Henry Draper catalogue identifications for Tycho-2 stars

A&A 386, 709 · [doi:10.1051/0004-6361:20020249](https://doi.org/10.1051/0004-6361:20020249)

- **Copy:** `publishedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| IV/25 HD ↔ Tycho-2 cross index with ambiguity flags |  | verified | p. 710, Sect. 3 | “253 Tycho-2 stars are identified with two HD stars each, and 10 HD stars are resolved in Tycho-2. All these cases are flagged in the list” |

<a id="fabricius2002b"></a>
### Fabricius & Makarov 2002 — Tycho Double Star Catalogue (TDSC)

A&A 384, 180 (bibcode) · [2002A&A...384..180F](https://ui.adsabs.harvard.edu/abs/2002A%26A...384..180F)

- **Copy:** `publishedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| TDSC is built from Tycho-2 |  | verified | p. 181, Sect. 1; p. 180, Abstract | “Now, a third catalogue, the Tycho Double Star Catalogue, complements Tycho-2 with respect to double stars.” |
| Brightest doubles (Sirius, Mizar, Castor, α Cen, Polaris) missing from TDSC because Tycho-2 saturates | V ≲ 3 missing | not in paper | p. 182, Sects. 3.2 and 3.4 | “a very bright double was apparently not in Tycho-2 at all” |
| Literature proper-motion bibcode used by the PM-rescue tier | 2002A&A...384..180F | verified | p. 181, Sect. 1 | “It presents accurate positions, proper motions, BT and VT photometry for 66 219 components” |

<a id="federrath2010"></a>
### Federrath et al. 2010 — Comparing the statistics of interstellar turbulence in simulations and observations

A&A 512, A81 (2010) · [doi:10.1051/0004-6361/200912437](https://doi.org/10.1051/0004-6361/200912437) · [arXiv:0905.1060](https://arxiv.org/abs/0905.1060) · [2010A&A...512A..81F](https://ui.adsabs.harvard.edu/abs/2010A%26A...512A..81F)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Density-variance – Mach relation | σ_s² = ln(1 + b²M²) | verified | p. 10, eq. 19 | “σ2s = ln(1 + b2 M2)” |
| b for mixed forcing | b ≈ 0.4 | verified | p. 11, Sect. 5 (Fig. 8 discussion) | “For ζ ≳ 0.5 the b-parameter remains close to the value obtained for purely solenoidal forcing, i.e. b ≈ 0.3 − 0.4 in 3D” |

<a id="federrath2013"></a>
### Federrath & Klessen 2013 — On the Star Formation Efficiency of Turbulent Magnetized Clouds

ApJ 763, 51 (2013) · [doi:10.1088/0004-637X/763/1/51](https://doi.org/10.1088/0004-637X/763/1/51) · [arXiv:1211.6433](https://arxiv.org/abs/1211.6433) · [2013ApJ...763...51F](https://ui.adsabs.harvard.edu/abs/2013ApJ...763...51F)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| High-density power-law tail in star-forming clouds |  | verified | p. 1, Abstract | “develop power-law tails of flattening slope with increasing SFE” |

<a id="fitzgerald1970"></a>
### Fitzgerald 1970 — The Intrinsic Colours of Stars and Two-Colour Reddening Lines

A&A 4, 234 (1970) · [1970A&A.....4..234F](https://ui.adsabs.harvard.edu/abs/1970A%26A.....4..234F)

- **Copy:** `ADS scan of published article`
- **Note:** No DOI; title from standard usage, not network-verified

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Johnson V−R column of the V−R → V−Rc pairs | 0.41–0.97 (G0–K5) | not in paper | pp. 236-241, Tables 1-3 (whole paper read from the scan) | “Mean intrinsic colours, on the Johnson UBV and Cape UcBV systems, are obtained for stars of all MK spectral classes” |

<a id="flynn2006"></a>
### Flynn et al. 2006 — On the mass-to-light ratio of the local Galactic disc and the optical luminosity of the Galaxy

MNRAS 372, 1149 · [doi:10.1111/j.1365-2966.2006.10911.x](https://doi.org/10.1111/j.1365-2966.2006.10911.x) · [arXiv:astro-ph/0608193](https://arxiv.org/abs/astro-ph/0608193)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Local disc column (M/L)_V | 1.5 ± 0.2 | verified | p. 1, Abstract | “(M/L)B = 1.4 ± 0.2, (M/L)V = 1.5 ± 0.2 and (M/L)I = 1.2 ± 0.2” |
| Local disc column (M/L)_B and (M/L)_I | 1.4 ± 0.2 (B), 1.2 ± 0.2 (I) | verified | p. 1, Abstract | “(M/L)B = 1.4 ± 0.2, (M/L)V = 1.5 ± 0.2 and (M/L)I = 1.2 ± 0.2” |

<a id="freeman1970"></a>
### Freeman 1970 — On the Disks of Spiral and S0 Galaxies

ApJ 160, 811 (1970) · [doi:10.1086/150474](https://doi.org/10.1086/150474) · [1970ApJ...160..811F](https://ui.adsabs.harvard.edu/abs/1970ApJ...160..811F)

- **Copy:** `ADS scan of published article`
- **Note:** Erratum ApJ 161, 802 (10.1086/150583)

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Disc central surface brightness (Freeman's law), M31 check | μ₀(V) = 21.65 ± 0.30 mag/arcsec² | disagrees | p. 818, Sect. III; p. 811, Abstract | “B(0)c is nearly constant at B(0)c = 21.65 ± 0.30(σ) mag per square second of arc” |

<a id="french1986"></a>
### French R. G., Elliot J. L. & Levine S. E. 1986 — Structure of the Uranian Rings. II. Ring Orbits and Widths

Icarus 67, 134 (bibcode in URL) · [1986Icar...67..134F](https://ui.adsabs.harvard.edu/abs/1986Icar...67..134F)

- **Copy:** `publishedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Per-occultation ring profile fits (midtimes, widths, optical depths), 1977–1983 |  | verified | p. 134, Abstract | “to determine the midtimes, widths, and optical depths of all available Uranus ring occultation observations from 1977 to 1983” |

<a id="french1988"></a>
### French R. G. et al. 1988 — Uranian ring orbits from earth-based and Voyager occultation observations

[doi:10.1016/0019-1035(88)90104-2](https://doi.org/10.1016/0019-1035(88)90104-2) · [1988Icar...73..349F](https://ui.adsabs.harvard.edu/abs/1988Icar...73..349F)

- **Copy:** `publishedVersion` — Carries the ring semimajor axes (Tables XIV, XV); widths and optical depths are not tabulated here

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Uranus main-ring semimajor axes (Tables XIV, XV) | 6 41837, 5 42234, 4 42570, α 44718, β 45661, η 47175, γ 47627, δ 48300, λ 50023, ε 51149 km | verified | p. 369, Table XIV; p. 372, Table XV | “6 41837.15 ± 0.26 ... F 51149.32 ± 0.13” |

<a id="french1991"></a>
### French, Nicholson, Porco & Elliot 1991 — Dynamics and structure of the Uranian rings

In Uranus (Bergstralh, Miner & Matthews eds), Univ. of Arizona Press (1991), pp. 327-409 · [doi:10.2307/j.ctv1v7zdtq.13](https://doi.org/10.2307/j.ctv1v7zdtq.13)

- **Copy:** unobtainable — University of Arizona Press 1991 chapter; no digital or print copy reachable. rings-uranus.tsv radii match french1988 Tables XIV-XV to 1 km and esposito2002 Table 1 exactly. Its widths appear in neither; its optical depths match neither french1986 nor esposito2002 (lambda: tsv 0.15, esposito2002 1e-3)
- **Note:** CSL authors: French, Nicholson, Porco, Marouf. Tree's 'French, Nicholson, Porco & Elliot' has the wrong fourth author (Marouf, not Elliot); bibcode 1991uran.book..327F did not resolve via ADS link gateway (may be valid but lacks a full-text link)

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Uranus ring radii, widths, optical depths |  | unverified |  |  |

<a id="frey1974"></a>
### Frey & Lowman 1974 — Studies of the Major Planet Satellite Systems

NASA Goddard Space Flight Center report X-922-74-112 (April 1974); NTRS 19740014371

- **Copy:** `publishedVersion`
- **Identification:** book — NASA NTRS record: Frey, H.; Lowman, P. D.; 1974-04-01

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| satellite B-V / V-R (Table IV): Io, Europa, Ganymede, Callisto, Dione, Rhea, Titan, Triton | Io 1.17/0.66, Europa 0.87/0.57, Ganymede 0.83/0.59, Callisto 0.86/0.61, Dione 0.71/0.48, Rhea 0.76/0.61, Titan 1.29/0.84, Triton 0.77/0.58 | verified | p. 15, Table IV | “S VI Titan 8.3 0.75 1.29 0.84 0.11 -1.21 ... N I Triton 15.6 0.40 0.77 0.58 0.44 -1.23” |
| filter effective wavelengths (Table III), R at 0.69 um | U .35, B .45, V .55, R .69, I .82 um | verified | p. 14, Table III | “TABLE III. WAVELENGTHS OF U B V R I FILTERS ... .35 .45 .55 .69 .82” |
| coverage: B-V but no V-R for Enceladus, Tethys, Iapetus; nothing for Mimas; Titania and Oberon both indices; no lunar row |  | verified | p. 15, Table IV | “S I Mimas 12.1 -- -- -- -- +2.5; S II Enceladus 11.7 -- 0.62 -- --” |

<a id="gaiacollab2018cat"></a>
### Gaia Collaboration (VizieR I/345) 2018 — Gaia DR2 catalogue (VizieR record)

[2018yCat.1345....0G](https://ui.adsabs.harvard.edu/abs/2018yCat.1345....0G)

- **Copy:** `VizieR ReadMe`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Gaia DR2 catalogue bibcode 2018yCat.1345....0G (VizieR I/345): SIMBAD rv values citing it are skipped on 2p rows | 2018yCat.1345....0G | verified | l. 7 | “=2018yCat.1345....0G” |

<a id="gaiacollab2022cat"></a>
### Gaia Collaboration (VizieR I/355) 2022 — Gaia DR3 catalogue (VizieR record)

[2022yCat.1355....0G](https://ui.adsabs.harvard.edu/abs/2022yCat.1355....0G)

- **Copy:** `VizieR ReadMe`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Gaia DR3 catalogue bibcode 2022yCat.1355....0G (VizieR I/355) for the rv skip rule | 2022yCat.1355....0G | verified | l. 6 | “=2022yCat.1355....0G” |

<a id="gieren2013"></a>
### Gieren et al. 2013 — THE ARAUCARIA PROJECT. A DISTANCE DETERMINATION TO THE LOCAL GROUP SPIRAL M33 FROM NEAR-INFRARED PHOTOMETRY OF CEPHEID VARIABLES

ApJ 773, 69 · [doi:10.1088/0004-637X/773/1/69](https://doi.org/10.1088/0004-637X/773/1/69) · [arXiv:1305.4258](https://arxiv.org/abs/1305.4258)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| M33 near-IR Cepheid true distance modulus | mu = 24.62 +/- 0.07 | verified | p. 2, Abstract | “We find a true distance modulus of 24.62 for M33, with a total uncertainty of ± 0.07 mag” |
| M33 distance in kpc | 840 kpc (+/- 27 kpc) | verified | p. 12 | “At a distance of 839 kpc, corresponding to our present result for M33” |

<a id="giovanelli2013"></a>
### Giovanelli 2013 — ALFALFA Discovery of the Nearby Gas-rich Dwarf Galaxy Leo P. I. H I Observations

AJ 146, 15 (2013) · [doi:10.1088/0004-6256/146/1/15](https://doi.org/10.1088/0004-6256/146/1/15) · [arXiv:1305.0272](https://arxiv.org/abs/1305.0272) · [2013AJ....146...15G](https://ui.adsabs.harvard.edu/abs/2013AJ....146...15G)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Leo P dIrr (dwarf irregular) type | dIrr | not in paper | p. 2 | “an alternative interpretation: that of a very faint, nearby, star forming dwarf galaxy” |

<a id="gliese1991"></a>
### Gliese & Jahreiss 1991 — Preliminary Version of the Third Catalogue of Nearby Stars

Astron. Rechen-Institut, Heidelberg (1991); VizieR V/70A · [1991adc..rept.....G](https://ui.adsabs.harvard.edu/abs/1991adc..rept.....G)

- **Copy:** not held
- **Identification:** book — CDS ReadMe V/70A: Gliese W., Jahreiss H. 1991 Catalogue, no DOI; bibcode from standard usage, not network-verified

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| printed V magnitude |  | verified | l. 78-80 | “Vmag     Apparent magnitude” |
| B-V colour |  | verified | l. 81 | “B-V      ? color” |
| trigonometric vs photometric parallax tiers (n_plx) |  | verified | l. 90-94, l. 150-155 | “plx      ? Resulting parallax ... n_plx     *[rwsop] Code on plx” |
| B1950 position and proper motion for binding review |  | verified | l. 65-73 | “Right Ascension B1950 (hours) ... pm       ? Total proper motion” |
| xi UMa photometric parallax (Gl 423 A) | 96.0 +/- 13.0 mas, n_plx=r -> 10.417 pc | verified | l. 92-94, l. 151; catalog row Gl 423 A | “r    parallax from spectral types and broad-band colors” |

<a id="golovin2023"></a>
### Golovin et al. 2023 — The Fifth Catalogue of Nearby Stars (CNS5)

A&A 670, A19 · [doi:10.1051/0004-6361/202244250](https://doi.org/10.1051/0004-6361/202244250) · [arXiv:2211.01449](https://arxiv.org/abs/2211.01449)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| CNS5 catalogue: GJ <-> Gaia EDR3 source_id <-> HIP cross-IDs, component letters, astrometry |  | verified | p. 9, Table 2 | “gj_id Gliese-Jahreiß number ... component_id Suffix for a component ... gaia_edr3_id Source identifier in Gaia EDR3 ... hip_id Hipparcos identifier” |
| CNS5 is volume-limited to 25 pc | 25 pc | verified | p. 1, Abstract | “For all known stars and brown dwarfs in the 25 pc sphere around the Sun, basic astrometric and photometric parameters are given” |
| CNS5 row count | 5,909 rows (corrected 2023-12-13) | not in paper | p. 1, Abstract | “The CNS5 contains 5931 objects, including 5230 stars” |

<a id="gontcharov2006"></a>
### Gontcharov 2006 — Pulkovo RV compilation

Astron. Lett. 32, 759 (bibcode) · [2006AstL...32..759G](https://ui.adsabs.harvard.edu/abs/2006AstL...32..759G)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Pulkovo Compilation of Radial Velocities (PCRV): literature rv tier, bibcode 2006AstL...32..759G |  | verified | p. 1, Abstract | “The PCRV contains weighted mean absolute radial velocities for 35 495 Hipparcos stars” |

<a id="graczyk2020"></a>
### Graczyk et al. 2020 — A Distance Determination to the Small Magellanic Cloud with an Accuracy of Better than Two Percent Based on Late-type Eclipsing Binary Stars

ApJ 904, 13 · [doi:10.3847/1538-4357/abbb2b](https://doi.org/10.3847/1538-4357/abbb2b) · [arXiv:2010.08754](https://arxiv.org/abs/2010.08754)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| SMC eclipsing-binary distance (cross-check) | 62.44 kpc, mu = 18.977 | verified | p. 1, Abstract | “the SMC center of DSMC = 62.44 ± 0.47(stat.)±0.81 (syst.) kpc corresponding to a distance modulus (m − M )SMC = 18.977” |

<a id="graham2002"></a>
### Graham 2002 — Evidence for an Outer Disk in the Prototype “Compact Elliptical” Galaxy M32

[doi:10.1086/340274](https://doi.org/10.1086/340274) · [arXiv:astro-ph/0202307](https://arxiv.org/abs/astro-ph/0202307)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| M32 Sersic index n = 1.5 | n_sersic = 1.5 (described in the tree as an 'outer-profile fit') | disagrees | p. 1, Abstract | “the best-fitting r1/n bulge model which has a Sérsic index n = 1.5” |

<a id="gravity2018"></a>
### GRAVITY 2018 — Detection of the gravitational redshift in the orbit of the star S2 near the Galactic centre massive black hole

A&A 615, L15 (2018) · [doi:10.1051/0004-6361/201833718](https://doi.org/10.1051/0004-6361/201833718) · [arXiv:1807.09409](https://arxiv.org/abs/1807.09409) · [2018A&A...615L..15G](https://ui.adsabs.harvard.edu/abs/2018A%26A...615L..15G)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| R0 (Sun to Galactic centre distance) | 8.122 kpc (R0_PC = 8122) | verified | p. 10, Table A.1 | “R0 8127 ± 31 8122 ± 31 pc” |

<a id="gray2003"></a>
### Gray R. O. et al. 2003 — Contributions to the Nearby Stars (NStars) Project: Spectroscopy of Stars Earlier than M0 within 40 Parsecs: The Northern Sample. I.

AJ 126, 2048-2059 (2003) · [doi:10.1086/378365](https://doi.org/10.1086/378365) · [arXiv:astro-ph/0308182](https://arxiv.org/abs/astro-ph/0308182) · [2003AJ....126.2048G](https://ui.adsabs.harvard.edu/abs/2003AJ....126.2048G)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Castor A (HIP 36850, HD 60178) spectral type | A1.5IV | verified | p. 18, Table 1 | “36850 60178 A1.5 IV+” |

<a id="gurnett2013"></a>
### Gurnett & Kurth 2013 — In Situ Observations of Interstellar Plasma with Voyager 1

Science 341, 1489-1492 (2013) · [doi:10.1126/science.1241681](https://doi.org/10.1126/science.1241681) · [2013Sci...341.1489G](https://ui.adsabs.harvard.edu/abs/2013Sci...341.1489G)

- **Copy:** `publishedVersion`
- **Note:** Authors are Gurnett, Kurth, Burlaga & Ness, not 'Gurnett & Kurth'

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Voyager 1 heliopause crossing epoch | 2012-08-25 | verified | p. 1491 | “the GCR intensity increase on 25 August 2012 marked the crossing of Voyager 1 into the interstellar plasma” |

<a id="gurnett2019"></a>
### Gurnett & Kurth 2019 — Plasma densities near and beyond the heliopause from the Voyager 1 and 2 plasma wave instruments

Nature Astronomy 3, 1024-1028 (2019) · [doi:10.1038/s41550-019-0918-5](https://doi.org/10.1038/s41550-019-0918-5) · [2019NatAs...3.1024G](https://ui.adsabs.harvard.edu/abs/2019NatAs...3.1024G)

- **Copy:** `publishedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Voyager 2 heliopause crossing | 2018-11-05 | verified | p. 1024 | “V2 tentatively reached the heliopause13–16 on 5 November 2018 at a heliocentric radial distance of 119.0 au” |

<a id="halbwachs2023"></a>
### Halbwachs et al. 2023 — Gaia Data Release 3

A&A 674, A9 · [doi:10.1051/0004-6361/202243969](https://doi.org/10.1051/0004-6361/202243969) · [arXiv:2206.05726](https://arxiv.org/abs/2206.05726)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Gaia DR3 NSS two-body orbits with Thiele-Innes fits (source catalogue) |  | verified | p. 7, Sect. 4 | “A, B, F, and G are the Thiele-Innes (TI) elements” |
| Thiele-Innes -> Campbell closed form (tree says Appendix C; Eq. 16 for the forward convention) | u=(A²+B²+F²+G²)/2, v=AG−BF, a²=u+√(u²−v²); A=a(cosω cosΩ − sinω sinΩ cos i) ...; Ω in [0, π) | disagrees | p. 12, Appendix A, Eqs. (A.1)-(A.3) | “Appendix A: Conversion of Thiele-Innes elements (A, B, F, G) into Campbell elements (a, i, Ω, ω)” |
| TI elements describe the photocentre orbit; a0 = \|q − β\|·a_rel | a0 = \|q − β\|·a_rel | verified | p. 7, Eq. (14) | “Taking into account that a0 refers to the orbit of the photocentre, the third Kepler law gives the following expression” |

<a id="hamann2006"></a>
### Hamann W.-R. et al. 2006 — The Galactic WN stars

A&A 457, 1015-1031 (2006) · [doi:10.1051/0004-6361:20065052](https://doi.org/10.1051/0004-6361:20065052) · [2006A&A...457.1015H](https://ui.adsabs.harvard.edu/abs/2006A%26A...457.1015H)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| WN Teff ramp endpoints | WN2 ~141 kK, WN8 ~45 kK | verified | p. 7, Table 2 | “2 WN2-w 141.3 ... 16 WN8h 44.7” |

<a id="hargis2020"></a>
### Hargis 2020 — Hubble Space Telescope Imaging of Antlia B: Star Formation History and a New Tip of the Red Giant Branch Distance

ApJ 888, 31 (2020) · [doi:10.3847/1538-4357/ab58d2](https://doi.org/10.3847/1538-4357/ab58d2) · [2020ApJ...888...31H](https://ui.adsabs.harvard.edu/abs/2020ApJ...888...31H)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Antlia B transition-dwarf (dTrans) type | dTr (transition dwarf) | verified | p. 1, Abstract | “no evidence of active star formation (i.e., no Hα emission) and should therefore be classified as a dTrans dwarf” |

<a id="harris1961"></a>
### Harris 1961 — Photometry and colorimetry of planets and satellites

Ch. 8 in Planets and Satellites (The Solar System vol. III), Kuiper & Middlehurst (eds), University of Chicago Press (1961), pp. 272-342 · [1961plsa.book..272H](https://ui.adsabs.harvard.edu/abs/1961plsa.book..272H)

- **Copy:** not held
- **Identification:** book — Standard source for satellite UBV colours Chapter title/pages not network-verified

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| satellite colours carried by Frey & Lowman / Newburn & Gulkis |  | unverified |  |  |

<a id="hartkopf2001"></a>
### Hartkopf, Mason & Worley 2001 — The 2001 US Naval Observatory Double Star CD-ROM. II. The Fifth Catalog of Orbits of Visual Binary Stars

AJ 122, 3472 · [doi:10.1086/323921](https://doi.org/10.1086/323921)

- **Copy:** `publishedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| ORB6 visual orbital elements (catalogue source) |  | verified | p. 3472, Abstract | “The Fifth Catalog of Orbits of Visual Binary Stars continues the series of compilations of visual binary star orbits” |

<a id="heintz1978"></a>
### Heintz 1978 — Double Stars

D. Reidel (Geophysics and Astrophysics Monographs 15), 1978 · [doi:10.1007/978-94-009-9836-0](https://doi.org/10.1007/978-94-009-9836-0)

- **Copy:** not held
- **Identification:** book — Crossref book DOI, author Heintz 1978; standard reference for Thiele-Innes/Campbell relations Bibcode from usage, not verified; bibcode 1978GAM....15.....H did not resolve via ADS link gateway (may be valid but lacks a full-text link)

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Thiele-Innes -> Campbell element algebra |  | unverified |  |  |

<a id="hoffleit1991"></a>
### Hoffleit & Warren 1991 — The Bright Star Catalogue, 5th Revised Ed. (Preliminary Version)

Astronomical Data Center, NSSDC/ADC (1991); VizieR V/50 · [1991bsc..book.....H](https://ui.adsabs.harvard.edu/abs/1991bsc..book.....H)

- **Copy:** not held
- **Identification:** book — CDS ReadMe V/50: Hoffleit D., Warren W.H. Jr, =1991bsc..book.....H Catalogue, no DOI

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| V/50 HR <-> HD mapping |  | verified | l. 81, l. 86 | “HR       [1/9110]+ Harvard Revised Number ... HD       [1/225300]? Henry Draper Catalog Number” |
| row count | 9,110 rows | verified | l. 35, l. 70 | “The  BSC  contains  9110  objects,  of  which  9096 are stars” |
| rows carrying an HD; the 14 HD-less entries are non-stellar | 9,096 with HD | verified | l. 35-37 | “14 objects catalogued in the original compilation of 1908 are novae or extragalactic objects” |

<a id="hog2000"></a>
### Høg et al. 2000 — The Tycho-2 Catalogue

A&A 355, L27 · [2000A&A...355L..27H](https://ui.adsabs.harvard.edu/abs/2000A%26A...355L..27H)

- **Copy:** `ADS scan of published article`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Tycho-2 (I/259): positions, proper motions, BT/VT photometry, main catalogue + supplement 1 |  | verified | p. L27, Sect. 1 | “The Tycho-2 Catalogue contains positions, proper motions and two-colour photometric data for the 2.5 million brightest stars” |
| epoch of the catalogue's mean positions | 'positions at each star's own mean epoch' (README.md); 'mean positions with per-star, per-coordinate mean epochs' (SCIENCE.md); 'positions (per-star mean epochs)' (catalog-driver) | disagrees | p. L29, Sect. 2 | “But in the catalogue we give the mean position, rigorously propagated to the epoch J2000.0 by means of the proper motion.” |
| no Gaia reduction behind Tycho-2 |  | verified | p. L27, Sect. 1 | “The proper motions are derived for 96 per cent of the stars from the observed positions in Tycho-2, the Astrographic Catalogue and 143 other ground-based catalogues” |

<a id="huchra2012"></a>
### Huchra et al. 2012 — 2MRS

ApJS 199, 26 · [arXiv:1108.0669](https://arxiv.org/abs/1108.0669)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| 2MRS sample size and magnitude limit | 44,599 galaxies, Ks <= 11.75 | verified | p. 1, Abstract | “We selected a sample of 44,599 2MASS galaxies with Ks ≤ 11.75 mag and \|b\| ≥ 5◦” |
| 2MRS completeness | 97.6% complete | verified | p. 1, Abstract | “a redshift catalog that is 97.6% complete to well-defined limits and covers 91% of the sky” |
| 2MRS sky coverage | all-sky | disagrees | p. 1, Abstract | “covers 91% of the sky” |

<a id="ibata1997"></a>
### Ibata et al. 1997 — The Kinematics, Orbit, and Survival of the Sagittarius Dwarf Spheroidal Galaxy

AJ 113, 634 · [doi:10.1086/118283](https://doi.org/10.1086/118283) · [arXiv:astro-ph/9612025](https://arxiv.org/abs/astro-ph/9612025)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Sagittarius dSph red-clump line-of-sight depth | 1.2 kpc | verified | p. 7 | “The red clump stars provide the most robust estimate of the line-of-sight depth, and from above the half-brightness depth is 1.2 kpc.” |
| Sagittarius dSph prolate, axis ratios 3:1:1 | 3:1:1 | verified | p. 7 | “The 3-dimensional shape of the Sgr dwarf is thus a prolate spheroid with axis ratios 3:1:1” |
| Sagittarius override semi-axes | a/b/c = 2616 / 942 / 1000 pc (c = line of sight), ref_doi 10.1086/118283 | disagrees | p. 7 | “the half-brightness minor axis diameter, for a distance of 25 kpc, is 2 × 550 pc” |

<a id="ignatiev2009"></a>
### Ignatiev et al. 2009 — Altimetry of the Venus cloud tops from the Venus Express observations

JGR Planets 114, E00B43 (2009) · [doi:10.1029/2008JE003320](https://doi.org/10.1029/2008JE003320) · [2009JGRE..114.0B43I](https://ui.adsabs.harvard.edu/abs/2009JGRE..114.0B43I)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Venus cloud-top altitude (low and middle latitudes) | ~74 km | verified | p. 1, Abstract | “In low and middle latitudes the cloud top is located at 74 ± 1 km.” |
| pressure at the cloud top | P ≈ 40 hPa at ~74 km | disagrees | p. 1, Sect. 1 | “above the main cloud which top is located at about 40 mbar (68 km)” |

<a id="ireland2004"></a>
### Ireland et al. 2004 — On the observability of geometric pulsation of M-type Mira variables

MNRAS 352, 318-324 (2004) · [doi:10.1111/j.1365-2966.2004.07928.x](https://doi.org/10.1111/j.1365-2966.2004.07928.x) · [2004MNRAS.352..318I](https://ui.adsabs.harvard.edu/abs/2004MNRAS.352..318I)

- **Copy:** `ADS scan of published article`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Mira physical radius variation | ~1.1-1.5x (radius swing max/min) | disagrees | p. 323, Sect. 6; p. 321, Fig. 4 | “The amplitude of geometric pulsation of near-infrared-continuum forming layers is of the order of ±30 per cent for the P model series” |

<a id="irwin2024"></a>
### Irwin et al. 2024 — Modelling the seasonal cycle of Uranus's colour and magnitude, and comparison with Neptune

MNRAS 527, 11521-11538 (2024) · [doi:10.1093/mnras/stad3761](https://doi.org/10.1093/mnras/stad3761) · [2024MNRAS.52711521I](https://ui.adsabs.harvard.edu/abs/2024MNRAS.52711521I)

- **Copy:** `publishedVersion`
- **Note:** Correction: 10.1093/mnras/stae304

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Neptune's true colour is paler than the Voyager 2 images (the contrast-enhanced 'OGB' composite) |  | verified | p. 11522 | “the early-Neptune images were contrast-enhanced to accentuate fainter features and do not accurately represent the true colour of this planet” |

<a id="jonsson2020"></a>
### Jönsson H. et al. 2020 — APOGEE Data and Spectral Analysis from SDSS Data Release 16

AJ 160, 120 · [2020AJ....160..120J](https://ui.adsabs.harvard.edu/abs/2020AJ....160..120J)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| literature rv bibcode 2020AJ....160..120J (APOGEE DR16 radial velocities); source of most above-escape rv values |  | verified | p. 11, Sect. 5.1 | “The radial velocities are provided in the VHELIO AVG entry in the allStar file.” |

<a id="juric"></a>
### Jurić M. et al. 2008 — The Milky Way Tomography with SDSS. I. Stellar Number Density Distribution

ApJ 673, 864-914 (2008) · [doi:10.1086/523619](https://doi.org/10.1086/523619) · [arXiv:astro-ph/0510520](https://arxiv.org/abs/astro-ph/0510520) · [2008ApJ...673..864J](https://ui.adsabs.harvard.edu/abs/2008ApJ...673..864J)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Milky Way decomposition into thin disc, thick disc and halo (third component, not adopted) |  | verified | p. 1, Abstract | “The data show strong evidence for a Galaxy consisting of an oblate halo, a disk component, and a number of localized overdensities.” |

<a id="kainulainen2009"></a>
### Kainulainen et al. 2009 — Probing the evolution of molecular cloud structure: From quiescence to birth

A&A 508, L35-L38 (2009) · [doi:10.1051/0004-6361/200913605](https://doi.org/10.1051/0004-6361/200913605) · [arXiv:0911.5648](https://arxiv.org/abs/0911.5648) · [2009A&A...508L..35K](https://ui.adsabs.harvard.edu/abs/2009A%26A...508L..35K)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| power-law tail in SF clouds |  | verified | p. 1, Abstract | “at higher column densities prominent, power-law-like wings are common. In particular, we identify a trend among the PDFs: active star-forming clouds always have prominent non-log-normal wings” |

<a id="karachentsev2013"></a>
### Karachentsev, Makarov & Kaisina 2013 — UNGC

AJ 145, 101 · [arXiv:1303.5328](https://arxiv.org/abs/1303.5328)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| planned Tier-1 Local Volume source (UNGC, 869 galaxies) | 869 galaxies | verified | p. 2, Abstract | “We present an all-sky catalog of 869 nearby galaxies, having individual distance estimates within 11 Mpc or corrected radial velocities VLG < 600 km s−1” |

<a id="kepler2007"></a>
### Kepler S. O. et al. 2007 — White dwarf mass distribution in the SDSS

MNRAS 375, 1315-1324 (2007) · [doi:10.1111/j.1365-2966.2006.11388.x](https://doi.org/10.1111/j.1365-2966.2006.11388.x) · [arXiv:astro-ph/0612277](https://arxiv.org/abs/astro-ph/0612277) · [2007MNRAS.375.1315K](https://ui.adsabs.harvard.edu/abs/2007MNRAS.375.1315K)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| mean WD mass 0.6 | 0.6 M☉ | verified | p. 1, Abstract | “The mean mass for the DA stars brighter than g=19 and hotter than Teff = 12 000 K is ⟨M⟩DA ≃ 0.593 ± 0.016 M⊙” |

<a id="kersten2021"></a>
### Kersten et al. 2021 — Controlled global Ganymede mosaic from Voyager and Galileo images

Planet. Space Sci. 206, 105310 (2021) · [doi:10.1016/j.pss.2021.105310](https://doi.org/10.1016/j.pss.2021.105310) · [2021P&SS..20605310K](https://ui.adsabs.harvard.edu/abs/2021P%26SS..20605310K)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Ganymede global colour mosaic |  | verified | p. 1, Abstract; p. 4 | “version of the global Ganymede image mosaic using a combination of Voyager 1 and 2 and Galileo” |

<a id="kilic2020"></a>
### Kilic M. et al. 2020 — The 100 pc White Dwarf Sample in the SDSS Footprint

ApJ 898, 84 (2020) · [doi:10.3847/1538-4357/ab9b8d](https://doi.org/10.3847/1538-4357/ab9b8d) · [arXiv:2006.00323](https://arxiv.org/abs/2006.00323) · [2020ApJ...898...84K](https://ui.adsabs.harvard.edu/abs/2020ApJ...898...84K)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| mean WD mass 0.6 | 0.6 M☉ | verified | p. 1, Abstract | “mass distribution has an extremely narrow peak at 0.59 M” |

<a id="kim2014"></a>
### Kim et al. 2014 — The Extended Virgo Cluster Catalog

ApJS 215, 22 (2014) · [doi:10.1088/0067-0049/215/2/22](https://doi.org/10.1088/0067-0049/215/2/22) · [arXiv:1409.3283](https://arxiv.org/abs/1409.3283) · [2014ApJS..215...22K](https://ui.adsabs.harvard.edu/abs/2014ApJS..215...22K)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| planned Tier-2 Virgo source (EVCC, 1,589 galaxies; 1,183 VCC-only) | 1,589 galaxies; 1,183 VCC-only | verified | p. 2, Abstract; p. 4 | “The EVCC contains a total of 1589 galaxies of which 676 galaxies are not included in the VCC” |

<a id="kolbas2015"></a>
### Kolbas et al. 2015 — Spectroscopically resolving the Algol triple system

MNRAS 451, 4150-4161 (2015) · [doi:10.1093/mnras/stv1261](https://doi.org/10.1093/mnras/stv1261) · [2015MNRAS.451.4150K](https://ui.adsabs.harvard.edu/abs/2015MNRAS.451.4150K)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Algol Aa2 K0IV curated sptype | K0IV | verified | p. 2 (printed 4151), Sect. 2; p. 10 (printed 4159), Table 5 | “The inner pair consists of a late B-type star in orbit with an early K-type subgiant which fills its Roche lobe.” |
| Algol Aa2 M_V ≈ 2.9 | M_V ≈ 2.9 | not in paper |  |  |
| component types 'B8V + K0IV + A7m' | B8V + K0IV + A7m | not in paper | p. 2 (printed 4151), Sect. 2 | “its spectral classification has been variously given as late A, early F and Am.” |

<a id="kostjuk2002"></a>
### Kostjuk N.D. 2002 — HD-DM-GC-HR-HIP-Bayer-Flamsteed Cross Index

VizieR IV/27A; Institute of Astronomy, Russian Academy of Sciences (2002)

- **Copy:** not held
- **Identification:** book — CDS ReadMe IV/27A: Kostjuk N.D., 2002 Data catalogue, no DOI; bibcode 2002yCat.4027....0K did not resolve via ADS link gateway (may be valid but lacks a full-text link)

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| IV/27A Bayer/Flamsteed <-> HD/HR/HIP cross index |  | verified | l. 60-79 | “Fl      ? Flamsteed number ... Bayer   Bayer designation ... Cst     Constellation abbreviation” |
| designation constellation (Cst) |  | verified | l. 79 | “Cst     Constellation abbreviation (G1)” |
| catalogue row count | 3,690 | verified | l. 33 | “catalog.dat    77     3690   HD-DM-GC-HR-HIP-Bayer-Flamsteed Cross Index” |

<a id="lacour2009"></a>
### Lacour et al. 2009 — The Pulsation of chi Cygni Imaged by Optical Interferometry

ApJ 707, 632-643 (2009) · [doi:10.1088/0004-637X/707/1/632](https://doi.org/10.1088/0004-637X/707/1/632) · [arXiv:0910.3869](https://arxiv.org/abs/0910.3869) · [2009ApJ...707..632L](https://ui.adsabs.harvard.edu/abs/2009ApJ...707..632L)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| chi Cyg diameter swing up to ~40 % | ~40 % | verified | p. 1, Abstract | “Images show up to 40% variation in the stellar diameter” |
| minimum diameter near maximum light (φ ≈ 0.94) | φ ≈ 0.94 | verified | p. 9, Sect. 5.1.4 | “Minimum diameter happens at φ = 0.94 ± 0.01.” |
| diameter anti-correlates with flux |  | disagrees | p. 9, Sect. 5.1.4 | “On the other hand, the bolometric flux is mostly correlated with the diameter” |

<a id="lallement2019"></a>
### Lallement et al. 2019 — Gaia-2MASS 3D maps of Galactic interstellar dust within 3 kpc

A&A 625, A135 (2019) · [doi:10.1051/0004-6361/201834695](https://doi.org/10.1051/0004-6361/201834695) · [arXiv:1902.04116](https://arxiv.org/abs/1902.04116) · [2019A&A...625A.135L](https://ui.adsabs.harvard.edu/abs/2019A%26A...625A.135L)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| dust map through which the Local Bubble wall is traced |  | verified | p. 1, Abstract | “We aimed at building 3D maps of the dust in the Local arm and surrounding regions. To do so, Gaia DR2 photometric data were combined with 2MASS measurements” |

<a id="laskar1986"></a>
### Laskar 1986 — Secular terms of classical planetary theories using the results of general theory

A&A 157, 59-70 (1986) · [1986A&A...157...59L](https://ui.adsabs.harvard.edu/abs/1986A%26A...157...59L)

- **Copy:** `ADS scan of published article`
- **Note:** No DOI; title not network-verified

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| obliquity 24.0165 deg at -2950 (cross-check) | 24.0165° | verified | p. 68, Table 8; p. 69, eq. 35 | “The general accumulated precession pA and the obliquity εA are given in arcseconds and the time t is measured in units of 10000 julian years from J2000” |

<a id="leike2020"></a>
### Leike, Glatzle & Enßlin 2020 — Resolving nearby dust clouds

A&A 639, A138 (2020) · [doi:10.1051/0004-6361/202038169](https://doi.org/10.1051/0004-6361/202038169) · [arXiv:2004.06732](https://arxiv.org/abs/2004.06732) · [2020A&A...639A.138L](https://ui.adsabs.harvard.edu/abs/2020A%26A...639A.138L)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| map behind Zucker 2021 mass_leike / max_ak_leike |  | verified | p. 1, Abstract | “We reconstructed a highly resolved dust map, showing the nearest dust clouds at a distance of up to 400 pc with a resolution of 1 pc.” |
| 1 pc resolution of the Leike peaks | 1 pc | verified | p. 1, Abstract; p. 4, Sect. 5 | “only at scales of 2 pc or higher can the result be trusted” |
| band of the map's extinction (A_K question) | A_K | not in paper | p. 2, Fig. 1 caption; p. 5 | “A Mollweide projection of the G-band extinction optical depth a to all sources in the used dataset.” |

<a id="leinert1998"></a>
### Leinert et al. 1998 — The 1997 reference of diffuse night sky brightness

A&AS 127, 1 · [doi:10.1051/aas:1998105](https://doi.org/10.1051/aas:1998105)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Table 24 NGP integrated starlight at 0.55 µm | λI_λ = 250 × 10⁻⁹ W m⁻² sr⁻¹ = 23.83 mag/arcsec² | verified | p. 57 (printed p. 56), Table 24 | “Table 24. Surface brightness due to integrated starlight (given as λIλ, respectively νIν)” |
| Table 24 'Galactic centre' integrated starlight | λI_λ = 577 × 10⁻⁹ W m⁻² sr⁻¹ = 22.92 mag/arcsec² toward the Galactic centre | disagrees | p. 57 (printed p. 56), Table 24; p. 58, Fig. 61 caption | “Fig. 61. Fraction of integrated starlight due to stars brighter than a given magnitude, for two lines of sight: the NGP (dashed curves) and a region at 30° galactic latitude” |
| Table 24 is a SKY-model prediction of total starlight |  | verified | p. 57 (printed p. 56), Sect. 10.1 | “A more detailed model (SKY), both in terms of Galactic shape and the list of sources, has been constructed by M. Cohen and collaborators (Wainscoat et al. 1992” |

<a id="lemmon2015"></a>
### Lemmon et al. 2015 — Dust aerosol, clouds, and the atmospheric optical depth record over 5 Mars years of the Mars Exploration Rover mission

Icarus 251, 96-111 (2015) · [doi:10.1016/j.icarus.2014.03.029](https://doi.org/10.1016/j.icarus.2014.03.029) · [arXiv:1403.4234](https://arxiv.org/abs/1403.4234) · [2015Icar..251...96L](https://ui.adsabs.harvard.edu/abs/2015Icar..251...96L)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Mars background dust tau 0.2-0.5 | τ = 0.2-0.5 | verified | p. 22, Sect. 4.1; p. 55, Fig. 7 | “below ~0.3 by sol 155 (LS=45°), and remained similarly low until about sol 350 (LS=135°). During this time, Opportunity optical depths declined from 0.95 to below ~0.5.” |

<a id="lepine2005"></a>
### Lépine S. & Shara M. M. 2005 — A Catalog of Northern Stars with Annual Proper Motions Larger than 0.15 Seconds of Arc (LSPM Catalog – North)

AJ 129, 1483 · [2005AJ....129.1483L](https://ui.adsabs.harvard.edu/abs/2005AJ....129.1483L)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Gl 863.1A SIMBAD PM source | (1368.0, 111.0) mas/yr | verified | p. 1, Abstract | “A CATALOG OF NORTHERN STARS WITH ANNUAL PROPER MOTIONS LARGER THAN 0.15 SECONDS OF ARC” |

<a id="licquia2015"></a>
### Licquia & Newman 2015 — IMPROVED ESTIMATES OF THE MILKY WAY’S STELLAR MASS AND STAR FORMATION RATE FROM HIERARCHICAL BAYESIAN META-ANALYSIS

ApJ 806, 96 · [doi:10.1088/0004-637X/806/1/96](https://doi.org/10.1088/0004-637X/806/1/96) · [arXiv:1407.1078](https://arxiv.org/abs/1407.1078)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| bulge-to-total stellar mass 0.150 | 0.150 (+0.028/−0.019) | verified | p. 1, Abstract; p. 16 | “Milky Way of B/T = 0.150+0.028−0.019” |
| stellar mass split M* / bulge / disc | 6.08 ± 1.14, 0.91 ± 0.07, 5.17 ± 1.11 × 10¹⁰ M☉ | verified | p. 1, Abstract | “their combination yields a total stellar mass of M⋆ = 6.08 ± 1.14 × 10^10 M⊙ (assuming a Kroupa” |
| IMF of the mass estimates | Chabrier IMF | disagrees | p. 1, Abstract | “Kroupa initial mass function (IMF)” |

<a id="licquia2015b"></a>
### Licquia, Newman & Brinchmann 2015 — Unveiling the Milky Way: A New Technique for Determining the Optical Color and Luminosity of Our Galaxy

ApJ 809, 96 (2015) · [doi:10.1088/0004-637X/809/1/96](https://doi.org/10.1088/0004-637X/809/1/96) · [arXiv:1508.04446](https://arxiv.org/abs/1508.04446) · [2015ApJ...809...96L](https://ui.adsabs.harvard.edu/abs/2015ApJ...809...96L)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Milky Way analogues behind BHG16 M_V and colour | M_V = −21.37, B−V = 0.73 (via BHG16 Table 2) | verified | p. 15, Table 3; p. 17 | “these compare well with our slightly brighter estimates of 0MB = −20.84 and 0MV = −21.51” |

<a id="lieske1979"></a>
### Lieske 1979 — Precession matrix based on IAU (1976) system of astronomical constants

A&A 73, 282-284 (1979) · [1979A&A....73..282L](https://ui.adsabs.harvard.edu/abs/1979A%26A....73..282L)

- **Copy:** `ADS scan of published article`
- **Note:** No DOI; the defining IAU 1976 precession paper is Lieske et al. 1977 A&A 58, 1 — tree's 'Lieske 1979' is the matrix paper, fine for the rotation; title not network-verified

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| IAU 1976 precession angles ζ, z, θ from J2000 | ζ = 2306.2181t + 0.30188t² + 0.017998t³; z = 2306.2181t + 1.09468t² + 0.018203t³; θ = 2004.3109t − 0.42665t² − 0.041833t³ (arcsec) | verified | p. 283, eq. 7 | “ζA=(2306''.2181+1''.39656T−0''.000139T²)t+(0''.30188−0''.000344T)t²+0''.017998t³” |
| Besselian epoch → JD | JD = 2415020.31352 + (B − 1900) × 365.242198781 | verified | p. 282, eq. 2 | “BE=1900.0+(JED−2415020.31352)/365.242198781” |
| rotation composition | Rz(−z)·Ry(−θ)·Rz(−ζ) | disagrees | p. 283, eqs. 3, 5, 6 | “r=R(−zA)Q(θA)R(−ζA)r0” |

<a id="lindal1983"></a>
### Lindal et al. 1983 — The atmosphere of Titan: An analysis of the Voyager 1 radio occultation measurements

Icarus 53, 348-363 (1983) · [doi:10.1016/0019-1035(83)90155-0](https://doi.org/10.1016/0019-1035(83)90155-0) · [1983Icar...53..348L](https://ui.adsabs.harvard.edu/abs/1983Icar...53..348L)

- **Copy:** `publishedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Titan 1.5-bar N2 column | 1.5 bar | verified | p. 348, Abstract; p. 354 | “temperature and pressure at the surface of 94.0 ± 0.7°K and 1496 ± 20 mbar, respectively.” |

<a id="lindegren2021"></a>
### Lindegren et al. 2021 — Gaia Early Data Release 3

A&A 649, A4 · [doi:10.1051/0004-6361/202039653](https://doi.org/10.1051/0004-6361/202039653) · [arXiv:2012.03380](https://arxiv.org/abs/2012.03380)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| parallax zero-point bias (applied upstream in Bailer-Jones) |  | not in paper | p. 11, Sect. 3.4.4 | “The global parallax zero point of EDR3 is about −17 µas (Lindegren et al. 2020).” |

<a id="makarov2014"></a>
### Makarov et al. 2014 — HyperLEDA. III. The catalogue of extragalactic distances

A&A 570, A13 (2014) · [doi:10.1051/0004-6361/201423496](https://doi.org/10.1051/0004-6361/201423496) · [arXiv:1408.3476](https://arxiv.org/abs/1408.3476) · [2014A&A...570A..13M](https://ui.adsabs.harvard.edu/abs/2014A%26A...570A..13M)

- **Copy:** `publishedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| deferred PA/axial-ratio/T-type source (HyperLEDA) |  | verified | p. 3, Sect. 2 | “Sizes and position angles: These catalogues compile information on major and minor diameters of objects as well as the position angle of the major axis” |

<a id="mallama2012"></a>
### Mallama 2012 — Improved luminosity model and albedo for Saturn

Icarus 218, 56-59 (2012) · [doi:10.1016/j.icarus.2011.11.035](https://doi.org/10.1016/j.icarus.2011.11.035) · [2012Icar..218...56M](https://ui.adsabs.harvard.edu/abs/2012Icar..218...56M)

- **Copy:** `publishedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| origin of the Saturn ring-tilt law | ΔV = −1.825·sin β + 0.026·α − 0.378·sin β·e^(−2.25·α), V₁(0) = −8.914 | verified | p. 58, Table 2; p. 56, eq. 1 | “b is the effective inclination of the ring system (specifically, the square root of the product of the saturnicentric latitude of the Sun and the saturnicentric latitude of the Earth, set to zero when the signs are opposite)” |

<a id="mallama2017"></a>
### Mallama, Krobusek & Pavlov 2017 — Comprehensive wide-band magnitudes and albedos for the planets, with applications to exo-planets and Planet Nine

Icarus 282, 19-33 · [doi:10.1016/j.icarus.2016.09.023](https://doi.org/10.1016/j.icarus.2016.09.023) · [arXiv:1609.05048](https://arxiv.org/abs/1609.05048)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| planet B−V / V−Rc (Table 3) for texture calibration | B−V, V−Rc: Mercury 0.97/0.52, Venus 0.70/0.35, Earth 0.47/0.29, Mars 1.36/0.82, Jupiter 0.86/0.35, Saturn 1.07/0.51, Uranus 0.50/−0.27, Neptune 0.39/−0.33 | verified | p. 9, Table 3 | “Table 3. Johnson-Cousins magnitudes” |
| Saturn photometric V vs synthetic Rc disagree by 0.17 mag | 0.17 mag | verified | p. 9, Table 3 | “Saturn Photometric -7.08 -7.84 -8.91 -9.59 -9.61 ---- ----” |
| no adopted index row for Pluto |  | verified | p. 26 | “We did not establish reference magnitude for Pluto in this paper” |
| V-band geometric albedos | Mercury 0.142, Venus 0.689, Earth 0.434, Mars 0.170, Jupiter 0.538, Saturn 0.499, Uranus 0.488, Neptune 0.442 | verified | p. 16, Table 7 | “Table 7. Geometric albedos” |
| Mercury phase polynomial (Table A-1.2), valid to 170° | c1..c7 = 6.617e-2, −1.867e-3, 4.103e-5, −4.583e-7, 2.643e-9, −7.012e-12, 6.592e-15; αmax 170° | verified | p. 36, Table A-1.2 | “The observed phase angles ranged from 2 to 170 degrees. While coefficients were only derived for the V band” |
| Venus phase polynomial (Table A-2.2 V), valid to 165° | c1..c4 = −1.044e-3, 3.687e-4, −2.814e-6, 8.938e-9; αmax 165° | verified | p. 37-38, Table A-2.2 | “The phase function up to 165 degrees is well characterized by the observed Johnson-Cousins coefficients listed in Table A-2.2.” |
| Earth phase table (Table A-3.1) | (45°, 1.123), (90°, 2.069), (135°, 3.801); αmax 135° | verified | p. 39, Table A-3.1 | “Representative values of the phase function, normalized to zero magnitudes at phase angle zero, are listed in Table A-3.1.” |
| Mars phase polynomial (Table A-4.2 V), valid to ~50° | c1, c2 = 2.267e-2, −1.302e-4; αmax 50° | verified | p. 40-41, Table A-4.2 | “The observed illumination phase angles ranged from a few degrees up to about 50 degrees.” |
| Jupiter phase polynomial (Table A-5.2 V), 0-12° | c1, c2 = −3.7e-4, 6.16e-4; αmax 12° | verified | p. 42-43, Table A-5.2 | “The observed phase angles ranged from 0 to 12 degrees.” |
| Uranus/Neptune: no phase polynomial, latitude/temporal terms instead (Tables A-7.2 / A-8.2) |  | verified | p. 46, Table A-7.2; p. 47-48, Table A-8.2 | “The maximum phase angle for Uranus is only 3 degrees, so its effect on the planet's brightness is” |
| Pluto: no published phase polynomial |  | verified | p. 26 | “We did not establish reference magnitude for Pluto in this paper” |
| coverage: phase-angle polynomials for Mercury, Venus, Earth, Mars, Jupiter and Saturn |  | disagrees | p. 39, Table A-3.1; p. 44, Table A-6.2 | “Table A-6.2. Observed Johnson-Cousins system coefficients for Saturn” |
| Moon not covered (planets only) |  | verified |  |  |

<a id="mallamahilton2018"></a>
### Mallama & Hilton 2018 — Computing apparent planetary magnitudes for The Astronomical Almanac

Astronomy and Computing 25, 10-24 (2018) · [doi:10.1016/j.ascom.2018.08.002](https://doi.org/10.1016/j.ascom.2018.08.002) · [2018A&C....25...10M](https://ui.adsabs.harvard.edu/abs/2018A%26C....25...10M)

- **Copy:** `submittedVersion`
- **Note:** Equation numbers (10, 12) not verified

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Saturn ring-tilt law (Eq. 10) | V₁(0) = −8.914; ΔV = −1.825·sin β + 0.026·α − 0.378·sin β·e^(−2.25·α); α < 6.5°, β < 27° | verified | p. 18, Eq. 10 | “used these latitude values as indicated in Eq. 10 which applies to α < 6.5 and β < 27 for the planet and rings.” |
| effective inclination β = √(β_E·β_S), zero for opposite signs |  | verified | p. 18 | “The effective inclination, β, is (βEβS)1/2 when βE and βS have the same sign, and β= 0, when βE and βS have contrary signs.” |
| Saturn globe V₁(0) = −8.95 (Eq. 11), zero-point delta 0.036 | −8.95; globeZeroPointDelta 0.036 | verified | p. 19, Eq. 11 | “V = 5 log10 ( r d ) - 8.95 - 3.7E-04 α + 6.16E-04 α²” |
| Saturn globe phase fit (Eq. 12) | c1..c4 = 2.446e-4, 2.672e-4, −1.505e-6, 4.767e-9; valid 6°-150°; fit to Dyudina's Pioneer-based model | verified | p. 20, Eq. 12 | “Eq. 12 may be used to compute an approximate V magnitude for the globe of Saturn only when 6 < α < 150” |

<a id="martins2005"></a>
### Martins, Schaerer & Hillier 2005 — A new calibration of stellar parameters of Galactic O stars

A&A 436, 1049-1065 (2005) · [doi:10.1051/0004-6361:20042386](https://doi.org/10.1051/0004-6361:20042386) · [arXiv:astro-ph/0503346](https://arxiv.org/abs/astro-ph/0503346) · [2005A&A...436.1049M](https://ui.adsabs.harvard.edu/abs/2005A%26A...436.1049M)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| O5V log Q_H | 49.3 | verified | p. 15, Table 1 | “5 41540 3.92 -5.21 -3.82 5.51 11.08 37.28 24.38 23.71 49.26 48.59” |
| O6V log Q_H | 48.9 | disagrees | p. 15, Table 1 | “6 38151 3.92 -4.92 -3.57 5.30 10.23 31.73 24.15 23.39 48.96 48.19” |
| O7V log Q_H | 48.6 | verified | p. 15, Table 1 | “7 35531 3.92 -4.63 -3.36 5.10 9.37 26.52 23.91 22.89 48.63 47.62” |
| O8V log Q_H | 48.3 | verified | p. 15, Table 1 | “8 33383 3.92 -4.34 -3.18 4.90 8.52 21.95 23.65 22.08 48.29 46.73” |
| O9V log Q_H | 48.0 | disagrees | p. 15, Table 1 | “9 31524 3.92 -4.05 -3.01 4.72 7.73 18.03 23.34 21.21 47.90 45.77” |
| giants/supergiants: same class row +0.3 dex | +0.3 dex | disagrees | p. 15, Tables 2-3 | “Table 2. Same as Table 1 for luminosity class III stars.” |

<a id="mason2001"></a>
### Mason et al. 2001 — The 2001 US Naval Observatory Double Star CD-ROM. I. The Washington Double Star Catalog

AJ 122, 3466 · [doi:10.1086/323920](https://doi.org/10.1086/323920)

- **Copy:** `publishedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| WDS pair separations/PAs/magnitudes |  | verified | p. 3466, Abstract | “The WDS contains positions (J2000), discoverer designations, epochs, position angles, separations, magnitudes, spectral types, proper motions” |

<a id="mason2020"></a>
### Mason B. D. et al. 2020

- **Copy:** not held
- **Identification:** mismatch — ORB6 row for 15232+3017 STF1937AB P=15204.9 d (the value the tree quotes) cites Mut2010b = Muterspaugh et al. 2010 AJ 140, 1623 (2010AJ....140.1623M) No specific 'Mason+ 2020' eta CrB orbit found; the orbit in the committed ORB6 file is Muterspaugh et al. 2010. Treat 'Mason+ 2020' as a misattribution (possibly to the ORB6 catalogue itself, which Mason/Hartkopf maintain)

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| eta CrB AB visual orbit | P = 41.623 yr = 15204.9 d | not in paper | unverified |  |

<a id="mccomas2015"></a>
### McComas et al. 2015 — LOCAL INTERSTELLAR MEDIUM: SIX YEARS OF DIRECT SAMPLING BY IBEX

ApJS 220, 22 · [doi:10.1088/0067-0049/220/2/22](https://doi.org/10.1088/0067-0049/220/2/22)

- **Copy:** `publishedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| ISM He inflow upwind (nose) direction, J2000 ecliptic | (λ, β) = (255.7°, 5.1°) ≈ ICRS RA 17h00m, Dec −17.6° | verified | p. 8, Table 3 | “Working values” (1000 AU) 25.4 75.7 −5.1 7500” |

<a id="mcconnachie2012"></a>
### McConnachie 2012 — THE OBSERVED PROPERTIES OF DWARF GALAXIES IN AND AROUND THE LOCAL GROUP

AJ 144, 4 · [doi:10.1088/0004-6256/144/1/4](https://doi.org/10.1088/0004-6256/144/1/4) · [arXiv:1204.1562](https://arxiv.org/abs/1204.1562)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| M 32 optical-extent semi-axes | 1.6 / 1.2 / 1.2 kpc | not in paper | p. 101, Table 3 | “M32 8.1 0.1 0.47 0.05 11.1:f 159 2 0.25 0.02 -16.4 0.2 110” |
| M 32 position angle | 159° | verified | p. 101, Table 3 | “M32 8.1 0.1 0.47 0.05 11.1:f 159 2 0.25 0.02” |
| NGC 205 optical-extent semi-axes | 2.7 / 1.5 / 1.5 kpc | not in paper | p. 101, Table 3 | “NGC 205 8.1 0.1 2.46 0.10 15.4: g 28 5 0.43 0.10 -16.5 0.1 590” |
| NGC 205 position angle | 170° | disagrees | p. 101, Table 3 | “NGC 205 8.1 0.1 2.46 0.10 15.4: g 28 5 0.43 0.10” |
| designation cross-IDs (aliases.tsv) | M 32 = NGC 221; NGC 205 = M110; NGC 147 = DDO 3; NGC 6822 = IC 4895 / Barnard's Galaxy; IC 1613 = DDO 8 / UGC 668; WLM = DDO 221 / UGCA 444; Leo A = Leo III / DDO 69 / UGC 5364; LGS 3 = Pisces I; Aquarius = DDO 210 ... | verified | p. 90–92, Table 1 | “NGC 6822 IC 4895 L/G dIrr 19h44m56.6s -14d47m21s Barnard (1884) ... DDO 209 Barnard’s Galaxy” |
| Aquarius = DDO 210 as a transition (dIrr/dSph) dwarf | dTr / dIrr | verified | p. 92, Table 1; p. 32 | “these so-called transition systems, such as DDO210, distinguish themselves from dIrrs” |

<a id="mcconnachie2018"></a>
### McConnachie et al. 2018 — The Large-scale Structure of the Halo of the Andromeda Galaxy. II. Hierarchical Structure in the Pan-Andromeda Archaeological Survey

ApJ 868, 55 · [doi:10.3847/1538-4357/aae8e7](https://doi.org/10.3847/1538-4357/aae8e7) · [arXiv:1810.08234](https://arxiv.org/abs/1810.08234)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| M31 disc inclination | i = 77° | verified | p. 5, Fig. 4 caption | “The inner red ellipse represents a disk of inclination 77◦ and radius 1.25◦ (17kpc), the approximate edge of the “classical” regular M31 stellar disk.” |
| M31 line-of-nodes position angle | PA = 37° | not in paper |  |  |
| M31 disc radius | 15 kpc | disagrees | p. 5, Fig. 4 caption | “a disk of inclination 77◦ and radius 1.25◦ (17kpc)” |
| M31 disc thickness | 500 pc | not in paper |  |  |

<a id="mcmillan"></a>
### McMillan P. J. 2017 — The mass distribution and gravitational potential of the Milky Way

MNRAS 465, 76-94 (2017) · [doi:10.1093/mnras/stw2759](https://doi.org/10.1093/mnras/stw2759) · [arXiv:1608.00971](https://arxiv.org/abs/1608.00971) · [2017MNRAS.465...76M](https://ui.adsabs.harvard.edu/abs/2017MNRAS.465...76M)

- **Copy:** `submittedVersion`
- **Note:** No year in tree; R0 ~8.2 selects McMillan 2017 over McMillan 2011 (MNRAS 414, 2446, R0=8.29)

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| bulge density form: power law times Gaussian (rejected by tree) |  | verified | p. 2, eq. 1 | “ρb = ρ0,b / (1 + r′/r0)^α exp[−(r′/rcut)²] ... with α = 1.8, r0 = 0.075 kpc, rcut = 2.1 kpc, and axis ratio q = 0.5” |
| Sun–Galactic-Centre distance | R0 ≈ 8.2 kpc (viewpoint vector \|(−58.9, 7237.9, −3846.9)\| = 8197 pc) | verified | p. 1, Abstract | “we find that the Sun is R0 = (8.20 ± 0.09) kpc from the Galactic Centre” |

<a id="meeus"></a>
### Meeus J. 1998 — Astronomical Algorithms, 2nd ed.

Willmann-Bell, Richmond VA (1998); ISBN 0-943396-61-1 · [1998aalg.book.....M](https://ui.adsabs.harvard.edu/abs/1998aalg.book.....M)

- **Copy:** not held
- **Identification:** book — ch. 7 calendar, ch. 47 ELP-2000/82 truncated lunar series

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| truncated ELP-2000/82 lunar series (ch. 47): 60 lon / 60 lat / 46 distance terms |  | unverified |  |  |
| series accuracy ~10" in longitude, ~4" in latitude near the present | ~10" / ~4" | unverified |  |  |
| worked example 47.a, 1992 April 12.0 TD (JDE 2448724.5) and its intermediate arguments | JDE 2448724.5 | unverified |  |  |
| Julian/Gregorian calendar switch 1582 Oct 15 for JD (ch. 7) |  | unverified |  |  |
| JDE is conventionally TT |  | unverified |  |  |

<a id="merand2011"></a>
### Merand et al. 2011 — The nearby eclipsing stellar system delta Velorum

A&A 532, A50 (2011) · [doi:10.1051/0004-6361/201116896](https://doi.org/10.1051/0004-6361/201116896) · [2011A&A...532A..50M](https://ui.adsabs.harvard.edu/abs/2011A%26A...532A..50M)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| δ Vel component spectral types | Aa = A2IV, Ab = A4V | not in paper | p. 1, Abstract | “The main component is an eclipsing binary composed of two early A-type stars in rapid rotation.” |

<a id="montalto2021"></a>
### Montalto et al. 2021 — The all-sky PLATO input catalogue

A&A 653, A98 · [doi:10.1051/0004-6361/202140717](https://doi.org/10.1051/0004-6361/202140717) · [arXiv:2108.13712](https://arxiv.org/abs/2108.13712)

- **Copy:** `acceptedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| BP−RP → Teff fifth-order polynomial coefficients | 9453.14, −6859.40, 3542.16, −1053.09, 165.635, −10.5672 | verified | p. 11, eq. 4 | “T eff (K) = 9453.14 − 6859.40 (GBP − GRP )0 + + 3542.16 (GBP − GRP )20 + − 1053.09 (GBP − GRP )30” |
| validity range of the Teff relation | 0.5 < BP−RP < 5.0 | verified | p. 11, below eq. 4 | “where the relation is valid for 0.5 <(GBP − GRP ) < 5.” |

<a id="montegriffo2023"></a>
### Gaia Collaboration, Montegriffo P., Bellazzini M., De Angeli F. et al. 2023 — Gaia Data Release 3

A&A 674, A33 · [doi:10.1051/0004-6361/202243880](https://doi.org/10.1051/0004-6361/202243880) · [arXiv:2206.06205](https://arxiv.org/abs/2206.06205)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| GSPC Johnson-Kron-Cousins B, V per source from each star's own XP spectrum |  | verified | p. 30, Sect. 6.2 (arXiv:2206.06215 preprint — NOT the repo copy) | “we produced the Gaia Synthetic Photometry Catalogue (GSPC), which includes the vast majority of the approximately 220 million stars with XP spectra” |
| GSPC per-band flag polarity: 1 = in validated range; flag-0 magnitude is an extrapolation of the standardisation | flag = 1 means in range | verified | p. 30, Sect. 6.2 (arXiv:2206.06215 preprint — NOT the repo copy) | “a value of 1 if the GBP − GRP colour and G magnitude ... are within the ranges where standardisation and validation have been performed” |
| loss of millimag accuracy at bright magnitudes from an XP instrument-setup change (Sect. 3.2) | G ≈ 11.5 | verified | p. 12, Sect. 3.2 (arXiv:2206.06215 preprint) | “the loss of millimag accuracy for G < ∼ 11.5 mag in correspondence with a transition to different setups of the BP and RP spectrometers” |

<a id="morrisonstephenson"></a>
### Morrison L. V. & Stephenson F. R. 2004 — Historical Values of the Earth's Clock Error Delta T and the Calculation of Eclipses

J. Hist. Astron. 35, 327-336 (2004) · [doi:10.1177/002182860403500305](https://doi.org/10.1177/002182860403500305) · [2004JHA....35..327M](https://ui.adsabs.harvard.edu/abs/2004JHA....35..327M)

- **Copy:** `ADS scan of published article`
- **Note:** No year in tree; add 2004 (addendum JHA 36, 339, 2005)

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| long-term ΔT parabola | ΔT = −20 + 32·u² s, u = (year − 1820)/100 | verified | p. 332 | “the long-term mean parabolic trend has the equation ΔT = −20 + 32t² sec, where t is measured in (Julian) centuries from the reference epoch A.D. 1820.” |

<a id="mosenkov2021"></a>
### Mosenkov et al. 2021 — The structure of the Milky Way based on unWISE 3.4 μm integrated photometry

[doi:10.1093/mnras/stab2445](https://doi.org/10.1093/mnras/stab2445) · [arXiv:2108.10413](https://arxiv.org/abs/2108.10413)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| thick/thin disc luminosity ratio at 3.4 µm (comparison) | 0.71 ± 0.45 | verified | p. 9, Table 2 | “LT /Lt 0.71 ± 0.45 0.69 ± 0.20” |
| their thick disc is radially longer than the thin disc |  | verified | p. 9, Table 2 | “hR, T pc 3219 ± 417” |

<a id="moustakas2023"></a>
### Moustakas et al. 2023 — Siena Galaxy Atlas 2020

ApJS · [doi:10.3847/1538-4365/acfaa2](https://doi.org/10.3847/1538-4365/acfaa2) · [arXiv:2307.04888](https://arxiv.org/abs/2307.04888)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| SGA-2020 as the planned structural-override source |  | verified | p. 1, Abstract | “wavelength optical and infrared imaging atlas of 383,620 nearby galaxies” |
| number of galaxies in SGA-2020 | 383,620 | verified | p. 1, Abstract | “imaging atlas of 383,620 nearby galaxies” |

<a id="newburn1973"></a>
### Newburn & Gulkis 1973 — A survey of the outer planets Jupiter, Saturn, Uranus, Neptune, Pluto, and their satellites

Space Science Reviews 14, 179-271 (1973) · [doi:10.1007/BF02432098](https://doi.org/10.1007/BF02432098) · [1973SSRv...14..179N](https://ui.adsabs.harvard.edu/abs/1973SSRv...14..179N)

- **Copy:** `ADS scan of published article`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Galilean satellite colours (Harris 1961 via Newburn & Gulkis) | B−V / V−R: Io 1.17/0.66, Europa 0.87/0.57, Ganymede 0.83/0.59, Callisto 0.86/0.61 | verified | p. 217, Table XII | “Color B− V 1.17 0.87 0.83 0.86 Color V− R 0.66 0.57 0.59 0.61” |
| Saturnian satellite colours | B−V / V−R: Dione 0.71/0.48, Rhea 0.76/0.61, Titan 1.29/0.84 | verified | p. 238, Table XXVI | “Color B− V 0.62 0.73 0.71 0.76 1.293 0.69 0.71 Color V− R – – 0.48 0.61 0.844” |
| Triton colours | B−V 0.77, V−R 0.58 | verified | p. 252, Table XXXVIII | “Color B− V 0.77 Harris (1961) Color V− R 0.58 Harris (1961)” |
| Enceladus, Tethys, Iapetus have B−V but no V−R; Mimas has no colour |  | verified | p. 238, Table XXVI | “Photometric data are difficult to obtain for Mimas because of its proximity to Saturn and the rings.” |
| Harris filter effective wavelengths fix the R column as Johnson rather than Cousins | U .35, B .45, V .55, R .69, I .82 µm; system stored as 'johnson' | disagrees | p. 257, Appendix B | “Harris’ passbands R and I are those of Hardie and are at different effective wavelengths than the standards of Johnson (1966)” |

<a id="nicholson1995"></a>
### Nicholson P. D. et al. 1995

Icarus 113, 295 (bibcode in URL) · [1995Icar..113..295N](https://ui.adsabs.harvard.edu/abs/1995Icar..113..295N)

- **Copy:** `publishedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| stellar-occultation source for the Neptune ring table |  | verified | p. 295, Abstract | “Data from eight stellar occultations by Neptune between 1984 and 1988 are analyzed to set limits on the optical depths of the continuous Adams and Le Verrier Rings” |

<a id="osterbrock2006"></a>
### Osterbrock & Ferland 2006 — Astrophysics of Gaseous Nebulae and Active Galactic Nuclei, 2nd ed.

University Science Books, Sausalito (2006); ISBN 1-891389-34-3 · [2006agna.book.....O](https://ui.adsabs.harvard.edu/abs/2006agna.book.....O)

- **Copy:** not held
- **Identification:** book — Standard reference for alpha_B Not network-verified

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| case-B recombination coefficient alpha_B | 2.6e-13 cm^3 s^-1 | unverified |  |  |

<a id="pace2025"></a>
### Pace et al. 2025 — The Local Volume Database: a library of the observed properties of nearby dwarf galaxies and star clusters

Open Journal of Astrophysics / OJAp 8 · [doi:10.33232/001c.144859](https://doi.org/10.33232/001c.144859) · [arXiv:2411.07424](https://arxiv.org/abs/2411.07424)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Local Volume Database as the dwarf-galaxy catalogue (positions, distances, structure, photometry) |  | verified | p. 20, App. B | “confirmed real: Denotes whether the system has been confirmed (=1).” |
| LVDB ra/dec are J2000.0 | J2000.0 | verified | p. 20, App. B | “ra and dec. Location of system [degrees, ICRS frame, J2000.0].” |

<a id="padoan1997"></a>
### Padoan, Nordlund & Jones 1997 — The universality of the stellar initial mass function

MNRAS 288, 145-152 (1997) · [doi:10.1093/mnras/288.1.145](https://doi.org/10.1093/mnras/288.1.145) · [arXiv:astro-ph/9703110](https://arxiv.org/abs/astro-ph/9703110) · [1997MNRAS.288..145P](https://ui.adsabs.harvard.edu/abs/1997MNRAS.288..145P)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| log-normal volume-density PDF from supersonic turbulence, s = ln(ρ/ρ̄) Gaussian with σ² = ln(1 + b²M²) |  | verified | p. 4, eqs. 1–4 | “The probability density function of the density field is well approximated by a Log-Normal distribution” |

<a id="pecaut2013"></a>
### Pecaut & Mamajek 2013 — Intrinsic Colors, Temperatures, and Bolometric Corrections of Pre-main-sequence Stars

ApJS 208, 9 (2013) · [doi:10.1088/0067-0049/208/1/9](https://doi.org/10.1088/0067-0049/208/1/9) · [arXiv:1307.2657](https://arxiv.org/abs/1307.2657) · [2013ApJS..208....9P](https://ui.adsabs.harvard.edu/abs/2013ApJS..208....9P)

- **Copy:** `submittedVersion`
- **Note:** Table 5 of PM13 is the main-sequence dwarf table; the mass/radius columns are in the online 'modern mean dwarf' extension maintained by Mamajek — worth checking which one the values came from

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| per-class main-sequence mass anchors ('Table 5') | _MS_MASS rows, e.g. A0V 2.9, A1V 2.6, G2V 1.0, K1V 0.76 M☉ | not in paper | p. 28, Table 5 | “Synthetic Color Indices From BT-Settl and ATLAS9 models” |
| A1V → 2.6 M☉ as PM13 'zero-age values' | 2.6 M☉ | not in paper |  |  |
| absolute V magnitude per class/subclass for V, III and supergiants | MV_MS_TABLE / MV_GIANT_TABLE / MV_BY_SUPERGIANT_LUMCLASS | not in paper | p. 26, Table 4 | “Intrinsic Colors of O9-M9 Dwarfs and Adopted Teff , Bolometric Correction Values” |
| for composite Am types the metallic-line type is closest to Teff |  | not in paper |  |  |
| extended Teff table by class × luminosity class (planned) |  | not in paper | p. 26, Table 4; p. 29, Table 6 | “Intrinsic colors of 5-30 Myr old Stars and Adopted Teff , Bolometric Correction Values” |

<a id="pietrzynski2019"></a>
### Pietrzyński et al. 2019 — A distance to the Large Magellanic Cloud that is precise to one per cent

Nature 567, 200 · [doi:10.1038/s41586-019-0999-4](https://doi.org/10.1038/s41586-019-0999-4) · [arXiv:1903.08096](https://arxiv.org/abs/1903.08096)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| LMC distance | 49.594 kpc (also written 49.59, 49.6 kpc) | verified | p. 1, Abstract; p. 3 | “The final distane is 49.59 ± 0.09 (statistical) ± 0.54 (systematic) kiloparsecs.” |
| LMC distance uncertainty | ± 0.55 kpc | verified | p. 1, Abstract | “49.59 ± 0.09 (statistical) ± 0.54 (systematic) kiloparsecs” |
| distance is to the LMC's centre of mass |  | not in paper | p. 3 | “We adopted the centre of the young stellar population in the LMC (right ascension RA = 5 h 20 min 12 s, declination dec. = –69° 18′ 00′′” |

<a id="piffl2014"></a>
### Piffl et al. 2014 — The RAVE survey: the Galactic escape speed and the mass of the Milky Way

A&A 562, A91 (2014) · [doi:10.1051/0004-6361/201322531](https://doi.org/10.1051/0004-6361/201322531) · [arXiv:1309.4293](https://arxiv.org/abs/1309.4293) · [2014A&A...562A..91P](https://ui.adsabs.harvard.edu/abs/2014A%26A...562A..91P)

- **Copy:** `submittedVersion`
- **Note:** Abstract value is 533 (+54/-41) km/s, not ~550; tree's '~550' is loose

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| local Galactic escape speed | ~550 km/s | disagrees | p. 1, Abstract | “Our best estimate of the local Galactic escape speed ... is 533+54 −41 km s−1 (90% confidence) with an additional 4% systematic uncertainty” |

<a id="planck2020"></a>
### Planck Collaboration 2020 — Planck 2018 results (SMICA; cosmology)

A&A 641, A1 · [arXiv:1807.06205](https://arxiv.org/abs/1807.06205)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| baked flat ΛCDM parameters | H0 = 67.4 km/s/Mpc, Ωm = 0.315, ΩΛ = 0.685 | verified | p. 19, Table 7 | “H0 . . . 67.36 ± 0.54 ... ΩΛ . . . 0.6847 ± 0.0073 ... Ωm . . . 0.3153 ± 0.0073” |
| SMICA CMB map (planned skybox) |  | verified | p. 10 | “SMICA, which uses an independent component analysis of” |

<a id="porco1995"></a>
### Porco et al. 1995 — Neptune's ring system

In Neptune and Triton (Cruikshank ed.), Univ. of Arizona Press (1995), pp. 703-804; Porco, Nicholson, Cuzzi, Lissauer & Esposito

- **Copy:** not held
- **Identification:** book — Standard reference for Neptune ring parameters No Crossref record found; bibcode/pages from standard usage, not network-verified; bibcode 1995netr.conf..703P did not resolve via ADS link gateway (may be valid but lacks a full-text link)

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Neptune ring radii, widths, normal optical depths (Adams tau azimuthally averaged incl. arcs) |  | unverified |  |  |

<a id="pourbaix2016"></a>
### Pourbaix 2016 — Parallax and masses of alpha Centauri revisited

A&A 586, A90 (2016) · [doi:10.1051/0004-6361/201527859](https://doi.org/10.1051/0004-6361/201527859) · [arXiv:1601.01636](https://arxiv.org/abs/1601.01636) · [2016A&A...586A..90P](https://ui.adsabs.harvard.edu/abs/2016A%26A...586A..90P)

- **Copy:** `submittedVersion`
- **Identification:** mismatch — Crossref + arXiv 1601.01636 abstract Abstract gives M_A=1.13, M_B=0.97 Msun -> M_B/M_A=0.86, M_B/(M_A+M_B)=0.46; neither is the q=0.453 the test attributes to it

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| α Cen mass ratio q = M_B/(M_A+M_B), external truth in the mass-ratio test | q = 0.453 | disagrees | p. 3, Table 1 | “κ 0.4581 ± 0.00098 0.4617 ± 0.00044” |

<a id="prugniel"></a>
### Prugniel P. & Simien F. 1997 — The fundamental plane of early-type galaxies: non-homology of the spatial structure?

A&A 321, 111 (1997) · [1997A&A...321..111P](https://ui.adsabs.harvard.edu/abs/1997A%26A...321..111P)

- **Copy:** `ADS scan of published article`
- **Note:** Tree cites without year; title from standard usage, not network-verified

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| deprojected Sérsic density form ρ ∝ u^(−p) exp(−b u^(1/n)) | ν(u) = ρ₀ · u^(−pₙ) · exp(−bₙ · u^(1/n)) | verified | p. 120, App. B.1, eq. B6 | “Following MM87, we will fit a simplified form for the density profile: ρ(s) = M A s−α exp −bs1/n” |
| deprojection exponent pₙ coefficients | pₙ = 1 − 0.6097/n + 0.05463/n² | disagrees | p. 120, App. B.1, eq. B7 | “Then, we fit α(n) by: α(n) = 1 − 1.188/2n + 0.22/4n²” |

<a id="ramirez2012"></a>
### Ramírez et al. 2012 — The UBV(RI)C Colors of the Sun

ApJ 752, 5 (2012) · [doi:10.1088/0004-637X/752/1/5](https://doi.org/10.1088/0004-637X/752/1/5) · [arXiv:1204.0828](https://arxiv.org/abs/1204.0828) · [2012ApJ...752....5R](https://ui.adsabs.harvard.edu/abs/2012ApJ...752....5R)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| solar B−V | 0.653 | verified | p. 1, Abstract | “derive the following solar colors: (B − V )⊙ = 0.653 ± 0.005” |
| solar V−Rc | 0.352 | verified | p. 1, Abstract | “(V − R)⊙ = 0.352 ± 0.007” |

<a id="recioblanco2023"></a>
### Recio-Blanco et al. 2023 — Gaia Data Release 3

A&A 674, A29 · [doi:10.1051/0004-6361/202243750](https://doi.org/10.1051/0004-6361/202243750) · [arXiv:2206.05541](https://arxiv.org/abs/2206.05541)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| GSP-Spec emits Teff, log g, [M/H] from RVS spectra |  | verified | p. 2, Sect. 1 | “GSP-Spec estimates (i) the stellar effective temperature T eff , reported as teff_gspspec; (ii) ... logg_gspspec; (iii) ... mh_gspspec” |
| letter-only spectral-type enum (O B A F G K M CSTAR unknown) from GSP-Spec | spectraltype_esphs | not in paper |  |  |

<a id="reid"></a>
### Reid M. J. et al.

- **Copy:** not held
- **Identification:** ambiguous — 'Reid et al. masers' with no year Both are maser-parallax spiral-arm models; choose by intended model version (2019 is the latest)
  - Reid et al. 2014, ApJ 783, 130 ([doi:10.1088/0004-637X/783/2/130](https://doi.org/10.1088/0004-637X/783/2/130))
  - Reid et al. 2019, ApJ 885, 131 ([doi:10.3847/1538-4357/ab4a11](https://doi.org/10.3847/1538-4357/ab4a11))

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| maser-anchored spiral-arm model (named as a rejected non-goal) |  | verified | unverified |  |

<a id="riello2021"></a>
### Riello et al. 2021 — Gaia Early Data Release 3

A&A 649, A3 · [doi:10.1051/0004-6361/202039587](https://doi.org/10.1051/0004-6361/202039587)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| G − V cubic in BP − RP coefficients | −0.02704, 0.01424, −0.2156, 0.01426 | verified | p. 32, Table C.2 | “G−V -0.02704 0.01424 -0.2156 0.01426 0.03017” |
| G − V residual scatter | σ = 0.03017 (0.030) mag | verified | p. 32, Table C.2 | “G−V -0.02704 0.01424 -0.2156 0.01426 0.03017” |
| G − V validity range | −0.5 < BP−RP < 5.0 | verified | p. 31, Table C.1 | “G − V = f (GBP − GRP ) −0.5 < GBP − GRP < 5.0” |
| G − V is negative across the validity range (V fainter than G), peak −0.02680 at BP−RP 0.0331 |  | verified | p. 32, Table C.2 | “G−V -0.02704 0.01424 -0.2156 0.01426” |
| section title 'Photometric relationships with other photometric systems' |  | not in paper | p. 26, App. C | “Appendix C: Colour–colour transformations” |
| G − B quartic in BP − RP (with G − V gives B − V), 'Table 5.9, release-3 restatement of Riello App. C' | coeffs 0.01448, −0.6874, −0.3604, 0.06718, −0.006061; σ 0.0633; range −0.5..4.0; M-giant-only above BP−RP 1.75 | not in paper | p. 32, Table C.2 | “G−V ... G−R ... G − IC” |

<a id="roman1987"></a>
### Roman 1987 — Identification of a constellation from a position

PASP 99, 695 (1987) · [doi:10.1086/132034](https://doi.org/10.1086/132034) · [1987PASP...99..695R](https://ui.adsabs.harvard.edu/abs/1987PASP...99..695R)

- **Copy:** `ADS scan of published article`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Roman 1987 (VI/42) is the constellation lookup table that the boundary walk makes unnecessary |  | verified | p. 695, Abstract | “A table permits rapid determination of the constellation in which an object is located from its 1875.0 position.” |

<a id="ross2020"></a>
### Ross et al. 2020 — eBOSS DR16 LSS catalogues

MNRAS 498, 2354 · [arXiv:2007.09000](https://arxiv.org/abs/2007.09000)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| eBOSS DR16 LSS catalogues (planned Tier 5) and target-selection definitions in Sect. 2 |  | verified | p. 3, Sect. 2 | “2 EBOSS TARGETS” |

<a id="samus2017"></a>
### Samus et al. 2017 — General catalogue of variable stars: Version GCVS 5.1

Astronomy Reports 61, 80-88 (2017) · [doi:10.1134/S1063772917010085](https://doi.org/10.1134/S1063772917010085) · [2017ARep...61...80S](https://ui.adsabs.harvard.edu/abs/2017ARep...61...80S)

- **Copy:** `publishedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| GCVS 5.1 catalogue (gcvs5.txt main table + crossid.txt cross-identifications) |  | verified | p. 83, Sect. 3 | “In addition to the main table, the GCVS 5.1 contains a table of 203 000 identifications of variable stars with other catalogs (crossid.txt)” |

<a id="sander2012"></a>
### Sander A. et al. 2012 — The Galactic WC stars

A&A 540, A144 (2012) · [doi:10.1051/0004-6361/201117830](https://doi.org/10.1051/0004-6361/201117830) · [2012A&A...540A.144S](https://ui.adsabs.harvard.edu/abs/2012A%26A...540A.144S)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| WC4 Teff ~117 kK | 117 kK | verified | p. 16, Table 6 | “WC4 117 3310 1.0 −4.65 5.2 10” |
| WC9 Teff ~44 kK | 44 kK (ramp node [9, 44000]) | verified | p. 16, Table 6 | “WC9 44 1390 6.6 −4.80 5.2 10” |
| WC Teff along the shared WN/WC ramp (subclass 5 node = 75 kK, linear to 44 kK at 9) | WC4 88 kK, WC5 75 kK, WC6 67 kK, WC7 60 kK, WC8 52 kK (as interpolated from WR_T_TABLE) | disagrees | p. 16, Table 6 | “WC5 83 ... WC6 78 ... WC7 71 ... WC8 60” |

<a id="sanford1942"></a>
### Sanford 1942 — The Spectrographic Orbit of the Companion to Rigel

ApJ 95, 421 (1942) · [doi:10.1086/144412](https://doi.org/10.1086/144412) · [1942ApJ....95..421S](https://ui.adsabs.harvard.edu/abs/1942ApJ....95..421S)

- **Copy:** `ADS scan of published article`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Rigel B double-lined SB orbit: P, T, e, omega | P = 9.860 d, T = JD 2429633.1953, e = 0.1, omega = 10 deg (0.174533 rad) in multiples.tsv via MSC | verified | p. 422, Table 2 | “Period P 9d860 · Periastron passage T JD 2429633.196 G.M.T. · Angle of periastron ω 10° · Eccentricity e 0.1” |
| Rigel Ba and Bb both of class B9 | B9V + B9V | verified | p. 421 | “eleven of which show satisfactory lines of the components, both of which are of spectral class B9” |

<a id="savary1828"></a>
### Savary 1828 — Sur la determination des orbites que decrivent autour de leur centre de gravite deux etoiles tres rapprochees l'une de l'autre

Connaissance des Temps (1830)

- **Copy:** not held
- **Identification:** mismatch — Savary's first visual-binary orbit (1827/1828, pub. Conn. des Temps 1830) was for xi UMa, not Castor Tree calls ORB6 STF1110AB 459.1 yr 'the famous Savary 1828 visual orbit'; the committed ORB6 row (data/wds/orb6_orbits.txt) cites CIA2022d = Torres et al. 2022 ApJ 941, 8 (2022ApJ...941....8T). No DOI for Savary; historical attribution from standard history, not network-verified

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Castor AB (STF1110AB) visual orbit P = 459.1 yr (167686.275 d), called 'the famous Savary 1828 visual orbit' / 'ORB6 historical-first orbit' | 459.1 yr | not in paper | unverified |  |

<a id="schaefer2016"></a>
### Schaefer et al. 2016 — Orbits, Distance, and Stellar Masses of the Massive Triple Star sigma Orionis

AJ 152, 213 (2016) · [doi:10.3847/0004-6256/152/6/213](https://doi.org/10.3847/0004-6256/152/6/213) · [arXiv:1610.01984](https://arxiv.org/abs/1610.01984) · [2016AJ....152..213S](https://ui.adsabs.harvard.edu/abs/2016AJ....152..213S)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| sigma Ori distance from orbital parallax 387.5 +/- 1.3 pc | 387.5 ± 1.3 pc | verified | p. 11, Sect. 5 | “orbital parallax of π = 2.5806 ± 0.0088 mas gives a distance d = 387.5 ± 1.3 pc to the σ Orionis system” |

<a id="schenk2014"></a>
### Schenk 2014 — Cassini / Voyager enhanced-colour global mosaics of Saturnian mid-size moons and Triton

NASA Photojournal PIA18434-18439, PIA18668 (Paul Schenk, LPI, 2014)

- **Copy:** not held
- **Identification:** book — Image data products, not a paper Cite as NASA/JPL-Caltech/LPI image releases

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Saturnian mid-size moon enhanced-colour mosaics (PIA18434-18439) |  | verified | photojournal.jpl.nasa.gov/catalog/PIA18437 | “Color Maps of Mimas - 2014” |
| Triton Voyager 2 global colour mosaic (PIA18668) |  | verified | photojournal.jpl.nasa.gov/catalog/PIA18668 | “Map of Triton” |

<a id="schlegel1998"></a>
### Schlegel, Finkbeiner & Davis 1998 — Maps of Dust Infrared Emission for Use in Estimation of Reddening and Cosmic Microwave Background Radiation Foregrounds

ApJ 500, 525 · [doi:10.1086/305772](https://doi.org/10.1086/305772) · [arXiv:astro-ph/9710327](https://arxiv.org/abs/astro-ph/9710327)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| polar A_V spread ~0.03-0.15 the slab's A_V = 0.125 pole column is checked against | A_V 0.03–0.15 at the Galactic poles | disagrees | p. 35, Sect. 7.3; p. 34 | “Our estimated reddening, averaged over 10◦ in diameter, is E(B−V ) = 0.015 mag at the NGP and E(B−V ) = 0.018 mag at the SGP” |
| SFD publish no per-kpc extinction rate | (absence claim) | verified | whole paper |  |

<a id="simondiaz2015"></a>
### Simon-Diaz et al. 2015 — Orbital and physical properties of the sigma Ori Aa, Ab, B triple system

ApJ 799, 169 (2015) · [doi:10.1088/0004-637X/799/2/169](https://doi.org/10.1088/0004-637X/799/2/169) · [arXiv:1412.3469](https://arxiv.org/abs/1412.3469) · [2015ApJ...799..169S](https://ui.adsabs.harvard.edu/abs/2015ApJ...799..169S)

- **Copy:** `acceptedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| sigma Ori Ab B0.5V (and Aa O9.5V) curated spectral types | Ab B0.5V (Aa O9.5V) | not in paper | p. 11, Table 4 | “Teff 35.0 ± 1.0 31.0 ± 1.0 29.0 ± 2.0 kK” |

<a id="sion"></a>
### Sion E. M. et al. 1983 — A proposed new white dwarf spectral classification system

ApJ 269, 253 (1983) · [doi:10.1086/161036](https://doi.org/10.1086/161036) · [1983ApJ...269..253S](https://ui.adsabs.harvard.edu/abs/1983ApJ...269..253S)

- **Copy:** `ADS scan of published article`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| WD temperature index = 50400/Teff, so Teff = 50400/N | Teff = 50400 / N | verified | p. 255, Sect. II b; also p. 253 abstract | “a quantative temperature index from 0 to 9 will be used, defined by 10 times θ (θ = 5040/T). This quantity 50,400/T given as an integer” |

<a id="smirnov2002"></a>
### Smirnov et al. 2002 — Optical Properties of Atmospheric Aerosol in Maritime Environments

J. Atmos. Sci. 59, 501-523 (2002) · [doi:10.1175/1520-0469(2002)059<0501:OPOAAI>2.0.CO;2](https://doi.org/10.1175/1520-0469(2002)059<0501:OPOAAI>2.0.CO;2)

- **Copy:** `publishedVersion`
- **Note:** Same-year Smirnov et al. Persian Gulf paper (J. Atmos. Sci. 59, 620) exists; the maritime one matches the claim

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| clean maritime background aerosol optical depth | τ_Mie = 0.05 (grey, all channels) | disagrees | p. 501 (abstract); p. 510, Table 3 | “The optical thickness is remarkably stable with mean value of τa (500 nm) = 0.07, mode value at τam = 0.06” |

<a id="sneep2005"></a>
### Sneep & Ubachs 2005 — Direct measurement of the Rayleigh scattering cross section in various gases

JQSRT 92, 293-310 (2005) · [doi:10.1016/j.jqsrt.2004.07.025](https://doi.org/10.1016/j.jqsrt.2004.07.025) · [2005JQSRT..92..293S](https://ui.adsabs.harvard.edu/abs/2005JQSRT..92..293S)

- **Copy:** `publishedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| CO2/air Rayleigh cross-section ratio | 2.45 | not in paper | p. 304, Table 2 | “CO2 12.4 (0.8) 13.29 ... N2 5.10 (0.24) 5.30” |

<a id="standish1992"></a>
### Standish 1992 — Keplerian elements for approximate positions of the major planets

- **Copy:** not held
- **Identification:** ambiguous — Tree uses 'Standish 1992' for the 3000 BC-3000 AD Table 2a/2b elements and error budget The 3000 BC-3000 AD Table 2a lives in the undated JPL memo (fit to DE200), so the year '1992' likely conflates the two; no DOI for either. Not network-verified
  - Standish, E.M., 'Keplerian Elements for Approximate Positions of the Major Planets', JPL Solar System Dynamics memo (approx_pos.html / aprx_pos_planets.pdf), undated
  - Standish, Newhall, Williams & Yeomans 1992, 'Orbital Ephemerides of the Sun, Moon, and Planets', ch. 5 of Explanatory Supplement to the Astronomical Almanac (Seidelmann ed.), University Science Books

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Table 2a Keplerian elements + rates (3000 BC - 3000 AD), 7 planets + EM Bary |  | verified | approx_pos.html, Table 2a; memo p. 3, Table 2a | “Keplerian elements and their rates ... valid for the time-interval 3000 BC -- 3000 AD” |
| Table 2b b, c, s, f terms for Jupiter-Neptune |  | verified | approx_pos.html, Table 2b; memo p. 3, Table 2b | “Additional terms which must be added to the computation of M for Jupiter through Neptune” |
| Pluto: pre-removal Table 2a row plus Table 2b b term | a 39.48686035 ... b -0.01262724 | verified | memo p. 3, Tables 2a/2b | “Pluto -0.01262724” |
| validity window / model-clock clamp | 3000 BC - 3000 AD | verified | approx_pos.html, Table 2a | “valid for the time-interval 3000 BC -- 3000 AD” |
| EM Bary inclination | I = -0.00054346 deg | verified | approx_pos.html, Table 2a | “EM Bary   1.00000018      0.01673163     -0.00054346” |
| published 3000 BC-3000 AD accuracy budget (lambda arcsec, phi arcsec, rho 1000 km) per planet | Me 20/15/1, Ve 40/30/8, EM 40/15/15, Ma 100/40/30, Ju 600/100/1000, Sa 1000/100/4000, Ur 2000/30/8000, Ne 400/15/4000 | verified | approx_pos.html, Accuracy | “nominal errors in heliocentric longitude, λ, latitude, φ, and distance, ρ” |
| Mercury 20" longitude error | 20" | verified | approx_pos.html, Accuracy | “Mercury \| 15 \| 1 \| 1 \| 20 \| 15 \| 1” |
| Earth-longitude error of the series, used to explain the eclipse residual | ~20" | disagrees | approx_pos.html, Accuracy | “EM Bary \| 20 \| 8 \| 6 \| 40 \| 15 \| 15” |
| published budget in AU at Saturn, Uranus, Neptune | 0.05-0.06 AU | disagrees | approx_pos.html, Accuracy | “Uranus \| 50 \| 2 \| 1000 \| 2000 \| 30 \| 8000” |
| 'Standish 1800-2050 primary fit window' for the Horizons validation epochs | 1800-2050 | disagrees | approx_pos.html, Table 1 | “valid for the time-interval 1800 AD - 2050 AD” |
| elements fit the barycentric orbits (so the Horizons targets are the barycentres 1..9) |  | not in paper | approx_pos.html, Formulae step 3; memo p. 1 | “Compute the planet's heliocentric coordinates in its orbital plane” |
| EM-barycentre split into Earth + Moon |  | verified | approx_pos.html, Table 2a | “EM Bary = Earth/Moon Barycenter” |

<a id="standishwilliams"></a>
### Standish E. M. & Williams J. G. — Orbital Ephemerides of the Sun, Moon, and Planets (ch. 8)

In Explanatory Supplement to the Astronomical Almanac, 3rd ed., Urban & Seidelmann (eds), University Science Books (2012/2013); ISBN 978-1-891389-85-6

- **Copy:** not held
- **Identification:** book — Standish & Williams chapter carrying the widely reproduced linear-elements table incl. Pluto Named only as the row not to use; not network-verified

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| the widely reproduced linear-elements (Table 1, 1800-2050) Pluto row must not be substituted for the Table 2a row |  | verified | memo p. 3, Table 1; approx_pos.html, Table 1 | “valid for the time-interval 1800 AD - 2050 AD” |

<a id="steinmetz2020"></a>
### Steinmetz M. et al. 2020 — The Sixth Data Release of the Radial Velocity Experiment (RAVE) – I: Survey Description, Spectra and Radial Velocities

AJ 160, 83 · [2020AJ....160...83S](https://ui.adsabs.harvard.edu/abs/2020AJ....160...83S)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| bibcode 2020AJ....160...83S identifies the RAVE DR6 radial-velocity paper |  | verified | p. 2, abstract | “data release (DR6 or FDR) is based on 518 387 observations of 451 783 unique stars” |

<a id="stelzer2003"></a>
### Stelzer & Burwitz 2003 — Castor A and Castor B resolved in a simultaneous Chandra and XMM-Newton observation

A&A 402, 719-728 (2003) · [doi:10.1051/0004-6361:20030286](https://doi.org/10.1051/0004-6361:20030286) · [arXiv:astro-ph/0302570](https://arxiv.org/abs/astro-ph/0302570) · [2003A&A...402..719S](https://ui.adsabs.harvard.edu/abs/2003A%26A...402..719S)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Castor Ab late-K companion, P = 9.21 d; Bb early-M dwarf, P = 2.93 d | late-K / early-M; 9.21 d / 2.93 d | verified | p. 1, Sect. 1 | “The companion of Castor A is most likely a late-K star in a 9.21 d eccentric orbit, while Castor B's companion seems to be an early-M dwarf with a 2.93 d circular orbit” |
| Castor Ab spectral type K7Ve and Bb M1Ve | K7Ve, M1Ve | not in paper | p. 1, Sect. 1 | “most likely a late-K star ... seems to be an early-M dwarf” |

<a id="sternberg2003"></a>
### Sternberg et al. 2003 — Ionizing Photon Emission Rates from O- and Early B-Type Stars and Clusters

ApJ 599, 1333-1343 (2003) · [doi:10.1086/379506](https://doi.org/10.1086/379506) · [arXiv:astro-ph/0312232](https://arxiv.org/abs/astro-ph/0312232) · [2003ApJ...599.1333S](https://ui.adsabs.harvard.edu/abs/2003ApJ...599.1333S)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| B0V ionising photon rate log Q_H | 47.6 | disagrees | p. 22, Table 1 | “B0 33340 3.932 8.3 4.88 21.2 1853 1.0(-7) 48.02 45.82” |
| B1V ionising photon rate log Q_H | 45.7 | not in paper | p. 22, Table 1 | “B0.5 32060 3.914 8.0 4.79 19.3 1747 7.8(-8) 47.71 45.36” |
| giants/supergiants: same class row +0.3 dex | +0.3 dex | disagrees | p. 22-23, Tables 1-3 | “O9 ... 49.24 (class I) vs O9 ... 48.47 (class V)” |

<a id="strauss2002"></a>
### Strauss et al. 2002 — Spectroscopic Target Selection in the Sloan Digital Sky Survey: The Main Galaxy Sample

AJ 124, 1810-1824 (2002) · [doi:10.1086/342343](https://doi.org/10.1086/342343) · [arXiv:astro-ph/0206225](https://arxiv.org/abs/astro-ph/0206225) · [2002AJ....124.1810S](https://ui.adsabs.harvard.edu/abs/2002AJ....124.1810S)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| SDSS Main Galaxy Sample selection (planned Tier-4 extraction) |  | verified | p. 5, Sect. 2 | “The main galaxy sample consists of galaxies with rP ≤ 17.77 and µ50 ≤ 24.5 magnitudes per square arcsec” |

<a id="stromgren1939"></a>
### Strömgren 1939 — The Physical State of Interstellar Hydrogen

ApJ 89, 526 (1939) · [doi:10.1086/144074](https://doi.org/10.1086/144074) · [1939ApJ....89..526S](https://ui.adsabs.harvard.edu/abs/1939ApJ....89..526S)

- **Copy:** `ADS scan of published article`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Strömgren radius (ionised-sphere radius) R_S |  | verified | p. 530, eq. 16 | “The value of s corresponding to [x] = 1, which we shall call s0” |

<a id="subramanian2012"></a>
### Subramanian & Subramaniam 2012 — THE THREE-DIMENSIONAL STRUCTURE OF THE SMALL MAGELLANIC CLOUD

ApJ 744, 128 · [doi:10.1088/0004-637X/744/2/128](https://doi.org/10.1088/0004-637X/744/2/128) · [arXiv:1109.3980](https://arxiv.org/abs/1109.3980)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| SMC triaxial shape 1:1.33:1.61, longest axis along line of sight | 1 : 1.33 : 1.61 | verified | p. 1, abstract | “we estimated an axes ratio of 1:1.33:1.61 with i = 2◦.6 and φ = 70◦.2” |

<a id="tempel2011"></a>
### Tempel et al. 2011 — SDSS surface photometry of M 31 with absorption corrections

A&A 526, A155 · [doi:10.1051/0004-6361/201016067](https://doi.org/10.1051/0004-6361/201016067) · [arXiv:1012.3591](https://arxiv.org/abs/1012.3591)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| M31 intrinsic integrated (B−V)0 | 0.86 | verified | p. 5, Table 2 | “M 31 U−B B−V V−R R−I B / Intrinsic 0.35 0.86 0.63 0.53 4.10” |
| M31 intrinsic total m_V | 3.24 | verified | p. 5, Table 2 | “Intrinsic 0.35 0.86 0.63 0.53 4.10 ... Visible(b) 0.43 0.90 0.65 0.58 4.27” |

<a id="tokovinin2018"></a>
### Tokovinin 2018 — The Updated Multiple Star Catalog

ApJS 235, 6 · [doi:10.3847/1538-4365/aaa1a5](https://doi.org/10.3847/1538-4365/aaa1a5) · [arXiv:1712.04750](https://arxiv.org/abs/1712.04750)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| MSC: hierarchical systems with three or more components (VizieR J/ApJS/235/6 systems/orbits/catalog tables) |  | verified | p. 1, abstract; p. 3-5, Sect. 3, Tables 1-5 | “The catalog of hierarchical stellar systems with three or more components is an update of the” |
| Prim/Sec/Parent hierarchy labels; '*' = root, 't' = trapezium |  | verified | p. 4, Table 2 note a; Sect. 3.3 | “Two special symbols are used: * means root (system at the highest hierarchical level); t means trapezium-type, non-hierarchical system.” |
| Orbit T0 is a Besselian year or truncated JD 'with no unit flag' |  | disagrees | p. 5, Table 4 note a | “a Besselian year if P in years, JD−2400000 if P in days.” |
| Rigel Ba/Bb MSC values: B side V = 7.6, B9V; masses 2.94 + 2.11 Msun | V 7.6, B9V; 2.94 + 2.11 M☉ | verified |  |  |

<a id="tomasko2008"></a>
### Tomasko et al. 2008 — A model of Titan's aerosols based on measurements made inside the atmosphere

Planet. Space Sci. 56, 669-707 (2008) · [doi:10.1016/j.pss.2007.11.019](https://doi.org/10.1016/j.pss.2007.11.019) · [2008P&SS...56..669T](https://ui.adsabs.harvard.edu/abs/2008P%26SS...56..669T)

- **Copy:** `publishedVersion`
- **Note:** Tomasko et al. also have 2008 PSS 56, 624 (heat balance, DISR). If the 'ground light' claim is from the heat-balance paper it would need that one; haze tau matches this aerosol paper

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Titan visible haze optical depth τ ≈ 2–5 | τ ≈ 2–5 (tree τ_Mie = 2.5, grey) | disagrees | p. 699, Fig. 52; p. 697, Table 3 and Fig. 50 | “The vertical distribution of cumulative extinction optical depth at 500 nm is shown versus altitude.” |
| Titan noon ground light ~10% of incident, Huygens/DISR | ~10 % of incident | not in paper |  |  |

<a id="torra2021"></a>
### Torra et al. 2021 — Gaia Early Data Release 3

A&A 649, A10 · [doi:10.1051/0004-6361/202039637](https://doi.org/10.1051/0004-6361/202039637)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Gaia DR2 → (E)DR3 dr2_neighbourhood cross-match table |  | verified | p. 17, Sect. 7 | “A table tracing the sources from Gaia DR2 to Gaia EDR3, gaiaedr3.dr2_neighbourhood, is provided in Gaia archive” |

<a id="torres2002"></a>
### Torres & Ribas 2002 — Absolute Dimensions of the M-Type Eclipsing Binary YY Geminorum (Castor C)

ApJ 567, 1140-1165 (2002) · [doi:10.1086/338587](https://doi.org/10.1086/338587) · [arXiv:astro-ph/0111167](https://arxiv.org/abs/astro-ph/0111167) · [2002ApJ...567.1140T](https://ui.adsabs.harvard.edu/abs/2002ApJ...567.1140T)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Castor C = YY Gem, double-lined eclipsing pair, P = 0.814 d | P = 0.814 d | verified | p. 2, Sect. 1; p. 35, Table 9 | “it is a double-lined spectroscopic binary with a period of 0.814 days (19.5 hours)” |
| component masses Ca 0.599, Cb 0.601 Msun | 0.599 + 0.601 M☉ | disagrees | p. 9, Sect. 5; p. 33, Table 5 | “the absolute masses we derive for the two stars are formally different (MA = 0.5975 ± 0.0047 M⊙ and MB = 0.6009 ± 0.0047 M⊙)” |
| Castor Ca/Cb spectral type M0.5Ve | M0.5Ve (both) | disagrees | p. 1, Sect. 1; p. 3 | “YY Gem (M1.0 Ve, mass ∼ 0.6 M⊙ ; Bopp 1974; Leung & Schneider 1978)” |
| published Castor C semi-major axis | 0.0182 AU | disagrees | p. 28, Table 2; p. 32, Table 4 | “a sin i (R⊙ ) . . . 3.8882 ± 0.0095” |

<a id="tully2023"></a>
### Tully et al. 2023 — Cosmicflows-4

ApJ 944, 94 · [doi:10.3847/1538-4357/ac94d8](https://doi.org/10.3847/1538-4357/ac94d8) · [arXiv:2209.11238](https://arxiv.org/abs/2209.11238)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Cosmicflows-4: 55,877 galaxies in 38,065 groups with distances | 55,877 galaxies/groups (38,065 groups) | verified | p. 1, abstract | “With Cosmicflows-4, distances are compiled for 55,877 galaxies gathered into 38,065 groups.” |

<a id="vaidman2025"></a>
### Vaidman et al. 2025 — Evaluating Gaia Astrometric Quality and Distances for Galactic Hot Supergiants

Universe 11, 359 · [doi:10.3390/universe11110359](https://doi.org/10.3390/universe11110359)

- **Copy:** `publishedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Bayesian (EDSD-prior) recalculation of Gaia DR3/EDR3 distances for 132 Galactic BA supergiants | 132 stars | verified | p. 1, abstract | “We compiled a homogeneous sample of 132 B0–A5 supergiants and re-evaluated their distances using a consistent, quality-controlled approach.” |
| appendix Table A1 (119 rows, EDSD_new) and Table A2 (13 rows, BJ_old) carry d_BJ, σ, RUWE, G, d_new, σ, SNR_tot, L | A1 119 rows / A2 13 rows | verified | p. 9-11, Table A1; p. 12, Table A2; p. 7, Sect. 3.4 | “Objects failing any of these criteria revert to the Bailer-Jones value and are labelled BJ_old; those passing are labelled EDSD_new.” |
| d_BJ column is Bailer-Jones r_med_photogeo | r_med_photogeo | not in paper | p. 3, Sect. 2; p. 5 | “the Bailer-Jones Gaia EDR3 distance catalogue I/352 ... a scale length L anchored to the Bailer-Jones median distance” |
| citation author list and title | Vaidman, Khokhlov, Miroshnichenko, Agishev & Yermekbayev 2025, 'A Quality-Controlled Bayesian Recalculation of Gaia DR3/EDR3 Distances for 132 Galactic BA-Type Supergiants' | disagrees | p. 1 | “Evaluating Gaia Astrometric Quality and Distances for Galactic Hot Supergiants ... Nadezhda L. Vaidman, Shakhida T. Nurmakhametova, Aziza B. Umirova, Serik A. Khokhlov, Aldiyar T. Agishev and Berik S. Yermekbayev” |

<a id="vallenari2023"></a>
### Gaia Collaboration, Vallenari A. et al. 2023 — Gaia Data Release 3

A&A 674, A1 · [doi:10.1051/0004-6361/202243940](https://doi.org/10.1051/0004-6361/202243940) · [arXiv:2208.00211](https://arxiv.org/abs/2208.00211) · [2023A&A...674A...1G](https://ui.adsabs.harvard.edu/abs/2023A%26A...674A...1G)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Gaia DR3 mission/release citation (astrometry, photometry, APs, NSS orbits) |  | verified | p. 1-4, Sect. 1-2, Table 1 | “Gaia DR3 also includes results for non-single stars (NSS),” |
| Gaia DR3 cross-walks hipparcos2_best_neighbour / tycho2tdsc_merge_best_neighbour |  | verified | p. 3; p. 22 | “the Gaia archive includes pre-computed cross-matches with selected external optical and near-infrared photometric and spectroscopic” |

<a id="vanderkruit1986"></a>
### van der Kruit P. C. 1986

A&A 157, 230 (1986) · [1986A&A...157..230V](https://ui.adsabs.harvard.edu/abs/1986A%26A...157..230V)

- **Copy:** `ADS scan of published article`
- **Note:** No DOI; title and the M_B=-20.3 value not network-verified

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Galaxy integrated M_B = −20.3 ± 0.2 | M_B = −20.3 ± 0.2 | verified | p. 240, Sect. 5.3 | “The resulting integrated magnitude and colour of the Galaxy in the present model then are MB = −20.3 ± 0.2 and (B − V) = 0.83 ± 0.15.” |
| Galaxy integrated colour (B−V) ≈ 0.83 used to carry M_B to V | (B−V) ≈ 0.83 | verified | p. 240, Sect. 5.3 | “MB = −20.3 ± 0.2 and (B − V) = 0.83 ± 0.15. De Vaucouleurs advocates values of −20.2 ± 0.15 and 0.53 ± 0.04.” |

<a id="vandermarel2001"></a>
### van der Marel & Cioni 2001 — Magellanic Cloud Structure from Near-Infrared Surveys. I. The Viewing Angles of the Large Magellanic Cloud

AJ 122, 1807 · [doi:10.1086/323099](https://doi.org/10.1086/323099) · [arXiv:astro-ph/0105339](https://arxiv.org/abs/astro-ph/0105339)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| LMC disc scale length R_d = 1.5 kpc | 1.5 kpc | not in paper | p. 17, Sect. 6 | “we adopted an exponential number density profile (Weinberg & Nikolaev 2000; Paper II)” |

<a id="vandermarel2014"></a>
### van der Marel & Kallivayalil 2014 — THIRD-EPOCH MAGELLANIC CLOUD PROPER MOTIONS. II. THE LARGE MAGELLANIC CLOUD ROTATION FIELD IN THREE DIMENSIONS

ApJ 781, 121 · [doi:10.1088/0004-637X/781/2/121](https://doi.org/10.1088/0004-637X/781/2/121) · [arXiv:1305.4641](https://arxiv.org/abs/1305.4641)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| LMC PM dynamical centre (RA, Dec) | 78.76°, −69.19° (RA 5.25067 h = 05h15m02s) | verified | p. 6, Table 1 (col. 3, PMs-only fit) | “α0 deg 78.76 ± 0.52 ... δ0 deg −69.19 ± 0.25” |
| LMC centre-of-mass bulk PM | μ_α* = +1.910 ± 0.020, μ_δ = +0.229 ± 0.047 mas/yr | verified | p. 6, Table 1 (col. 3); p. 14, Sect. 4.3 | “~µ0 = (µW,0 , µN,0 ) = (−1.910 ± 0.020, 0.229 ± 0.047) mas/yr” |
| LMC disc inclination and line-of-nodes PA | i = 32°, PA = 135° | disagrees | p. 6, Table 1; p. 14, Sect. 4.2 | “Our best-fit model to the PM velocity field has i = 39.6◦ ± 4.5◦ and Θ = 147.4◦ ± 10.0◦” |

<a id="vanleeuwen2007"></a>
### van Leeuwen 2007 — Validation of the new Hipparcos reduction

A&A 474, 653 · [doi:10.1051/0004-6361:20078357](https://doi.org/10.1051/0004-6361:20078357) · [arXiv:0708.1752](https://arxiv.org/abs/0708.1752) · [2007A&A...474..653V](https://ui.adsabs.harvard.edu/abs/2007A%26A...474..653V)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| HIP2 re-reduction as the astrometry source (parallax tier, long-baseline PM fallback) |  | verified | p. 1, Abstract; p. 5 | “A new reduction of the astrometric data as produced by the Hipparcos mission has been published” |
| HIP2 reference epoch | J1991.25 | not in paper | whole text searched |  |
| HIP2 excludes orbit-corrupted HIP fits (drops entries such as HIP 55203) |  | not in paper | p. 5 | “A basic five-parameter astrometric solution has been sufficient for application to 102 072 out of a total of 117 955 stars.” |

<a id="vazquez1994"></a>
### Vazquez-Semadeni 1994 — Hierarchical Structure in Nearly Pressureless Flows as a Consequence of Self-similar Statistics

ApJ 423, 681 (1994) · [doi:10.1086/173847](https://doi.org/10.1086/173847) · [1994ApJ...423..681V](https://ui.adsabs.harvard.edu/abs/1994ApJ...423..681V)

- **Copy:** `ADS scan of published article`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| log-normal volume-density PDF of turbulent (supersonic) flow |  | verified | p. 687, Fig. 3; p. 682, Sect. 1 | “shows that the density pdf is, at least in the transonic regime, very well approximated by a lognormal distribution” |

<a id="vondrak2011"></a>
### Vondrák, Capitaine & Wallace 2011 — New precession expressions, valid for long time intervals

A&A 534, A22 (2011) · [doi:10.1051/0004-6361/201117274](https://doi.org/10.1051/0004-6361/201117274) · [2011A&A...534A..22V](https://ui.adsabs.harvard.edu/abs/2011A%26A...534A..22V)

- **Copy:** `publishedVersion`
- **Note:** Corrigendum A&A 541, C1 (2012)

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| validity span | ±200 kyr | verified | p. 4, Sect. 4.1 | “the model is valid only within this interval, whereas outside the errors diverge rapidly” |
| ecliptic-pole series P_A, Q_A: cubic polynomial + 8 periodic terms | ECLIPTIC_POLE_PERIODIC / ECLIPTIC_POLE_POLY_P / _Q | disagrees | p. 4, Table 1 and Eq. (8); p. 13, ltp_PECL listing | “C7 –87.676083 198.296071 882.00” |
| equator-pole series X_A, Y_A: cubic polynomial + 14 periodic terms | EQUATOR_POLE_PERIODIC / EQUATOR_POLE_POLY_X / _Y | verified | p. 5, Table 2 and Eq. (9); pp. 14–15, ltp_PEQU listing | “XA = 5453.282155 + 0.4252841T” |
| obliquity at J2000 the series is defined against | 84381.406″ | verified | p. 12, ltp_PECL listing | “PARAMETER ( EPS0 = 84381.406D0 * AS2R )” |
| periodic-term form and ecliptic-pole vector construction | C cos(2πT/P) + S sin(2πT/P); (P, −Q cos ε0 − W sin ε0, −Q sin ε0 + W cos ε0) | verified | p. 4, Sect. 4.1; p. 14 | “VEC(2) = - Q*C - Z*S” |
| matches IAU 2006 at J2000; within 100 µas in the 20th–21st centuries; a few arcseconds over the historical period |  | verified | p. 4, Sect. 4.1; p. 11, Sect. 6.4; p. 1, Abstract | “changes in the 20th and 21st centuries that are rather less than 100 μas” |

<a id="wainscoat1992"></a>
### Wainscoat et al. 1992 — A model of the 8-25 micron point source infrared sky

ApJS 83, 111 (1992) · [doi:10.1086/191733](https://doi.org/10.1086/191733) · [1992ApJS...83..111W](https://ui.adsabs.harvard.edu/abs/1992ApJS...83..111W)

- **Copy:** `ADS scan of published article`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| SKY model behind Leinert Table 24's integrated-starlight values (visible band) |  | verified | p. 112, Sect. 1 | “our model also operates at JHK and BV(visible light) wavelengths, permitting self-consistency checks” |

<a id="weingartner2001"></a>
### Weingartner & Draine 2001 — Dust Grain-Size Distributions and Extinction in the Milky Way, Large Magellanic Cloud, and Small Magellanic Cloud

ApJ 548, 296-309 (2001) · [doi:10.1086/318651](https://doi.org/10.1086/318651) · [arXiv:astro-ph/0008146](https://arxiv.org/abs/astro-ph/0008146) · [2001ApJ...548..296W](https://ui.adsabs.harvard.edu/abs/2001ApJ...548..296W)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| R_V ≈ 5.5 in dense cores | 5.5 | verified | p. 2, Sect. 1; p. 7, Sect. 3 | “For the diffuse ISM, RV ≈ 3.1; higher values are observed for dense clouds.” |
| grain growth as the cause |  | verified | p. 13, Sect. 7 | “small grains coagulate onto large grains in relatively dense environments, as expected” |

<a id="wenger2000"></a>
### Wenger et al. 2000 — The SIMBAD astronomical database

A&AS 143, 9 · [doi:10.1051/aas:2000332](https://doi.org/10.1051/aas:2000332) · [arXiv:astro-ph/0002110](https://arxiv.org/abs/astro-ph/0002110)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| SIMBAD database (cross-IDs, basic data incl. sp_type, bibcoded measurements) |  | verified | p. 1, Abstract | “It contains identifications, ‘basic data’, bibliography, and selected observational measurements” |

<a id="willmer2018"></a>
### Willmer 2018 — The Absolute Magnitude of the Sun in Several Filters

ApJS 236, 47 (2018) · [doi:10.3847/1538-4365/aabfdf](https://doi.org/10.3847/1538-4365/aabfdf) · [arXiv:1804.07788](https://arxiv.org/abs/1804.07788) · [2018ApJS..236...47W](https://ui.adsabs.harvard.edu/abs/2018ApJS..236...47W)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| solar absolute V magnitude | 4.83 | disagrees | p. 1, Abstract; p. 6, Table 3 (Johnson V) | “estimated absolute magnitudes of the Sun are MB = 5.44, MV = 4.81 and MK = 3.27 mag in the vegamag system” |

<a id="wilquet2009"></a>
### Wilquet et al. 2009 — Preliminary characterization of the upper haze by SPICAV/SOIR solar occultation in UV to mid-IR onboard Venus Express

JGR Planets 114, E00B42 (2009) · [doi:10.1029/2008JE003186](https://doi.org/10.1029/2008JE003186) · [2009JGRE..114.0B42W](https://ui.adsabs.harvard.edu/abs/2009JGRE..114.0B42W)

- **Copy:** `publishedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Venus upper-haze optical depth range | τ 0.05–0.3 | not in paper | whole text searched (Abstract, Sects. 1, 4–6) |  |

<a id="wilson1953"></a>
### Wilson R. E. 1953 — General Catalogue of Stellar Radial Velocities

[1953GCRV..C......0W](https://ui.adsabs.harvard.edu/abs/1953GCRV..C......0W)

- **Copy:** `VizieR ReadMe`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| GCRV bibcode on SIMBAD rv values (test fixture) | 1953GCRV..C......0W | verified | l. 6 | “=1953GCRV..C......0W” |
| GCRV is a pre-Gaia literature RV compilation |  | verified | l. 11 | “The General Catalogue of Stellar Radial Velocity is a compilation of the radial velocities for about 15,000 stars” |
| precision of the literature RVs ('quoted to the nearest km/s or half') |  | disagrees | l. 51; l. 68 | “42- 46  I5   0.1km/s  RV      ?=9999 Heliocentric radial velocity” |

<a id="wittkowski2016"></a>
### Wittkowski et al. 2016 — Near-infrared spectro-interferometry of Mira variables and comparisons to 1D dynamic model atmospheres and 3D convection simulations

A&A 587, A12 (2016) · [doi:10.1051/0004-6361/201527614](https://doi.org/10.1051/0004-6361/201527614) · [arXiv:1601.02368](https://arxiv.org/abs/1601.02368) · [2016A&A...587A..12W](https://ui.adsabs.harvard.edu/abs/2016A%26A...587A..12W)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Mira physical radius varies ~1.1–1.5× | ~1.1–1.5× | not in paper | p. 7, Sect. 3.3; p. 4, Sect. 2.3 | “the θRoss values also do not indicate an intracycle or cycle-to-cycle variability within the limited separations” |

<a id="wolff2009"></a>
### Wolff et al. 2009 — Wavelength dependence of dust aerosol single scattering albedo as observed by the Compact Reconnaissance Imaging Spectrometer

JGR Planets 114, E00D04 (2009) · [doi:10.1029/2009JE003350](https://doi.org/10.1029/2009JE003350) · [2009JGRE..114.0D04W](https://ui.adsabs.harvard.edu/abs/2009JGRE..114.0D04W)

- **Copy:** `publishedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Mars dust single-scattering albedo, red channel | ω̃ ≈ 0.97 | verified | p. 11, Fig. 12 | “Figure 12. Average ω0 spectra (both MER sites) as a function of the assumed reff.” |
| Mars dust single-scattering albedo, green channel | ω̃ ≈ 0.90 | verified | p. 11, Fig. 12 | “Figure 12. Average ω0 spectra (both MER sites) as a function of the assumed reff.” |
| Mars dust single-scattering albedo, blue channel | ω̃ ≈ 0.75 | disagrees | p. 11, Fig. 12 | “Figure 12. Average ω0 spectra (both MER sites) as a function of the assumed reff.” |

<a id="woodruff2008"></a>
### Woodruff et al. 2008 — The Keck Aperture Masking Experiment: Multiwavelength Observations of Six Mira Variables

ApJ 673, 418-433 (2008) · [doi:10.1086/523936](https://doi.org/10.1086/523936) · [arXiv:0709.3878](https://arxiv.org/abs/0709.3878) · [2008ApJ...673..418W](https://ui.adsabs.harvard.edu/abs/2008ApJ...673..418W)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Mira radius variation ~1.1–1.5× | ~1.1–1.5× | disagrees | p. 20, Sect. 4.2; p. 23, Sect. 4.3 | “The peak-to-peak sinusoidal pulsation amplitudes for the J 1.24, H 1.65 and L 3.08 bandpasses are 14%, 22% and 6% respectively” |

<a id="woodruff2009"></a>
### Woodruff et al. 2009 — The Keck Aperture Masking Experiment: Spectro-interferometry of Three Mira Variables from 1.1 to 3.8 um

ApJ 691, 1328-1336 (2009) · [doi:10.1088/0004-637X/691/2/1328](https://doi.org/10.1088/0004-637X/691/2/1328) · [arXiv:0811.1642](https://arxiv.org/abs/0811.1642) · [2009ApJ...691.1328W](https://ui.adsabs.harvard.edu/abs/2009ApJ...691.1328W)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Mira radius variation | ~1.1–1.5× | not in paper | p. 5, Sect. 3; p. 6, Sect. 5; p. 10 | “exhibiting a factor of ∼ 2 in UD diameter between 1.0 µm and 3.0 µm” |

<a id="wyman2013"></a>
### Wyman, Sloan & Shirley 2013 — Simple Analytic Approximations to the CIE XYZ Color Matching Functions

JCGT 2(2), 1-11 · [jcgt.org/published/0002/02/01](https://jcgt.org/published/0002/02/01/)

- **Copy:** `publishedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| multi-lobe piecewise-Gaussian CIE 1931 CMF fit coefficients | x̄: 0.362/442.0/16.0/26.7, 1.056/599.8/37.9/31.0, −0.065/501.1/20.4/26.2; ȳ: 0.821/568.8/46.9/40.5, 0.286/530.9/16.3/31.1; z̄: 1.217/437.0/11.8/36.0, 0.681/459.0/26.0/13.8 (amplitude/centre/σ_lo/σ_hi, nm) | verified | p. 4, Table 1 and Eq. (4) | “α 0.362 1.056 -0.065 0.821 0.286 1.217 0.681” |
| fits reproduce the tabulated CMFs to ~1% | ~1% | verified | p. 5, Table 2 | “1931 Multi-lobe fit (Sec. 2.2) 2.0e-4 6.4e-5 4.9e-4” |

<a id="zacharias2012"></a>
### Zacharias 2012 — UCAC4 (VizieR I/322)

[2012yCat.1322....0Z](https://ui.adsabs.harvard.edu/abs/2012yCat.1322....0Z)

- **Copy:** `VizieR ReadMe`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| UCAC4 catalogue bibcode (SIMBAD PM-tier literature source) | 2012yCat.1322....0Z | verified | l. 7 | “=2012yCat.1322....0Z” |
| EZ Aqr literature PM | 2314.8 / 2295.3 mas/yr | unverified |  |  |

<a id="zhang2023"></a>
### Zhang-Green-Rix 2023 — Parameters of 220 million stars from Gaia BP/RP spectra

MNRAS 524, 1855-1884 (2023) · [doi:10.1093/mnras/stad1941](https://doi.org/10.1093/mnras/stad1941) · [2023MNRAS.524.1855Z](https://ui.adsabs.harvard.edu/abs/2023MNRAS.524.1855Z)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| E_ZGR → A_V conversion | A_V = 2.742 × E_ZGR (A_λ/E = 2.78 at 540 nm, 2.73 at 545 nm) | not in paper | p. 2, Eq. (1); p. 5, Eq. (7); p. 19, Fig. 15 caption | “The full extinction curve is available as an electronic table at https://doi.org/10.5281/zenodo.7692680.” |
| E_ZGR is the ZGR23 extinction unit (the Edenhofer voxel unit) |  | verified | p. 5, Sect. 2.5 model (Eq. 7) | “where 𝐸 is a scalar measurement of the amount of extinction in front of the star along the line of sight” |

<a id="zucker2020"></a>
### Zucker 2020 — A compendium of distances to molecular clouds in the Star Formation Handbook

A&A 633, A51 · [doi:10.1051/0004-6361/201936145](https://doi.org/10.1051/0004-6361/201936145) · [arXiv:2001.00591](https://arxiv.org/abs/2001.00591) · [2020A&A...633A..51Z](https://ui.adsabs.harvard.edu/abs/2020A%26A...633A..51Z)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| molecular-cloud distances (Table A.1 sightlines) | 326 sightlines → 95 named regions (84 spheres after Zucker 2021 supersedes the rest) | verified | p. 5, Sect. 3 | “In Table A.1, we summarize our distance results for the 326 sightlines targeted towards clouds in the Star Formation Handbook.” |

<a id="zucker2021"></a>
### Zucker 2021 — On the Three-dimensional Structure of Local Molecular Clouds

ApJ 919, 35 · [doi:10.3847/1538-4357/ac1f96](https://doi.org/10.3847/1538-4357/ac1f96) · [arXiv:2109.09765](https://arxiv.org/abs/2109.09765)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| 3D cloud extents (Table 1), 12 clouds incl. Corona Australis | zucker2021-table1.dat (l, b, d min/med/max, x/y/z min/max) | verified | p. 8, Table 1 | “Chamaeleon 299.0 -15.9 173 183 190 69 99 -159 -148 -57 -35 1 68” |
| Table 1 extents are the cloud's 3D bounding box (volume) |  | disagrees | p. 8, Table 1 note | “Minimum and maximum extent of the cloud’s skeleton in the Heliocentric Galactic cartesian x direction.” |
| Plummer profile fits n0, R_flat, p (Table 2), 11 clouds | zucker2021-table2.dat Plummer columns | verified | p. 7, Eq. (4); p. 11, Table 2 | “our free parameters are n0 (peak profile height), Rflat (the flattening radius), and p (index of the density profile)” |
| profile measured perpendicular to the cloud's spine |  | verified | p. 6, Sect. 3.2.1 | “we generate a slice through the volume density cube at each point along the spine given the normal vector” |
| cloud masses from the NICEST column (Table 3) | mass_nicest, e.g. Taurus 15610 M☉ | verified | p. 18, Table 3 | “Taurus 1.6e+04 1.5e+04 1.0 0.90 0.38” |
| peak A_K at Leike resolution | max_ak_leike 0.19–0.38 (→ A_V ≈ 1.6–3.3) | verified | p. 18, Table 3 | “Musca 5.9e+02 4.9e+02 1.2 0.47 0.19” |
| peak A_K NICEST for Taurus / Ophiuchus | 0.90 / 1.99 | verified | p. 18, Table 3 | “Ophiuchus 9.4e+03 7.9e+03 1.2 1.99 0.31” |
| Leike-map mass underestimate: saturates in dense gas, up to ~14× (mass_ratio) | up to ~14× | disagrees | p. 19, Sect. 5 | “the ratio of the NICEST mass to the 3D dust mass ranges from 1.0 to 1.6, with an average of 1.2, for the “complete clouds,” |

<a id="zucker2022"></a>
### Zucker et al. 2022 — Star formation near the Sun is driven by expansion of the Local Bubble

Nature 601, 334 · [doi:10.1038/s41586-021-04286-5](https://doi.org/10.1038/s41586-021-04286-5) · [arXiv:2201.05124](https://arxiv.org/abs/2201.05124)

- **Copy:** `submittedVersion`

| Claim | Value | Status | Page | Passage |
|---|---|---|---|---|
| Local Bubble inner-surface HEALPix map (wall distance, ℓmax spherical-harmonic reconstructions) |  | not in paper | p. 1; p. 12, Methods; ref. 13 | “a new Gaia-era 3D model of the Local Bubble’s inner surface of neutral gas and dust10,13” |

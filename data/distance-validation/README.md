# Distance-validation reference data

External reference distances for cross-checking the catalogue's adopted
Bailer-Jones override (`scripts/catalog/build-catalog.ts`) against an
independently-derived posterior.

## `vaidman-2025-supergiants.tsv`

132 Galactic BA-type supergiants with Bayesian distance posteriors from:

> Vaidman, N.L., Khokhlov, S.A., Miroshnichenko, A.S., Agishev, A.T.,
> Yermekbayev, B.S., 2025. *A Quality-Controlled Bayesian Recalculation of
> Gaia DR3/EDR3 Distances for 132 Galactic BA-Type Supergiants*,
> **Universe**, 11(11), 359.
> DOI: [10.3390/universe11110359](https://doi.org/10.3390/universe11110359)

Open-access under [Creative Commons CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
The table contents in this TSV are reproduced from the paper's appendix
Tables A1 (119 rows) and A2 (13 rows) verbatim; the only added column is
`gaia_source_id`, resolved per the *Name resolution* section below.

### Schema

| Column                  | Source            | Notes                                                                                   |
| ----------------------- | ----------------- | --------------------------------------------------------------------------------------- |
| `name`                  | paper Table A1/A2 | Star name as printed (`HD 1070`, `BD+60 51`, `V755 Cas`, Greek-letter Bayer, etc.)      |
| `d_bj_paper_pc`         | paper             | Bailer-Jones 2021 r_med_photogeo as the paper read it (pc).                             |
| `sigma_d_bj_paper_pc`   | paper             | Bailer-Jones 1-σ (pc).                                                                  |
| `ruwe`                  | paper             | Gaia DR3 renormalised unit-weight error.                                                |
| `g_mag`                 | paper             | Gaia DR3 G magnitude.                                                                   |
| `d_new_pc`              | paper             | Paper's recalculated Bayesian distance under their EDSD prior + ZP correction (pc).     |
| `sigma_d_new_pc`        | paper             | Paper's 1-σ on `d_new_pc` (pc).                                                         |
| `snr_tot`               | paper             | Total parallax SNR after RUWE-inflated uncertainty.                                     |
| `prior_scale_pc`        | paper             | Adopted EDSD prior scale-length L (pc).                                                 |
| `adopted`               | derived           | `EDSD_new` (Table A1, 119 rows) or `BJ_old` (Table A2, 13 rows).                        |
| `gaia_source_id`        | SIMBAD            | Gaia DR3 source_id; see *Name resolution* below.                                        |

`adopted` is the paper's own quality flag. `EDSD_new` rows passed their
SNR + RUWE quality cut and their EDSD-prior posterior is the adopted
distance. `BJ_old` rows failed the cut; the paper reverts to Bailer-Jones
and explicitly does NOT recommend `d_new_pc` for quantitative use on
this subset.

### Name resolution → `gaia_source_id`

All 132 source_ids were hand-resolved once via SIMBAD's Sesame-style
ASCII endpoint and verified against the paper's reported `g_mag`. The
canonical mapping is committed inline in
`scripts/distance-validation/build-vaidman-tsv.py::NAME_TO_GAIA_DR3`.

The resolution recipe per name type:

| Name type                | Procedure                                                                                                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HD ####` / `BD±## ###` / `HR ####` / `V### Const` / `V#### Const` | `curl 'https://simbad.cds.unistra.fr/simbad/sim-id?Ident=<name>&output.format=ASCII'` → grep `Gaia DR3 N+` from the *Identifiers* block.                                          |
| Flamsteed-number Bayer (`9 Gem`, `42 Cyg`, `4 Lac`, …)              | Sesame accepts these verbatim.                                                                                                                                                  |
| Greek-letter Bayer (`θ Aql`, `η Leo`, `σ Cyg`, `φ Cas`, `χ Aur`)    | Substitute the three-letter Sesame abbreviation (`tet`, `eta`, `sig`, `phi`, `chi`) then query as above.                                                                        |
| Numbered Greek Bayer (`θ 2 Tau`)                                    | Substitute and zero-pad the digit (`tet02 Tau`).                                                                                                                                |
| `o Sco` (lowercase-o Bayer)                                         | Use `omi Sco` — `o` here is the Latin Bayer letter for omicron, not a Greek glyph.                                                                                              |
| `6 Cas`, `HD 43820`                                                 | SIMBAD's primary lookup carries no Gaia DR3 cross-ID for the system (a known SIMBAD coverage gap). Resolved by 5″ cone-search of VizieR `I/355/gaiadr3` around SIMBAD coordinates and verified by G-magnitude match. |
| `ϵ CMa`                                                             | Adhara (G ≈ 1.5) saturates Gaia DR3; the paper's G = 8.38 matches the catalogued companion `eps CMa B` (verified). The mapping uses the B-component source_id.                  |

Run `python scripts/distance-validation/build-vaidman-tsv.py --pdf <PDF>` to
re-extract the TSV from the paper PDF. Any name newly present in the PDF
but absent from the inline mapping triggers a hard fail; extend the
mapping by the same procedure above and re-run.

## Coverage gaps

22 of the 119 EDSD_new source_ids and 1 of the 13 BJ_old source_ids are
absent from `data/bailer-jones/bailer-jones-dr3.tsv` — those Gaia DR3
sources are not in AT-HYG (typically because the BA supergiants in
question are dimmer than AT-HYG's V cutoff) and so were never queried
when `refresh-bailer-jones.py` populated the catalogue's distance
overrides. The validator reports them as `unresolved` rather than failing
— they're outside the catalogue's coverage envelope, so the override
mechanism dch.47 has nothing to override TO and there is nothing to
validate against.

## Known outlier

`HD 22227` (Gaia DR3 3274329517095420544): the catalogue's Bailer-Jones
photogeometric distance (~390 pc) is about 60 % short of the paper's
`d_new` (~992 pc). Both numbers come from the same Gaia source_id, so
the disagreement reflects either a posterior-tail difference at this
SNR or a name-resolution ambiguity in the paper's own input list. Out
of scope for this PR; surfaces in the validator's top-N report.

## License — attribution of derived work

The numeric contents of this TSV (every column except `gaia_source_id`)
are © Vaidman et al. 2025 and reproduced under CC BY 4.0. The
`gaia_source_id` column is derived from SIMBAD / VizieR. The TSV is
redistributed in this repository in the same spirit (research /
reproducibility) the paper itself adopts in publishing the appendix
tables.

Format changes from the paper: column names normalised to snake_case
ASCII; column N (row index) dropped; `adopted` regime added; trailing
`gaia_source_id` added.

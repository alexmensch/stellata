#!/usr/bin/env python3
"""Build data/distance-validation/vaidman-2025-supergiants.tsv from the
Vaidman et al. 2025 paper PDF. One-shot reference-data builder; see
data/distance-validation/README.md for provenance and license."""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path
from typing import Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ADOPTED_BJ_OLD, ADOPTED_EDSD_NEW  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent.parent
OUT = ROOT / "data" / "distance-validation" / "vaidman-2025-supergiants.tsv"

TSV_COLUMNS = (
    "name",
    "d_bj_paper_pc",
    "sigma_d_bj_paper_pc",
    "ruwe",
    "g_mag",
    "d_new_pc",
    "sigma_d_new_pc",
    "snr_tot",
    "prior_scale_pc",
    "adopted",
    "gaia_source_id",
)

EXPECTED_A1_ROWS = 119
EXPECTED_A2_ROWS = 13

# Paper-name → Gaia DR3 source_id, hand-resolved once via SIMBAD and
# G-mag-verified against the paper. Resolution recipe per name type is
# documented in data/distance-validation/README.md § Name resolution.
# In-line notes below cover only the special cases where the obvious
# SIMBAD lookup picks the wrong source.
NAME_TO_GAIA_DR3: dict[str, int] = {
    # ─── Table A1 (119 EDSD_new rows) ───
    "HD 1070":           429030231736304256,
    "BD+60 51":          430381943846423808,
    "HD 2928":           430731073149049984,
    "HD 3283":           425588485465026048,
    "V755 Cas":          524063839226112896,
    "BD+61 153":         427677042161748480,
    "HD 4717":           523674058051879168,
    "HD 4841":           523812051065920768,
    "HD 5776":           522964877353947008,
    "HD 7902":           413827353180436736,
    "HD 7720":           510955908273310976,
    "HD 8065":           565226393465365376,
    "BD+62 246":         511080702841800320,
    "HD 9233":           509253829917189760,
    "HD 9311":           509863199881958656,
    "HD 9811":           513064148796472064,
    "HD 15316":          458089636866031744,
    "HD 62888":          5614636782708944384,
    "BD+60 331":         511264424368755584,
    "BD+60 333":         511264218211789952,
    "BD+60 339":         511264699246655488,
    "V819 Cas":          2011857518631414656,
    "BD+56 386":         504957934907964672,
    "HD 11831":          508011587934161408,
    "53 Cas":            518061296009524480,
    "V472 Per":          506778691804372736,
    "HD 13476":          506810435899344896,
    "HD 13744":          458762022584923136,
    "HD 14010":          515211533672475264,
    "HD 14322":          458241541269642880,
    "HD 14433":          458456358355233920,
    "V474 Per":          457487413730043904,
    "V553 Per":          458414542551436672,
    "HD 14542":          458463951857361024,
    "HD 14899":          458420177549867392,
    "V425 Per":          458075652452721664,
    "HD 15620":          458172924869294208,
    "HD 16778":          464359258321922816,
    "HD 236995":         463988100127727872,
    "HD 17088":          460900229100122368,
    "HD 17145":          460887893954085632,
    "V480 Per":          460787426079902208,
    "HD 20041":          448103803535751680,
    "CS Cam":            462250738616785152,
    "CE Cam":            450113435913489792,
    "HD 237153":         449919440829879040,
    "BD+55 838":         468502561734102400,
    "AZ CMi":            3088730511223509376,
    "HD 19978":          555179502886541824,
    "BD+43 1168":        205501270150651648,
    "19 Aur":            181259753177437568,
    "HD 35600":          3446200914143500160,
    "HD 248587":         3398822751945120128,
    "HD 39970":          3427962936819149824,
    "HD 40297":          3431199177497199488,
    "HD 40589":          3431191274757139328,
    "HD 42400":          3375310795296736512,
    "HD 253250":         3345828623650264192,
    "9 Gem":             3425577786858742272,
    "HD 43910":          3332404106371650944,
    "13 Mon":            3324424744330466304,
    "HR 2409":           3120595698224445312,
    "HD 46783":          3326877514251606528,
    "HD 48452":          3351229978819788672,
    "MWC 536":           3113547759973829120,
    "HD 55036":          3059411758795283968,
    "HD 58439":          2930605930106115840,
    "HD 59612":          5618683092877834368,
    "HR 3183":           5713071321401501568,
    "HR 3345":           5706229472852227840,
    "HD 164865":         4066118901493794816,
    "HD 165784":         4069845455625999872,
    "V4387 Sgr":         4094860616496202624,
    "HD 167838":         4146137303301073792,
    "BD-12 4970":        4153511865229770368,
    "AS 314":            4103870014799982464,
    "HD 175687":         4085003803955277056,
    "HD 332757":         2028274429877194752,
    "HT Sge":            4323280515006629760,
    "HR 7699":           2058352669922023424,
    "42 Cyg":            2056972679739120000,
    "55 Cyg":            2166348110749083520,
    "HD 199478":         2166846047768767488,
    "9 Cep":             2216195157578923136,
    "Nu Cep":            2216072562036493440,
    "HD 207673":         1960290835599977728,
    "13 Cep":            2198963817515042560,
    "HD 209900":         2005308689947128448,
    "V399 Lac":          2005264640764436736,
    "HD 239886":         2198645577619377536,
    "HD 239895":         2198759823744627328,
    "HD 211971":         2201264820470270848,
    "4 Lac":             1999776222304976384,
    "HD 239950":         2007789428690846464,
    "HD 213470":         2007614640707006976,
    "BD+62 2210":        2207517777453003904,
    "BD+60 2542":        2015460652598301696,
    "BD+61 2472":        2015790162481164416,
    "HD 22227":          3274329517095420544,
    # "6 Cas A" component: SIMBAD's "6 Cas" carries no Gaia DR3 cross-id,
    # but the paper's G=5.29 matches the A component (Gaia G=5.29 exact).
    "6 Cas":             2012942564813958656,
    "BD+62 2313":        2016139085631723264,
    "HD 223767":         2012765337282245888,
    "HD 186745":         2020506380187203200,
    "HD 184943":         2021020882948644608,
    "HD 161695":         4598003837468318464,
    # SIMBAD's "HD 43820" carries no Gaia DR3 cross-id; resolved by 5"
    # cone-search of VizieR I/355/gaiadr3 around SIMBAD coords (G=8.35
    # matches paper exactly).
    "HD 43820":          3344530894990927744,
    "HD 17086":          464823080431243008,
    "HD 17857":          467904152529229952,
    "HD 216912":         2013193665778362752,
    "HD 13717":          456764450470593408,
    "HD 28747":          253606381338861056,
    "BD+60 2582":        2012432631927515264,
    "HD 58131":          2930228866344200448,
    "HD 47314":          3131881360451817216,
    "HD 58585":          5619599329664097536,
    "HD 58764":          5620284256691515648,
    "44 Cas":            509717686388338816,
    "GQ Cam":            469234114921994112,
    # eps CMa = Adhara (V~1.5) saturates Gaia DR3; the paper's G=8.38 is
    # the catalogued companion eps CMa B (HD 52089 B).
    "ϵ CMa":            5608832155887268480,
    # ─── Table A2 (13 BJ_old rows) ───
    "φ Cas":            413828761929696256,
    "σ Cyg":            1965171945678382208,
    "HD 10756":          511164815483973888,
    "θ Aql":            4224225924761329792,
    "5 Per":             506664136434780288,
    "HD 55493":          3032377276127115008,
    "V455 Cep":          2013448099637948672,
    "67 Oph":            4469314179061640320,
    "η Leo":            622052899598187392,
    "HD 187982":         2026641620708032640,
    "θ 2 Tau":          3312744219988782720,
    # "o Sco" = omi Sco / HD 147084 — the lowercase Latin letter o is the
    # Bayer letter; Sesame resolves "omi Sco" (or "HD 147084") to the
    # same Gaia source.
    "o Sco":             6050060708908632960,
    "χ Aur":            3448691754658000640,
}

_NUM_RE = re.compile(r"^-?\d+(\.\d+)?$")


def parse_appendix_row(line: str, adopted: str) -> dict[str, object] | None:
    """Parse one PDF appendix line. The trailing 8 tokens are numerics, the
    leading token is N, and any tokens between are the (possibly multi-word)
    star name. Returns None if the line is not a data row."""
    tokens = line.split()
    if len(tokens) < 10:
        return None
    if not tokens[0].isdigit():
        return None
    if not all(_NUM_RE.match(t) for t in tokens[-8:]):
        return None
    name = " ".join(tokens[1:-8])
    if not name:
        return None
    d_bj, sigma_d_bj, ruwe, g_mag, d_new, sigma_d_new, snr_tot, prior_scale = (
        float(t) for t in tokens[-8:]
    )
    return {
        "name": name,
        "d_bj_paper_pc": d_bj,
        "sigma_d_bj_paper_pc": sigma_d_bj,
        "ruwe": ruwe,
        "g_mag": g_mag,
        "d_new_pc": d_new,
        "sigma_d_new_pc": sigma_d_new,
        "snr_tot": snr_tot,
        "prior_scale_pc": prior_scale,
        "adopted": adopted,
    }


# Paper section markers — pdftotext preserves these as their own lines.
A1_START = "Table A1."
A2_START = "Table A2."
A2_END = "References"


def extract_tables(text: str) -> tuple[list[dict], list[dict]]:
    """Walk the pdftotext output and emit Table A1 / Table A2 row dicts.
    Lines belonging to a Table A1. Cont. header are ignored; only the
    'Table A2.' marker switches the adopted-distance regime."""
    a1: list[dict] = []
    a2: list[dict] = []
    in_a1 = False
    in_a2 = False
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith(A2_START):
            in_a1 = False
            in_a2 = True
            continue
        if stripped.startswith(A1_START):
            in_a1 = True
            in_a2 = False
            continue
        if in_a2 and stripped.startswith(A2_END):
            in_a2 = False
            continue
        if in_a1:
            row = parse_appendix_row(line, ADOPTED_EDSD_NEW)
            if row is not None:
                a1.append(row)
        elif in_a2:
            row = parse_appendix_row(line, ADOPTED_BJ_OLD)
            if row is not None:
                a2.append(row)
    return a1, a2


def attach_gaia_source_ids(
    rows: Sequence[dict], mapping: dict[str, int] = NAME_TO_GAIA_DR3
) -> list[str]:
    """Mutate each row in-place to add a `gaia_source_id` cell from the
    name→source_id mapping. Returns the list of names that are present in
    the parsed rows but missing from the mapping — these surface to the
    caller as a hard failure so an unknown name from a paper erratum
    cannot quietly land with a blank source_id."""
    missing: list[str] = []
    for row in rows:
        sid = mapping.get(row["name"])
        if sid is None:
            missing.append(row["name"])
        row["gaia_source_id"] = sid
    return missing


def run_pdftotext(pdf: Path) -> str:
    proc = subprocess.run(
        ["pdftotext", "-layout", str(pdf), "-"],
        check=True,
        capture_output=True,
        text=True,
    )
    return proc.stdout


def write_tsv(rows: Sequence[dict], output: Path) -> int:
    output.parent.mkdir(parents=True, exist_ok=True)
    tmp = output.with_suffix(output.suffix + ".tmp")
    try:
        with tmp.open("w", encoding="utf-8") as f:
            f.write("\t".join(TSV_COLUMNS) + "\n")
            for row in rows:
                cells = []
                for col in TSV_COLUMNS:
                    v = row.get(col)
                    if v is None:
                        cells.append("")
                    elif isinstance(v, float):
                        cells.append(f"{v:.3f}")
                    else:
                        cells.append(str(v))
                f.write("\t".join(cells) + "\n")
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    tmp.replace(output)
    return len(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument(
        "--pdf",
        type=Path,
        default=ROOT / "universe-11-00359.pdf",
        help="Path to the Vaidman et al. 2025 paper PDF (CC BY 4.0).",
    )
    args = parser.parse_args()

    if not args.pdf.exists():
        raise SystemExit(
            f"build-vaidman-tsv: PDF not found at {args.pdf}. "
            f"Drop the paper PDF (DOI 10.3390/universe11110359) at the repo "
            f"root or pass --pdf <path>; remove it after the TSV is committed."
        )

    print(f"extracting tables from {args.pdf.name} via pdftotext -layout …")
    text = run_pdftotext(args.pdf)
    a1, a2 = extract_tables(text)
    print(f"  Table A1 (EDSD_new): {len(a1)} rows (expect {EXPECTED_A1_ROWS})")
    print(f"  Table A2 (BJ_old):   {len(a2)} rows (expect {EXPECTED_A2_ROWS})")
    if len(a1) != EXPECTED_A1_ROWS:
        raise SystemExit(
            f"build-vaidman-tsv: Table A1 row count {len(a1)} != "
            f"{EXPECTED_A1_ROWS}; the appendix layout has changed or the "
            f"parser missed rows. Inspect pdftotext output before re-pinning."
        )
    if len(a2) != EXPECTED_A2_ROWS:
        raise SystemExit(
            f"build-vaidman-tsv: Table A2 row count {len(a2)} != "
            f"{EXPECTED_A2_ROWS}; same drift mode as A1."
        )

    rows = a1 + a2
    missing = attach_gaia_source_ids(rows)
    if missing:
        raise SystemExit(
            f"build-vaidman-tsv: {len(missing)} paper name(s) not in the "
            f"NAME_TO_GAIA_DR3 mapping: {missing}. The paper may have "
            f"added a row in an erratum; resolve via SIMBAD per "
            f"data/distance-validation/README.md and extend the mapping."
        )

    written = write_tsv(rows, OUT)
    print(f"wrote {OUT.relative_to(ROOT)} ({written} rows)")


if __name__ == "__main__":
    main()

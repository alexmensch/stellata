"""Measure what each frozen source contains, against its provenance row.
Manual, not in the build. Why: data/textures/src/README.md § Auditing.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

REPO = Path(__file__).resolve().parents[2]
SRC = REPO / 'data' / 'textures' / 'src'

# A row claiming an un-imaged hemisphere has to show a true black band there.
# Reading the row cannot confirm it; a band that is merely dark is a stretched
# mosaic, and a band that is black in a row claiming coverage is a real gap
# nobody disclosed.
BLACK = 8
# A mirrored hemisphere is NOT "north correlates with flipped south". Two
# innocent causes reach a high aligned correlation: latitudinal banding (Venus
# 0.97, Saturn 0.80) and a longitudinal albedo province spanning both
# hemispheres (Iapetus 0.90). Only the second is broken by a longitude shift,
# so the shifted baseline separates them but does not identify a mirror on its
# own. A literal duplicated hemisphere is a near-exact copy, so the flag needs
# BOTH a near-unity alignment and a collapse under shift; anything below that
# is a prompt to look, not a finding.
MIRROR_ALIGNED = 0.95
MIRROR_MARGIN = 0.25
# One or two black rows at a pole is the equirect singularity, not a data gap
# (Ganymede's 5 rows are 0.24% of its map). A real gap is a band.
MIN_GAP_FRACTION = 0.01

# Working size for the mirror and chroma passes, which are scale-free
# statistics. The gap pass keeps its native row count — see _row_means.
WORK_WIDTH = 512

# Rows claiming a band is reconstructed rather than imaged, and that band's
# latitude range. Pixels cannot settle the claim, so the point of measuring is
# to state what was and was not ruled out.
RECONSTRUCTED = {'neptune-bjj.jpg': (50.0, 90.0)}


def _load(path: Path) -> np.ndarray:
    with Image.open(path) as im:
        if im.mode.startswith('I'):
            # A DEM, not imagery — its own reduction script owns those checks.
            return np.zeros((0, 0, 3), dtype=np.uint8)
        small = im.convert('RGB').resize(
            (WORK_WIDTH, WORK_WIDTH // 2), Image.Resampling.BOX)
    return np.asarray(small)


def _row_means(path: Path) -> np.ndarray | None:
    """Mean luminance per latitude row, at the file's NATIVE row count.

    Width collapses to WORK_WIDTH first — a BOX reduction across a row is
    that row's mean — but the row count has to stay native, or the band edge
    quantises to the working resolution (0.70° per row at 256) and stops
    matching the tenths the provenance rows quote.
    """
    with Image.open(path) as im:
        if im.mode.startswith('I'):
            return None
        strip = im.convert('RGB').resize(
            (WORK_WIDTH, im.height), Image.Resampling.BOX)
    return np.asarray(strip).astype(np.float64).mean(axis=(1, 2))


def _gap_bands(rows: np.ndarray) -> str:
    """Latitude edge and map fraction of any contiguous near-black band
    touching a pole, both from the one run so a row cannot quote them from
    different measurements."""
    n = len(rows)
    spans = []
    for pole, walk in (('+90', range(n)), ('-90', range(n - 1, -1, -1))):
        run = 0
        for i in walk:
            if rows[i] >= BLACK:
                break
            run += 1
        if run < n * MIN_GAP_FRACTION:
            continue
        edge = 180.0 * run / n
        far = 90.0 - edge if pole == '+90' else edge - 90.0
        spans.append(f'{pole}..{far:+.1f}° ({run / n:.1%})')
    return ', '.join(spans) if spans else '—'


def _corr(a: np.ndarray, b: np.ndarray) -> float:
    a = a.astype(np.float64).ravel()
    b = b.astype(np.float64).ravel()
    if a.std() == 0 or b.std() == 0:
        return float('nan')
    return float(np.corrcoef(a, b)[0, 1])


def _aligned_vs_shifted(a: np.ndarray, b: np.ndarray) -> tuple[float, float]:
    """Correlation at zero longitude shift, against the mean over non-zero
    shifts. Only the GAP between the two is evidence: a copy matches where it
    lines up and nowhere else, while anything latitudinally banded matches at
    every shift. The aligned number alone says nothing."""
    w = a.shape[1]
    shifts = [_corr(a, np.roll(b, s, axis=1)) for s in range(w // 8, w, w // 8)]
    return _corr(a, b), float(np.nanmean(shifts))


def _mirror(rgb: np.ndarray) -> tuple[float, float]:
    """Whole-disc mirror test: north against flipped south."""
    h = rgb.shape[0]
    return _aligned_vs_shifted(rgb[: h // 2], rgb[h // 2:][::-1])


def _chroma(rgb: np.ndarray) -> float:
    """Mean |max channel − min channel|. Zero means the file is grayscale
    however it is stored, which is what a 'grayscale mosaic' row claims."""
    f = rgb.astype(np.float64)
    return float((f.max(axis=2) - f.min(axis=2)).mean())


def _longitudinal_detail(band: np.ndarray) -> float:
    """Mean |east−west first difference| over a latitude band, as a fraction
    of the band's mean luminance. Scale-free, so a bright band and a dim one
    are comparable; it says how much longitudinal structure survives, not
    whether that structure is real."""
    lum = band.astype(np.float64).mean(axis=2)
    mean = lum.mean()
    if mean == 0:
        return float('nan')
    return float(np.abs(np.diff(lum, axis=1)).mean() / mean * 100.0)


def _reconstruction(name: str, rgb: np.ndarray) -> None:
    """What the pixels do and do not rule out for a claimed-reconstructed
    band. Equirect convergence smooths any high-latitude band, so matching
    the OPPOSITE pole's detail is the null result, not evidence."""
    lat_lo, lat_hi = RECONSTRUCTED[name]
    h = rgb.shape[0]
    lat = 90.0 - (np.arange(h) + 0.5) * 180.0 / h
    north = rgb[(lat >= lat_lo) & (lat <= lat_hi)]
    south = rgb[(lat <= -lat_lo) & (lat >= -lat_hi)]
    aligned, shifted = _aligned_vs_shifted(north, south[::-1])
    print(f'  {name}: claimed-reconstructed +{lat_lo:.0f}..+{lat_hi:.0f}° '
          f'detail {_longitudinal_detail(north):.2f}%, '
          f'same band south {_longitudinal_detail(south):.2f}%, '
          f'fill-from-south r {aligned:.2f} aligned / {shifted:.2f} shifted')


def main() -> int:
    print(f"{'file':<30} {'dimensions':>13} {'polar gap':>26} "
          f"{'aligned':>8} {'shifted':>8} {'chroma':>7}")
    reconstructed = []
    for path in sorted(SRC.iterdir()):
        if path.suffix.lower() not in {'.jpg', '.tif'}:
            continue
        with Image.open(path) as im:
            dims = f'{im.width}x{im.height}'
            mode = im.mode
        rgb = _load(path)
        if rgb.size == 0:
            print(f'{path.name:<30} {dims:>13} {"(DEM)":>26}'
                  f'{"":>26}   mode={mode}')
            continue
        rows = _row_means(path)
        assert rows is not None
        aligned, shifted = _mirror(rgb)
        flag = (' MIRRORED?' if aligned > MIRROR_ALIGNED
                and aligned - shifted > MIRROR_MARGIN else '')
        print(f'{path.name:<30} {dims:>13} {_gap_bands(rows):>26} '
              f'{aligned:8.3f} {shifted:8.3f} {_chroma(rgb):7.2f}{flag}')
        if path.name in RECONSTRUCTED:
            reconstructed.append((path.name, rgb))
    if reconstructed:
        print('\nReconstruction claims — not decidable from pixels:')
        for name, rgb in reconstructed:
            _reconstruction(name, rgb)
    return 0


if __name__ == '__main__':
    sys.exit(main())

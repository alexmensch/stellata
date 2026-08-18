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
# (Ganymede has 5 of 2048). A real gap is a band.
MIN_GAP_FRACTION = 0.01

WORK_WIDTH = 512


def _load(path: Path) -> np.ndarray:
    with Image.open(path) as im:
        if im.mode.startswith('I'):
            # A DEM, not imagery — its own reduction script owns those checks.
            return np.zeros((0, 0, 3), dtype=np.uint8)
        small = im.convert('RGB').resize(
            (WORK_WIDTH, WORK_WIDTH // 2), Image.BOX)
    return np.asarray(small)


def _band_luminance(rgb: np.ndarray) -> np.ndarray:
    """Mean luminance per latitude band, north to south."""
    lum = rgb.astype(np.float64).mean(axis=2)
    return lum.mean(axis=1)


def _gap_bands(rgb: np.ndarray) -> str:
    """Latitude range of any contiguous near-black band touching a pole."""
    bands = _band_luminance(rgb)
    n = len(bands)
    spans = []
    for order in (range(n), range(n - 1, -1, -1)):
        run = 0
        for i in order:
            if bands[i] < BLACK:
                run += 1
            else:
                break
        if run < n * MIN_GAP_FRACTION:
            continue
        edge = 180.0 * run / n
        spans.append(f'+90..{90 - edge:+.0f}°' if order.start == 0
                     else f'-90..{edge - 90:+.0f}°')
    return ', '.join(spans) if spans else '—'


def _corr(a: np.ndarray, b: np.ndarray) -> float:
    a = a.astype(np.float64).ravel()
    b = b.astype(np.float64).ravel()
    if a.std() == 0 or b.std() == 0:
        return float('nan')
    return float(np.corrcoef(a, b)[0, 1])


def _mirror(rgb: np.ndarray) -> tuple[float, float]:
    """North vs flipped south at zero longitude shift, against the mean over
    non-zero shifts. A literal mirror only matches where it lines up; a
    latitudinally banded body matches everywhere, so the GAP is the signal
    and the raw correlation on its own is not."""
    h, w = rgb.shape[:2]
    north = rgb[: h // 2]
    south = rgb[h // 2:][::-1]
    aligned = _corr(north, south)
    shifts = [_corr(north, np.roll(south, s, axis=1))
              for s in range(w // 8, w, w // 8)]
    return aligned, float(np.nanmean(shifts))


def _chroma(rgb: np.ndarray) -> float:
    """Mean |max channel − min channel|. Zero means the file is grayscale
    however it is stored, which is what a 'grayscale mosaic' row claims."""
    f = rgb.astype(np.float64)
    return float((f.max(axis=2) - f.min(axis=2)).mean())


def main() -> int:
    print(f"{'file':<30} {'dimensions':>13} {'polar gap':>16} "
          f"{'aligned':>8} {'shifted':>8} {'chroma':>7}")
    for path in sorted(SRC.iterdir()):
        if path.suffix.lower() not in {'.jpg', '.tif'}:
            continue
        with Image.open(path) as im:
            dims = f'{im.width}x{im.height}'
            mode = im.mode
        rgb = _load(path)
        if rgb.size == 0:
            print(f'{path.name:<30} {dims:>13} {"(DEM)":>16}'
                  f'{"":>26}   mode={mode}')
            continue
        aligned, shifted = _mirror(rgb)
        flag = (' MIRRORED?' if aligned > MIRROR_ALIGNED
                and aligned - shifted > MIRROR_MARGIN else '')
        print(f'{path.name:<30} {dims:>13} {_gap_bands(rgb):>16} '
              f'{aligned:8.3f} {shifted:8.3f} {_chroma(rgb):7.2f}{flag}')
    return 0


if __name__ == '__main__':
    sys.exit(main())

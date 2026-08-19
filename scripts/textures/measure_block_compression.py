"""Angular error BC5 and lossy WebP each cost the shipped normal maps.
Manual, not in the build. Why: data/textures/relief/README.md § BC5 measured.
"""

from __future__ import annotations

import io
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from dem_relief import POLE_CUTOFF_DEG, weighted_quantile

REPO = Path(__file__).resolve().parents[2]
TEXTURES = REPO / 'data' / 'textures'
BODIES = ('moon', 'mercury', 'mars')

BLOCK = 4
QS = (0.5, 0.9, 0.99)


def _palettes(lo: np.ndarray, hi: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """BC4's two endpoint modes, per block.

    Mode 8 interpolates six values strictly between the endpoints; mode 6
    spends two of its eight codes on exact 0 and 255 and interpolates four
    between. A production encoder also searches endpoint perturbations;
    min/max endpoints sit within a fraction of a code value on data this
    smooth, and what is wanted here is the format's floor, not an encoder's
    ceiling.
    """
    p8 = np.stack(
        [hi, lo] + [((7 - i) * hi + i * lo) // 7 for i in range(1, 7)], axis=1)
    p6 = np.stack(
        [lo, hi] + [((5 - i) * lo + i * hi) // 5 for i in range(1, 5)]
        + [np.zeros_like(lo), np.full_like(lo, 255)], axis=1)
    return p8, p6


def encode_bc4_plane(plane: np.ndarray) -> np.ndarray:
    """Round-trip one 8-bit channel through BC4.

    Blocks are widened to int32 first: on raw uint8 the palette distance
    wraps, which silently picks the wrong code for any block spanning more
    than half the range.
    """
    h, w = plane.shape
    assert h % BLOCK == 0 and w % BLOCK == 0, f'{w}x{h} is not block-aligned'
    blocks = (plane
              .reshape(h // BLOCK, BLOCK, w // BLOCK, BLOCK)
              .transpose(0, 2, 1, 3)
              .reshape(-1, BLOCK * BLOCK)
              .astype(np.int32))
    lo = blocks.min(axis=1)
    hi = blocks.max(axis=1)
    best = None
    for palette in _palettes(lo, hi):
        idx = np.abs(blocks[:, :, None] - palette[:, None, :]).argmin(axis=2)
        decoded = np.take_along_axis(palette, idx, axis=1)
        err = np.abs(decoded - blocks).sum(axis=1)
        if best is None:
            best = (err, decoded)
        else:
            win = err < best[0]
            best = (np.where(win, err, best[0]),
                    np.where(win[:, None], decoded, best[1]))
    assert best is not None
    return (best[1].astype(np.uint8)
            .reshape(h // BLOCK, w // BLOCK, BLOCK, BLOCK)
            .transpose(0, 2, 1, 3)
            .reshape(h, w))


def encode_bc5(rg: np.ndarray) -> np.ndarray:
    """BC5 is two independent BC4 planes, which is exactly what the map
    needs: blue is a constant by construction and alpha is unused, so R and
    G are the whole signal — the same two the RG8 upload ships."""
    return np.dstack([encode_bc4_plane(rg[..., 0]), encode_bc4_plane(rg[..., 1])])


def encode_webp_rgb(img: np.ndarray, quality: int) -> np.ndarray:
    """The arm § Lossless rejected: both channels through one photographic
    codec, so libwebp's shared 4:2:0 chroma plane carries G at quarter
    resolution. This is the historical baseline, not a fair codec."""
    buf = io.BytesIO()
    Image.fromarray(img).save(buf, format='WEBP', quality=quality, lossless=False)
    buf.seek(0)
    return np.asarray(Image.open(buf).convert('RGB'))[..., :2]


def encode_webp_planes(img: np.ndarray, quality: int) -> np.ndarray:
    """One grayscale WebP per channel. Same DCT, no shared chroma plane —
    which is what isolates the codec's cost from the packing's."""
    out = []
    for c in (0, 1):
        buf = io.BytesIO()
        Image.fromarray(img[..., c], mode='L').save(
            buf, format='WEBP', quality=quality, lossless=False)
        buf.seek(0)
        out.append(np.asarray(Image.open(buf).convert('L')))
    return np.dstack(out)


def _normals(rg: np.ndarray) -> np.ndarray:
    """Decode the map's own convention: n = rg*2-1, z = sqrt(1 - x^2 - y^2)."""
    xy = rg.astype(np.float64) / 255.0 * 2.0 - 1.0
    z2 = np.clip(1.0 - xy[..., 0] ** 2 - xy[..., 1] ** 2, 0.0, None)
    return np.dstack([xy[..., 0], xy[..., 1], np.sqrt(z2)])


def _angles_deg(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    dot = np.clip((a * b).sum(axis=-1), -1.0, 1.0)
    return np.degrees(np.arccos(dot))


def _weighted_stats(err: np.ndarray) -> tuple[float, list[float]]:
    """cos(latitude)-weighted mean and percentiles, over the same
    |lat| <= POLE_CUTOFF_DEG window and through the same estimator
    `dem_relief.py` reports its tilt statistics under — the tilt figures
    these errors are quoted against."""
    h, w = err.shape
    lat = 90.0 - (np.arange(h) + 0.5) * 180.0 / h
    keep = np.abs(lat) <= POLE_CUTOFF_DEG
    values = err[keep].ravel()
    weights = np.repeat(np.cos(np.radians(lat[keep])), w)
    mean = float((values * weights).sum() / weights.sum())
    return mean, [weighted_quantile(values, weights, q) for q in QS]


HEADER = (f"{'body':<9} {'codec':<18} {'mean':>8} {'p50':>8} {'p90':>8} "
          f"{'p99':>8} {'max':>8}")


def _report(body: str, label: str, exact: np.ndarray, coded: np.ndarray) -> None:
    err = _angles_deg(exact, _normals(coded))
    mean, (p50, p90, p99) = _weighted_stats(err)
    print(f'{body:<9} {label:<18} {mean:7.3f}° {p50:7.3f}° {p90:7.3f}° '
          f'{p99:7.3f}° {err.max():7.3f}°')


def _source(body: str) -> np.ndarray:
    return np.asarray(Image.open(TEXTURES / f'{body}-normal.webp').convert('RGB'))


def measure(body: str) -> None:
    img = _source(body)
    exact = _normals(img[..., :2])
    arms = {
        'BC5': encode_bc5(img[..., :2]),
        'WebP q98 RGB': encode_webp_rgb(img, 98),
        'WebP q98 2-plane': encode_webp_planes(img, 98),
        'WebP q90 2-plane': encode_webp_planes(img, 90),
    }
    for label, coded in arms.items():
        _report(body, label, exact, coded)


def sweep(body: str) -> None:
    """BC5 error against map width. The 8192 tier does not exist yet, so
    whether block compression scales to it has to be read off the trend
    across the widths that do. The narrower maps are proxies: area-averaged
    encoded normals, renormalised by the sqrt decode, rather than maps
    re-derived from a reduced DEM the way `reduce_dem.py` builds the
    shipped one."""
    full = _source(body)
    w0 = full.shape[1]
    for width in (w0 // 4, w0 // 2, w0):
        img = (full if width == w0 else np.asarray(
            Image.fromarray(full).resize(
                (width, width // 2), Image.Resampling.BOX)))
        _report(body, f'BC5 @{width}', _normals(img[..., :2]),
                encode_bc5(img[..., :2]))


def main() -> int:
    print(HEADER)
    for body in BODIES:
        measure(body)
    print()
    sweep('moon')
    return 0


if __name__ == '__main__':
    sys.exit(main())

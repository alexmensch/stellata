"""Angular error BC5 and lossy WebP each cost the shipped normal maps.
Manual, not in the build. Why: data/textures/README.md § BC5 measured.
"""

from __future__ import annotations

import io
import sys
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
TEXTURES = REPO / 'data' / 'textures'
BODIES = ('moon', 'mercury', 'mars')

# Blue is a constant on these maps and alpha is unused, so only R and G are
# encoded — which is exactly what BC5 stores and what the RG8 upload ships.
BLOCK = 4


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


def encode_bc5(plane: np.ndarray) -> np.ndarray:
    """Round-trip one 8-bit channel through BC5's per-channel BC4 codec."""
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


def _normals(rg: np.ndarray) -> np.ndarray:
    """Decode the map's own convention: n = rg*2-1, z = sqrt(1 - x^2 - y^2)."""
    xy = rg.astype(np.float64) / 255.0 * 2.0 - 1.0
    z2 = np.clip(1.0 - xy[..., 0] ** 2 - xy[..., 1] ** 2, 0.0, None)
    return np.dstack([xy[..., 0], xy[..., 1], np.sqrt(z2)])


def _angles_deg(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    dot = np.clip((a * b).sum(axis=-1), -1.0, 1.0)
    return np.degrees(np.arccos(dot))


def encode_webp(img: np.ndarray, quality: int) -> np.ndarray:
    """Round-trip the map through lossy WebP — the file-level codec that
    `data/textures/README.md` § Surface relief already rejected."""
    buf = io.BytesIO()
    Image.fromarray(img).save(buf, format='WEBP', quality=quality, lossless=False)
    buf.seek(0)
    return np.asarray(Image.open(buf).convert('RGB'))[..., :2]


def _weighted_percentiles(err: np.ndarray, qs: tuple[float, ...]) -> list[float]:
    """cos(latitude)-weighted percentiles — the same area weighting
    `dem_relief.py` reports its tilt statistics under."""
    h = err.shape[0]
    lat = (0.5 - (np.arange(h) + 0.5) / h) * np.pi
    w = np.repeat(np.cos(lat)[:, None], err.shape[1], axis=1)
    order = np.argsort(err, axis=None)
    e = err.ravel()[order]
    cw = np.cumsum(w.ravel()[order])
    cw /= cw[-1]
    return [float(np.interp(q, cw, e)) for q in qs]


QS = (0.5, 0.9, 0.99)


def measure(body: str) -> None:
    img = np.asarray(Image.open(TEXTURES / f'{body}-normal.webp').convert('RGB'))
    exact = _normals(img[..., :2])
    arms = {
        'BC5': np.dstack([encode_bc5(img[..., 0]), encode_bc5(img[..., 1])]),
        'WebP q98': encode_webp(img, 98),
        'WebP q90': encode_webp(img, 90),
    }
    for label, coded in arms.items():
        err = _angles_deg(exact, _normals(coded))
        p50, p90, p99 = _weighted_percentiles(err, QS)
        print(f'{body:<9} {label:<9} {p50:7.3f}° {p90:7.3f}° '
              f'{p99:7.3f}° {err.max():7.3f}°')


def sweep(body: str) -> None:
    """BC5 error against map width. The 8192 tier does not exist yet, so
    whether block compression scales to it has to be read off the trend
    across the widths that do — area-averaged down from the shipped map,
    the same reduction `dem_relief.py` uses, then renormalised."""
    full = np.asarray(Image.open(TEXTURES / f'{body}-normal.webp').convert('RGB'))
    w0 = full.shape[1]
    for width in (w0 // 4, w0 // 2, w0):
        img = (full if width == w0 else np.asarray(
            Image.fromarray(full).resize((width, width // 2), Image.BOX)))
        exact = _normals(img[..., :2])
        coded = np.dstack([encode_bc5(img[..., 0]), encode_bc5(img[..., 1])])
        err = _angles_deg(exact, _normals(coded))
        p50, p90, p99 = _weighted_percentiles(err, QS)
        print(f'{body:<9} {"BC5 @" + str(width):<9} {p50:7.3f}° {p90:7.3f}° '
              f'{p99:7.3f}° {err.max():7.3f}°')


def main() -> int:
    print(f"{'body':<9} {'codec':<9} {'p50':>8} {'p90':>8} {'p99':>8} {'max':>8}")
    for body in BODIES:
        measure(body)
    print()
    sweep('moon')
    return 0


if __name__ == '__main__':
    sys.exit(main())

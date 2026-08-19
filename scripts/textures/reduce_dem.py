#!/usr/bin/env python3
"""One-shot global-DEM reduction, downloaded GeoTIFF -> the frozen
data/textures/src/<body>-dem-*.tif (re-pull recipe in
data/textures/src/README.md § Refresh recipe)."""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

from dem_relief import DEM_BODIES, DEM_ZERO_LEVEL, dem_target_w

Image.MAX_IMAGE_PIXELS = None

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "data" / "textures" / "src"


def read_samples(path: Path, dtype: str) -> np.ndarray:
    """Raw samples as their true type. The USGS mosaics are int16 stored one
    strip per row, which Pillow mis-decodes as int32 mode I — so read the strip
    block directly rather than through the decoder.

    A file with no strip offsets is TILED (and, for ETOPO, deflate-compressed),
    where there is no flat block to memmap and Pillow's own decode is correct —
    it has no int16-as-I trap to dodge, the mode already being F."""
    im = Image.open(path)
    w, h = im.size
    assert h * 2 == w, f"not equirectangular: {w}x{h}"
    if 273 not in im.tag_v2:
        return np.asarray(im, dtype=dtype)
    offsets, counts = im.tag_v2[273], im.tag_v2[279]
    assert all(
        offsets[i + 1] - offsets[i] == counts[i] for i in range(len(offsets) - 1)
    ), "strips are not contiguous — a flat memmap would read garbage"
    return np.memmap(path, dtype=dtype, mode="r", offset=offsets[0], shape=(h, w))


def reduce_dem(body: str, downloaded: Path) -> None:
    spec = DEM_BODIES[body]
    raw = read_samples(downloaded, spec["dtype"])
    nodata = spec["nodata"]
    # Read from the spec, never hardcoded: against an unsigned dtype a signed
    # sentinel compares false everywhere, so a literal here would silently
    # check nothing on exactly the body that declares no sentinel at all.
    assert nodata is None or not (raw == nodata).any(), (
        f"nodata {nodata} present — needs a fill rule"
    )
    elev = raw.astype(np.float32) * spec["scale"] + spec["offset"]
    lo, hi = float(elev.min()), float(elev.max())
    # Checked against the ORIGINAL's span. A body that clamps declares
    # `raw_span_m` for this and keeps `span_m` for what it actually ships.
    want_lo, want_hi = spec.get("raw_span_m", spec["span_m"])
    assert abs(lo - want_lo) < 60 and abs(hi - want_hi) < 60, (
        f"elevation span {lo:.0f}..{hi:.0f} m disagrees with the published "
        f"{want_lo}..{want_hi} — check the scale factor"
    )
    floor = spec.get("clamp_min_m")
    if floor is not None:
        # BEFORE the average, not after: a coastal cell is then the mean
        # VISIBLE surface height rather than a land-and-ocean mean dragged
        # under water by the seabed beside it.
        elev = np.maximum(elev, floor)
    target_w = dem_target_w(spec)
    # Area average, not LANCZOS: a DEM reduction must not ring. Overshoot at a
    # crater rim is a slope that isn't there, and slope is the whole artifact.
    small = Image.fromarray(elev).resize(
        (target_w, target_w // 2), Image.Resampling.BOX
    )
    out = np.rint(np.asarray(small, dtype=np.float32)) + DEM_ZERO_LEVEL
    assert out.min() >= 0 and out.max() <= 65535, "elevation outside uint16 range"
    out_path = SRC / spec["src"]
    Image.fromarray(out.astype(np.uint16)).save(out_path, compression="tiff_deflate")
    print(
        f"  {body}: {raw.shape[1]}x{raw.shape[0]} -> {target_w}x"
        f"{target_w // 2}, {lo:.0f}..{hi:.0f} m"
        f"{'' if floor is None else f' (clamped to >= {floor:.0f})'}, "
        f"{out_path.stat().st_size / 1e6:.2f} MB"
    )


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in DEM_BODIES:
        sys.exit(f"usage: reduce_dem.py <{'|'.join(DEM_BODIES)}> <downloaded.tif>")
    print("reducing global DEM:")
    reduce_dem(sys.argv[1], Path(sys.argv[2]))


if __name__ == "__main__":
    main()

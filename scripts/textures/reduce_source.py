#!/usr/bin/env python3
"""One-shot colour-map reduction, downloaded original(s) -> the frozen
data/textures/src/<name> master (re-pull recipe in
data/textures/src/README.md § Refresh recipe)."""

import argparse
from pathlib import Path

from PIL import Image

from texture_ladder import MASTER_W

Image.MAX_IMAGE_PIXELS = None

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "data" / "textures" / "src"

# Frozen masters are re-encoded once, above the build's own 82 so the
# ladder's top rung is not compressing an already-lossy image at the same
# quality twice.
MASTER_QUALITY = 92

# Decode JPEG originals at the smallest DCT scale still at least this
# multiple of the target width, then resample the rest of the way. libjpeg's
# scaled decode is an exact DCT-domain box filter, so this costs nothing in
# fidelity while keeping a 21600-square tile off the heap.
DRAFT_HEADROOM = 2


def load_reduced(path: Path, target_w: int) -> Image.Image:
    im = Image.open(path)
    # Grayscale stays grayscale: the USGS Europa/Callisto mosaics carry no
    # chroma at all, and the build applies each body's own tint over their
    # luminance. Widening them to RGB here would triple the frozen bytes to
    # store three copies of one channel.
    mode = "L" if im.mode in ("L", "I;16", "I") else "RGB"
    im.draft(mode, (target_w * DRAFT_HEADROOM, im.height * target_w * DRAFT_HEADROOM // im.width))
    im = im.convert(mode)
    if im.width == target_w:
        return im
    return im.resize((target_w, round(im.height * target_w / im.width)), Image.LANCZOS)


def mosaic(paths: list[Path], cols: int, rows: int, target_w: int) -> Image.Image:
    """Assemble a tiled original, reducing each tile before it is placed —
    the full grid is never materialised (BMNG's eight 21600-square tiles are
    11 GB of RGB assembled, and 96 MB reduced)."""
    tile_w = target_w // cols
    out = Image.new("RGB", (target_w, tile_w * rows))
    for i, path in enumerate(paths):
        tile = load_reduced(path, tile_w)
        assert tile.height == tile_w, (
            f"{path.name} is {tile.width}x{tile.height} after reduction — "
            "tiled sources must be square for this grid arithmetic"
        )
        out.paste(tile, ((i % cols) * tile_w, (i // cols) * tile_w))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("out", help="frozen master filename, written into data/textures/src/")
    ap.add_argument("inputs", nargs="+", type=Path)
    ap.add_argument("--grid", default="1x1", help="tile layout of the inputs, e.g. 4x2")
    args = ap.parse_args()

    cols, rows = (int(v) for v in args.grid.split("x"))
    assert cols * rows == len(args.inputs), (
        f"--grid {args.grid} wants {cols * rows} inputs, got {len(args.inputs)}"
    )

    if cols * rows == 1:
        native_w = Image.open(args.inputs[0]).width
        im = load_reduced(args.inputs[0], min(native_w, MASTER_W))
    else:
        native_w = Image.open(args.inputs[0]).width * cols
        im = mosaic(args.inputs, cols, rows, min(native_w, MASTER_W))

    assert im.width == im.height * 2, (
        f"not equirectangular: {im.width}x{im.height} — a half-world source "
        "cannot be frozen as a global map"
    )
    out_path = SRC / args.out
    im.save(out_path, "JPEG", quality=MASTER_QUALITY, optimize=True)
    print(
        f"  {args.out}: {native_w} -> {im.width}x{im.height}, "
        f"{out_path.stat().st_size / 1e6:.2f} MB"
    )


if __name__ == "__main__":
    main()

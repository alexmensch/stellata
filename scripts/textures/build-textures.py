#!/usr/bin/env python3
"""Planet texture artifact build, data/textures/src/ -> data/textures/
(contract + provenance in README.md and data/textures/README.md)."""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "data" / "textures" / "src"
OUT = ROOT / "data" / "textures"
SCRIPT = Path(__file__)

TARGET_W = 2048
JPEG_QUALITY = 82

# body artifact name -> source file. Uranus is deliberately absent —
# a featureless cyan sphere with limb darkening IS the accurate
# rendering, so it ships texture-less by design (README.md).
BODIES = {
    "mercury": "mercury-pia15063.jpg",
    "venus": "venus-bjj.jpg",
    "earth": "earth-bmng.jpg",
    "earth-night": "earth-night.jpg",
    "mars": "mars-sss.jpg",
    "jupiter": "jupiter-pia07782.jpg",
    "saturn": "saturn-bjj.jpg",
    "neptune": "neptune-bjj.jpg",
    "pluto": "pluto-pia11707.jpg",
}

RINGS_COLOR = "rings-color-bjj.txt"
RINGS_TRANSPARENCY = "rings-transparency-bjj.txt"
RINGS_OUT = "saturn-rings.png"
RINGS_W = 2048


def up_to_date(out_path: Path, *inputs: Path) -> bool:
    if not out_path.exists():
        return False
    out_mtime = out_path.stat().st_mtime
    return all(out_mtime >= p.stat().st_mtime for p in (*inputs, SCRIPT))


def build_body(name: str, src_name: str) -> None:
    src_path = SRC / src_name
    out_path = OUT / f"{name}.jpg"
    if up_to_date(out_path, src_path):
        print(f"  {name}: up to date")
        return
    im = Image.open(src_path)
    if im.width > TARGET_W:
        h = round(im.height * TARGET_W / im.width)
        im = im.resize((TARGET_W, h), Image.LANCZOS)
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    im.save(out_path, "JPEG", quality=JPEG_QUALITY, optimize=True)
    kb = out_path.stat().st_size // 1024
    print(f"  {name}: {im.width}x{im.height} {im.mode} -> {kb} KB")


def resample_rows(rows: list[list[float]], width: int) -> list[list[float]]:
    """Box-average len(rows) samples down to `width` bins."""
    n = len(rows)
    out = []
    for i in range(width):
        lo = i * n // width
        hi = max((i + 1) * n // width, lo + 1)
        cols = len(rows[0])
        out.append([sum(r[c] for r in rows[lo:hi]) / (hi - lo) for c in range(cols)])
    return out


def build_rings() -> None:
    color_path = SRC / RINGS_COLOR
    trans_path = SRC / RINGS_TRANSPARENCY
    out_path = OUT / RINGS_OUT
    if up_to_date(out_path, color_path, trans_path):
        print("  saturn-rings: up to date")
        return
    color = [[float(v) for v in line.split()] for line in color_path.read_text().split("\n") if line.strip()]
    trans = [[float(line)] for line in trans_path.read_text().split("\n") if line.strip()]
    assert len(color) == len(trans), (len(color), len(trans))
    rgb = resample_rows(color, RINGS_W)
    # Source transparency is 1 = no ring material; the artifact's alpha
    # channel is opacity, so invert.
    alpha = [1.0 - t[0] for t in resample_rows(trans, RINGS_W)]
    im = Image.new("RGBA", (RINGS_W, 1))
    im.putdata([
        (round(r * 255), round(g * 255), round(b * 255), round(a * 255))
        for (r, g, b), a in zip(rgb, alpha)
    ])
    im.save(out_path, "PNG", optimize=True)
    print(f"  saturn-rings: {RINGS_W}x1 RGBA -> {out_path.stat().st_size // 1024} KB")


def main() -> None:
    print("building planet texture artifacts:")
    for name, src_name in BODIES.items():
        build_body(name, src_name)
    build_rings()
    total = sum(p.stat().st_size for p in OUT.glob("*.jpg")) + (OUT / RINGS_OUT).stat().st_size
    print(f"total artifact size: {total / 1e6:.2f} MB")


if __name__ == "__main__":
    main()

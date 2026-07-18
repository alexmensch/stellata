#!/usr/bin/env python3
"""Planet texture artifact build, data/textures/src/ -> data/textures/
(contract + provenance in README.md and data/textures/README.md)."""

from pathlib import Path

from PIL import Image

# Frozen, license-vetted sources — the Mars mosaic alone is 21k x 10k.
Image.MAX_IMAGE_PIXELS = None

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
    "mars": "mars-viking-mdim21.jpg",
    "jupiter": "jupiter-pia07782.jpg",
    "saturn": "saturn-bjj.jpg",
    "neptune": "neptune-bjj.jpg",
    "pluto": "pluto-pia11707.jpg",
}

# Representative body colours, [0,1] RGB — MUST match SOL_PLANETS in
# src/client/solar-system/planet-system.ts (texture-colours.test.ts
# pins the parity). Used for the Mercury tint and the Pluto gap fill
# so the treated regions match the disc the body renders as at
# distance.
REPRESENTATIVE_COLOURS = {
    "mercury": (0.55, 0.47, 0.32),
    "pluto": (0.78, 0.62, 0.49),
}

# Mercury's true appearance is near-neutral gray-brown (Moon-like);
# the full representative-colour tint reads sepia, so apply half the
# chroma.
MERCURY_TINT_STRENGTH = 0.5

# Luminance floor below which a pixel counts as an un-imaged gap
# (both mosaics carry true black there: Pluto's southern band, a
# north-polar wedge on Mercury).
GAP_LUMINANCE = {"pluto": 12, "mercury": 8}

RINGS_COLOR = "rings-color-bjj.txt"
RINGS_TRANSPARENCY = "rings-transparency-bjj.txt"
RINGS_W = 2048

# Uranus/Neptune ring strips built from literature tables at TRUE
# opacity (derivation + 8-bit floor analysis in
# data/textures/README.md § Ring strips). span_km MUST match the
# body's `rings` entry in src/client/solar-system/planet-system.ts —
# scripts/textures/ring-strips.test.ts pins the parity.
RING_TABLES = {
    "uranus": {
        "src": "rings-uranus.tsv",
        "span_km": (41600.0, 51300.0),
        "rgb": (0.10, 0.10, 0.10),
    },
    "neptune": {
        "src": "rings-neptune.tsv",
        "span_km": (40900.0, 63100.0),
        "rgb": (0.11, 0.10, 0.09),
    },
}


def up_to_date(out_path: Path, *inputs: Path) -> bool:
    if not out_path.exists():
        return False
    out_mtime = out_path.stat().st_mtime
    return all(out_mtime >= p.stat().st_mtime for p in (*inputs, SCRIPT))


def tint_grayscale(
    im: Image.Image,
    colour: tuple[float, float, float],
    strength: float,
) -> Image.Image:
    """Luminance-preserving tint: hue from `colour` at `strength`
    (0 = stay gray, 1 = full chroma), detail from `im`."""
    lum = 0.2126 * colour[0] + 0.7152 * colour[1] + 0.0722 * colour[2]
    gains = [1 + (c / lum - 1) * strength for c in colour]
    l = im.convert("L")
    return Image.merge("RGB", [
        l.point(lambda v, g=g: min(255, round(v * g))) for g in gains
    ])


def fill_gap(im: Image.Image, colour: tuple[float, float, float], threshold: int) -> Image.Image:
    """Replace no-data (near-black) pixels with the solid body colour."""
    rgb = im.convert("RGB")
    mask = rgb.convert("L").point(lambda v: 255 if v < threshold else 0)
    solid = Image.new("RGB", rgb.size, tuple(round(c * 255) for c in colour))
    rgb.paste(solid, mask=mask)
    return rgb


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
    # Per-body colour treatments — rationale in data/textures/README.md
    # § Colour fidelity.
    if name == "mercury":
        im = tint_grayscale(im, REPRESENTATIVE_COLOURS["mercury"], MERCURY_TINT_STRENGTH)
    if name in GAP_LUMINANCE:
        im = fill_gap(im, REPRESENTATIVE_COLOURS[name], GAP_LUMINANCE[name])
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


def save_strip(
    out_path: Path,
    rgb: list[tuple[float, float, float]],
    alpha: list[float],
) -> None:
    im = Image.new("RGBA", (RINGS_W, 1))
    im.putdata([
        (round(r * 255), round(g * 255), round(b * 255), round(a * 255))
        for (r, g, b), a in zip(rgb, alpha)
    ])
    im.save(out_path, "PNG", optimize=True)
    print(f"  {out_path.name}: {RINGS_W}x1 RGBA -> {out_path.stat().st_size // 1024} KB")


def build_saturn_rings() -> None:
    color_path = SRC / RINGS_COLOR
    trans_path = SRC / RINGS_TRANSPARENCY
    out_path = OUT / "saturn-rings.png"
    if up_to_date(out_path, color_path, trans_path):
        print("  saturn-rings: up to date")
        return
    color = [[float(v) for v in line.split()] for line in color_path.read_text().split("\n") if line.strip()]
    trans = [[float(line)] for line in trans_path.read_text().split("\n") if line.strip()]
    assert len(color) == len(trans), (len(color), len(trans))
    rgb = [(r, g, b) for r, g, b in resample_rows(color, RINGS_W)]
    # Source transparency is 1 = no ring material; the artifact's alpha
    # channel is opacity, so invert.
    alpha = [1.0 - t[0] for t in resample_rows(trans, RINGS_W)]
    save_strip(out_path, rgb, alpha)


def parse_ring_table(path: Path) -> list[tuple[float, float, float]]:
    """(inner_km, outer_km, opacity) per ring from a TSV row of
    mid_radius_km / width_km / tau."""
    from math import exp

    rings = []
    for line in path.read_text().split("\n"):
        if not line.strip() or line.startswith("#") or line.startswith("ring\t"):
            continue
        _, mid, width, tau = line.split("\t")
        half = float(width) / 2
        rings.append((float(mid) - half, float(mid) + half, 1.0 - exp(-float(tau))))
    return rings


def build_ring_table(body: str, spec: dict) -> None:
    src_path = SRC / spec["src"]
    out_path = OUT / f"{body}-rings.png"
    if up_to_date(out_path, src_path):
        print(f"  {body}-rings: up to date")
        return
    rings = parse_ring_table(src_path)
    lo, hi = spec["span_km"]
    texel = (hi - lo) / RINGS_W
    # Box average: a ring narrower than a texel dilutes linearly, so
    # equivalent width (opacity x width) is conserved.
    alpha = []
    for i in range(RINGS_W):
        t0, t1 = lo + i * texel, lo + (i + 1) * texel
        a = sum(
            op * max(0.0, min(t1, outer) - max(t0, inner)) / texel
            for inner, outer, op in rings
        )
        alpha.append(min(1.0, a))
    save_strip(out_path, [spec["rgb"]] * RINGS_W, alpha)


def main() -> None:
    print("building planet texture artifacts:")
    for name, src_name in BODIES.items():
        build_body(name, src_name)
    build_saturn_rings()
    for body, spec in RING_TABLES.items():
        build_ring_table(body, spec)
    total = sum(
        p.stat().st_size for p in (*OUT.glob("*.jpg"), *OUT.glob("*-rings.png"))
    )
    print(f"total artifact size: {total / 1e6:.2f} MB")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Planet texture artifact build, data/textures/src/ -> data/textures/
(contract + provenance in README.md and data/textures/README.md)."""

import json
from pathlib import Path

from PIL import Image, ImageFilter, ImageStat

from dem_relief import DEM_BODIES, read_frozen_dem, surface_normals
from horizon_map import horizon_maps
from texture_calibration import COLOUR_INDICES, LUMA, calibrate

# Frozen, license-vetted sources — the Mars mosaic alone is 21k x 10k.
Image.MAX_IMAGE_PIXELS = None

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "data" / "textures" / "src"
OUT = ROOT / "data" / "textures"
MANIFEST = OUT / "calibration.json"
RELIEF_MANIFEST = OUT / "relief.json"
SCRIPT = Path(__file__)
CALIB_SCRIPT = SCRIPT.parent / "texture_calibration.py"
RELIEF_SCRIPT = SCRIPT.parent / "dem_relief.py"
HORIZON_SCRIPT = SCRIPT.parent / "horizon_map.py"

TARGET_W = 2048
JPEG_QUALITY = 82

# body artifact name -> source file. Uranus and its five moons are
# deliberately absent — a featureless representative-colour spheroid
# with limb darkening IS the honest rendering (Uranus by design;
# the Uranian moons have Voyager southern-hemisphere coverage only,
# so a half-empty map would read worse than the clean fallback).
BODIES = {
    "mercury": "mercury-pia15063.jpg",
    "venus": "venus-bjj.jpg",
    "earth": "earth-blue-marble-2002.jpg",
    "mars": "mars-viking-mdim21.jpg",
    "jupiter": "jupiter-pia07782.jpg",
    "saturn": "saturn-bjj.jpg",
    "neptune": "neptune-bjj.jpg",
    "pluto": "pluto-pia11707.jpg",
    "moon": "moon-lroc-svs.tif",
    "io": "io-usgs-clrmerge.jpg",
    "europa": "europa-usgs-global.jpg",
    "ganymede": "ganymede-usgs-clr.jpg",
    "callisto": "callisto-usgs-global.jpg",
    "mimas": "mimas-pia18437.jpg",
    "enceladus": "enceladus-pia18435.jpg",
    "tethys": "tethys-pia18439.jpg",
    "dione": "dione-pia18434.jpg",
    "rhea": "rhea-pia18438.jpg",
    "titan": "titan-iss-p19658.tif",
    "iapetus": "iapetus-pia18436.jpg",
    "triton": "triton-pia18668.jpg",
}

# Representative body colours, [0,1] RGB — MUST match SOL_BODIES in
# src/client/solar-system/planet-system.ts (texture-colours.test.ts
# pins the parity). Used for the grayscale tints so the tinted map
# matches the disc the body renders as at distance. (Gap fills use
# each map's own mean imaged colour, not these; Mercury's grayscale
# mosaic is tinted by its measured colour index via `calibrate`.)
REPRESENTATIVE_COLOURS = {
    "europa": (0.82, 0.76, 0.68),
    "callisto": (0.45, 0.41, 0.37),
    "titan": (0.83, 0.60, 0.28),
}

# Grayscale-source tints: chroma fraction of the representative
# colour applied over the mosaic's luminance detail — MOON hand-tuning
# only. Europa/Callisto are near-neutral bodies shipped as grayscale
# mosaics (half chroma keeps them honest); Titan's ISS map is 938 nm
# surface detail under an opaque orange haze, so it takes the full
# representative chroma. Planets with a published disc-integrated
# colour index are calibrated to it instead (texture_calibration.py);
# extending measured targets to the moons awaits a vetted satellite
# index table.
TINT_STRENGTH = {
    "europa": 0.5,
    "callisto": 0.5,
    "titan": 1.0,
}

# Schenk IR-G-UV enhanced-colour mosaics (the 2014 Cassini icy-moon
# series + Triton): the colour separation is exaggerated far past
# what the eye would see on these near-neutral ices, so pull the
# chroma halfway back toward gray (README.md § Colour fidelity).
DESATURATE = {
    "mimas": 0.5,
    "enceladus": 0.5,
    "tethys": 0.5,
    "dione": 0.5,
    "rhea": 0.5,
    "iapetus": 0.5,
    "triton": 0.5,
}

# Sources whose PDS label says LongitudeDirection = PositiveWest —
# stored mirrored against the positive-east texture convention every
# other map (and the renderer) uses; flipped at build.
FLIP_HORIZONTAL = {"io", "europa", "callisto", "titan"}

# Luminance floor below which a pixel counts as an un-imaged gap
# (true black in the source: Pluto's southern band, a north-polar
# wedge on Mercury, polar wedges on the Galilean mosaics, Triton's
# un-imaged northern hemisphere). Gaps fill with the map's own mean
# imaged colour, feathered — so they read as "no data", not as a
# differently-coloured terrain band.
GAP_LUMINANCE = {
    "pluto": 12,
    "mercury": 8,
    "europa": 8,
    "ganymede": 8,
    "callisto": 8,
    "triton": 10,
}

# Feather radius (px at artifact scale) blending the gap fill into the
# surrounding imagery.
GAP_FEATHER_PX = 10

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
    """Stale unless `out_path` postdates every input. Callers pass the helper
    modules their own artifact derives from — only SCRIPT is global, so
    editing one leg of the build does not rewrite the others' outputs."""
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
    lum = sum(w * c for w, c in zip(LUMA, colour))
    gains = [1 + (c / lum - 1) * strength for c in colour]
    l = im.convert("L")
    return Image.merge("RGB", [
        l.point(lambda v, g=g: min(255, round(v * g))) for g in gains
    ])


def fill_gap(im: Image.Image, threshold: int) -> Image.Image:
    """Replace no-data (near-black) pixels with the mean colour of the
    imaged pixels, feathered across the boundary so the fill reads as
    a smooth continuation of the imagery rather than a hard-edged
    contrasting band."""
    rgb = im.convert("RGB")
    lum = rgb.convert("L")
    imaged = lum.point(lambda v: 255 if v >= threshold else 0)
    mean = ImageStat.Stat(rgb, mask=imaged).mean
    solid = Image.new("RGB", rgb.size, tuple(round(c) for c in mean))
    gap = lum.point(lambda v: 255 if v < threshold else 0)
    feather = gap.filter(ImageFilter.GaussianBlur(GAP_FEATHER_PX))
    return Image.composite(solid, rgb, feather)


def desaturate(im: Image.Image, strength: float) -> Image.Image:
    """Blend toward the luminance channel: 0 = untouched, 1 = grayscale."""
    return Image.blend(im.convert("RGB"), im.convert("L").convert("RGB"), strength)


def build_body(name: str, src_name: str, manifest: dict) -> None:
    src_path = SRC / src_name
    out_path = OUT / f"{name}.jpg"
    if up_to_date(out_path, src_path, CALIB_SCRIPT):
        print(f"  {name}: up to date")
        return
    im = Image.open(src_path)
    if im.width > TARGET_W:
        h = round(im.height * TARGET_W / im.width)
        im = im.resize((TARGET_W, h), Image.LANCZOS)
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    # Per-body treatments — rationale in data/textures/README.md
    # § Colour fidelity. Bodies with a published disc-integrated index
    # take the measured calibration (Mercury's grayscale gets its tint
    # from it); the moon hand-treatments (tint/desaturate) hold until
    # a vetted satellite index table exists. Pluto ships its source
    # colour untouched.
    if name in FLIP_HORIZONTAL:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    if name in COLOUR_INDICES:
        im, manifest[name] = calibrate(im, name, GAP_LUMINANCE.get(name))
    if name in TINT_STRENGTH:
        im = tint_grayscale(im, REPRESENTATIVE_COLOURS[name], TINT_STRENGTH[name])
    if name in DESATURATE:
        im = desaturate(im, DESATURATE[name])
    if name in GAP_LUMINANCE:
        im = fill_gap(im, GAP_LUMINANCE[name])
    im.save(out_path, "JPEG", quality=JPEG_QUALITY, optimize=True)
    kb = out_path.stat().st_size // 1024
    print(f"  {name}: {im.width}x{im.height} {im.mode} -> {kb} KB")


def build_normal_map(name: str, relief: dict) -> None:
    spec = DEM_BODIES[name]
    src_path = SRC / spec["src"]
    out_path = OUT / f"{name}-normal.webp"
    assert name in BODIES, f"{name} ships relief without a colour map"
    assert name not in FLIP_HORIZONTAL, (
        f"{name}'s colour map is mirrored at build but its DEM is not — "
        "the two would disagree about which way is east"
    )
    if up_to_date(out_path, src_path, RELIEF_SCRIPT):
        print(f"  {name}-normal: up to date")
        return
    rgb, relief[name] = surface_normals(read_frozen_dem(src_path), spec)
    # Lossless: WebP q98 errs 1.6 deg of normal angle against a 2.7 deg median
    # tilt on the Moon, which is most of the signal (README.md § Surface relief).
    Image.fromarray(rgb).save(out_path, "WEBP", lossless=True, method=6)
    kb = out_path.stat().st_size // 1024
    print(
        f"  {name}-normal: {rgb.shape[1]}x{rgb.shape[0]} -> {kb} KB, "
        f"tilt median {relief[name]['medianTiltDeg']}deg "
        f"p90 {relief[name]['p90TiltDeg']}deg"
    )


def build_horizon_map(name: str, relief: dict) -> None:
    spec = DEM_BODIES[name]
    src_path = SRC / spec["src"]
    outs = [OUT / f"{name}-horizon-{half}.webp" for half in "ab"]
    if all(up_to_date(p, src_path, HORIZON_SCRIPT, RELIEF_SCRIPT) for p in outs):
        print(f"  {name}-horizon: up to date")
        return
    first, second, stats = horizon_maps(read_frozen_dem(src_path), spec)
    relief.setdefault(name, {})["horizon"] = stats
    for plane, out_path in zip((first, second), outs):
        # exact=True or libwebp rewrites RGB wherever alpha is 0 — which here
        # is one azimuth's horizon quietly overwriting three others.
        Image.fromarray(plane, "RGBA").save(
            out_path, "WEBP", lossless=True, exact=True, method=6
        )
    kb = sum(p.stat().st_size for p in outs) // 1024
    print(
        f"  {name}-horizon: 2 x {first.shape[1]}x{first.shape[0]} -> {kb} KB, "
        f"median {stats['medianHorizonDeg']}deg p99 {stats['p99HorizonDeg']}deg "
        f"clamped {stats['clampedPct']}%"
    )


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
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    for name, src_name in BODIES.items():
        build_body(name, src_name, manifest)
    # Drop rows for bodies no longer built + calibrated, so a removed body
    # can't leave a stale entry across incremental (up-to-date) runs.
    calibrated = {name for name in BODIES if name in COLOUR_INDICES}
    for stale in manifest.keys() - calibrated:
        del manifest[stale]
    MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    relief = json.loads(RELIEF_MANIFEST.read_text()) if RELIEF_MANIFEST.exists() else {}
    for name in DEM_BODIES:
        build_normal_map(name, relief)
        build_horizon_map(name, relief)
    for stale in relief.keys() - DEM_BODIES.keys():
        del relief[stale]
    RELIEF_MANIFEST.write_text(json.dumps(relief, indent=2, sort_keys=True) + "\n")
    build_saturn_rings()
    for body, spec in RING_TABLES.items():
        build_ring_table(body, spec)
    total = sum(
        p.stat().st_size
        for p in (*OUT.glob("*.jpg"), *OUT.glob("*-rings.png"), *OUT.glob("*.webp"))
    )
    print(f"total artifact size: {total / 1e6:.2f} MB")


if __name__ == "__main__":
    main()

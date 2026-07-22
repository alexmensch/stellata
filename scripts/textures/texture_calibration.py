"""Index-anchored colour calibration: per-map linear-RGB gains moving
each map's sphere-weighted mean chromaticity onto the body's published
disc-integrated colour (data/textures/README.md § Colour fidelity)."""

from PIL import Image

# Disc-integrated Johnson-Cousins colour indices (B−V, V−Rc) from the
# adopted reference magnitudes of Mallama, Krobusek & Pavlov 2017
# (Icarus 282, 19 — Table 3). Saturn's V−Rc uses the paper's
# internally-consistent synthetic pair (its photometric V and synthetic
# Rc disagree by 0.17 mag, which would inflate the index). Uranus is
# carried for completeness though it ships no map.
COLOUR_INDICES = {
    "mercury": (0.97, 0.52),
    "venus": (0.70, 0.35),
    "earth": (0.47, 0.29),
    "mars": (1.36, 0.82),
    "jupiter": (0.86, 0.35),
    "saturn": (1.07, 0.51),
    "uranus": (0.50, -0.27),
    "neptune": (0.39, -0.33),
}

# Solar colour, same system (Ramírez et al. 2012 solar-analog values).
# The renderer's reference white is the SOLAR SPECTRUM: a body
# reflecting sunlight neutrally renders R = G = B, so a body's target
# chromaticity is its index OFFSET from the Sun, as flux ratios.
SUN_BV = 0.653
SUN_VRC = 0.352

# sRGB channel ≈ photometric band: R ≈ Cousins Rc (647 nm vs ~610),
# G ≈ V (551 vs ~545), B ≈ Johnson B (445 vs ~460). The residual
# band-primary mismatch is second-order against the instrument-era
# spread this calibration removes.
LUMA = (0.2126, 0.7152, 0.0722)


def target_rgb(bv: float, vrc: float) -> tuple[float, float, float]:
    """Linear-RGB chromaticity target, V-normalised (g = 1)."""
    return (10 ** (0.4 * (vrc - SUN_VRC)), 1.0, 10 ** (-0.4 * (bv - SUN_BV)))


def _srgb_to_linear(v: float) -> float:
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def _linear_to_srgb(v: float) -> float:
    return v * 12.92 if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055


_LIN_LUT = [_srgb_to_linear(i / 255) for i in range(256)]


def _sphere_mean_linear(im: Image.Image, gap_threshold: int | None) -> list[float]:
    """Per-channel linear mean over the map as a SPHERE: rows weighted by
    cos(latitude) so the equirect grid's polar oversampling doesn't bias
    the mean. Near-black no-data pixels (below `gap_threshold` luminance)
    are excluded — they are data gaps, not terrain."""
    from math import cos, pi

    w, h = im.size
    rgb = im.convert("RGB")
    gray = rgb.convert("L")
    sums = [0.0, 0.0, 0.0]
    total_weight = 0.0
    px = rgb.load()
    gx = gray.load()
    for y in range(h):
        lat_weight = cos((y + 0.5) / h * pi - pi / 2)
        row_sums = [0.0, 0.0, 0.0]
        row_n = 0
        for x in range(w):
            if gap_threshold is not None and gx[x, y] < gap_threshold:
                continue
            r, g, b = px[x, y]
            row_sums[0] += _LIN_LUT[r]
            row_sums[1] += _LIN_LUT[g]
            row_sums[2] += _LIN_LUT[b]
            row_n += 1
        if row_n == 0:
            continue
        for c in range(3):
            sums[c] += lat_weight * row_sums[c] / row_n
        total_weight += lat_weight
    return [s / total_weight for s in sums]


def calibrate(
    im: Image.Image,
    body: str,
    gap_threshold: int | None = None,
) -> tuple[Image.Image, dict]:
    """Apply the body's index-anchored gains and return (image, manifest
    row). Gains act per channel in linear light via exact 8-bit LUTs and
    preserve the mean luminance, so only chromaticity moves."""
    bv, vrc = COLOUR_INDICES[body]
    target = target_rgb(bv, vrc)
    rgb = im.convert("RGB")
    mean = _sphere_mean_linear(rgb, gap_threshold)

    mean_y = sum(w * m for w, m in zip(LUMA, mean))
    target_y = sum(w * t for w, t in zip(LUMA, target))
    gains = [target[c] * mean_y / target_y / mean[c] for c in range(3)]

    luts = [
        [
            min(255, round(_linear_to_srgb(min(1.0, _LIN_LUT[v] * g)) * 255))
            for v in range(256)
        ]
        for g in gains
    ]
    out = Image.merge("RGB", [
        ch.point(lut) for ch, lut in zip(rgb.split(), luts)
    ])

    achieved = _sphere_mean_linear(out, gap_threshold)
    norm = lambda m: [c / m[1] for c in m]  # noqa: E731 — V-normalised chromaticity
    return out, {
        "bv": bv,
        "vrc": vrc,
        "target": [round(c, 4) for c in norm(list(target))],
        "meanBefore": [round(c, 4) for c in norm(mean)],
        "achieved": [round(c, 4) for c in norm(achieved)],
        "gains": [round(g, 4) for g in gains],
    }

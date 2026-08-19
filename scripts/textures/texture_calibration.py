"""Index-anchored colour calibration: per-map linear-RGB gains moving
each map's sphere-weighted mean chromaticity onto the body's published
disc-integrated colour (data/textures/README.md § Colour fidelity)."""

import numpy as np
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


def sphere_mean_linear(im: Image.Image, gap_threshold: int | None) -> list[float]:
    """Per-channel linear mean over the map as a SPHERE: rows weighted by
    cos(latitude) so the equirect grid's polar oversampling doesn't bias
    the mean. Near-black no-data pixels (below `gap_threshold` luminance)
    are excluded — they are data gaps, not terrain.

    A row that is entirely gap contributes nothing and drops out of the
    weight sum, so a body whose data gap spans whole rows (Pluto's south,
    Triton's north) is not pulled toward whatever the fill happens to be.
    """
    rgb = im.convert("RGB")
    h = rgb.height
    a = np.asarray(rgb, dtype=np.uint8)
    lin = np.asarray(_LIN_LUT, dtype=np.float64)[a]

    if gap_threshold is None:
        keep = np.ones(a.shape[:2], dtype=bool)
    else:
        keep = np.asarray(rgb.convert("L"), dtype=np.uint8) >= gap_threshold

    row_n = keep.sum(axis=1)
    row_sums = (lin * keep[..., None]).sum(axis=1)
    lat_weight = np.cos((np.arange(h) + 0.5) / h * np.pi - np.pi / 2)
    live = row_n > 0
    w = lat_weight[live][:, None]
    row_mean = row_sums[live] / row_n[live][:, None]
    return list((w * row_mean).sum(axis=0) / lat_weight[live].sum())


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
    mean = sphere_mean_linear(rgb, gap_threshold)

    mean_y = sum(w * m for w, m in zip(LUMA, mean))
    target_y = sum(w * t for w, t in zip(LUMA, target))
    gains = [target[c] * mean_y / target_y / mean[c] for c in range(3)]
    # Never amplify: scale the whole triple so the largest gain is 1, which
    # only ever darkens and so cannot clip. A gain above 1 pins every already-
    # bright texel at 255 and the mean stops short of the target — Earth's
    # blue wanted 1.34x over a map whose snow and ice are already at the top
    # of the channel, and missed its target by four times the tolerance.
    #
    # Free because the map's ABSOLUTE level carries no information: the
    # renderer divides each map's own mean luminance back out
    # (planets/emission/README.md § Two disc means), so only the ratios
    # between channels survive to the screen. What this drops is the old
    # mean-luminance-preserving property, which was never observable and
    # which clipping silently broke anyway.
    gains = [g / max(1.0, *gains) for g in gains]

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

    achieved = sphere_mean_linear(out, gap_threshold)
    norm = lambda m: [c / m[1] for c in m]  # noqa: E731 — V-normalised chromaticity
    return out, {
        "bv": bv,
        "vrc": vrc,
        "target": [round(c, 4) for c in norm(list(target))],
        "meanBefore": [round(c, 4) for c in norm(mean)],
        "achieved": [round(c, 4) for c in norm(achieved)],
        "gains": [round(g, 4) for g in gains],
    }

#!/usr/bin/env python3
"""Draws the Stellata icon set (glowing star on a dark-blue sky) into public/."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "public"

S = 2048  # supersampled master; downsampled per target with LANCZOS
C = S // 2

BG_INNER = (14, 20, 42)
BG_OUTER = (2, 4, 12)
GLOW = (219, 230, 255)
CORE = (255, 255, 255)
STAR = (207, 224, 255)

PNG_SIZES = {
    "favicon-16.png": 16,
    "favicon-32.png": 32,
    "favicon-48.png": 48,
    "apple-touch-icon.png": 180,
    "icon-192.png": 192,
    "icon-512.png": 512,
}
ICO_SIZES = (16, 32, 48)


def radial_background() -> Image.Image:
    bg = Image.new("RGB", (S, S), BG_OUTER)
    px = bg.load()
    max_d = (2 ** 0.5) * C
    for y in range(S):
        for x in range(S):
            d = min(1.0, (((x - C) ** 2 + (y - C * 0.9) ** 2) ** 0.5) / max_d)
            t = d * d
            px[x, y] = tuple(
                round(BG_INNER[i] * (1 - t) + BG_OUTER[i] * t) for i in range(3)
            )
    return bg


def draw_master() -> Image.Image:
    img = radial_background().convert("RGBA")

    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([C - 300, C - 300, C + 300, C + 300], fill=GLOW + (255,))
    glow = glow.filter(ImageFilter.GaussianBlur(190))
    img = Image.alpha_composite(img, glow)

    spikes = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(spikes)
    sd.ellipse([C - 620, C - 14, C + 620, C + 14], fill=CORE + (255,))
    sd.ellipse([C - 14, C - 620, C + 14, C + 620], fill=CORE + (255,))
    spikes = spikes.filter(ImageFilter.GaussianBlur(20))
    img = Image.alpha_composite(img, spikes)

    small = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    smd = ImageDraw.Draw(small)
    for cx, cy, r, a in [
        (0.27, 0.26, 15, 140),
        (0.76, 0.33, 12, 115),
        (0.72, 0.76, 17, 128),
        (0.26, 0.73, 12, 105),
    ]:
        x, y = cx * S, cy * S
        smd.ellipse([x - r, y - r, x + r, y + r], fill=STAR + (a,))
    small = small.filter(ImageFilter.GaussianBlur(6))
    img = Image.alpha_composite(img, small)

    core = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    cd = ImageDraw.Draw(core)
    cd.ellipse([C - 118, C - 118, C + 118, C + 118], fill=CORE + (255,))
    core = core.filter(ImageFilter.GaussianBlur(3))
    img = Image.alpha_composite(img, core)

    return img


def main() -> None:
    master = draw_master()
    for name, size in PNG_SIZES.items():
        master.resize((size, size), Image.LANCZOS).save(PUBLIC / name)
    master.resize((256, 256), Image.LANCZOS).save(
        PUBLIC / "favicon.ico", sizes=[(s, s) for s in ICO_SIZES]
    )
    print("Wrote", ", ".join(PNG_SIZES), "favicon.ico")


if __name__ == "__main__":
    main()

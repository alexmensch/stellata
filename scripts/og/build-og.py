#!/usr/bin/env python3
"""Composites the STELLATA wordmark onto scripts/og/og-source.jpg -> public/og-image.jpg (1200x630)."""

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(__file__).resolve().parent / "og-source.jpg"

OUT_W, OUT_H = 1200, 630
SS = 2  # supersample for crisp text + glow

# SF Mono is what the app's --font-mono resolves to on macOS.
FONT_CANDIDATES = [
    "/System/Library/Fonts/SFNSMono.ttf",
    "/System/Library/Fonts/Menlo.ttc",
]
ITALIC_FONT_CANDIDATES = [
    "/System/Library/Fonts/SFNSMonoItalic.ttf",
    *FONT_CANDIDATES,
]

FG = (230, 237, 247, 255)  # --fg  #e6edf7
FG_DIM = (170, 182, 200, 255)


def load_font(px: int, italic: bool = False) -> ImageFont.FreeTypeFont:
    for path in ITALIC_FONT_CANDIDATES if italic else FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, px)
    raise SystemExit("No monospace font found (SF Mono / Menlo).")


def crop_to_aspect(img: Image.Image) -> Image.Image:
    target = OUT_W / OUT_H
    w, h = img.size
    if w / h > target:  # too wide -> trim width, keep full height (the open band)
        new_w = round(h * target)
        left = (w - new_w) // 2
        img = img.crop((left, 0, left + new_w, h))
    else:  # too tall -> trim height from the top, keep the bottom band
        new_h = round(w / target)
        img = img.crop((0, h - new_h, w, h))
    return img


def tracked_layer(size, text, font, tracking_px, cx, cy, fill):
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    widths = [d.textlength(ch, font=font) for ch in text]
    total = sum(widths) + tracking_px * (len(text) - 1)
    x = cx - total / 2
    for ch, w in zip(text, widths):
        d.text((x, cy), ch, font=font, fill=fill, anchor="lm")
        x += w + tracking_px
    return layer


def stamp(base, text, font, tracking_px, cx, cy, fill):
    text_layer = tracked_layer(base.size, text, font, tracking_px, cx, cy, fill)
    shadow = tracked_layer(base.size, text, font, tracking_px, cx, cy, (0, 0, 0, 255))
    shadow = shadow.filter(ImageFilter.GaussianBlur(font.size * 0.22))
    for _ in range(3):  # deepen the halo for legibility over faint clouds
        base = Image.alpha_composite(base, shadow)
    return Image.alpha_composite(base, text_layer)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=66, help="wordmark cap size (px, 1x)")
    ap.add_argument("--tracking", type=float, default=0.30, help="letter-spacing (em)")
    ap.add_argument("--y", type=int, default=500, help="wordmark centre y (1x, of 630)")
    ap.add_argument("--tagline", default="Explore the universe")
    ap.add_argument("--tagline-size", type=int, default=27)
    ap.add_argument("--out", default=str(ROOT / "public" / "og-image.jpg"))
    args = ap.parse_args()

    base = crop_to_aspect(Image.open(SOURCE).convert("RGB"))
    base = base.resize((OUT_W * SS, OUT_H * SS), Image.LANCZOS).convert("RGBA")

    word_font = load_font(args.size * SS)
    base = stamp(
        base, "STELLATA", word_font,
        args.tracking * args.size * SS, OUT_W * SS / 2, args.y * SS, FG,
    )

    if args.tagline:
        tag_font = load_font(args.tagline_size * SS, italic=True)
        tag_y = args.y + args.size * 0.62 + args.tagline_size * 1.0
        base = stamp(
            base, args.tagline, tag_font,
            0.10 * args.tagline_size * SS, OUT_W * SS / 2, tag_y * SS, FG_DIM,
        )

    out = base.resize((OUT_W, OUT_H), Image.LANCZOS).convert("RGB")
    if args.out.lower().endswith((".jpg", ".jpeg")):
        out.save(args.out, quality=86, optimize=True, progressive=True)
    else:
        out.save(args.out, optimize=True)
    print(f"Wrote {args.out} ({Path(args.out).stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()

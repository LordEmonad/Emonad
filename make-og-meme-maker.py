"""Generate og-meme-maker.png — the 1200x630 social preview card for meme-maker.html.

Re-run this if you want to tweak the card design."""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "og-meme-maker.png")
MASCOT = os.path.join(ROOT, "emonad.jpg")

W, H = 1200, 630
BG = (10, 10, 10)
ACCENT = (155, 95, 255)
ACCENT_SOFT = (123, 63, 228)
TEXT = (255, 255, 255)
MUTED = (160, 160, 170)

FONT_IMPACT = "C:/Windows/Fonts/Impact.ttf"
FONT_BLACK = "C:/Windows/Fonts/ariblk.ttf"
FONT_BOLD = "C:/Windows/Fonts/arialbd.ttf"


def radial_glow(size, color, inner_alpha=110, radius_frac=0.55):
    w, h = size
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cx, cy = w // 2, h // 2
    max_r = int(min(w, h) * radius_frac)
    steps = 60
    for i in range(steps, 0, -1):
        r = int(max_r * (i / steps))
        a = int(inner_alpha * (i / steps) ** 2.2)
        bbox = (cx - r, cy - r, cx + r, cy + r)
        draw.ellipse(bbox, fill=(*color, a))
    return img.filter(ImageFilter.GaussianBlur(28))


def meme_text(draw, xy, text, font, fill=(255, 255, 255), stroke=(0, 0, 0), stroke_w=6, anchor="mm"):
    draw.text(xy, text, font=font, fill=fill, stroke_width=stroke_w, stroke_fill=stroke, anchor=anchor)


def main():
    img = Image.new("RGB", (W, H), BG)

    # Radial purple glow from top-center
    glow = radial_glow((W, int(H * 1.4)), ACCENT_SOFT, inner_alpha=140, radius_frac=0.8)
    img.paste(glow, (0, -int(H * 0.5)), glow)

    # Subtle second glow bottom-right
    glow2 = radial_glow((700, 700), ACCENT, inner_alpha=70, radius_frac=0.7)
    img.paste(glow2, (W - 600, H - 400), glow2)

    draw = ImageDraw.Draw(img, "RGBA")

    # ── Left column: heading ──────────────────────────────────────────
    title_font = ImageFont.truetype(FONT_BLACK, 128)
    sub_font = ImageFont.truetype(FONT_BOLD, 34)
    tag_font = ImageFont.truetype(FONT_BOLD, 22)

    # "MEME MAKER" with a soft accent drop
    x0, y0 = 70, 160
    # Shadow
    draw.text((x0 + 3, y0 + 4), "MEME", font=title_font, fill=(0, 0, 0, 180))
    draw.text((x0, y0), "MEME", font=title_font, fill=TEXT)
    draw.text((x0 + 3, y0 + 128 + 4), "MAKER", font=title_font, fill=(0, 0, 0, 180))
    draw.text((x0, y0 + 128), "MAKER", font=title_font, fill=ACCENT)

    # Tagline
    draw.text((x0 + 6, y0 + 128 * 2 + 30), "Drop an image. Add text. Stickers.", font=sub_font, fill=MUTED)

    # Tag pill
    pill_text = "$EMO · emonad.lol"
    pill_tw = draw.textlength(pill_text, font=tag_font)
    pill_pad_x, pill_pad_y = 16, 9
    pill_w = int(pill_tw + pill_pad_x * 2)
    pill_h = 44
    px, py = x0 + 6, 70
    draw.rounded_rectangle((px, py, px + pill_w, py + pill_h), radius=22,
                           fill=(255, 255, 255, 20), outline=(255, 255, 255, 50), width=1)
    draw.text((px + pill_pad_x, py + pill_h // 2), pill_text, font=tag_font, fill=TEXT, anchor="lm")

    # ── Right column: a mock meme preview ─────────────────────────────
    preview_w, preview_h = 420, 420
    preview_x = W - preview_w - 70
    preview_y = (H - preview_h) // 2

    # Shadow behind preview
    shadow = Image.new("RGBA", (preview_w + 80, preview_h + 80), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle((40, 50, preview_w + 40, preview_h + 50), radius=28, fill=(0, 0, 0, 160))
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))
    img.paste(shadow, (preview_x - 40, preview_y - 30), shadow)

    # Mascot fit into the card — center-crop (cover) so aspect ratio is preserved
    if os.path.exists(MASCOT):
        src = Image.open(MASCOT).convert("RGB")
        src_w, src_h = src.size
        src_ratio = src_w / src_h
        dst_ratio = preview_w / preview_h
        if src_ratio > dst_ratio:
            # source wider — crop sides
            new_w = int(src_h * dst_ratio)
            off = (src_w - new_w) // 2
            src = src.crop((off, 0, off + new_w, src_h))
        else:
            # source taller — crop top/bottom, bias toward top so the face stays in frame
            new_h = int(src_w / dst_ratio)
            off = int((src_h - new_h) * 0.15)
            src = src.crop((0, off, src_w, off + new_h))
        mascot = src.resize((preview_w, preview_h), Image.Resampling.LANCZOS)
    else:
        mascot = Image.new("RGB", (preview_w, preview_h), (30, 20, 50))

    # Rounded-corner mask
    mask = Image.new("L", (preview_w, preview_h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, preview_w, preview_h), radius=22, fill=255)
    img.paste(mascot, (preview_x, preview_y), mask)

    # Inner border
    draw.rounded_rectangle((preview_x, preview_y, preview_x + preview_w, preview_y + preview_h),
                           radius=22, outline=(255, 255, 255, 70), width=2)

    # Meme text on the mock
    meme_font = ImageFont.truetype(FONT_IMPACT, 62)
    top_y = preview_y + 34
    bot_y = preview_y + preview_h - 34
    cx = preview_x + preview_w // 2
    meme_text(draw, (cx, top_y), "TOP TEXT", meme_font, stroke_w=6)
    meme_text(draw, (cx, bot_y), "$EMO MEMES", meme_font, stroke_w=6)

    # A couple of sticker-like accent dots at the corners of the preview
    def accent_dot(x, y, r=18):
        draw.ellipse((x - r, y - r, x + r, y + r), fill=(255, 255, 255, 240), outline=ACCENT, width=4)
    accent_dot(preview_x + preview_w - 24, preview_y + 24, 22)
    accent_dot(preview_x + 24, preview_y + preview_h - 24, 16)

    img.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT} ({W}x{H})")
    print(f"size: {os.path.getsize(OUT) // 1024} KB")


if __name__ == "__main__":
    main()

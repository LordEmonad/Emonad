"""Generate the homepage / bare-domain social preview card (1200x630).

Design: the emo head (the favicon logo, icon-192x192.png — already a clean
transparent cutout) glowing on the right, the $EMO hero wordmark + "i lost it
all on day 1" on the left, the EMO logo as the brand lockup up top, over a dark
Monad-purple gradient with glows + dot grid.

Reproducible from committed assets only: icon-192x192.png + stickers/emo logo.png.
Renders at 2x and downsamples (LANCZOS) for crisp edges + glows.
Output: og-image.jpg (site-wide card: index/emo/profile/memes).

    python3 scripts/make-og-home.py
"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.path.join(ROOT, "fonts")
OUT = os.path.join(ROOT, "og-image.jpg")
HEAD_IMG = os.path.join(ROOT, "icon-192x192.png")
LOGO = os.path.join(ROOT, "stickers", "emo logo.png")

S = 2
W, H = 1200, 630
WS, HS = W * S, H * S

BG_TOP = (22, 9, 46)
BG_BOT = (9, 5, 16)
ACCENT = (155, 95, 255)
PINK   = (236, 72, 153)
WHITE  = (255, 255, 255)
MUTED  = (184, 163, 232)


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size * S)

ANTON = lambda px: font("Anton-Regular.ttf", px)
OSWALD = lambda px: font("Oswald-Bold.ttf", px)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def load_head():
    """The favicon logo — already a transparent cutout. Trim its transparent
    padding so it scales to fill the intended size."""
    head = Image.open(HEAD_IMG).convert("RGBA")
    bb = head.getbbox()
    return head.crop(bb) if bb else head


def vertical_gradient():
    img = Image.new("RGB", (WS, HS), BG_BOT)
    d = ImageDraw.Draw(img)
    for y in range(HS):
        d.line([(0, y), (WS, y)], fill=lerp(BG_TOP, BG_BOT, y / HS))
    return img


def radial_glow(cx, cy, radius, color, peak_alpha, blur=40):
    layer = Image.new("RGBA", (WS, HS), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    steps = 80
    for i in range(steps, 0, -1):
        r = int(radius * S * (i / steps))
        a = int(peak_alpha * (i / steps) ** 2.0)
        d.ellipse((cx * S - r, cy * S - r, cx * S + r, cy * S + r), fill=(*color, a))
    return layer.filter(ImageFilter.GaussianBlur(blur * S))


def dot_grid():
    layer = Image.new("RGBA", (WS, HS), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    gap, r = 46, 2
    for y in range(gap, H, gap):
        for x in range(gap, W, gap):
            d.ellipse((x * S - r * S, y * S - r * S, x * S + r * S, y * S + r * S),
                      fill=(*ACCENT, 24))
    return layer.filter(ImageFilter.GaussianBlur(0.5 * S))


def tracked_text(draw, x, y, text, fnt, fill, tracking):
    tr = tracking * S
    for ch in text:
        draw.text((x, y), ch, font=fnt, fill=fill)
        x += draw.textlength(ch, font=fnt) + tr


def glow_text_left(base, x, top_y, text, fnt, fill, glow_color, radius, alpha, passes=3):
    glow = Image.new("RGBA", (WS, HS), (0, 0, 0, 0))
    ImageDraw.Draw(glow).text((x, top_y), text, font=fnt, fill=(*glow_color, alpha))
    glow = glow.filter(ImageFilter.GaussianBlur(radius * S))
    out = base.convert("RGBA")
    for _ in range(passes):
        out = Image.alpha_composite(out, glow)
    ImageDraw.Draw(out).text((x, top_y), text, font=fnt, fill=fill)
    return out


def paste(base, img, cx, cy):
    """alpha-composite img centered at (cx,cy) in 1200x630 space."""
    layer = Image.new("RGBA", (WS, HS), (0, 0, 0, 0))
    layer.paste(img, (int(cx * S - img.width / 2), int(cy * S - img.height / 2)), img)
    return Image.alpha_composite(base.convert("RGBA"), layer)


def main():
    img = vertical_gradient().convert("RGBA")
    img = Image.alpha_composite(img, radial_glow(170, 150, 480, ACCENT, 80))

    # head on the right with a glow halo behind it
    head = load_head()
    head_h = 404 * S
    head = head.resize((int(head.width * head_h / head.height), head_h), Image.LANCZOS)
    HEAD_CX, HEAD_CY = 912, 338
    img = Image.alpha_composite(img, radial_glow(HEAD_CX, HEAD_CY, 280, ACCENT, 98, blur=46))
    img = Image.alpha_composite(img, radial_glow(HEAD_CX + 20, 540, 230, PINK, 36, blur=56))
    img = Image.alpha_composite(img, dot_grid())
    img = paste(img, head, HEAD_CX, HEAD_CY)

    d = ImageDraw.Draw(img)

    # ── brand lockup: EMO logo + EMONAD ──
    logo = Image.open(LOGO).convert("RGBA")
    lh = 58 * S
    logo = logo.resize((int(logo.width * lh / logo.height), lh), Image.LANCZOS)
    LX, LY = 70, 64
    img.paste(logo, (LX * S, LY * S), logo)
    d = ImageDraw.Draw(img)
    lock_f = OSWALD(30)
    ascent = lock_f.getmetrics()[0]
    tracked_text(d, LX * S + logo.width + 20 * S,
                 LY * S + (lh - ascent) / 2 - 2 * S, "EMONAD", lock_f, WHITE, 6)

    # ── hero $EMO ──
    img = glow_text_left(img, 68 * S, 196 * S, "$EMO", ANTON(168), WHITE, ACCENT, 26, 195)
    d = ImageDraw.Draw(img)

    # ── tagline ──
    tracked_text(d, 74 * S, 392 * S, "i lost it all on day 1", OSWALD(42), (208, 192, 240), 1)

    # ── footer ──
    foot_f = OSWALD(28)
    fx = 72 * S
    d.text((fx, 545 * S), "emonad.lol", font=foot_f, fill=WHITE)
    fx += d.textlength("emonad.lol", font=foot_f) + 16 * S
    d.text((fx, 545 * S), "·", font=foot_f, fill=MUTED)
    fx += d.textlength("·", font=foot_f) + 16 * S
    d.text((fx, 545 * S), "Built on Monad", font=foot_f, fill=MUTED)

    final = img.convert("RGB").resize((W, H), Image.LANCZOS)
    final.save(OUT, "JPEG", quality=92, optimize=True)
    print("wrote", OUT, final.size)


if __name__ == "__main__":
    main()

# Tarot art

Drop your card art here. The page (`/tarot.html`) auto-loads images by slug; missing cards fall back to a styled placeholder so the experience works without art.

## File layout

```
tarot/
  card-back.jpg       ← back of the deck (one image, shown for face-down cards)
  cards/
    00-the-fool.jpg
    01-the-magician.jpg
    02-the-high-priestess.jpg
    03-the-empress.jpg
    04-the-emperor.jpg
    05-the-hierophant.jpg
    06-the-lovers.jpg
    07-the-chariot.jpg
    08-strength.jpg
    09-the-hermit.jpg
    10-wheel-of-fortune.jpg
    11-justice.jpg
    12-the-hanged-man.jpg
    13-death.jpg
    14-temperance.jpg
    15-the-devil.jpg
    16-the-tower.jpg
    17-the-star.jpg
    18-the-moon.jpg
    19-the-sun.jpg
    20-judgement.jpg
    21-the-world.jpg
```

## Specs

- **Aspect ratio**: 5:8 (portrait, classic tarot proportions). e.g. 750×1200.
- **Format**: `.jpg` preferred (small, sharp). `.png` works if you change the extension in `tarot.html`.
- **Bleed**: art should fill the full card — the page renders rounded corners and a subtle border around it.
- **Reversed cards** are flipped via CSS (`scaleY(-1)`), so design upright only.

When all 22 cards are dropped in, also add `card-back.jpg` for the deck back. Until then, the CSS placeholder is shown.

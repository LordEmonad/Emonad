"""Generate static PNG thumbnails (first frame) for every GIF in
templates/gifs/. Used by the template picker to render a lightweight grid
instead of downloading + animating 46 full GIFs at once.

Re-run whenever you add/remove GIFs, then run update-templates.py.
"""
import os
import sys
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
GIFS_DIR = os.path.join(ROOT, "templates", "gifs")
THUMBS_DIR = os.path.join(GIFS_DIR, "thumbs")
THUMB_MAX = 280  # longest edge in px


def main() -> int:
    if not os.path.isdir(GIFS_DIR):
        print(f"error: {GIFS_DIR} not found", file=sys.stderr)
        return 1
    os.makedirs(THUMBS_DIR, exist_ok=True)

    made = 0
    skipped = 0
    failed = 0
    for name in sorted(os.listdir(GIFS_DIR)):
        if not name.lower().endswith(".gif"):
            continue
        src = os.path.join(GIFS_DIR, name)
        dst = os.path.join(THUMBS_DIR, os.path.splitext(name)[0] + ".png")
        # Skip if up-to-date.
        if os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
            skipped += 1
            continue
        try:
            with Image.open(src) as im:
                im.seek(0)
                frame = im.convert("RGBA")
                w, h = frame.size
                scale = min(1.0, THUMB_MAX / max(w, h))
                if scale < 1.0:
                    frame = frame.resize(
                        (int(w * scale), int(h * scale)),
                        Image.Resampling.LANCZOS,
                    )
                frame.save(dst, "PNG", optimize=True)
            made += 1
        except Exception as e:
            print(f"  FAIL {name}: {e}", file=sys.stderr)
            failed += 1

    print(f"Thumbnails: {made} built, {skipped} up-to-date, {failed} failed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

"""Thumbnails + layout data for the meme gallery (memes.html).

For every entry in meme_data.js this makes a small WebP thumbnail in memes/thumbs/
(first frame for videos) and fills in:
  w, h    full-size dimensions, so the grid reserves the right space before anything loads
  color   average colour, shown as the placeholder while the thumbnail loads
  thumb   path of the thumbnail
  added   date the meme was added (first git commit of the file; today if uncommitted)
Every other field and the entry order are left alone. Thumbnails are only rebuilt when
missing or older than their source, and thumbnails nothing points at are deleted.

Run after adding, replacing or removing memes:  python3 scripts/update-memes.py
Needs Pillow (with WebP) and, for video entries, ffmpeg/ffprobe.
"""
import datetime
import json
import os
import re
import subprocess
import sys
import tempfile
from concurrent.futures import ProcessPoolExecutor

from PIL import Image, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "meme_data.js")
THUMBS = "memes/thumbs"
THUMB_W, THUMB_MAX_H, QUALITY = 640, 1600, 74
VIDEO_RE = re.compile(r"\.(mp4|webm|mov)$", re.I)
HEADER = (
    "// Meme gallery data — edit name/categories/text/tags by hand; then run\n"
    "// `python3 scripts/update-memes.py` to (re)build thumbnails and fill w/h/color/thumb/added.\n"
)


def load():
    src = open(DATA, encoding="utf-8").read()
    body = src[src.index("[", src.index("const MEMES")) : src.rindex("]") + 1]
    return json.loads(body)


def save(memes):
    lines = ",\n".join(json.dumps(m, ensure_ascii=False, separators=(",", ":")) for m in memes)
    with open(DATA + ".tmp", "w", encoding="utf-8") as f:
        f.write(HEADER + "const MEMES = [\n" + lines + "\n];\n")
    os.replace(DATA + ".tmp", DATA)


def source(m):
    return m.get("path") or "memes/" + m["file"]


def thumb_rel(m):
    src = source(m)
    stem = os.path.splitext(os.path.basename(src))[0]
    folder = os.path.dirname(src)
    prefix = "" if folder == "memes" else folder.replace("/", "-") + "-"
    return f"{THUMBS}/{prefix}{stem}.webp"


def git_added_dates():
    """First-commit date of every file under memes/ and tarot/ in one git call."""
    try:
        out = subprocess.run(
            ["git", "log", "--diff-filter=A", "--format=@%ad", "--date=short", "--name-only", "--", "memes", "tarot"],
            cwd=ROOT, capture_output=True, text=True, check=True,
        ).stdout
    except (OSError, subprocess.CalledProcessError):
        return {}
    dates, current = {}, None
    for line in out.splitlines():
        if line.startswith("@"):
            current = line[1:]
        elif line.strip():
            dates[line.strip()] = current  # log is newest-first, so the last write is the first add
    return dates


def open_frame(path):
    if not VIDEO_RE.search(path):
        im = Image.open(path)
        im.seek(0)
        return ImageOps.exif_transpose(im)
    with tempfile.TemporaryDirectory() as tmp:
        png = os.path.join(tmp, "f.png")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "0.5", "-i", path, "-frames:v", "1", png], check=True)
        im = Image.open(png)
        im.load()
        return im


def build(m):
    """Returns the fields to update on this entry, or None if its file is missing."""
    src_rel = source(m)
    src = os.path.join(ROOT, src_rel)
    if not os.path.isfile(src):
        print(f"  missing: {src_rel}", file=sys.stderr)
        return None
    m = dict(m)
    t_rel = thumb_rel(m)
    t_abs = os.path.join(ROOT, t_rel)
    fresh = os.path.isfile(t_abs) and os.path.getmtime(t_abs) >= os.path.getmtime(src)
    if not (fresh and m.get("w") and m.get("h") and m.get("color") and m.get("thumb") == t_rel):
        im = open_frame(src)
        m["w"], m["h"] = im.size
        rgb = im.convert("RGBA")
        bg = Image.new("RGBA", rgb.size, (255, 255, 255, 255))
        rgb = Image.alpha_composite(bg, rgb).convert("RGB")
        r, g, b = rgb.resize((1, 1), Image.Resampling.BOX).getpixel((0, 0))
        m["color"] = f"#{r:02x}{g:02x}{b:02x}"
        if not fresh:
            t = rgb.copy()
            t.thumbnail((THUMB_W, THUMB_MAX_H), Image.Resampling.LANCZOS)
            os.makedirs(os.path.dirname(t_abs), exist_ok=True)
            t.save(t_abs, "WEBP", quality=QUALITY, method=6)
        m["thumb"] = t_rel
    return {k: m[k] for k in ("w", "h", "color", "thumb")}


def main():
    memes = load()
    today = datetime.date.today().isoformat()
    dates = git_added_dates()
    with ProcessPoolExecutor() as ex:
        results = list(ex.map(build, memes, chunksize=4))
    ok = 0
    for m, fields in zip(memes, results):
        if fields:
            m.update(fields)
            ok += 1
        if not m.get("added"):
            m["added"] = dates.get(source(m)) or today
    keep = {thumb_rel(m) for m in memes}
    os.makedirs(os.path.join(ROOT, THUMBS), exist_ok=True)
    removed = 0
    for name in os.listdir(os.path.join(ROOT, THUMBS)):
        rel = f"{THUMBS}/{name}"
        if name.endswith(".webp") and rel not in keep:
            os.remove(os.path.join(ROOT, rel))
            removed += 1
    save(memes)
    size = sum(os.path.getsize(os.path.join(ROOT, p)) for p in keep if os.path.isfile(os.path.join(ROOT, p)))
    print(f"{ok}/{len(memes)} memes ready · thumbs {size / 1e6:.1f} MB · {removed} stale thumbs removed")
    return 0 if ok == len(memes) else 1


if __name__ == "__main__":
    sys.exit(main())

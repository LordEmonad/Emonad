"""One-shot downloader for classic meme templates (imgflip).

Run once to populate templates/classic/. Safe to re-run — skips files that
already exist. Delete the PNG/JPG in templates/classic/ if you want to refresh
a specific one, then re-run this.
"""
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(ROOT, "templates", "classic")

TEMPLATES = [
    ("Drake Hotline Bling", "https://i.imgflip.com/30b1gx.jpg"),
    ("Distracted Boyfriend", "https://i.imgflip.com/1ur9b0.jpg"),
    ("Two Buttons", "https://i.imgflip.com/1g8my4.jpg"),
    ("Change My Mind", "https://i.imgflip.com/24y43o.jpg"),
    ("Left Exit 12 Off Ramp", "https://i.imgflip.com/22bdq6.jpg"),
    ("Expanding Brain", "https://i.imgflip.com/1jwhww.jpg"),
    ("Is This A Pigeon", "https://i.imgflip.com/1o00in.jpg"),
    ("UNO Draw 25 Cards", "https://i.imgflip.com/3lmzyx.jpg"),
    ("Mocking SpongeBob", "https://i.imgflip.com/1otk96.jpg"),
    ("Woman Yelling At Cat", "https://i.imgflip.com/345v97.jpg"),
    ("One Does Not Simply", "https://i.imgflip.com/1bij.jpg"),
    ("Ancient Aliens", "https://i.imgflip.com/26am.jpg"),
    ("This Is Fine", "https://i.imgflip.com/wxica.jpg"),
    ("Disaster Girl", "https://i.imgflip.com/23ls.jpg"),
    ("Grus Plan", "https://i.imgflip.com/26jxvz.jpg"),
    ("Running Away Balloon", "https://i.imgflip.com/261o3j.jpg"),
    ("Panik Kalm Panik", "https://i.imgflip.com/3qqcim.png"),
    ("Hide the Pain Harold", "https://i.imgflip.com/gk5el.jpg"),
    ("Surprised Pikachu", "https://i.imgflip.com/2kbn1e.jpg"),
    ("Roll Safe Think About It", "https://i.imgflip.com/1h7in3.jpg"),
    ("Always Has Been", "https://i.imgflip.com/46e43q.png"),
    ("Sad Pablo Escobar", "https://i.imgflip.com/1c1uej.jpg"),
    ("Epic Handshake", "https://i.imgflip.com/28j0te.jpg"),
    ("Waiting Skeleton", "https://i.imgflip.com/2fm6x.jpg"),
    ("Tuxedo Winnie the Pooh", "https://i.imgflip.com/2ybua0.png"),
    ("Batman Slapping Robin", "https://i.imgflip.com/9ehk.jpg"),
    ("Futurama Fry", "https://i.imgflip.com/1bgw.jpg"),
    ("Buff Doge vs Cheems", "https://i.imgflip.com/43a45p.png"),
    ("Monkey Puppet", "https://i.imgflip.com/2gnnjh.jpg"),
    ("Theyre The Same Picture", "https://i.imgflip.com/2za3u1.jpg"),
    ("Anakin Padme 4 Panel", "https://i.imgflip.com/5c7lwq.png"),
    ("Trade Offer", "https://i.imgflip.com/54hjww.jpg"),
    ("Spider Man Pointing", "https://i.imgflip.com/1tkjq9.jpg"),
    ("Leonardo DiCaprio Cheers", "https://i.imgflip.com/39t1o.jpg"),
    ("Yo Dawg Heard You", "https://i.imgflip.com/26hg.jpg"),
]


def slugify(name: str) -> str:
    s = name.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s


def main() -> int:
    os.makedirs(OUT_DIR, exist_ok=True)
    ok = 0
    skip = 0
    fail = 0
    for name, url in TEMPLATES:
        ext = os.path.splitext(url)[1].lower() or ".jpg"
        out = os.path.join(OUT_DIR, slugify(name) + ext)
        if os.path.exists(out):
            skip += 1
            continue
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=20) as r, open(out, "wb") as f:
                f.write(r.read())
            size_kb = os.path.getsize(out) / 1024
            print(f"  {name}: {size_kb:.0f} KB -> {os.path.basename(out)}")
            ok += 1
        except Exception as e:
            print(f"  FAIL {name}: {e}", file=sys.stderr)
            fail += 1

    print(f"\nDone: {ok} downloaded, {skip} already present, {fail} failed.")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

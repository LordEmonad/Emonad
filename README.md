# escapist.lol

Source code for [escapist.lol](https://escapist.lol) — art, memes, and degen tools.

## Pages

| Route | What it is |
|-------|-----------|
| `/` | Main hub — Lord Emo art portfolio |
| `/emo.html` | $EMO memecoin page (Monad) |
| `/ordtisms.html` | ORDTISMS gallery — 101 on-chain generative art pieces on Bitcoin Ordinals |
| `/rare tisms/` | ORDTISM trading cards |
| `/memes.html` | Meme gallery |
| `/gifs.html` | GIF collection |
| `/tools.html` | Misc tools |
| `/flapemonad/` | Flap Emonad — Flappy Bird clone with on-chain leaderboard on Monad |

## Structure

```
.
├── index.html              # main site
├── emo.html                # $EMO token page
├── ordtisms.html           # ordinals gallery
├── inscription_ids.js      # ordinal inscription IDs
├── memes.html              # meme wall
├── meme_list.js            # meme filenames
├── gifs.html               # gif collection
├── tools.html              # tools page
├── rare tisms/             # trading card pages
├── flapemonad/             # flappy bird game
│   ├── index.html
│   ├── script.js
│   ├── leaderboard.html
│   ├── settings.html
│   └── stats.html
├── emo-bot/                # telegram bot for $EMO
│   ├── bot.py
│   └── requirements.txt
└── memes/                  # meme images
```

## Running locally

It's all static HTML/JS/CSS — just open the files in a browser or use any local server:

```bash
python -m http.server 8000
```

For the Telegram bot, see [`emo-bot/README.md`](emo-bot/README.md).

## Links

- **Site**: [escapist.lol](https://escapist.lol)
- **Twitter**: [@EmonadCoin](https://twitter.com/EmonadCoin)
- **Chart**: [DEXScreener](https://dexscreener.com/monad/0x714a2694c8d4f0b1bfba0e5b76240e439df2182d)

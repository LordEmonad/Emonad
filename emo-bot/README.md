# $EMO Telegram Bot

Telegram bot for the $EMO community on Monad.

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message + web app link |
| `/price` | Live price, market cap, volume via DEXScreener |
| `/chart` | Chart screenshot from DEXScreener |
| `/meme` | Random meme |

Also does big buy alerts (buys over $500) if configured.

## Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) on Telegram
2. Install deps: `pip install -r requirements.txt`
3. Set your token:
   ```bash
   export BOT_TOKEN="your_token_here"
   export ALERT_CHAT_ID="your_chat_id"  # optional, for buy alerts
   ```
4. Run it: `python bot.py`

## Getting your chat ID

Add the bot to your group, send a message, then hit:
```
https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
```
Look for `chat.id` in the response.

## Config

Big buy threshold (in `bot.py`):
```python
BIG_BUY_THRESHOLD = 500  # USD
```

Memes: add filenames to the `MEMES` list in `bot.py`.

## Deploying

Works on Railway, Render, or any VPS with Python 3.10+. Set your env vars and run `python bot.py`. Use `screen` or `tmux` to keep it alive on a VPS.

## Links

- [emonad.lol](https://emonad.lol)
- [DEXScreener](https://dexscreener.com/monad/0x714a2694c8d4f0b1bfba0e5b76240e439df2182d)
- [@EmonadCoin](https://twitter.com/EmonadCoin)

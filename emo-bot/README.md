# 🖤 $EMO Telegram Bot

A Telegram bot for the $EMO memecoin on Monad.

## Features

- `/start` - Welcome message with web app button to open emonad.lol
- `/price` - Live price, market cap, volume from DEXScreener
- `/chart` - Chart image from DEXScreener
- `/meme` - Random meme from the collection
- **Big Buy Alerts** - Announces buys over $500 (requires setup)

## Quick Setup

### 1. Create Your Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. Choose a name (e.g., "EMO Bot")
4. Choose a username (e.g., "EmonadBot")
5. Copy the **API token** you receive

### 2. Install Dependencies

```bash
cd emo-bot
pip install -r requirements.txt
```

### 3. Configure the Bot

Option A: Environment variables (recommended)
```bash
export BOT_TOKEN="your_token_here"
export ALERT_CHAT_ID="your_chat_id"  # Optional, for buy alerts
```

Option B: Edit `bot.py` directly
- Replace `YOUR_BOT_TOKEN_HERE` with your token

### 4. Run the Bot

```bash
python bot.py
```

## Getting Your Chat ID (for Big Buy Alerts)

1. Add your bot to your group/channel
2. Make the bot an admin (for channels)
3. Send a message in the group
4. Visit: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
5. Find the `chat.id` in the response

## Deploy Options

### Railway (Free tier available)
1. Push code to GitHub
2. Connect to [Railway](https://railway.app)
3. Add environment variables
4. Deploy!

### Render (Free tier available)
1. Push code to GitHub
2. Create new Web Service on [Render](https://render.com)
3. Add environment variables
4. Deploy!

### VPS (DigitalOcean, etc.)
```bash
# Install Python 3.10+
sudo apt update && sudo apt install python3 python3-pip

# Clone and run
git clone your-repo
cd emo-bot
pip install -r requirements.txt
python bot.py

# Or use screen/tmux to keep it running
screen -S emobot
python bot.py
# Ctrl+A, D to detach
```

## Customization

### Change Big Buy Threshold
In `bot.py`, edit:
```python
BIG_BUY_THRESHOLD = 500  # Change to your desired USD amount
```

### Add More Memes
Add filenames to the `MEMES` list in `bot.py`

## Commands Summary

| Command | Description |
|---------|-------------|
| `/start` | Welcome + web app button |
| `/price` | Current price & stats |
| `/chart` | Chart image |
| `/meme` | Random meme |

## Links

- Website: https://emonad.lol
- Chart: https://dexscreener.com/monad/0x714a2694c8d4f0b1bfba0e5b76240e439df2182d
- Twitter: https://twitter.com/EmonadCoin

---

_i lost it all on day 1_ 🖤

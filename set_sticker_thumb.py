import asyncio
import os
from telegram import Bot
from PIL import Image
import io

# Load token from environment variable - NEVER hardcode tokens!
BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
if not BOT_TOKEN:
    raise ValueError("Set TELEGRAM_BOT_TOKEN environment variable")
USER_ID = 950075474
PACK_NAME = "emo_stickers_by_EmonadBot"
THUMB_IMAGE = r"c:\Users\kinga\OneDrive\Documents\Ordtisms\token image.png"

async def set_thumbnail():
    bot = Bot(token=BOT_TOKEN)
    
    # Resize image to 100x100 for thumbnail (Telegram requirement)
    img = Image.open(THUMB_IMAGE)
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
    
    # Resize to 100x100
    img = img.resize((100, 100), Image.Resampling.LANCZOS)
    
    # Save to bytes
    img_bytes = io.BytesIO()
    img.save(img_bytes, format='PNG')
    img_bytes.seek(0)
    
    print(f"Setting thumbnail for pack: {PACK_NAME}")
    
    try:
        await bot.set_sticker_set_thumbnail(
            name=PACK_NAME,
            user_id=USER_ID,
            thumbnail=img_bytes
        )
        print("✅ Thumbnail set successfully!")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(set_thumbnail())

"""
$EMO Telegram Bot - Full Featured
- Buy/Sell alerts with GIFs
- Wallet tracking with P&L
- Price alerts (recurring)
- Holder stats and more
"""

import os
import json
import random
import asyncio
import aiohttp
import glob
import websockets
from pathlib import Path
from datetime import datetime
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, InputFile, WebAppInfo, BotCommand
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

# --- config ---
BOT_TOKEN = os.getenv("BOT_TOKEN")
if not BOT_TOKEN:
    raise ValueError("Set BOT_TOKEN environment variable (get from @BotFather)")
ALERT_CHAT_ID = os.getenv("ALERT_CHAT_ID")
if not ALERT_CHAT_ID:
    raise ValueError("Set ALERT_CHAT_ID environment variable")

# $EMO Token Config
TOKEN_ADDRESS = "0x81A224F8A62f52BdE942dBF23A56df77A10b7777"
PAIR_ADDRESS = "0x714a2694c8d4f0b1bfba0e5b76240e439df2182d"
DEXSCREENER_API = f"https://api.dexscreener.com/latest/dex/pairs/monad/{PAIR_ADDRESS}"
DEXSCREENER_CHART = f"https://dexscreener.com/monad/{PAIR_ADDRESS}"

# Monad RPC for real-time monitoring
MONAD_WSS = "wss://rpc.monad.xyz"
MONAD_RPC = "https://rpc.monad.xyz"

# Swap event signature (Uniswap V2/V3 style)
# Swap(address,uint256,uint256,uint256,uint256,address)
SWAP_TOPIC = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822"

# Default buy detection threshold (can be changed per-chat with /setthreshold)
DEFAULT_BUY_THRESHOLD = 0  # USD - 0 means ALL buys

# Website
WEBSITE_URL = "https://emonad.lol"
MINI_APP_URL = "https://t.me/EmonadBot/emo"

# Local paths (relative to bot location)
BOT_DIR = Path(__file__).parent.parent  # Goes up to Ordtisms folder
MEMES_DIR = BOT_DIR / "memes"
EMONAD_IMAGE = BOT_DIR / "emonad.jpg"
DATA_DIR = Path(__file__).parent / "data"

# Ensure data directory exists
DATA_DIR.mkdir(exist_ok=True)

# Data files
USER_POINTS_FILE = DATA_DIR / "user_points.json"
PRICE_ALERTS_FILE = DATA_DIR / "price_alerts.json"
TRACKED_WALLETS_FILE = DATA_DIR / "tracked_wallets.json"
LAST_PRICE_FILE = DATA_DIR / "last_price.json"
BOT_SETTINGS_FILE = DATA_DIR / "bot_settings.json"
WALLET_CACHE_FILE = DATA_DIR / "wallet_txn_cache.json"

# Token creation block (found via binary search)
TOKEN_CREATION_BLOCK = 37742006

# Buy/Sell bot GIFs
BUY_BOT_GIF = BOT_DIR / "emo_video_640x360.gif"
SELL_BOT_GIF = Path(__file__).parent / "sell_video.gif"

def get_all_memes():
    """Get all meme files from the memes directory"""
    memes = []
    for ext in ['*.jpg', '*.jpeg', '*.png', '*.gif', '*.PNG', '*.JPG']:
        memes.extend(glob.glob(str(MEMES_DIR / ext)))
    return memes

# --- helpers ---

async def fetch_price_data():
    """Fetch token data from DEXScreener API"""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(DEXSCREENER_API) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get("pair"):
                        return data["pair"]
    except Exception as e:
        print(f"Error fetching price: {e}")
    return None

def format_number(num):
    """Format large numbers with K, M, B suffixes"""
    if num >= 1_000_000_000:
        return f"${num / 1_000_000_000:.2f}B"
    elif num >= 1_000_000:
        return f"${num / 1_000_000:.2f}M"
    elif num >= 1_000:
        return f"${num / 1_000:.2f}K"
    else:
        return f"${num:.2f}"

# --- data ---

def load_json(filepath):
    """Load JSON data from file"""
    try:
        if filepath.exists():
            with open(filepath, 'r') as f:
                return json.load(f)
    except:
        pass
    return {}

def save_json(filepath, data):
    """Save JSON data to file"""
    with open(filepath, 'w') as f:
        json.dump(data, f, indent=2)

# --- wallet tx cache ---

class WalletTxnCache:
    """Cache for wallet transactions - scans blockchain and stores results"""
    
    def __init__(self):
        self.cache = load_json(WALLET_CACHE_FILE)
        self.scanning = False
        self.scan_progress = {}
    
    def save(self):
        save_json(WALLET_CACHE_FILE, self.cache)
    
    def get_wallet_txns(self, wallet: str):
        """Get cached transaction data for a wallet"""
        wallet = wallet.lower()
        return self.cache.get(wallet, {})
    
    def set_wallet_txns(self, wallet: str, data: dict):
        """Store transaction data for a wallet"""
        wallet = wallet.lower()
        self.cache[wallet] = data
        self.save()
    
    async def scan_wallet_full(self, wallet: str, session: aiohttp.ClientSession) -> dict:
        """Scan transactions for a wallet - scans recent blocks quickly"""
        wallet = wallet.lower()
        wallet_padded = "0x" + wallet[2:].zfill(64)
        transfer_topic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
        
        # Check if we have cached data
        cached = self.cache.get(wallet, {})
        
        # Get current block
        try:
            async with session.post(MONAD_RPC, json={
                "jsonrpc": "2.0",
                "method": "eth_blockNumber",
                "params": [],
                "id": 1
            }) as resp:
                result = await resp.json()
                current_block = int(result.get("result", "0x0"), 16)
        except:
            return cached
        
        # If already scanned recently (within 5 minutes), return cached
        if cached.get("last_updated"):
            try:
                last_time = datetime.fromisoformat(cached["last_updated"])
                if (datetime.now() - last_time).total_seconds() < 300:
                    return cached
            except:
                pass
        
        # Start fresh scan - scan last 50k blocks (about 14 hours on Monad)
        in_txns = []
        out_txns = []
        total_in = 0
        total_out = 0
        
        # Scan in 100-block chunks
        chunk_size = 100
        total_blocks = 50000  # Scan last 50k blocks
        num_chunks = total_blocks // chunk_size
        
        print(f"Scanning {total_blocks} blocks for wallet {wallet[:10]}...")
        
        for i in range(num_chunks):
            to_block = current_block - i * chunk_size
            from_block = to_block - chunk_size + 1
            
            if from_block < TOKEN_CREATION_BLOCK:
                break
            
            # Transfers IN (buys)
            try:
                async with session.post(MONAD_RPC, json={
                    "jsonrpc": "2.0",
                    "method": "eth_getLogs",
                    "params": [{"fromBlock": hex(from_block), "toBlock": hex(to_block), "address": TOKEN_ADDRESS, "topics": [transfer_topic, None, wallet_padded]}],
                    "id": i
                }) as resp:
                    if resp.status == 200:
                        result = await resp.json()
                        logs = result.get("result", [])
                        if isinstance(logs, list):
                            for log in logs:
                                amount = int(log.get("data", "0x0"), 16) / 1e18
                                block = int(log.get("blockNumber", "0x0"), 16)
                                tx_hash = log.get("transactionHash", "")
                                in_txns.append({"block": block, "amount": amount, "tx": tx_hash})
                                total_in += amount
            except:
                await asyncio.sleep(0.1)
                continue
            
            # Transfers OUT (sells)
            try:
                async with session.post(MONAD_RPC, json={
                    "jsonrpc": "2.0",
                    "method": "eth_getLogs",
                    "params": [{"fromBlock": hex(from_block), "toBlock": hex(to_block), "address": TOKEN_ADDRESS, "topics": [transfer_topic, wallet_padded, None]}],
                    "id": i + 10000
                }) as resp:
                    if resp.status == 200:
                        result = await resp.json()
                        logs = result.get("result", [])
                        if isinstance(logs, list):
                            for log in logs:
                                amount = int(log.get("data", "0x0"), 16) / 1e18
                                block = int(log.get("blockNumber", "0x0"), 16)
                                tx_hash = log.get("transactionHash", "")
                                out_txns.append({"block": block, "amount": amount, "tx": tx_hash})
                                total_out += amount
            except:
                await asyncio.sleep(0.1)
                continue
            
            # Rate limiting - small pause every 50 requests
            if i % 50 == 0 and i > 0:
                await asyncio.sleep(0.05)
        
        # Save results
        result_data = {
            "in_txns": in_txns[-100:],  # Keep last 100 txns to save space
            "out_txns": out_txns[-100:],
            "total_in": total_in,
            "total_out": total_out,
            "buy_count": len(in_txns),
            "sell_count": len(out_txns),
            "last_scanned_block": current_block,
            "last_updated": datetime.now().isoformat()
        }
        self.cache[wallet] = result_data
        self.save()
        
        print(f"Scan complete for {wallet[:10]}: {len(in_txns)} buys, {len(out_txns)} sells")
        return result_data

# Global cache instance
wallet_cache = WalletTxnCache()

def add_user_points(user_id: int, username: str, points: int = 1):
    """Add points to a user (cuts)"""
    data = load_json(USER_POINTS_FILE)
    user_key = str(user_id)
    if user_key not in data:
        data[user_key] = {"username": username, "points": 0, "first_seen": datetime.now().isoformat()}
    data[user_key]["points"] += points
    data[user_key]["username"] = username  # Update username
    data[user_key]["last_active"] = datetime.now().isoformat()
    save_json(USER_POINTS_FILE, data)
    return data[user_key]["points"]

def get_user_points(user_id: int) -> int:
    """Get user's points"""
    data = load_json(USER_POINTS_FILE)
    return data.get(str(user_id), {}).get("points", 0)

def get_leaderboard(limit: int = 10):
    """Get top users by points"""
    data = load_json(USER_POINTS_FILE)
    sorted_users = sorted(data.items(), key=lambda x: x[1].get("points", 0), reverse=True)
    return sorted_users[:limit]

def add_price_alert(user_id: int, username: str, target_price: float, direction: str, recurring: bool = False):
    """Add a price alert for a user"""
    data = load_json(PRICE_ALERTS_FILE)
    user_key = str(user_id)
    if user_key not in data:
        data[user_key] = {"username": username, "alerts": []}
    data[user_key]["alerts"].append({
        "target_price": target_price,
        "direction": direction,  # "above" or "below"
        "recurring": recurring,  # If True, alert repeats instead of being deleted
        "created": datetime.now().isoformat(),
        "last_triggered": None
    })
    data[user_key]["username"] = username
    save_json(PRICE_ALERTS_FILE, data)

def get_user_alerts(user_id: int):
    """Get user's price alerts"""
    data = load_json(PRICE_ALERTS_FILE)
    return data.get(str(user_id), {}).get("alerts", [])

def remove_user_alert(user_id: int, index: int):
    """Remove a specific alert"""
    data = load_json(PRICE_ALERTS_FILE)
    user_key = str(user_id)
    if user_key in data and 0 <= index < len(data[user_key].get("alerts", [])):
        data[user_key]["alerts"].pop(index)
        save_json(PRICE_ALERTS_FILE, data)
        return True
    return False

def add_tracked_wallet(user_id: int, username: str, wallet: str, label: str = None):
    """Add a wallet to track"""
    data = load_json(TRACKED_WALLETS_FILE)
    user_key = str(user_id)
    if user_key not in data:
        data[user_key] = {"username": username, "wallets": []}
    # Check if already tracking
    for w in data[user_key]["wallets"]:
        if w["address"].lower() == wallet.lower():
            return False
    data[user_key]["wallets"].append({
        "address": wallet,
        "label": label or wallet,
        "added": datetime.now().isoformat()
    })
    save_json(TRACKED_WALLETS_FILE, data)
    return True

def get_tracked_wallets(user_id: int):
    """Get user's tracked wallets"""
    data = load_json(TRACKED_WALLETS_FILE)
    return data.get(str(user_id), {}).get("wallets", [])

def remove_tracked_wallet(user_id: int, wallet: str):
    """Remove a tracked wallet"""
    data = load_json(TRACKED_WALLETS_FILE)
    user_key = str(user_id)
    if user_key in data:
        original_len = len(data[user_key].get("wallets", []))
        data[user_key]["wallets"] = [w for w in data[user_key]["wallets"] if w["address"].lower() != wallet.lower()]
        if len(data[user_key]["wallets"]) < original_len:
            save_json(TRACKED_WALLETS_FILE, data)
            return True
    return False

def get_all_tracked_wallets():
    """Get all tracked wallets across all users"""
    data = load_json(TRACKED_WALLETS_FILE)
    all_wallets = {}
    for user_id, user_data in data.items():
        for wallet in user_data.get("wallets", []):
            addr = wallet["address"].lower()
            if addr not in all_wallets:
                all_wallets[addr] = []
            all_wallets[addr].append(int(user_id))
    return all_wallets

def get_bot_settings(chat_id: int):
    """Get bot settings for a chat"""
    data = load_json(BOT_SETTINGS_FILE)
    return data.get(str(chat_id), {"buy_bot_enabled": False})

def set_bot_setting(chat_id: int, key: str, value):
    """Set a bot setting for a chat"""
    data = load_json(BOT_SETTINGS_FILE)
    chat_key = str(chat_id)
    if chat_key not in data:
        data[chat_key] = {}
    data[chat_key][key] = value
    save_json(BOT_SETTINGS_FILE, data)

def is_buy_bot_enabled(chat_id: int) -> bool:
    """Check if buy bot is enabled for a chat"""
    settings = get_bot_settings(chat_id)
    return settings.get("buy_bot_enabled", False)

def is_sell_bot_enabled(chat_id: int) -> bool:
    """Check if sell bot is enabled for a chat"""
    settings = get_bot_settings(chat_id)
    return settings.get("sell_bot_enabled", False)

def get_chat_threshold(chat_id: int) -> float:
    """Get buy threshold for a chat"""
    settings = get_bot_settings(chat_id)
    return settings.get("buy_threshold", DEFAULT_BUY_THRESHOLD)

async def get_wallet_pnl(wallet: str, deep_scan: bool = True):
    """Calculate P&L for a wallet with full blockchain scan and real P&L calculation"""
    try:
        async with aiohttp.ClientSession() as session:
            # Get current token balance
            balance_call = "0x70a08231" + wallet[2:].lower().zfill(64)
            async with session.post(MONAD_RPC, json={
                "jsonrpc": "2.0",
                "method": "eth_call",
                "params": [{"to": TOKEN_ADDRESS, "data": balance_call}, "latest"],
                "id": 1
            }) as resp:
                result = await resp.json()
                actual_balance = int(result.get("result", "0x0"), 16) / 1e18
            
            # Get current price
            price_data = await fetch_price_data()
            current_price = float(price_data.get("priceUsd", 0)) if price_data else 0
            
            # Get cached transaction data or scan
            cached = wallet_cache.get_wallet_txns(wallet)
            
            if deep_scan and (not cached or cached.get("buy_count", 0) == 0):
                # Perform full blockchain scan
                cached = await wallet_cache.scan_wallet_full(wallet, session)
            
            buy_count = cached.get("buy_count", 0)
            sell_count = cached.get("sell_count", 0)
            total_bought = cached.get("total_in", 0)
            total_sold = cached.get("total_out", 0)
            
            # Calculate values
            current_value = actual_balance * current_price
            
            return {
                "total_bought": total_bought,
                "total_sold": total_sold,
                "current_balance": actual_balance,
                "current_value_usd": current_value,
                "buy_count": buy_count,
                "sell_count": sell_count,
                "current_price": current_price,
                "is_cached": bool(cached.get("last_updated")),
                "last_scanned": cached.get("last_updated", "Never")
            }
    except Exception as e:
        print(f"Error calculating P&L: {e}")
        return None

async def check_if_new_holder(wallet: str) -> bool:
    """Check if this is the wallet's first $EMO purchase - simplified check"""
    try:
        async with aiohttp.ClientSession() as session:
            transfer_topic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
            wallet_padded = "0x" + wallet[2:].lower().zfill(64)
            
            # Get current block
            async with session.post(MONAD_RPC, json={
                "jsonrpc": "2.0",
                "method": "eth_blockNumber",
                "params": [],
                "id": 1
            }) as resp:
                result = await resp.json()
                current_block = int(result.get("result", "0x0"), 16)
            
            # Just check last 1000 blocks with small batch
            total_logs = 0
            chunk_size = 100
            
            for i in range(10):  # 10 chunks = 1000 blocks
                to_block = current_block - i * chunk_size
                from_block = to_block - chunk_size + 1
                
                try:
                    async with session.post(MONAD_RPC, json={
                        "jsonrpc": "2.0",
                        "method": "eth_getLogs",
                        "params": [{"fromBlock": hex(from_block), "toBlock": hex(to_block), "address": TOKEN_ADDRESS, "topics": [transfer_topic, None, wallet_padded]}],
                        "id": i
                    }) as resp:
                        if resp.status == 200:
                            result = await resp.json()
                            logs = result.get("result", [])
                            if isinstance(logs, list):
                                total_logs += len(logs)
                                if total_logs > 1:
                                    return False
                except:
                    continue
            
            return total_logs <= 1
    except:
        return False

async def get_holder_rank(wallet: str) -> int:
    """Get wallet's rank among all holders"""
    try:
        holder_data = await fetch_holder_data()
        if holder_data:
            for i, (addr, balance) in enumerate(holder_data.get("top_holders", []), 1):
                if addr.lower() == wallet.lower():
                    return i
        return 0  # Not in top holders
    except:
        return 0

# --- commands ---

async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Welcome message with emonad.jpg image"""
    user = update.effective_user
    add_user_points(user.id, user.username or user.first_name)
    
    # Check if private chat - WebAppInfo only works in private chats
    is_private = update.effective_chat.type == "private"
    
    if is_private:
        keyboard = [
            [InlineKeyboardButton("🖤 Website", web_app=WebAppInfo(url=WEBSITE_URL))],
            [InlineKeyboardButton("📊 Chart", web_app=WebAppInfo(url=DEXSCREENER_CHART))],
            [InlineKeyboardButton("💰 Buy $EMO", web_app=WebAppInfo(url=f"https://app.uniswap.org/swap?chain=monad&outputCurrency={TOKEN_ADDRESS}"))],
            [InlineKeyboardButton("📱 Open App", url=MINI_APP_URL)]
        ]
    else:
        keyboard = [
            [InlineKeyboardButton("🖤 Website", url=WEBSITE_URL),
             InlineKeyboardButton("📊 Chart", url=DEXSCREENER_CHART),
             InlineKeyboardButton("💰 Buy", url=f"https://app.uniswap.org/swap?chain=monad&outputCurrency={TOKEN_ADDRESS}")],
            [InlineKeyboardButton("📱 Open App", url=MINI_APP_URL)]
        ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    welcome_text = """
🖤 *$EMO* 🖤

_i lost it all on day 1_

`0x81A224F8A62f52BdE942dBF23A56df77A10b7777`
"""
    
    try:
        with open(EMONAD_IMAGE, 'rb') as photo:
            await update.message.reply_photo(
                photo=photo,
                caption=welcome_text,
                parse_mode="Markdown",
                reply_markup=reply_markup
            )
    except Exception as e:
        print(f"Error sending start image: {e}")
        await update.message.reply_text(
            welcome_text,
            parse_mode="Markdown",
            reply_markup=reply_markup
        )

async def price_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Get current price and comprehensive stats with chart image"""
    user = update.effective_user
    add_user_points(user.id, user.username or user.first_name)
    
    data = await fetch_price_data()
    
    if not data:
        await update.message.reply_text("😢 Couldn't fetch price data. Try again later.")
        return
    
    # Basic metrics
    price = float(data.get("priceUsd", 0))
    price_native = float(data.get("priceNative", 0))
    mcap = float(data.get("marketCap", 0)) if data.get("marketCap") else 0
    fdv = float(data.get("fdv", 0)) if data.get("fdv") else 0
    liquidity = float(data.get("liquidity", {}).get("usd", 0)) if data.get("liquidity") else 0
    
    # Price changes
    price_change_5m = float(data.get("priceChange", {}).get("m5", 0))
    price_change_1h = float(data.get("priceChange", {}).get("h1", 0))
    price_change_6h = float(data.get("priceChange", {}).get("h6", 0))
    price_change_24h = float(data.get("priceChange", {}).get("h24", 0))
    
    # Volume
    volume_5m = float(data.get("volume", {}).get("m5", 0))
    volume_1h = float(data.get("volume", {}).get("h1", 0))
    volume_6h = float(data.get("volume", {}).get("h6", 0))
    volume_24h = float(data.get("volume", {}).get("h24", 0))
    
    # Transactions
    txns = data.get("txns", {})
    buys_5m = txns.get("m5", {}).get("buys", 0)
    sells_5m = txns.get("m5", {}).get("sells", 0)
    buys_1h = txns.get("h1", {}).get("buys", 0)
    sells_1h = txns.get("h1", {}).get("sells", 0)
    buys_24h = txns.get("h24", {}).get("buys", 0)
    sells_24h = txns.get("h24", {}).get("sells", 0)
    
    # Pair info
    pair_created = data.get("pairCreatedAt", 0)
    dex_name = data.get("dexId", "Unknown")
    
    # Emojis based on price change
    def get_emoji(change):
        return "🟢" if change >= 0 else "🔴"
    
    price_text = f"""🖤 *$EMO Token Stats* 🖤

💵 *Price:* ${price:.10f}
💎 *Price (MON):* {price_native:.8f} MON

*━━━ Price Changes ━━━*
{get_emoji(price_change_5m)} *5m:* {price_change_5m:+.2f}%
{get_emoji(price_change_1h)} *1h:* {price_change_1h:+.2f}%
{get_emoji(price_change_6h)} *6h:* {price_change_6h:+.2f}%
{get_emoji(price_change_24h)} *24h:* {price_change_24h:+.2f}%

*━━━ Market Data ━━━*
📊 *MCap:* {format_number(mcap)}
💎 *FDV:* {format_number(fdv)}
💧 *Liquidity:* {format_number(liquidity)}
🏦 *DEX:* {dex_name.upper()}

*━━━ Volume ━━━*
📈 *5m:* {format_number(volume_5m)}
📈 *1h:* {format_number(volume_1h)}
📈 *6h:* {format_number(volume_6h)}
📈 *24h:* {format_number(volume_24h)}

*━━━ Transactions ━━━*
🟢 *Buys 1h:* {buys_1h} | 🔴 *Sells:* {sells_1h}
🟢 *Buys 24h:* {buys_24h} | 🔴 *Sells:* {sells_24h}

_i lost it all on day 1_"""
    
    # Check if private chat for WebApp buttons
    is_private = update.effective_chat.type == "private"
    
    if is_private:
        keyboard = [
            [InlineKeyboardButton("📊 Chart", web_app=WebAppInfo(url=DEXSCREENER_CHART)),
             InlineKeyboardButton("💰 Buy", web_app=WebAppInfo(url=f"https://app.uniswap.org/swap?chain=monad&outputCurrency={TOKEN_ADDRESS}")),
             InlineKeyboardButton("📱 App", url=MINI_APP_URL)]
        ]
    else:
        keyboard = [
            [InlineKeyboardButton("📊 Chart", url=DEXSCREENER_CHART),
             InlineKeyboardButton("💰 Buy", url=f"https://app.uniswap.org/swap?chain=monad&outputCurrency={TOKEN_ADDRESS}"),
             InlineKeyboardButton("📱 App", url=MINI_APP_URL)]
        ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    # Send emonad image with price stats
    try:
        with open(EMONAD_IMAGE, 'rb') as photo:
            await update.message.reply_photo(
                photo=photo,
                caption=price_text,
                parse_mode="Markdown",
                reply_markup=reply_markup
            )
    except:
        await update.message.reply_text(
            price_text,
            parse_mode="Markdown",
            reply_markup=reply_markup
        )

async def chart_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Send chart screenshot from DEXScreener using screenshot service"""
    user = update.effective_user
    add_user_points(user.id, user.username or user.first_name)
    
    # Check if private chat for WebApp buttons
    is_private = update.effective_chat.type == "private"
    
    if is_private:
        keyboard = [
            [InlineKeyboardButton("📊 Chart", web_app=WebAppInfo(url=DEXSCREENER_CHART)),
             InlineKeyboardButton("💰 Buy", web_app=WebAppInfo(url=f"https://app.uniswap.org/swap?chain=monad&outputCurrency={TOKEN_ADDRESS}")),
             InlineKeyboardButton("📱 App", url=MINI_APP_URL)]
        ]
    else:
        keyboard = [
            [InlineKeyboardButton("📊 Chart", url=DEXSCREENER_CHART),
             InlineKeyboardButton("💰 Buy", url=f"https://app.uniswap.org/swap?chain=monad&outputCurrency={TOKEN_ADDRESS}"),
             InlineKeyboardButton("📱 App", url=MINI_APP_URL)]
        ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    # Fetch price data for caption
    data = await fetch_price_data()
    price_info = ""
    if data:
        price = float(data.get("priceUsd", 0))
        change_1h = float(data.get("priceChange", {}).get("h1", 0))
        change_24h = float(data.get("priceChange", {}).get("h24", 0))
        volume = float(data.get("volume", {}).get("h24", 0))
        emoji_1h = "🟢" if change_1h >= 0 else "🔴"
        emoji_24h = "🟢" if change_24h >= 0 else "🔴"
        price_info = f"\n\n💵 *Price:* ${price:.10f}\n{emoji_1h} *1h:* {change_1h:+.2f}%\n{emoji_24h} *24h:* {change_24h:+.2f}%\n📈 *Vol 24h:* {format_number(volume)}"
    
    # Send emonad image with chart info
    try:
        with open(EMONAD_IMAGE, 'rb') as photo:
            await update.message.reply_photo(
                photo=photo,
                caption=f"🖤 *$EMO Chart* 🖤{price_info}\n\nTap Chart below for live view!\n\n_i lost it all on day 1_",
                parse_mode="Markdown",
                reply_markup=reply_markup
            )
    except:
        await update.message.reply_text(
            f"🖤 *$EMO Chart* 🖤{price_info}\n\n_i lost it all on day 1_",
            parse_mode="Markdown",
            reply_markup=reply_markup
        )

async def meme_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Send a random meme from local memes folder"""
    user = update.effective_user
    add_user_points(user.id, user.username or user.first_name)
    
    # Check if private chat for WebApp buttons
    is_private = update.effective_chat.type == "private"
    
    if is_private:
        keyboard = [
            [InlineKeyboardButton("🖤 Memes", web_app=WebAppInfo(url="https://escapist.lol/memes.html")),
             InlineKeyboardButton("💰 Buy", web_app=WebAppInfo(url=f"https://app.uniswap.org/swap?chain=monad&outputCurrency={TOKEN_ADDRESS}")),
             InlineKeyboardButton("📱 App", url=MINI_APP_URL)]
        ]
    else:
        keyboard = [
            [InlineKeyboardButton("🖤 Memes", url="https://escapist.lol/memes.html"),
             InlineKeyboardButton("💰 Buy", url=f"https://app.uniswap.org/swap?chain=monad&outputCurrency={TOKEN_ADDRESS}"),
             InlineKeyboardButton("📱 App", url=MINI_APP_URL)]
        ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    memes = get_all_memes()
    if not memes:
        await update.message.reply_text(
            "😢 No memes found!",
            reply_markup=reply_markup
        )
        return
    
    meme_path = random.choice(memes)
    
    try:
        with open(meme_path, 'rb') as photo:
            await update.message.reply_photo(
                photo=photo,
                caption="🖤 *$EMO Meme* 🖤\n\n_i lost it all on day 1_",
                parse_mode="Markdown",
                reply_markup=reply_markup
            )
    except Exception as e:
        print(f"Error sending meme {meme_path}: {e}")
        await update.message.reply_text(
            "😢 Couldn't load meme. Try again!",
            reply_markup=reply_markup
        )

# --- more commands ---

async def fetch_holder_data():
    """Fetch holder data using DEXScreener + batch RPC queries (100 block limit)"""
    try:
        async with aiohttp.ClientSession() as session:
            # Method 1: Get holder estimate from DEXScreener
            token_api = f"https://api.dexscreener.com/latest/dex/tokens/{TOKEN_ADDRESS}"
            holder_count = 0
            
            try:
                async with session.get(token_api) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        pairs = data.get("pairs", [])
                        if pairs:
                            pair_data = pairs[0]
                            txns = pair_data.get("txns", {})
                            buys_24h = txns.get("h24", {}).get("buys", 0)
                            sells_24h = txns.get("h24", {}).get("sells", 0)
                            holder_count = max(100, (buys_24h + sells_24h) * 4)
            except:
                pass
            
            # Get current block
            async with session.post(MONAD_RPC, json={
                "jsonrpc": "2.0",
                "method": "eth_blockNumber",
                "params": [],
                "id": 1
            }) as resp:
                result = await resp.json()
                current_block = int(result.get("result", "0x0"), 16)
            
            # Transfer event topic
            transfer_topic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
            
            # Query in 100-block chunks sequentially (avoid rate limiting)
            balances = {}
            chunk_size = 100
            total_blocks = 2000  # Scan last 2k blocks (20 queries)
            
            for i in range(total_blocks // chunk_size):
                to_block = current_block - i * chunk_size
                from_block = to_block - chunk_size + 1
                if from_block < 0:
                    break
                
                try:
                    async with session.post(MONAD_RPC, json={
                        "jsonrpc": "2.0",
                        "method": "eth_getLogs",
                        "params": [{"fromBlock": hex(from_block), "toBlock": hex(to_block), "address": TOKEN_ADDRESS, "topics": [transfer_topic]}],
                        "id": i
                    }) as resp:
                        if resp.status == 200:
                            result = await resp.json()
                            logs = result.get("result", [])
                            if isinstance(logs, list):
                                for log in logs:
                                    topics = log.get("topics", [])
                                    if len(topics) >= 3:
                                        from_addr = "0x" + topics[1][-40:].lower()
                                        to_addr = "0x" + topics[2][-40:].lower()
                                        amount = int(log.get("data", "0x0"), 16)
                                        if from_addr != "0x0000000000000000000000000000000000000000":
                                            balances[from_addr] = balances.get(from_addr, 0) - amount
                                        balances[to_addr] = balances.get(to_addr, 0) + amount
                except:
                    continue
            
            # Filter and sort holders
            holders = {k: v for k, v in balances.items() if v > 0}
            sorted_holders = sorted(holders.items(), key=lambda x: x[1], reverse=True)
            
            # Use DEXScreener estimate if we didn't find many holders
            final_count = len(holders) if len(holders) > 10 else holder_count
            
            return {
                "holder_count": final_count if final_count > 0 else "N/A",
                "top_holders": sorted_holders[:10],
                "total_supply": sum(v for v in holders.values() if v > 0)
            }
    except Exception as e:
        print(f"Error fetching holder data: {e}")
        return None

async def holders_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show holder statistics"""
    user = update.effective_user
    add_user_points(user.id, user.username or user.first_name)
    
    await update.message.reply_text("🔍 Fetching holder data...")
    
    data = await fetch_price_data()
    holder_data = await fetch_holder_data()
    
    if not data:
        await update.message.reply_text("😢 Couldn't fetch data. Try again later.")
        return
    
    # DEXScreener metrics
    mcap = float(data.get("marketCap", 0)) if data.get("marketCap") else 0
    fdv = float(data.get("fdv", 0)) if data.get("fdv") else 0
    liquidity = float(data.get("liquidity", {}).get("usd", 0)) if data.get("liquidity") else 0
    price = float(data.get("priceUsd", 0))
    
    # Transaction counts
    txns = data.get("txns", {})
    buys_24h = txns.get("h24", {}).get("buys", 0)
    sells_24h = txns.get("h24", {}).get("sells", 0)
    
    # Calculate buy/sell ratio
    ratio = buys_24h / sells_24h if sells_24h > 0 else buys_24h
    ratio_emoji = "🟢" if ratio >= 1 else "🔴"
    
    # Holder info
    holder_count = holder_data.get("holder_count", "N/A") if holder_data else "N/A"
    top_holders = holder_data.get("top_holders", []) if holder_data else []
    total_supply = holder_data.get("total_supply", 0) if holder_data else 0
    
    # Build top holders text
    top_holders_text = ""
    if top_holders and total_supply > 0:
        top_holders_text = "\n*━━━ Top 5 Holders ━━━*\n"
        for i, (addr, balance) in enumerate(top_holders[:5], 1):
            pct = (balance / total_supply) * 100
            usd_value = (balance / 1e18) * price
            # Check if it's the pair/LP address
            is_lp = addr.lower() == PAIR_ADDRESS.lower()
            label = " (LP)" if is_lp else ""
            top_holders_text += f"{i}. `{addr}`{label}\n   💰 {pct:.1f}% (~{format_number(usd_value)})\n"
    
    # Additional metrics
    volume_24h = float(data.get("volume", {}).get("h24", 0))
    change_24h = float(data.get("priceChange", {}).get("h24", 0))
    change_1h = float(data.get("priceChange", {}).get("h1", 0))
    
    # Concentration metrics
    top5_pct = 0
    if top_holders and total_supply > 0:
        top5_balance = sum(bal for _, bal in top_holders[:5])
        top5_pct = (top5_balance / total_supply) * 100
    
    holders_text = f"""🖤 *$EMO Holder Stats* 🖤

👥 *Holders:* {holder_count:,} addresses
📊 *Market Cap:* {format_number(mcap)}
💎 *FDV:* {format_number(fdv)}
💧 *Liquidity:* {format_number(liquidity)}
📈 *24h Volume:* {format_number(volume_24h)}

*━━━ Price Action ━━━*
{'🟢' if change_1h >= 0 else '🔴'} *1h:* {change_1h:+.2f}%
{'🟢' if change_24h >= 0 else '🔴'} *24h:* {change_24h:+.2f}%
{top_holders_text}
*━━━ Concentration ━━━*
📊 *Top 5 Hold:* {top5_pct:.1f}% of supply

*━━━ 24h Activity ━━━*
🟢 *Buys:* {buys_24h}
🔴 *Sells:* {sells_24h}
{ratio_emoji} *Buy/Sell Ratio:* {ratio:.2f}x

🔗 [View on Monad Vision](https://monadexplorer.com/token/{TOKEN_ADDRESS})

_i lost it all on day 1_"""
    
    keyboard = [[
        InlineKeyboardButton("📊 Chart", url=DEXSCREENER_CHART),
        InlineKeyboardButton("💰 Buy", url=f"https://app.uniswap.org/swap?chain=monad&outputCurrency={TOKEN_ADDRESS}"),
        InlineKeyboardButton("📱 App", url=MINI_APP_URL)
    ]]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await update.message.reply_text(holders_text, parse_mode="Markdown", reply_markup=reply_markup)

async def alert_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Set a price alert: /alert 0.00001 or /alert 0.00001 repeat"""
    user = update.effective_user
    add_user_points(user.id, user.username or user.first_name)
    
    if not context.args:
        await update.message.reply_text(
            "📢 *Set Price Alert*\n\n"
            "Usage: `/alert <price> [repeat]`\n\n"
            "Examples:\n"
            "`/alert 0.00001` - One-time alert\n"
            "`/alert 0.00001 repeat` - Recurring alert\n\n"
            "Recurring alerts notify you every time price crosses!",
            parse_mode="Markdown"
        )
        return
    
    try:
        target_price = float(context.args[0])
    except ValueError:
        await update.message.reply_text("❌ Invalid price. Use a number like `0.00001`", parse_mode="Markdown")
        return
    
    # Check for recurring flag
    recurring = len(context.args) > 1 and context.args[1].lower() in ["repeat", "recurring", "r"]
    
    # Get current price to determine direction
    data = await fetch_price_data()
    if data:
        current_price = float(data.get("priceUsd", 0))
        direction = "above" if target_price > current_price else "below"
    else:
        direction = "above"  # Default
    
    add_price_alert(user.id, user.username or user.first_name, target_price, direction, recurring)
    
    recurring_text = "🔄 *Recurring* - Will notify every time!" if recurring else "⚡ *One-time* - Will be removed after trigger"
    
    await update.message.reply_text(
        f"✅ *Alert Set!*\n\n"
        f"🎯 Target: `${target_price:.10f}`\n"
        f"📍 Direction: {direction.upper()}\n"
        f"{recurring_text}\n\n"
        f"Use /alerts to view your alerts\n"
        f"Use /delalert <number> to remove",
        parse_mode="Markdown"
    )

async def alerts_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """View user's price alerts"""
    user = update.effective_user
    add_user_points(user.id, user.username or user.first_name)
    
    alerts = get_user_alerts(user.id)
    
    if not alerts:
        await update.message.reply_text(
            "📢 *Your Alerts*\n\n"
            "No alerts set!\n"
            "Use `/alert <price>` to set one.",
            parse_mode="Markdown"
        )
        return
    
    alert_text = "📢 *Your Price Alerts*\n\n"
    for i, alert in enumerate(alerts, 1):
        direction_emoji = "📈" if alert["direction"] == "above" else "📉"
        alert_text += f"{i}. {direction_emoji} ${alert['target_price']:.10f}\n"
    
    alert_text += f"\n_Use /delalert <number> to remove_"
    
    await update.message.reply_text(alert_text, parse_mode="Markdown")

async def delalert_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Delete a price alert: /delalert 1"""
    user = update.effective_user
    
    if not context.args:
        await update.message.reply_text("Usage: `/delalert <number>`", parse_mode="Markdown")
        return
    
    try:
        index = int(context.args[0]) - 1
    except ValueError:
        await update.message.reply_text("❌ Invalid number", parse_mode="Markdown")
        return
    
    if remove_user_alert(user.id, index):
        await update.message.reply_text("✅ Alert removed!")
    else:
        await update.message.reply_text("❌ Alert not found")

async def leaderboard_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show top users by cuts (points)"""
    user = update.effective_user
    add_user_points(user.id, user.username or user.first_name)
    
    leaders = get_leaderboard(10)
    
    if not leaders:
        await update.message.reply_text("🏆 No cuts yet! Use the bot to earn cuts.")
        return
    
    leaderboard_text = "🏆 *$EMO Leaderboard* 🏆\n\n"
    
    medals = ["🥇", "🥈", "🥉"]
    for i, (user_id, data) in enumerate(leaders):
        medal = medals[i] if i < 3 else f"{i+1}."
        username = data.get("username", "Anonymous")
        points = data.get("points", 0)
        leaderboard_text += f"{medal} @{username}: *{points} cuts*\n"
    
    leaderboard_text += "\n_Use the bot to earn more cuts!_"
    
    keyboard = [[
        InlineKeyboardButton("📊 My Cuts", callback_data="mycuts"),
        InlineKeyboardButton("📱 App", url=MINI_APP_URL)
    ]]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await update.message.reply_text(leaderboard_text, parse_mode="Markdown", reply_markup=reply_markup)

async def mycuts_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show user's cut points"""
    user = update.effective_user
    points = add_user_points(user.id, user.username or user.first_name)
    
    # Get rank
    leaders = get_leaderboard(100)
    rank = next((i+1 for i, (uid, _) in enumerate(leaders) if uid == str(user.id)), "?")
    
    await update.message.reply_text(
        f"🖤 *Your Cuts* 🖤\n\n"
        f"💀 *Cuts:* {points}\n"
        f"🏆 *Rank:* #{rank}\n\n"
        f"_Keep using the bot to earn more cuts!_",
        parse_mode="Markdown"
    )

async def tracker_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Track a wallet: /tracker 0x123... [name]"""
    user = update.effective_user
    add_user_points(user.id, user.username or user.first_name)
    
    if not context.args:
        await update.message.reply_text(
            "👁️ *Wallet Tracker*\n\n"
            "Track wallets to get notified when they buy $EMO!\n\n"
            "*Usage:*\n"
            "`/tracker <address> [name]`\n\n"
            "*Examples:*\n"
            "`/tracker 0x1234...abcd`\n"
            "`/tracker 0x1234...abcd Whale1`\n"
            "`/tracker 0x1234...abcd Dev Wallet`\n\n"
            "*Other commands:*\n"
            "`/tracked` - View your tracked wallets\n"
            "`/untrack <address>` - Stop tracking",
            parse_mode="Markdown"
        )
        return
    
    wallet = context.args[0]
    
    # Validate wallet address
    if not wallet.startswith("0x") or len(wallet) != 42:
        await update.message.reply_text("❌ Invalid wallet address. Must be 0x... (42 chars)")
        return
    
    # Get optional name (everything after the address)
    name = " ".join(context.args[1:]) if len(context.args) > 1 else None
    
    if add_tracked_wallet(user.id, user.username or user.first_name, wallet, name):
        name_display = f"*{name}*" if name else f"`{wallet}`"
        await update.message.reply_text(
            f"✅ *Wallet Added!*\n\n"
            f"👁️ Now tracking: {name_display}\n"
            f"📍 `{wallet}`\n\n"
            f"You'll be notified when this wallet buys $EMO!\n\n"
            f"_Use /tracked to see all your wallets_",
            parse_mode="Markdown"
        )
    else:
        await update.message.reply_text("❌ Already tracking this wallet!")

async def tracked_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show all tracked wallets with P&L"""
    user = update.effective_user
    add_user_points(user.id, user.username or user.first_name)
    
    wallets = get_tracked_wallets(user.id)
    
    if not wallets:
        await update.message.reply_text(
            "👁️ *Your Tracked Wallets*\n\n"
            "No wallets tracked yet!\n\n"
            "Use `/tracker <address> [name]` to add one.",
            parse_mode="Markdown"
        )
        return
    
    msg = await update.message.reply_text("🔍 Scanning wallets... This may take a moment.")
    
    wallet_text = "👁️ *Your Tracked Wallets*\n\n"
    for i, w in enumerate(wallets, 1):
        label = w.get('label', '')
        addr = w['address']
        
        # Get P&L data for each wallet (use cache, don't deep scan for speed)
        pnl_data = await get_wallet_pnl(addr, deep_scan=False)
        
        if label and not label.startswith(addr[:8]):
            wallet_text += f"{i}. *{label}*\n"
        else:
            wallet_text += f"{i}. Wallet\n"
        
        wallet_text += f"   📍 `{addr}`\n"
        
        if pnl_data:
            balance = pnl_data["current_balance"]
            value = pnl_data["current_value_usd"]
            buys = pnl_data["buy_count"]
            sells = pnl_data["sell_count"]
            
            holder_badge = "✅" if balance > 0 else "❌"
            wallet_text += f"   {holder_badge} {balance:,.0f} $EMO ({format_number(value)})\n"
            
            if buys > 0 or sells > 0:
                wallet_text += f"   📊 {buys} buys | {sells} sells\n"
            elif balance > 0:
                wallet_text += f"   📊 Older txns (balance verified)\n"
        
        wallet_text += f"   🔗 [Monad Vision](https://monadexplorer.com/address/{addr})\n\n"
    
    wallet_text += "_Use /untrack <address> to remove_\n"
    wallet_text += "_Use /pnl <address> for full scan & analysis_"
    await msg.edit_text(wallet_text, parse_mode="Markdown", disable_web_page_preview=True)

async def untrack_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Stop tracking a wallet: /untrack 0x123..."""
    user = update.effective_user
    add_user_points(user.id, user.username or user.first_name)
    
    if not context.args:
        await update.message.reply_text(
            "Usage: `/untrack <wallet_address>`\n\n"
            "Use `/tracked` to see your wallets first.",
            parse_mode="Markdown"
        )
        return
    
    wallet = context.args[0]
    
    if remove_tracked_wallet(user.id, wallet):
        await update.message.reply_text(f"✅ Wallet `{wallet}` removed from tracking!")
    else:
        await update.message.reply_text("❌ Wallet not found. Use `/tracked` to see your list.", parse_mode="Markdown")

# --- help ---

async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show all available commands"""
    user = update.effective_user
    add_user_points(user.id, user.username or user.first_name)
    
    help_text = """🖤 *$EMO Bot Commands* 🖤

*━━━ Basic ━━━*
/start - Welcome message
/price - Full price stats
/meme - Random emo meme
/holders - Holder stats & top holders
/ca - Contract address (tap to copy)

*━━━ Analytics ━━━*
/pnl <wallet> - Check wallet P&L
/liquidity - Detailed LP info
/gas - Current Monad gas
/burn - Burned tokens
/compare - Key metrics & ratios

*━━━ Alerts ━━━*
/alert <price> - Set price alert
/alerts - View your alerts
/delalert <#> - Remove alert

*━━━ Wallet Tracker ━━━*
/tracker <address> [name] - Track wallet
/tracked - View tracked wallets
/untrack <address> - Stop tracking

*━━━ Leaderboard ━━━*
/leaderboard - Top users by cuts
/mycuts - Your cut points

*━━━ Buy/Sell Bot (Admin) ━━━*
/boton - Enable buy alerts
/botoff - Disable buy alerts
/sellson - Enable sell alerts
/sellsoff - Disable sell alerts
/setthreshold <$> - Set min amount

*━━━ Other ━━━*
/help - This message

_i lost it all on day 1_"""
    
    keyboard = [[
        InlineKeyboardButton("📊 Chart", url=DEXSCREENER_CHART),
        InlineKeyboardButton("💰 Buy", url=f"https://app.uniswap.org/swap?chain=monad&outputCurrency={TOKEN_ADDRESS}"),
        InlineKeyboardButton("📱 App", url=MINI_APP_URL)
    ]]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await update.message.reply_text(help_text, parse_mode="Markdown", reply_markup=reply_markup)

# --- buy bot ---

async def boton_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Enable buy bot for this chat (admin only)"""
    user = update.effective_user
    chat = update.effective_chat
    
    # Check if user is admin in groups
    if chat.type != "private":
        member = await chat.get_member(user.id)
        if member.status not in ["creator", "administrator"]:
            await update.message.reply_text("❌ Only admins can enable the buy bot!")
            return
    
    set_bot_setting(chat.id, "buy_bot_enabled", True)
    await update.message.reply_text(
        "✅ *Buy Bot Enabled!*\n\n"
        "🖤 Buy alerts will now be posted here with the emo GIF!\n\n"
        "_Use /botoff to disable_",
        parse_mode="Markdown"
    )

async def botoff_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Disable buy bot for this chat (admin only)"""
    user = update.effective_user
    chat = update.effective_chat
    
    # Check if user is admin in groups
    if chat.type != "private":
        member = await chat.get_member(user.id)
        if member.status not in ["creator", "administrator"]:
            await update.message.reply_text("❌ Only admins can disable the buy bot!")
            return
    
    set_bot_setting(chat.id, "buy_bot_enabled", False)
    await update.message.reply_text(
        "🔇 *Buy Bot Disabled*\n\n"
        "Buy alerts will no longer be posted here.\n\n"
        "_Use /boton to enable_",
        parse_mode="Markdown"
    )

async def sellson_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Enable sell bot for this chat (admin only)"""
    user = update.effective_user
    chat = update.effective_chat
    
    if chat.type != "private":
        member = await chat.get_member(user.id)
        if member.status not in ["creator", "administrator"]:
            await update.message.reply_text("❌ Only admins can enable the sell bot!")
            return
    
    set_bot_setting(chat.id, "sell_bot_enabled", True)
    await update.message.reply_text(
        "📉 *Sell Bot Enabled!*\n\n"
        "Sell alerts will now be posted here!\n\n"
        "_Use /sellsoff to disable_",
        parse_mode="Markdown"
    )

async def sellsoff_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Disable sell bot for this chat (admin only)"""
    user = update.effective_user
    chat = update.effective_chat
    
    if chat.type != "private":
        member = await chat.get_member(user.id)
        if member.status not in ["creator", "administrator"]:
            await update.message.reply_text("❌ Only admins can disable the sell bot!")
            return
    
    set_bot_setting(chat.id, "sell_bot_enabled", False)
    await update.message.reply_text(
        "🔇 *Sell Bot Disabled*\n\n"
        "Sell alerts will no longer be posted here.\n\n"
        "_Use /sellson to enable_",
        parse_mode="Markdown"
    )

async def pnl_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Check P&L for any wallet: /pnl 0x123..."""
    user = update.effective_user
    add_user_points(user.id, user.username or user.first_name)
    
    if not context.args:
        await update.message.reply_text(
            "📊 *Wallet P&L Checker*\n\n"
            "Check any wallet's $EMO profit/loss!\n\n"
            "Usage: `/pnl <wallet_address>`\n"
            "Example: `/pnl 0x1234...abcd`",
            parse_mode="Markdown"
        )
        return
    
    wallet = context.args[0]
    if not wallet.startswith("0x") or len(wallet) != 42:
        await update.message.reply_text("❌ Invalid wallet address.")
        return
    
    msg = await update.message.reply_text("🔍 Scanning blockchain for wallet data... This may take a moment.")
    
    pnl_data = await get_wallet_pnl(wallet, deep_scan=True)
    
    if not pnl_data:
        await msg.edit_text("❌ Couldn't fetch wallet data. Try again.")
        return
    
    current_value = pnl_data["current_value_usd"]
    balance = pnl_data["current_balance"]
    buys = pnl_data["buy_count"]
    sells = pnl_data["sell_count"]
    total_bought = pnl_data.get("total_bought", 0)
    total_sold = pnl_data.get("total_sold", 0)
    
    # Calculate net position
    net_tokens = total_bought - total_sold if total_bought > 0 else 0
    
    # Holder status
    if balance > 0:
        holder_status = "✅ *Verified Holder*"
    else:
        holder_status = "❌ *No tokens held*"
    
    # Activity summary
    if buys > 0 or sells > 0:
        activity_text = f"""*━━━ Transaction History (14h) ━━━*
🟢 *Buys:* {buys} ({total_bought:,.0f} $EMO)
🔴 *Sells:* {sells} ({total_sold:,.0f} $EMO)
📊 *Net:* {net_tokens:,.0f} $EMO"""
    elif balance > 0:
        activity_text = """*━━━ Transaction History ━━━*
📊 *Older transactions* - balance verified
💡 _Buys occurred before scan window_"""
    else:
        activity_text = """*━━━ Transaction History ━━━*
📊 No recent activity found"""
    
    pnl_text = f"""📊 *Wallet Analysis* 📊

👤 `{wallet}`
🔗 [View on Monad Vision](https://monadexplorer.com/address/{wallet})

*━━━ Holdings ━━━*
💎 *Balance:* {balance:,.0f} $EMO
💵 *Value:* {format_number(current_value)}
{holder_status}

{activity_text}

_i lost it all on day 1_"""
    
    keyboard = [[
        InlineKeyboardButton("👤 Monad Vision", url=f"https://monadexplorer.com/address/{wallet}"),
        InlineKeyboardButton("📊 Chart", url=DEXSCREENER_CHART)
    ]]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await msg.edit_text(pnl_text, parse_mode="Markdown", reply_markup=reply_markup)

async def ca_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Quick contract address copy"""
    user = update.effective_user
    add_user_points(user.id, user.username or user.first_name)
    
    await update.message.reply_text(
        f"🖤 *$EMO Contract Address*\n\n"
        f"`{TOKEN_ADDRESS}`\n\n"
        f"_Tap to copy!_",
        parse_mode="Markdown"
    )

async def gas_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show current Monad gas prices"""
    user = update.effective_user
    add_user_points(user.id, user.username or user.first_name)
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(MONAD_RPC, json={
                "jsonrpc": "2.0",
                "method": "eth_gasPrice",
                "params": [],
                "id": 1
            }) as resp:
                result = await resp.json()
                gas_wei = int(result.get("result", "0x0"), 16)
                gas_gwei = gas_wei / 1e9
        
        await update.message.reply_text(
            f"⛽ *Monad Gas Price*\n\n"
            f"💨 *Current:* {gas_gwei:.2f} Gwei\n\n"
            f"_Monad = fast & cheap!_",
            parse_mode="Markdown"
        )
    except:
        await update.message.reply_text("❌ Couldn't fetch gas price.")

async def liquidity_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show detailed liquidity info"""
    user = update.effective_user
    add_user_points(user.id, user.username or user.first_name)
    
    data = await fetch_price_data()
    if not data:
        await update.message.reply_text("❌ Couldn't fetch data.")
        return
    
    liquidity = data.get("liquidity", {})
    liq_usd = float(liquidity.get("usd", 0))
    liq_base = float(liquidity.get("base", 0))
    liq_quote = float(liquidity.get("quote", 0))
    mcap = float(data.get("marketCap", 0))
    
    # Calculate liquidity ratio
    liq_ratio = (liq_usd / mcap * 100) if mcap > 0 else 0
    
    liq_text = f"""💧 *$EMO Liquidity Info* 💧

💵 *Total Liquidity:* {format_number(liq_usd)}
📊 *Market Cap:* {format_number(mcap)}
📈 *Liq/MCap Ratio:* {liq_ratio:.1f}%

*━━━ Pool Breakdown ━━━*
🪙 *Base:* {liq_base:,.0f} tokens
💎 *Quote:* {liq_quote:,.2f} MON

🔗 [View Pair](https://monadexplorer.com/address/{PAIR_ADDRESS})

_i lost it all on day 1_"""
    
    await update.message.reply_text(liq_text, parse_mode="Markdown")

async def burn_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show burned tokens info"""
    user = update.effective_user
    add_user_points(user.id, user.username or user.first_name)
    
    # Check burn address balance
    burn_addr = "0x0000000000000000000000000000000000000000"
    
    try:
        async with aiohttp.ClientSession() as session:
            balance_call = "0x70a08231" + burn_addr[2:].zfill(64)
            async with session.post(MONAD_RPC, json={
                "jsonrpc": "2.0",
                "method": "eth_call",
                "params": [{"to": TOKEN_ADDRESS, "data": balance_call}, "latest"],
                "id": 1
            }) as resp:
                result = await resp.json()
                burned = int(result.get("result", "0x0"), 16) / 1e18
        
        data = await fetch_price_data()
        price = float(data.get("priceUsd", 0)) if data else 0
        burned_usd = burned * price
        
        await update.message.reply_text(
            f"🔥 *$EMO Burn Info* 🔥\n\n"
            f"💀 *Burned:* {burned:,.0f} $EMO\n"
            f"💵 *Value:* {format_number(burned_usd)}\n\n"
            f"_Tokens sent to 0x000...000 are burned forever_",
            parse_mode="Markdown"
        )
    except:
        await update.message.reply_text("❌ Couldn't fetch burn data.")

async def compare_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Compare $EMO to other Monad tokens: /compare or /compare <token_address>"""
    user = update.effective_user
    add_user_points(user.id, user.username or user.first_name)
    
    # Fetch $EMO data
    emo_data = await fetch_price_data()
    if not emo_data:
        await update.message.reply_text("❌ Couldn't fetch $EMO data.")
        return
    
    # Check if comparing with another token
    other_data = None
    other_symbol = None
    if context.args:
        other_token = context.args[0]
        if other_token.startswith("0x") and len(other_token) == 42:
            await update.message.reply_text("🔍 Fetching comparison data...")
            try:
                async with aiohttp.ClientSession() as session:
                    # Try to fetch the other token's data from DEXScreener
                    async with session.get(f"https://api.dexscreener.com/latest/dex/tokens/{other_token}") as resp:
                        if resp.status == 200:
                            result = await resp.json()
                            pairs = result.get("pairs", [])
                            if pairs:
                                # Get the most liquid pair
                                other_data = max(pairs, key=lambda x: float(x.get("liquidity", {}).get("usd", 0) or 0))
                                other_symbol = other_data.get("baseToken", {}).get("symbol", "TOKEN")
            except Exception as e:
                print(f"Error fetching comparison token: {e}")
        
        if not other_data:
            await update.message.reply_text(
                "❌ Couldn't find that token. Make sure it's a valid Monad token address.\n\n"
                "Usage: `/compare <token_address>`",
                parse_mode="Markdown"
            )
            return
    
    # $EMO metrics
    emo_mcap = float(emo_data.get("marketCap", 0))
    emo_volume = float(emo_data.get("volume", {}).get("h24", 0))
    emo_liquidity = float(emo_data.get("liquidity", {}).get("usd", 0))
    emo_change_24h = float(emo_data.get("priceChange", {}).get("h24", 0))
    emo_price = float(emo_data.get("priceUsd", 0))
    emo_vol_ratio = (emo_volume / emo_mcap * 100) if emo_mcap > 0 else 0
    emo_liq_ratio = (emo_liquidity / emo_mcap * 100) if emo_mcap > 0 else 0
    
    if other_data:
        # Comparison mode
        other_mcap = float(other_data.get("marketCap", 0) or 0)
        other_volume = float(other_data.get("volume", {}).get("h24", 0))
        other_liquidity = float(other_data.get("liquidity", {}).get("usd", 0))
        other_change_24h = float(other_data.get("priceChange", {}).get("h24", 0))
        other_price = float(other_data.get("priceUsd", 0))
        other_vol_ratio = (other_volume / other_mcap * 100) if other_mcap > 0 else 0
        other_liq_ratio = (other_liquidity / other_mcap * 100) if other_mcap > 0 else 0
        
        # Determine winners
        def winner(emo_val, other_val, higher_better=True):
            if higher_better:
                return "🏆" if emo_val > other_val else "  "
            return "🏆" if emo_val < other_val else "  "
        
        compare_text = f"""📊 *$EMO vs ${other_symbol} Comparison* 📊

*━━━ Market Cap ━━━*
{winner(emo_mcap, other_mcap)} *$EMO:* {format_number(emo_mcap)}
{winner(other_mcap, emo_mcap)} *${other_symbol}:* {format_number(other_mcap)}

*━━━ 24h Volume ━━━*
{winner(emo_volume, other_volume)} *$EMO:* {format_number(emo_volume)}
{winner(other_volume, emo_volume)} *${other_symbol}:* {format_number(other_volume)}

*━━━ Liquidity ━━━*
{winner(emo_liquidity, other_liquidity)} *$EMO:* {format_number(emo_liquidity)}
{winner(other_liquidity, emo_liquidity)} *${other_symbol}:* {format_number(other_liquidity)}

*━━━ Vol/MCap Ratio ━━━*
{winner(emo_vol_ratio, other_vol_ratio)} *$EMO:* {emo_vol_ratio:.1f}%
{winner(other_vol_ratio, emo_vol_ratio)} *${other_symbol}:* {other_vol_ratio:.1f}%

*━━━ 24h Change ━━━*
{winner(emo_change_24h, other_change_24h)} *$EMO:* {'🟢' if emo_change_24h >= 0 else '🔴'} {emo_change_24h:+.2f}%
{winner(other_change_24h, emo_change_24h)} *${other_symbol}:* {'🟢' if other_change_24h >= 0 else '🔴'} {other_change_24h:+.2f}%

_i lost it all on day 1_"""
    else:
        # Solo mode - just show $EMO metrics
        compare_text = f"""📊 *$EMO Metrics* 📊

*━━━ Key Ratios ━━━*
📈 *Vol/MCap:* {emo_vol_ratio:.1f}% ({'🔥 Hot' if emo_vol_ratio > 20 else '📊 Normal'})
💧 *Liq/MCap:* {emo_liq_ratio:.1f}%
{'🟢' if emo_change_24h >= 0 else '🔴'} *24h Change:* {emo_change_24h:+.2f}%

*━━━ Raw Numbers ━━━*
📊 *MCap:* {format_number(emo_mcap)}
📈 *24h Vol:* {format_number(emo_volume)}
💧 *Liquidity:* {format_number(emo_liquidity)}

💡 *Compare with another token:*
`/compare <token_address>`

_i lost it all on day 1_"""
    
    await update.message.reply_text(compare_text, parse_mode="Markdown")

async def setthreshold_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Set buy alert threshold: /setthreshold 100"""
    user = update.effective_user
    chat = update.effective_chat
    
    # Check if user is admin in groups
    if chat.type != "private":
        member = await chat.get_member(user.id)
        if member.status not in ["creator", "administrator"]:
            await update.message.reply_text("❌ Only admins can change the threshold!")
            return
    
    current_threshold = get_chat_threshold(chat.id)
    
    if not context.args:
        await update.message.reply_text(
            f"⚙️ *Buy Alert Threshold*\n\n"
            f"Current: *${current_threshold:.0f}*\n\n"
            f"Usage: `/setthreshold <amount>`\n\n"
            f"Examples:\n"
            f"`/setthreshold 0` - ALL buys\n"
            f"`/setthreshold 10` - $10+ buys\n"
            f"`/setthreshold 100` - $100+ buys\n"
            f"`/setthreshold 500` - $500+ buys (whales only)",
            parse_mode="Markdown"
        )
        return
    
    try:
        threshold = float(context.args[0])
        if threshold < 0:
            threshold = 0
    except ValueError:
        await update.message.reply_text("❌ Invalid amount. Use a number like `100`", parse_mode="Markdown")
        return
    
    set_bot_setting(chat.id, "buy_threshold", threshold)
    
    if threshold == 0:
        msg = "✅ *Threshold Set: ALL BUYS*\n\nEvery buy will trigger an alert!"
    else:
        msg = f"✅ *Threshold Set: ${threshold:.0f}+*\n\nOnly buys of ${threshold:.0f} or more will trigger alerts."
    
    await update.message.reply_text(msg, parse_mode="Markdown")

# --- buy alerts ---

class AlertMonitor:
    """Background monitor for price alerts and real-time buys via WebSocket"""
    def __init__(self, app: Application):
        self.app = app
        self.last_price = 0
        self.last_volume = 0
        self.running = False
        self.seen_txs = set()  # Track seen transactions to avoid duplicates
    
    async def check_price_alerts(self):
        """Check if any user price alerts should trigger"""
        try:
            data = await fetch_price_data()
            if not data:
                return
            
            current_price = float(data.get("priceUsd", 0))
            
            # Load all alerts
            alerts_data = load_json(PRICE_ALERTS_FILE)
            triggered = []
            
            for user_id, user_data in alerts_data.items():
                alerts_to_keep = []
                for alert in user_data.get("alerts", []):
                    target = alert["target_price"]
                    direction = alert["direction"]
                    recurring = alert.get("recurring", False)
                    last_triggered = alert.get("last_triggered")
                    
                    should_trigger = False
                    if direction == "above" and current_price >= target:
                        should_trigger = True
                    elif direction == "below" and current_price <= target:
                        should_trigger = True
                    
                    # For recurring alerts, check cooldown (5 min between triggers)
                    if should_trigger and recurring and last_triggered:
                        last_time = datetime.fromisoformat(last_triggered)
                        if (datetime.now() - last_time).total_seconds() < 300:
                            should_trigger = False  # Still in cooldown
                    
                    if should_trigger:
                        triggered.append((int(user_id), target, direction, current_price, recurring))
                        if recurring:
                            # Keep recurring alerts but update last_triggered
                            alert["last_triggered"] = datetime.now().isoformat()
                            # Flip direction for next trigger
                            alert["direction"] = "below" if direction == "above" else "above"
                            alerts_to_keep.append(alert)
                        # Non-recurring alerts are not kept (deleted after trigger)
                    else:
                        alerts_to_keep.append(alert)
                
                user_data["alerts"] = alerts_to_keep
            
            # Save updated alerts
            save_json(PRICE_ALERTS_FILE, alerts_data)
            
            # Send notifications for triggered alerts
            for user_id, target, direction, current, recurring in triggered:
                try:
                    emoji = "📈" if direction == "above" else "📉"
                    recurring_note = "\n🔄 _Recurring - will alert again when price crosses back_" if recurring else ""
                    await self.app.bot.send_message(
                        chat_id=user_id,
                        text=f"🚨 *Price Alert Triggered!* 🚨\n\n"
                             f"{emoji} Price {'rose above' if direction == 'above' else 'dropped below'} your target!\n\n"
                             f"🎯 *Target:* ${target:.10f}\n"
                             f"💵 *Current:* ${current:.10f}{recurring_note}\n\n"
                             f"_i lost it all on day 1_",
                        parse_mode="Markdown"
                    )
                except Exception as e:
                    print(f"Failed to send alert to {user_id}: {e}")
                    
        except Exception as e:
            print(f"Error checking price alerts: {e}")
    
    async def check_recent_swaps(self):
        """Check for recent swaps using Monad RPC eth_getLogs"""
        try:
            async with aiohttp.ClientSession() as session:
                # First, determine which token position $EMO is in the pair (token0 or token1)
                # Call token0() on the pair contract
                if not hasattr(self, 'emo_is_token0'):
                    try:
                        # token0() selector = 0x0dfe1681
                        async with session.post(MONAD_RPC, json={
                            "jsonrpc": "2.0",
                            "method": "eth_call",
                            "params": [{"to": PAIR_ADDRESS, "data": "0x0dfe1681"}, "latest"],
                            "id": 1
                        }) as resp:
                            result = await resp.json()
                            token0_addr = "0x" + result.get("result", "")[-40:].lower()
                            self.emo_is_token0 = token0_addr.lower() == TOKEN_ADDRESS.lower()
                            print(f"📊 Token position: $EMO is {'token0' if self.emo_is_token0 else 'token1'}")
                    except Exception as e:
                        print(f"Error getting token position: {e}")
                        self.emo_is_token0 = True  # Default assumption
                
                # Get latest block number
                async with session.post(MONAD_RPC, json={
                    "jsonrpc": "2.0",
                    "method": "eth_blockNumber",
                    "params": [],
                    "id": 2
                }) as resp:
                    if resp.status != 200:
                        return
                    text = await resp.text()
                    if not text.startswith('{'):
                        return
                    import json
                    result = json.loads(text)
                    current_block = int(result.get("result", "0x0"), 16)
                
                # Look back ~30 seconds worth of blocks (Monad is fast, ~1 block/sec)
                from_block = hex(max(0, current_block - 30))
                to_block = hex(current_block)
                
                # Get swap logs from the pair contract
                async with session.post(MONAD_RPC, json={
                    "jsonrpc": "2.0",
                    "method": "eth_getLogs",
                    "params": [{
                        "fromBlock": from_block,
                        "toBlock": to_block,
                        "address": PAIR_ADDRESS,
                        "topics": [SWAP_TOPIC]
                    }],
                    "id": 3
                }) as resp:
                    if resp.status != 200:
                        return
                    text = await resp.text()
                    if not text.startswith('{'):
                        return
                    result = json.loads(text)
                    logs = result.get("result", [])
                    
                    if logs:
                        print(f"🔍 Found {len(logs)} swap logs in blocks {from_block} to {to_block}")
                    
                    for log in logs:
                        tx_hash = log.get("transactionHash", "")
                        if tx_hash in self.seen_txs:
                            continue
                        self.seen_txs.add(tx_hash)
                        
                        # Keep seen_txs from growing too large
                        if len(self.seen_txs) > 1000:
                            self.seen_txs = set(list(self.seen_txs)[-500:])
                        
                        # Parse swap data
                        data_hex = log.get("data", "0x")
                        if len(data_hex) >= 258:  # Full swap data
                            # Decode amounts (each is 32 bytes = 64 hex chars)
                            # Swap event: amount0In, amount1In, amount0Out, amount1Out
                            amount0In = int(data_hex[2:66], 16)
                            amount1In = int(data_hex[66:130], 16)
                            amount0Out = int(data_hex[130:194], 16)
                            amount1Out = int(data_hex[194:258], 16)
                            
                            # Get current price
                            price_data = await fetch_price_data()
                            if price_data:
                                current_price = float(price_data.get("priceUsd", 0))
                                
                                # Get trader address from topics (last topic is 'to' address)
                                topics = log.get("topics", [])
                                trader = "0x" + topics[-1][-40:] if len(topics) > 2 else None
                                
                                # Determine buy vs sell based on token position
                                # BUY = $EMO going OUT (user receives $EMO)
                                # SELL = $EMO going IN (user sends $EMO)
                                if self.emo_is_token0:
                                    emo_out = amount0Out
                                    emo_in = amount0In
                                else:
                                    emo_out = amount1Out
                                    emo_in = amount1In
                                
                                if emo_out > 0 and emo_in == 0:
                                    # BUY: User received $EMO
                                    token_amount = emo_out / 1e18
                                    usd_value = token_amount * current_price
                                    print(f"🔔 BUY detected: {token_amount:,.0f} $EMO (~${usd_value:.2f}) | TX: {tx_hash[:10]}...")
                                    await self.send_buy_bot_alert(usd_value, current_price, tx_hash, trader)
                                elif emo_in > 0 and emo_out == 0:
                                    # SELL: User sent $EMO
                                    token_amount = emo_in / 1e18
                                    usd_value = token_amount * current_price
                                    print(f"📉 SELL detected: {token_amount:,.0f} $EMO (~${usd_value:.2f}) | TX: {tx_hash[:10]}...")
                                    await self.send_sell_bot_alert(usd_value, current_price, tx_hash, trader)
                                elif emo_out > 0 and emo_in > 0:
                                    # Complex swap - net direction
                                    if emo_out > emo_in:
                                        token_amount = (emo_out - emo_in) / 1e18
                                        usd_value = token_amount * current_price
                                        await self.send_buy_bot_alert(usd_value, current_price, tx_hash, trader)
                                    else:
                                        token_amount = (emo_in - emo_out) / 1e18
                                        usd_value = token_amount * current_price
                                        await self.send_sell_bot_alert(usd_value, current_price, tx_hash, trader)
                                    
        except Exception as e:
            print(f"Error checking swaps: {e}")
    
    async def send_buy_bot_alert(self, amount_usd: float, current_price: float, tx_hash: str = None, buyer: str = None):
        """Send buy alert with GIF to all enabled chats"""
        # Get all chats with buy bot enabled
        settings_data = load_json(BOT_SETTINGS_FILE)
        
        # Fetch full data for bullish metrics
        data = await fetch_price_data()
        
        # Determine emoji based on buy size
        if amount_usd >= 5000:
            emoji = "🐋🐋🐋"
            title = "MEGA WHALE"
        elif amount_usd >= 2000:
            emoji = "🐋🐋"
            title = "WHALE BUY"
        elif amount_usd >= 1000:
            emoji = "🐋"
            title = "BIG BUY"
        else:
            emoji = "💰"
            title = "NEW BUY"
        
        # Get bullish metrics from DEXScreener
        mcap = format_number(float(data.get("marketCap", 0))) if data and data.get("marketCap") else "N/A"
        liquidity = format_number(float(data.get("liquidity", {}).get("usd", 0))) if data and data.get("liquidity") else "N/A"
        volume_24h = format_number(float(data.get("volume", {}).get("h24", 0))) if data else "N/A"
        
        # Price changes
        change_1h = float(data.get("priceChange", {}).get("h1", 0)) if data else 0
        change_24h = float(data.get("priceChange", {}).get("h24", 0)) if data else 0
        
        # Transaction counts
        txns = data.get("txns", {}) if data else {}
        buys_1h = txns.get("h1", {}).get("buys", 0)
        sells_1h = txns.get("h1", {}).get("sells", 0)
        buys_24h = txns.get("h24", {}).get("buys", 0)
        
        # Buy/sell ratio
        ratio = buys_1h / sells_1h if sells_1h > 0 else buys_1h
        ratio_emoji = "🟢" if ratio >= 1 else "🔴"
        
        # Price change emojis
        emoji_1h = "🟢" if change_1h >= 0 else "🔴"
        emoji_24h = "🟢" if change_24h >= 0 else "🔴"
        
        # Fetch buyer wallet info if available
        buyer_info = ""
        buyer_balance_info = ""
        buyer_link = ""
        new_holder_badge = ""
        rank_info = ""
        
        if buyer and len(buyer) >= 10:
            buyer_link = f"https://monadexplorer.com/address/{buyer}"
            buyer_info = f"\n👤 *Buyer:* `{buyer}`\n🔗 [View on Monad Vision]({buyer_link})"
            
            # Check if new holder
            is_new = await check_if_new_holder(buyer)
            if is_new:
                new_holder_badge = "\n🆕 *NEW HOLDER!*"
            
            # Get holder rank
            rank = await get_holder_rank(buyer)
            if rank > 0:
                rank_info = f"\n🏆 *Rank:* #{rank} holder"
            
            # Try to get buyer's token balance
            try:
                async with aiohttp.ClientSession() as session:
                    # Get buyer's MON balance
                    async with session.post(MONAD_RPC, json={
                        "jsonrpc": "2.0",
                        "method": "eth_getBalance",
                        "params": [buyer, "latest"],
                        "id": 1
                    }) as resp:
                        result = await resp.json()
                        mon_balance = int(result.get("result", "0x0"), 16) / 1e18
                    
                    # Get buyer's token balance
                    balance_call = "0x70a08231" + buyer[2:].zfill(64)  # balanceOf(address)
                    async with session.post(MONAD_RPC, json={
                        "jsonrpc": "2.0",
                        "method": "eth_call",
                        "params": [{"to": TOKEN_ADDRESS, "data": balance_call}, "latest"],
                        "id": 2
                    }) as resp:
                        result = await resp.json()
                        token_balance = int(result.get("result", "0x0"), 16) / 1e18
                        token_usd = token_balance * current_price
                    
                    buyer_balance_info = f"\n💎 *Wallet:* {mon_balance:.2f} MON | {format_number(token_usd)} $EMO"
            except Exception as e:
                print(f"Error fetching buyer balance: {e}")
        
        # Build tx link if available
        tx_info = ""
        if tx_hash:
            tx_info = f"\n🔗 [View TX](https://monadexplorer.com/tx/{tx_hash})"
        
        alert_text = f"""{emoji} *{title}* {emoji}{new_holder_badge}

💵 *Buy:* ~{format_number(amount_usd)}{buyer_info}{buyer_balance_info}{rank_info}{tx_info}
💰 *Price:* ${current_price:.10f}

*━━━ Market Stats ━━━*
📊 *MCap:* {mcap}
💧 *Liquidity:* {liquidity}
📈 *24h Vol:* {volume_24h}

*━━━ Price Action ━━━*
{emoji_1h} *1h:* {change_1h:+.2f}%
{emoji_24h} *24h:* {change_24h:+.2f}%

*━━━ Activity ━━━*
🟢 *Buys 1h:* {buys_1h} | 🔴 *Sells:* {sells_1h}
{ratio_emoji} *Ratio:* {ratio:.1f}x
🔥 *24h Buys:* {buys_24h}

🖤 *$EMO* - _i lost it all on day 1_"""
        
        # Add buyer wallet button if available
        if buyer and len(buyer) >= 10:
            keyboard = [[
                InlineKeyboardButton("👤 Buyer", url=buyer_link),
                InlineKeyboardButton("📊 Chart", url=DEXSCREENER_CHART),
                InlineKeyboardButton("💰 Buy", url=f"https://app.uniswap.org/swap?chain=monad&outputCurrency={TOKEN_ADDRESS}")
            ]]
        else:
            keyboard = [[
                InlineKeyboardButton("📊 Chart", url=DEXSCREENER_CHART),
                InlineKeyboardButton("💰 Buy", url=f"https://app.uniswap.org/swap?chain=monad&outputCurrency={TOKEN_ADDRESS}")
            ]]
        reply_markup = InlineKeyboardMarkup(keyboard)
        
        for chat_id, settings in settings_data.items():
            if settings.get("buy_bot_enabled", False):
                # Check per-chat threshold
                chat_threshold = settings.get("buy_threshold", DEFAULT_BUY_THRESHOLD)
                if amount_usd < chat_threshold:
                    continue  # Skip this chat, buy too small
                
                try:
                    # Send GIF with caption
                    if BUY_BOT_GIF.exists():
                        with open(BUY_BOT_GIF, 'rb') as gif:
                            await self.app.bot.send_animation(
                                chat_id=int(chat_id),
                                animation=gif,
                                caption=alert_text,
                                parse_mode="Markdown",
                                reply_markup=reply_markup
                            )
                    else:
                        await self.app.bot.send_message(
                            chat_id=int(chat_id),
                            text=alert_text,
                            parse_mode="Markdown",
                            reply_markup=reply_markup
                        )
                except Exception as e:
                    print(f"Failed to send buy alert to {chat_id}: {e}")
    
    async def send_sell_bot_alert(self, amount_usd: float, current_price: float, tx_hash: str = None, seller: str = None):
        """Send sell alert with GIF to all enabled chats"""
        settings_data = load_json(BOT_SETTINGS_FILE)
        
        # Fetch data for metrics
        data = await fetch_price_data()
        
        # Determine emoji based on sell size
        if amount_usd >= 5000:
            emoji = "🔴🔴🔴"
            title = "MEGA DUMP"
        elif amount_usd >= 2000:
            emoji = "🔴🔴"
            title = "BIG SELL"
        elif amount_usd >= 1000:
            emoji = "🔴"
            title = "SELL"
        else:
            emoji = "📉"
            title = "SELL"
        
        # Get metrics
        mcap = format_number(float(data.get("marketCap", 0))) if data and data.get("marketCap") else "N/A"
        liquidity = format_number(float(data.get("liquidity", {}).get("usd", 0))) if data and data.get("liquidity") else "N/A"
        
        # Seller info
        seller_info = ""
        seller_link = ""
        if seller and len(seller) >= 10:
            seller_link = f"https://monadexplorer.com/address/{seller}"
            seller_info = f"\n👤 *Seller:* `{seller}`\n🔗 [View on Monad Vision]({seller_link})"
            
            # Get seller's remaining balance
            try:
                async with aiohttp.ClientSession() as session:
                    balance_call = "0x70a08231" + seller[2:].zfill(64)
                    async with session.post(MONAD_RPC, json={
                        "jsonrpc": "2.0",
                        "method": "eth_call",
                        "params": [{"to": TOKEN_ADDRESS, "data": balance_call}, "latest"],
                        "id": 1
                    }) as resp:
                        result = await resp.json()
                        remaining = int(result.get("result", "0x0"), 16) / 1e18
                        remaining_usd = remaining * current_price
                        seller_info += f"\n💎 *Remaining:* {format_number(remaining_usd)} $EMO"
            except:
                pass
        
        tx_info = ""
        if tx_hash:
            tx_info = f"\n🔗 [View TX](https://monadexplorer.com/tx/{tx_hash})"
        
        alert_text = f"""{emoji} *{title}* {emoji}

💵 *Sold:* ~{format_number(amount_usd)}{seller_info}{tx_info}
💰 *Price:* ${current_price:.10f}

📊 *MCap:* {mcap}
💧 *Liquidity:* {liquidity}

🖤 *$EMO* - _i lost it all on day 1_"""
        
        # Buttons
        if seller and len(seller) >= 10:
            keyboard = [[
                InlineKeyboardButton("👤 Seller", url=seller_link),
                InlineKeyboardButton("📊 Chart", url=DEXSCREENER_CHART),
                InlineKeyboardButton("💰 Buy Dip", url=f"https://app.uniswap.org/swap?chain=monad&outputCurrency={TOKEN_ADDRESS}")
            ]]
        else:
            keyboard = [[
                InlineKeyboardButton("📊 Chart", url=DEXSCREENER_CHART),
                InlineKeyboardButton("💰 Buy Dip", url=f"https://app.uniswap.org/swap?chain=monad&outputCurrency={TOKEN_ADDRESS}")
            ]]
        reply_markup = InlineKeyboardMarkup(keyboard)
        
        for chat_id, settings in settings_data.items():
            if settings.get("sell_bot_enabled", False):
                chat_threshold = settings.get("buy_threshold", DEFAULT_BUY_THRESHOLD)
                if amount_usd < chat_threshold:
                    continue
                
                try:
                    if SELL_BOT_GIF.exists():
                        with open(SELL_BOT_GIF, 'rb') as gif:
                            await self.app.bot.send_animation(
                                chat_id=int(chat_id),
                                animation=gif,
                                caption=alert_text,
                                parse_mode="Markdown",
                                reply_markup=reply_markup
                            )
                    else:
                        await self.app.bot.send_message(
                            chat_id=int(chat_id),
                            text=alert_text,
                            parse_mode="Markdown",
                            reply_markup=reply_markup
                        )
                except Exception as e:
                    print(f"Failed to send sell alert to {chat_id}: {e}")
    
    async def start_monitoring(self):
        """Start the monitoring loop"""
        self.running = True
        print("🔍 Alert monitoring started (real-time swap detection)...")
        
        while self.running:
            await self.check_price_alerts()
            await self.check_recent_swaps()  # Real-time swap detection via RPC
            await asyncio.sleep(5)  # Check every 5 seconds for faster detection
    
    def stop_monitoring(self):
        """Stop the monitoring loop"""
        self.running = False

# Background task starter
async def start_background_tasks(app: Application):
    """Start background monitoring tasks and register commands"""
    # Register commands for autocomplete
    commands = [
        BotCommand("start", "Welcome message"),
        BotCommand("price", "Full price stats"),
        BotCommand("meme", "Random emo meme"),
        BotCommand("holders", "Holder stats & top holders"),
        BotCommand("ca", "Contract address"),
        BotCommand("pnl", "Check wallet P&L"),
        BotCommand("liquidity", "Detailed LP info"),
        BotCommand("gas", "Current Monad gas"),
        BotCommand("burn", "Burned tokens"),
        BotCommand("compare", "Key metrics"),
        BotCommand("alert", "Set price alert"),
        BotCommand("alerts", "View your alerts"),
        BotCommand("delalert", "Remove an alert"),
        BotCommand("tracker", "Track a wallet"),
        BotCommand("tracked", "View tracked wallets"),
        BotCommand("untrack", "Stop tracking"),
        BotCommand("leaderboard", "Top users by cuts"),
        BotCommand("mycuts", "Your cut points"),
        BotCommand("boton", "Enable buy alerts"),
        BotCommand("botoff", "Disable buy alerts"),
        BotCommand("sellson", "Enable sell alerts"),
        BotCommand("sellsoff", "Disable sell alerts"),
        BotCommand("setthreshold", "Set min buy amount"),
        BotCommand("help", "All commands"),
    ]
    await app.bot.set_my_commands(commands)
    print("✅ Commands registered for autocomplete")
    
    # Start monitoring
    monitor = AlertMonitor(app)
    asyncio.create_task(monitor.start_monitoring())

# --- main ---

def main():
    """Start the bot"""
    if BOT_TOKEN == "YOUR_BOT_TOKEN_HERE":
        print("❌ Please set your BOT_TOKEN in the environment or config!")
        print("   Get one from @BotFather on Telegram")
        return
    
    print("🖤 Starting $EMO Bot...")
    
    # Create application
    app = Application.builder().token(BOT_TOKEN).build()
    
    # Add command handlers
    app.add_handler(CommandHandler("start", start_command))
    app.add_handler(CommandHandler("price", price_command))
    app.add_handler(CommandHandler("meme", meme_command))
    app.add_handler(CommandHandler("holders", holders_command))
    app.add_handler(CommandHandler("alert", alert_command))
    app.add_handler(CommandHandler("alerts", alerts_command))
    app.add_handler(CommandHandler("delalert", delalert_command))
    app.add_handler(CommandHandler("leaderboard", leaderboard_command))
    app.add_handler(CommandHandler("mycuts", mycuts_command))
    app.add_handler(CommandHandler("tracker", tracker_command))
    app.add_handler(CommandHandler("tracked", tracked_command))
    app.add_handler(CommandHandler("untrack", untrack_command))
    app.add_handler(CommandHandler("help", help_command))
    app.add_handler(CommandHandler("boton", boton_command))
    app.add_handler(CommandHandler("botoff", botoff_command))
    app.add_handler(CommandHandler("sellson", sellson_command))
    app.add_handler(CommandHandler("sellsoff", sellsoff_command))
    app.add_handler(CommandHandler("setthreshold", setthreshold_command))
    app.add_handler(CommandHandler("pnl", pnl_command))
    app.add_handler(CommandHandler("ca", ca_command))
    app.add_handler(CommandHandler("gas", gas_command))
    app.add_handler(CommandHandler("liquidity", liquidity_command))
    app.add_handler(CommandHandler("burn", burn_command))
    app.add_handler(CommandHandler("compare", compare_command))
    
    # Add post-init callback for background tasks
    app.post_init = start_background_tasks
    
    print("✅ Bot is running!")
    print("Commands: /start, /price, /meme, /holders, /alert, /pnl, /ca, /gas, /liquidity, /burn, /compare, /boton, /sellson")
    
    # Start polling
    app.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    main()

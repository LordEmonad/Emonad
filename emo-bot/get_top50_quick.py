import aiohttp
import asyncio
import pandas as pd

TOKEN_ADDRESS = "0x81A224F8A62f52BdE942dBF23A56df77A10b7777"
MONAD_RPC = "https://rpc.monad.xyz"

# Known large holders from previous scans + common addresses
KNOWN_WALLETS = [
    "0xb0baace23ac7cbd25211134a0b47ad70a9d42fa4",
    "0xf271294cf8864ea9facf52e47e01efa7e64ea4f1",
    "0x3e1a89adb6a503e35407c19890d209921c000b7e",
    "0xc55786cae6a835515eadeba041b08527b718ec5e",
    "0xe6875d9b9ace2c3672ac610b967c5874e52b1b7e",
    "0x2178d68c4ec6b19b66f78c6db610994e973b8130",
    "0xdf5e90e0b87671cdb9773696ef36ea32569465fd",
    "0x93cdcd850b81d405291a099899810284c6faade8",
    "0x310e989c73b58591bb61596972b5019354f8b668",
    "0x1ccd30e5360552118048a9e88cb0f14a24c92015",
    "0xf70da97812cb96acdf810712aa562db8dfa3dbef",  # whale
    "0xf9e9d488adc848fefc5eff30d450fb60922c9e28",  # keone
    "0xf8baf2541defab76f2c344ff10cd6d4ef74d3432",  # james
    "0x714a2694c8d4f0b1bfba0e5b76240e439df2182d",  # pair contract
]

async def get_balance(session, wallet):
    balance_call = "0x70a08231" + wallet[2:].lower().zfill(64)
    try:
        async with session.post(MONAD_RPC, json={
            "jsonrpc": "2.0",
            "method": "eth_call",
            "params": [{"to": TOKEN_ADDRESS, "data": balance_call}, "latest"],
            "id": 1
        }, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            result = await resp.json()
            return int(result.get("result", "0x0"), 16) / 1e18
    except:
        return 0

async def get_current_block(session):
    async with session.post(MONAD_RPC, json={
        "jsonrpc": "2.0",
        "method": "eth_blockNumber",
        "params": [],
        "id": 1
    }) as resp:
        result = await resp.json()
        return int(result.get("result", "0x0"), 16)

async def scan_transfers_fast(session, from_block, to_block):
    """Scan transfer events"""
    try:
        async with session.post(MONAD_RPC, json={
            "jsonrpc": "2.0",
            "method": "eth_getLogs",
            "params": [{
                "fromBlock": hex(from_block),
                "toBlock": hex(to_block),
                "address": TOKEN_ADDRESS,
                "topics": ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"]
            }],
            "id": 1
        }, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            result = await resp.json()
            return result.get("result", [])
    except:
        return []

async def main():
    print("🔍 Quick scan for top $EMO holders...")
    
    async with aiohttp.ClientSession() as session:
        current_block = await get_current_block(session)
        
        # Collect wallets from recent transfers
        wallets = set(KNOWN_WALLETS)
        
        # Scan last 200k blocks quickly
        start_block = current_block - 200000
        chunk_size = 100
        
        print(f"Scanning last 200k blocks for wallet addresses...")
        
        for from_block in range(start_block, current_block, chunk_size):
            to_block = min(from_block + chunk_size - 1, current_block)
            logs = await scan_transfers_fast(session, from_block, to_block)
            
            if isinstance(logs, list):
                for log in logs:
                    topics = log.get("topics", [])
                    if len(topics) >= 3:
                        wallets.add("0x" + topics[1][-40:].lower())
                        wallets.add("0x" + topics[2][-40:].lower())
            
            if (from_block - start_block) % 20000 == 0:
                pct = (from_block - start_block) / 200000 * 100
                print(f"Progress: {pct:.0f}% - {len(wallets)} wallets")
        
        wallets.discard("0x0000000000000000000000000000000000000000")
        print(f"\n✅ Found {len(wallets)} wallets to check")
        
        # Get all balances
        print("📊 Fetching balances...")
        wallet_balances = {}
        wallet_list = list(wallets)
        
        for i, wallet in enumerate(wallet_list):
            balance = await get_balance(session, wallet)
            if balance > 0:
                wallet_balances[wallet] = balance
            
            if i % 50 == 0:
                print(f"Checked {i}/{len(wallet_list)}, {len(wallet_balances)} with balance")
        
        # Sort and get top 50
        sorted_wallets = sorted(wallet_balances.items(), key=lambda x: x[1], reverse=True)[:50]
        
        print(f"\n✅ Found {len(wallet_balances)} holders, top 50 selected")
        
        # Create DataFrame
        df = pd.DataFrame(sorted_wallets, columns=["Wallet Address", "Balance"])
        df.index = range(1, len(df) + 1)
        df.index.name = "Rank"
        
        # Save to Excel
        output_file = "emo_top_50_holders.xlsx"
        df.to_excel(output_file)
        print(f"\n✅ Saved to {output_file}")
        print("\nTop 50 Holders:")
        print(df.to_string())

if __name__ == "__main__":
    asyncio.run(main())

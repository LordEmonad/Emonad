import aiohttp
import asyncio
import pandas as pd
from collections import defaultdict

TOKEN_ADDRESS = "0x81A224F8A62f52BdE942dBF23A56df77A10b7777"
MONAD_RPC = "https://rpc.monad.xyz"
TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

async def get_current_block(session):
    async with session.post(MONAD_RPC, json={
        "jsonrpc": "2.0",
        "method": "eth_blockNumber",
        "params": [],
        "id": 1
    }) as resp:
        result = await resp.json()
        return int(result.get("result", "0x0"), 16)

async def get_balance(session, wallet):
    """Get current token balance for a wallet"""
    balance_call = "0x70a08231" + wallet[2:].lower().zfill(64)
    async with session.post(MONAD_RPC, json={
        "jsonrpc": "2.0",
        "method": "eth_call",
        "params": [{"to": TOKEN_ADDRESS, "data": balance_call}, "latest"],
        "id": 1
    }) as resp:
        result = await resp.json()
        return int(result.get("result", "0x0"), 16) / 1e18

async def scan_transfers(session, from_block, to_block):
    """Scan transfer events in a block range"""
    async with session.post(MONAD_RPC, json={
        "jsonrpc": "2.0",
        "method": "eth_getLogs",
        "params": [{
            "fromBlock": hex(from_block),
            "toBlock": hex(to_block),
            "address": TOKEN_ADDRESS,
            "topics": [TRANSFER_TOPIC]
        }],
        "id": 1
    }) as resp:
        result = await resp.json()
        return result.get("result", [])

async def main():
    print("🔍 Scanning for $EMO token holders...")
    
    async with aiohttp.ClientSession() as session:
        current_block = await get_current_block(session)
        print(f"Current block: {current_block}")
        
        # Track all wallets that have interacted with the token
        wallets = set()
        
        # Scan last 500k blocks (about 5-6 days on Monad)
        start_block = max(current_block - 500000, 37742006)  # Token creation block
        chunk_size = 100
        
        print(f"Scanning from block {start_block} to {current_block}...")
        
        for from_block in range(start_block, current_block, chunk_size):
            to_block = min(from_block + chunk_size - 1, current_block)
            
            try:
                logs = await scan_transfers(session, from_block, to_block)
                if isinstance(logs, list):
                    for log in logs:
                        topics = log.get("topics", [])
                        if len(topics) >= 3:
                            # Extract from and to addresses
                            from_addr = "0x" + topics[1][-40:]
                            to_addr = "0x" + topics[2][-40:]
                            wallets.add(from_addr.lower())
                            wallets.add(to_addr.lower())
            except Exception as e:
                print(f"Error at block {from_block}: {e}")
                await asyncio.sleep(0.2)
                continue
            
            # Progress update
            if (from_block - start_block) % 10000 == 0:
                progress = (from_block - start_block) / (current_block - start_block) * 100
                print(f"Progress: {progress:.1f}% - Found {len(wallets)} unique wallets")
            
            # Rate limiting
            if (from_block - start_block) % 500 == 0:
                await asyncio.sleep(0.05)
        
        print(f"\n✅ Found {len(wallets)} unique wallets")
        print("📊 Fetching current balances for all wallets...")
        
        # Get balances for all wallets
        wallet_balances = {}
        count = 0
        for wallet in wallets:
            try:
                balance = await get_balance(session, wallet)
                if balance > 0:
                    wallet_balances[wallet] = balance
                count += 1
                if count % 100 == 0:
                    print(f"Checked {count}/{len(wallets)} wallets, {len(wallet_balances)} with balance")
                    await asyncio.sleep(0.05)
            except Exception as e:
                continue
        
        print(f"\n✅ Found {len(wallet_balances)} wallets with balance")
        
        # Sort by balance and get top 50
        sorted_wallets = sorted(wallet_balances.items(), key=lambda x: x[1], reverse=True)[:50]
        
        # Create DataFrame
        df = pd.DataFrame(sorted_wallets, columns=["Wallet Address", "Balance"])
        df.index = range(1, len(df) + 1)
        df.index.name = "Rank"
        df["Balance"] = df["Balance"].apply(lambda x: f"{x:,.0f}")
        
        # Save to Excel
        output_file = "emo_top_50_holders.xlsx"
        df.to_excel(output_file)
        print(f"\n✅ Saved to {output_file}")
        print("\nTop 10 Preview:")
        print(df.head(10))

if __name__ == "__main__":
    asyncio.run(main())

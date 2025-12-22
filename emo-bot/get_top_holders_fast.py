import aiohttp
import asyncio
import pandas as pd

TOKEN_ADDRESS = "0x81A224F8A62f52BdE942dBF23A56df77A10b7777"
MONAD_RPC = "https://rpc.monad.xyz"
TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

async def get_balance(session, wallet):
    """Get current token balance for a wallet"""
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

async def scan_chunk(session, from_block, to_block):
    """Scan transfer events in a block range"""
    try:
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
        }, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            result = await resp.json()
            return result.get("result", [])
    except:
        return []

async def main():
    print("🔍 Fast scan for $EMO token holders...")
    
    async with aiohttp.ClientSession() as session:
        current_block = await get_current_block(session)
        print(f"Current block: {current_block}")
        
        wallets = set()
        
        # Scan last 100k blocks only (faster)
        start_block = current_block - 100000
        chunk_size = 100
        total_chunks = (current_block - start_block) // chunk_size
        
        print(f"Scanning {total_chunks} chunks...")
        
        for i, from_block in enumerate(range(start_block, current_block, chunk_size)):
            to_block = min(from_block + chunk_size - 1, current_block)
            
            logs = await scan_chunk(session, from_block, to_block)
            if isinstance(logs, list):
                for log in logs:
                    topics = log.get("topics", [])
                    if len(topics) >= 3:
                        from_addr = "0x" + topics[1][-40:]
                        to_addr = "0x" + topics[2][-40:]
                        wallets.add(from_addr.lower())
                        wallets.add(to_addr.lower())
            
            if i % 100 == 0:
                print(f"Progress: {i}/{total_chunks} chunks, {len(wallets)} wallets found")
        
        # Remove zero address
        wallets.discard("0x0000000000000000000000000000000000000000")
        
        print(f"\n✅ Found {len(wallets)} unique wallets")
        print("📊 Fetching balances (this is the slow part)...")
        
        # Get balances in batches
        wallet_list = list(wallets)
        wallet_balances = {}
        batch_size = 10
        
        for i in range(0, len(wallet_list), batch_size):
            batch = wallet_list[i:i+batch_size]
            tasks = [get_balance(session, w) for w in batch]
            balances = await asyncio.gather(*tasks)
            
            for wallet, balance in zip(batch, balances):
                if balance > 0:
                    wallet_balances[wallet] = balance
            
            if i % 50 == 0:
                print(f"Checked {i}/{len(wallet_list)} wallets, {len(wallet_balances)} with balance")
        
        print(f"\n✅ Found {len(wallet_balances)} wallets with balance")
        
        # Sort and get top 50
        sorted_wallets = sorted(wallet_balances.items(), key=lambda x: x[1], reverse=True)[:50]
        
        # Create DataFrame
        df = pd.DataFrame(sorted_wallets, columns=["Wallet Address", "Balance"])
        df.index = range(1, len(df) + 1)
        df.index.name = "Rank"
        
        # Save to Excel
        output_file = "emo_top_50_holders.xlsx"
        df.to_excel(output_file)
        print(f"\n✅ Saved to {output_file}")
        print("\nTop 10 Preview:")
        print(df.head(10).to_string())

if __name__ == "__main__":
    asyncio.run(main())

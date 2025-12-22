import aiohttp
import asyncio

async def test():
    async with aiohttp.ClientSession() as s:
        async with s.post("https://rpc.monad.xyz", json={"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}) as r:
            d = await r.json()
            print("✅ Monad RPC Block:", int(d["result"], 16))

asyncio.run(test())

"""
Monad Token Holder Snapshot Tool
================================
Get top holders of any Monad meme coin using BlockVision API.

Usage:
    python monad_snapshot.py <token_address> [--top N] [--output filename]

Examples:
    python monad_snapshot.py 0x81A224F8A62f52BdE942dBF23A56df77A10b7777
    python monad_snapshot.py 0x81A224F8A62f52BdE942dBF23A56df77A10b7777 --top 100
    python monad_snapshot.py 0x81A224F8A62f52BdE942dBF23A56df77A10b7777 --top 50 --output emo_holders.csv
"""

import requests
import json
import csv
import argparse
from datetime import datetime

# BlockVision API Configuration
API_KEY = "REDACTED_API_KEY"
BASE_URL = "https://api.blockvision.org/v2/monad/token/holders"

def get_token_holders(contract_address, limit=50, max_holders=None):
    """
    Fetch token holders from BlockVision API
    """
    all_holders = []
    cursor = ""
    page = 1
    
    print(f"\n{'='*60}")
    print(f"MONAD TOKEN SNAPSHOT")
    print(f"{'='*60}")
    print(f"Token: {contract_address}")
    print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")
    
    while True:
        params = {
            "contractAddress": contract_address,
            "limit": min(limit, 50)
        }
        
        if cursor:
            params["cursor"] = cursor
        
        headers = {
            "X-API-Key": API_KEY,
            "Accept": "application/json"
        }
        
        try:
            response = requests.get(BASE_URL, params=params, headers=headers, timeout=30)
            response.raise_for_status()
            data = response.json()
            
            if data.get("code") != 0:
                print(f"API Error: {data.get('reason', 'Unknown error')}")
                break
            
            result = data.get("result", {})
            holders = result.get("data", [])
            
            if not holders:
                break
            
            all_holders.extend(holders)
            print(f"Page {page}: Fetched {len(holders)} holders (Total: {len(all_holders)})")
            
            if max_holders and len(all_holders) >= max_holders:
                all_holders = all_holders[:max_holders]
                break
            
            cursor = result.get("nextPageCursor", "")
            if not cursor:
                break
            
            page += 1
            
        except requests.exceptions.RequestException as e:
            print(f"Request error: {e}")
            break
        except json.JSONDecodeError as e:
            print(f"JSON decode error: {e}")
            break
    
    return all_holders


def save_to_csv(holders, filename):
    """Save holders to CSV file"""
    with open(filename, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['Rank', 'Address', 'Amount', 'Percentage', 'USD Value', 'Is Contract'])
        
        for i, h in enumerate(holders, 1):
            writer.writerow([
                i,
                h.get('holder', ''),
                h.get('amount', ''),
                h.get('percentage', ''),
                h.get('usdValue', ''),
                h.get('isContract', False)
            ])
    
    print(f"\n✓ Saved to {filename}")


def save_to_json(holders, filename):
    """Save holders to JSON file"""
    output = {
        "timestamp": datetime.now().isoformat(),
        "total_holders": len(holders),
        "holders": [
            {
                "rank": i + 1,
                "address": h.get('holder', ''),
                "amount": h.get('amount', ''),
                "percentage": h.get('percentage', ''),
                "usd_value": h.get('usdValue', ''),
                "is_contract": h.get('isContract', False)
            }
            for i, h in enumerate(holders)
        ]
    }
    
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2)
    
    print(f"✓ Saved to {filename}")


def save_to_txt(holders, filename):
    """Save holders to TXT file"""
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(f"TOKEN HOLDER SNAPSHOT\n")
        f.write(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"Total Holders: {len(holders)}\n")
        f.write(f"{'='*70}\n\n")
        
        for i, h in enumerate(holders, 1):
            addr = h.get('holder', '')
            amount = h.get('amount', '0')
            pct = h.get('percentage', '0')
            f.write(f"{i:4}. {addr}  |  {float(amount):>20,.2f}  |  {float(pct):>6.2f}%\n")
    
    print(f"✓ Saved to {filename}")


def print_holders(holders, top_n=50):
    """Print holders to console"""
    print(f"\n{'='*90}")
    print(f"TOP {min(top_n, len(holders))} HOLDERS")
    print(f"{'='*90}")
    
    for i, h in enumerate(holders[:top_n], 1):
        addr = h.get('holder', '')
        amount = float(h.get('amount', 0))
        pct = float(h.get('percentage', 0))
        print(f"{i:4}. {addr}  |  {amount:>18,.2f}  |  {pct:>6.2f}%")
    
    print(f"{'='*90}\n")


def main():
    parser = argparse.ArgumentParser(
        description="Monad Token Holder Snapshot Tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python monad_snapshot.py 0x81A224F8A62f52BdE942dBF23A56df77A10b7777
  python monad_snapshot.py 0x81A224F8A62f52BdE942dBF23A56df77A10b7777 --top 100
  python monad_snapshot.py 0x81A224F8A62f52BdE942dBF23A56df77A10b7777 --output holders.csv
        """
    )
    
    parser.add_argument("token", help="Token contract address (0x...)")
    parser.add_argument("--top", type=int, default=50, help="Number of top holders to fetch (default: 50)")
    parser.add_argument("--output", "-o", help="Output filename (.csv, .json, or .txt)")
    parser.add_argument("--all-formats", action="store_true", help="Save in all formats")
    
    args = parser.parse_args()
    
    # Validate token address
    if not args.token.startswith("0x") or len(args.token) != 42:
        print("Error: Invalid token address. Must be 42 characters starting with 0x")
        return
    
    # Fetch holders
    holders = get_token_holders(args.token, limit=50, max_holders=args.top)
    
    if not holders:
        print("\nNo holders found or API error occurred.")
        return
    
    # Print to console
    print_holders(holders, args.top)
    
    # Generate base filename from token address
    base_name = f"{args.token[:10]}_holders"
    
    # Save to files
    if args.all_formats:
        save_to_csv(holders, f"{base_name}.csv")
        save_to_json(holders, f"{base_name}.json")
        save_to_txt(holders, f"{base_name}.txt")
    elif args.output:
        if args.output.endswith('.csv'):
            save_to_csv(holders, args.output)
        elif args.output.endswith('.json'):
            save_to_json(holders, args.output)
        else:
            save_to_txt(holders, args.output)
    else:
        # Default: save as txt and json
        save_to_txt(holders, f"{base_name}.txt")
        save_to_json(holders, f"{base_name}.json")
    
    print(f"\n✓ Snapshot complete! Found {len(holders)} holders.")


if __name__ == "__main__":
    main()

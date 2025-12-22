"""
Fetch top 50 $EMO token holders on Monad using Selenium
Token: 0x81A224F8A62f52BdE942dBF23A56df77A10b7777
"""

import json
import time
import re

TOKEN_ADDRESS = "0x81A224F8A62f52BdE942dBF23A56df77A10b7777"

def get_top_holders():
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
    except ImportError:
        print("Installing selenium...")
        import subprocess
        subprocess.run(['pip', 'install', 'selenium', 'webdriver-manager'], check=True)
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
    
    try:
        from webdriver_manager.chrome import ChromeDriverManager
        from selenium.webdriver.chrome.service import Service
    except ImportError:
        pass
    
    print("Opening MonadVision token holders page...")
    
    options = Options()
    options.add_argument('--headless')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument('--disable-gpu')
    options.add_argument('--window-size=1920,1080')
    options.add_argument('user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
    
    try:
        service = Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(service=service, options=options)
    except:
        driver = webdriver.Chrome(options=options)
    
    url = f"https://testnet.monadvision.com/token/{TOKEN_ADDRESS}?tab=holders"
    
    try:
        driver.get(url)
        print("Waiting for page to load...")
        time.sleep(10)  # Wait for Cloudflare and page to load
        
        # Get page source
        page_source = driver.page_source
        
        # Try to find holder addresses using regex
        # Monad addresses start with 0x and are 42 chars
        addresses = re.findall(r'0x[a-fA-F0-9]{40}', page_source)
        
        # Remove duplicates and the token address itself
        unique_addresses = []
        seen = set()
        for addr in addresses:
            addr_lower = addr.lower()
            if addr_lower not in seen and addr_lower != TOKEN_ADDRESS.lower():
                seen.add(addr_lower)
                unique_addresses.append(addr)
        
        print(f"Found {len(unique_addresses)} unique addresses")
        
        if unique_addresses:
            # Save the first 50
            results = [{'rank': i+1, 'address': addr} for i, addr in enumerate(unique_addresses[:50])]
            
            print("\n" + "="*80)
            print("TOP 50 $EMO HOLDERS (addresses found)")
            print("="*80)
            
            for r in results:
                print(f"{r['rank']:2}. {r['address']}")
            
            with open('top_50_emo_holders.txt', 'w') as f:
                f.write("TOP 50 $EMO HOLDERS\n" + "="*80 + "\n\n")
                for r in results:
                    f.write(f"{r['rank']:2}. {r['address']}\n")
            
            with open('top_50_emo_holders.json', 'w') as f:
                json.dump(results, f, indent=2)
            
            print(f"\nSaved to top_50_emo_holders.txt")
            return results
        else:
            print("No addresses found. Saving page source for debugging...")
            with open('debug_page.html', 'w', encoding='utf-8') as f:
                f.write(page_source)
            print("Saved to debug_page.html")
            
    except Exception as e:
        print(f"Error: {e}")
    finally:
        driver.quit()

if __name__ == "__main__":
    get_top_holders()
